"""Async MongoDB database layer with SQLite fallback.

Uses motor (async pymongo) for MongoDB Atlas connectivity.
Falls back to local SQLite for offline / development use.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

import motor.motor_asyncio
from gateway.config import settings

_mongo_client: Optional[motor.motor_asyncio.AsyncIOMotorClient] = None
_mongo_db: Optional[motor.motor_asyncio.AsyncIOMotorDatabase] = None
_use_sqlite: bool = False
_sqlite_conn: Optional[sqlite3.Connection] = None
_SQLITE_PATH = "governance_fallback.db"


# ── Initialisation ───────────────────────────────────────────────

async def init_db() -> None:
    """Connect to MongoDB Atlas or fall back to SQLite."""
    global _mongo_client, _mongo_db, _use_sqlite, _sqlite_conn

    mongo_uri = settings.mongodb_url
    if mongo_uri:
        try:
            _mongo_client = motor.motor_asyncio.AsyncIOMotorClient(
                mongo_uri,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
            )
            # Ping to verify connectivity
            await _mongo_client.admin.command("ping")
            _mongo_db = _mongo_client.get_default_database()
            if _mongo_db is None:
                _mongo_db = _mongo_client["governance"]
            _use_sqlite = False

            # Create indexes for fast lookups
            await _ensure_indexes()
            print(f"Connected to MongoDB Atlas (db: {_mongo_db.name}).")
            return
        except Exception as e:
            print(f"MongoDB connection failed ({e}). Falling back to SQLite...")

    print(f"Using local SQLite DB ({_SQLITE_PATH})...")
    _use_sqlite = True
    _sqlite_conn = sqlite3.connect(_SQLITE_PATH, check_same_thread=False)
    _sqlite_conn.row_factory = sqlite3.Row
    _init_sqlite_schema()


async def _ensure_indexes() -> None:
    """Create MongoDB indexes for performant queries."""
    if _mongo_db is None:
        return
    # agents: unique compound index
    await _mongo_db.agents.create_index(
        [("agent_id", 1), ("version", 1)], unique=True
    )
    # audit_log: trace_id for correlation queries, timestamp for ordering
    await _mongo_db.audit_log.create_index("trace_id")
    await _mongo_db.audit_log.create_index([("timestamp", -1)])
    await _mongo_db.audit_log.create_index("agent_id")
    # review_queue: status for filtering
    await _mongo_db.review_queue.create_index("status")
    await _mongo_db.review_queue.create_index("trace_id", unique=True)
    # flagged_mules
    await _mongo_db.flagged_mules.create_index("account_id", unique=True)
    # ledger
    await _mongo_db.ledger.create_index("trace_id")
    # policies
    await _mongo_db.policies.create_index("agent_id")


async def close_db() -> None:
    """Gracefully close database connections."""
    global _mongo_client, _mongo_db, _sqlite_conn
    if _mongo_client:
        _mongo_client.close()
        _mongo_client = None
        _mongo_db = None
    if _sqlite_conn:
        _sqlite_conn.close()
        _sqlite_conn = None


# ── Public query API (unchanged interface) ───────────────────────

async def fetch_all(query: str, *args: Any) -> List[Any]:
    """Fetch multiple rows. For MongoDB, query is parsed into collection + filter."""
    if _use_sqlite and _sqlite_conn:
        sql = _convert_pg_to_sqlite(query)
        c_args = _clean_args(args)
        cursor = _sqlite_conn.cursor()
        cursor.execute(sql, c_args)
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

    # MongoDB path
    return await _mongo_fetch_all(query, args)


async def fetch_one(query: str, *args: Any) -> Optional[Any]:
    """Fetch a single row."""
    if _use_sqlite and _sqlite_conn:
        sql = _convert_pg_to_sqlite(query)
        c_args = _clean_args(args)
        cursor = _sqlite_conn.cursor()
        cursor.execute(sql, c_args)
        row = cursor.fetchone()
        return dict(row) if row else None

    # MongoDB path
    return await _mongo_fetch_one(query, args)


async def execute(query: str, *args: Any) -> str:
    """Execute an INSERT / UPDATE / DELETE."""
    if _use_sqlite and _sqlite_conn:
        sql = _convert_pg_to_sqlite(query)
        c_args = _clean_args(args)
        with _sqlite_conn:
            _sqlite_conn.execute(sql, c_args)
        return "OK"

    # MongoDB path
    return await _mongo_execute(query, args)


# ── MongoDB query translation ───────────────────────────────────

def _parse_sql(query: str, args: tuple) -> dict:
    """
    Parse a simplified SQL query into a MongoDB operation descriptor.
    Returns dict with keys: op, collection, filter, doc, sort, limit, offset, fields.
    """
    q = query.strip()

    # Resolve positional $1, $2, ... into actual values
    def resolve_param(match):
        idx = int(match.group(1)) - 1
        val = args[idx] if idx < len(args) else None
        return _mongo_safe(val)

    info: Dict[str, Any] = {"op": None, "collection": None, "filter": {},
                             "doc": {}, "sort": None, "limit": 0, "offset": 0,
                             "fields": []}

    # ── SELECT ──
    sel_match = re.match(
        r"SELECT\s+(.+?)\s+FROM\s+(\w+)(.*)",
        q, re.IGNORECASE | re.DOTALL
    )
    if sel_match:
        info["op"] = "find"
        info["fields"] = [f.strip() for f in sel_match.group(1).split(",")]
        info["collection"] = sel_match.group(2)
        remainder = sel_match.group(3).strip()

        # WHERE
        where_match = re.search(r"WHERE\s+(.+?)(?:ORDER|LIMIT|OFFSET|$)", remainder, re.IGNORECASE | re.DOTALL)
        if where_match:
            info["filter"] = _parse_where(where_match.group(1).strip(), args)

        # ORDER BY
        order_match = re.search(r"ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?", remainder, re.IGNORECASE)
        if order_match:
            direction = -1 if (order_match.group(2) or "").upper() == "DESC" else 1
            info["sort"] = [(order_match.group(1), direction)]

        # LIMIT
        limit_match = re.search(r"LIMIT\s+\$(\d+)", remainder, re.IGNORECASE)
        if limit_match:
            idx = int(limit_match.group(1)) - 1
            info["limit"] = int(args[idx]) if idx < len(args) else 0

        # OFFSET
        offset_match = re.search(r"OFFSET\s+\$(\d+)", remainder, re.IGNORECASE)
        if offset_match:
            idx = int(offset_match.group(1)) - 1
            info["offset"] = int(args[idx]) if idx < len(args) else 0

        return info

    # ── INSERT ──
    ins_match = re.match(
        r"INSERT\s+INTO\s+(\w+)\s*\((.+?)\)\s*VALUES\s*\((.+?)\)",
        q, re.IGNORECASE | re.DOTALL
    )
    if ins_match:
        info["collection"] = ins_match.group(1)
        cols = [c.strip() for c in ins_match.group(2).split(",")]
        val_tokens = [v.strip() for v in ins_match.group(3).split(",")]
        doc = {}
        for col, vtok in zip(cols, val_tokens):
            param_match = re.match(r"\$(\d+)", vtok)
            if param_match:
                idx = int(param_match.group(1)) - 1
                doc[col] = _to_native(args[idx]) if idx < len(args) else None
            elif vtok.strip("'\"").upper() in ("CURRENT_TIMESTAMP", "NOW()"):
                doc[col] = datetime.now(timezone.utc).isoformat()
            else:
                doc[col] = vtok.strip("'\"")
        # Always add timestamp
        if "timestamp" not in doc and "created_at" not in doc:
            doc["created_at"] = datetime.now(timezone.utc).isoformat()
        # Default status for agents
        if info["collection"] == "agents" and "status" not in doc:
            doc["status"] = "active"

        # Check for ON CONFLICT ... DO UPDATE (upsert)
        remainder = q[ins_match.end():]
        conflict_match = re.search(
            r"ON\s+CONFLICT\s*\((.+?)\)\s+DO\s+UPDATE\s+SET\s+(.+)",
            remainder, re.IGNORECASE | re.DOTALL
        )
        if conflict_match:
            conflict_cols = [c.strip() for c in conflict_match.group(1).split(",")]
            info["op"] = "upsert"
            info["filter"] = {c: doc.get(c) for c in conflict_cols if c in doc}
            info["doc"] = doc
        else:
            info["op"] = "insert"
            info["doc"] = doc
        return info

    # ── UPDATE ──
    upd_match = re.match(
        r"UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)",
        q, re.IGNORECASE | re.DOTALL
    )
    if upd_match:
        info["op"] = "update"
        info["collection"] = upd_match.group(1)
        info["doc"] = _parse_set_clause(upd_match.group(2).strip(), args)
        info["filter"] = _parse_where(upd_match.group(3).strip(), args)
        return info

    # ── DELETE ──
    del_match = re.match(
        r"DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)",
        q, re.IGNORECASE | re.DOTALL
    )
    if del_match:
        info["op"] = "delete"
        info["collection"] = del_match.group(1)
        info["filter"] = _parse_where(del_match.group(2).strip(), args)
        return info

    # Fallback — treat as raw text
    info["op"] = "unknown"
    info["raw"] = q
    return info


def _parse_where(where_str: str, args: tuple) -> dict:
    """Parse a simple WHERE clause into a MongoDB filter dict."""
    filt = {}
    # Split on AND
    parts = re.split(r"\s+AND\s+", where_str, flags=re.IGNORECASE)
    for part in parts:
        part = part.strip().rstrip(";")
        # field = $N
        m = re.match(r"(\w+)\s*=\s*\$(\d+)", part)
        if m:
            col = m.group(1)
            idx = int(m.group(2)) - 1
            filt[col] = _to_native(args[idx]) if idx < len(args) else None
            continue
        # field = 'literal'
        m = re.match(r"(\w+)\s*=\s*'([^']*)'", part)
        if m:
            filt[m.group(1)] = m.group(2)
    return filt


def _parse_set_clause(set_str: str, args: tuple) -> dict:
    """Parse SET col=$1, col2=$2 into a dict."""
    updates = {}
    parts = set_str.split(",")
    for part in parts:
        m = re.match(r"\s*(\w+)\s*=\s*\$(\d+)", part.strip())
        if m:
            col = m.group(1)
            idx = int(m.group(2)) - 1
            updates[col] = _to_native(args[idx]) if idx < len(args) else None
        else:
            # literal assignment
            m2 = re.match(r"\s*(\w+)\s*=\s*'([^']*)'", part.strip())
            if m2:
                updates[m2.group(1)] = m2.group(2)
    return updates


async def _mongo_fetch_all(query: str, args: tuple) -> list:
    """Execute a SELECT query against MongoDB."""
    info = _parse_sql(query, args)
    coll = _mongo_db[info["collection"]]
    cursor = coll.find(info["filter"])
    if info.get("sort"):
        cursor = cursor.sort(info["sort"])
    if info.get("offset"):
        cursor = cursor.skip(info["offset"])
    if info.get("limit"):
        cursor = cursor.limit(info["limit"])

    results = []
    async for doc in cursor:
        doc.pop("_id", None)
        results.append(doc)
    return results


async def _mongo_fetch_one(query: str, args: tuple) -> Optional[dict]:
    """Execute a SELECT ... LIMIT 1 query against MongoDB."""
    info = _parse_sql(query, args)
    coll = _mongo_db[info["collection"]]
    doc = await coll.find_one(info["filter"])
    if doc:
        doc.pop("_id", None)
    return doc


async def _mongo_execute(query: str, args: tuple) -> str:
    """Execute INSERT / UPDATE / DELETE against MongoDB."""
    info = _parse_sql(query, args)
    coll = _mongo_db[info["collection"]]

    if info["op"] == "insert":
        await coll.insert_one(info["doc"])
        return "INSERT 1"

    if info["op"] == "upsert":
        await coll.update_one(
            info["filter"],
            {"$set": info["doc"]},
            upsert=True
        )
        return "UPSERT 1"

    if info["op"] == "update":
        result = await coll.update_many(info["filter"], {"$set": info["doc"]})
        return f"UPDATE {result.modified_count}"

    if info["op"] == "delete":
        result = await coll.delete_many(info["filter"])
        return f"DELETE {result.deleted_count}"

    return "OK"


# ── Helpers ──────────────────────────────────────────────────────

def _to_native(val: Any) -> Any:
    """Convert Python types to MongoDB-safe types."""
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (list, dict)):
        return val
    return val


def _mongo_safe(val: Any) -> str:
    """String-safe representation for debug/logging."""
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, Decimal):
        return str(float(val))
    return str(val) if val is not None else "null"


# ── SQLite fallback (unchanged) ──────────────────────────────────

def _init_sqlite_schema():
    if not _sqlite_conn:
        return
    with _sqlite_conn:
        _sqlite_conn.executescript("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT '1.0.0',
                name TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                public_key TEXT,
                allowed_action_types TEXT DEFAULT '[]',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (agent_id, version)
            );

            CREATE TABLE IF NOT EXISTS policies (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                version INT NOT NULL DEFAULT 1,
                rego_body TEXT NOT NULL,
                daily_spend_limit NUMERIC DEFAULT 50000,
                active BOOLEAN DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                agent_id TEXT,
                action TEXT NOT NULL,
                node_name TEXT NOT NULL,
                reason_code TEXT NOT NULL,
                outcome TEXT NOT NULL,
                details TEXT DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS review_queue (
                trace_id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                version TEXT NOT NULL,
                action TEXT NOT NULL,
                amount NUMERIC,
                beneficiary TEXT,
                risk_score NUMERIC NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS flagged_mules (
                account_id TEXT PRIMARY KEY,
                added_at TEXT DEFAULT CURRENT_TIMESTAMP,
                reason TEXT
            );

            CREATE TABLE IF NOT EXISTS ledger (
                entry_id TEXT PRIMARY KEY,
                trace_id TEXT,
                agent_id TEXT NOT NULL,
                amount NUMERIC NOT NULL,
                beneficiary TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'EXECUTED',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS fleet_status (
                id INT PRIMARY KEY DEFAULT 1,
                halted BOOLEAN DEFAULT 0,
                halted_at TEXT,
                halted_by TEXT
            );

            INSERT OR IGNORE INTO fleet_status (id, halted) VALUES (1, 0);
        """)


def _clean_args(args: tuple) -> tuple:
    cleaned = []
    for a in args:
        if isinstance(a, uuid.UUID):
            cleaned.append(str(a))
        elif isinstance(a, Decimal):
            cleaned.append(float(a))
        elif isinstance(a, (list, dict)):
            cleaned.append(json.dumps(a))
        else:
            cleaned.append(a)
    return tuple(cleaned)


def _convert_pg_to_sqlite(pg_sql: str) -> str:
    """Simple parameter converter from $1, $2 to ? for SQLite."""
    sql = re.sub(r'\$\d+', '?', pg_sql)
    sql = sql.replace('gen_random_uuid()', 'lower(hex(randomblob(16)))')
    sql = sql.replace('now()', 'CURRENT_TIMESTAMP')
    sql = sql.replace('ON CONFLICT (account_id) DO NOTHING', 'ON CONFLICT(account_id) DO NOTHING')
    return sql

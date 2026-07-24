"""Async PostgreSQL connection pool and query helpers with SQLite fallback."""

from __future__ import annotations

import os
import sqlite3
import asyncpg
from typing import Any, Optional, Dict

from gateway.config import settings

_pool: Optional[asyncpg.Pool] = None
_use_sqlite: bool = False
_sqlite_conn: Optional[sqlite3.Connection] = None
_SQLITE_PATH = "governance_fallback.db"


async def init_db() -> None:
    """Create connection pool or fall back to SQLite."""
    global _pool, _use_sqlite, _sqlite_conn
    try:
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=5,
        )
        _use_sqlite = False
        print("Connected to PostgreSQL DB.")
    except Exception as e:
        print(f"PostgreSQL connection failed ({e}). Falling back to local SQLite DB ({_SQLITE_PATH})...")
        _use_sqlite = True
        _sqlite_conn = sqlite3.connect(_SQLITE_PATH, check_same_thread=False)
        _sqlite_conn.row_factory = sqlite3.Row
        _init_sqlite_schema()


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


async def close_db() -> None:
    global _pool, _sqlite_conn
    if _pool:
        await _pool.close()
        _pool = None
    if _sqlite_conn:
        _sqlite_conn.close()
        _sqlite_conn = None


def _clean_args(args: tuple) -> tuple:
    if not _use_sqlite:
        return args
    import json, uuid
    from decimal import Decimal
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




async def fetch_all(query: str, *args: Any) -> list[Any]:
    if _use_sqlite and _sqlite_conn:
        sql = _convert_pg_to_sqlite(query)
        c_args = _clean_args(args)
        cursor = _sqlite_conn.cursor()
        cursor.execute(sql, c_args)
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    pool = _get_pool()
    async with pool.acquire() as conn:
        return await conn.fetch(query, *args)


async def fetch_one(query: str, *args: Any) -> Optional[Any]:
    if _use_sqlite and _sqlite_conn:
        sql = _convert_pg_to_sqlite(query)
        c_args = _clean_args(args)
        cursor = _sqlite_conn.cursor()
        cursor.execute(sql, c_args)
        row = cursor.fetchone()
        return dict(row) if row else None
    pool = _get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def execute(query: str, *args: Any) -> str:
    if _use_sqlite and _sqlite_conn:
        sql = _convert_pg_to_sqlite(query)
        c_args = _clean_args(args)
        with _sqlite_conn:
            _sqlite_conn.execute(sql, c_args)
        return "OK"
    pool = _get_pool()
    async with pool.acquire() as conn:
        return await conn.execute(query, *args)



def _get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialised")
    return _pool


def _convert_pg_to_sqlite(pg_sql: str) -> str:
    """Simple parameter converter from $1, $2 to ? for SQLite."""
    import re
    sql = re.sub(r'\$\d+', '?', pg_sql)
    sql = sql.replace('gen_random_uuid()', 'lower(hex(randomblob(16)))')
    sql = sql.replace('now()', 'CURRENT_TIMESTAMP')
    sql = sql.replace('ON CONFLICT (account_id) DO NOTHING', 'ON CONFLICT(account_id) DO NOTHING')
    return sql

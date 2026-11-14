"""Postgres rows for built agents and their runs."""

from __future__ import annotations

import json
import secrets
from typing import Any, Optional

from db import _iso, get_conn

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS built_agents (
        id            VARCHAR(16) PRIMARY KEY,
        owner_wallet  VARCHAR(64) NOT NULL,
        prompt        TEXT NOT NULL,
        spec          JSONB NOT NULL,
        spec_sha      VARCHAR(16) NOT NULL,
        compose_meta  JSONB NOT NULL DEFAULT '{}'::jsonb,
        app_name      VARCHAR(64) NOT NULL,
        build_status  VARCHAR(16) NOT NULL DEFAULT 'draft',
        build         JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS built_agents_owner ON built_agents (owner_wallet, created_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS built_agent_runs (
        id          VARCHAR(20) PRIMARY KEY,
        agent_id    VARCHAR(16) NOT NULL REFERENCES built_agents(id) ON DELETE CASCADE,
        wallet      VARCHAR(64) NOT NULL,
        caller      VARCHAR(16) NOT NULL,
        built       BOOLEAN NOT NULL,
        decision    JSONB NOT NULL,
        orders      JSONB NOT NULL DEFAULT '[]'::jsonb,
        error       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS built_agent_runs_agent ON built_agent_runs (agent_id, created_at DESC)",
]


def init() -> None:
    with get_conn() as conn, conn.cursor() as cur:
        for stmt in SCHEMA:
            cur.execute(stmt)


def _row(r: Optional[dict]) -> Optional[dict[str, Any]]:
    return {k: _iso(v) for k, v in r.items()} if r else None


def create_agent(owner: str, prompt: str, spec: dict, spec_sha: str, meta: dict) -> dict[str, Any]:
    agent_id = "ag" + secrets.token_hex(4)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO built_agents (id, owner_wallet, prompt, spec, spec_sha, compose_meta, app_name)
               VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (agent_id, owner, prompt, json.dumps(spec), spec_sha, json.dumps(meta), f"bit-{agent_id}"),
        )
        return _row(cur.fetchone())


def get_agent(agent_id: str) -> Optional[dict[str, Any]]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM built_agents WHERE id = %s", (agent_id,))
        return _row(cur.fetchone())


def list_agents(owner: Optional[str] = None) -> list[dict[str, Any]]:
    with get_conn() as conn, conn.cursor() as cur:
        if owner:
            cur.execute("SELECT * FROM built_agents WHERE owner_wallet = %s ORDER BY created_at DESC", (owner,))
        else:
            cur.execute("SELECT * FROM built_agents WHERE build_status = 'ready' ORDER BY created_at DESC LIMIT 50")
        return [_row(r) for r in cur.fetchall()]


def set_build(agent_id: str, status: str, build: dict) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("UPDATE built_agents SET build_status=%s, build=%s, updated_at=NOW() WHERE id=%s",
                    (status, json.dumps(build), agent_id))


def add_run(agent_id: str, wallet: str, caller: str, built: bool, decision: dict, orders: list, error: Optional[str]) -> str:
    run_id = "run" + secrets.token_hex(6)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO built_agent_runs (id, agent_id, wallet, caller, built, decision, orders, error)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (run_id, agent_id, wallet, caller, built, json.dumps(decision), json.dumps(orders), error),
        )
    return run_id


def list_runs(agent_id: str, limit: int = 20) -> list[dict[str, Any]]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT id, wallet, caller, built, decision, orders, error, created_at
               FROM built_agent_runs WHERE agent_id=%s ORDER BY created_at DESC LIMIT %s""",
            (agent_id, limit),
        )
        return [_row(r) for r in cur.fetchall()]


def spent_today_usd(agent_id: str, wallet: str) -> float:
    """Buys this agent built for this wallet since UTC midnight, from an Aomi-app run."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COALESCE(SUM((o->>'usd')::numeric), 0) AS usd
               FROM built_agent_runs r, jsonb_array_elements(r.orders) o
               WHERE r.agent_id=%s AND r.wallet=%s AND r.built AND r.caller='app'
                 AND o->>'side'='buy' AND o ? 'stage'
                 AND r.created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'""",
            (agent_id, wallet),
        )
        return float(cur.fetchone()["usd"])

"""HTTP routes for the agent builder. Mounted by agents_api.py under /builder."""

from __future__ import annotations

import hmac
import os
import re
from dataclasses import asdict
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from . import aomi_bridge, compiler, market, store, strategies
from .contract import Context
from .spec import AgentSpec, Unsupported, compose_spec

ADDRESS = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


class CreateBody(BaseModel):
    prompt: str = Field(min_length=20, max_length=2000)


class EvaluateBody(BaseModel):
    wallet: str
    build: bool = False


def _public(a: dict[str, Any]) -> dict[str, Any]:
    return {k: a[k] for k in ("id", "owner_wallet", "prompt", "spec", "spec_sha", "compose_meta",
                              "app_name", "build_status", "build", "created_at", "updated_at")}


def _agent(agent_id: str) -> dict[str, Any]:
    a = store.get_agent(agent_id)
    if not a:
        raise HTTPException(404, "No such agent.")
    return a


def evaluate(agent: dict[str, Any], wallet: str, build: bool, caller: str) -> dict[str, Any]:
    """Run the strategy for `wallet`. With build=True each order carries unsigned swap instructions."""
    if not ADDRESS.match(wallet):
        raise HTTPException(400, "wallet is not a Solana address.")
    spec = AgentSpec.model_validate(agent["spec"])
    tpl = strategies.get(spec.strategy.template)
    limits = spec.limits.model_dump()
    held, sol = market.holdings(wallet)
    market.price_holdings(held)
    cash = next((h.amount for h in held if h.mint == market.USDC["mint"]), 0.0)
    ctx = Context(wallet=wallet, holdings=held, cash_usd=cash,
                  spent_today_usd=store.spent_today_usd(agent["id"], wallet))
    decision = tpl.evaluate(ctx, tpl.Params.model_validate(spec.strategy.params), limits)
    orders: list[dict[str, Any]] = []
    for i, o in enumerate(decision.orders):
        row: dict[str, Any] = {"index": i, **asdict(o)}
        if build:
            try:
                if o.side == "buy":
                    swap = market.build_swap(payer=wallet, input_mint=market.USDC["mint"], output_mint=o.mint,
                                             raw_amount=int(round(o.usd * 10 ** market.USDC["decimals"])),
                                             slippage_bps=spec.limits.slippage_bps)
                else:
                    pos = next(h for h in held if h.mint == o.mint)
                    swap = market.build_swap(payer=wallet, input_mint=o.mint, output_mint=market.USDC["mint"],
                                             raw_amount=int(round(pos.amount * 10 ** pos.decimals)),
                                             slippage_bps=spec.limits.slippage_bps)
            except Exception as exc:
                row["build_error"] = str(exc)
            else:
                row["quote"] = {k: swap[k] for k in ("in_amount", "out_amount", "other_amount_threshold",
                                                     "price_impact_pct", "slippage_bps", "tx_bytes")}
                row["stage"] = {
                    "instructions": swap["instructions"],
                    "address_lookup_tables": swap["address_lookup_tables"],
                    "description": f"{spec.name}: {o.side} ${o.usd:g} of {o.token_symbol} ({o.reason})",
                    "kind": "swap",
                }
                row["unsigned_tx_base64"] = swap["unsigned_tx_base64"]
        orders.append(row)
    out = {
        "agent_id": agent["id"], "agent": spec.name, "strategy": spec.strategy.template,
        "wallet": {"address": wallet, "sol": sol, "cash_usd": cash, "quote": spec.limits.quote,
                   "holdings": [asdict(h) for h in held], "spent_today_usd": ctx.spent_today_usd},
        "limits": limits, "signals": decision.signals, "notes": decision.notes, "orders": orders,
    }
    out["run_id"] = store.add_run(agent["id"], wallet, caller, build,
                                  {"signals": decision.signals, "notes": decision.notes, "wallet": out["wallet"]},
                                  [{k: v for k, v in o.items() if k != "unsigned_tx_base64"} for o in orders], None)
    return out


def make_router(require_wallet_session, require_internal_key) -> APIRouter:
    r = APIRouter(prefix="/builder", tags=["agent builder"])

    def require_app_key(x_app_key: Optional[str] = Header(default=None)) -> None:
        want = os.environ.get("BUILDER_APP_KEY", "")
        if not want or not x_app_key or not hmac.compare_digest(want, x_app_key):
            raise HTTPException(403, "Invalid app key.")

    @r.get("/templates", dependencies=[Depends(require_internal_key)])
    def templates() -> dict[str, Any]:
        return {"templates": [{"name": s.name, "title": s.title, "summary": s.summary,
                               "params_schema": s.Params.model_json_schema()} for s in strategies.REGISTRY.values()]}

    @r.post("/agents")
    def create(body: CreateBody, wallet: str = Depends(require_wallet_session)) -> dict[str, Any]:
        try:
            spec, meta = compose_spec(body.prompt)
        except Unsupported as exc:
            raise HTTPException(422, f"Not supported yet: {exc}")
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except RuntimeError as exc:
            raise HTTPException(502, str(exc))
        return _public(store.create_agent(wallet, body.prompt, spec.model_dump(), spec.sha(), meta))

    @r.get("/agents")
    def mine(wallet: str = Depends(require_wallet_session)) -> dict[str, Any]:
        return {"agents": [_public(a) for a in store.list_agents(wallet)]}

    @r.get("/agents/{agent_id}", dependencies=[Depends(require_internal_key)])
    def get(agent_id: str) -> dict[str, Any]:
        return _public(_agent(agent_id))

    @r.post("/agents/{agent_id}/compile")
    def compile_(agent_id: str, wallet: str = Depends(require_wallet_session)) -> dict[str, Any]:
        a = _agent(agent_id)
        if a["owner_wallet"] != wallet:
            raise HTTPException(403, "Only the creator can compile this agent.")
        if a["build_status"] == "building":
            raise HTTPException(409, "A build is already running.")
        compiler.start(agent_id)
        return _public(_agent(agent_id))

    @r.get("/agents/{agent_id}/source", dependencies=[Depends(require_internal_key)])
    def source(agent_id: str) -> dict[str, Any]:
        a = _agent(agent_id)
        crate = (a["build"] or {}).get("crate_dir")
        if not crate or not os.path.isdir(crate):
            raise HTTPException(404, "This agent has not been compiled yet.")
        files = {}
        for rel in ("aomi.toml", "Cargo.toml", "src/lib.rs", "src/tool.rs", "src/skill/strategy.md", ".aomi/config.json"):
            with open(os.path.join(crate, rel)) as fh:
                files[rel] = fh.read()
        return {"files": files}

    @r.get("/agents/{agent_id}/runs", dependencies=[Depends(require_internal_key)])
    def runs(agent_id: str) -> dict[str, Any]:
        _agent(agent_id)
        return {"runs": store.list_runs(agent_id)}

    @r.post("/agents/{agent_id}/preview")
    def preview(agent_id: str, body: EvaluateBody, _: str = Depends(require_wallet_session)) -> dict[str, Any]:
        """What the strategy would do for a wallet right now. Never builds a transaction."""
        return evaluate(_agent(agent_id), body.wallet, False, "preview")

    @r.post("/agents/{agent_id}/evaluate", dependencies=[Depends(require_app_key)])
    def evaluate_(agent_id: str, body: EvaluateBody) -> dict[str, Any]:
        """Called by the agent's Aomi app. Returns the decision and unsigned swap instructions."""
        a = _agent(agent_id)
        if a["build_status"] != "ready":
            raise HTTPException(409, "This agent is not deployed.")
        return evaluate(a, body.wallet, body.build, "app")

    class ChatBody(BaseModel):
        message: str = Field(min_length=1, max_length=4000)
        session_id: Optional[str] = None

    def _with_balances(st: dict[str, Any]) -> dict[str, Any]:
        if st.get("wallet"):
            held, sol = market.holdings(st["wallet"]["address"])
            st["wallet"]["sol"] = sol
            st["wallet"]["cash_usd"] = next((h.amount for h in held if h.mint == market.USDC["mint"]), 0.0)
        return st

    @r.get("/agents/{agent_id}/aomi")
    def aomi_state(agent_id: str, wallet: str = Depends(require_wallet_session)) -> dict[str, Any]:
        return _with_balances(aomi_bridge.state(wallet, _agent(agent_id)["app_name"]))

    @r.post("/agents/{agent_id}/aomi/wallet")
    def aomi_wallet(agent_id: str, wallet: str = Depends(require_wallet_session)) -> dict[str, Any]:
        return _with_balances(aomi_bridge.create_wallet(wallet, _agent(agent_id)["app_name"]))

    @r.post("/agents/{agent_id}/chat")
    def chat(agent_id: str, body: ChatBody, wallet: str = Depends(require_wallet_session)) -> dict[str, Any]:
        return aomi_bridge.chat(wallet, _agent(agent_id)["app_name"], body.message, body.session_id)

    return r

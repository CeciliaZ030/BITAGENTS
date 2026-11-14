from __future__ import annotations

from ..contract import Strategy
from .signal_basket import SignalBasket

REGISTRY: dict[str, Strategy] = {s.name: s for s in (SignalBasket(),)}


def get(name: str) -> Strategy:
    if name not in REGISTRY:
        raise KeyError(f"unknown strategy template {name!r}; known: {sorted(REGISTRY)}")
    return REGISTRY[name]

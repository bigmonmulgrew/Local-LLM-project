import asyncio

from L3M_Web.api.routes.health import healthz


def test_healthz() -> None:
    assert asyncio.run(healthz()) == {"status": "ok"}

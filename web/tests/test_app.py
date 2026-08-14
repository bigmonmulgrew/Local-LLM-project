import asyncio

from hello_web.main import healthz


def test_healthz() -> None:
    assert asyncio.run(healthz()) == {"status": "ok"}

"""Expo push sender (filled in by Milestone 5)."""

import asyncio


async def push_consumer(stop: asyncio.Event) -> None:
    await stop.wait()

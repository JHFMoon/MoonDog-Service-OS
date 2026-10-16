#!/usr/bin/env python3
"""Bounded and redaction-safe retry for public GitHub audit downloads.

Only transient transport/HTTP failures are retried. Final failures propagate
unchanged so the public surface audit fails closed rather than skipping an asset.
"""
from __future__ import annotations

import random
import time
from typing import Callable, TypeVar

T = TypeVar("T")

TRANSIENT = frozenset({"408", "429", "500", "502", "503", "504", "transport_failure"})
MAX_ATTEMPTS = 3


class DownloadFailure(Exception):
    def __init__(self, status: str):
        self.status = status
        super().__init__("public-surface download failed: " + status)


def retry_transient(
    attempt: Callable[[], T],
    *,
    reset: Callable[[], None],
    sleep: Callable[[float], None] = time.sleep,
    jitter: Callable[[], float] = random.random,
    max_attempts: int = MAX_ATTEMPTS,
) -> T:
    if not 1 <= max_attempts <= MAX_ATTEMPTS:
        raise ValueError("invalid bounded retry count")
    for index in range(max_attempts):
        reset()
        try:
            return attempt()
        except DownloadFailure as error:
            if error.status not in TRANSIENT or index + 1 >= max_attempts:
                raise
            # At most two short delays; no URL, response body, or credentials logged.
            sleep(min(2 ** index, 4) + min(max(jitter(), 0.0), 1.0) * 0.25)
    raise RuntimeError("unreachable")

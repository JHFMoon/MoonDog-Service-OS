#!/usr/bin/env python3
"""Bounded, redaction-safe retries and failure classification for public GitHub audits.

Only transient transport/HTTP failures are retried. Final failures propagate as
fixed categories so the audit fails closed without disclosing response bodies.
"""
from __future__ import annotations

import random
import time
from typing import Callable, TypeVar

T = TypeVar("T")

TRANSIENT = frozenset({"408", "429", "500", "502", "503", "504", "transport_failure"})
MAX_ATTEMPTS = 3



API_TRANSIENT = TRANSIENT


def classify_api_failure(stderr: bytes | str) -> str:
    """Map GitHub CLI errors to a fixed safe category; never return source text."""
    if isinstance(stderr, bytes):
        value = stderr.decode("utf-8", "replace").lower()
    else:
        value = str(stderr).lower()
    if "secondary rate limit" in value or "rate limit exceeded" in value:
        return "429"
    for code in ("408", "429", "500", "502", "503", "504"):
        if f"http {code}" in value or f"status {code}" in value:
            return code
    for code in ("401", "403", "404"):
        if f"http {code}" in value or f"status {code}" in value:
            return code
    if any(marker in value for marker in (
        "timed out", "timeout", "connection reset", "connection refused",
        "temporary failure", "could not resolve", "network is unreachable",
    )):
        return "transport_failure"
    return "api_failure"


def safe_api_operation(endpoint: str) -> str:
    """Return a fixed operation label, not an untrusted URL or API response."""
    path = endpoint.split("?", 1)[0].rstrip("/")
    if path.endswith("/releases"):
        return "release_list"
    if path.endswith("/actions/artifacts"):
        return "artifact_list"
    if path.endswith("/issues/comments"):
        return "issue_comments"
    if path.endswith("/pulls/comments"):
        return "review_comments"
    if path.endswith("/issues"):
        return "issue_list"
    if "/pulls/" in path and path.endswith("/reviews"):
        return "pr_reviews"
    return "other_api"

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

"""Named-error type for the OpenSight headless v1 Python SDK (issue #95).

Mirrors ``packages/headless-sdk/src/errors.ts``: every non-2xx v1 response
raises :class:`OpenSightApiError` carrying the named ``errorCode`` the API
guarantees (e.g. ``RATE_LIMIT_EXCEEDED``), the HTTP status, and the
``Retry-After`` seconds for rate-limited responses.
"""

from __future__ import annotations

from typing import Any, Mapping


class OpenSightApiError(Exception):
    """Error raised for every non-2xx v1 response."""

    def __init__(
        self,
        *,
        error_code: str,
        message: str,
        status: int,
        body: Mapping[str, Any],
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.status = status
        #: Present for 429 RATE_LIMIT_EXCEEDED
        self.retry_after = retry_after
        self.body = dict(body)

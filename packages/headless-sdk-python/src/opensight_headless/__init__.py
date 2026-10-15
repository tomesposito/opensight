"""Python client for the OpenSight headless v1 REST API (issue #95).

Generated-first port of ``@opensight/headless-sdk``: maps 1:1 onto
``docs/api/openapi-v1.yaml`` with the same conventions (named
``errorCode`` errors, ``Limit``/``Cursor`` headers, ``Idempotency-Key``,
``If-Match``, no raw SQL — ``query_dataset`` takes the
``InteractiveQuery`` visual model).
"""

from .client import (
    DashboardExportArtifact,
    HttpResponse,
    OpenSightClient,
    VersionedResult,
)
from .errors import OpenSightApiError

__all__ = [
    "OpenSightClient",
    "OpenSightApiError",
    "VersionedResult",
    "DashboardExportArtifact",
    "HttpResponse",
]

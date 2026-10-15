"""Typed client for the OpenSight headless v1 API (issue #95).

Maps 1:1 onto ``docs/api/openapi-v1.yaml`` — the implemented datasets,
querying, analyses, dashboards and assets slices. Conventions on every
call, mirroring the TypeScript SDK (``packages/headless-sdk``): named
``errorCode`` errors, ``Limit``/``Cursor`` headers (the hosted plane
rejects query strings), ``Idempotency-Key`` on mutations, ``If-Match``
on deletes and analysis edits, and per-tenant rate limiting.

Zero runtime dependencies: the default transport is :mod:`urllib`
from the standard library; a custom transport can be injected for
tests or proxies.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .errors import OpenSightApiError

__all__ = [
    "OpenSightClient",
    "VersionedResult",
    "DashboardExportArtifact",
    "HttpResponse",
]


@dataclass
class HttpResponse:
    """Transport-level response. Header keys are lowercase."""

    status: int
    headers: dict[str, str]
    body: bytes


@dataclass
class VersionedResult:
    """HTTP metadata is separate from the unchanged response body."""

    value: Any
    etag: str | None


@dataclass
class DashboardExportArtifact:
    bytes: bytes
    content_type: str
    content_disposition: str | None
    etag: str | None


#: A transport sends an HTTP request and returns an HttpResponse.
#: Injected for tests; defaults to urllib.
Transport = Callable[[str, str, dict[str, str], bytes | None], HttpResponse]


def _urllib_transport(
    method: str, url: str, headers: dict[str, str], body: bytes | None
) -> HttpResponse:
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req) as res:
            return HttpResponse(
                status=res.status,
                headers={k.lower(): v for k, v in res.headers.items()},
                body=res.read(),
            )
    except HTTPError as e:
        return HttpResponse(
            status=e.code,
            headers={k.lower(): v for k, v in e.headers.items()},
            body=e.read(),
        )


def _encode(value: str | int) -> str:
    return quote(str(value), safe="")


def _page_headers(limit: int | None, cursor: str | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    if limit is not None:
        headers["Limit"] = str(limit)
    if cursor is not None:
        headers["Cursor"] = cursor
    return headers


def _mutation_headers(idempotency_key: str | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def _analysis_headers(if_match: str, idempotency_key: str | None) -> dict[str, str]:
    return {**_mutation_headers(idempotency_key), "If-Match": if_match}


def _parse_retry_after(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _safe_json(body: bytes) -> Any:
    try:
        text = body.decode("utf-8")
    except (UnicodeDecodeError, AttributeError):
        return None
    try:
        return json.loads(text) if text.strip() else None
    except ValueError:
        return None


class OpenSightClient:
    """Typed client for the OpenSight headless v1 API.

    :param base_url: API root, e.g. ``https://host/api`` (the client
        appends ``/v1/...``). Trailing slashes are stripped.
    :param get_token: the user-level, tenant-scoped bearer <redacted> minted
        through the operator invitation path (D-37 decision 4). A string or
        a zero-argument callable returning one (for refresh-token flows).
    :param transport: injectable HTTP transport (tests, proxies).
        Defaults to :mod:`urllib`.
    """

    def __init__(
        self,
        base_url: str,
        get_token: str | Callable[[], str],
        transport: Transport | None = None,
    ) -> None:
        if not base_url or not isinstance(base_url, str):
            raise TypeError("base_url is required")
        self._base_url = base_url.rstrip("/")
        if isinstance(get_token, str):
            token = get_token
            self._get_token: Callable[[], str] = lambda: token  # noqa: E731
        elif callable(get_token):
            self._get_token = get_token
        else:
            raise TypeError("get_token must be a string or a callable")
        self._transport = transport or _urllib_transport

    # ---- datasets ----

    def list_datasets(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/datasets", _page_headers(limit, cursor))

    def get_dataset(self, id: str):
        return self._json("GET", f"/v1/datasets/{_encode(id)}")

    def save_dataset(self, id: str, body: Mapping[str, Any], idempotency_key: str | None = None):
        """PUT creates or updates a prepared dataset. ``expectedVersion`` is 0 on create."""
        return self._json(
            "PUT", f"/v1/datasets/{_encode(id)}", _mutation_headers(idempotency_key), body
        )

    def delete_dataset(self, id: str, if_match: str):
        """DELETE a prepared dataset. Requires ``If-Match`` (optimistic concurrency)."""
        return self._json(
            "DELETE", f"/v1/datasets/{_encode(id)}", {"If-Match": if_match}
        )

    def get_dataset_lineage(self, id: str):
        return self._json("GET", f"/v1/datasets/{_encode(id)}/lineage")

    def refresh_dataset(self, id: str, idempotency_key: str | None = None):
        """Trigger a refresh (BLAZE datasets only; fail-closed 409
        ``BLAZE_MODE_REQUIRED`` otherwise)."""
        return self._json(
            "POST",
            f"/v1/datasets/{_encode(id)}/refresh",
            _mutation_headers(idempotency_key),
            {},
        )

    def get_refresh_status(self, id: str):
        return self._json("GET", f"/v1/datasets/{_encode(id)}/refresh-status")

    # ---- querying ----

    def query_dataset(
        self,
        id: str,
        query: Mapping[str, Any],
        idempotency_key: str | None = None,
    ):
        """Run an ``InteractiveQuery`` against a dataset. No raw SQL is ever sent."""
        return self._json(
            "POST",
            f"/v1/datasets/{_encode(id)}/query",
            _mutation_headers(idempotency_key),
            query,
        )

    # ---- sources ----

    def list_sources(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/sources", _page_headers(limit, cursor))

    def get_source(self, id: str):
        return self._json("GET", f"/v1/sources/{_encode(id)}")

    def delete_source(self, id: str, if_match: str):
        """Retire a source. Refused fail-closed (409
        ``SOURCE_DELETE_BLOCKED_BY_DATASET``) while any prepared dataset
        references it. Requires ``If-Match``."""
        return self._json(
            "DELETE", f"/v1/sources/{_encode(id)}", {"If-Match": if_match}
        )

    # ---- analyses ----

    def list_analyses(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/analyses", _page_headers(limit, cursor))

    def get_analysis(self, id: str) -> VersionedResult:
        return self._versioned_json("GET", _analysis_path(id))

    def create_analysis(self, body: Mapping[str, Any], idempotency_key: str | None = None) -> VersionedResult:
        return self._versioned_json(
            "POST", "/v1/analyses", _mutation_headers(idempotency_key), body
        )

    def update_analysis(
        self, id: str, body: Mapping[str, Any], if_match: str, idempotency_key: str | None = None
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT", _analysis_path(id), _analysis_headers(if_match, idempotency_key), body
        )

    def delete_analysis(self, id: str, if_match: str, idempotency_key: str | None = None):
        return self._json(
            "DELETE", _analysis_path(id), _analysis_headers(if_match, idempotency_key)
        )

    def add_visual(
        self, id: str, sheet_id: str, body: Mapping[str, Any], if_match: str, idempotency_key: str | None = None
    ) -> VersionedResult:
        return self._versioned_json(
            "POST",
            f"{_sheet_path(id, sheet_id)}/visuals",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    def update_visual(
        self,
        id: str,
        sheet_id: str,
        visual_id: str,
        body: Mapping[str, Any],
        if_match: str,
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT",
            f"{_sheet_path(id, sheet_id)}/visuals/{_encode(visual_id)}",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    def remove_visual(
        self, id: str, sheet_id: str, visual_id: str, if_match: str, idempotency_key: str | None = None
    ) -> VersionedResult:
        return self._versioned_json(
            "DELETE",
            f"{_sheet_path(id, sheet_id)}/visuals/{_encode(visual_id)}",
            _analysis_headers(if_match, idempotency_key),
        )

    def set_layouts(
        self, id: str, sheet_id: str, body: Mapping[str, Any], if_match: str, idempotency_key: str | None = None
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT",
            f"{_sheet_path(id, sheet_id)}/layouts",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    def add_filter_group(
        self, id: str, body: Mapping[str, Any], if_match: str, idempotency_key: str | None = None
    ) -> VersionedResult:
        return self._versioned_json(
            "POST",
            f"{_analysis_path(id)}/filter-groups",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    def update_filter_group(
        self,
        id: str,
        filter_group_id: str,
        body: Mapping[str, Any],
        if_match: str,
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT",
            f"{_analysis_path(id)}/filter-groups/{_encode(filter_group_id)}",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    def remove_filter_group(
        self, id: str, filter_group_id: str, if_match: str, idempotency_key: str | None = None
    ) -> VersionedResult:
        return self._versioned_json(
            "DELETE",
            f"{_analysis_path(id)}/filter-groups/{_encode(filter_group_id)}",
            _analysis_headers(if_match, idempotency_key),
        )

    def set_calculated_fields(
        self, id: str, body: Mapping[str, Any], if_match: str, idempotency_key: str | None = None
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT",
            f"{_analysis_path(id)}/calculated-fields",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    # ---- published dashboards ----

    def publish_analysis(
        self,
        id: str,
        body: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "POST",
            f"{_analysis_path(id)}/publish",
            _mutation_headers(idempotency_key),
            {} if body is None else body,
        )

    def list_dashboards(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/dashboards", _page_headers(limit, cursor))

    def get_dashboard(self, id: str) -> VersionedResult:
        return self._versioned_json("GET", _dashboard_path(id))

    def list_dashboard_versions(self, id: str, limit: int | None = None, cursor: str | None = None):
        return self._json(
            "GET", f"{_dashboard_path(id)}/versions", _page_headers(limit, cursor)
        )

    def get_dashboard_version(self, id: str, version: int) -> VersionedResult:
        return self._versioned_json("GET", _dashboard_version_path(id, version))

    def delete_dashboard(self, id: str, if_match: str, idempotency_key: str | None = None):
        return self._json(
            "DELETE", _dashboard_path(id), _analysis_headers(if_match, idempotency_key)
        )

    def delete_dashboard_version(
        self, id: str, version: int, if_match: str, idempotency_key: str | None = None
    ):
        return self._json(
            "DELETE",
            _dashboard_version_path(id, version),
            _analysis_headers(if_match, idempotency_key),
        )

    def get_dashboard_share(self, id: str, principal: Mapping[str, str]):
        return self._json("GET", _dashboard_share_path(id, principal))

    def set_dashboard_share(
        self,
        id: str,
        principal: Mapping[str, str],
        role: str,
        if_match: str,
        idempotency_key: str | None = None,
    ):
        return self._json(
            "PUT",
            _dashboard_share_path(id, principal),
            _analysis_headers(if_match, idempotency_key),
            {"role": role},
        )

    def delete_dashboard_share(
        self, id: str, principal: Mapping[str, str], idempotency_key: str | None = None
    ):
        return self._json(
            "DELETE",
            _dashboard_share_path(id, principal),
            _mutation_headers(idempotency_key),
        )

    def query_dashboard_visual(
        self,
        id: str,
        version: int,
        visual_id: str,
        body: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "POST",
            f"{_dashboard_version_path(id, version)}/visuals/{_encode(visual_id)}/query",
            _mutation_headers(idempotency_key),
            {} if body is None else body,
        )

    def create_dashboard_export(
        self,
        id: str,
        body: Mapping[str, Any],
        idempotency_key: str | None = None,
    ) -> DashboardExportArtifact:
        response = self._respond(
            "POST",
            f"{_dashboard_path(id)}/exports",
            _mutation_headers(idempotency_key),
            body,
        )
        return DashboardExportArtifact(
            bytes=response.body,
            content_type=response.headers.get("content-type", "application/octet-stream"),
            content_disposition=response.headers.get("content-disposition"),
            etag=response.headers.get("etag"),
        )

    # ---- assets and folders ----

    def list_assets(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/assets", _page_headers(limit, cursor))

    def list_analyses_summary(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/assets/analyses", _page_headers(limit, cursor))

    def list_dashboards_summary(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/assets/dashboards", _page_headers(limit, cursor))

    def list_datasets_summary(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/assets/datasets", _page_headers(limit, cursor))

    def search_assets(
        self,
        body: Mapping[str, Any],
        limit: int | None = None,
        cursor: str | None = None,
    ):
        return self._json("POST", "/v1/assets/search", _page_headers(limit, cursor), body)

    def move_asset(
        self,
        kind: str,
        id: str,
        body: Mapping[str, Any],
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "POST",
            f"/v1/assets/{_encode(kind)}/{_encode(id)}/move",
            _mutation_headers(idempotency_key),
            body,
        )

    def copy_asset(
        self,
        kind: str,
        id: str,
        body: Mapping[str, Any],
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "POST",
            f"/v1/assets/{_encode(kind)}/{_encode(id)}/copy",
            _mutation_headers(idempotency_key),
            body,
        )

    def get_asset_share(self, kind: str, id: str, principal: Mapping[str, str]) -> VersionedResult:
        return self._versioned_json("GET", _asset_share_path(kind, id, principal))

    def set_asset_share(
        self,
        kind: str,
        id: str,
        principal: Mapping[str, str],
        role: str,
        if_match: str,
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT",
            _asset_share_path(kind, id, principal),
            _analysis_headers(if_match, idempotency_key),
            {"role": role},
        )

    def delete_asset_share(
        self,
        kind: str,
        id: str,
        principal: Mapping[str, str],
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "DELETE",
            _asset_share_path(kind, id, principal),
            _mutation_headers(idempotency_key),
        )

    def delete_asset(self, kind: str, id: str, if_match: str, idempotency_key: str | None = None):
        return self._json(
            "DELETE",
            f"/v1/{_encode(kind)}/{_encode(id)}",
            _analysis_headers(if_match, idempotency_key),
        )

    def list_folders(self, limit: int | None = None, cursor: str | None = None):
        return self._json("GET", "/v1/folders", _page_headers(limit, cursor))

    def get_folder(self, id: str) -> VersionedResult:
        return self._versioned_json("GET", f"/v1/folders/{_encode(id)}")

    def list_folder_assets(self, id: str, limit: int | None = None, cursor: str | None = None):
        return self._json(
            "GET", f"/v1/folders/{_encode(id)}/assets", _page_headers(limit, cursor)
        )

    def rename_folder(
        self,
        id: str,
        body: Mapping[str, Any],
        if_match: str,
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT",
            f"/v1/folders/{_encode(id)}",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    def delete_folder(self, id: str, idempotency_key: str | None = None):
        return self._json(
            "DELETE", f"/v1/folders/{_encode(id)}", _mutation_headers(idempotency_key)
        )

    def get_folder_permissions(self, id: str) -> VersionedResult:
        return self._versioned_json(
            "GET", f"/v1/folders/{_encode(id)}/permissions"
        )

    def set_folder_permissions(
        self,
        id: str,
        body: Mapping[str, Any],
        if_match: str,
        idempotency_key: str | None = None,
    ) -> VersionedResult:
        return self._versioned_json(
            "PUT",
            f"/v1/folders/{_encode(id)}/permissions",
            _analysis_headers(if_match, idempotency_key),
            body,
        )

    # ---- transport ----

    def _json(
        self,
        method: str,
        path: str,
        headers: dict[str, str] | None = None,
        body: Mapping[str, Any] | None = None,
    ) -> Any:
        return self._versioned_json(method, path, headers, body).value

    def _versioned_json(
        self,
        method: str,
        path: str,
        headers: dict[str, str] | None = None,
        body: Mapping[str, Any] | None = None,
    ) -> VersionedResult:
        response = self._respond(method, path, headers, body)
        return VersionedResult(value=_safe_json(response.body), etag=response.headers.get("etag"))

    def _respond(
        self,
        method: str,
        path: str,
        headers: dict[str, str] | None,
        body: Mapping[str, Any] | None,
    ) -> HttpResponse:
        token = self._get_token()
        request_headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
        request_headers.update(headers or {})
        body_bytes: bytes | None = None
        if body is not None:
            request_headers["Content-Type"] = "application/json"
            body_bytes = json.dumps(body).encode("utf-8")
        response = self._transport(
            method, f"{self._base_url}{path}", request_headers, body_bytes
        )
        if not 200 <= response.status < 300:
            error_body = _safe_json(response.body)
            if not isinstance(error_body, dict):
                error_body = None
            error_code = (
                error_body.get("errorCode")
                if isinstance(error_body, dict) and error_body.get("errorCode")
                else f"HTTP_{response.status}"
            )
            message = (
                error_body.get("message")
                if isinstance(error_body, dict) and error_body.get("message")
                else f"{method} {path} failed with status {response.status}"
            )
            raise OpenSightApiError(
                error_code=error_code,
                message=message,
                status=response.status,
                body=error_body if isinstance(error_body, dict) else {"errorCode": error_code},
                retry_after=_parse_retry_after(response.headers.get("retry-after")),
            )
        return response


def _analysis_path(id: str) -> str:
    return f"/v1/analyses/{_encode(id)}"


def _sheet_path(id: str, sheet_id: str) -> str:
    return f"{_analysis_path(id)}/sheets/{_encode(sheet_id)}"


def _dashboard_path(id: str) -> str:
    return f"/v1/dashboards/{_encode(id)}"


def _dashboard_version_path(id: str, version: int) -> str:
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise TypeError("version must be a positive integer")
    return f"{_dashboard_path(id)}/versions/{version}"


def _dashboard_share_path(id: str, principal: Mapping[str, str]) -> str:
    return (
        f"{_dashboard_path(id)}/shares/"
        f"{_encode(principal['type'])}/{_encode(principal['id'])}"
    )


def _asset_share_path(kind: str, id: str, principal: Mapping[str, str]) -> str:
    return (
        f"/v1/{_encode(kind)}/{_encode(id)}/shares/"
        f"{_encode(principal['type'])}/{_encode(principal['id'])}"
    )

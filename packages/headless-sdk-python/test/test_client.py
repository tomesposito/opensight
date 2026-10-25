"""Mock-transport tests for OpenSightClient (issue #95).

Mirrors ``packages/headless-sdk/test/client.test.mjs`` case for case so
the Python SDK keeps the same conventions as the TypeScript SDK: named
``errorCode`` errors, ``Limit``/``Cursor`` headers (the hosted plane
rejects query strings), ``Idempotency-Key`` on mutations, ``If-Match``
on deletes and analysis edits, URL-encoded path segments, and
ETag-preserving versioned transport.
"""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from opensight_headless import HttpResponse, OpenSightApiError, OpenSightClient


def _json_ok(body, headers=None):
    return {"status": 200, "body": body, "headers": headers or {}}


class MockTransport:
    """Records calls and returns canned responses."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append(
            {"method": method, "url": url, "headers": dict(headers), "body": body}
        )
        key = f"{method} {urlsplit(url).path}"
        route = self.routes.get(key)
        if route is None:
            raise AssertionError(f"unexpected request: {key}")
        return HttpResponse(
            status=route.get("status", 200),
            headers={k.lower(): v for k, v in route.get("headers", {}).items()},
            body=json.dumps(route.get("body")).encode("utf-8"),
        )


class TransportConventionsTest(unittest.TestCase):
    def test_strips_trailing_slashes_and_sends_bearer_token(self):
        transport = MockTransport(
            {"GET /api/v1/datasets": _json_ok({"items": [], "nextCursor": None})}
        )
        client = OpenSightClient(
            base_url="https://host/api///", get_token="tok-1", transport=transport
        )
        page = client.list_datasets()
        self.assertEqual(page, {"items": [], "nextCursor": None})
        call = transport.calls[0]
        self.assertEqual(call["url"], "https://host/api/v1/datasets")
        self.assertEqual(call["headers"]["Authorization"], "Bearer tok-1")

    def test_supports_callable_get_token(self):
        transport = MockTransport(
            {"GET /api/v1/sources": _json_ok({"items": [], "nextCursor": None})}
        )
        client = OpenSightClient(
            base_url="https://host/api",
            get_token=lambda: "tok-2",
            transport=transport,
        )
        client.list_sources()
        self.assertEqual(
            transport.calls[0]["headers"]["Authorization"], "Bearer tok-2"
        )

    def test_requires_base_url(self):
        with self.assertRaises(TypeError):
            OpenSightClient(base_url="", get_token="x")
        with self.assertRaises(TypeError):
            OpenSightClient(base_url=None, get_token="x")

    def test_rejects_non_string_non_callable_get_token(self):
        with self.assertRaises(TypeError):
            OpenSightClient(base_url="https://h/api", get_token=42)

    def test_no_query_string_is_ever_sent(self):
        transport = MockTransport(
            {"GET /api/v1/datasets": _json_ok({"items": [], "nextCursor": None})}
        )
        client = OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        )
        client.list_datasets(limit=10, cursor="c")
        self.assertEqual(urlsplit(transport.calls[0]["url"]).query, "")


class PaginationHeadersTest(unittest.TestCase):
    def test_sends_limit_cursor_headers_when_provided_omits_otherwise(self):
        transport = MockTransport(
            {"GET /api/v1/datasets": _json_ok({"items": [], "nextCursor": "abc"})}
        )
        client = OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        )
        client.list_datasets(limit=50, cursor="prev")
        self.assertEqual(transport.calls[0]["headers"]["Limit"], "50")
        self.assertEqual(transport.calls[0]["headers"]["Cursor"], "prev")

        transport2 = MockTransport(
            {"GET /api/v1/datasets": _json_ok({"items": [], "nextCursor": None})}
        )
        client2 = OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport2
        )
        client2.list_datasets()
        self.assertNotIn("Limit", transport2.calls[0]["headers"])
        self.assertNotIn("Cursor", transport2.calls[0]["headers"])


class DatasetsTest(unittest.TestCase):
    def _client(self, routes):
        transport = MockTransport(routes)
        return OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        ), transport

    def test_get_dataset_hits_describe_route(self):
        body = {
            "id": "d1",
            "name": "Sales",
            "version": 3,
            "execution": {"mode": "BLAZE", "intervalMinutes": 60},
            "schema": {"columns": [{"name": "region", "type": "STRING"}]},
            "lineage": {"sources": [{"id": "s1"}], "datasets": [], "steps": 1},
            "refresh": {"supported": True, "mode": "BLAZE", "intervalMinutes": 60},
        }
        client, transport = self._client(
            {"GET /api/v1/datasets/d1": _json_ok(body)}
        )
        self.assertEqual(client.get_dataset("d1"), body)
        self.assertEqual(transport.calls[0]["method"], "GET")

    def test_save_dataset_puts_body_with_idempotency_key(self):
        client, transport = self._client(
            {
                "PUT /api/v1/datasets/d1": _json_ok(
                    {
                        "id": "d1",
                        "name": "S",
                        "version": 4,
                        "execution": {"mode": "DIRECT_QUERY"},
                    }
                )
            }
        )
        body = {"name": "S", "pipeline": {"version": 1, "steps": []}, "expectedVersion": 3}
        out = client.save_dataset("d1", body, idempotency_key="key-1")
        call = transport.calls[0]
        self.assertEqual(call["method"], "PUT")
        self.assertEqual(call["headers"]["Idempotency-Key"], "key-1")
        self.assertEqual(call["headers"]["Content-Type"], "application/json")
        self.assertEqual(json.loads(call["body"]), body)
        self.assertEqual(out["version"], 4)

    def test_delete_dataset_sends_if_match(self):
        client, transport = self._client(
            {"DELETE /api/v1/datasets/d1": _json_ok({"id": "d1", "removed": True})}
        )
        out = client.delete_dataset("d1", '"3"')
        self.assertEqual(out, {"id": "d1", "removed": True})
        self.assertEqual(transport.calls[0]["headers"]["If-Match"], '"3"')

    def test_get_dataset_lineage(self):
        body = {
            "dataset": {"id": "d1", "name": "Sales", "version": 3},
            "steps": [{"id": "st1", "kind": "select", "name": None, "from": None}],
            "sources": [{"id": "s1", "available": True}],
            "datasets": [],
            "refresh": {"mode": "BLAZE", "intervalMinutes": 60, "supported": True},
        }
        client, _ = self._client({"GET /api/v1/datasets/d1/lineage": _json_ok(body)})
        self.assertEqual(client.get_dataset_lineage("d1"), body)

    def test_refresh_dataset_posts_empty_body_with_idempotency_key(self):
        client, transport = self._client(
            {
                "POST /api/v1/datasets/d1/refresh": _json_ok(
                    {
                        "datasetId": "d1",
                        "refreshed": True,
                        "mode": "BLAZE",
                        "state": "READY",
                    }
                )
            }
        )
        out = client.refresh_dataset("d1", idempotency_key="r1")
        call = transport.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(json.loads(call["body"]), {})
        self.assertEqual(call["headers"]["Idempotency-Key"], "r1")
        self.assertTrue(out["refreshed"])

    def test_get_refresh_status(self):
        body = {
            "datasetId": "d1",
            "version": 3,
            "mode": "BLAZE",
            "intervalMinutes": 60,
            "supported": True,
        }
        client, _ = self._client(
            {"GET /api/v1/datasets/d1/refresh-status": _json_ok(body)}
        )
        self.assertEqual(client.get_refresh_status("d1"), body)


class QueryingTest(unittest.TestCase):
    def test_query_dataset_posts_interactive_query(self):
        result = {
            "columns": [
                {"name": "region", "type": "string"},
                {"name": "total", "type": "number"},
            ],
            "rows": [{"region": "east", "total": 40}],
            "execution": {"mode": "BLAZE", "cached": True},
        }
        transport = MockTransport(
            {"POST /api/v1/datasets/d1/query": _json_ok(result)}
        )
        client = OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        )
        query = {
            "dimensions": [{"fieldId": "region", "columnName": "region"}],
            "measures": [{"fieldId": "total", "columnName": "amount", "aggregation": "SUM"}],
            "filters": [{"columnName": "region", "parameterName": "Region"}],
            "parameterDeclarations": [
                {"name": "Region", "type": "string", "multiple": False}
            ],
            "parameterBindings": {"Region": ["east"]},
        }
        out = client.query_dataset("d1", query, idempotency_key="q1")
        call = transport.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["url"], "https://h/api/v1/datasets/d1/query")
        self.assertEqual(call["headers"]["Idempotency-Key"], "q1")
        self.assertEqual(json.loads(call["body"]), query)
        self.assertEqual(out, result)


class SourcesTest(unittest.TestCase):
    def test_list_sources_and_get_source(self):
        listed = {"items": [{"id": "s1", "available": True}], "nextCursor": None}
        one = {
            "id": "s1",
            "version": 2,
            "connectorId": "postgres",
            "columns": [{"name": "id", "type": "INTEGER"}],
        }
        transport = MockTransport(
            {
                "GET /api/v1/sources": _json_ok(listed),
                "GET /api/v1/sources/s1": _json_ok(one),
            }
        )
        client = OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        )
        self.assertEqual(client.list_sources(), listed)
        self.assertEqual(client.get_source("s1"), one)

    def test_delete_source_sends_if_match(self):
        transport = MockTransport(
            {
                "DELETE /api/v1/sources/s1": _json_ok(
                    {"id": "s1", "retired": True, "version": 2}
                )
            }
        )
        client = OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        )
        out = client.delete_source("s1", '"2"')
        self.assertEqual(out, {"id": "s1", "retired": True, "version": 2})
        self.assertEqual(transport.calls[0]["headers"]["If-Match"], '"2"')


class NamedErrorsTest(unittest.TestCase):
    def _client(self, transport):
        return OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        )

    def test_surfaces_error_code_status_and_retry_after_from_429(self):
        transport = MockTransport(
            {
                "GET /api/v1/datasets": {
                    "status": 429,
                    "body": {
                        "errorCode": "RATE_LIMIT_EXCEEDED",
                        "message": "slow down",
                    },
                    "headers": {"Retry-After": "7"},
                }
            }
        )
        client = self._client(transport)
        with self.assertRaises(OpenSightApiError) as ctx:
            client.list_datasets()
        err = ctx.exception
        self.assertEqual(err.error_code, "RATE_LIMIT_EXCEEDED")
        self.assertEqual(err.status, 429)
        self.assertEqual(err.retry_after, 7)
        self.assertEqual(str(err), "slow down")

    def test_surfaces_fail_closed_codes(self):
        transport = MockTransport(
            {
                "DELETE /api/v1/sources/s1": {
                    "status": 409,
                    "body": {
                        "errorCode": "SOURCE_DELETE_BLOCKED_BY_DATASET",
                        "message": "still referenced",
                    },
                }
            }
        )
        client = self._client(transport)
        with self.assertRaises(OpenSightApiError) as ctx:
            client.delete_source("s1", '"2"')
        err = ctx.exception
        self.assertEqual(err.error_code, "SOURCE_DELETE_BLOCKED_BY_DATASET")
        self.assertEqual(err.status, 409)
        self.assertIsNone(err.retry_after)

    def test_falls_back_to_http_status_when_body_is_not_json(self):
        def bad_transport(method, url, headers, body):
            return HttpResponse(status=500, headers={}, body=b"not json")

        client = self._client(bad_transport)
        with self.assertRaises(OpenSightApiError) as ctx:
            client.get_dataset("d1")
        err = ctx.exception
        self.assertEqual(err.error_code, "HTTP_500")
        self.assertEqual(err.status, 500)

    def test_retains_named_validation_errors_and_paths(self):
        body = {
            "errorCode": "CALCULATED_FIELD_INVALID",
            "message": "Invalid expression",
            "path": "$.definition.calculatedFields[0].expression",
        }
        transport = MockTransport(
            {"PUT /api/v1/analyses/a/calculated-fields": {"status": 400, "body": body}}
        )
        client = self._client(transport)
        with self.assertRaises(OpenSightApiError) as ctx:
            client.set_calculated_fields("a", [], '"2"')
        err = ctx.exception
        self.assertIsInstance(err, OpenSightApiError)
        self.assertEqual(err.status, 400)
        self.assertEqual(err.error_code, body["errorCode"])
        self.assertEqual(err.body, body)


class AnalysesTest(unittest.TestCase):
    ENVELOPE = {
        "AnalysisId": "a",
        "Name": "Analysis",
        "Definition": {"Sheets": []},
        "Errors": [],
    }

    def _client(self, routes):
        transport = MockTransport(routes)
        return OpenSightClient(
            base_url="https://h/api", get_token="t", transport=transport
        ), transport

    def test_list_and_get_analysis_expose_etag_separately(self):
        page = {
            "items": [{"kind": "analysis", "id": "a", "name": "Analysis"}],
            "nextCursor": "next",
        }
        client, transport = self._client(
            {
                "GET /api/v1/analyses": _json_ok(page),
                "GET /api/v1/analyses/a": _json_ok(
                    self.ENVELOPE, {"ETag": '"2"'}
                ),
            }
        )
        self.assertEqual(client.list_analyses(limit=2, cursor="cursor"), page)
        self.assertEqual(transport.calls[0]["headers"]["Limit"], "2")
        self.assertEqual(transport.calls[0]["headers"]["Cursor"], "cursor")
        self.assertEqual(urlsplit(transport.calls[0]["url"]).query, "")
        got = client.get_analysis("a")
        self.assertEqual(got.value, self.ENVELOPE)
        self.assertEqual(got.etag, '"2"')

    def test_mutation_matrix_sends_bodies_retry_keys_and_preconditions(self):
        update = {
            "name": "Analysis",
            "definition": {"dataSetIdentifierDeclarations": [], "sheets": []},
            "datasetBindings": {},
        }
        create = {"analysisId": "a", **update}
        visual = {"barChartVisual": {"visualId": "v"}}
        group = {"filterGroupId": "g", "filters": []}
        cases = [
            ("POST", "/analyses", "create_analysis", (create, "retry-key"), create),
            ("PUT", "/analyses/a", "update_analysis", ("a", update, '"2"', "retry-key"), update),
            ("POST", "/analyses/a/sheets/s/visuals", "add_visual", ("a", "s", visual, '"2"', "retry-key"), visual),
            ("PUT", "/analyses/a/sheets/s/visuals/v", "update_visual", ("a", "s", "v", visual, '"2"', "retry-key"), visual),
            ("DELETE", "/analyses/a/sheets/s/visuals/v", "remove_visual", ("a", "s", "v", '"2"', "retry-key"), None),
            ("PUT", "/analyses/a/sheets/s/layouts", "set_layouts", ("a", "s", [], '"2"', "retry-key"), []),
            ("POST", "/analyses/a/filter-groups", "add_filter_group", ("a", group, '"2"', "retry-key"), group),
            ("PUT", "/analyses/a/filter-groups/g", "update_filter_group", ("a", "g", group, '"2"', "retry-key"), group),
            ("DELETE", "/analyses/a/filter-groups/g", "remove_filter_group", ("a", "g", '"2"', "retry-key"), None),
            ("PUT", "/analyses/a/calculated-fields", "set_calculated_fields", ("a", [], '"2"', "retry-key"), []),
            ("DELETE", "/analyses/a", "delete_analysis", ("a", '"2"', "retry-key"), None),
        ]
        removed = {"id": "a", "removed": True}
        for method, path, member, args, body in cases:
            with self.subTest(member=member):
                expected = removed if member == "delete_analysis" else self.ENVELOPE
                transport = MockTransport(
                    {f"{method} /api/v1{path}": _json_ok(expected, {"ETag": '"3"'})}
                )
                client = OpenSightClient(
                    base_url="https://h/api", get_token="t", transport=transport
                )
                out = getattr(client, member)(*args)
                expected_out = (
                    removed
                    if member == "delete_analysis"
                    else {"value": self.ENVELOPE, "etag": '"3"'}
                )
                if member != "delete_analysis":
                    self.assertEqual(out.value, self.ENVELOPE, member)
                    self.assertEqual(out.etag, '"3"', member)
                else:
                    self.assertEqual(out, expected_out, member)
                call = transport.calls[0]
                self.assertEqual(call["headers"]["Idempotency-Key"], "retry-key", member)
                self.assertEqual(
                    call["headers"].get("If-Match"),
                    None if member == "create_analysis" else '"2"',
                    member,
                )
                self.assertEqual(call["headers"]["Authorization"], "Bearer t", member)
                sent = None if call["body"] is None else json.loads(call["body"])
                self.assertEqual(sent, body, member)
                self.assertEqual(
                    call["headers"].get("Content-Type"),
                    None if body is None else "application/json",
                    member,
                )

    def test_encodes_path_identities_without_query_params_or_nested_paths(self):
        client, transport = self._client(
            {
                "PUT /api/v1/analyses/a%3F/sheets/s%2F/visuals/v%23": _json_ok(
                    self.ENVELOPE, {"ETag": '"3"'}
                ),
                "DELETE /api/v1/analyses/a%3F/filter-groups/g%2F": _json_ok(
                    self.ENVELOPE, {"ETag": '"4"'}
                ),
            }
        )
        client.update_visual(
            "a?", "s/", "v#", {"barChartVisual": {"visualId": "v#"}}, '"2"'
        )
        client.remove_filter_group("a?", "g/", '"2"')
        for call in transport.calls:
            self.assertEqual(urlsplit(call["url"]).query, "")


class DashboardOperationsTest(unittest.TestCase):
    def test_maps_verbs_etags_and_headers(self):
        calls = []

        def transport(method, url, headers, body):
            calls.append(
                {"method": method, "url": url, "headers": dict(headers), "body": body}
            )
            return HttpResponse(
                status=200,
                headers={"etag": '"3"'},
                body=json.dumps({"ok": True}).encode("utf-8"),
            )

        client = OpenSightClient(
            base_url="https://h/api", get_token="token", transport=transport
        )
        mutation = {"if_match": '"3"', "idempotency_key": "retry"}
        principal = {"type": "group", "id": "team"}
        self.assertEqual(
            client.publish_analysis(
                "a", {"dashboardId": "d"}, idempotency_key="retry"
            ).etag,
            '"3"',
        )
        client.list_dashboards(limit=2, cursor="page")
        client.get_dashboard("d")
        client.list_dashboard_versions("d", limit=1)
        client.get_dashboard_version("d", 2)
        client.delete_dashboard("d", **mutation)
        client.delete_dashboard_version("d", 2, **mutation)
        client.get_dashboard_share("d", principal)
        client.set_dashboard_share("d", principal, "viewer", **mutation)
        client.delete_dashboard_share("d", principal, idempotency_key="retry")
        client.query_dashboard_visual(
            "d", 2, "v", {"controlValues": {"scale": [2]}}, idempotency_key="retry"
        )
        self.assertEqual(
            [(c["method"], urlsplit(c["url"]).path) for c in calls],
            [
                ("POST", "/api/v1/analyses/a/publish"),
                ("GET", "/api/v1/dashboards"),
                ("GET", "/api/v1/dashboards/d"),
                ("GET", "/api/v1/dashboards/d/versions"),
                ("GET", "/api/v1/dashboards/d/versions/2"),
                ("DELETE", "/api/v1/dashboards/d"),
                ("DELETE", "/api/v1/dashboards/d/versions/2"),
                ("GET", "/api/v1/dashboards/d/shares/group/team"),
                ("PUT", "/api/v1/dashboards/d/shares/group/team"),
                ("DELETE", "/api/v1/dashboards/d/shares/group/team"),
                ("POST", "/api/v1/dashboards/d/versions/2/visuals/v/query"),
            ],
        )
        self.assertEqual(calls[1]["headers"]["Limit"], "2")
        self.assertEqual(calls[1]["headers"]["Cursor"], "page")
        for c in [c for c in calls if c["method"] != "GET"]:
            self.assertEqual(c["headers"]["Idempotency-Key"], "retry")
        for c in calls[5:7]:
            self.assertEqual(c["headers"]["If-Match"], '"3"')
        self.assertEqual(json.loads(calls[-1]["body"]), {"controlValues": {"scale": [2]}})
        with self.assertRaises(TypeError):
            client.get_dashboard_version("d", 1.5)
        with self.assertRaises(TypeError):
            client.get_dashboard_version("d", 0)

    def test_export_returns_bytes_and_preserves_errors(self):
        calls = []

        def transport(method, url, headers, body):
            self.assertEqual(urlsplit(url).path, "/api/v1/dashboards/d/exports")
            self.assertEqual(headers["Idempotency-Key"], "export")
            calls.append(1)
            if len(calls) == 1:
                return HttpResponse(
                    status=200,
                    headers={
                        "content-type": "application/pdf",
                        "etag": '"2"',
                        "content-disposition": 'attachment; filename="d.pdf"',
                    },
                    body=b"%PDF-test",
                )
            return HttpResponse(
                status=429,
                headers={"retry-after": "4"},
                body=json.dumps(
                    {
                        "errorCode": "RATE_LIMIT_EXCEEDED",
                        "Errors": [
                            {"errorCode": "x", "path": "$", "message": "diagnostic"}
                        ],
                    }
                ).encode("utf-8"),
            )

        client = OpenSightClient(
            base_url="https://h/api", get_token="token", transport=transport
        )
        artifact = client.create_dashboard_export(
            "d", {"version": 2, "format": "pdf"}, idempotency_key="export"
        )
        self.assertEqual(artifact.bytes, b"%PDF-test")
        self.assertEqual(artifact.etag, '"2"')
        self.assertEqual(artifact.content_type, "application/pdf")
        self.assertEqual(
            artifact.content_disposition, 'attachment; filename="d.pdf"'
        )
        with self.assertRaises(OpenSightApiError) as ctx:
            client.create_dashboard_export(
                "d", {"format": "csv"}, idempotency_key="export"
            )
        err = ctx.exception
        self.assertIsInstance(err, OpenSightApiError)
        self.assertEqual(err.error_code, "RATE_LIMIT_EXCEEDED")
        self.assertEqual(err.status, 429)
        self.assertEqual(err.retry_after, 4)
        self.assertEqual(len(err.body["Errors"]), 1)


class AssetsAndFoldersTest(unittest.TestCase):
    def test_maps_every_asset_verb_casing_etags_pagination_and_retry_headers(self):
        calls = []

        def transport(method, url, headers, body):
            calls.append(
                {"method": method, "url": url, "headers": dict(headers), "body": body}
            )
            return HttpResponse(
                status=200,
                headers={"etag": '"4"'},
                body=json.dumps({"Id": "id"}).encode("utf-8"),
            )

        client = OpenSightClient(
            base_url="https://h/api", get_token="token", transport=transport
        )
        page = {"limit": 2, "cursor": "page"}
        update = {"if_match": '"3"', "idempotency_key": "retry"}
        principal = {"type": "user", "id": "member"}
        client.list_assets(**page)
        client.list_analyses_summary(**page)
        client.list_dashboards_summary(**page)
        client.list_datasets_summary(**page)
        client.search_assets({"query": "Sales", "kinds": ["analyses"]}, **page)
        self.assertEqual(
            client.move_asset(
                "analyses", "id", {"folderId": None}, idempotency_key="retry"
            ).etag,
            '"4"',
        )
        client.copy_asset(
            "dashboards", "id", {"newId": "copy"}, idempotency_key="retry"
        )
        client.get_asset_share("analyses", "id", principal)
        client.set_asset_share("analyses", "id", principal, "viewer", **update)
        client.delete_asset_share("analyses", "id", principal, idempotency_key="retry")
        client.delete_asset("datasets", "id", **update)
        client.rename_folder("f", {"name": "Name"}, **update)
        client.delete_folder("f", idempotency_key="retry")
        client.list_folders(**page)
        client.get_folder("f")
        client.list_folder_assets("f", **page)
        client.get_folder_permissions("f")
        client.set_folder_permissions(
            "f", {"grants": [{"principal": principal, "role": "co-owner"}]}, **update
        )
        self.assertEqual(
            [(c["method"], urlsplit(c["url"]).path) for c in calls],
            [
                ("GET", "/api/v1/assets"),
                ("GET", "/api/v1/assets/analyses"),
                ("GET", "/api/v1/assets/dashboards"),
                ("GET", "/api/v1/assets/datasets"),
                ("POST", "/api/v1/assets/search"),
                ("POST", "/api/v1/assets/analyses/id/move"),
                ("POST", "/api/v1/assets/dashboards/id/copy"),
                ("GET", "/api/v1/analyses/id/shares/user/member"),
                ("PUT", "/api/v1/analyses/id/shares/user/member"),
                ("DELETE", "/api/v1/analyses/id/shares/user/member"),
                ("DELETE", "/api/v1/datasets/id"),
                ("PUT", "/api/v1/folders/f"),
                ("DELETE", "/api/v1/folders/f"),
                ("GET", "/api/v1/folders"),
                ("GET", "/api/v1/folders/f"),
                ("GET", "/api/v1/folders/f/assets"),
                ("GET", "/api/v1/folders/f/permissions"),
                ("PUT", "/api/v1/folders/f/permissions"),
            ],
        )
        for i in [0, 1, 2, 3, 4, 13, 15]:
            self.assertEqual(calls[i]["headers"]["Limit"], "2")
            self.assertEqual(calls[i]["headers"]["Cursor"], "page")
        for i in [5, 6, 8, 9, 10, 11, 12, 17]:
            self.assertEqual(calls[i]["headers"]["Idempotency-Key"], "retry")
        for i in [8, 10, 11, 17]:
            self.assertEqual(calls[i]["headers"]["If-Match"], '"3"')
        self.assertEqual(json.loads(calls[8]["body"]), {"role": "viewer"})
        self.assertEqual(
            json.loads(calls[17]["body"]),
            {"grants": [{"principal": principal, "role": "co-owner"}]},
        )


class _RecordingHandler(BaseHTTPRequestHandler):
    """HTTP handler driven by the owning server's ``routes`` table.

    Each entry maps a path to ``(status, headers, body_bytes)``. Every
    request is appended to ``server.hits`` so tests can prove a redirect
    target was never contacted.
    """

    def _handle(self):
        self.server.hits.append(
            {"method": self.command, "path": self.path, "headers": dict(self.headers)}
        )
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        status, headers, body = self.server.routes.get(
            self.path, (404, {}, b'{"errorCode": "NOT_FOUND", "message": "nope"}')
        )
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle

    def log_message(self, *args):  # keep test output quiet
        pass


class DefaultTransportRedirectTest(unittest.TestCase):
    """Issue #118: the REAL default (urllib) transport — no injected
    transport — must reject redirects instead of forwarding the bearer
    token to the redirect destination."""

    def _start_server(self, routes):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingHandler)
        server.routes = routes
        server.hits = []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return server

    @staticmethod
    def _base(server):
        return f"http://127.0.0.1:{server.server_address[1]}/api"

    def test_default_transport_rejects_cross_origin_redirect_and_never_contacts_target(self):
        target = self._start_server(
            {"/stolen": (200, {"Content-Type": "application/json"}, b'{"items": []}')}
        )
        target_url = f"http://127.0.0.1:{target.server_address[1]}/stolen"
        for code in (301, 302, 303, 307, 308):
            with self.subTest(code=code):
                origin = self._start_server(
                    {"/api/v1/datasets": (code, {"Location": target_url}, b"")}
                )
                client = OpenSightClient(
                    base_url=self._base(origin), get_token="secret-token"
                )
                with self.assertRaises(OpenSightApiError) as ctx:
                    client.list_datasets()
                self.assertEqual(ctx.exception.status, code)
                # The origin was hit once, with the token; the redirect
                # target was never contacted at all.
                self.assertEqual(len(origin.hits), 1)
                self.assertEqual(
                    origin.hits[0]["headers"].get("Authorization"),
                    "Bearer secret-token",
                )
                self.assertEqual(target.hits, [])

    def test_default_transport_rejects_same_origin_redirect(self):
        origin = self._start_server(
            {
                "/api/v1/datasets": (302, {"Location": "/api/v1/sources"}, b""),
                "/api/v1/sources": (
                    200,
                    {"Content-Type": "application/json"},
                    b'{"items": [], "nextCursor": null}',
                ),
            }
        )
        client = OpenSightClient(base_url=self._base(origin), get_token="secret-token")
        with self.assertRaises(OpenSightApiError) as ctx:
            client.list_datasets()
        self.assertEqual(ctx.exception.status, 302)
        self.assertEqual([h["path"] for h in origin.hits], ["/api/v1/datasets"])

    def test_default_transport_rejects_redirect_on_post(self):
        target = self._start_server({"/stolen": (200, {}, b"{}")})
        target_url = f"http://127.0.0.1:{target.server_address[1]}/stolen"
        origin = self._start_server(
            {"/api/v1/datasets/ds1/query": (307, {"Location": target_url}, b"")}
        )
        client = OpenSightClient(base_url=self._base(origin), get_token="secret-token")
        with self.assertRaises(OpenSightApiError) as ctx:
            client.query_dataset("ds1", {"fields": []})
        self.assertEqual(ctx.exception.status, 307)
        self.assertEqual(target.hits, [])

    def test_default_transport_still_serves_direct_200(self):
        origin = self._start_server(
            {
                "/api/v1/datasets": (
                    200,
                    {"Content-Type": "application/json"},
                    b'{"items": [], "nextCursor": null}',
                )
            }
        )
        client = OpenSightClient(base_url=self._base(origin), get_token="secret-token")
        self.assertEqual(client.list_datasets(), {"items": [], "nextCursor": None})
        self.assertEqual(len(origin.hits), 1)


if __name__ == "__main__":
    unittest.main()

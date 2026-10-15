"""The Python SDK must map 1:1 onto the implemented v1 OpenAPI surface:
every path+method in docs/api/openapi-v1.yaml is covered by a client
method, and no client method invents a path that is not in the spec.
(Issue #95: the loop may draft, but never invent, API surface.)

Mirrors ``packages/headless-sdk/test/openapi-coverage.test.mjs`` for the
TypeScript SDK; route parsing uses the same line-based rules (the
spec is YAML but the paths section has a stable indentation shape).
"""

import re
import unittest
from pathlib import Path

from opensight_headless import OpenSightClient

REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC_PATH = REPO_ROOT / "docs" / "api" / "openapi-v1.yaml"


def spec_routes():
    routes = []
    current_path = None
    for line in SPEC_PATH.read_text(encoding="utf-8").splitlines():
        if line == "components:":
            break
        path_match = re.match(r"^  (/[^:]*):$", line)
        if path_match:
            current_path = path_match.group(1)
            continue
        verb_match = re.match(r"^    (get|put|post|delete|patch):$", line)
        if verb_match and current_path:
            routes.append((current_path, verb_match.group(1).upper()))
    return routes


ROUTES = spec_routes()

# The client method that implements each spec route.
COVERAGE = {
    "/assets|GET": "list_assets",
    "/assets/analyses|GET": "list_analyses_summary",
    "/assets/dashboards|GET": "list_dashboards_summary",
    "/assets/datasets|GET": "list_datasets_summary",
    "/assets/search|POST": "search_assets",
    "/assets/{kind}/{id}/move|POST": "move_asset",
    "/assets/{kind}/{id}/copy|POST": "copy_asset",
    "/analyses/{id}/shares/{principalType}/{principalId}|GET": "get_asset_share",
    "/analyses/{id}/shares/{principalType}/{principalId}|PUT": "set_asset_share",
    "/analyses/{id}/shares/{principalType}/{principalId}|DELETE": "delete_asset_share",
    "/folders|GET": "list_folders",
    "/folders/{id}|GET": "get_folder",
    "/folders/{id}|PUT": "rename_folder",
    "/folders/{id}|DELETE": "delete_folder",
    "/folders/{id}/assets|GET": "list_folder_assets",
    "/folders/{id}/permissions|GET": "get_folder_permissions",
    "/folders/{id}/permissions|PUT": "set_folder_permissions",
    "/analyses/{id}/publish|POST": "publish_analysis",
    "/dashboards|GET": "list_dashboards",
    "/dashboards/{id}|GET": "get_dashboard",
    "/dashboards/{id}|DELETE": "delete_dashboard",
    "/dashboards/{id}/versions|GET": "list_dashboard_versions",
    "/dashboards/{id}/versions/{version}|GET": "get_dashboard_version",
    "/dashboards/{id}/versions/{version}|DELETE": "delete_dashboard_version",
    "/dashboards/{id}/shares/{principalType}/{principalId}|GET": "get_dashboard_share",
    "/dashboards/{id}/shares/{principalType}/{principalId}|PUT": "set_dashboard_share",
    "/dashboards/{id}/shares/{principalType}/{principalId}|DELETE": "delete_dashboard_share",
    "/dashboards/{id}/versions/{version}/visuals/{visualId}/query|POST": "query_dashboard_visual",
    "/dashboards/{id}/exports|POST": "create_dashboard_export",
    "/analyses|GET": "list_analyses",
    "/analyses|POST": "create_analysis",
    "/analyses/{id}|GET": "get_analysis",
    "/analyses/{id}|PUT": "update_analysis",
    "/analyses/{id}|DELETE": "delete_analysis",
    "/analyses/{id}/sheets/{sheetId}/visuals|POST": "add_visual",
    "/analyses/{id}/sheets/{sheetId}/visuals/{visualId}|PUT": "update_visual",
    "/analyses/{id}/sheets/{sheetId}/visuals/{visualId}|DELETE": "remove_visual",
    "/analyses/{id}/sheets/{sheetId}/layouts|PUT": "set_layouts",
    "/analyses/{id}/filter-groups|POST": "add_filter_group",
    "/analyses/{id}/filter-groups/{filterGroupId}|PUT": "update_filter_group",
    "/analyses/{id}/filter-groups/{filterGroupId}|DELETE": "remove_filter_group",
    "/analyses/{id}/calculated-fields|PUT": "set_calculated_fields",
    "/datasets|GET": "list_datasets",
    "/datasets/{id}|GET": "get_dataset",
    "/datasets/{id}|PUT": "save_dataset",
    "/datasets/{id}|DELETE": "delete_dataset",
    "/datasets/{id}/lineage|GET": "get_dataset_lineage",
    "/datasets/{id}/query|POST": "query_dataset",
    "/datasets/{id}/refresh|POST": "refresh_dataset",
    "/datasets/{id}/refresh-status|GET": "get_refresh_status",
    "/sources|GET": "list_sources",
    "/sources/{id}|GET": "get_source",
    "/sources/{id}|DELETE": "delete_source",
}


class OpenApiCoverageTest(unittest.TestCase):
    def test_every_spec_route_is_mapped_by_the_client(self):
        self.assertGreater(
            len(ROUTES), 0, "expected to parse routes from openapi-v1.yaml"
        )
        for path, method in ROUTES:
            key = f"{path}|{method}"
            self.assertIn(
                key,
                COVERAGE,
                f"spec route {method} {path} has no SDK method — add it, or the spec moved",
            )

    def test_no_coverage_entry_invents_a_route_not_in_the_spec(self):
        spec_keys = {f"{p}|{m}" for p, m in ROUTES}
        for key in COVERAGE:
            self.assertIn(
                key,
                spec_keys,
                f"coverage entry {key} is not in the spec — the SDK must not invent endpoints",
            )

    def test_every_covered_method_exists_on_open_sight_client(self):
        seen = set()
        for method in COVERAGE.values():
            if method in seen:
                continue
            seen.add(method)
            self.assertTrue(
                callable(getattr(OpenSightClient, method, None)),
                f"OpenSightClient.{method} is missing",
            )


if __name__ == "__main__":
    unittest.main()

// Generated from docs/api/openapi-v1.yaml by mcp-server/scripts/generate.mjs. Do not edit.
export const v1AuditOperations = [
  {
    "operationId": "add_filter_group",
    "method": "POST",
    "path": "/analyses/{id}/filter-groups"
  },
  {
    "operationId": "add_visual",
    "method": "POST",
    "path": "/analyses/{id}/sheets/{sheetId}/visuals"
  },
  {
    "operationId": "ask_question",
    "method": "POST",
    "path": "/ai/ask"
  },
  {
    "operationId": "copy_asset",
    "method": "POST",
    "path": "/assets/{kind}/{id}/copy"
  },
  {
    "operationId": "create_analysis",
    "method": "POST",
    "path": "/analyses"
  },
  {
    "operationId": "create_dashboard_export",
    "method": "POST",
    "path": "/dashboards/{id}/exports"
  },
  {
    "operationId": "delete_analysis",
    "method": "DELETE",
    "path": "/analyses/{id}"
  },
  {
    "operationId": "delete_asset_share",
    "method": "DELETE",
    "path": "/analyses/{id}/shares/{principalType}/{principalId}"
  },
  {
    "operationId": "delete_dashboard",
    "method": "DELETE",
    "path": "/dashboards/{id}"
  },
  {
    "operationId": "delete_dashboard_share",
    "method": "DELETE",
    "path": "/dashboards/{id}/shares/{principalType}/{principalId}"
  },
  {
    "operationId": "delete_dashboard_version",
    "method": "DELETE",
    "path": "/dashboards/{id}/versions/{version}"
  },
  {
    "operationId": "delete_dataset",
    "method": "DELETE",
    "path": "/datasets/{id}"
  },
  {
    "operationId": "delete_folder",
    "method": "DELETE",
    "path": "/folders/{id}"
  },
  {
    "operationId": "delete_source",
    "method": "DELETE",
    "path": "/sources/{id}"
  },
  {
    "operationId": "describe_analysis",
    "method": "GET",
    "path": "/analyses/{id}"
  },
  {
    "operationId": "describe_dashboard",
    "method": "GET",
    "path": "/dashboards/{id}"
  },
  {
    "operationId": "describe_dashboard_version",
    "method": "GET",
    "path": "/dashboards/{id}/versions/{version}"
  },
  {
    "operationId": "describe_dataset",
    "method": "GET",
    "path": "/datasets/{id}"
  },
  {
    "operationId": "describe_dataset_lineage",
    "method": "GET",
    "path": "/datasets/{id}/lineage"
  },
  {
    "operationId": "describe_folder",
    "method": "GET",
    "path": "/folders/{id}"
  },
  {
    "operationId": "describe_metric",
    "method": "GET",
    "path": "/metrics/{id}"
  },
  {
    "operationId": "describe_source",
    "method": "GET",
    "path": "/sources/{id}"
  },
  {
    "operationId": "get_asset_share",
    "method": "GET",
    "path": "/analyses/{id}/shares/{principalType}/{principalId}"
  },
  {
    "operationId": "get_dashboard_share",
    "method": "GET",
    "path": "/dashboards/{id}/shares/{principalType}/{principalId}"
  },
  {
    "operationId": "get_dataset_refresh_status",
    "method": "GET",
    "path": "/datasets/{id}/refresh-status"
  },
  {
    "operationId": "get_folder_permissions",
    "method": "GET",
    "path": "/folders/{id}/permissions"
  },
  {
    "operationId": "list_analyses",
    "method": "GET",
    "path": "/analyses"
  },
  {
    "operationId": "list_analyses_summary",
    "method": "GET",
    "path": "/assets/analyses"
  },
  {
    "operationId": "list_assets",
    "method": "GET",
    "path": "/assets"
  },
  {
    "operationId": "list_dashboard_versions",
    "method": "GET",
    "path": "/dashboards/{id}/versions"
  },
  {
    "operationId": "list_dashboards",
    "method": "GET",
    "path": "/dashboards"
  },
  {
    "operationId": "list_dashboards_summary",
    "method": "GET",
    "path": "/assets/dashboards"
  },
  {
    "operationId": "list_datasets",
    "method": "GET",
    "path": "/datasets"
  },
  {
    "operationId": "list_datasets_summary",
    "method": "GET",
    "path": "/assets/datasets"
  },
  {
    "operationId": "list_folder_assets",
    "method": "GET",
    "path": "/folders/{id}/assets"
  },
  {
    "operationId": "list_folders",
    "method": "GET",
    "path": "/folders"
  },
  {
    "operationId": "list_metric_versions",
    "method": "GET",
    "path": "/metrics/{id}/versions"
  },
  {
    "operationId": "list_metrics",
    "method": "GET",
    "path": "/metrics"
  },
  {
    "operationId": "list_sources",
    "method": "GET",
    "path": "/sources"
  },
  {
    "operationId": "list_workspace_action_history",
    "method": "GET",
    "path": "/workspace/action-history"
  },
  {
    "operationId": "move_asset",
    "method": "POST",
    "path": "/assets/{kind}/{id}/move"
  },
  {
    "operationId": "publish_analysis",
    "method": "POST",
    "path": "/analyses/{id}/publish"
  },
  {
    "operationId": "query_dashboard_visual",
    "method": "POST",
    "path": "/dashboards/{id}/versions/{version}/visuals/{visualId}/query"
  },
  {
    "operationId": "refresh_dataset",
    "method": "POST",
    "path": "/datasets/{id}/refresh"
  },
  {
    "operationId": "remove_filter_group",
    "method": "DELETE",
    "path": "/analyses/{id}/filter-groups/{filterGroupId}"
  },
  {
    "operationId": "remove_visual",
    "method": "DELETE",
    "path": "/analyses/{id}/sheets/{sheetId}/visuals/{visualId}"
  },
  {
    "operationId": "rename_folder",
    "method": "PUT",
    "path": "/folders/{id}"
  },
  {
    "operationId": "run_dataset_query",
    "method": "POST",
    "path": "/datasets/{id}/query"
  },
  {
    "operationId": "search_assets",
    "method": "POST",
    "path": "/assets/search"
  },
  {
    "operationId": "set_asset_share",
    "method": "PUT",
    "path": "/analyses/{id}/shares/{principalType}/{principalId}"
  },
  {
    "operationId": "set_calculated_fields",
    "method": "PUT",
    "path": "/analyses/{id}/calculated-fields"
  },
  {
    "operationId": "set_dashboard_share",
    "method": "PUT",
    "path": "/dashboards/{id}/shares/{principalType}/{principalId}"
  },
  {
    "operationId": "set_folder_permissions",
    "method": "PUT",
    "path": "/folders/{id}/permissions"
  },
  {
    "operationId": "set_layouts",
    "method": "PUT",
    "path": "/analyses/{id}/sheets/{sheetId}/layouts"
  },
  {
    "operationId": "update_analysis",
    "method": "PUT",
    "path": "/analyses/{id}"
  },
  {
    "operationId": "update_dataset",
    "method": "PUT",
    "path": "/datasets/{id}"
  },
  {
    "operationId": "update_filter_group",
    "method": "PUT",
    "path": "/analyses/{id}/filter-groups/{filterGroupId}"
  },
  {
    "operationId": "update_visual",
    "method": "PUT",
    "path": "/analyses/{id}/sheets/{sheetId}/visuals/{visualId}"
  }
] as const;

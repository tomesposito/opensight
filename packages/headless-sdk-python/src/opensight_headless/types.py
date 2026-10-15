"""Wire types for the OpenSight headless v1 API, mirroring
``packages/headless-sdk/src/types.ts`` (itself 1:1 with
``docs/api/openapi-v1.yaml``).

Keys keep the API's wire casing (camelCase writes, PascalCase
descriptions) so values the client returns can be compared directly with
the documented contract.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ColumnType = Literal["INTEGER", "DECIMAL", "STRING", "DATETIME", "BOOLEAN"]


class Column(TypedDict):
    name: str
    type: ColumnType


ExecutionMode = Literal["DIRECT_QUERY", "BLAZE"]


class DatasetExecution(TypedDict, total=False):
    mode: ExecutionMode
    intervalMinutes: int | None


class DatasetSummary(TypedDict):
    id: str
    name: str
    version: int
    execution: DatasetExecution


class DatasetDescribeLineage(TypedDict):
    sources: list[dict[str, Any]]
    datasets: list[dict[str, Any]]
    steps: int


class DatasetDescribeRefresh(TypedDict, total=False):
    supported: bool
    mode: str
    intervalMinutes: int | None


class DatasetDescribe(TypedDict, total=False):
    id: str
    name: str
    version: int
    execution: DatasetExecution
    schema: dict[str, list[Column]]
    lineage: DatasetDescribeLineage
    refresh: DatasetDescribeRefresh


class SaveDatasetBody(TypedDict):
    #: Prepared dataset name (<=512 chars)
    name: str
    #: PrepPipeline (version 1); see bundle-parser prep docs
    pipeline: dict[str, Any]
    #: Optimistic-concurrency version; 0 on create
    expectedVersion: int


class DeleteDatasetResult(TypedDict):
    id: str
    removed: Literal[True]


class LineageSource(TypedDict, total=False):
    id: str
    connectorId: str
    version: int
    available: bool
    errorCode: str


class LineageDataset(TypedDict, total=False):
    id: str
    name: str
    version: int
    available: bool
    errorCode: str
    inputs: list[dict[str, str]]


class DatasetLineageStep(TypedDict, total=False):
    id: str
    kind: str
    name: str | None
    from_: str | None


class DatasetLineage(TypedDict, total=False):
    dataset: dict[str, Any]
    steps: list[DatasetLineageStep]
    sources: list[LineageSource]
    datasets: list[LineageDataset]
    refresh: dict[str, Any]


class RefreshResult(TypedDict, total=False):
    datasetId: str
    refreshed: Literal[True]
    mode: str
    state: str


class RefreshState(TypedDict, total=False):
    datasetId: str
    version: int
    mode: str
    intervalMinutes: int | None
    supported: bool


class SourceSummary(TypedDict, total=False):
    id: str
    version: int
    connectorId: str
    available: bool
    errorCode: str


class SourceDescribe(TypedDict, total=False):
    id: str
    version: int
    connectorId: str
    columns: list[Column]


class DeleteSourceResult(TypedDict, total=False):
    id: str
    retired: Literal[True]
    version: int


class Page(TypedDict):
    items: list[dict[str, Any]]
    nextCursor: str | None


class ApiErrorBody(TypedDict, total=False):
    errorCode: str
    message: str
    path: str
    Errors: list[dict[str, Any]]


# ---- InteractiveQuery (visual query model, no raw SQL) ----


class QueryDimension(TypedDict, total=False):
    fieldId: str
    columnName: str
    granularity: str


MeasureAggregation = Literal["SUM", "AVG", "COUNT", "MIN", "MAX"]


class QueryMeasure(TypedDict):
    fieldId: str
    columnName: str
    aggregation: MeasureAggregation


class QueryFilterValue(TypedDict, total=False):
    columnName: str
    value: str
    values: list[str]
    parameterName: str
    operator: Literal["EQUALS", "GREATER_THAN_OR_EQUAL_TO", "LESS_THAN_OR_EQUAL_TO"]


QueryParameterType = Literal["string", "number", "datetime"]


class QueryParameter(TypedDict, total=False):
    name: str
    type: QueryParameterType
    multiple: bool
    integer: bool


class InteractiveQuery(TypedDict, total=False):
    dimensions: list[QueryDimension]
    measures: list[QueryMeasure]
    filters: list[QueryFilterValue]
    calculatedFields: list[dict[str, str]]
    parameterDeclarations: list[QueryParameter]
    parameterBindings: dict[str, list[str | int]]


class QueryResultColumn(TypedDict):
    name: str
    type: Literal["string", "number"]


class QueryResult(TypedDict, total=False):
    columns: list[QueryResultColumn]
    rows: list[dict[str, Any]]
    execution: dict[str, Any]


# ---- Analyses (camelCase writes, PascalCase descriptions) ----

DatasetBindingKind = Literal["dataset", "prepared-dataset"]


class DatasetBinding(TypedDict):
    kind: DatasetBindingKind
    id: str


DatasetBindings = dict[str, DatasetBinding]


class AnalysisSummary(TypedDict):
    kind: Literal["analysis"]
    id: str
    name: str


class AnalysisDiagnostic(TypedDict):
    errorCode: str
    message: str
    path: str


class AnalysisDescribe(TypedDict):
    AnalysisId: str
    Name: str
    #: Existing QuickSight PascalCase projection, not the camelCase write shape.
    Definition: dict[str, Any]
    Errors: list[AnalysisDiagnostic]


class UpdateAnalysisBody(TypedDict):
    name: str
    definition: dict[str, Any]
    datasetBindings: DatasetBindings


class CreateAnalysisBody(UpdateAnalysisBody, total=False):
    analysisId: str


class DeleteAnalysisResult(TypedDict):
    id: str
    removed: Literal[True]


class AnalysisFilterGroup(TypedDict):
    filterGroupId: str
    filters: list[Any]


# ---- Published dashboards ----


class PublishAnalysisBody(TypedDict, total=False):
    dashboardId: str


class PublishAnalysisResult(TypedDict):
    DashboardId: str
    Version: int
    PublishedAt: str
    Errors: list[AnalysisDiagnostic]


class DashboardSummary(TypedDict):
    kind: Literal["dashboard"]
    id: str
    name: str
    version: int
    publishedAt: str
    sourceAnalysisId: str


class DashboardVersionSummary(TypedDict):
    version: int
    publishedAt: str
    publishedBy: str


class DashboardDescribe(TypedDict):
    DashboardId: str
    Name: str
    Definition: dict[str, Any]
    Errors: list[AnalysisDiagnostic]
    Version: int
    PublishedAt: str
    SourceAnalysisId: str


class DashboardQueryBody(TypedDict, total=False):
    controlValues: dict[str, list[str | int]]


class DashboardExportBody(TypedDict, total=False):
    version: int
    format: Literal["csv", "pdf"]


class DashboardRemoved(TypedDict, total=False):
    id: str
    version: int
    removed: Literal[True]


# ---- Assets and folders ----
# D-55 explicitly retains lowercase discovery summaries and pagination.

AssetKind = Literal["analyses", "dashboards", "datasets"]
TransferAssetKind = Literal["analyses", "dashboards"]


class AssetSummary(TypedDict):
    kind: AssetKind
    id: str
    name: str
    folderId: str | None


class AssetSearch(TypedDict, total=False):
    query: str
    kinds: list[AssetKind]


class AssetMove(TypedDict, total=False):
    folderId: str | None


class AssetCopy(TypedDict, total=False):
    newId: str
    name: str
    folderId: str | None


class AssetTransfer(TypedDict):
    Kind: TransferAssetKind
    Id: str
    Name: str
    FolderId: str | None


class AssetPrincipal(TypedDict):
    type: Literal["user", "group"]
    id: str


AssetRole = Literal["viewer", "co-owner"]


class AssetPrincipalOut(TypedDict):
    Type: Literal["user", "group"]
    Id: str


class AssetShare(TypedDict):
    Principal: AssetPrincipalOut
    Role: AssetRole


DashboardShare = AssetShare


class AssetGrantWrite(TypedDict):
    principal: AssetPrincipal
    role: AssetRole


class FolderDescribe(TypedDict):
    Id: str
    Name: str
    Version: int


class FolderPermissions(TypedDict):
    InheritedFrom: str
    Grants: list[AssetShare] | None

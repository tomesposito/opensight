# Provisional fixtures reconstructed from documentation

Nothing here is a real QuickSight export. File and directory names are OpenSight
fixture organization; they make no claim about `.qs` ZIP layout or member schemas.
All identifiers and data are fabricated examples using AWS's example account ID.

- `sample-sales-analysis.json`: inventory smoke fixture. The `ResourceType` envelope
  is synthetic. Its pivot and unbound calculations intentionally exercise inventory;
  it has no executable field wells or data. The category filter explicitly uses
  the single-valued `regionParam` (default `East`) on both sheets.
- `sample-sales-analysis.summary.json` / `.txt`: expected library and CLI output.
- `renderable-sales/`: specification for the five Phase 1 visuals, with field wells,
  layout, an ordinary table, a bound row calculation, data and query expectations.
  See its README for what the local tests prove.

The parser validates the consumed inventory subset and preserves other properties.
It is neither a complete AWS schema validator nor an execution eligibility check.
A successful inventory says nothing about archive compatibility or query support.

Sources checked 2026-09-26:
[AnalysisDefinition](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AnalysisDefinition.html),
[FilterGroup](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_FilterGroup.html),
[CategoryFilter](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CategoryFilter.html),
[CustomFilterConfiguration](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CustomFilterConfiguration.html),
[ParameterDeclaration](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ParameterDeclaration.html).

Keep these regression fixtures when a sanitized real export arrives; add the export
separately with provenance and observed archive/member documentation. Real-export
acceptance and archive round-trip tests are blocked until then.

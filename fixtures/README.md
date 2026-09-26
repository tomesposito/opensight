# Fixtures

The synthetic regression fixtures below use fabricated examples and AWS's example
account ID. Their filenames and envelopes do not describe the real archive format.
The separate real bundle sample retains sanitized AWS-exported member structure.

- `real-bundle-sample/`: sanitized real AWS `.qs` export with four members; see its
  README for provenance, checksum, privacy checks and expected summary.
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
A successful inventory does not certify full AWS compatibility or query support.

Sources checked 2026-09-26:
[AnalysisDefinition](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AnalysisDefinition.html),
[FilterGroup](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_FilterGroup.html),
[CategoryFilter](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CategoryFilter.html),
[CustomFilterConfiguration](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CustomFilterConfiguration.html),
[ParameterDeclaration](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ParameterDeclaration.html).

Keep the synthetic regression fixtures unchanged alongside the real export.
See [observed archive/member documentation](../docs/research/bundle-format.md)
for the real sample's confirmed schema and remaining evidence gaps.

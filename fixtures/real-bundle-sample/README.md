# Sanitized real QuickSight asset bundle

`TotalDeathByCountry.sanitized.qs` is a real `QUICKSIGHT_JSON` ZIP export from
the AWS repository [aws/cicd-for-sagemakerunifiedstudio](https://github.com/aws/cicd-for-sagemakerunifiedstudio),
at `examples/analytic-workflow/dashboard-glue-quick/quicksight/TotalDeathByCountry.qs`.
The supplied structural notes report export on **2025-11-16**, with
`IncludeAllDependencies=True`. This project did not perform that export or make
AWS calls. The sanitized copy and those notes were supplied on 2026-09-26.

Sanitization replaced the source account ID in every member with AWS's example
account ID `123456789012`, including dataset, datasource and analysis ARNs.
Only the supplied sanitized archive was copied into this repository; no raw
download was used. Member JSON contains four example-account ARNs, no other
12-digit account IDs, credentials or private connection endpoints. Public example
resource IDs, names, Athena catalog/schema/workgroup and definition structure
are retained so dependency relationships remain testable. This bundle contains
asset definitions, not underlying data.

SHA-256 of the sanitized `.qs` file:

```text
a6188dabf94a60e6413a6caaedebf6659d998d3197c217754250d1cd892bc0c9
```

| Member type | ID | Name |
|---|---|---|
| dashboard | `e0772d4e-bd69-444e-a421-cb3f165dbad8` | TotalDeathByCountry |
| dataset | `2b4bd673-99f3-4d18-a475-ac37d56af357` | us_simplified |
| analysis | `2f99f271-1f84-4a57-9843-31646734d5c9` | Death By Countries |
| datasource | `8e5eb8e2-7430-4e3a-a4f7-940af71a93f6` | athena |

`summary.json` records expected library/CLI output, independently derived from
the member JSON. Tests verify the archive checksum, account/ARN hygiene, member
inventory, pie field wells, dependency references and preservation of all JSON
values through serialization and test ZIP repacking. Existing synthetic fixtures
remain unchanged.

See [format observations and API mapping](../../docs/research/bundle-format.md).
One sheet and pie per definition establish the initial archive shape. Calculated
fields, parameters and filter groups are empty. Tom's complex export is still
needed to establish their item schemas, more visual types and security features.

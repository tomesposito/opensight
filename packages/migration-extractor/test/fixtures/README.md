# Offline QuickSight response shapes

These are hand-written synthetic Describe responses. The pie visual, well
wrappers, grid layout and member envelopes follow the observed sanitized export
in `fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs` and its existing
API response fixtures. Physical/logical table shapes follow the existing
`fixtures/renderable-sales/describe-data-set.response.json`. SDK v3 declaration
files independently type the command mapping. No converter generated these
responses, no customer values were copied, and no AWS calls were made.

The all-zero account and example IDs are synthetic. The RLS property deliberately
remains preserved and unexecuted; importing a definition does not grant access.
These fixtures establish shape compatibility, not live QuickSight parity.

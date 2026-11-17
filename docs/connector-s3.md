# S3 file source — issue #273

S3 is an implemented file connector (`implementation: upload`, dialect DuckDB).
It reads one object through AWS SDK v3 and feeds the existing file upload/prep
pipeline. CSV, TSV, JSON, XLS and XLSX have exactly the upload parser's semantics,
including the 8 MiB compressed/input limit and the declared **and actual** XLSX
uncompressed limits (16 MiB/member, 64 MiB total, 1,000 members; #221).
S3 Analytics remains a hosted stub.

The server export provides `readS3Upload(config, fileConfig, options)` and
`listS3Objects(config, options)`. `readS3Upload` returns an `UploadRequest` for
`parseUpload` or `UploadStaging.ingest`; it does not implement a second parser.
The AWS SDK is excluded from the browser entry. The installed
`@aws-sdk/client-s3` **3.1149.0** package metadata and LICENSE were verified as
**Apache-2.0**; the query engine reuses the version already installed for the API.
No new transitive dependencies were introduced. The existing D-27 `tslib` 2.8.1
0BSD exception continues to apply.

## Configuration and authority

| Field | Meaning |
| --- | --- |
| `regionEnv` | Environment variable **name** holding the AWS region |
| `accessKeyIdEnv` | Environment variable **name** holding the access key ID |
| `secretAccessKeyEnv` | Environment variable **name** holding the secret access key |
| `sessionTokenEnv` | Optional environment variable **name** holding a session token |
| `bucket` | Plain bucket name, 3–63 characters; no URLs, IP addresses or NUL |
| `key` | Plain nonempty object key, at most 1,024 UTF-8 bytes |
| `prefix` | Optional nonempty browse prefix, at most 1,024 UTF-8 bytes; `key` must start with it |

Unknown fields, raw addresses in environment fields, invalid bucket/key values
and incompatible file options fail with `INVALID_CONNECTOR_CONFIG`. Credentials
are resolved only on the server; missing/empty/invalid configured values fail
with `CONNECTOR_NOT_CONFIGURED` before client construction. There is no default
credential-chain fallback. SDK endpoint overrides and region redirects are
disabled. Resolved values go only to the server-side SDK client; API responses and
stored config never contain them.

Hosted operators set `OPENSIGHT_S3_SOURCES` to a JSON array of permitted configs,
for example (all credential fields below are variable names):

```json
[{"regionEnv":"S3_REGION","accessKeyIdEnv":"S3_ACCESS_KEY_ID","secretAccessKeyEnv":"S3_SECRET_ACCESS_KEY","bucket":"example-bucket","key":"data/sales.csv","prefix":"data/"}]
```

The array is bounded at 256 entries and defaults to empty. Requests must match
an entire entry exactly. This follows the database operator-endpoint boundary:
authors cannot choose arbitrary server credential variables, buckets or object
keys. Listing another key does not authorize reading it; the operator must
allowlist its config separately. The configured AWS principal needs
`GetObject` on the object and, for browsing, `ListBucket` for the prefix. Permission
to browse is not required for a direct object read. No IAM resources are created.

## Hosted resources and normal prep

Build capability, tenant/owner scoping and existing admission budgets apply.

- `GET /api/connectors` includes S3 in the hosted API catalog.
- `POST /api/connectors/s3/browse` accepts `{ "config": <allowed config> }` and
  returns only `[{ "key": "data/sales.csv", "size": 42 }]`.
- `PUT /api/sources/<id>` accepts the following body. It downloads once, parses
  through the existing contained upload worker, then atomically stores the
  source metadata and encrypted rows. No partial source survives a failure.

```json
{
  "connectorId": "s3",
  "config": {"regionEnv":"S3_REGION","accessKeyIdEnv":"S3_ACCESS_KEY_ID","secretAccessKeyEnv":"S3_SECRET_ACCESS_KEY","bucket":"example-bucket","key":"data/sales.csv","prefix":"data/"},
  "fileConfig": {"format":"csv"},
  "expiresAt": "2099-01-01T00:00:00.000Z",
  "policy": {"rowLevel":false,"rowRules":[]}
}
```

`expiresAt` must be a future canonical UTC timestamp; choose an appropriate
retention period rather than copying the illustrative date. `fileConfig` uses
all existing upload options, including delimiter/worksheet selection. Optional
`columns` uses the existing explicit upload schema. Policy is mandatory.
Stored `binding.s3Config` contains only environment names and bucket/key/prefix;
resolved AWS credentials are never stored, even in the encrypted row payload.

The source appears in `/api/prep-sources`. Use its ID in the existing
`PUT /api/datasets/<id>/prep` pipeline, preview, refresh and rows APIs. Aggregated
materialized datasets require the normal refresh before rows are available.
RLS/CLS admission applies to source reads; protected sources remain ineligible
for prep. Bind can change policy but cannot change the object binding; credential
rotation uses the operator environment. Retirement and the expiry sweep remove
the encrypted snapshot payload. Removing an allowlist entry denies subsequent
source access, including cached paths.

This is an explicit **snapshot**: later source/query/BLAZE refreshes use the
stored rows and do not silently re-download S3. Re-ingest under a new source ID
to capture changed object contents. No object version pinning, automatic S3
refresh, bucket discovery or S3-specific web provisioning form is provided.
The fixture/local connector route only validates config; use the hosted source
API above for provisioning. The static demo cannot connect to AWS; registry
availability says **Needs hosted API** or **not configured**, never a successful
connection based solely on an API process.

## Bounds, errors and verification

A declared `ContentLength` above 8 MiB closes the response without pulling its
body. Streaming also counts every chunk, stops before retaining an over-limit
chunk, and rejects declared/actual length mismatches. No oversize bytes reach
the parser. The request/stream deadline is 30 seconds (callers may lower it);
transport and body streams are cancelled on timeout, caller abort or tenant-work
cancellation. Each operation owns and destroys its SDK client.

Browsing uses `ListObjectsV2`, 100 keys per request, at most 10 pages and 1,000
objects. It never invokes `GetObject`. Exceeding either cap fails the whole
listing with `S3_LIST_LIMIT_EXCEEDED`; cycles, duplicate/out-of-prefix keys,
invalid sizes and malformed responses fail with `S3_INVALID_RESPONSE`. There
is no partial-success listing. An omitted prefix lists from the bucket root.

Missing bucket/object, denial, other transport failures and timeout have named
errors: `S3_BUCKET_NOT_FOUND`, `S3_OBJECT_NOT_FOUND`, `S3_ACCESS_DENIED`,
`S3_REQUEST_FAILED`, `S3_TIMEOUT`. Cancellation uses `EXECUTION_CANCELLED`.
Parser errors, including `UPLOAD_LIMIT_EXCEEDED`, remain unchanged. Raw SDK
messages never reach the API response. Hosted connector/data errors use the
existing 422 response contract; authorization errors retain their 403 status.

Tests fake the **real SDK command boundary**, exercise all five formats through
DuckDB prep, and cover both XLSX uncompressed guards, size/stream/listing limits,
named failures, ownership, config persistence, expiry, revocation and cancellation.
They run through the existing workspace globs in root `npm test`.
**No live AWS calls were made. Live verification in Tom's own AWS account is
his follow-on**, including IAM/prefix policies and real object streams. These
offline results do not claim live AWS compatibility or measured visual parity.

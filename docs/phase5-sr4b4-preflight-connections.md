# Phase 5 SR4b4 — invocation preflight connections

After the AWS budget update, a native ingestion invocation crashed with an
unhandled PostgreSQL `57P05` idle-session error. Preflight retained a checked-out
tenant connection that ingestion never used; the five-second database idle guard
terminated it while native processing ran. Pool error handlers do not cover an
individually checked-out client's idle error event.

Preflight must connect and immediately discard each client. Business transactions
obtain their own clients and continue discarding them on release. Attach a client
error handler during checkout: an error while owned cancels the invocation and
destroys its sockets; errors after release are consumed without cancelling later
work. Preserve SQL timeouts, authentication, TLS verification, role separation,
resource cleanup and memory/concurrency limits. No retained idle SQL connection
or heartbeat is introduced.

The private pilot operator may select this one compatible initial runtime patch
before apex DNS exists. `prepare connection-repair` requires clean source, the
original release-bound activation, the current application functions still on
that image, and a separately tested immutable image from the owned repository.
Record the original activation image, replacement image, source commit, account,
deployment, bootstrap operation and fixed repair purpose in a private receipt.
Preserve the original activation record without rewriting its provenance. Later
pilot plan/apply/publish commands validate that receipt as the link to the new
application image; configuration hashes bind it. Selection is one-time, rejects
published DNS and foreign/mutable artifacts, and disables further initial
administration commands. No SQL schema, protocol, epoch, configuration, identity,
cleanup record or activation receipt changes. Existing admission fences protect
overlapping attempts during the compatible code replacement. This narrow repair
does not implement D-25's general release/migration/rollback protocol.

Reproduce the checked-out idle failure with real PostgreSQL. Prove preflight
leaves no clients, later transactions still work, live client errors cancel
without escaping as process crashes, and released client errors do not cancel
later work. Verify private patch provenance and rejection cases, run the full
suite, rebuild/capture the unchanged demo, smoke/scan the artifact and review the
image-only saved plan. Complete real 8 MiB ingestion/query/isolation and idle
acceptance before DNS.

Sources: [node-postgres client errors](https://node-postgres.com/apis/client#events),
[PostgreSQL idle-session timeout](https://www.postgresql.org/docs/16/runtime-config-client.html).

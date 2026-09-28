# Data panel

The header describes **Local sales dataset**, the source of the assignable fields.
SPICE labels the local in-memory sample import in the offline demo; it does not
mean the demo connects to AWS. The sample count comes from the pinned synthetic
rows used by the fixture query engine, not the selected visual's aggregate rows.
The demo says “Refresh info needs hosted API” and never invents a timestamp.

With an API client, the badge reads DIRECT QUERY. The header independently reads
the row count through the secured dataset query route (`COUNT(order_id)`, the
non-null local sales key) and `/api/datasets/sales/refresh-status`. Both use the
configured API mount and load when the editor opens or its client changes.
The count reflects rows visible to that query, before visual filters. Last
successful refresh is the API's `lastGood`, displayed in UTC. A running or failed
refresh is shown alongside it; an old success is never presented as a new one.
No recorded success, loading, invalid responses and unavailable metadata have
explicit states. Failed requests never fall back to fixture counts or times.

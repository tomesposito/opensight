---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Resolve the list/search shape, filtering, and match rules for headless
v1 asset discovery.

## Scope

`GET /assets` shape and kind filter, `POST /assets/search` body and
match rules, readable-set filtering.

## Out of Scope

Move/copy/delete (D-56/D-57/D-59), permission verbs (D-58), asset
rename (D-39/D-60), MCP tool mapping (mechanical per freeze Q7).

### ✅ IDD D-55 — What list/search shape should assets expose?

#### DECISION (product owner, Tom, 2026-10-14)

Unified GET /assets returns {kind,id,name,folderId} for the caller's readable set only; kind filter via per-kind paths; POST /assets/search with {query,kinds?,scope?}, case-insensitive substring on name, sorted by updatedAt desc.


#### CONTEXT

D-41 ✅ approved proposal-first; this is its Q1. The frozen contract
settled pagination via `Limit`/`Cursor` request headers, and the hosted
plane rejects `?...` query strings — which is why search is a POST,
not a GET. D-37 ✅ settled the shape: builder-shaped REST+OpenAPI
first, user-level tenant-scoped credentials, rate limiting on every
route.

What exists today: local `GET /api/assets` returns the caller's
readable assets as `{ kind, id, name }` — no pagination, no kind
filter, no search, no `folderId`. The UI's global search is
client-side only and cannot see hosted assets. Read access is governed
by `canRead`/`grantsAllow`: analyses need the `build` capability;
folder grants and asset grants must both allow; undefined grants mean
inherited access.

#### THE PROBLEM

What shape should list and search return, and how should search match
— without leaking the names of assets the caller cannot read?

#### OPTIONS CONSIDERED

1. **Unified `GET /assets` returns `{ kind, id, name, folderId }`
   plus the caller's readable set only** — search is filtered by
   `canRead` exactly like `list`, so it never leaks names of
   unreadable assets. Kind filter via a per-kind list path
   (`/analyses`, `/dashboards`, `/datasets`) rather than a header or
   query string. Search is `POST /assets/search` with
   `{ query, kinds?, scope? }`; match is case-insensitive substring
   on `name` (the client-side rule), sorted by `updatedAt` desc where
   available. `folderId` in the list lets agents scope by folder
   client-side.
2. **Richer shape** (owner, timestamps, tags, favorites in the
   response). Changes the response schema; tags and favorites do not
   exist server-side today and would be new state to store, index,
   and permission.
3. **Different search** (relevance ranking, fuzzy/prefix matching,
   folder-scoped server search). A different implementation with its
   own ranking semantics; substring-on-name preserves the client
   rule agents can already reason about.

#### RECOMMENDATION

Option 1. It keeps the read boundary exact — search filtered by
`canRead` means an unreadable asset is invisible everywhere — reuses
the frozen header-pagination convention, and invents no new server
state. The per-kind path kind filter sidesteps the query-string ban
without a second filtering model.

#### IMPLICATIONS

- `GET /assets` and `POST /assets/search` ship with the proposed
  shapes; the OpenAPI spec gains them and nothing else.
- Contract tests assert an unreadable asset never appears in list,
  search, or folder listings — including explicit bypass attempts.
- Tags, favorites, and ranking stay out of v1; they can return as
  their own proposal if agents need them.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-41](D-41-headless-asset-management.md), [D-37](D-37-headless-first-api.md)

# Issue #7: roles and AI settings

The authoritative implementation brief is Tom's Issue #7 decisions supplied for
this build. SOLUTION_DESIGN.md is unchanged.

The registry accepts `administrator`, `author`, `author_ai`, `reader`, and
`reader_ai`. Loading trusted legacy state maps `admin` to `administrator` and
retains `reader`; subsequent writes persist canonical roles. HTTP mutations
reject `admin`. Administrators manage system settings and namespace users.
Authors can use the builder; readers access published dashboard definitions and
visual queries only. AI capability belongs to administrator, author_ai and
reader_ai. Role checks always re-read the registered user, so demotion takes
effect on the next request. Resource grants never elevate a namespace role.

`GET /api/session` returns the authenticated user's registered role. The injected
server credential verifier supplies only identity, never client role claims.
Hosted UI gates use this session; an unresolved session has no capabilities.
The offline public sample preview has a fixed author_ai persona and grants no
hosted access. It is not authentication. Hosted authentication integration stays
with the existing `SecurityOptions.authenticate` deployment boundary.

Analysis access and unrestricted dataset queries require `SECURITY_BUILD_REQUIRED`;
admin routes require `SECURITY_ADMIN_REQUIRED`. Dashboard access still intersects
namespace, folder and asset grants and dataset row/column policies.

# Issue #192 — operator provisioning visual review

The local hosted captures use the real Vite app, hosted API and isolated
PostgreSQL fixtures from Journey 7. The three approved external mockups
(`tenant-list`, `create-tenant`, `tenant-detail`) were reviewed against:

- [Tenant list](images/operator-tenants.png): operator header/navigation,
  connection notice, name/slug filter and workspace/state/plan/member/date table.
- [Create panel](images/operator-create-tenant.png): paired workspace/namespace
  fields, editable derived slug, administrator fields and four starting plans.
- [Tenant detail](images/operator-tenant-detail.png): overview with inline usage,
  billing state, people/invitation form and separated danger zone.
- [Narrow detail](images/operator-tenant-detail-narrow.png): cards and identifiers
  remain readable at 390px without document overflow.

The captures contain synthetic workspace data only. Billing is unconfigured in
this local hosted stack, so its card has the required explanation and no payment
buttons. Configured payment links, clipboard copy and confirmed past-due
resolution are covered by component/API tests with stub transports; no Stripe
or AWS service was called. Invitation tokens and operator credentials do not
appear in these captures.

The implementation follows the mockups' header, navigation, cards, field layout,
state chips and danger-zone treatment. It uses the existing system font. Detail
shows the approved namespace and creation-operation identifiers rather than
inventing readable namespace slugs. Issue #225 updates API/query quota labels to
the UTC month to match monthly enforcement; NLQ is monthly and storage is a current gauge.
The mockups' illustrative figures and paid subscriptions are not fixture data.
No blocking layout gap was found. Pixel parity is not claimed.

Journey 7's `provisioning-ui` gap now requires a passing UI provision step.
The browser journey also checks the created membership, invitation email,
administrator enrollment/sign-in and existing removal workflow. It completes
12 steps with no failures, gaps, browser errors or external requests.

The static demo was rebuilt and captured separately. Its operator route guard
leaves the offline application visible and exposes no operator credential form.
The static demo is a local artifact, not a deployed hosted server. README tour
assets were not changed: the tour does not cover the operator plane.

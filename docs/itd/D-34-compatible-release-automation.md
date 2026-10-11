---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-11
labels: [itd]
---

### ✅ ITD D-34 — How do routine pilot releases get separate, revocable AWS access?

#### CONTEXT

The pilot is live. The operator approved public CI, private deployment control,
dedicated IAM roles instead of IAM users/access keys, and an independently usable
emergency shutoff. D-25 describes the larger migration/restore system. The initial
activation scripts cannot serve as a recurring deployment controller.

#### THE PROBLEM

Routine compatible releases must be reproducible and bounded, without repeating
bootstrap, exposing local operator credentials, requiring a paid GitHub plan, or
waiting for a database idle experiment. A compromised deployment identity must be
revocable without disabling the application's distinct runtime identities.

#### OPTIONS CONSIDERED

1. Public isolated CI and immutable release artifacts, with a private manual
   promotion workflow, restricted OIDC roles and independent operator approval.
2. Public workflows with AWS deployment authority and masked configuration.
3. Reuse the workstation's AWS credentials in GitHub secrets.

#### REASONING

Select option 1. Public code and builds remain reusable; private operational
configuration and logs stay separate. OIDC supplies temporary credentials, and
AWS trust binds the exact private repository identity, ref and reviewed reusable
workflow commit. GitHub Free lacks private environment approval protections, so
an operator-owned approval record binds the exact release and current deployment.
Neither private visibility nor a workflow dispatch is independent approval.

#### IMPLICATIONS

Implement [SR4c](../phase5-sr4c-compatible-releases.md). A first release changes
application bytes only, with unchanged SQL/event/artifact/client contracts and
runtime configuration. During promotion, AWS admission is stopped and existing
invocations are allowed their full hard deadline plus quarantine. Since this
operation does not change authority, schema or durable protocols, it preserves
the SQL control epoch and queued obligations. This narrower protocol does not
implement D-25's epoch-changing migration, restore or arbitrary upgrade path.

Public CI has no AWS trust. Dedicated preflight/deployment roles cannot alter
their own permissions, IAM trust or emergency controls. Runtime identities and
local operator credentials remain separate. Deploy authority is trusted code
execution: compromise can affect application data through runtime permissions.
Revocation cannot undo previously deployed malicious code.

An operator command outside GitHub blocks new federation and adds an explicit
deny for already issued sessions. It checks propagation using an existing session
and a fresh OIDC attempt. Re-enabling is a separate deliberate operator action;
failed verification never reports success. The command does not alter runtime
roles, existing local credentials, or the account's shared OIDC provider.

No new application dependency, persistent runner, database endpoint, NAT gateway,
paid GitHub plan, or always-on polling service is selected. Public and private
repositories contain generic code only; configuration enters through environment
variables or private operational storage. General infrastructure changes and
database migration/restore remain separately controlled D-25 work.

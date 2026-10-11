# Phase 5 SR4a — base image scan review

The first ingress image retains D-27's pinned ARM64 Lambda Node 24 base.
The October 11, 2026 upstream Node 24 ARM64 image was also inspected separately:
it reports Node 24.21.0 and the same affected RPM, curl and PCRE2 package versions.
Changing the base digest alone does not resolve these findings.

The previous runtime scan reported eight HIGH package findings representing four
CVEs. The package duplication is not eight separate vulnerable code paths. This
review does not remove or suppress scanner findings.

| Finding | Installed version | Runtime reachability review |
| --- | --- | --- |
| CVE-2026-78367 / CVE-2026-84233 | rpm and rpm-libs 4.16.1.3-29.amzn2023.0.7 | The affected operations build a malicious tarball or unpack a crafted gem through RPM tooling. Neither rpm-build nor rpm-build-libs is installed; the image has no rpmbuild/rpmuncompress executable. Application subprocess construction launches a fixed Node worker and never invokes package-building tools. |
| CVE-2026-80230 | curl-minimal and libcurl-minimal 8.21.0-5.amzn2023.0.1 | The advisory requires public-key pinning together with both normal TLS peer and hostname verification disabled. Application AWS, SQL and SMTP connections use their Node transports with certificate verification; application code does not invoke curl or load the system libcurl. |
| CVE-2026-89161 | pcre2 and pcre2-syntax 10.40-1.amzn2023.0.3 | The vulnerable operation is PCRE2 JIT matching with a copied subject context. Dynamic-library inspection of Node, the Lambda rapid-client addon, DuckDB's addon and libduckdb shows no system PCRE2 dependency. Application code does not load or invoke system PCRE2. |

Evidence for the affected operations and remediation comes from the AWS
[RPM advisory](https://alas.aws.amazon.com/AL2023/ALAS2023-2026-3125.html),
[curl advisory](https://alas.aws.amazon.com/AL2023/ALAS2023-2026-3128.html), and
[PCRE2 record](https://explore.alas.aws.amazon.com/CVE-2026-89161.html).
AWS lists corrected RPM/curl packages; the PCRE2 AL2023 fix remains pending at
review time. The dependency/linker and subprocess checks above were performed
offline in the pinned Linux ARM64 image.

The engineering disposition is **no reachable affected operation identified for
the bounded initial runtime**. That is an inference from the specific advisory
preconditions and inspected program paths, not a claim that the image has no
vulnerabilities. The application runs with a read-only root and an unprivileged
Lambda identity. Builds contain no cloud credentials. Authorizer IAM can read
only its ingress secret and write its own logs; it has no database network.

Keep the raw image scan and package inventory in private release evidence.
Recheck each new candidate digest and any change introducing native libraries,
shell execution or TLS transport options. Replace the pinned base when the
upstream fixes are available and verify the replacement through the same offline
suite and image smoke checks. This review grants no general scanner exemption.

# Authenticated viewer compute budget (#347)

The generated CloudFront viewer dispatches the v1 grammar by its first literal
resource component. The build derives these groups from the shared contract,
keeps condition order within each group, and rejects unsupported condition
shapes. No route list is maintained separately. Singleton header membership is a
generated lookup with exact numeric membership, including safe handling of
ordinary prototype-named headers.

Parser-based private identifier shortening keeps the generated function within
the existing size limit. It does not rewrite strings, regexes, or property names.
The runtime remains CloudFront JavaScript 2.0 with the existing APIs and uniform
denial behavior. No dependencies or runtime configuration are added.

Differential tests cover every route family and malformed identifiers. A maximum
dashboard query checks that unrelated route regexes do not execute. Browser
header fixtures retain byte ceilings, duplicate restrictions and forged-principal
denial. Deployment additionally requires an actual CloudFront engine probe and
live browser verification; local execution cannot measure the edge CPU limit.

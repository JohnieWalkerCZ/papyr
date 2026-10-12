# SECURITY.md — threat model and controls

## Scope and trust boundaries

Papyr contains private notes, documents, handwriting, and attachments. Protect confidentiality, integrity, and access across browser, reverse proxy, API, DB, and stored blobs. Self-hosted does **not** automatically mean secure.

## Authentication and sessions

- MVP creates the initial owner only through a gated setup flow requiring a one-time bootstrap secret; disable setup permanently once owner exists.
- No anonymous/public registration and no default passwords.
- Hash passwords with a contemporary password KDF (e.g., Argon2id via a vetted library, or ASP.NET Core Identity-approved implementation). Never invent crypto.
- Cookie-based sessions: `HttpOnly`, `Secure`, `SameSite=Lax/Strict` where feasible, rotation/revocation, idle/absolute expiry, logout invalidation.
- State-changing cookie requests must have real CSRF protection, including on uploads and session actions. SameSite is defense in depth, not an excuse to skip CSRF design.
- Login and setup endpoints rate-limited; do not disclose credential enumeration details.
- Offline local content may remain after server logout; offer an explicit **clear this device** action with warnings, never erase pending edits silently.

## Authorization

- Every folder/note/attachment/change request checks the authenticated account. Never accept untrusted `ownerId` to select an arbitrary user's data.
- All FK traversals and recursive tree operations are owner-scoped. Deleted entities and assets are not publicly readable.
- SignalR groups are established from authenticated server claims, never from a client-provided owner ID.
- SignalR connections close at session expiry and are aborted on logout; logout revocation is process-local until shared connection tracking is introduced for multi-replica deployments.

## Content and uploads

- Markdown preview: sanitize unsafe HTML; prohibit script execution, `javascript:`/untrusted URL schemes, active embed code, and unsafe renderer plugins.
- Typst compiler: isolate browser worker; do not let imported files or packages read arbitrary server files. If moving compilation server-side, add sandbox/resource/time limits and threat review.
- tldraw: validate imported snapshots/schema and asset refs, reject pathological size/depth; don't blindly trust shape URLs.
- Attachments: enforce size/type/extension validation, content hash, safe storage names, authenticated downloads, `nosniff` and safe Content-Disposition when appropriate; prevent path traversal and unsafe SVG/HTML scripting.
- Require TLS outside loopback; apply strict CORS policy with same-origin proxy preferred, appropriate CSP/headers, request size and time limits.

## Data protection and durability

- Secrets only in runtime environment, Docker secrets or external secret management; never inside repo, client bundle, logs, error telemetry, backup archives shared publicly.
- PostgreSQL credentials distinct from owner login; least privilege for API DB user.
- Encrypt sensitive backups at rest and restrict backup access; test restores.
- Explain that browser IndexedDB is stored on device and is not end-to-end encrypted by default; device security matters.
- Avoid persisting auth tokens in `localStorage` or IndexedDB. The session cookie is the authentication mechanism.
- No external analytics or rendering services by default. Explicit opt-in and privacy review for future integrations.

## Availability and abuse

- Bound payload sizes, note depth, recursive folder operations, compilation resources, upload concurrency, mutation batch lengths, and requests per IP/account.
- Return actionable errors on quota/resource failures without deleting client drafts.
- Prevent runaway asset orphan accumulation through retention-aware cleanup and reference tracking.
- Protect health/metrics/admin endpoints from unauthenticated sensitive data exposure.

## Security verification

Unit tests for authorization across accounts, CSRF, token expiry, mutation replay, path traversal, unsafe Markdown, malicious attachment mime, invalid tldraw snapshot, oversized payloads, dependency vulnerabilities, and backup permission mistakes. Log security-relevant events without logging note contents.

## Production release gate

Review account setup, HTTPS, backup encryption, restore, public registration disabled, tldraw license, dependency vulnerabilities, CSP, secure cookies, and actual host permissions before release.

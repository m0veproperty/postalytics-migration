# Shared migration workspace

## Integration

Copy `src/lib/migration` and all `src/app/api` routes into the Next.js app. The public repository contains application code only. Project data, decisions, spreadsheets and reports stay in private Blob storage and require a signed workspace session to read. No private source is imported into the client bundle, server-rendered HTML or public assets. The client signs in, then loads `/api/project`, `/api/decisions` and `/api/workspace` and merges returned task and decision overrides by ID.

Install `@vercel/blob` 2.8.2 or later. This backend uses private storage, consistent reads (`useCache: false`) and conditional writes (`ifMatch`). Use the Node.js runtime for the API routes. Set `allowImportingTsExtensions: true` with `noEmit: true` in the TypeScript configuration. Public contracts live in `src/lib/migration/types.ts`.

Required Vercel environment variables:

- `MIGRATION_ACCESS_PIN`: the shared workspace access PIN, exactly six digits. Set it only in private environment configuration; it has no code default.
- `MIGRATION_SESSION_SECRET`: separately generated random secret, at least 32 characters.
- `BLOB_READ_WRITE_TOKEN`: automatically supplied by the connected private Blob store. The SDK receives this explicitly when present.
- Alternatively, use `BLOB_STORE_ID` with the Vercel runtime's OIDC credentials when a read-write token is unavailable.

Do not prefix these variables with `NEXT_PUBLIC_`, commit them, or put them in client code. Rotating either the PIN or session secret invalidates existing signed sessions. `MIGRATION_EDIT_PASSWORD` is no longer used.

## Data and concurrency

The private object `postalytics-migration/workspace-v1.json` contains an ordered event ledger. Current task state, comments, custom actions, and URL decisions are projected from those events. Seed files are never mutated. The API has no delete-history or reset endpoint.

Task creation and updates accept an optional `phase` of `prelaunch` or `postlaunch`. Explicit choices persist in the event ledger and are returned on custom tasks or task overrides. Omitting the field preserves existing behavior: legacy source tasks and events do not gain a stored phase, and updates to other fields preserve any previously chosen phase. The interface determines the display phase for tasks that have no explicit value; the backend does not infer or migrate one.

Each mutation loads the latest object directly from private storage, validates the affected entity, appends an event, and conditionally writes against the observed ETag. Initial creation uses `allowOverwrite: false`. A competing write is re-read and retried up to six times. Changes to different actions merge safely. An outdated revision on the same action or URL returns HTTP 409 instead of silently overwriting someone else's work. Comments append without requiring an entity revision.

The application enforces append-only history; a Vercel project administrator with storage access can still modify or remove the underlying object. This is an operational audit trail, not a tamper-proof compliance system. Export the activity history when a durable project handover is needed. The ledger is capped at 20,000 events or 32 MiB; reaching the cap preserves reads and prevents additional writes until an administrator archives or migrates it. No automatic truncation discards history.

## Editing and approval

Viewers must sign in before any workspace data or assets are returned. `POST /api/session` takes `{ "profileId": "amir|tony|dennis|maddy", "pin": "…" }` and returns a 12-hour signed session through a secure, HTTP-only, same-site cookie. The public profile list in `profiles.ts` supplies the canonical names and capabilities. The v2 signed payload contains only a profile ID and session times; the server resolves the current name and permissions on every request. Old v1 name-based sessions are invalid. Session responses contain `profileId`, `canEdit`, `canApprove`, `name`, and `expiresAt`.

All four profiles share the same PIN. Choosing a profile identifies the session for this workspace; it is not separate account authentication for each person. Amir and Tony can edit tasks and draft URL decisions. Dennis and Maddy can also approve decisions or alter/revoke an existing approval. On an approved URL, Amir and Tony can update working notes only. These rules are enforced when a mutation is appended to the ledger, including after a concurrent-write retry.

Login attempts are durably limited to eight per 15-minute window per network IP across all profiles. Counters use a secret HMAC of the Vercel-provided IP; raw IP addresses and PINs are not stored. A small JSON counter is retained per hashed IP and reused in the next window. On a self-hosted reverse proxy, ensure the trusted proxy overwrites `X-Forwarded-For`; the deployed target is Vercel.

URL records start unapproved. An explicit Approved save by Dennis or Maddy confirms the supplied final action and destination. A final action and any required HTTPS destination remain mandatory; Hold cannot be Approved. Redirects cannot target the same normalized request URL. A Fix link action can correct different raw URL spellings even when they resolve to the same URL. A 410 retirement must leave its destination empty. Recommendation defaults are displayed in the review form; the server validates the submitted final disposition rather than guessing a missing destination.

The server records the logged-in profile's name as `approver`, the UTC approval timestamp as `approvedAt`, and its Europe/London calendar date as `approvalDate`. These fields are rejected in client mutations. A new approval, reapproval after revocation, or change to an approved action/destination receives a fresh stamp. Notes or evidence changes preserve the original stamp. Revoking an approval preserves its earlier stamp as historical provenance. Evidence is optional. The legacy `conditionsConfirmed` field is retained in projections, but is not required or automatically set by approval.

The existing ledger format stays readable. Historical approval events retain their original actors, fields and evidence; they are not revalidated against the new profiles. New audit events additionally record `actorProfileId`. Marking an action complete never approves any URL or asserts launch readiness.

## Routes

- `GET /api/project`: authenticated immutable project seed.
- `GET /api/decisions`: authenticated immutable URL decision seed.
- `GET /api/assets/[name]`: authenticated, manifest-allowlisted file download or HTML preview. HTML reports run in a sandbox without the application origin or network fetch access.
- `POST /api/content?name=...`: authenticated initial source upload, described below.
- `GET /api/workspace`: authenticated current overrides, custom tasks, session information and the latest 200 audit events, newest first. `activityTotal` gives the complete count.
- `GET /api/workspace?activity=all`: same response with the complete audit history.
- `POST /api/workspace`: a typed mutation from `types.ts`. Decision patches accept status, final action/destination, optional evidence and notes (plus the legacy condition field). They cannot submit an approver or approval time. Returns the new complete workspace projection.
- `GET /api/session`: current edit session information.
- `POST /api/session`: sign in; requires JSON and the same-origin browser request.
- `DELETE /api/session`: sign out; requires the same-origin browser request.

Content responses use `Cache-Control: private, no-store`. Unauthenticated content requests return HTTP 401 before touching private storage. A storage outage returns a clear error rather than claiming a local draft has been saved. A missing initial source returns `SOURCE_NOT_READY`. Only the sign-in shell and session endpoint are available before sign-in.

The app does not write changes back to ClickUp, Slack, email or the original spreadsheets. Source evidence stays linked. Shared workspace updates and their audit history live in the portal.

## Initial private source import

Upload `project.json` first, then `decisions.json` and the asset files. Each upload is a raw-body `POST /api/content?name=<bare filename>` with the signed session cookie, the deployment URL as `Origin`, and the exact MIME type. The maximum body is 4 MiB (not a base64 envelope). Supported types are `application/json`, `text/html`, `text/csv`, and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Asset filenames must appear in the immutable project's `assets[].fileName` manifest. Asset links in the project should use `/api/assets/<filename>`.

Source objects live under `postalytics-migration/content/<name>`. The endpoint creates them with `allowOverwrite: false`; it cannot replace existing source evidence. Repeating an upload with identical bytes returns HTTP 200 and the same SHA256. Different bytes under an existing name return HTTP 409. New uploads return HTTP 201 with filename, byte count and SHA256. Future source replacements should be explicitly versioned and reviewed, not silently overwritten.

## Local verification

Run the pure backend checks with Node.js 24:

```sh
node tests/backend.test.ts
```

The suite verifies independent and conflicting concurrent saves, persistent custom actions, optional task phases and comments, profile permissions, automatic approval stamps and stamp preservation, forged-field rejection, historical-event compatibility, session version/role/tampering/expiry checks, immutable source data, cross-origin rejection, payload limits, durable login throttling and local persistence across server instances. Test PINs and secrets are generated at runtime; the live PIN never appears in tests.

For a local development server only, explicitly set `MIGRATION_LOCAL_STORE_DIR` to a disposable directory and set `MIGRATION_ACCESS_PIN` and `MIGRATION_SESSION_SECRET`. This uses local files with conditional writes and atomic renames so UI interactions can be exercised without touching production data. If `NODE_ENV=production`, setting this variable fails closed; local storage never silently replaces Blob in production. Exclude the chosen directory from Git.

After deployment, verify a real shared write and read through a second session. Use an actual implementation-verification action and record the check honestly instead of inventing a client approval for a smoke test.

## Official implementation references

- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Private Blob storage](https://vercel.com/docs/vercel-blob/private-storage)
- [Vercel Blob SDK credential resolution](https://github.com/vercel/storage/blob/main/packages/blob/src/helpers.ts)

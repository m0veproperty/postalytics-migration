# Shared migration workspace

## Integration

Copy `src/lib/migration` and all `src/app/api` routes into the Next.js app. The public repository contains application code only. Project data, decisions, spreadsheets and reports stay in private Blob storage and require a signed workspace session to read. No private source is imported into the client bundle, server-rendered HTML or public assets. The client signs in, then loads `/api/project`, `/api/decisions` and `/api/workspace` and merges returned task and decision overrides by ID.

Install `@vercel/blob` 2.8.2 or later. This backend uses private storage, consistent reads (`useCache: false`) and conditional writes (`ifMatch`). Use the Node.js runtime for the API routes. Set `allowImportingTsExtensions: true` with `noEmit: true` in the TypeScript configuration. Public contracts live in `src/lib/migration/types.ts`.

Required Vercel environment variables:

- `MIGRATION_EDIT_PASSWORD`: generated workspace passphrase, at least 16 characters.
- `MIGRATION_SESSION_SECRET`: separately generated random secret, at least 32 characters.
- `BLOB_READ_WRITE_TOKEN`: automatically supplied by the connected private Blob store. The SDK receives this explicitly when present.
- Alternatively, use `BLOB_STORE_ID` with the Vercel runtime's OIDC credentials when a read-write token is unavailable.

Do not prefix these variables with `NEXT_PUBLIC_`, commit them, or put them in client code. Rotating either the passphrase or session secret invalidates existing signed sessions.

## Data and concurrency

The private object `postalytics-migration/workspace-v1.json` contains an ordered event ledger. Current task state, comments, custom actions, and URL decisions are projected from those events. Seed files are never mutated. The API has no delete-history or reset endpoint.

Each mutation loads the latest object directly from private storage, validates the affected entity, appends an event, and conditionally writes against the observed ETag. Initial creation uses `allowOverwrite: false`. A competing write is re-read and retried up to six times. Changes to different actions merge safely. An outdated revision on the same action or URL returns HTTP 409 instead of silently overwriting someone else's work. Comments append without requiring an entity revision.

The application enforces append-only history; a Vercel project administrator with storage access can still modify or remove the underlying object. This is an operational audit trail, not a tamper-proof compliance system. Export the activity history when a durable project handover is needed. The ledger is capped at 20,000 events or 32 MiB; reaching the cap preserves reads and prevents additional writes until an administrator archives or migrates it. No automatic truncation discards history.

## Editing and approval

Viewers must sign in before any workspace data or assets are returned. `POST /api/session` takes `{ "passphrase": "…", "name": "…" }` and returns a 12-hour signed session through a secure, HTTP-only, same-site cookie. The entered name is recorded as the editor's asserted name; this is shared passphrase access, not a verified account system. Server-side checks reject missing sessions, cross-origin mutations, unknown fields, unknown source IDs, oversized payloads, and invalid dates.

Login attempts are durably limited to eight per 15-minute window per network IP. Counters use a secret HMAC of the Vercel-provided IP; raw IP addresses and passphrases are not stored. A small JSON counter is retained per hashed IP and reused in the next window. On a self-hosted reverse proxy, ensure the trusted proxy overwrites `X-Forwarded-For`; the deployed target is Vercel.

URL records start unapproved. Recording approval requires a named approver, an actual non-future date on the Europe/London calendar, evidence, explicit confirmation that conditions are met, a final action, and a valid destination when that action requires one. Redirects cannot target the same request URL. A 410 retirement must leave the destination empty. The application validates completeness and consistency; the reviewer remains responsible for the truth of the supplied approval evidence. Marking an action complete never approves any URL or asserts launch readiness.

## Routes

- `GET /api/project`: authenticated immutable project seed.
- `GET /api/decisions`: authenticated immutable URL decision seed.
- `GET /api/assets/[name]`: authenticated, manifest-allowlisted file download or HTML preview. HTML reports run in a sandbox without the application origin or network fetch access.
- `POST /api/content?name=...`: authenticated initial source upload, described below.
- `GET /api/workspace`: authenticated current overrides, custom tasks, session information and the latest 200 audit events, newest first. `activityTotal` gives the complete count.
- `GET /api/workspace?activity=all`: same response with the complete audit history.
- `POST /api/workspace`: a typed mutation from `types.ts`. Returns the new complete workspace projection.
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

The suite verifies independent and conflicting concurrent saves, persistent custom actions and comments, approval gates, immutable source data, session tampering/expiry, cross-origin rejection, payload limits, durable login throttling and local persistence across server instances.

For a local development server only, explicitly set `MIGRATION_LOCAL_STORE_DIR` to a disposable directory and set the two edit credentials. This uses local files with conditional writes and atomic renames so UI interactions can be exercised without touching production data. If `NODE_ENV=production`, setting this variable fails closed; local storage never silently replaces Blob in production. Exclude the chosen directory from Git.

After deployment, verify a real shared write and read through a second session. Use an actual implementation-verification action and record the check honestly instead of inventing a client approval for a smoke test.

## Official implementation references

- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Private Blob storage](https://vercel.com/docs/vercel-blob/private-storage)
- [Vercel Blob SDK credential resolution](https://github.com/vercel/storage/blob/main/packages/blob/src/helpers.ts)

# Postalytics migration workspace

A shared workspace for the Postalytics website migration: actions, URL decisions, documents, milestones and an activity history.

## Application

- **Overview:** completed actions, outstanding decisions, priority work and workstream progress.
- **Actions:** list and board views, status / owner / workstream filters, editable task details, checklists, comments and new actions.
- **URL decisions:** searchable recommendations with separate approval fields, exact destinations, dependencies and source evidence.
- **Documents:** authenticated report previews and downloads, with a clear distinction between dated source files and current workspace records.
- **Milestones:** delivery gates tied to their underlying actions.
- **Activity and export:** shared updates attributed to the signed-in name, task / decision CSV exports and a complete JSON backup.

The portal preserves imported source status separately from updates made in this workspace. It does not sync changes into ClickUp, Slack or email.

## Private project content

This public repository contains application code and font assets. Client records, analytics and documents are kept in a **private Vercel Blob store** and returned only after workspace sign-in. They are not bundled into static pages or client JavaScript.

The server stores changes in a shared event ledger. Conditional writes preserve independent concurrent updates; an outdated edit to the same task or decision receives a conflict response. No project state is stored in browser localStorage. A completed task does not grant URL approval.

## Run locally

Use Node.js 24, copy `.env.example` to `.env.local`, and set a strong workspace passphrase (at least 16 characters) and an independent session signing secret (at least 32 characters).

```sh
npm ci
npm run dev
```

For isolated development, set `MIGRATION_LOCAL_STORE_DIR` to a disposable absolute directory. Local storage is unavailable when `NODE_ENV=production`. Production and preview use the connected private Blob store.

```sh
npm test
npm run typecheck
npm run build
```

## Vercel configuration

Connect the repository to a Next.js Vercel project using Node.js 24. Build with `npm run build` and install with `npm ci`. Connect a private Blob store and configure these server-only variables:

| Variable | Purpose |
| --- | --- |
| `MIGRATION_EDIT_PASSWORD` | Shared workspace access. A signed-in name is recorded with edits. |
| `MIGRATION_SESSION_SECRET` | Signs the HttpOnly, SameSite session cookie. |
| `BLOB_STORE_ID` | Blob store identifier for OIDC authentication. |
| `BLOB_READ_WRITE_TOKEN` | Optional token supplied by a token-based Vercel store connection; takes precedence when present. |

Sessions expire after 12 hours. Rotating the workspace passphrase or session secret revokes existing sessions. Credentials belong only in the deployment environment and must never be added to this repository.

Initial records and documents are uploaded through the authenticated content API. See `BACKEND.md` for the API contract and bootstrap process. Keep the source files and bootstrap credentials outside this repository.

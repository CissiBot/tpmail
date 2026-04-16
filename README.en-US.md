# TPMail

An aggregated frontend and proxy layer for temporary email workflows. TPMail is built with Next 16, React 19, TypeScript, and Tailwind 4, bringing mailbox creation, message reading, attachment entry points, and mail preview from multiple providers into one interface and API surface.

The repository is currently a **single-package npm project**. The root `package.json` provides the four scripts `dev`, `build`, `start`, and `lint`, and all runtime and verification steps should be based on the root directory.

> [!NOTE]
> Whether a provider is enabled is determined by each adapter's `descriptor.enabled` in `src/server/tpmail/providers/*.ts`. The README only documents the current implementation approach, it is not the final source of truth.

<!-- README-I18N:START -->

[中文](./README.md) | **English**

<!-- README-I18N:END -->

## Project Overview

This project provides a unified entry point for integrating multiple temporary email providers, and supports the following flow in the browser:

- View the list of available providers
- Create a temporary mailbox session through a shared prefix / suffix / credential flow
- Fetch inbox message lists
- Switch and manage cached mailbox records through the top mailbox bar
- View the plain text and HTML content of a single email
- Enter attachment downloads through API routes

The first screen on the homepage does not request `/api/providers` first. Instead, `src/app/page.tsx` calls `listProviders()` directly and injects the result into `src/components/tpmail/app-shell.tsx`.

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

After startup, you can access the app locally. `.env.example` contains placeholder credential entries for several providers, but actual enablement is still determined by `descriptor.enabled` in each provider adapter.

## Highlights

- **Unified provider entry**: The server aggregates 7 provider IDs, and the frontend renders them through a shared contract.
- **Server-side first screen injection**: The homepage calls `listProviders()` directly, avoiding an extra `/api/providers` request on the first screen.
- **Single-page workspace**: `src/components/tpmail/app-shell.tsx` handles provider switching, mailbox creation, domain prefetching, cached mailbox dropdowns, the record management modal, message reading, attachment entry points, and email preview.
- **Create after domain prefetch**: After switching providers, the frontend first requests `/api/providers/[providerId]/domains` to get available suffixes.
- **Compact mailbox creation panel**: The left-side address parameter area now focuses on mailbox prefix, mailbox suffix, the provider-specific credential field, and the create / random buttons.
- **Browser-managed sessions**: `public_address`, token-based sessions, and mailboxes backed by user-supplied API keys are stored in the current browser whenever possible instead of relying on the server-side in-process `Map`.
- **Cached mailbox records**: The browser keeps the latest 8 mailbox sessions. The top mailbox bar provides a quick dropdown, while the management button opens a dedicated table modal with sorting, multi-select, and deletion.
- **Bring-your-own API key**: `api_key` providers such as `inboxes` can now be used with a visitor's own API key instead of sharing an operator-managed secret.
- **Mailbox-bar refresh progress**: The top mailbox bar combines the address, copy action, cached-history entry points, management entry point, and refresh countdown into one area, with a filled 10-second progress indicator.
- **Automatic inbox refresh**: After a mailbox is created, the frontend polls the message list every 10 seconds, not through real-time push.
- **Dual-view reading**: The same email provides both a plain text reading area and an HTML iframe preview area.
- **HTML sandbox isolation**: The HTML body is displayed through the `sandbox` mode of an `iframe`, reducing isolation risks introduced by previewing.
- **Attachments still go through an API entry**: Attachments are resolved through the app's own route handler first, and the frontend opens the final upstream URL only after receiving it, so browser-managed credentials never need to appear in a query string.

## Architecture

The main frontend workspace is concentrated in `src/components/tpmail/app-shell.tsx`. It prefers `duckmail` by default, as long as that provider is enabled. In this component, users complete provider selection, mailbox creation, domain suffix switching, top-bar mailbox history switching, record management modal actions, message polling, opening individual emails, and accessing attachment download entry points.

The main backend flow is as follows:

```text
src/app/api/**/route.ts
-> src/server/tpmail/service.ts
-> src/server/tpmail/providers/*.ts
```

Specifically:

- `src/app/api/**/route.ts` handles Route Handlers under the App Router
- `src/server/tpmail/service.ts` handles provider aggregation, parameter validation, cache access, and session access
- `src/server/tpmail/providers/*.ts` contains each provider's adapter implementation
- `src/lib/tpmail/types.ts` and `src/lib/tpmail/errors.ts` define the shared types and error response contract

## State and Runtime Boundaries

> [!WARNING]
> The current implementation now has two state classes: provider caches and any mailbox sessions that still need server-side ownership stay in `src/server/tpmail/store.ts` through `globalThis + Map`, while `public_address` sessions, token-based sessions, and mailboxes backed by user-supplied API keys are primarily stored in browser `localStorage`. Neither side is persisted to a database, and neither is suitable for shared state across multiple instances.

- Provider list cache, domain cache, and any server-managed mailbox sessions all stay in the current Node process memory and are not persisted.
- Browser-managed mailbox snapshots, cached mailbox records, and user-supplied API keys stay only in the current browser and are not automatically synchronized to other devices or browser profiles.
- `/api/providers` and `/api/providers/[providerId]/domains` return the `x-tpmail-cache` response header to indicate cache hits or misses.
- When creating a mailbox, the backend validates the alias and only allows letters, numbers, dots, underscores, and hyphens.
- If a request includes a domain, the service layer applies a whitelist check against the provider's available domains. For `api_key` providers, that validation now runs with the API key supplied by the current browser.
- Attachment downloads are not static file serving. The attachment route handler resolves the upstream target first, and then the browser opens it explicitly.
- HTML email preview uses a sandboxed iframe, and this content should not be treated as directly trusted rendering.

## Development

This is a standard Next 16 App Router project, with Tailwind 4 used for styling. Tailwind is wired through `postcss.config.mjs` and `src/app/globals.css`, and having no `tailwind.config.*` in the repository is expected.

Use only the following commands for development verification:

```bash
npm run lint
npm run build
```

`next.config.ts` enables `output: "standalone"`, so the build output runs as a Node service, not as a static export site.

## Deployment

The repository includes containerized deployment files:

- `Dockerfile` uses a three-stage build, and the final runtime image is assembled from `.next/standalone`, `.next/static`, and `public`
- `compose.yaml` provides a local container startup method and injects environment variables from `.env`

The final runtime semantics are a **standalone Node service**. In production, the image starts with `node server.js` inside the container and exposes port `3000` by default.

If you plan to expose the app on a public VPS, the recommended operating mode is now:

- let anonymous / public-address providers live entirely in the browser
- let token-based providers keep their tokens in each visitor's browser
- let `api_key` providers consume the visitor's own API key instead of a shared operator secret

This significantly reduces the chance of turning the deployment into a shared secret-hosting proxy, but browser-managed sessions and API keys are still local data and are not meant for cross-device synchronization.

## API Overview

The current repository includes 7 route handlers, corresponding to the following endpoints:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/providers` | Returns the provider descriptor list, with the `x-tpmail-cache` header |
| `GET` | `/api/providers/:providerId/domains` | Returns the available domain list for the specified provider, with the `x-tpmail-cache` header |
| `POST` | `/api/mailboxes` | Creates a mailbox session; `api_key` providers may include the browser-supplied `apiKey` |
| `GET` | `/api/mailboxes/:mailboxId` | Reads the public mailbox session information |
| `GET` | `/api/mailboxes/:mailboxId/messages` | Fetches the mailbox message list |
| `GET` | `/api/mailboxes/:mailboxId/messages/:messageId` | Fetches a single email detail |
| `GET` | `/api/mailboxes/:mailboxId/messages/:messageId/attachments/:attachmentId` | Resolves the attachment download entry point; the frontend fetches the final URL and then lets the browser open it |

Error responses are normalized by `src/lib/tpmail/errors.ts`, and the response body includes fields such as `error.code`, `error.message`, `error.status`, and `error.retryable`.

For browser-managed mailboxes, mailbox snapshots are sent back through request headers on mailbox routes. Tokens and API keys are no longer carried through URL query parameters.

## Runtime Notes / Known Limitations

- Homepage provider data comes from a direct server-side `listProviders()` call, so the first screen should not be understood as the frontend requesting `/api/providers` first.
- Inbox updates rely on 10-second polling and do not include real-time push, WebSocket, or browser notification mechanisms.
- Provider enablement can change as the code changes, so you should inspect each provider adapter's `descriptor.enabled` directly when checking status.
- Server-managed mailbox sessions and provider caches still become invalid after a service restart, while browser-managed mailbox snapshots survive only inside the current browser.
- Under multi-instance deployment, the current implementation does not provide shared-session or shared-cache consistency guarantees, and browser-managed mailbox history does not synchronize across instances either.
- The top cached-mailbox dropdown and the management modal both depend on browser-local records. Changing devices, changing browsers, or clearing local storage requires recreating or restoring sessions.
- Local record management currently supports switching, sorting, multi-select, and deletion, but not cross-browser synchronization or server-side persistence.
- Whether attachments are available depends on whether the corresponding provider implements attachment URL resolution.

## Code Map

If you plan to continue development, these are usually the best entry points to start from:

- `src/app/page.tsx`, homepage server-side provider injection
- `src/components/tpmail/app-shell.tsx`, main frontend workspace
- `src/app/api/**/route.ts`, API route entry points
- `src/server/tpmail/service.ts`, service orchestration and validation
- `src/server/tpmail/store.ts`, in-process sessions and cache
- `src/server/tpmail/providers/*.ts`, provider adapters
- `src/lib/tpmail/types.ts`, shared type contract

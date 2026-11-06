# Changelog

This file tracks the history of the workspace as a whole (the split into independent packages). From
0.3.0 onward, each package has its own release history: [sonax-voip/CHANGELOG.md](sonax-voip/CHANGELOG.md)
and [sonax-chat/CHANGELOG.md](sonax-chat/CHANGELOG.md).

## 0.3.0 - Unreleased

### Changed
- Split Sonax VoIP and Sonax Chat out of the combined `n8n-nodes-sonax` package into two independently
  installable npm packages, `n8n-nodes-sonax-voip` (`sonax-voip/`) and `n8n-nodes-sonax-chat`
  (`sonax-chat/`). Each ships its own compiled node, credential, README, CHANGELOG and examples; neither
  depends on the other at runtime. This root became a private dev workspace (`npm workspaces`) that is
  never itself published.
- The node type identifiers changed again as a result: `n8n-nodes-sonax.sonaxVoip` /
  `n8n-nodes-sonax.sonaxChat` (0.2.0) become `n8n-nodes-sonax-voip.sonaxVoip` /
  `n8n-nodes-sonax-chat.sonaxChat`. Saved credential identifiers (`sonaxVoiceApi`, `sonaxChatApi`) are
  unaffected.
- Request/response helpers (`nodes/shared/`) are now duplicated per package rather than shared, since each
  package must build and publish independently.

### Migration
- `scripts/migrate-split-nodes.cjs` now converts workflows from either generation (the original combined
  `sonax` node, or the 0.2.0 two-nodes-one-package types) directly to the current per-package types in one
  step.

## 0.2.0 - Unreleased

### Changed
- Split the combined Sonax node into **Sonax VoIP** (9 operations) and **Sonax Chat** (4 operations), each with its own credentials, operation selector, and dropdown methods.
- Preserve the existing credential identifiers (`sonaxVoiceApi` and `sonaxChatApi`) so saved credentials can be reused. The Voice credential is now displayed as **Sonax VoIP API**.
- Update example workflows and mock integration tests to use the two node types.

### Migration
- The combined `n8n-nodes-sonax.sonax` / `CUSTOM.sonax` type is replaced by `sonaxVoip` and `sonaxChat` in the same namespace. Export existing workflows and run `scripts/migrate-split-nodes.cjs` before importing them with this version.

## 0.1.0 - Unreleased

### Added
- Sonax node with two resources and 13 operations.
  - Voice: Click to Call, Create Queue Campaign, Create IVR Campaign, Add Contact to Campaign, Add Contacts File to Campaign, Start Campaign, Stop Campaign, Get Call Recording, Get Call Status.
  - Chat: Send Official Message, Get Message, Create Contact, Create Kanban Task.
- Drop-downs loaded from the Sonax APIs that show names and send IDs: queues, campaigns, official channels, channel templates, users and bots.
- `Sonax Voice API` and `Sonax Chat API` credentials with a read-only connection test, restricted to the documented Sonax hosts.
- Errors reported by Sonax with HTTP 200 are raised as n8n errors.
- Automated tests for the operation scope, credentials, request validation, response handling and option loading (`npm test`).
- Integration tests using n8n's real declarative router and HTTP request conversion.
- Voice v1 pipe-delimited queue and campaign response parsing, verified with authorized read-only requests on 2026-10-22.
- Opt-in read-only Voice connectivity script with credential-safe output.
- Chat lookups (official channels, templates, users, bots) and the Voice v2 IVR list verified read-only on 2026-11-05.
- End-to-end tests (`npm run test:n8n`): workflows for all 13 operations run in a real n8n against a local Sonax mock, with the requests that reach the mock asserted. A second suite does what the editor does over its own REST endpoints: dropdowns, the credential Test button and manual "Execute workflow" runs (see `tests/n8n/README.md`).

### Changed
- The IVR drop-down of *Create IVR Campaign* loads from Voice v2. It uses a new optional `Voice V2 Password` credential field; the login ID is the Client ID. The node logs in each time the list is opened (the token lasts 24 hours and is never stored), so running workflows are not affected by the expiry. Without the password, switch the field to an expression and type the IVR ID.

### Fixed
- A contacts file that does not match the campaign layout is answered by Sonax with HTTP 200 and a text (`O arquivo contém valores que NÃO estão no formato do layout…`). It was reported as success; it is now an error that quotes Sonax's answer.
- Creating a campaign failed on the real API with HTTP 200 `Faltando parâmetros` (IVR) / `Campos obrigatorios nao informados` (queue) unless the user had set `Discard Voicemail` and `Auto Complete`. `qtd_simultanea`, `descarte_caixa_postal` and `auto_concluir` are now always sent (defaults `1`, `N`, `N`).
- Those two texts, and other `faltando…` / `campos obrigatorios…` / `nao informado…` answers, were reported as success. They are now errors that quote what Sonax said. Pipe-separated status lines are not affected.
- Click to Call reported success when Sonax answered a failed call with HTTP 200 and `Ligacao Falhou - Autenticacao Invalida`. Such answers are now errors.
- A wrong Voice Client ID or API Token, which Sonax answers with a redirect (HTTP 302) to an access-error page, now fails with `Sonax rejected the credentials` in workflows and in dropdowns, instead of a bare `Request failed with status code 302`. The Voice credential form explains the `status code 302` (n8n 2.23) or `Found` (n8n 2.46) shown by the connection test.
- Error descriptions now quote what Sonax answered (secrets in query strings masked).

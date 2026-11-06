# sonax-n8n-workspace

Development workspace for two independent n8n community node packages for [Sonax](https://sonax.net.br/). This root is **not itself a publishable package** (`private: true`); it only holds shared dev tooling, cross-package tests, and documentation. Each product ships as its own npm package, with its own README, CHANGELOG and version:

| Package | Folder | What it covers |
| --- | --- | --- |
| [`n8n-nodes-sonax-voip`](sonax-voip/README.md) | [`sonax-voip/`](sonax-voip/) | The 9 Voice/PBX operations (calls, dialer campaigns, IVR, recordings) and its own **Sonax VoIP API** credential. |
| [`n8n-nodes-sonax-chat`](sonax-chat/README.md) | [`sonax-chat/`](sonax-chat/) | The 4 Chat operations (official messages, contacts, Kanban tasks) and its own **Sonax Chat API** credential. |

Install only the package(s) you need. They do not depend on each other, and each only registers its own node and credential type in the n8n node picker — installing one never exposes the other's credential screen.

If you have workflows from an earlier combined `n8n-nodes-sonax` package (one node with a Voice/Chat resource selector, or two nodes in a single package), convert them locally without executing them:

```sh
node scripts/migrate-split-nodes.cjs workflow-original.json workflow-migrado.json
```

## Repository layout

```
sonax-voip/        # n8n-nodes-sonax-voip package: node, credential, tests, examples, README, CHANGELOG
sonax-chat/        # n8n-nodes-sonax-chat package: node, credential, tests, examples, README, CHANGELOG
scripts/           # migrate-split-nodes.cjs, test-live-voice.cjs
tests/             # cross-package tests: declarative routing, credential/dropdown scope, migration,
                   # and the end-to-end n8n suites (tests/n8n/)
```

`sonax-voip/nodes/shared/` and `sonax-chat/nodes/shared/` each hold that package's own copy of the request/response helpers (constants, load-options, request hooks, response parsing). They are deliberately duplicated, not symlinked or shared via a dependency: each package must build and publish on its own, with no inter-package runtime dependency.

## Development

```sh
npm ci              # installs both workspace packages
npm run build       # builds sonax-voip and sonax-chat
npm run lint        # lints both
npm test            # builds, runs each package's unit tests, then the cross-package tests
npm run test:n8n    # end-to-end: real n8n + local Sonax mock (see tests/n8n/README.md)
npm run dev:voip    # n8n-node dev for sonax-voip only
npm run dev:chat    # n8n-node dev for sonax-chat only
npm run pack:all    # builds and npm-packs both, .tgz written into each package folder
```

To preview a single package in an isolated n8n instance:

```sh
npm run dev:voip -- --custom-user-folder /tmp/sonax-n8n-preview
```

For a self-hosted n8n installation, build and pack the package(s) you need and install the generated `.tgz` into the community-nodes directory used by that instance. See the official [manual installation guide](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/).

## Validation

```sh
npm run lint
npm test
npm run test:n8n
```

Tests cover all 13 operation routes, per-package credential and dropdown registration, multipart byte preservation through n8n's HTTP conversion, parameter mapping, error handling, response normalization, dynamic options, and migration of existing workflow exports.

## API details requiring tenant validation

- The public collections contain no response examples for the operations that write data. The contacts file of *Add Contacts File to Campaign* must follow the layout configured in your Sonax PBX: a common one is `id;telefone;nome`, with the phone without the country code, no header and no blank line.
- Sonax does not specify the contacts upload file layout in the provided collection. Use a file known to be accepted by your PBX; the node preserves its contents.
- Board/column lookup endpoints and task priority enums are not documented. Board/column names and optional priority are passed as entered.

## Publishing

Before publishing either package, set its real repository URL in its `package.json`, verify package-name ownership and author metadata, configure npm Trusted Publishing for the repository, and complete live tenant acceptance tests for that product. The included GitHub workflow supports manual publication with provenance; it has not been run.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Sonax Voice (PBX) API documentation](https://documenter.getpostman.com/view/39712701/2sB34eH2J9)
* [Sonax Chat API documentation](https://documenter.getpostman.com/view/39712701/2sAY55ZHTG)

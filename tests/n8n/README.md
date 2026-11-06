# End-to-end tests in a real n8n

These run the node inside a real n8n (the same engine and editor endpoints you use), against a local
mock of the four Sonax hosts. **Nothing here can reach a real Sonax tenant**: in test mode the proxy
refuses every host except the four mocked ones, and the credentials used are fake.

```bash
N8N_BIN=/path/to/n8n npm run test:n8n          # both suites
N8N_BIN=/path/to/n8n node tests/n8n/run.cjs --only "Contacts File" --verbose
N8N_BIN=/path/to/n8n node tests/n8n/editor.cjs --only "wrong token"
```

Use an n8n version that is not older than the database it will open (for the default user folder,
`~/.n8n-node-cli`, that is whatever `npx n8n@latest` last downloaded for `npm run dev`).

| Suite | What it does |
| --- | --- |
| `run.cjs` | Imports the mock credentials and 19 workflows into an n8n user folder (default `~/.n8n-node-cli`, so they appear in the `npm run dev` editor), executes each one with `n8n execute`, and checks the node output **and the exact requests** that reached the mock: query string, form fields, JSON body, auth. Covers all 13 operations (one workflow each, plus `All 13 operations (one flow)` chaining them) and the error paths. |
| `smoke.cjs` | Proves the **live smoke-test workflow** (below) against the mock, in a throwaway n8n: the guard stops an unfilled `Config` before any request, a filled one runs all 13 operations chained through the IDs read from the answers, a missing extension skips only Click to Call, and a wrong Voice token still ends in the Summary with the Chat operations OK. |
| `editor.cjs` | Starts a throwaway n8n server (fresh database in the OS temp folder, free port) and does what you do in the editor, over the editor's own REST endpoints: opens every dropdown, presses the credential **Test** button, and runs **Execute workflow** on every workflow as a manual run, with the same checks as `run.cjs`. |

Flags: `--n8n <bin>`, `--node-prefix <prefix>`, `--only <text>`, `--verbose` (prints the redacted requests the
mock saw); `run.cjs` also takes `--user-folder <dir>` and `--skip-import`.

## Error paths covered

The mock reproduces failures **observed on the real Sonax API** (2026-10-29):

| Situation | Real behaviour | Workflow |
| --- | --- | --- |
| Voice v1, wrong Client ID or token | HTTP **302** to `/click2call/erro_acesso_click2call.php`, empty body | `Voice · Wrong token, redirect (must fail)` |
| Click to Call, wrong token | HTTP **200** with `Ligacao Falhou - Autenticacao Invalida` | `Voice · Click to Call wrong token, HTTP 200 text (must fail)` |
| Unknown call ID | HTTP **200** with `404 not found` | `Voice · Error returned with HTTP 200 (must fail)` |

All three must end as a clear n8n error, never as a success and never as a bare `status code 302`.

## How it works

- `mock-sonax.cjs` is an HTTPS proxy. n8n is started with `HTTPS_PROXY` pointing at it and
  `NODE_EXTRA_CA_CERTS` trusting a throwaway CA (generated with `openssl` into `.dev/mock-tls`, which
  is git-ignored), so the node, credentials and HTTP helpers run unchanged. It validates the fake
  credentials, records every request with secrets redacted, and replies with fixtures.
- `workflows.cjs` defines the workflows and, next to each, what it must send and return. `check.cjs`
  compares that with what happened; `server.cjs` boots the throwaway server.

The mock replies are plausible fixtures, **not captured from Sonax**, apart from the failure shapes
above and the pipe-delimited Voice v1 lists. The suites prove that the node
sends what the documentation says and handles the shapes it accepts; they cannot prove what Sonax
returns for success cases it has not documented.

## Using the mock workflows in your own editor

The `Sonax mock · …` workflows only succeed while the mock is running and n8n uses it as its proxy:

```bash
node tests/n8n/mock-sonax.cjs --passthrough     # prints the exact n8n start command
```

`--passthrough` is for interactive use and is **not** used by the tests. With it, read-only Voice lookups
(`lista_filas`, `lista_campanha`, `status_chamada`, `pega_gravacao`) that carry a real Client ID are
forwarded to the real API, so the `Sonax REAL · …` workflow works in the same n8n; everything else
(Click to Call, campaigns, uploads, all Chat) is answered by the mock only, and other hosts are tunnelled
untouched so the rest of n8n keeps working. Mutating requests are never forwarded.

## Live smoke test: all 13 operations, none disabled

`smoke-workflow.cjs` builds `Sonax REAL · Smoke test (13 operations, live)`: the 13 operations in one run against a **real**
tenant. Nothing is disabled. The protection is a guard: the `Check config` node stops the run, before anything is sent, until the
`Config` node has your phone number (55 + area code), your Sonax Chat e-mail and the Kanban board and column names. An empty
extension only skips Click to Call. Every Sonax node continues on error and the `Summary` node lists each operation as OK, FAILED
(with Sonax's answer) or SKIPPED. Campaign, call and message IDs are read from Sonax's answers, which are not documented; when one is
not found, paste it in the override fields of `Config` and run again.

```bash
node tests/n8n/smoke-workflow.cjs --out workflow.json [--voice-credential <id>:<name>] [--chat-credential <id>:<name>]
# stop n8n, then:
n8n import:workflow --separate --input=<folder with workflow.json>
```

It really does act: it creates two campaigns and one Chat contact, rings your phone (IVR campaign and Click to Call), sends one
WhatsApp template and creates one Kanban task. Use a test tenant.

## One flow with all 13 operations on a real tenant (all write operations disabled)

`real-workflow.cjs` builds `Sonax REAL · All 13 operations (one flow)`, the same 13 operations as the mock
flow but wired to a real Voice credential and with `PREENCHER_*` placeholders instead of fake data. As built
it cannot change anything: only the two read-only operations (Get Call Status, Get Call Recording) are
enabled, and they tolerate errors; every operation that changes data is **disabled**, and the Chat nodes
have no credential yet. Fill in and enable one node at a time.

```bash
node tests/n8n/real-workflow.cjs --out workflow.json [--voice-credential <id>:<name>]
# stop n8n, then:
n8n import:workflow --separate --input=<folder with workflow.json>
```

Start n8n **without** `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS` (plain `npm run dev`) so nothing goes through the mock.

## Things to know

- **Stop `npm run dev` first when using `run.cjs` against the default user folder.** `n8n execute`
  starts a second n8n on the same database and the same task-broker port (5679), and on startup it
  marks "unfinished" executions as crashed, which would hit anything running in your editor.
  (`editor.cjs` is unaffected: it has its own database and port.)
- **Node type names.** Linked into the custom folder (what `npm run dev` does), the nodes are
  `CUSTOM.sonaxVoip` and `CUSTOM.sonaxChat`. Installed as a community package, they are
  `n8n-nodes-sonax-voip.sonaxVoip` and `n8n-nodes-sonax-chat.sonaxChat`. Use `--node-prefix CUSTOM`
  (the default) or `--node-prefix community` accordingly. The workflow generators select
  the correct type for each operation. Existing combined-node or 0.2.0 two-node exports can be converted
  with `scripts/migrate-split-nodes.cjs` (run from the repository root).
- **Slow networks and `ETIMEDOUT`.** Node 20+ gives up on each connection attempt after 250 ms. On a slow link (here:
  0.4–0.8 s just to connect to the Sonax hosts) every request to Sonax fails with `ETIMEDOUT` although `curl` works. Start n8n
  for live runs with `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000 npm run dev`.
- **Symlink loops.** Never create an n8n user folder inside this project and link the project into it.
  n8n scans linked custom nodes recursively and fails with `ELOOP`. `editor.cjs` uses the OS temp
  folder for that reason.
- **Mock vs real credentials.** The mock workflows use credentials named `... (MOCK - fake token)` or
  `... (MOCK - WRONG token)`. Run without the mock, the real Sonax API rejects them (Voice: HTTP 302,
  Click to Call: `Autenticacao Invalida`), so nothing is ever done on a tenant.
- **The credential Test button** shows n8n's own message for a wrong credential, and its wording depends
  on the n8n version (Voice: `Request failed with status code 302` in 2.23, `Found` in 2.46; Chat:
  `Authorization failed` in 2.23, `Unauthorized` in 2.46). The Voice credential form carries a notice
  explaining the 302, and the suite accepts both wordings.

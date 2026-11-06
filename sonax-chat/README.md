# n8n-nodes-sonax-chat

This n8n community node package lets you use the [Sonax Chat](https://sonax.net.br/) API (official messaging, contacts, Kanban tasks) in your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the official [manual installation guide](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/) for community nodes, using the package name `n8n-nodes-sonax-chat`.

This is a sibling package to [`n8n-nodes-sonax-voip`](../sonax-voip/README.md), developed in the same repository. Install this one if you only need the Chat operations; install both if you also need Sonax VoIP.

## Operations

Add **Sonax Chat** to your workflow, then select its **Operation**:

| Operation | What it does |
| --- | --- |
| Send Official Message | Sends an approved template through an official messaging channel, optionally creating the contact, tagging the protocol, and assigning an attendant or bot. |
| Get Message | Returns the status and metadata of a message that was already sent. |
| Create Contact | Creates a contact in the chat base. |
| Create Kanban Task | Creates a task (card) on a Kanban board. |

### Selecting items by name

Official channel, template, user (attendant, Kanban assignee, participants, creator, contact owner), and bot fields are drop-downs filled from the Sonax Chat API: you see names/emails, the node sends the matching channel number, template name, user email or bot ID. You can always switch a field to an expression to supply a value yourself.

Kanban board and column names are typed exactly as they appear in Sonax, because the documented API takes names and has no endpoint to list them.

## Credentials

### Sonax Chat API

| Field | Description |
| --- | --- |
| API Token | Chat API token provided by Sonax. It is sent as a Bearer token. |

Saving the credential runs a read-only test (listing users). The credential refuses to send secrets to any host other than the documented Sonax Chat endpoints, and secrets are stored as password fields.

You need a Sonaxchat account. Sonax provides the API token.

## Compatibility

Built against `n8n-workflow` 2.16.0 (n8n nodes API version 1). Request routing is tested with the real `n8n-core` 2.23.1 declarative router. The package has no additional runtime dependencies.

If you have a workflow using an earlier combined `sonax` node, or the intermediate `n8n-nodes-sonax.sonaxChat` type, convert it locally without executing it. From the repository root:

```sh
node scripts/migrate-split-nodes.cjs workflow-original.json workflow-migrado.json
```

## Usage

Import the [get-message example](examples/get-message.json), select your Sonax Chat credential, and replace the placeholder ID with an existing message ID.

- **Send Official Message** — template parameters are sent in template order as the single comma-separated string that Sonax documents. Sonax documents no escaping, so a value containing a comma is rejected with an error instead of being sent incorrectly. Contact Data requires a name when used.
- **Create Kanban Task** — due date follows `YYYY-MM-DD`.
- The Sonax Chat API sometimes reports failures with HTTP 200 and an error body. The node turns those into regular n8n errors, so *Continue On Fail* and error workflows behave as expected.
- This node can also be used as an AI agent tool.

## Validation

```sh
npm run lint
npm test
```

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Sonax Chat API documentation](https://documenter.getpostman.com/view/39712701/2sAY55ZHTG)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

# n8n-nodes-sonax-voip

This n8n community node package lets you use the [Sonax](https://sonax.net.br/) PBX/Voice API (click-to-call, dialer campaigns, IVR, recordings) in your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the official [manual installation guide](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/) for community nodes, using the package name `n8n-nodes-sonax-voip`.

This is a sibling package to [`n8n-nodes-sonax-chat`](../sonax-chat/README.md), developed in the same repository. Install this one if you only need the Voice/PBX operations; install both if you also need Sonax Chat.

## Operations

Add **Sonax VoIP** to your workflow, then select its **Operation**:

| Operation | What it does |
| --- | --- |
| Click to Call | Originates a call from an extension to a phone number. |
| Create Queue Campaign | Creates a dialer campaign that sends answered calls to a human queue. |
| Create IVR Campaign | Creates a dialer campaign that sends answered calls to an IVR or voicebot. |
| Add Contact to Campaign | Adds one contact to an existing campaign's mailing. |
| Add Contacts File to Campaign | Adds many contacts at once by uploading a contacts file from a binary field. |
| Start Campaign | Puts a campaign into execution (play). |
| Stop Campaign | Stops an active campaign. |
| Get Call Recording | Returns the recording of a call: as binary audio, or as JSON when Sonax returns a link. |
| Get Call Status | Returns the status and outcome of a specific call. |

### Selecting items by name

Queue, campaign and IVR fields are drop-downs filled from the Sonax APIs: you see names, the node sends the matching ID. You can always switch a field to an expression to supply a value yourself, for example an ID coming from a previous node.

Extensions (Click to Call) have no listing endpoint and are typed.

The **IVR** drop-down comes from the Voice v2 API, which needs the optional *Voice V2 Password* (see Credentials). Without it, switch the IVR field to an expression and type the IVR ID shown in your Sonax PBX panel; *Create IVR Campaign* itself only uses the Voice v1 API.

## Credentials

### Sonax VoIP API

| Field | Description |
| --- | --- |
| Client ID | Provided by Sonax when your PBX was activated. |
| API Token | Voice API token (v1) provided by Sonax together with your Client ID. |
| Voice V2 Password | **Optional.** Only needed to load the IVR drop-down in *Create IVR Campaign*. The login ID is your Client ID. Each time the list is opened, the node logs in to the Voice v2 API (`POST https://apiv2.sonax.net.br/login`) and asks for the IVRs with a fresh token, which is valid for 24 hours and is never stored, so nothing expires in your workflows. |

Saving the credential runs a read-only test (listing queues). The credential refuses to send secrets to any host other than the documented Sonax endpoints, and secrets are stored as password fields.

You need a Sonax PBX account. Sonax provides the Client ID and tokens.

## Compatibility

Built against `n8n-workflow` 2.16.0 (n8n nodes API version 1). Request routing is tested with the real `n8n-core` 2.23.1 declarative router. The package has no additional runtime dependencies.

If you have a workflow using an earlier combined `sonax` node, or the intermediate `n8n-nodes-sonax.sonaxVoip` type, convert it locally without executing it. From the repository root:

```sh
node scripts/migrate-split-nodes.cjs workflow-original.json workflow-migrado.json
```

## Usage

Import the [call-status example](examples/get-call-status.json), select your Sonax VoIP credential, and replace the placeholder ID with an existing call ID.

- **Add Contacts File to Campaign** uploads the file from a binary field of the incoming item (default field name `data`) unchanged. Use a file format accepted by Sonax's *upload de arquivo de contato* action. Read the file with a node such as *Read/Write Files from Disk* or *HTTP Request* first.
- **Get Call Recording** writes audio to the binary field set in *Output Binary Field* (default `data`). If Sonax answers with a link or JSON instead of audio, that is returned as JSON.
- **Dates and times** follow the formats in Sonax's documentation: campaign start/end time `HH:mm:ss`, scheduled contact time `YYYY-MM-DD HH:mm:ss` (in the PBX time zone), weekdays 1-7 as configured in your PBX.
- The Sonax API sometimes reports failures with HTTP 200 and an error body. The node turns those into regular n8n errors, so *Continue On Fail* and error workflows behave as expected.
- This node can also be used as an AI agent tool. Binary-input/output operations (Add Contacts File to Campaign, Get Call Recording) depend on binary data flowing through the workflow and are not practical to call from an agent; prefer the other operations for AI-driven use.

## Validation

```sh
npm run lint
npm test
```

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Sonax Voice (PBX) API documentation](https://documenter.getpostman.com/view/39712701/2sB34eH2J9)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

#!/usr/bin/env node
'use strict';
const { nodeTypeFor } = require('./node-types.cjs');
// Exercises what you do in the n8n editor, through the editor's own REST endpoints of a real n8n server
// and against the local Sonax mock (nothing here can reach a real Sonax tenant):
//   1. every dropdown (load-options method), including a rejected credential;
//   2. the credential "Test" button;
//   3. "Execute workflow" on every workflow in workflows.cjs, as a manual run.
//
// The server runs in a throwaway user folder in the OS temp directory (fresh database, not your data).
//
//   node tests/n8n/editor.cjs --n8n <path-to-n8n-binary> [--node-prefix <prefix>] [--only <text>] [--verbose]
const { startServer, sleep } = require('./server.cjs');
const { forNodeTypes, credentials } = require('./workflows.cjs');
const { evaluateExecution, unflatten } = require('./check.cjs');

// Key of a stored credential: its type, plus which flavour of broken it is (the MOCK ones are named after it).
const keyOf = (credential) =>
	credential.type + (/WRONG V2/.test(credential.name) ? ':wrongV2' : /no V2/.test(credential.name) ? ':noV2' : credential.name.includes('WRONG') ? ':wrong' : '');
const ID = Object.fromEntries(credentials.map((credential) => [keyOf(credential), credential.id]));

const options = (...pairs) => pairs.map(([name, value]) => ({ name, value }));
// Parameters as the editor stores them for each situation.
const voiceParams = (operation) => ({ operation });
const chatParams = (operation, extra = {}) => ({ operation, ...extra });

// [label, load-options method, node parameters, credential, expected options | { error: text that must appear }]
const dropdowns = [
	['Voice · queue (Create Queue Campaign)', 'getVoiceQueues', voiceParams('createQueueCampaign'), 'sonaxVoiceApi', options(['Mock queue A', '100'], ['Mock queue B', '200'])],
	['Voice · campaign (Start Campaign)', 'getVoiceCampaigns', voiceParams('startCampaign'), 'sonaxVoiceApi', options(['Mock campaign one', '900001'], ['Mock campaign two', '900002'])],
	['Voice · IVR (Create IVR Campaign): logs in to V2 with the password', 'getVoiceIvrs', voiceParams('createIvrCampaign'), 'sonaxVoiceApi', options(['Mock IVR', '55'])],
	['Voice · IVR without a V2 password', 'getVoiceIvrs', voiceParams('createIvrCampaign'), 'sonaxVoiceApi:noV2', { error: 'Voice V2 Password' }],
	['Voice · IVR with a WRONG V2 password', 'getVoiceIvrs', voiceParams('createIvrCampaign'), 'sonaxVoiceApi:wrongV2', { error: 'Sonax rejected the credentials' }],
	['Voice · queue with a WRONG token', 'getVoiceQueues', voiceParams('createQueueCampaign'), 'sonaxVoiceApi:wrong', { error: 'Sonax rejected the credentials' }],
	['Chat · official channel (Send Official Message)', 'getOfficialChannels', chatParams('sendOfficialMessage'), 'sonaxChatApi', options(['Mock official channel', '5500000000001'])],
	['Chat · templates of the selected channel', 'getTemplates', chatParams('sendOfficialMessage', { from: '5500000000001' }), 'sonaxChatApi', options(['reminder', 'reminder'], ['welcome', 'welcome'])],
	['Chat · templates of a channel with none', 'getTemplates', chatParams('sendOfficialMessage', { from: '5599999999999' }), 'sonaxChatApi', []],
	['Chat · templates before a channel is chosen', 'getTemplates', chatParams('sendOfficialMessage', { from: '' }), 'sonaxChatApi', []],
	['Chat · attendant (user IDs)', 'getChatUsers', chatParams('sendOfficialMessage'), 'sonaxChatApi', options(['Ana Mock', 'u1'], ['Bruno Mock', 'u2'])],
	['Chat · Kanban users (emails)', 'getChatUserEmails', chatParams('createTask'), 'sonaxChatApi', options(['Ana Mock', 'ana@example.test'], ['Bruno Mock', 'bruno@example.test'])],
	['Chat · bots', 'getBots', chatParams('sendOfficialMessage'), 'sonaxChatApi', options(['Mock triage bot', 'b1'])],
];

// [label, stored credential id | inline credential, expected status, text or pattern the message must match]
const credentialTests = [
	['Voice credential with correct data', { stored: ID.sonaxVoiceApi }, 'OK'],
	// n8n shows its own message here, which depends on its version: "Request failed with status code 302"
	// (2.23) or "Found" (2.46). The Voice credential form explains both in a notice.
	['Voice credential with a WRONG token', { stored: ID['sonaxVoiceApi:wrong'] }, 'Error', /status code 302|Found/],
	['Chat credential with correct data', { stored: ID.sonaxChatApi }, 'OK'],
	['Chat credential with a WRONG token', { stored: ID['sonaxChatApi:wrong'] }, 'Error', /Authorization failed|Unauthorized/],
];

async function waitForExecution(call, executionId) {
	for (let i = 0; i < 120; i++) {
		const response = await call('GET', `executions/${executionId}`);
		const execution = response.json?.data;
		if (execution && !['new', 'running', 'waiting'].includes(execution.status)) return execution;
		await sleep(500);
	}
	throw new Error(`execution ${executionId} did not finish`);
}

function describeError(error) {
	if (!error) return '';
	return [error.message, error.description, ...(error.messages ?? [])].filter(Boolean).join(' | ');
}

async function main() {
	const argv = process.argv.slice(2);
	const arg = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
	const n8n = arg('n8n') ?? process.env.N8N_BIN ?? 'n8n';
	const nodePrefix = arg('node-prefix') ?? 'CUSTOM';
	const only = arg('only')?.toLowerCase();
	const verbose = argv.includes('--verbose');

	const server = await startServer({ n8n, nodePrefix });
	const { call, stored, mock } = server;
	const sonaxRefused = () => [...new Set(mock.refused)].filter((host) => /sonax/i.test(host));
	let failed = 0;
	let total = 0;
	const report = (ok, label, detail, problems = []) => {
		total++;
		if (!ok) failed++;
		console.log(`${ok ? '✔' : '✖'} ${label}${detail ? `  →  ${detail}` : ''}`);
		for (const problem of problems) console.log(`    - ${problem}`);
	};

	try {
		console.log(`n8n server: ${server.base} (throwaway folder ${server.folder})\nnode prefix: ${nodePrefix}\n`);

		console.log('── Dropdowns ──');
		for (const [label, methodName, currentNodeParameters, credentialKey, expected] of dropdowns) {
			if (only && !label.toLowerCase().includes(only)) continue;
			const credentialType = credentialKey.split(':')[0];
			const response = await call('POST', 'dynamic-node-parameters/options', {
				path: 'parameters.dropdown',
				methodName,
				nodeTypeAndVersion: { name: nodeTypeFor(credentialType === 'sonaxVoiceApi' ? 'voice' : 'chat', nodePrefix), version: 1 },
				currentNodeParameters,
				credentials: { [credentialType]: stored[ID[credentialKey]] },
			});
			if (Array.isArray(expected)) {
				const actual = response.json?.data ?? response.json;
				const shown = Array.isArray(actual) ? actual.map(({ name, value }) => ({ name, value })) : actual;
				const ok = response.status === 200 && JSON.stringify(shown) === JSON.stringify(expected);
				report(ok, label, ok ? (expected.length ? expected.map((o) => o.name).join(', ') : '(empty)') : '', ok ? [] : [`HTTP ${response.status}; expected ${JSON.stringify(expected)}; got ${response.text.slice(0, 300)}`]);
			} else {
				const ok = response.status !== 200 && response.text.includes(expected.error) && !/SECRET|wrong-token|v2-password/.test(response.text);
				report(ok, label, ok ? `error "${expected.error}"` : '', ok ? [] : [`HTTP ${response.status}; expected an error containing "${expected.error}"; got ${response.text.slice(0, 300)}`]);
			}
		}

		console.log('\n── Credential "Test" button ──');
		for (const [label, source, status, message] of credentialTests) {
			if (only && !label.toLowerCase().includes(only)) continue;
			const credential = source.stored
				? { id: stored[source.stored].id, name: stored[source.stored].name, type: credentials.find((c) => c.id === source.stored).type, data: credentials.find((c) => c.id === source.stored).data }
				: { id: 'inline', ...source.inline };
			const response = await call('POST', 'credentials/test', { credentials: credential });
			const result = response.json?.data;
			const problems = [];
			if (result?.status !== status) problems.push(`expected status ${status}, got ${JSON.stringify(result ?? response.text.slice(0, 200))}`);
			else if (message && !(message instanceof RegExp ? message.test(String(result.message)) : String(result.message).includes(message))) problems.push(`expected a message matching ${message}, got "${result.message}"`);
			report(problems.length === 0, label, result ? `${result.status}${result.message ? `: ${result.message}` : ''}` : '', problems);
		}

		console.log('\n── "Execute workflow" in the editor (manual run) ──');
		for (const definition of forNodeTypes(nodePrefix)) {
			if (only && !definition.name.toLowerCase().includes(only)) continue;
			// The server assigns its own credential ids.
			const nodes = definition.nodes.map((node) => ({
				...node,
				credentials: node.credentials
					? Object.fromEntries(Object.entries(node.credentials).map(([type, reference]) => [type, stored[reference.id]]))
					: undefined,
			}));
			const created = await call('POST', 'workflows', { name: definition.name, nodes, connections: definition.connections, settings: definition.settings, active: false });
			const workflowId = created.json?.data?.id;
			if (!workflowId) {
				report(false, definition.name, '', [`could not create the workflow: HTTP ${created.status} ${created.text.slice(0, 200)}`]);
				continue;
			}
			mock.reset();
			const started = Date.now();
			const run = await call('POST', `workflows/${workflowId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
			const executionId = run.json?.data?.executionId;
			if (!executionId) {
				report(false, definition.name, '', [`could not start the run: HTTP ${run.status} ${run.text.slice(0, 300)}`]);
				continue;
			}
			const execution = await waitForExecution(call, executionId);
			const data = typeof execution.data === 'string' ? unflatten(execution.data) : execution.data;
			const resultData = data?.resultData ?? {};
			const outcome = {
				succeeded: execution.status === 'success',
				errorText: describeError(resultData.error),
				runData: resultData.runData,
			};
			if (verbose) for (const request of mock.requests) console.log(`    request: ${JSON.stringify({ ...request, headers: undefined })}`);
			const problems = evaluateExecution(definition, outcome, mock.requests, sonaxRefused());
			report(problems.length === 0, definition.name, `${((Date.now() - started) / 1000).toFixed(1)}s`, problems);
		}
	} finally {
		console.log(`\n${total - failed}/${total} checks passed.`);
		await server.stop(failed > 0);
	}
	process.exit(failed ? 1 : 0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

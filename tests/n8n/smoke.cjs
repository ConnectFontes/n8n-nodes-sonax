#!/usr/bin/env node
'use strict';
// Proves the live smoke-test workflow (tests/n8n/smoke-workflow.cjs) against the local Sonax MOCK, in a throwaway n8n
// (nothing here can reach a real Sonax tenant):
//   A. with the Config node left as shipped (PREENCHER_*), nothing is sent: the guard stops the run before any request;
//   B. with a filled Config, all 13 operations run, chained through the IDs read from Sonax's answers;
//   C. without an extension, only Click to Call is skipped; without Kanban data only the task is skipped (E);
//   D. with a wrong Voice token every Voice operation fails, the run still reaches the Summary and Chat still works.
//
//   node tests/n8n/smoke.cjs --n8n <path-to-n8n-binary> [--node-prefix <prefix>] [--verbose]
const { startServer, sleep } = require('./server.cjs');
const { credentials, VOICE_CREDENTIAL, CHAT_CREDENTIAL, BAD_VOICE_CREDENTIAL } = require('./workflows.cjs');
const { unflatten } = require('./check.cjs');
const { build, REAL_CONFIG, OPERATIONS } = require('./smoke-workflow.cjs');

const MOCK_CONFIG = {
	...REAL_CONFIG,
	phone: '5500000000002',
	extension: '9999',
	kanbanBoard: 'Sales',
	kanbanColumn: 'TO DO',
	userEmail: 'ana@example.test',
	ivrId: '55',
	queueId: '100',
	chatChannel: '5500000000001',
	chatTemplate: 'welcome',
};

async function waitForExecution(call, executionId) {
	for (let i = 0; i < 240; i++) {
		const response = await call('GET', `executions/${executionId}`);
		const execution = response.json?.data;
		if (execution && !['new', 'running', 'waiting'].includes(execution.status)) return execution;
		await sleep(500);
	}
	throw new Error(`execution ${executionId} did not finish`);
}

async function main() {
	const argv = process.argv.slice(2);
	const arg = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
	const n8n = arg('n8n') ?? process.env.N8N_BIN ?? 'n8n';
	const nodePrefix = arg('node-prefix') ?? 'CUSTOM';
	const verbose = argv.includes('--verbose');

	const server = await startServer({ n8n, nodePrefix });
	const { call, stored, mock } = server;
	let failed = 0;
	let total = 0;
	const check = (ok, label, detail) => {
		total++;
		if (!ok) failed++;
		console.log(`${ok ? '✔' : '✖'} ${label}${detail ? `  →  ${detail}` : ''}`);
	};

	async function run(label, options) {
		const definition = build({ nodePrefix, waitSeconds: 1, retryWaitMs: 100, voiceCredential: VOICE_CREDENTIAL, chatCredential: CHAT_CREDENTIAL, ...options });
		const resolve = (credential) => stored[credential.id];
		const nodes = definition.nodes.map((node) => ({
			...node,
			credentials: node.credentials ? Object.fromEntries(Object.entries(node.credentials).map(([type, reference]) => [type, resolve(reference)])) : undefined,
		}));
		const created = await call('POST', 'workflows', { name: `${definition.name} (${label})`, nodes, connections: definition.connections, settings: definition.settings, active: false });
		const workflowId = created.json?.data?.id;
		if (!workflowId) throw new Error(`could not create the workflow: HTTP ${created.status} ${created.text.slice(0, 300)}`);
		mock.reset();
		const started = await call('POST', `workflows/${workflowId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
		const executionId = started.json?.data?.executionId;
		if (!executionId) throw new Error(`could not start the run: HTTP ${started.status} ${started.text.slice(0, 300)}`);
		const execution = await waitForExecution(call, executionId);
		const data = typeof execution.data === 'string' ? unflatten(execution.data) : execution.data;
		const resultData = data?.resultData ?? {};
		const summary = resultData.runData?.Summary?.[0]?.data?.main?.[0]?.[0]?.json;
		// Some n8n task-runner versions split Code-node messages at colons. The stack's
		// first line retains the original thrown message, including the Config guard.
		const error = resultData.error ? [resultData.error.stack?.split('\n')[0], resultData.error.message, resultData.error.description].filter(Boolean).join(' | ') : '';
		if (verbose) for (const request of mock.requests) console.log(`    request: ${JSON.stringify({ ...request, headers: undefined })}`);
		return { execution, summary, error, requests: mock.requests };
	}
	const acao = (requests, name) => requests.filter((r) => r.query?.acao === name || (r.form && r.form.acao === name));

	try {
		console.log(`n8n server: ${server.base}\nnode prefix: ${nodePrefix}\n`);

		// A. The guard.
		const a = await run('A: Config left as shipped', {});
		check(a.execution.status === 'error' && /Nada foi enviado/.test(a.error), 'A · unfilled Config stops the run with a clear message', a.error.slice(0, 120));
		check(a.requests.length === 0, 'A · and not a single request reached Sonax', `${a.requests.length} requests`);

		// B. Everything filled.
		const b = await run('B: all 13', { config: MOCK_CONFIG });
		check(b.execution.status === 'success', 'B · the run finishes', b.execution.status + (b.error ? ` (${b.error})` : ''));
		check(b.summary?.ok === 13 && b.summary?.falhou === 0, 'B · Summary: 13 of 13 operations OK', b.summary ? `${b.summary.resumo}; failed ${b.summary.falhou}` : 'no summary');
		const named = Object.fromEntries((b.summary?.report ?? []).map((r) => [r.operation, r.status]));
		check(OPERATIONS.every((name) => named[name] === 'OK'), 'B · every one of the 13 operations is reported OK', OPERATIONS.filter((n) => named[n] !== 'OK').join(', ') || 'all OK');
		const nothingElseCancelled = OPERATIONS.length === 13;
		check(nothingElseCancelled, 'B · the workflow covers exactly the 13 operations of the scope');
		const voice = (name) => acao(b.requests, name);
		const sent = {
			'criar_campanha_ura_reversa': voice('criar_campanha_ura_reversa').length === 1,
			'cria_campanha': voice('cria_campanha').length === 1,
			'chamada': voice('chamada').length === 1,
			'play_campanha': voice('play_campanha').length === 1,
			'stop_campanha': voice('stop_campanha').length === 1,
			'upload_arquivo_contato': b.requests.some((r) => r.form?.acao === 'upload_arquivo_contato'),
			'status_chamada': voice('status_chamada').length === 1,
			'pega_gravacao': voice('pega_gravacao').length === 1,
			'click2call': b.requests.some((r) => r.host === 'click2call.sonax.net.br'),
			'create-contact': b.requests.some((r) => r.pathname === '/v2/task-api/create-contact'),
			'send-message-protocol': b.requests.some((r) => r.pathname === '/v2/send-message-protocol'),
			'message-data': b.requests.some((r) => r.pathname.startsWith('/v2/message-data/')),
			'create-task': b.requests.some((r) => r.pathname === '/v2/task-api/create-task'),
		};
		check(Object.values(sent).every(Boolean), 'B · the mock received each of the 13 requests exactly as expected', Object.entries(sent).filter(([, ok]) => !ok).map(([k]) => k).join(', ') || '13 of 13');
		// IDs are chained from Sonax's answers (mock: campaign 900100, call 6011854393, message msg-123).
		check(voice('chamada')[0]?.query?.id_campanha === '900100', 'B · the contact was added to the campaign that was just created', String(voice('chamada')[0]?.query?.id_campanha));
		check(voice('play_campanha')[0]?.query?.id_campanha === '900100' && voice('stop_campanha')[0]?.query?.id_campanha === '900100', 'B · the same campaign is started and stopped');
		check(voice('status_chamada')[0]?.query?.id_chamada === '28137648036', 'B · the call ID is read from the Click to Call answer', String(voice('status_chamada')[0]?.query?.id_chamada));
		const created = [voice('criar_campanha_ura_reversa')[0]?.query ?? {}, voice('cria_campanha')[0]?.query ?? {}];
		const upload = b.requests.find((r) => r.form?.acao === 'upload_arquivo_contato');
		check(upload?.form?.arquivo?.text === '1;' + MOCK_CONFIG.phone.slice(2) + ';TESTE n8n', 'B · the contacts file uses the layout Sonax accepts: id;telefone;nome, phone without 55, no header, no blank line', JSON.stringify(upload?.form?.arquivo?.text));
		check(created.every((q) => q.descarte_caixa_postal === 'N' && q.auto_concluir === 'N' && q.qtd_simultanea === '1'), 'B · both campaigns are created with the fields Sonax requires (otherwise it answers "Faltando parâmetros")');
		check(b.requests.some((r) => r.pathname === '/v2/message-data/msg-123'), 'B · the message ID is read from the send answer');
		const sentMessage = b.requests.find((r) => r.pathname === '/v2/send-message-protocol');
		check(sentMessage?.json?.paramsTemplate === 'Teste n8n,ok' && sentMessage?.json?.from === '5500000000001' && sentMessage?.json?.to === '5500000000002', 'B · the message goes out with the template parameters, channel and recipient', JSON.stringify({ p: sentMessage?.json?.paramsTemplate }));
		const ivr = voice('criar_campanha_ura_reversa')[0]?.query ?? {};
		check(ivr.id_ura === '55' && ivr.hora_ini === '00:00:00' && ivr.hora_fim === '23:59:59' && ivr.dia_semana_ini === '1' && ivr.dia_semana_fim === '7', 'B · the IVR campaign can dial at any hour, so the test works whenever it is run');

		// C. No extension.
		const c = await run('C: no extension', { config: { ...MOCK_CONFIG, extension: 'PREENCHER_RAMAL' } });
		const cNamed = Object.fromEntries((c.summary?.report ?? []).map((r) => [r.operation, r.status]));
		check(c.execution.status === 'success' && c.summary?.ok === 12 && /IGNORADO/.test(cNamed['Click to Call'] ?? ''), 'C · without an extension only Click to Call is skipped', c.summary ? `${c.summary.resumo}; Click to Call: ${cNamed['Click to Call']}` : c.error);
		check(!c.requests.some((r) => r.host === 'click2call.sonax.net.br'), 'C · and no Click to Call request is sent');

		// E. Only the phone number is filled in: Click to Call and the Kanban task are skipped, the other 11 run.
		const e = await run('E: phone only', { config: { ...MOCK_CONFIG, extension: 'PREENCHER_RAMAL', kanbanBoard: 'PREENCHER_QUADRO', kanbanColumn: 'PREENCHER_COLUNA', userEmail: 'PREENCHER_SEU_EMAIL' } });
		const eNamed = Object.fromEntries((e.summary?.report ?? []).map((r) => [r.operation, r.status]));
		check(e.execution.status === 'success' && e.summary?.ok === 11 && e.summary?.ignoradas === 2 && /IGNORADO/.test(eNamed['Click to Call'] ?? '') && /IGNORADO/.test(eNamed['Create Kanban Task'] ?? ''), 'E · with only the phone, Click to Call and the Kanban task are skipped and the other 11 operations run', e.summary ? `${e.summary.resumo}; ignoradas ${e.summary.ignoradas}` : e.error);
		check(!e.requests.some((r) => r.host === 'click2call.sonax.net.br' || r.pathname === '/v2/task-api/create-task'), 'E · and neither of them sends a request');

		// D. Wrong Voice token: failures are reported, the run still ends and Chat still works.
		const d = await run('D: wrong Voice token', { config: MOCK_CONFIG, voiceCredential: BAD_VOICE_CREDENTIAL });
		const dNamed = Object.fromEntries((d.summary?.report ?? []).map((r) => [r.operation, r.status]));
		const chatOk = ['Create Contact', 'Send Official Message', 'Get Message', 'Create Kanban Task'].every((n) => dNamed[n] === 'OK');
		const voiceFailed = OPERATIONS.slice(0, 9).every((n) => dNamed[n] === 'FALHOU');
		check(d.execution.status === 'success' && chatOk && voiceFailed, 'D · wrong Voice token: all 9 Voice operations FAIL in the Summary, the 4 Chat operations still run', d.summary ? `${d.summary.resumo}` : d.error);
		const detail = (d.summary?.report ?? []).find((r) => r.operation === 'Create IVR Campaign')?.detail ?? '';
		check(/rejected the credentials/.test(detail) && !/wrong-token|mock-token/.test(JSON.stringify(d.summary ?? {})), 'D · the failure says what happened and leaks no token', detail.slice(0, 80));
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

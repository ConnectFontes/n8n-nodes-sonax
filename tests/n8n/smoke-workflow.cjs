#!/usr/bin/env node
'use strict';
const { nodeTypeFor } = require('./node-types.cjs');
// Builds "Sonax REAL · Smoke test (13 operations, live)": every one of the 13 operations enabled, in one run,
// against a REAL tenant. Nothing is disabled. What protects you from a careless click is a guard instead:
// the `Check config` node stops the run, before anything is sent, until the `Config` node has a valid phone number.
// The extension and the Kanban data are optional: without them only Click to Call / the Kanban task are skipped.
//
//   Manual Trigger → Config → Check config → Voice (9 operations) → Chat (4 operations) → Summary
//
// Every Sonax node continues on error, so one failure never hides the others; `Summary` lists each
// operation as OK or FAILED with the Sonax answer. IDs created along the way (campaigns, call, message) are
// read from Sonax's own responses, which are not documented: when that fails, paste the ID in `Config`
// (the optional "override" fields) and run again.
//
//   node tests/n8n/smoke-workflow.cjs --out workflow.json [--node-prefix CUSTOM]
//        [--voice-credential <id>:<name>] [--chat-credential <id>:<name>]
//   n8n import:workflow --separate --input=<folder with workflow.json>   (with n8n stopped)
const fs = require('node:fs');
const { uuid, trigger } = require('./workflows.cjs');

const ID = 'SxRealSmokeTest';
const NAME = 'Sonax REAL · Smoke test (13 operations, live)';
const REAL_VOICE = { id: 'SonaxRealVoice01', name: 'Sonax Voice API (real tenant)' };
const REAL_CHAT = { id: 'SonaxRealChat01', name: 'Sonax Chat API (test tenant)' };

// Values known from the test tenant (2026-11-05); the PREENCHER_* ones can only come from the person running it.
const REAL_CONFIG = {
	phone: 'PREENCHER_SEU_NUMERO_COM_55_E_DDD',
	extension: 'PREENCHER_RAMAL',
	kanbanBoard: 'PREENCHER_QUADRO',
	kanbanColumn: 'PREENCHER_COLUNA',
	userEmail: 'PREENCHER_SEU_EMAIL_NO_SONAX_CHAT',
	ivrId: '271782',
	queueId: '992482',
	chatChannel: '551740404799',
	chatTemplate: 'common_status',
	ivrCampaignId: '',
	queueCampaignId: '',
	callId: '',
	messageId: '',
};

const code = (...lines) => lines.join('\n');

// Sonax's JSON answers carry `error: false` on success; only a truthy `error` (a node that failed and continued, or an error body) is a failure.
const IS_ERROR = 'const isError = (j) => !!j && j.error !== undefined && j.error !== false && j.error !== null && j.error !== "";';

const CHECK_CONFIG = code(
	"const c = $('Config').first().json;",
	'const placeholder = (v) => v === undefined || v === null || String(v).trim() === "" || /^PREENCHER/i.test(String(v));',
	'const problems = [];',
	'const phone = String(c.phone ?? "").replace(/\\D/g, "");',
	'if (!/^55\\d{10,11}$/.test(phone)) problems.push("phone: seu número com 55 + DDD, só dígitos (ex.: 5511999999999)");',
	'for (const key of ["ivrId", "queueId", "chatChannel", "chatTemplate"]) if (placeholder(c[key])) problems.push(key + ": obrigatório");',
	'if (problems.length) throw new Error("Nada foi enviado. Preencha o nó Config e rode de novo. Pendências: " + problems.join(" | "));',
	'const pad = (n) => String(n).padStart(2, "0");',
	'const now = new Date();',
	'const runId = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes());',
	'const hasKanban = !placeholder(c.kanbanBoard) && !placeholder(c.kanbanColumn) && !placeholder(c.userEmail) && String(c.userEmail).includes("@");',
	'return [{ json: { ...c, phone, phoneLocal: phone.slice(2), runId, hasExtension: !placeholder(c.extension), hasKanban } }];',
);

// First number of 5+ digits in Sonax's answer (the campaign ID), or the override from Config.
const campaignIdCode = (createNode, overrideField) =>
	code(
		"const config = $('Check config').first().json;",
		`const source = $('${createNode}').first().json;`,
		IS_ERROR,
		`let id = String(config.${overrideField} ?? '').trim() || null;`,
		'const from = id ? "override do Config" : "resposta da Sonax";',
		'if (!id && !isError(source)) { const m = JSON.stringify(source).match(/\\d{5,}/); if (m) id = m[0]; }',
		'return [{ json: { campaignId: id, from: id ? from : "NÃO ENCONTRADO: copie o ID da campanha da resposta ou do painel e cole no Config", response: source } }];',
	);

const CALL_ID = code(
	"const config = $('Check config').first().json;",
	IS_ERROR,
	'let id = String(config.callId ?? "").trim() || null;',
	'let from = id ? "override do Config" : "";',
	'if (!id) {',
	'  for (const name of ["Click to Call", "Add Contact to Campaign"]) {',
	'    let json; try { json = $(name).first().json; } catch (e) { continue; }',
	'    if (!json || isError(json)) continue;',
	'    const m = (JSON.stringify(json).match(/\\d{8,}/g) || []).find((n) => n !== config.phone);',
	'    if (m) { id = m; from = "resposta de " + name; break; }',
	'  }',
	'}',
	'return [{ json: { callId: id, from: id ? from : "NÃO ENCONTRADO: pegue o ID da chamada no relatório do painel e cole no Config" } }];',
);

const MESSAGE_ID = code(
	"const config = $('Check config').first().json;",
	IS_ERROR,
	'let id = String(config.messageId ?? "").trim() || null;',
	'let from = id ? "override do Config" : "";',
	'if (!id) {',
	'  let json; try { json = $("Send Official Message").first().json; } catch (e) { json = undefined; }',
	'  const keys = ["messageId", "message_id", "idMessage", "id", "_id", "protocolId", "protocol"];',
	'  const find = (value, depth) => {',
	'    if (!value || typeof value !== "object" || depth > 3) return undefined;',
	'    for (const key of keys) if (typeof value[key] === "string" || typeof value[key] === "number") return String(value[key]);',
	'    for (const inner of Object.values(value)) { const found = find(inner, depth + 1); if (found) return found; }',
	'    return undefined;',
	'  };',
	'  if (json && !isError(json)) { id = find(json, 0) || null; if (id) from = "resposta do envio"; }',
	'}',
	'return [{ json: { messageId: id, from: id ? from : "NÃO ENCONTRADO: copie o ID da resposta do envio e cole no Config" } }];',
);

const OPERATIONS = [
	'Create IVR Campaign',
	'Add Contact to Campaign',
	'Start Campaign',
	'Stop Campaign',
	'Create Queue Campaign',
	'Add Contacts File to Campaign',
	'Click to Call',
	'Get Call Status',
	'Get Call Recording',
	'Create Contact',
	'Send Official Message',
	'Get Message',
	'Create Kanban Task',
];

const SUMMARY = code(
	IS_ERROR,
	`const names = ${JSON.stringify(OPERATIONS)};`,
	'const text = (v) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));',
	'const report = names.map((operation) => {',
	'  let items; try { items = $(operation).all(); } catch (e) { items = []; }',
	'  const skipped = { "Click to Call": "IGNORADO (sem ramal no Config)", "Create Kanban Task": "IGNORADO (sem quadro, coluna ou e-mail no Config)" };',
	'  if (!items.length) return { operation, status: skipped[operation] || "NÃO EXECUTOU", detail: "" };',
	'  const json = items[0].json || {};',
	'  if (isError(json)) {',
	'    const e = json.error; const detail = typeof e === "string" ? e : [e.message, e.description].filter(Boolean).join(" | ");',
	'    return { operation, status: "FALHOU", detail: detail.slice(0, 300) };',
	'  }',
	'  const binary = items[0].binary ? " [arquivo: " + Object.keys(items[0].binary).join(",") + "]" : "";',
	'  const call = operation === "Get Call Status" && typeof json.result === "string" && json.result.includes("|") ? "status da chamada: " + json.result.split("|")[0] + " | " : "";',
	'  return { operation, status: "OK", detail: call + text(json).slice(0, 300) + binary };',
	'});',
	'const ok = report.filter((r) => r.status === "OK").length;',
	'return [{ json: { resumo: ok + " de 13 operações OK", ignoradas: report.filter((r) => r.status.startsWith("IGNORADO")).length, ok, falhou: report.filter((r) => r.status === "FALHOU").length, ids: { campanhaURA: $("IVR campaign ID").first().json.campaignId, campanhaFila: $("Queue campaign ID").first().json.campaignId, chamada: $("Call ID").first().json.callId, mensagem: $("Message ID").first().json.messageId }, report } }];',
);

const WINDOW = { concurrentCalls: 1, startTime: '00:00:00', endTime: '23:59:59', startWeekday: 1, endWeekday: 7 };

function build({
	nodePrefix = 'CUSTOM',
	voiceCredential = REAL_VOICE,
	chatCredential = REAL_CHAT,
	config = REAL_CONFIG,
	waitSeconds = 25,
	retryWaitMs = 3000,
} = {}) {
	const ref = (field) => `={{ $('Check config').first().json.${field} }}`;
	const expr = (body) => `={{ ${body} }}`;
	const chk = (field) => `$('Check config').first().json.${field}`;
	const nodes = [];
	const add = (node) => (nodes.push(node), node);
	const helper = (name, type, typeVersion, parameters) =>
		add({ id: uuid(`${ID}:${name}`), name, type, typeVersion, parameters });
	// A failed request is retried up to 3 times (n8n only retries when the call fails). Not for Click to Call (it could ring twice)
	// nor for the recording (a missing recording is a normal answer).
	const noRetry = new Set(['Click to Call', 'Get Call Recording']);
	const sonax = (name, resource, parameters) =>
		add({
			id: uuid(`${ID}:${name}`),
			name,
			type: nodeTypeFor(resource, nodePrefix),
			typeVersion: 1,
			parameters: { ...parameters },
			credentials: resource === 'voice' ? { sonaxVoiceApi: voiceCredential } : { sonaxChatApi: chatCredential },
			onError: 'continueRegularOutput',
			...(resource === 'voice' && !noRetry.has(name) ? { retryOnFail: true, maxTries: 3, waitBetweenTries: retryWaitMs } : {}),
		});

	const start = add(trigger(ID));
	helper('Config', 'n8n-nodes-base.set', 3.4, {
		assignments: {
			assignments: Object.entries(config).map(([name, value]) => ({ id: uuid(`${ID}:cfg:${name}`), name, type: 'string', value })),
		},
		options: {},
	});
	helper('Check config', 'n8n-nodes-base.code', 2, { jsCode: CHECK_CONFIG });

	// ── Voice ─────────────────────────────────────────────────────────────────
	sonax('Create IVR Campaign', 'voice', {
		operation: 'createIvrCampaign',
		campaignName: expr(`'TESTE n8n URA ' + ${chk('runId')}`),
		ivrId: ref('ivrId'),
		campaignOptions: WINDOW,
	});
	helper('IVR campaign ID', 'n8n-nodes-base.code', 2, { jsCode: campaignIdCode('Create IVR Campaign', 'ivrCampaignId') });
	sonax('Add Contact to Campaign', 'voice', {
		operation: 'addCampaignContact',
		campaignId: expr("$('IVR campaign ID').first().json.campaignId"),
		contactId: expr(`'smoke-' + ${chk('runId')}`),
		number: ref('phone'),
		priority: 1,
	});
	sonax('Start Campaign', 'voice', { operation: 'startCampaign', campaignId: expr("$('IVR campaign ID').first().json.campaignId") });
	helper('Wait for the call', 'n8n-nodes-base.wait', 1.1, { resume: 'timeInterval', amount: waitSeconds, unit: 'seconds' });
	sonax('Stop Campaign', 'voice', { operation: 'stopCampaign', campaignId: expr("$('IVR campaign ID').first().json.campaignId") });
	sonax('Create Queue Campaign', 'voice', {
		operation: 'createQueueCampaign',
		campaignName: expr(`'TESTE n8n fila ' + ${chk('runId')}`),
		queueId: ref('queueId'),
		campaignOptions: WINDOW,
		queueOptions: { attempts: 1 },
	});
	helper('Queue campaign ID', 'n8n-nodes-base.code', 2, { jsCode: campaignIdCode('Create Queue Campaign', 'queueCampaignId') });
	helper('Contacts CSV text', 'n8n-nodes-base.set', 3.4, {
		assignments: { assignments: [{ id: uuid(`${ID}:csv`), name: 'csv', type: 'string', value: expr(`'1;' + ${chk('phoneLocal')} + ';TESTE n8n'`) }] },
		options: {},
	});
	helper('Make contacts file', 'n8n-nodes-base.convertToFile', 1.1, {
		operation: 'toText',
		sourceProperty: 'csv',
		binaryPropertyName: 'data',
		options: { fileName: 'contacts.csv' },
	});
	sonax('Add Contacts File to Campaign', 'voice', {
		operation: 'addCampaignContacts',
		campaignId: expr("$('Queue campaign ID').first().json.campaignId"),
		priority: 1,
		inputBinaryProperty: 'data',
	});
	helper('Has extension?', 'n8n-nodes-base.if', 2.2, {
		conditions: {
			options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
			conditions: [{ id: uuid(`${ID}:if`), leftValue: ref('extension'), rightValue: 'PREENCHER', operator: { type: 'string', operation: 'notStartsWith' } }],
			combinator: 'and',
		},
		options: {},
	});
	sonax('Click to Call', 'voice', { operation: 'clickToCall', number: ref('phone'), extension: ref('extension') });
	helper('Call ID', 'n8n-nodes-base.code', 2, { jsCode: CALL_ID });
	sonax('Get Call Status', 'voice', { operation: 'getCallStatus', callId: expr("$('Call ID').first().json.callId") });
	sonax('Get Call Recording', 'voice', { operation: 'getCallRecording', callId: expr("$('Call ID').first().json.callId"), outputBinaryProperty: 'audio' });

	// ── Chat ──────────────────────────────────────────────────────────────────
	sonax('Create Contact', 'chat', {
		operation: 'createContact',
		contactName: 'TESTE n8n',
		mobilePhone: ref('phone'),
		chatContactOptions: { tag: 'smoke-test', notes: expr(`'Criado pelo smoke test do n8n ' + ${chk('runId')}`) },
	});
	sonax('Send Official Message', 'chat', {
		operation: 'sendOfficialMessage',
		from: ref('chatChannel'),
		templateName: ref('chatTemplate'),
		to: ref('phone'),
		templateParameters: { values: [{ value: 'Teste n8n' }, { value: 'ok' }] },
		clientData: { name: 'TESTE n8n' },
		protocolTags: { values: [{ tag: 'smoke-test' }] },
	});
	helper('Message ID', 'n8n-nodes-base.code', 2, { jsCode: MESSAGE_ID });
	sonax('Get Message', 'chat', { operation: 'getMessage', messageId: expr("$('Message ID').first().json.messageId") });
	helper('Has Kanban data?', 'n8n-nodes-base.if', 2.2, {
		conditions: {
			options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
			conditions: [{ id: uuid(`${ID}:if-kanban`), leftValue: ref('hasKanban'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
			combinator: 'and',
		},
		options: {},
	});
	sonax('Create Kanban Task', 'chat', {
		operation: 'createTask',
		boardName: ref('kanbanBoard'),
		columnName: ref('kanbanColumn'),
		title: expr(`'Smoke test n8n ' + ${chk('runId')}`),
		assignee: ref('userEmail'),
		participants: expr(`[${chk('userEmail')}]`),
		taskTags: { values: [{ tag: 'smoke-test' }] },
		dueDate: expr("$now.plus({ days: 7 }).toFormat('yyyy-MM-dd')"),
		taskOptions: { description: 'Criada pelo smoke test do n8n' },
	});
	helper('Summary', 'n8n-nodes-base.code', 2, { jsCode: SUMMARY });

	// Linear chain; `Has extension?` skips Click to Call and `Has Kanban data?` skips the task when their data is missing.
	const order = [
		'Manual Trigger', 'Config', 'Check config',
		'Create IVR Campaign', 'IVR campaign ID', 'Add Contact to Campaign', 'Start Campaign', 'Wait for the call', 'Stop Campaign',
		'Create Queue Campaign', 'Queue campaign ID', 'Contacts CSV text', 'Make contacts file', 'Add Contacts File to Campaign',
		'Has extension?', 'Click to Call', 'Call ID', 'Get Call Status', 'Get Call Recording',
		'Create Contact', 'Send Official Message', 'Message ID', 'Get Message', 'Has Kanban data?', 'Create Kanban Task', 'Summary',
	];
	const byName = Object.fromEntries(nodes.map((node) => [node.name, node]));
	const link = (from, ...targets) => ({ main: [targets.map((target) => ({ node: target, type: 'main', index: 0 }))] });
	const connections = {};
	for (let i = 0; i < order.length - 1; i++) {
		const from = order[i];
		const next = order[i + 1];
		if (from === 'Has extension?') connections[from] = { main: [[{ node: 'Click to Call', type: 'main', index: 0 }], [{ node: 'Call ID', type: 'main', index: 0 }]] };
		else if (from === 'Has Kanban data?') connections[from] = { main: [[{ node: 'Create Kanban Task', type: 'main', index: 0 }], [{ node: 'Summary', type: 'main', index: 0 }]] };
		else if (from === 'Click to Call') connections[from] = link(from, 'Call ID');
		else connections[from] = link(from, next);
	}
	order.forEach((name, i) => {
		if (name === 'Manual Trigger') return;
		byName[name].position = [240 * ((i - 1) % 9), 300 * Math.floor((i - 1) / 9)];
	});
	start.position = [-240, 0];

	nodes.push({
		id: uuid(`${ID}:note`),
		name: 'Leia-me',
		type: 'n8n-nodes-base.stickyNote',
		typeVersion: 1,
		position: [-240, -420],
		parameters: {
			width: 1500,
			height: 340,
			content: [
				'## Sonax REAL · smoke test das 13 operações (AO VIVO, nada desativado)',
				'**Isto age de verdade no tenant de testes da Sonax:** cria 2 campanhas e 1 contato de Chat, liga para o seu celular (campanha de URA e, com ramal, Click to Call), manda 1 WhatsApp e, com os dados do Kanban, cria 1 tarefa.',
				'**1) Preencha o nó `Config`.** Só o seu número (`phone`, com 55+DDD) é obrigatório: enquanto ele não estiver válido, o nó `Check config` **para a execução antes de enviar qualquer coisa**. O ramal e os dados do Kanban (quadro, coluna, e-mail de um usuário do Sonax Chat) são opcionais: sem eles, só o Click to Call e a tarefa do Kanban são IGNORADOS.',
				'**2) Rode com *Execute workflow*.** A campanha de URA toca no seu celular e é parada após ' + waitSeconds + ' s. Sem ramal no `Config`, o Click to Call é ignorado.',
				'**3) Leia o nó `Summary`:** cada operação aparece como OK, FALHOU (com a resposta da Sonax) ou IGNORADO. Os IDs de campanha, chamada e mensagem são lidos das respostas da Sonax (não documentadas); se algum vier "NÃO ENCONTRADO", cole o ID no campo de override do `Config` e rode de novo.',
				'**Depois:** as campanhas "TESTE n8n …" ficam no tenant; apague-as no painel, se quiser.',
			].join('\n\n'),
		},
	});

	return { name: NAME, nodes, connections, settings: { executionOrder: 'v1' }, active: false, id: ID };
}

module.exports = { build, ID, NAME, REAL_CONFIG, OPERATIONS };

if (require.main === module) {
	const argv = process.argv.slice(2);
	const arg = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
	const out = arg('out');
	if (!out) {
		console.error('usage: node tests/n8n/smoke-workflow.cjs --out <file> [--node-prefix <prefix>] [--voice-credential <id>:<name>] [--chat-credential <id>:<name>]');
		process.exit(2);
	}
	const credential = (value) => {
		if (!value) return undefined;
		const [id, ...name] = value.split(':');
		return { id, name: name.join(':') };
	};
	const workflow = build({ nodePrefix: arg('node-prefix'), voiceCredential: credential(arg('voice-credential')), chatCredential: credential(arg('chat-credential')) });
	fs.writeFileSync(out, `${JSON.stringify(workflow, null, 2)}\n`);
	console.log(`wrote ${out} (${workflow.nodes.length} nodes, none disabled)`);
}

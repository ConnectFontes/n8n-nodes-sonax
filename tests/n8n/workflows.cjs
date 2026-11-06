'use strict';
const { nodeTypeFor } = require('./node-types.cjs');
// n8n workflows that exercise every Sonax operation, plus what each one must send on the wire.
//
// They use the MOCK credentials (fake tokens) and obviously fake data, so they cannot affect a real
// Sonax tenant even if opened and executed without the mock running: the real API rejects the token.
const crypto = require('node:crypto');
const { MOCK } = require('./mock-sonax.cjs');

// The node's type name depends on how n8n loads it: `CUSTOM.sonaxVoip` / `CUSTOM.sonaxChat` when linked into the custom folder
// (what `n8n-node dev` does), `n8n-nodes-sonax-voip.sonaxVoip` / `n8n-nodes-sonax-chat.sonaxChat` when installed from npm as a community node.
const SONAX_VOIP_TYPE = '@@sonax-voip-type@@';
const SONAX_CHAT_TYPE = '@@sonax-chat-type@@';

const VOICE_CREDENTIAL = { id: 'SonaxMockVoice01', name: 'Sonax Voice API (MOCK - fake token)' };
const CHAT_CREDENTIAL = { id: 'SonaxMockChat001', name: 'Sonax Chat API (MOCK - fake token)' };

// Same Client ID, wrong token: the real API rejects it, so these workflows can never act on a tenant.
const BAD_VOICE_CREDENTIAL = { id: 'SonaxMockVoiceBad1', name: 'Sonax Voice API (MOCK - WRONG token)' };

const BAD_CHAT_CREDENTIAL = { id: 'SonaxMockChatBad01', name: 'Sonax Chat API (MOCK - WRONG token)' };

// Valid v1 token, but the Voice V2 password is wrong or missing: only the IVR drop-down is affected.
const BAD_V2_VOICE_CREDENTIAL = { id: 'SonaxMockVoiceBadV2', name: 'Sonax Voice API (MOCK - WRONG V2 password)' };
const NO_V2_VOICE_CREDENTIAL = { id: 'SonaxMockVoiceNoV2', name: 'Sonax Voice API (MOCK - no V2 password)' };

const credentials = [
	{ ...BAD_CHAT_CREDENTIAL, type: 'sonaxChatApi', data: { apiToken: 'wrong-chat-token' } },
	{
		...BAD_VOICE_CREDENTIAL,
		type: 'sonaxVoiceApi',
		data: { clientId: MOCK.clientId, apiToken: MOCK.wrongToken },
	},
	{
		...VOICE_CREDENTIAL,
		type: 'sonaxVoiceApi',
		data: { clientId: MOCK.clientId, apiToken: MOCK.apiToken, v2Password: MOCK.v2Password },
	},
	{
		...BAD_V2_VOICE_CREDENTIAL,
		type: 'sonaxVoiceApi',
		data: { clientId: MOCK.clientId, apiToken: MOCK.apiToken, v2Password: 'wrong-v2-password' },
	},
	{ ...NO_V2_VOICE_CREDENTIAL, type: 'sonaxVoiceApi', data: { clientId: MOCK.clientId, apiToken: MOCK.apiToken } },
	{ ...CHAT_CREDENTIAL, type: 'sonaxChatApi', data: { apiToken: MOCK.chatToken } },
];

function uuid(seed) {
	const h = crypto.createHash('sha1').update(seed).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function trigger(workflowId) {
	return {
		id: uuid(`${workflowId}:trigger`),
		name: 'Manual Trigger',
		type: 'n8n-nodes-base.manualTrigger',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
}

function sonax(workflowId, name, resource, parameters, position, extra = {}) {
	return {
		id: uuid(`${workflowId}:${name}`),
		name,
		type: resource === 'voice' ? SONAX_VOIP_TYPE : SONAX_CHAT_TYPE,
		typeVersion: 1,
		position,
		parameters: { ...parameters },
		credentials:
			resource === 'voice' ? { sonaxVoiceApi: VOICE_CREDENTIAL } : { sonaxChatApi: CHAT_CREDENTIAL },
		...extra,
	};
}

/** Connects each `from` node to every node in `to`. */
function connect(connections, from, to) {
	connections[from.name] = {
		main: [to.map((node) => ({ node: node.name, type: 'main', index: 0 }))],
	};
}

/** Trigger fans out to one or more Sonax nodes. */
function simple(id, name, resource, nodes, expect) {
	const start = trigger(id);
	const connections = {};
	connect(connections, start, nodes);
	return {
		id,
		name: `Sonax mock · ${name}`,
		nodes: [start, ...nodes],
		connections,
		active: false,
		settings: { executionOrder: 'v1' },
		expect,
	};
}

const voice = (id, name, parameters, position = [300, 0], extra) => sonax(id, name, 'voice', parameters, position, extra);
const chat = (id, name, parameters, position = [300, 0], extra) => sonax(id, name, 'chat', parameters, position, extra);

const VOICE = { host: 'api.sonax.net.br', pathname: '/a2billing_v2/admin/Public/dbdial_webapi.php' };
const CHAT = { host: 'api-chat.sonax.net.br' };

const definitions = [];

// ─── Voice ──────────────────────────────────────────────────────────────────────────────────────

{
	const id = 'SxMockVoiceClickToCall';
	definitions.push(
		simple(id, 'Voice · Click to Call', 'voice', [
			voice(id, 'Click to Call', { operation: 'clickToCall', number: '0000000001', extension: '9999' }),
		], {
			requests: [{
				host: 'click2call.sonax.net.br', method: 'GET', pathname: '/sonax-click2call.php', authOk: true,
				// Click2Call is documented with `token` only: no id_cliente.
				query: { numero: '0000000001', ramal: '9999', token: '***', id_cliente: undefined, acao: undefined },
			}],
			outputs: { 'Click to Call': [{ result: 28137648036 }] },
		}),
	);
}

{
	const id = 'SxMockVoiceCreateQueueCampaign';
	definitions.push(
		simple(id, 'Voice · Create Queue Campaign', 'voice', [
			voice(id, 'Create Queue Campaign', {
				operation: 'createQueueCampaign',
				campaignName: 'Mock queue campaign',
				queueId: '100',
				campaignOptions: {
					autoComplete: false,
					concurrentCalls: 2,
					discardVoicemail: true,
					startTime: '08:30:00',
					endTime: '18:00:00',
					startWeekday: 2,
					endWeekday: 6,
					positiveOutcomes: 'Sale',
					negativeOutcomes: 'No interest',
					pauses: 'Break',
					positiveCampaignId: '900001',
					negativeCampaignId: '900001',
					pauseCampaignId: '900001',
				},
				queueOptions: { attempts: 3 },
			}),
		], {
			requests: [{
				...VOICE, method: 'GET', authOk: true,
				query: {
					acao: 'cria_campanha', id_cliente: 'mock-client', token: '***',
					descricao_campanha: 'Mock queue campaign', id_fila: '100',
					descarte_caixa_postal: 'S', auto_concluir: 'N', qtd_simultanea: '2',
					dia_semana_ini: '2', dia_semana_fim: '6', hora_ini: '08:30:00', hora_fim: '18:00:00',
					tabulacoes_positivas: 'Sale', tabulacoes_negativas: 'No interest', pausas: 'Break',
					id_campanha_tabulacoes_positivas: '900001', id_campanha_tabulacoes_negativas: '900001',
					id_campanha_pausas: '900001', tentativas: '3',
				},
			}],
			outputs: { 'Create Queue Campaign': [{ result: 900100 }] },
		}),
	);
}

{
	const id = 'SxMockVoiceCreateIvrCampaign';
	definitions.push(
		simple(id, 'Voice · Create IVR Campaign', 'voice', [
			voice(id, 'Create IVR Campaign', {
				operation: 'createIvrCampaign',
				campaignName: 'Mock IVR campaign',
				ivrId: '55',
				campaignOptions: { discardVoicemail: false, concurrentCalls: 1 },
			}),
		], {
			requests: [{
				...VOICE, method: 'GET', authOk: true,
				query: {
					acao: 'criar_campanha_ura_reversa', id_cliente: 'mock-client', token: '***',
					descricao_campanha: 'Mock IVR campaign', id_ura: '55', descarte_caixa_postal: 'N',
					qtd_simultanea: '1', auto_concluir: 'N',
					// `tentativas` belongs to queue campaigns only.
					tentativas: undefined, id_fila: undefined,
				},
			}],
			outputs: { 'Create IVR Campaign': [{ result: 900100 }] },
		}),
	);
}

{
	const id = 'SxMockVoiceAddContact';
	definitions.push(
		simple(id, 'Voice · Add Contact to Campaign', 'voice', [
			voice(id, 'Add Contact to Campaign', {
				operation: 'addCampaignContact',
				campaignId: '900001',
				contactId: 'C-1',
				number: '5500000000002',
				priority: 2,
				voiceContactOptions: { scheduledAt: '2026-12-01 09:00:00', script: 'Hello from the mock' },
			}),
		], {
			requests: [{
				...VOICE, method: 'GET', authOk: true,
				query: {
					acao: 'chamada', id_cliente: 'mock-client', token: '***', id_campanha: '900001',
					id_contato: 'C-1', numero: '5500000000002', prioridade: '2',
					data_hora: '2026-12-01 09:00:00', script: 'Hello from the mock',
				},
			}],
			outputs: { 'Add Contact to Campaign': [{ success: true, id_chamada: 6011854393 }] },
		}),
	);
}

{
	const id = 'SxMockVoiceAddContactsFile';
	const start = trigger(id);
	const rows = {
		id: uuid(`${id}:rows`),
		name: 'Contacts CSV text',
		type: 'n8n-nodes-base.set',
		typeVersion: 3.4,
		position: [260, 0],
		parameters: {
			assignments: {
				assignments: [{
					id: uuid(`${id}:csv`),
					name: 'csv',
					type: 'string',
					value: '1;5500000000003;Ana\n2;5500000000004;Bruno',
				}],
			},
			options: {},
		},
	};
	const file = {
		id: uuid(`${id}:file`),
		name: 'Make contacts file',
		type: 'n8n-nodes-base.convertToFile',
		typeVersion: 1.1,
		position: [520, 0],
		parameters: {
			operation: 'toText',
			sourceProperty: 'csv',
			binaryPropertyName: 'data',
			options: { fileName: 'contacts.csv' },
		},
	};
	const upload = voice(id, 'Add Contacts File to Campaign', {
		operation: 'addCampaignContacts', campaignId: '900001', priority: 1, inputBinaryProperty: 'data',
	}, [780, 0]);
	const connections = {};
	connect(connections, start, [rows]);
	connect(connections, rows, [file]);
	connect(connections, file, [upload]);
	definitions.push({
		id,
		name: 'Sonax mock · Voice · Add Contacts File to Campaign',
		nodes: [start, rows, file, upload],
		connections,
		active: false,
		settings: { executionOrder: 'v1' },
		expect: {
			requests: [{
				...VOICE, method: 'POST', authOk: true,
				query: { acao: undefined, token: undefined },
				form: {
					acao: 'upload_arquivo_contato', id_cliente: 'mock-client', token: '***',
					id_campanha: '900001', prioridade: '1',
					arquivo: { filename: 'contacts.csv', text: '1;5500000000003;Ana\n2;5500000000004;Bruno' },
				},
			}],
			outputs: { 'Add Contacts File to Campaign': [{ result: '28146879567,2,5500000000003' }] },
		},
	});
}

for (const [slug, title, operation, action] of [
	['Start', 'Start Campaign', 'startCampaign', 'play_campanha'],
	['Stop', 'Stop Campaign', 'stopCampaign', 'stop_campanha'],
]) {
	const id = `SxMockVoice${slug}Campaign`;
	definitions.push(
		simple(id, `Voice · ${title}`, 'voice', [voice(id, title, { operation, campaignId: '900001' })], {
			requests: [{
				...VOICE, method: 'GET', authOk: true,
				query: { acao: action, id_cliente: 'mock-client', token: '***', id_campanha: '900001' },
			}],
			outputs: { [title]: [{ success: true }] },
		}),
	);
}

{
	const id = 'SxMockVoiceGetCallRecording';
	definitions.push(
		simple(id, 'Voice · Get Call Recording', 'voice', [
			voice(id, 'Recording as audio', {
				operation: 'getCallRecording', callId: '1001', outputBinaryProperty: 'audio',
			}, [300, -100]),
			voice(id, 'Recording as link', { operation: 'getCallRecording', callId: '1002' }, [300, 100]),
		], {
			requests: [
				{ ...VOICE, method: 'GET', authOk: true, query: { acao: 'pega_gravacao', id_chamada: '1001', id_cliente: 'mock-client', token: '***' } },
				{ ...VOICE, method: 'GET', authOk: true, query: { acao: 'pega_gravacao', id_chamada: '1002', id_cliente: 'mock-client', token: '***' } },
			],
			outputs: {
				'Recording as audio': [{ callId: '1001' }],
				'Recording as link': [{ url: 'https://gravacoes.sonax.example/1002.mp3' }],
			},
			binary: { 'Recording as audio': { audio: { mimeType: 'audio/wav', fileName: 'recording-1001.wav' } } },
		}),
	);
}

{
	const id = 'SxMockVoiceGetCallStatus';
	definitions.push(
		simple(id, 'Voice · Get Call Status', 'voice', [
			voice(id, 'Get Call Status', { operation: 'getCallStatus', callId: '6011854393' }),
		], {
			requests: [{
				...VOICE, method: 'GET', authOk: true,
				query: { acao: 'status_chamada', id_chamada: '6011854393', id_cliente: 'mock-client', token: '***' },
			}],
			outputs: { 'Get Call Status': [{ id_chamada: '6011854393', status: 'ANSWERED', duracao: 42 }] },
		}),
	);
}

{
	// Sonax answers errors with HTTP 200 and an error body; the node must surface them as errors.
	const id = 'SxMockVoiceStatusError';
	definitions.push(
		simple(id, 'Voice · Error returned with HTTP 200 (must fail)', 'voice', [
			voice(id, 'Get Call Status', { operation: 'getCallStatus', callId: 'ERR' }),
		], {
			fails: /Sonax rejected the request/,
			requests: [{ ...VOICE, method: 'GET', authOk: true, query: { acao: 'status_chamada', id_chamada: 'ERR', id_cliente: 'mock-client', token: '***' } }],
		}),
	);
}

{
	const id = 'SxMockVoiceStatusContinue';
	definitions.push(
		simple(id, 'Voice · Error with Continue On Fail', 'voice', [
			voice(id, 'Get Call Status', { operation: 'getCallStatus', callId: 'ERR' }, [300, 0], {
				onError: 'continueRegularOutput',
			}),
		], {
			requests: [{ ...VOICE, method: 'GET', authOk: true, query: { acao: 'status_chamada', id_chamada: 'ERR', id_cliente: 'mock-client', token: '***' } }],
			outputs: { 'Get Call Status': [{ error: /Sonax rejected the request/ }] },
		}),
	);
}

{
	// Observed on the real API: a wrong token on dbdial_webapi.php redirects (HTTP 302) to an access-error page.
	const id = 'SxMockVoiceWrongToken';
	definitions.push(
		simple(id, 'Voice · Wrong token, redirect (must fail)', 'voice', [
			voice(
				id,
				'Create Queue Campaign',
				{ operation: 'createQueueCampaign', campaignName: 'Mock queue campaign', queueId: '100' },
				[300, 0],
				{ credentials: { sonaxVoiceApi: BAD_VOICE_CREDENTIAL } },
			),
		], {
			fails: /Sonax rejected the credentials/,
			requests: [{
				...VOICE, method: 'GET', authOk: false,
				query: { acao: 'cria_campanha', id_cliente: 'mock-client', token: '***', descricao_campanha: 'Mock queue campaign', id_fila: '100', qtd_simultanea: '1', descarte_caixa_postal: 'N', auto_concluir: 'N' },
			}],
		}),
	);
}

{
	// Observed on the real API: Click to Call answers a wrong token with HTTP 200 and a failure text.
	const id = 'SxMockClickToCallWrongToken';
	definitions.push(
		simple(id, 'Voice · Click to Call wrong token, HTTP 200 text (must fail)', 'voice', [
			voice(
				id,
				'Click to Call',
				{ operation: 'clickToCall', number: '0000000001', extension: '9999' },
				[300, 0],
				{ credentials: { sonaxVoiceApi: BAD_VOICE_CREDENTIAL } },
			),
		], {
			fails: /Sonax rejected the credentials/,
			requests: [{
				host: 'click2call.sonax.net.br', method: 'GET', pathname: '/sonax-click2call.php', authOk: false,
				query: { numero: '0000000001', ramal: '9999', token: '***' },
			}],
		}),
	);
}

// ─── Chat ───────────────────────────────────────────────────────────────────────────────────────

{
	const id = 'SxMockChatSendOfficialMessage';
	definitions.push(
		simple(id, 'Chat · Send Official Message', 'chat', [
			chat(id, 'Send Official Message', {
				operation: 'sendOfficialMessage',
				from: '5500000000001',
				templateName: 'welcome',
				to: '5500000000002',
				templateParameters: { values: [{ value: 'Ana' }, { value: '12345' }] },
				clientData: { name: 'Ana Mock', email: 'ana@example.test' },
				protocolTags: { values: [{ tag: 'vip' }] },
				messageOptions: { attendant: 'u1', customBotCode: 'b1' },
			}),
		], {
			requests: [{
				...CHAT, method: 'POST', pathname: '/v2/send-message-protocol', authOk: true,
				query: { authorization: undefined },
				json: {
					from: '5500000000001', to: '5500000000002', message: 'welcome', paramsTemplate: 'Ana,12345',
					clientData: { name: 'Ana Mock', email: 'ana@example.test' },
					protocolData: { tag: ['vip'] }, attendant: 'u1', customBotCode: 'b1',
				},
			}],
			outputs: { 'Send Official Message': [{ error: false, protocol: { _id: 'protocol-1', protocol_number: '1700000000' }, wppFrom: '5500000000001', message: { _id: 'msg-123' }, messageId: 'msg-123' }] },
		}),
	);
}

{
	const id = 'SxMockChatGetMessage';
	definitions.push(
		simple(id, 'Chat · Get Message', 'chat', [
			chat(id, 'Get Message', { operation: 'getMessage', messageId: 'msg-123' }, [300, -100]),
			chat(id, 'Get Message (ID needing URL encoding)', { operation: 'getMessage', messageId: 'a/b c' }, [300, 100]),
		], {
			requests: [
				// The documented `authorization` query parameter is sent in addition to the Bearer header.
				{ ...CHAT, method: 'GET', pathname: '/v2/message-data/msg-123', authOk: true, query: { authorization: '***' } },
				{ ...CHAT, method: 'GET', pathname: '/v2/message-data/a%2Fb%20c', authOk: true, query: { authorization: '***' } },
			],
			outputs: {
				'Get Message': [{ id: 'msg-123', status: 'delivered' }],
				'Get Message (ID needing URL encoding)': [{ id: 'a/b c', status: 'delivered' }],
			},
		}),
	);
}

{
	const id = 'SxMockChatCreateContact';
	definitions.push(
		simple(id, 'Chat · Create Contact', 'chat', [
			chat(id, 'Create Contact', {
				operation: 'createContact',
				contactName: 'Ana Mock',
				mobilePhone: '5500000000002',
				chatContactOptions: {
					cpf: '00000000000', customerId: 'C-77', email: 'ana@example.test',
					notes: 'Created by the n8n mock test', ownerId: 'u1', tag: 'vip',
				},
			}),
		], {
			requests: [{
				...CHAT, method: 'POST', pathname: '/v2/task-api/create-contact', authOk: true,
				json: {
					nome: 'Ana Mock', celular: '5500000000002', cpf: '00000000000', cliente: 'C-77',
					email: 'ana@example.test', observacao: 'Created by the n8n mock test', carteirizacao: 'u1', tag: 'vip',
				},
			}],
			outputs: { 'Create Contact': [{ error: false, status: true, data: 'contact-1' }] },
		}),
	);
}

{
	const id = 'SxMockChatCreateTask';
	definitions.push(
		simple(id, 'Chat · Create Kanban Task', 'chat', [
			chat(id, 'Create Kanban Task', {
				operation: 'createTask',
				boardName: 'Sales',
				columnName: 'TO DO',
				title: 'Call back',
				assignee: 'ana@example.test',
				participants: ['ana@example.test', 'bruno@example.test'],
				taskTags: { values: [{ tag: 'urgent' }] },
				dueDate: '2026-12-01',
				taskOptions: {
					contactId: 'contact-1', creator: 'bruno@example.test', customerId: 'C-77',
					description: 'Mock task', priority: 'high',
				},
			}),
		], {
			requests: [{
				...CHAT, method: 'POST', pathname: '/v2/task-api/create-task', authOk: true,
				json: {
					quadro: 'Sales', lista: 'TO DO', titulo: 'Call back', responsavel: 'ana@example.test',
					participantes: ['ana@example.test', 'bruno@example.test'], tag: ['urgent'], prazo: '2026-12-01',
					contato: 'contact-1', criador: 'bruno@example.test', cliente: 'C-77', descricao: 'Mock task',
					prioridade: 'high',
				},
			}],
			outputs: { 'Create Kanban Task': [{ error: false, status: true, data: 'task-1' }] },
		}),
	);
}

{
	const id = 'SxMockChatMessageMissing';
	definitions.push(
		simple(id, 'Chat · HTTP 404 (must fail)', 'chat', [
			chat(id, 'Get Message', { operation: 'getMessage', messageId: 'missing' }),
		], {
			fails: /404|not found/i,
			requests: [{ ...CHAT, method: 'GET', pathname: '/v2/message-data/missing', authOk: true }],
		}),
	);
}

// ─── All 13 operations in one flow ───────────────────────────────────────────────────────────────
// Assembled from the single-operation workflows above, so it reuses their inputs and expectations.
// Two lanes run from the same trigger: Voice (9 operations) and Chat (4 operations).
{
	const id = 'SxMockAllOperations';
	const byId = Object.fromEntries(definitions.map((definition) => [definition.id, definition]));
	// [workflow to take nodes from, node names to take (in order), indexes of its expected requests]
	const lanes = [
		[
			['SxMockVoiceClickToCall', ['Click to Call']],
			['SxMockVoiceCreateQueueCampaign', ['Create Queue Campaign']],
			['SxMockVoiceCreateIvrCampaign', ['Create IVR Campaign']],
			['SxMockVoiceAddContact', ['Add Contact to Campaign']],
			['SxMockVoiceAddContactsFile', ['Contacts CSV text', 'Make contacts file', 'Add Contacts File to Campaign']],
			['SxMockVoiceStartCampaign', ['Start Campaign']],
			['SxMockVoiceGetCallStatus', ['Get Call Status']],
			['SxMockVoiceGetCallRecording', ['Recording as audio'], [0]],
			['SxMockVoiceStopCampaign', ['Stop Campaign']],
		],
		[
			['SxMockChatCreateContact', ['Create Contact']],
			['SxMockChatSendOfficialMessage', ['Send Official Message']],
			['SxMockChatGetMessage', ['Get Message'], [0]],
			['SxMockChatCreateTask', ['Create Kanban Task']],
		],
	];

	const start = trigger(id);
	const connections = {};
	const nodes = [start];
	const expect = { requests: [], outputs: {}, binary: {} };
	const laneHeads = [];
	lanes.forEach((lane, laneIndex) => {
		let previous;
		let column = 0;
		for (const [source, names, requestIndexes] of lane) {
			for (const name of names) {
				const original = byId[source].nodes.find((node) => node.name === name);
				const node = {
					...original,
					id: uuid(`${id}:${name}`),
					position: [260 + column++ * 240, laneIndex * 260],
				};
				nodes.push(node);
				if (previous) connect(connections, previous, [node]);
				else laneHeads.push(node);
				previous = node;
			}
			const { requests, outputs = {}, binary = {} } = byId[source].expect;
			expect.requests.push(...(requestIndexes ?? requests.map((_, index) => index)).map((index) => requests[index]));
			for (const [name, value] of Object.entries(outputs)) if (names.includes(name)) expect.outputs[name] = value;
			for (const [name, value] of Object.entries(binary)) if (names.includes(name)) expect.binary[name] = value;
		}
	});
	connect(connections, start, laneHeads);
	nodes.push({
		id: uuid(`${id}:note`),
		name: 'Read me',
		type: 'n8n-nodes-base.stickyNote',
		typeVersion: 1,
		position: [240, -300],
		parameters: {
			width: 1100,
			height: 200,
			content: [
				'## Sonax · all 13 operations in one flow',
				'**Top lane:** Voice (9 operations). **Bottom lane:** Chat (4 operations).',
				'It uses the **MOCK** credentials and fake data (numbers, IDs, tokens), so it needs the local mock running (`node tests/n8n/mock-sonax.cjs`, see tests/n8n/README.md).',
				'**To use it on a real tenant** switch each node to your real credential and replace the fake data first. Click to Call, campaigns, uploads and messages are real actions: they place calls and message people.',
			].join('\n\n'),
		},
	});

	definitions.push({
		id,
		name: 'Sonax mock · All 13 operations (one flow)',
		nodes,
		connections,
		active: false,
		settings: { executionOrder: 'v1' },
		expect,
	});
}

// A structural clone, because the expectations contain RegExps and `undefined` ("must be absent").
function substitute(value, nodePrefix) {
	if (value === SONAX_VOIP_TYPE) return nodeTypeFor('voice', nodePrefix);
	if (value === SONAX_CHAT_TYPE) return nodeTypeFor('chat', nodePrefix);
	if (Array.isArray(value)) return value.map((item) => substitute(item, nodePrefix));
	if (value instanceof RegExp || value === null || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, nodePrefix)]));
}

/** Returns the workflow definitions with the Sonax node type filled in. */
function forNodeTypes(nodePrefix = 'CUSTOM') {
	return substitute(definitions, nodePrefix);
}

module.exports = { credentials, forNodeTypes, VOICE_CREDENTIAL, CHAT_CREDENTIAL, BAD_VOICE_CREDENTIAL, BAD_CHAT_CREDENTIAL, uuid, trigger };

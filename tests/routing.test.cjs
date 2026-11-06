'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const get = require('lodash/get');
const { Workflow, NodeHelpers } = require('n8n-workflow');
const { RoutingNode } = require('n8n-core/dist/execution-engine/routing-node');
const {
	convertN8nRequestToAxios,
} = require('n8n-core/dist/execution-engine/node-execution-context/utils/request-helper-functions');
const { dist } = require('./helpers.cjs');
const { SonaxVoip } = dist('voip', 'nodes', 'SonaxVoip', 'SonaxVoip.node.js');
const { SonaxChat } = dist('chat', 'nodes', 'SonaxChat', 'SonaxChat.node.js');
const { SonaxVoiceApi } = dist('voip', 'credentials', 'SonaxVoiceApi.credentials.js');
const { SonaxChatApi } = dist('chat', 'credentials', 'SonaxChatApi.credentials.js');
const nodeTypes = { voice: new SonaxVoip(), chat: new SonaxChat() };

async function route({ resource, ...parameters }, itemIndex = 0) {
	const nodeType = nodeTypes[resource];
	const node = {
		id: 'sonax',
		name: 'Sonax',
		type: `${resource === 'voice' ? 'n8n-nodes-sonax-voip' : 'n8n-nodes-sonax-chat'}.${nodeType.description.name}`,
		typeVersion: 1,
		position: [0, 0],
		parameters,
	};
	node.parameters = NodeHelpers.getNodeParameters(
		nodeType.description.properties,
		parameters,
		true,
		false,
		node,
		nodeType.description,
	);
	const workflow = new Workflow({
		nodes: [node],
		connections: {},
		active: false,
		nodeTypes: { getByNameAndVersion: () => nodeType },
	});
	const context = {
		node,
		nodeType,
		workflow,
		mode: 'manual',
		connectionInputData: [{ json: {} }, { json: {} }],
		runExecutionData: null,
		getNodeParameter: (name, _index, fallback) =>
			router.getParameterValue(get(node.parameters, name, fallback), itemIndex, 0, undefined, {
				$version: 1,
			}),
		getCredentials: async () => ({ clientId: 'test-client', apiToken: 'test-secret' }),
	};
	const router = new RoutingNode(context, nodeType);
	const credential = (await router.prepareCredentials()).credentialDescription.name;
	let captured;
	const single = {
		getNode: () => node,
		getItemIndex: () => itemIndex,
		getExecuteData: () => undefined,
		getNodeParameter: (name, fallback) =>
			router.getParameterValue(get(node.parameters, name, fallback), itemIndex, 0, undefined, {
				$version: 1,
			}),
		helpers: {
			assertBinaryData: () => ({ fileName: 'contacts.csv', mimeType: 'text/csv' }),
			getBinaryDataBuffer: async () => Buffer.from('synthetic,file\r\n1,example\r\n'),
			async httpRequestWithAuthentication(type, request) {
				const handler = type === 'sonaxVoiceApi' ? new SonaxVoiceApi() : new SonaxChatApi();
				const authenticated = await handler.authenticate(await context.getCredentials(), request);
				captured = { type, request: authenticated, axios: convertN8nRequestToAxios(authenticated) };
				return { statusCode: 200, headers: {}, body: { ok: true } };
			},
		},
	};
	const requestData = {
		options: { ...nodeType.description.requestDefaults, qs: {}, body: {}, headers: {} },
		preSend: [],
		postReceive: [],
		requestOperations: {},
	};
	for (const property of nodeType.description.properties) {
		router.mergeOptions(
			requestData,
			router.getRequestOptionsFromParameters(single, property, itemIndex, 0, '', { $version: 1 }),
		);
	}
	const output = await router.makeRequest(requestData, single, itemIndex, 0, credential, {});
	return { ...captured, output, parameters: node.parameters };
}

test('n8n router: all 13 operations select the correct credential and produce a valid request', async () => {
	const cases = [
		['voice', 'clickToCall', { number: '5511000000000', extension: '100' }, 'GET'],
		['voice', 'createQueueCampaign', { campaignName: 'Example', queueId: '1' }, 'GET'],
		['voice', 'createIvrCampaign', { campaignName: 'Example', ivrId: '2' }, 'GET'],
		[
			'voice',
			'addCampaignContact',
			{ campaignId: '3', contactId: 'ext-4', number: '5511000000000' },
			'GET',
		],
		['voice', 'addCampaignContacts', { campaignId: '3' }, 'POST'],
		['voice', 'startCampaign', { campaignId: '3' }, 'GET'],
		['voice', 'stopCampaign', { campaignId: '3' }, 'GET'],
		['voice', 'getCallRecording', { callId: 'call-1' }, 'GET'],
		['voice', 'getCallStatus', { callId: 'call-1' }, 'GET'],
		[
			'chat',
			'sendOfficialMessage',
			{ from: '5511000000000', to: '5511000000001', templateName: 'welcome' },
			'POST',
		],
		['chat', 'getMessage', { messageId: 'example/id?x=1' }, 'GET'],
		['chat', 'createContact', { contactName: 'Example', mobilePhone: '5511000000000' }, 'POST'],
		[
			'chat',
			'createTask',
			{
				boardName: 'Sales',
				columnName: 'New',
				title: 'Example',
				assignee: 'owner@example.com',
				participants: ['user@example.com'],
				taskTags: { values: [{ tag: 'example' }] },
				dueDate: '2026-12-01',
			},
			'POST',
		],
	];
	for (const [resource, operation, parameters, method] of cases) {
		const result = await route({ resource, operation, ...parameters }, 1);
		assert.equal(result.type, resource === 'voice' ? 'sonaxVoiceApi' : 'sonaxChatApi', operation);
		assert.equal(result.request.method, method, operation);
		assert.equal(result.output[0].pairedItem.item, 1, operation);
		assert.equal(result.request.disableFollowRedirect, true);
		if (resource === 'chat')
			assert.equal(result.request.headers.Authorization, 'Bearer test-secret');
	}
});

test('n8n router: nested campaign options map to the documented Portuguese query fields', async () => {
	const { request } = await route({
		resource: 'voice',
		operation: 'createQueueCampaign',
		campaignName: 'Example',
		queueId: '7',
		campaignOptions: {
			autoComplete: true,
			discardVoicemail: false,
			concurrentCalls: 2,
			startTime: '09:00:00',
			endTime: '18:00:00',
			startWeekday: 2,
			endWeekday: 6,
			positiveOutcomes: 'sale,followup',
			positiveCampaignId: '10',
			pauses: 'lunch',
			pauseCampaignId: '11',
		},
		queueOptions: { attempts: 3 },
	});
	assert.deepEqual(request.qs, {
		acao: 'cria_campanha',
		descricao_campanha: 'Example',
		id_fila: '7',
		auto_concluir: 'S',
		descarte_caixa_postal: 'N',
		qtd_simultanea: 2,
		hora_ini: '09:00:00',
		hora_fim: '18:00:00',
		dia_semana_ini: 2,
		dia_semana_fim: 6,
		tabulacoes_positivas: 'sale,followup',
		id_campanha_tabulacoes_positivas: '10',
		pausas: 'lunch',
		id_campanha_pausas: '11',
		tentativas: 3,
		id_cliente: 'test-client',
		token: 'test-secret',
	});
});

test('n8n router: each node selects its own credential without a hidden authentication selector', async () => {
	const voice = await route({
		resource: 'voice',
		authentication: 'chat',
		operation: 'getCallStatus',
		callId: 'call-1',
	});
	const chat = await route({
		resource: 'chat',
		authentication: 'voice',
		operation: 'getMessage',
		messageId: 'message-1',
	});
	assert.equal(voice.type, 'sonaxVoiceApi');
	assert.equal(chat.type, 'sonaxChatApi');
	for (const result of [voice, chat]) {
		assert.equal(result.parameters.resource, undefined);
		assert.equal(result.parameters.authentication, undefined);
	}
});

test('n8n router: message URL encodes the ID as one path component', async () => {
	const { request } = await route({
		resource: 'chat',
		operation: 'getMessage',
		messageId: 'a/b?x=1',
	});
	assert.equal(request.url, 'https://api-chat.sonax.net.br/v2/message-data/a%2Fb%3Fx%3D1');
	assert.equal(request.qs.authorization, 'test-secret');
});

test('n8n router: optional Chat fields and arrays survive actual routing', async () => {
	const { request } = await route({
		resource: 'chat',
		operation: 'sendOfficialMessage',
		from: '5511000000000',
		to: '5511000000001',
		templateName: 'welcome',
		templateParameters: { values: [{ value: 'Ana' }, { value: '123' }] },
		clientData: { name: 'Ana' },
		protocolTags: { values: [{ tag: 'example' }] },
		messageOptions: { attendant: '7', customBotCode: '8' },
	});
	assert.deepEqual(request.body, {
		from: '5511000000000',
		to: '5511000000001',
		message: 'welcome',
		paramsTemplate: 'Ana,123',
		clientData: { name: 'Ana' },
		protocolData: { tag: ['example'] },
		attendant: '7',
		customBotCode: '8',
	});
});

test('n8n router: multipart bytes survive n8n HTTP conversion and can be decoded as form data', async () => {
	const { axios } = await route({
		resource: 'voice',
		operation: 'addCampaignContacts',
		campaignId: '3',
	});
	assert.ok(Buffer.isBuffer(axios.data));
	const form = await new Response(axios.data, { headers: axios.headers }).formData();
	assert.equal(form.get('token'), 'test-secret');
	assert.equal(form.get('id_cliente'), 'test-client');
	assert.equal(form.get('id_campanha'), '3');
	assert.equal(form.get('acao'), 'upload_arquivo_contato');
	assert.equal(await form.get('arquivo').text(), 'synthetic,file\r\n1,example\r\n');
});

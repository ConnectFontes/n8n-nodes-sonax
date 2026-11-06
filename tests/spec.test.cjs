'use strict';
// Checks the two nodes against the scope: 9 VoIP operations and 4 Chat operations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NodeHelpers } = require('n8n-workflow');
const { dist } = require('./helpers.cjs');

const { SonaxVoip } = dist('voip', 'nodes', 'SonaxVoip', 'SonaxVoip.node.js');
const { SonaxChat } = dist('chat', 'nodes', 'SonaxChat', 'SonaxChat.node.js');
const nodes = { voice: new SonaxVoip(), chat: new SonaxChat() };
const properties = Object.values(nodes).flatMap((node) => node.description.properties);

function operationsOf(resource) {
	const property = nodes[resource].description.properties.find((p) => p.name === 'operation');
	assert.ok(property, `operation property for ${resource}`);
	return property.options;
}

const VOICE_BASE = 'https://api.sonax.net.br/a2billing_v2/admin/Public/dbdial_webapi.php';
const CLICK2CALL = 'https://click2call.sonax.net.br/sonax-click2call.php';

const voiceScope = {
	clickToCall: { method: 'GET', url: CLICK2CALL },
	createQueueCampaign: { method: 'GET', url: VOICE_BASE, acao: 'cria_campanha' },
	createIvrCampaign: { method: 'GET', url: VOICE_BASE, acao: 'criar_campanha_ura_reversa' },
	addCampaignContact: { method: 'GET', url: VOICE_BASE, acao: 'chamada' },
	addCampaignContacts: { method: 'POST', url: VOICE_BASE },
	startCampaign: { method: 'GET', url: VOICE_BASE, acao: 'play_campanha' },
	stopCampaign: { method: 'GET', url: VOICE_BASE, acao: 'stop_campanha' },
	getCallRecording: { method: 'GET', url: VOICE_BASE, acao: 'pega_gravacao' },
	getCallStatus: { method: 'GET', url: VOICE_BASE, acao: 'status_chamada' },
};

const chatScope = {
	sendOfficialMessage: {
		method: 'POST',
		url: 'https://api-chat.sonax.net.br/v2/send-message-protocol',
	},
	getMessage: { method: 'GET', urlStartsWith: '=https://api-chat.sonax.net.br/v2/message-data/' },
	createContact: {
		method: 'POST',
		url: 'https://api-chat.sonax.net.br/v2/task-api/create-contact',
	},
	createTask: { method: 'POST', url: 'https://api-chat.sonax.net.br/v2/task-api/create-task' },
};

test('VoIP and Chat are independently selectable nodes without resource or authentication switches', () => {
	assert.equal(nodes.voice.description.displayName, 'Sonax VoIP');
	assert.equal(nodes.voice.description.name, 'sonaxVoip');
	assert.equal(nodes.chat.description.displayName, 'Sonax Chat');
	assert.equal(nodes.chat.description.name, 'sonaxChat');
	for (const node of Object.values(nodes)) {
		assert.equal(node.description.properties.filter((p) => p.name === 'operation').length, 1);
		assert.equal(
			node.description.properties.some((p) => ['resource', 'authentication'].includes(p.name)),
			false,
		);
		for (const operation of node.description.properties.find((p) => p.name === 'operation')
			.options) {
			assert.equal(
				NodeHelpers.displayParameter(
					{ operation: operation.value },
					node.description.properties[0],
					{ typeVersion: 1 },
					node.description,
				),
				true,
			);
		}
	}
});

test('Voice exposes exactly the 9 scoped operations, mapped to the documented endpoints', () => {
	const operations = operationsOf('voice');
	assert.deepEqual(operations.map((o) => o.value).sort(), Object.keys(voiceScope).sort());
	for (const operation of operations) {
		const expected = voiceScope[operation.value];
		const request = operation.routing.request;
		assert.equal(request.method, expected.method, `${operation.value} method`);
		assert.equal(request.url, expected.url, `${operation.value} url`);
		assert.equal(request.qs?.acao, expected.acao, `${operation.value} acao`);
	}
});

test('Chat exposes exactly the 4 scoped operations, mapped to the documented endpoints', () => {
	const operations = operationsOf('chat');
	assert.deepEqual(operations.map((o) => o.value).sort(), Object.keys(chatScope).sort());
	for (const operation of operations) {
		const expected = chatScope[operation.value];
		const request = operation.routing.request;
		assert.equal(request.method, expected.method, `${operation.value} method`);
		if (expected.url) assert.equal(request.url, expected.url, `${operation.value} url`);
		if (expected.urlStartsWith)
			assert.ok(request.url.startsWith(expected.urlStartsWith), `${operation.value} url`);
	}
});

test('the scope totals 13 operations', () => {
	assert.equal(operationsOf('voice').length + operationsOf('chat').length, 13);
});

test('every operation has an action label and a validating pre-send or post-receive hook', () => {
	for (const operation of [...operationsOf('voice'), ...operationsOf('chat')]) {
		assert.ok(operation.action, `${operation.value} action`);
		assert.ok(operation.routing.send?.preSend?.length, `${operation.value} preSend`);
		assert.ok(operation.routing.output?.postReceive?.length, `${operation.value} postReceive`);
	}
});

test('list fields load their options exclusively through methods registered on their own node', () => {
	const used = new Set();
	const visit = (list, methods) => {
		for (const property of list) {
			const method = property.typeOptions?.loadOptionsMethod;
			if (method) {
				used.add(method);
				assert.equal(typeof methods[method], 'function', `${property.name} -> ${method}`);
				assert.equal(
					property.type === 'options' || property.type === 'multiOptions',
					true,
					`${property.name} is a list`,
				);
			}
			if (property.options)
				visit(
					property.options.filter((o) => o.type),
					methods,
				);
			if (property.values) visit(property.values, methods);
		}
	};
	for (const node of Object.values(nodes))
		visit(node.description.properties, node.methods.loadOptions);
	assert.deepEqual(Object.keys(nodes.voice.methods.loadOptions).sort(), [
		'getVoiceCampaigns',
		'getVoiceIvrs',
		'getVoiceQueues',
	]);
	assert.deepEqual(Object.keys(nodes.chat.methods.loadOptions).sort(), [
		'getBots',
		'getChatUserEmails',
		'getChatUsers',
		'getOfficialChannels',
		'getTemplates',
	]);
	for (const expected of [
		'getVoiceQueues',
		'getVoiceCampaigns',
		'getVoiceIvrs',
		'getOfficialChannels',
		'getTemplates',
		'getChatUsers',
		'getChatUserEmails',
		'getBots',
	]) {
		assert.ok(used.has(expected), `${expected} is used by a field`);
	}
});

test('required list fields are shown by label: no field asks for a raw internal ID without a list', () => {
	const mustBeLists = {
		queueId: 'getVoiceQueues',
		ivrId: 'getVoiceIvrs',
		campaignId: 'getVoiceCampaigns',
		from: 'getOfficialChannels',
		templateName: 'getTemplates',
		assignee: 'getChatUserEmails',
		participants: 'getChatUserEmails',
	};
	for (const [name, method] of Object.entries(mustBeLists)) {
		const matches = properties.filter((p) => p.name === name);
		assert.ok(matches.length, name);
		for (const property of matches)
			assert.equal(property.typeOptions.loadOptionsMethod, method, name);
	}
});

test('each node requires only its own credential, preserving existing credential identifiers', () => {
	assert.deepEqual(nodes.voice.description.credentials, [
		{ name: 'sonaxVoiceApi', required: true },
	]);
	assert.deepEqual(nodes.chat.description.credentials, [{ name: 'sonaxChatApi', required: true }]);
	const { SonaxVoiceApi } = dist('voip', 'credentials', 'SonaxVoiceApi.credentials.js');
	const { SonaxChatApi } = dist('chat', 'credentials', 'SonaxChatApi.credentials.js');
	assert.equal(new SonaxVoiceApi().name, 'sonaxVoiceApi');
	assert.equal(new SonaxVoiceApi().displayName, 'Sonax VoIP API');
	assert.equal(new SonaxChatApi().name, 'sonaxChatApi');
});

test('each independent package registers only its node and credential and ships its icons', () => {
	const root = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
	assert.equal(root.private, true);
	assert.equal(root.n8n, undefined);
	for (const [product, folder, credential, node] of [
		['voip', 'SonaxVoip', 'SonaxVoiceApi', nodes.voice],
		['chat', 'SonaxChat', 'SonaxChatApi', nodes.chat],
	]) {
		const base = path.join(__dirname, '..', 'sonax-' + product);
		const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
		assert.equal(pkg.name, 'n8n-nodes-sonax-' + product);
		assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/' + folder + '/' + folder + '.node.js']);
		assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/' + credential + '.credentials.js']);
		assert.equal(pkg.dependencies, undefined);
		for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials])
			assert.ok(fs.existsSync(path.join(base, file)), file);
		const nodeFolder = path.join(base, 'dist', 'nodes', folder);
		for (const icon of Object.values(node.description.icon))
			assert.ok(fs.existsSync(path.resolve(nodeFolder, icon.slice(5))));
		const codex = JSON.parse(fs.readFileSync(path.join(nodeFolder, folder + '.node.json'), 'utf8'));
		assert.equal(codex.node, pkg.name + '.' + node.description.name);
	}
});

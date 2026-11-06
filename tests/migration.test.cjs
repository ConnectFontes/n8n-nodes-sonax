'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { migrateWorkflow } = require('../scripts/migrate-split-nodes.cjs');
const { forNodeTypes } = require('./n8n/workflows.cjs');
const { build: buildReal } = require('./n8n/real-workflow.cjs');
const { build: buildSmoke } = require('./n8n/smoke-workflow.cjs');
const { nodeTypeFor } = require('./n8n/node-types.cjs');

function fixture(prefix = 'n8n-nodes-sonax') {
	return {
		id: 'workflow',
		name: 'Fluxo existente',
		active: false,
		nodes: ['voice', 'chat'].map((resource, index) => ({
			id: String(index),
			name: `Sonax ${resource}`,
			type: `${prefix}.sonax`,
			typeVersion: 1,
			parameters: {
				resource,
				authentication: '={{$parameter.resource}}',
				operation: resource === 'voice' ? 'getCallStatus' : 'getMessage',
				callId: '={{$json.callId}}',
				messageId: '={{$json.messageId}}',
			},
			credentials: {
				sonaxVoiceApi: { id: 'voz-salva', name: 'Minha Voz' },
				sonaxChatApi: { id: 'chat-salvo', name: 'Meu Chat' },
			},
			position: [index * 200, 0],
			disabled: true,
			onError: 'continueRegularOutput',
		})),
		connections: { 'Sonax voice': { main: [[{ node: 'Sonax chat', type: 'main', index: 0 }]] } },
		settings: { executionOrder: 'v1' },
	};
}

test('migração separa os tipos e preserva IDs, nomes, conexões, expressões e credenciais ativas', () => {
	for (const prefix of ['CUSTOM', 'n8n-nodes-sonax']) {
		const input = fixture(prefix);
		const before = structuredClone(input);
		const { output, migrated } = migrateWorkflow(input);
		assert.equal(migrated, 2);
		assert.deepEqual(input, before);
		assert.deepEqual(output.connections, input.connections);
		assert.deepEqual(output.settings, input.settings);
		for (let index = 0; index < 2; index++) {
			const node = output.nodes[index];
			assert.equal(node.type, nodeTypeFor(index === 0 ? 'voice' : 'chat', 'community'));
			const { resource, authentication, ...parameters } = input.nodes[index].parameters;
			assert.deepEqual(node.parameters, parameters);
			for (const key of ['id', 'name', 'position', 'disabled', 'onError'])
				assert.deepEqual(node[key], input.nodes[index][key]);
			const credential = index === 0 ? 'sonaxVoiceApi' : 'sonaxChatApi';
			assert.deepEqual(node.credentials, {
				[credential]: input.nodes[index].credentials[credential],
			});
		}
		assert.deepEqual(migrateWorkflow(output), { output, migrated: 0 });
	}
});

test('migração aceita exportação em lote, mantém outros nodes e respeita o padrão antigo de Voz', () => {
	const input = fixture();
	delete input.nodes[0].parameters.resource;
	input.nodes.push({ id: 'outro', type: 'n8n-nodes-base.noOp', parameters: { resource: 'chat' } });
	const { output, migrated } = migrateWorkflow([input]);
	assert.equal(migrated, 2);
	assert.equal(output[0].nodes[0].type, 'n8n-nodes-sonax-voip.sonaxVoip');
	assert.deepEqual(output[0].nodes[2], input.nodes[2]);
});

test('migração recusa recurso dinâmico, operação incompatível e versões desconhecidas', () => {
	for (const resource of ['={{$json.resource}}', 'blacklist', null]) {
		const input = fixture();
		input.nodes[0].parameters.resource = resource;
		assert.throws(() => migrateWorkflow(input), /recurso/);
	}
	const input = fixture();
	input.nodes[0].parameters.operation = 'createTask';
	assert.throws(() => migrateWorkflow(input), /operação/);
	input.nodes[0].typeVersion = 2;
	assert.throws(() => migrateWorkflow(input), /versão/);
	assert.throws(() => migrateWorkflow({}), /exportação/);
});

test('CLI de migração não sobrescreve o original nem um arquivo de saída existente', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonax-migration-'));
	try {
		const input = path.join(directory, 'original.json');
		const output = path.join(directory, 'migrado.json');
		const content = JSON.stringify(fixture());
		fs.writeFileSync(input, content);
		const run = (destination) =>
			spawnSync(
				process.execPath,
				[path.join(__dirname, '../scripts/migrate-split-nodes.cjs'), input, destination],
				{ encoding: 'utf8' },
			);
		assert.equal(run(input).status, 1);
		assert.equal(run(output).status, 0);
		assert.equal(run(output).status, 1);
		assert.equal(fs.readFileSync(input, 'utf8'), content);
		assert.equal(
			JSON.parse(fs.readFileSync(output, 'utf8')).nodes[0].type,
			'n8n-nodes-sonax-voip.sonaxVoip',
		);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('workflows de exemplo e homologação usam os dois tipos novos, sem seletores antigos', () => {
	for (const nodePrefix of ['CUSTOM', 'community']) {
		const workflows = [
			...forNodeTypes(nodePrefix),
			buildReal({ nodePrefix }),
			buildSmoke({ nodePrefix }),
		];
		const used = new Set();
		for (const workflow of workflows)
			for (const node of workflow.nodes) {
				if (!node.type.startsWith('CUSTOM.') && !node.type.startsWith('n8n-nodes-sonax')) continue;
				assert.ok(
					[nodeTypeFor('voice', nodePrefix), nodeTypeFor('chat', nodePrefix)].includes(node.type),
				);
				assert.equal(node.parameters.resource, undefined);
				assert.equal(node.parameters.authentication, undefined);
				used.add(node.type);
			}
		assert.equal(used.size, 2);
	}
});

test('migração converte os nodes 0.2.0 e permite saída CUSTOM para desenvolvimento', () => {
	const input = fixture();
	for (const [index, resource] of ['voice', 'chat'].entries()) {
		input.nodes[index].type = `n8n-nodes-sonax.${resource === 'voice' ? 'sonaxVoip' : 'sonaxChat'}`;
		delete input.nodes[index].parameters.resource;
	}
	const { output, migrated } = migrateWorkflow(input);
	assert.equal(migrated, 2);
	assert.deepEqual(
		output.nodes.map((n) => n.type),
		[nodeTypeFor('voice', 'community'), nodeTypeFor('chat', 'community')],
	);
	assert.deepEqual(migrateWorkflow(output), { output, migrated: 0 });
	const local = migrateWorkflow(output, { custom: true });
	assert.equal(local.migrated, 2);
	assert.deepEqual(
		local.output.nodes.map((n) => n.type),
		['CUSTOM.sonaxVoip', 'CUSTOM.sonaxChat'],
	);
	assert.equal(migrateWorkflow(local.output, { custom: true }).migrated, 0);
});

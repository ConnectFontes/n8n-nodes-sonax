'use strict';
// Converte exportações locais sem acessar o n8n nem executar operações Sonax.
const fs = require('node:fs');
const path = require('node:path');

const operations = {
	voice: new Set([
		'clickToCall',
		'createQueueCampaign',
		'createIvrCampaign',
		'addCampaignContact',
		'addCampaignContacts',
		'startCampaign',
		'stopCampaign',
		'getCallRecording',
		'getCallStatus',
	]),
	chat: new Set(['sendOfficialMessage', 'getMessage', 'createContact', 'createTask']),
};
const types = {
	'n8n-nodes-sonax.sonax': 'combined',
	'CUSTOM.sonax': 'combined',
	'n8n-nodes-sonax.sonaxVoip': 'voice',
	'n8n-nodes-sonax.sonaxChat': 'chat',
	'CUSTOM.sonaxVoip': 'voice',
	'CUSTOM.sonaxChat': 'chat',
	'n8n-nodes-sonax-voip.sonaxVoip': 'voice',
	'n8n-nodes-sonax-chat.sonaxChat': 'chat',
};

function migrateWorkflow(input, { custom = false } = {}) {
	const output = structuredClone(input);
	const workflows = Array.isArray(output) ? output : [output];
	let migrated = 0;
	for (const workflow of workflows) {
		if (!workflow || !Array.isArray(workflow.nodes))
			throw new Error('Informe uma exportação de workflow n8n, ou uma lista de workflows.');
		for (const node of workflow.nodes) {
			if (!Object.hasOwn(types, node.type)) continue;
			if (node.typeVersion !== undefined && node.typeVersion !== 1)
				throw new Error('A migração aceita somente a versão 1 do node Sonax combinado.');
			const parameters = node.parameters ?? {};
			const resource =
				types[node.type] === 'combined'
					? parameters.resource === undefined
						? 'voice'
						: parameters.resource
					: types[node.type];
			if (!Object.hasOwn(operations, resource))
				throw new Error(
					'Há um node Sonax com recurso desconhecido ou definido por expressão. Escolha Voz ou Chat antes da migração.',
				);
			const operation =
				parameters.operation ?? (resource === 'voice' ? 'getCallStatus' : 'getMessage');
			if (!operations[resource].has(operation))
				throw new Error(
					'Há um node Sonax com operação incompatível com o recurso. Corrija a operação antes da migração.',
				);
			const nodeName = resource === 'voice' ? 'sonaxVoip' : 'sonaxChat';
			const prefix = custom
				? 'CUSTOM'
				: `n8n-nodes-sonax-${resource === 'voice' ? 'voip' : 'chat'}`;
			const targetType = `${prefix}.${nodeName}`;
			if (node.type === targetType) continue;
			const { resource: _resource, authentication: _authentication, ...remaining } = parameters;
			node.type = targetType;
			node.typeVersion = 1;
			node.parameters = remaining;
			if (node.credentials)
				delete node.credentials[resource === 'voice' ? 'sonaxChatApi' : 'sonaxVoiceApi'];
			migrated++;
		}
	}
	return { output, migrated };
}

function main() {
	const args = process.argv.slice(2);
	const custom = args.includes('--custom');
	const [inputFile, outputFile, ...extra] = args.filter((arg) => arg !== '--custom');
	if (!inputFile || !outputFile || extra.length)
		throw new Error('Uso: node scripts/migrate-split-nodes.cjs entrada.json saida.json [--custom]');
	if (path.resolve(inputFile) === path.resolve(outputFile))
		throw new Error('Escolha um arquivo de saída diferente para preservar o original.');
	const { output, migrated } = migrateWorkflow(JSON.parse(fs.readFileSync(inputFile, 'utf8')), {
		custom,
	});
	fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
	console.log(`${migrated} node(s) Sonax convertido(s). O arquivo original foi preservado.`);
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
module.exports = { migrateWorkflow };

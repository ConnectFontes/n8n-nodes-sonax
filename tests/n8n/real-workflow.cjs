#!/usr/bin/env node
'use strict';
const { nodeTypeFor } = require('./node-types.cjs');
// Builds "Sonax REAL · All 13 operations (one flow)": the same 13 operations as the mock flow, wired to a
// REAL Voice credential and ready to be filled in. It is made so that running it as it is cannot change
// anything on a tenant:
//   - the two read-only operations (Get Call Status, Get Call Recording) are enabled and tolerate errors;
//   - every operation that changes data or sends something is DISABLED, and holds PREENCHER_* placeholders;
//   - Chat nodes have no credential (the Chat API token has not been issued yet).
// Enable one node at a time after filling it in. A disabled node passes its input through, so the chain
// keeps running around it.
//
//   node tests/n8n/real-workflow.cjs --out workflow.json [--node-prefix CUSTOM]
//                                    [--voice-credential <id>:<name>]
//   n8n import:workflow --input workflow.json        (with n8n stopped, see tests/n8n/README.md)
const fs = require('node:fs');
const { uuid, trigger } = require('./workflows.cjs');

const ID = 'SxRealAllOperations';
const NAME = 'Sonax REAL · All 13 operations (one flow)';
const DEFAULT_VOICE_CREDENTIAL = { id: 'SonaxRealVoice01', name: 'Sonax Voice API (real tenant)' };

function build({ nodePrefix = 'CUSTOM', voiceCredential = DEFAULT_VOICE_CREDENTIAL } = {}) {
	// mode: 'read' (enabled, tolerates errors), 'write' (disabled: changes data on the tenant) or
	// 'nocred' (disabled: Chat, no credential exists yet).
	const NOTES = {
		read: 'Somente leitura.',
		write: 'DESATIVADO: age de verdade na Sonax. Preencha, ative e rode só este nó.',
		nocred: 'DESATIVADO: ainda não há credencial do Chat. Crie a credencial, selecione-a e só então ative.',
	};
	const sonax = (name, resource, parameters, mode) => ({
		id: uuid(`${ID}:${name}`),
		name,
		type: nodeTypeFor(resource, nodePrefix),
		typeVersion: 1,
		parameters: { ...parameters },
		...(resource === 'voice' ? { credentials: { sonaxVoiceApi: voiceCredential } } : {}),
		...(mode === 'read' ? { onError: 'continueRegularOutput' } : { disabled: true }),
		notesInFlow: true,
		notes: NOTES[mode],
	});
	const helper = (name, type, typeVersion, parameters) => ({ id: uuid(`${ID}:${name}`), name, type, typeVersion, parameters });

	const voice = [
		sonax('Get Call Status', 'voice', { operation: 'getCallStatus', callId: 'PREENCHER_ID_DA_CHAMADA' }, 'read'),
		sonax('Get Call Recording', 'voice', { operation: 'getCallRecording', callId: 'PREENCHER_ID_DA_CHAMADA', outputBinaryProperty: 'audio' }, 'read'),
		sonax('Click to Call', 'voice', { operation: 'clickToCall', number: 'PREENCHER_SEU_NUMERO', extension: 'PREENCHER_RAMAL' }, 'write'),
		sonax('Create Queue Campaign', 'voice', { operation: 'createQueueCampaign', campaignName: 'TESTE n8n - pode apagar', campaignOptions: { concurrentCalls: 1 } }, 'write'),
		sonax('Create IVR Campaign', 'voice', { operation: 'createIvrCampaign', campaignName: 'TESTE n8n URA - pode apagar', campaignOptions: { concurrentCalls: 1 } }, 'write'),
		sonax('Add Contact to Campaign', 'voice', { operation: 'addCampaignContact', contactId: 'TESTE-1', number: 'PREENCHER_SEU_NUMERO' }, 'write'),
		helper('Contacts CSV text', 'n8n-nodes-base.set', 3.4, {
			assignments: { assignments: [{ id: uuid(`${ID}:csv`), name: 'csv', type: 'string', value: 'nome;telefone\nTESTE;PREENCHER_SEU_NUMERO\n' }] },
			options: {},
		}),
		helper('Make contacts file', 'n8n-nodes-base.convertToFile', 1.1, {
			operation: 'toText',
			sourceProperty: 'csv',
			binaryPropertyName: 'data',
			options: { fileName: 'contacts.csv' },
		}),
		sonax('Add Contacts File to Campaign', 'voice', { operation: 'addCampaignContacts', priority: 1, inputBinaryProperty: 'data' }, 'write'),
		sonax('Start Campaign', 'voice', { operation: 'startCampaign' }, 'write'),
		sonax('Stop Campaign', 'voice', { operation: 'stopCampaign' }, 'write'),
	];
	const chat = [
		sonax('Create Contact', 'chat', { operation: 'createContact', contactName: 'TESTE n8n', mobilePhone: 'PREENCHER_SEU_NUMERO' }, 'nocred'),
		sonax('Send Official Message', 'chat', { operation: 'sendOfficialMessage', templateName: 'PREENCHER_TEMPLATE', to: 'PREENCHER_SEU_NUMERO' }, 'nocred'),
		sonax('Get Message', 'chat', { operation: 'getMessage', messageId: 'PREENCHER_ID_DA_MENSAGEM' }, 'nocred'),
		sonax('Create Kanban Task', 'chat', { operation: 'createTask', boardName: 'PREENCHER_QUADRO', columnName: 'PREENCHER_COLUNA', title: 'TESTE n8n', assignee: 'PREENCHER_EMAIL', participants: [], dueDate: '2026-12-31' }, 'nocred'),
	];

	const start = trigger(ID);
	const connections = {};
	const nodes = [start];
	const heads = [];
	[voice, chat].forEach((lane, row) => {
		lane.forEach((node, column) => {
			node.position = [260 + column * 240, row * 280];
			nodes.push(node);
			if (column === 0) heads.push(node);
			else connections[lane[column - 1].name] = { main: [[{ node: node.name, type: 'main', index: 0 }]] };
		});
	});
	connections[start.name] = { main: [heads.map((node) => ({ node: node.name, type: 'main', index: 0 }))] };

	nodes.push({
		id: uuid(`${ID}:note`),
		name: 'Leia-me',
		type: 'n8n-nodes-base.stickyNote',
		typeVersion: 1,
		position: [240, -330],
		parameters: {
			width: 1400,
			height: 260,
			content: [
				'## Sonax REAL · as 13 operações em um fluxo (SEM mock)',
				'Usa a credencial real **Sonax Voice API (real tenant)**. Linha de cima: Voz (9). Linha de baixo: Chat (4).',
				'**Do jeito que está, é seguro rodar:** só Get Call Status e Get Call Recording ficam ativos (leitura; com o ID de exemplo respondem erro e o fluxo segue). Todo o resto está **desativado**.',
				'**Para testar uma operação:** preencha os campos `PREENCHER_*` (as listas de fila e campanha vêm da API), ative **só aquele nó** e use *Execute step*. Click to Call liga de verdade; campanhas e contatos são criados no tenant; Start/Stop mexem na discagem. Use só recursos de teste, nunca as campanhas existentes.',
				'**Chat:** ainda sem credencial (a Sonax vai enviar). **URA:** a lista de URAs usa a *Voice V2 Password* da credencial (o login V2 é feito na hora de abrir a lista); sem ela, troque o campo para *Expression* e digite o ID da URA do painel.',
			].join('\n\n'),
		},
	});

	return { name: NAME, nodes, connections, settings: { executionOrder: 'v1' }, active: false, id: ID };
}

module.exports = { build, ID, NAME };

if (require.main === module) {
	const argv = process.argv.slice(2);
	const arg = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
	const out = arg('out');
	if (!out) {
		console.error('usage: node tests/n8n/real-workflow.cjs --out <file> [--node-prefix <prefix>] [--voice-credential <id>:<name>]');
		process.exit(2);
	}
	const credential = arg('voice-credential');
	const [id, ...name] = credential ? credential.split(':') : [];
	const workflow = build({
		nodePrefix: arg('node-prefix'),
		voiceCredential: credential ? { id, name: name.join(':') } : undefined,
	});
	// `n8n import:workflow` takes an array or a single workflow.
	fs.writeFileSync(out, `${JSON.stringify(workflow, null, 2)}\n`);
	console.log(`wrote ${out} (${workflow.nodes.length} nodes)`);
}

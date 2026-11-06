'use strict';
// Opt-in, read-only connectivity check. Secrets and tenant records are never printed.
const fs = require('node:fs');
const path = require('node:path');
const {
	httpRequest,
} = require('n8n-core/dist/execution-engine/node-execution-context/utils/request-helper-functions');
const { SonaxVoiceApi } = require('../sonax-voip/dist/credentials/SonaxVoiceApi.credentials.js');
const { loadOptions } = require('../sonax-voip/dist/nodes/shared/methods/LoadOptions.js');

async function main() {
	const filename = path.resolve(process.argv[2] || '.ENV');
	const entries = fs
		.readFileSync(filename, 'utf8')
		.split(/\r?\n/)
		.filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
		.map((line) => {
			const index = line.indexOf('=');
			return [
				line.slice(0, index).trim().toLowerCase(),
				line
					.slice(index + 1)
					.trim()
					.replace(/^(['"])(.*)\1$/, '$2'),
			];
		});
	const clientId = entries.find(([key]) => key.includes('id') && /client|cliente/.test(key))?.[1];
	const apiToken = entries.find(([key]) => key.includes('token') && !/v2|chat/.test(key))?.[1];
	if (!clientId || !apiToken)
		throw new Error('The file must contain a Voice client ID and API token');
	const credential = new SonaxVoiceApi();
	const statuses = [];
	const context = {
		getNode: () => ({
			id: 'live-check',
			name: 'Sonax',
			type: 'n8n-nodes-sonax-voip.sonaxVoip',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		helpers: {
			async httpRequestWithAuthentication(type, options) {
				if (
					type !== 'sonaxVoiceApi' ||
					options.method !== 'GET' ||
					!['lista_filas', 'lista_campanha'].includes(options.qs?.acao)
				)
					throw new Error('This check only allows the two read-only Voice lists');
				const authenticated = await credential.authenticate({ clientId, apiToken }, options);
				const response = await httpRequest({ ...authenticated, returnFullResponse: true });
				statuses.push(response.statusCode);
				return response.body;
			},
		},
	};
	for (const [label, method] of [
		['queues', 'getVoiceQueues'],
		['campaigns', 'getVoiceCampaigns'],
	]) {
		const options = await loadOptions[method].call(context);
		console.log(
			JSON.stringify({
				list: label,
				status: statuses.at(-1),
				count: options.length,
				validOptions: options.every((option) => option.name && option.value),
			}),
		);
	}
}

main().catch((error) => {
	console.error(
		JSON.stringify({
			success: false,
			errorType: error.name,
			message:
				'Read-only check failed. Verify the credential file, connectivity, and Sonax permissions.',
		}),
	);
	process.exitCode = 1;
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dist, rejectsWith } = require('./helpers.cjs');

const { SonaxVoiceApi } = dist('credentials', 'SonaxVoiceApi.credentials.js');
const { multipartRequest } = dist('nodes', 'shared', 'transport', 'Multipart.js');

const VOICE_URL = 'https://api.sonax.net.br/a2billing_v2/admin/Public/dbdial_webapi.php';
const voice = new SonaxVoiceApi();
const voiceCredentials = { clientId: ' 7 ', apiToken: ' voice-token ', v2Password: 'v2-secret' };

test('the Voice credential asks for the Client ID, the API Token and an optional V2 password', () => {
	assert.deepEqual(
		voice.properties.filter((p) => p.type !== 'notice').map((p) => p.name),
		['clientId', 'apiToken', 'v2Password'],
	);
	assert.notEqual(voice.properties.find((p) => p.name === 'v2Password').required, true);
});

test('the V2 password is never added to Voice v1 or Click to Call requests', async () => {
	for (const url of [VOICE_URL, 'https://click2call.sonax.net.br/sonax-click2call.php']) {
		const result = await voice.authenticate(voiceCredentials, { method: 'GET', url });
		assert.doesNotMatch(JSON.stringify(result), /v2-secret/);
	}
});

test('secrets are stored as password fields', () => {
	for (const credential of [voice]) {
		for (const property of credential.properties.filter((p) => /token|password/i.test(p.name))) {
			assert.equal(property.typeOptions?.password, true, `${credential.name}.${property.name}`);
		}
	}
});

test('credential tests call a safe read-only endpoint', () => {
	assert.equal(voice.test.request.qs.acao, 'lista_filas');
});

test('Voice v1 GET sends id_cliente and token in the query string', async () => {
	const result = await voice.authenticate(voiceCredentials, {
		method: 'GET',
		url: VOICE_URL,
		qs: { acao: 'status_chamada', id_chamada: '1' },
	});
	assert.deepEqual(result.qs, {
		acao: 'status_chamada',
		id_chamada: '1',
		id_cliente: '7',
		token: 'voice-token',
	});
	assert.equal(result.disableFollowRedirect, true);
});

test('Click2Call sends only the token (no id_cliente)', async () => {
	const result = await voice.authenticate(voiceCredentials, {
		method: 'GET',
		url: 'https://click2call.sonax.net.br/sonax-click2call.php',
		qs: { numero: '1', ramal: '2' },
	});
	assert.deepEqual(result.qs, { numero: '1', ramal: '2', token: 'voice-token' });
});

test('Voice v1 multipart upload gets id_cliente and token as form fields', async () => {
	const request = {
		method: 'POST',
		url: VOICE_URL,
		...multipartRequest(
			{ acao: 'upload_arquivo_contato' },
			{ data: Buffer.from('a;b'), name: 'c.csv', mimeType: 'text/csv' },
		),
	};
	const result = await voice.authenticate(voiceCredentials, request);
	const body = result.body.toString();
	assert.match(body, /name="id_cliente"\r\n\r\n7\r\n/);
	assert.match(body, /name="token"\r\n\r\nvoice-token\r\n/);
	assert.match(body, /name="arquivo"; filename="c\.csv"/);
	assert.ok(
		body.indexOf('name="id_cliente"') < body.indexOf('name="acao"'),
		'auth fields are prepended',
	);
});

test('Voice credentials are never sent to other hosts or to URLs with embedded credentials', async () => {
	for (const url of [
		'https://evil.example/a2billing_v2/admin/Public/dbdial_webapi.php',
		'https://api.sonax.net.br/other.php',
		// The V2 host is called by the load-options method with its own login, never through authenticate().
		'https://apiv2.sonax.net.br/api/vingadora/listarUras',
		'https://user:pass@api.sonax.net.br/a2billing_v2/admin/Public/dbdial_webapi.php',
	]) {
		await rejectsWith(
			voice.authenticate(voiceCredentials, { method: 'GET', url }),
			/only be sent to the documented/,
		);
	}
});

test('Voice credentials require both client ID and API token', async () => {
	await rejectsWith(
		voice.authenticate({ clientId: '', apiToken: 't' }, { method: 'GET', url: VOICE_URL }),
		/required/,
	);
	await rejectsWith(
		voice.authenticate({ clientId: '7', apiToken: ' ' }, { method: 'GET', url: VOICE_URL }),
		/required/,
	);
});

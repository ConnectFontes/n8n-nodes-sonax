'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dist, rejectsWith } = require('./helpers.cjs');
const { SonaxChatApi } = dist('credentials', 'SonaxChatApi.credentials.js');
const chat = new SonaxChatApi();

test('secrets are stored as password fields', () => {
	for (const credential of [chat]) {
		for (const property of credential.properties.filter((p) => /token|password/i.test(p.name))) {
			assert.equal(property.typeOptions?.password, true, `${credential.name}.${property.name}`);
		}
	}
});

test('credential tests call a safe read-only endpoint', () => {
	assert.equal(chat.test.request.url, 'https://api-chat.sonax.net.br/v2/external/users');
});

test('Chat sends a Bearer token', async () => {
	const result = await chat.authenticate(
		{ apiToken: ' chat-token ' },
		{
			method: 'GET',
			url: 'https://api-chat.sonax.net.br/v2/external/users',
			headers: { Accept: 'application/json' },
		},
	);
	assert.equal(result.headers.Authorization, 'Bearer chat-token');
	assert.equal(result.headers.Accept, 'application/json');
	assert.equal(result.qs, undefined);
});

test('Chat message-data also sends the documented authorization query parameter', async () => {
	const result = await chat.authenticate(
		{ apiToken: 'chat-token' },
		{ method: 'GET', url: 'https://api-chat.sonax.net.br/v2/message-data/abc', qs: { x: '1' } },
	);
	assert.deepEqual(result.qs, { x: '1', authorization: 'chat-token' });
});

test('Chat credentials are never sent to other hosts', async () => {
	for (const url of [
		'https://evil.example/v2/external/users',
		'https://api-chat.sonax.net.br.evil.example/v2/x',
		'https://api-chat.sonax.net.br/not-v2',
	]) {
		await rejectsWith(
			chat.authenticate({ apiToken: 't' }, { method: 'GET', url }),
			/only be sent to the documented/,
		);
	}
	await rejectsWith(
		chat.authenticate(
			{ apiToken: '' },
			{ method: 'GET', url: 'https://api-chat.sonax.net.br/v2/external/users' },
		),
		/required/,
	);
});

test('Chat credential asks only for its API Token', () => {
	assert.deepEqual(
		chat.properties.map((p) => p.name),
		['apiToken'],
	);
	assert.equal(chat.properties[0].required, true);
});

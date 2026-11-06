'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dist, singleContext, rejectsWith } = require('./helpers.cjs');

const hooks = dist('nodes', 'shared', 'transport', 'RequestHooks.js');
const responses = dist('nodes', 'shared', 'transport', 'Response.js');

const voiceRequest = (qs) => ({
	method: 'GET',
	url: 'https://api.sonax.net.br/a2billing_v2/admin/Public/dbdial_webapi.php',
	qs,
});
const call = (hook, context, request) => hook.call(context, request);

test('Chat: official message builds the documented body', async () => {
	const ctx = singleContext({
		templateParameters: { values: [{ value: 'Ana' }, { value: '123' }] },
		clientData: { name: 'Ana', email: 'ana@example.com' },
		protocolTags: { values: [{ tag: 'vip' }, { tag: 'cobranca' }] },
	});
	const result = await call(hooks.prepareOfficialMessage, ctx, {
		body: { from: '5531999990000', to: '5531988880000', message: 'welcome', attendant: '7' },
	});
	assert.deepEqual(result.body, {
		from: '5531999990000',
		to: '5531988880000',
		message: 'welcome',
		attendant: '7',
		paramsTemplate: 'Ana,123',
		clientData: { name: 'Ana', email: 'ana@example.com' },
		protocolData: { tag: ['vip', 'cobranca'] },
	});
});

test('Chat: official message rejects missing fields, commas in parameters and nameless contact data', async () => {
	const empty = { templateParameters: {}, clientData: {}, protocolTags: {} };
	await rejectsWith(
		call(hooks.prepareOfficialMessage, singleContext(empty), { body: { from: '1', to: '2' } }),
		/message is required/,
	);
	await rejectsWith(
		call(
			hooks.prepareOfficialMessage,
			singleContext({ ...empty, templateParameters: { values: [{ value: 'a,b' }] } }),
			{ body: { from: '1', to: '2', message: 't' } },
		),
		/cannot contain commas/,
	);
	await rejectsWith(
		call(
			hooks.prepareOfficialMessage,
			singleContext({ ...empty, clientData: { email: 'x@y.z' } }),
			{ body: { from: '1', to: '2', message: 't' } },
		),
		/Contact Name is required/,
	);
	const minimal = await call(hooks.prepareOfficialMessage, singleContext(empty), {
		body: { from: '1', to: '2', message: 't' },
	});
	assert.deepEqual(minimal.body, { from: '1', to: '2', message: 't' });
});

test('Chat: create contact requires name and mobile phone', async () => {
	const ctx = singleContext({});
	await call(hooks.validateContact, ctx, {
		body: { nome: ' Ana ', celular: '5531999990000', cpf: '1' },
	}).then((r) => assert.equal(r.body.nome, 'Ana'));
	await rejectsWith(
		call(hooks.validateContact, ctx, { body: { celular: '1' } }),
		/Name is required/,
	);
	await rejectsWith(
		call(hooks.validateContact, ctx, { body: { nome: 'A' } }),
		/Mobile Phone is required/,
	);
});

test('Chat: create task builds tag and participant arrays and validates the date', async () => {
	const params = {
		taskTags: { values: [{ tag: 'a' }, { tag: 'b' }] },
		participants: ['x@y.z', 'w@y.z'],
	};
	const body = {
		quadro: 'Vendas',
		lista: 'A FAZER',
		titulo: 'Ligar',
		responsavel: 'x@y.z',
		prazo: '2026-12-01',
	};
	const result = await call(hooks.prepareTask, singleContext(params), { body });
	assert.deepEqual(result.body.tag, ['a', 'b']);
	assert.deepEqual(result.body.participantes, ['x@y.z', 'w@y.z']);
	assert.equal(result.body.prazo, '2026-12-01');

	const iso = await call(hooks.prepareTask, singleContext(params), {
		body: { ...body, prazo: '2026-12-01T10:00:00.000Z' },
	});
	assert.equal(iso.body.prazo, '2026-12-01');
	await rejectsWith(
		call(hooks.prepareTask, singleContext(params), { body: { ...body, prazo: '01/12/2026' } }),
		/YYYY-MM-DD/,
	);
	await rejectsWith(
		call(hooks.prepareTask, singleContext(params), { body: { ...body, prazo: '2026-02-30' } }),
		/valid calendar date/,
	);
	await rejectsWith(
		call(hooks.prepareTask, singleContext({ ...params, taskTags: {} }), { body }),
		/At least one task tag/,
	);
	await rejectsWith(
		call(hooks.prepareTask, singleContext({ ...params, participants: [] }), { body }),
		/At least one participant/,
	);
	await rejectsWith(
		call(hooks.prepareTask, singleContext(params), { body: { ...body, quadro: '' } }),
		/quadro is required/,
	);
});

test('Chat: get message requires an ID', async () => {
	await rejectsWith(
		call(hooks.validateMessageId, singleContext({ messageId: ' ' }), { url: 'u' }),
		/Message ID is required/,
	);
	const request = { url: 'u' };
	assert.equal(
		await call(hooks.validateMessageId, singleContext({ messageId: 'abc' }), request),
		request,
	);
});

test('responses: JSON objects, arrays and plain values are normalised into items', async () => {
	const ctx = singleContext({});
	const run = (body) =>
		responses.normalizeResponse.call(ctx, [], { body, headers: {}, statusCode: 200 });
	assert.deepEqual(
		(await run({ id: 1 })).map((i) => i.json),
		[{ id: 1 }],
	);
	assert.deepEqual(
		(await run('{"id":2}')).map((i) => i.json),
		[{ id: 2 }],
	);
	assert.deepEqual(
		(await run([{ a: 1 }, { a: 2 }])).map((i) => i.json),
		[{ a: 1 }, { a: 2 }],
	);
	assert.deepEqual(
		(await run('OK')).map((i) => i.json),
		[{ result: 'OK' }],
	);
	assert.deepEqual(
		(await run(Buffer.from('{"x":true}'))).map((i) => i.json),
		[{ x: true }],
	);
	assert.deepEqual(
		(await run('')).map((i) => i.json),
		[{ result: '' }],
	);
});

test('responses: API-level failures raise a clear error even on HTTP 200', async () => {
	const ctx = singleContext({});
	const run = (body) =>
		responses.normalizeResponse.call(ctx, [], { body, headers: {}, statusCode: 200 });
	for (const body of [
		{ success: false },
		{ status: false, message: 'x' },
		{ error: 'Token inválido' },
		'ERRO: campanha inexistente',
		'404 Not Found',
	]) {
		await rejectsWith(run(body), /Sonax rejected the request/);
	}
	assert.equal((await run({ error: false })).length, 1);
	assert.equal((await run({ error: null, ok: 1 })).length, 1);
});

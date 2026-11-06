'use strict';
// The public Sonax documentation ships no response examples, so these fixtures use the
// envelope shapes the loaders accept. What matters here: labels become option names,
// internal IDs become values, and an unrecognised response fails loudly instead of
// producing wrong options.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dist, loadContext, rejectsWith } = require('./helpers.cjs');

const loadOptions = {
 ...dist('voip', 'nodes', 'shared', 'methods', 'LoadOptions.js').loadOptions,
 ...dist('chat', 'nodes', 'shared', 'methods', 'LoadOptions.js').loadOptions,
};
const load = (method, context) => loadOptions[method].call(context);

test('Voice v1: parses the pipe/HTML-break format observed in the live API', async () => {
	assert.deepEqual(
		await load('getVoiceQueues', loadContext({ lista_filas: '20|Support<br>10|Sales<br>\r\n' })),
		[
			{ name: 'Sales', value: '10' },
			{ name: 'Support', value: '20' },
		],
	);
	assert.deepEqual(
		await load(
			'getVoiceCampaigns',
			loadContext({ lista_campanha: '20|Retention|P|10|1|N|2|6<br />' }),
		),
		[{ name: 'Retention', value: '20' }],
	);
	await rejectsWith(
		load('getVoiceQueues', loadContext({ lista_filas: 'Unauthorized' })),
		/could not be recognized/,
	);
	await rejectsWith(
		load('getVoiceCampaigns', loadContext({ lista_campanha: '20|Missing columns' })),
		/could not be recognized/,
	);
});

test('queues: shows the queue name and uses the queue ID as value', async () => {
	const ctx = loadContext({ 'acao=lista_filas': {} });
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		assert.equal(credential, 'sonaxVoiceApi');
		assert.equal(options.qs.acao, 'lista_filas');
		return [
			{ id_fila: 20, nome: 'Suporte' },
			{ id_fila: 10, nome: 'Comercial' },
		];
	};
	assert.deepEqual(await load('getVoiceQueues', ctx), [
		{ name: 'Comercial', value: '10' },
		{ name: 'Suporte', value: '20' },
	]);
});

test('campaigns: unwraps a data envelope and asks for all campaigns', async () => {
	const ctx = loadContext({});
	ctx.helpers.httpRequestWithAuthentication = async (_credential, options) => {
		assert.deepEqual(options.qs, { acao: 'lista_campanha', id_campanha: 'todas' });
		return JSON.stringify({ data: [{ id_campanha: '604803', descricao_campanha: 'Cobrança' }] });
	};
	assert.deepEqual(await load('getVoiceCampaigns', ctx), [{ name: 'Cobrança', value: '604803' }]);
});

test('chat users: IDs for the attendant, emails for Kanban users', async () => {
	const users = {
		users: [
			{ id: 'u2', name: 'Bruno', email: 'bruno@x.com' },
			{ id: 'u1', name: 'Ana', email: 'ana@x.com' },
		],
	};
	const ctx = loadContext({ '/external/users': users });
	assert.deepEqual(await load('getChatUsers', ctx), [
		{ name: 'Ana', value: 'u1' },
		{ name: 'Bruno', value: 'u2' },
	]);
	assert.deepEqual(await load('getChatUserEmails', ctx), [
		{ name: 'Ana', value: 'ana@x.com' },
		{ name: 'Bruno', value: 'bruno@x.com' },
	]);
	assert.equal(ctx.calls[0].credential, 'sonaxChatApi');
});

test('official channels: only the official (brokers) channels are listed, by name, with the number as value', async () => {
	const ctx = loadContext({
		'/external/channels': {
			qrcodes: [{ name: 'QR', number: '5511000000000' }],
			brokers: [{ name: 'Oficial SP', number: '5511999990000' }],
		},
	});
	assert.deepEqual(await load('getOfficialChannels', ctx), [
		{ name: 'Oficial SP', value: '5511999990000' },
	]);
});

test("templates: lists only the selected channel's templates", async () => {
	const response = {
		brokers: [
			{ number: '5511999990000', templates: [{ name: 'boas_vindas' }, { name: 'cobranca' }] },
			{ number: '5521888880000', templates: [{ name: 'outro_canal' }] },
		],
	};
	const ctx = loadContext(
		{ 'qrcodes-brokers-templates': response },
		{ from: '+55 (11) 99999-0000' },
	);
	assert.deepEqual(await load('getTemplates', ctx), [
		{ name: 'boas_vindas', value: 'boas_vindas' },
		{ name: 'cobranca', value: 'cobranca' },
	]);
});

test('templates: no request until a channel is chosen, and none for expressions', async () => {
	for (const from of ['', '={{ $json.channel }}']) {
		const ctx = loadContext({}, { from });
		assert.deepEqual(await load('getTemplates', ctx), []);
		assert.equal(ctx.calls.length, 0);
	}
});

test("templates: never shows another channel's templates when the response omits the channel number", async () => {
	const ctx = loadContext(
		{ 'qrcodes-brokers-templates': { brokers: [{ templates: [{ name: 'x' }] }] } },
		{ from: '5511999990000' },
	);
	await rejectsWith(load('getTemplates', ctx), /could not be recognized/);
});

test('bots: shows the bot name and uses its ID', async () => {
	const ctx = loadContext({ '/bot': [{ id: 'b1', name: 'Triagem' }] });
	assert.deepEqual(await load('getBots', ctx), [{ name: 'Triagem', value: 'b1' }]);
});

test('duplicates are collapsed', async () => {
	const ctx = loadContext({
		'/bot': [
			{ id: 'b1', name: 'A' },
			{ id: 'b1', name: 'A again' },
		],
	});
	assert.equal((await load('getBots', ctx)).length, 1);
});

test('an unrecognised response fails with an actionable error instead of wrong options', async () => {
	await rejectsWith(
		load('getVoiceQueues', loadContext({ lista_filas: { foo: 'bar' } })),
		/could not be recognized/,
	);
	await rejectsWith(
		load('getBots', loadContext({ '/bot': [{ id: 'b1' }] })),
		/could not be recognized/,
	);
	await rejectsWith(
		load('getOfficialChannels', loadContext({ '/external/channels': { qrcodes: [] } })),
		/could not be recognized/,
	);
});

test('API-level and transport failures raise errors that do not leak secrets', async () => {
	await rejectsWith(
		load('getVoiceQueues', loadContext({ lista_filas: { error: 'Token inválido' } })),
		/Sonax rejected the request/,
	);
	const failing = loadContext({
		lista_filas: new Error('connect ECONNREFUSED https://api.sonax.net.br/...?token=SECRET-TOKEN'),
	});
	await assert.rejects(load('getVoiceQueues', failing), (error) => {
		assert.match(error.message, /Unable to load Sonax options/);
		assert.doesNotMatch(
			JSON.stringify({ message: error.message, description: error.description }),
			/SECRET-TOKEN/,
		);
		return true;
	});
});

// ─── IVRs: Voice V2, logged in on demand ─────────────────────────────────────────────────────────
// Shapes observed on the real API (2026-11-05): login answers { error, code, message, data: { token, expiracao } },
// a wrong password is HTTP 200 with error: true, and a missing or invalid token is a real HTTP 401.
function v2Context(credentials, ...replies) {
	const calls = [];
	const ctx = loadContext({});
	ctx.getCredentials = async () => credentials;
	ctx.helpers.httpRequest = async (options) => {
		calls.push(options);
		const reply = replies[calls.length - 1];
		if (reply === undefined) throw new Error(`Unexpected request to ${options.url}`);
		if (reply instanceof Error) throw reply;
		return reply;
	};
	ctx.v2calls = calls;
	return ctx;
}
const v2Credentials = { clientId: ' 7 ', apiToken: 'voice-token', v2Password: ' v2-secret ' };
const loginOk = { error: false, code: 200, message: 'Sucesso em criar token de acesso', data: { token: 'jwt-1', expiracao: '1440' } };
const http401 = () => Object.assign(new Error('Request failed with status code 401 https://apiv2.sonax.net.br/x?token=jwt-1'), { httpCode: '401' });

test('IVRs: logs in with the Client ID and the V2 password, then lists with the fresh token', async () => {
	const ctx = v2Context(
		v2Credentials,
		loginOk,
		{ error: false, code: 200, message: 'ok', data: [{ id: 271782, descricao: 'URA REVERSA' }, { id: 5, descricao: 'Boas-vindas' }] },
	);
	assert.deepEqual(await load('getVoiceIvrs', ctx), [
		{ name: 'Boas-vindas', value: '5' },
		{ name: 'URA REVERSA', value: '271782' },
	]);
	const [login, list] = ctx.v2calls;
	assert.equal(login.url, 'https://apiv2.sonax.net.br/login');
	assert.match(login.body.toString(), /name="id"\r\n\r\n7\r\n/);
	assert.match(login.body.toString(), /name="senha"\r\n\r\nv2-secret\r\n/);
	assert.equal(list.url, 'https://apiv2.sonax.net.br/api/vingadora/listarUras');
	assert.equal(list.headers.token, 'jwt-1');
	assert.match(list.body.toString(), /name="idCliente"\r\n\r\n7\r\n/);
	assert.doesNotMatch(list.body.toString(), /v2-secret|voice-token/);
	for (const call of ctx.v2calls) {
		assert.equal(call.method, 'POST');
		assert.equal(call.disableFollowRedirect, true);
		assert.match(call.headers['Content-Type'], /^multipart\/form-data/);
	}
});

test('IVRs: without the V2 password it explains what to do and calls nothing', async () => {
	for (const v2Password of [undefined, '', '   ']) {
		const ctx = v2Context({ clientId: '7', apiToken: 't', v2Password });
		await assert.rejects(load('getVoiceIvrs', ctx), (error) => {
			assert.match(error.message, /Voice V2 Password/);
			assert.match(error.description, /Expression/);
			return true;
		});
		assert.equal(ctx.v2calls.length, 0);
	}
});

test('IVRs: a wrong V2 password (HTTP 200 with error: true) is a credentials error that never echoes the password', async () => {
	const ctx = v2Context(v2Credentials, { error: true, code: 401, message: 'Id ou senha inválido(s)', data: [] });
	await assert.rejects(load('getVoiceIvrs', ctx), (error) => {
		assert.equal(error.message, 'Sonax rejected the credentials');
		assert.match(error.description, /Voice V2 Password/);
		assert.doesNotMatch(JSON.stringify({ message: error.message, description: error.description }), /v2-secret/);
		return true;
	});
	assert.equal(ctx.v2calls.length, 1);
});

test('IVRs: a login without a token is treated as rejected, never as an empty list', async () => {
	for (const reply of [{ error: false, code: 200, data: {} }, { error: false, code: 200, data: { token: ' ' } }, 'nope']) {
		await assert.rejects(load('getVoiceIvrs', v2Context(v2Credentials, reply)), /rejected the credentials/);
	}
});

test('IVRs: HTTP 401 on the list is a credentials error and the token is not leaked', async () => {
	const ctx = v2Context(v2Credentials, loginOk, http401());
	await assert.rejects(load('getVoiceIvrs', ctx), (error) => {
		assert.equal(error.message, 'Sonax rejected the credentials');
		assert.doesNotMatch(JSON.stringify({ message: error.message, description: error.description }), /jwt-1|v2-secret/);
		return true;
	});
});

test('IVRs: other failures stay generic and do not leak, and an unknown list shape fails loudly', async () => {
	const down = new Error('connect ECONNREFUSED https://apiv2.sonax.net.br/login?senha=v2-secret');
	await assert.rejects(load('getVoiceIvrs', v2Context(v2Credentials, down)), (error) => {
		assert.equal(error.message, 'Unable to load Sonax options');
		assert.doesNotMatch(JSON.stringify({ message: error.message, description: error.description }), /v2-secret/);
		return true;
	});
	await rejectsWith(
		load('getVoiceIvrs', v2Context(v2Credentials, loginOk, { error: false, code: 200, data: 'x' })),
		/could not be recognized/,
	);
});

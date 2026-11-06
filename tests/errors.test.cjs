'use strict';
// Failure shapes observed on the real Sonax API (2026-10-29, read-only probes and one editor run):
//  - Voice v1, wrong Client ID or token: HTTP 302 to /click2call/erro_acesso_click2call.php, empty body.
//  - Click to Call, wrong token: HTTP 200 with the text "Ligacao Falhou - Autenticacao Invalida".
//  - Unknown call ID: HTTP 200 with the text "404 not found".
const test = require('node:test');
const assert = require('node:assert/strict');
const { dist, singleContext, loadContext } = require('./helpers.cjs');

const responses = dist('voip', 'nodes', 'shared', 'transport', 'Response.js');
const loadOptions = {
 ...dist('voip', 'nodes', 'shared', 'methods', 'LoadOptions.js').loadOptions,
 ...dist('chat', 'nodes', 'shared', 'methods', 'LoadOptions.js').loadOptions,
};
const { SonaxVoip } = dist('voip', 'nodes', 'SonaxVoip', 'SonaxVoip.node.js');
const { SonaxChat } = dist('chat', 'nodes', 'SonaxChat', 'SonaxChat.node.js');
const { SonaxVoiceApi } = dist('voip', 'credentials', 'SonaxVoiceApi.credentials.js');
const { SonaxChatApi } = dist('chat', 'credentials', 'SonaxChatApi.credentials.js');

const ctx = singleContext({});
const check = (value) => responses.checkResponse(ctx, value);
const status = (statusCode, headers = {}) => responses.checkStatus(ctx, { statusCode, headers });

function failure(run) {
	try {
		run();
	} catch (error) {
		return error;
	}
	assert.fail('expected an error');
}

test('Click to Call: the real "authentication invalid" text is an error, not a success', () => {
	for (const text of ['Ligacao Falhou - Autenticacao Invalida', 'Ligação Falhou - Autenticação Inválida', '  ligacao falhou - AUTENTICACAO INVALIDA\n']) {
		const error = failure(() => check(text));
		assert.equal(error.message, 'Sonax rejected the credentials');
		assert.match(error.description, /Client ID and API Token/);
		assert.match(error.description, /Sonax answered:/);
	}
});

test('other "Ligacao Falhou" texts are request errors that quote what Sonax said', () => {
	const error = failure(() => check('Ligacao Falhou - Ramal indisponivel'));
	assert.equal(error.message, 'Sonax rejected the request');
	assert.match(error.description, /Sonax answered: "Ligacao Falhou - Ramal indisponivel"/);
});

test('"missing parameters" texts (observed on campaign creation, HTTP 200) are errors, not successes', () => {
	for (const text of ['Faltando parâmetros', 'faltando parametros', 'Campos obrigatorios nao informados', 'Campo obrigatório não informado', 'Parametros invalidos', 'Nao informado']) {
		const error = failure(() => check(text));
		assert.equal(error.message, 'Sonax rejected the request', text);
		assert.match(error.description, /Sonax answered:/);
	}
	// A contacts file that does not match the layout: long text, HTTP 200 (observed 2026-11-05).
	const layout = 'O arquivo contém valores que NÃO estão no formato do layout especificado. Verifique o arquivo e tente novamente.<br>Erro na(s) linha(s): \n<br>LINHA 2: Quantidade de colunas inválida.<br>LINHA 2: Telefone do contato inválido.\n<br>LINHA 3: Quantidade de colunas inválida.<br>';
	const bad = failure(() => check(layout));
	assert.equal(bad.message, 'Sonax rejected the request');
	assert.match(bad.description, /layout especificado/);
	// Real successes that must not be mistaken for failures: a campaign ID, a call ID, a status line that mentions "Sem Tabulação", an accepted upload.
	assert.doesNotThrow(() => check('28146879567,1,47999999999'));
	for (const ok of ['2936067', '28137648036', 'indisponivel|0|0|2026-11-05 16:24:33|2026-11-05 16:24:33|N|0|12100000393|5500000000000|Sem Tabulação', 'Parametros do relatorio | faltando nada']) {
		assert.doesNotThrow(() => check(ok), ok);
	}
});

test('error descriptions quote Sonax but never echo secrets from a query string', () => {
	const error = failure(() => check('Erro: falha em https://x/y?id_cliente=7&token=SECRET-VALUE&acao=a'));
	assert.match(error.description, /token=\*\*\*/);
	assert.doesNotMatch(error.description, /SECRET-VALUE/);
	const long = failure(() => check({ error: 'x'.repeat(5000) }));
	assert.ok(long.description.length < 500);
});

test('error bodies are quoted too, and successful answers still pass', () => {
	assert.match(failure(() => check({ error: 'Chamada nao encontrada' })).description, /Chamada nao encontrada/);
	for (const ok of ['OK', '404', 'Ligacao iniciada', { success: true }, { error: false }, { error: null }, [{ a: 1 }], '']) {
		assert.doesNotThrow(() => check(ok));
	}
});

test('wrong Voice credentials (redirect to the access-error page) are explained', () => {
	const error = failure(() => status(302, { location: '/click2call/erro_acesso_click2call.php' }));
	assert.equal(error.message, 'Sonax rejected the credentials');
	assert.doesNotMatch(error.message, /302/);
});

test('401 and 403 are credential errors; other statuses keep their code', () => {
	assert.equal(failure(() => status(401)).message, 'Sonax rejected the credentials');
	assert.equal(failure(() => status(403)).message, 'Sonax rejected the credentials');
	const redirect = failure(() => status(302, { location: '/somewhere-else' }));
	assert.equal(redirect.message, 'Sonax returned HTTP 302');
	assert.match(redirect.description, /redirected/);
	// With an HTTP code, n8n supplies its standard message for that code; the status is also in the description.
	const server = failure(() => status(500));
	assert.equal(String(server.httpCode), '500');
	assert.match(server.description, /HTTP 500/);
	assert.doesNotMatch(server.message, /credentials/);
	for (const ok of [200, 201, 204, 299, undefined]) assert.doesNotThrow(() => status(ok));
});

test('response hooks check the status before reading the body', async () => {
	const redirected = { body: Buffer.alloc(0), headers: { location: '/click2call/erro_acesso_click2call.php' }, statusCode: 302 };
	await assert.rejects(responses.normalizeResponse.call(ctx, [], redirected), /rejected the credentials/);
	await assert.rejects(responses.recordingResponse.call(ctx, [], redirected), /rejected the credentials/);
	await assert.rejects(
		responses.normalizeResponse.call(ctx, [], { body: 'Ligacao Falhou - Autenticacao Invalida', headers: {}, statusCode: 200 }),
		/rejected the credentials/,
	);
});

test('only Voice requests let the hooks see non-2xx responses', () => {
	const nodes = { voice: new SonaxVoip(), chat: new SonaxChat() };
	const operations = (resource) =>
		nodes[resource].description.properties.find((p) => p.name === 'operation').options;
	for (const operation of operations('voice')) {
		assert.equal(operation.routing.request.ignoreHttpStatusErrors, true, operation.value);
	}
	for (const operation of operations('chat')) {
		assert.equal(operation.routing.request.ignoreHttpStatusErrors, undefined, operation.value);
	}
});

test('dropdowns: a rejected credential is explained without leaking the transport error', async () => {
	const secret = 'https://api.sonax.net.br/x?id_cliente=7&token=SECRET-VALUE';
	for (const rejected of [
		Object.assign(new Error(`Request failed with status code 302 ${secret}`), { response: { status: 302 } }),
		Object.assign(new Error(`unauthorized ${secret}`), { httpCode: '401' }),
		Object.assign(new Error(`forbidden ${secret}`), { statusCode: 403 }),
	]) {
		await assert.rejects(loadOptions.getVoiceQueues.call(loadContext({ lista_filas: rejected })), (error) => {
			assert.equal(error.message, 'Sonax rejected the credentials');
			assert.doesNotMatch(JSON.stringify({ message: error.message, description: error.description }), /SECRET-VALUE/);
			return true;
		});
	}
	// Anything else stays generic, and still does not leak.
	await assert.rejects(
		loadOptions.getVoiceQueues.call(loadContext({ lista_filas: new Error(`connect ECONNREFUSED ${secret}`) })),
		(error) => {
			assert.equal(error.message, 'Unable to load Sonax options');
			assert.doesNotMatch(JSON.stringify({ message: error.message, description: error.description }), /SECRET-VALUE/);
			return true;
		},
	);
});

test('the Voice credential explains what "status code 302" means on the connection test', () => {
	// n8n shows "Request failed with status code 302" (2.23) or "Found" (2.46) for a wrong Client ID/token, so say it in the form.
	const notice = new SonaxVoiceApi().properties.find((property) => property.type === 'notice');
	assert.match(notice?.displayName ?? '', /status code 302.*Found.*Client ID.*API Token/);
	assert.equal(new SonaxVoiceApi().test.request.disableFollowRedirect, true);
	assert.equal(new SonaxChatApi().properties.some((property) => property.type === 'notice'), false);
});

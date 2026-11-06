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

test('Voice: required parameters are enforced per operation', async () => {
	const cases = {
		clickToCall: [{ numero: '31999990000' }, /ramal is required/],
		createQueueCampaign: [{ descricao_campanha: 'Camp' }, /id_fila is required/],
		createIvrCampaign: [{ id_ura: '9' }, /descricao_campanha is required/],
		addCampaignContact: [{ id_campanha: '1', numero: '3199' }, /id_contato is required/],
		startCampaign: [{ id_campanha: ' ' }, /id_campanha is required/],
		stopCampaign: [{}, /id_campanha is required/],
		getCallRecording: [{}, /id_chamada is required/],
		getCallStatus: [{}, /id_chamada is required/],
	};
	for (const [operation, [qs, message]] of Object.entries(cases)) {
		await rejectsWith(
			call(hooks.validateVoiceRequest, singleContext({ operation }), voiceRequest(qs)),
			message,
		);
	}
});

test('Voice: valid requests pass through trimmed and unchanged otherwise', async () => {
	const request = voiceRequest({
		acao: 'cria_campanha',
		descricao_campanha: ' Cobrança ',
		id_fila: '42',
		hora_ini: '08:00:00',
		hora_fim: '18:00:00',
		dia_semana_ini: 2,
		dia_semana_fim: 6,
		qtd_simultanea: 3,
		tentativas: 3,
	});
	const result = await call(
		hooks.validateVoiceRequest,
		singleContext({ operation: 'createQueueCampaign' }),
		request,
	);
	assert.equal(result.qs.descricao_campanha, 'Cobrança');
	assert.equal(result.qs.id_fila, '42');
	assert.equal(result.qs.acao, 'cria_campanha');
	assert.equal(result.qs.qtd_simultanea, 3);
});

test('Voice: a new campaign always carries the fields Sonax requires, and never overrides the ones the user set', async () => {
	// Observed on the real API (2026-11-05): without descarte_caixa_postal and auto_concluir Sonax answers HTTP 200
	// "Faltando parâmetros" (IVR) / "Campos obrigatorios nao informados" (queue).
	const required = { qtd_simultanea: 1, descarte_caixa_postal: 'N', auto_concluir: 'N' };
	for (const [operation, qs] of [
		['createQueueCampaign', { acao: 'cria_campanha', descricao_campanha: 'C', id_fila: '42' }],
		[
			'createIvrCampaign',
			{ acao: 'criar_campanha_ura_reversa', descricao_campanha: 'C', id_ura: '9' },
		],
	]) {
		const defaults = await call(
			hooks.validateVoiceRequest,
			singleContext({ operation }),
			voiceRequest(qs),
		);
		for (const [key, value] of Object.entries(required))
			assert.equal(defaults.qs[key], value, `${operation} ${key}`);
		const chosen = await call(
			hooks.validateVoiceRequest,
			singleContext({ operation }),
			voiceRequest({ ...qs, qtd_simultanea: 4, descarte_caixa_postal: 'S', auto_concluir: 'S' }),
		);
		assert.deepEqual(
			[chosen.qs.qtd_simultanea, chosen.qs.descarte_caixa_postal, chosen.qs.auto_concluir],
			[4, 'S', 'S'],
		);
	}
	// Other operations are left alone.
	const start = await call(
		hooks.validateVoiceRequest,
		singleContext({ operation: 'startCampaign' }),
		voiceRequest({ id_campanha: '1' }),
	);
	assert.equal(start.qs.descarte_caixa_postal, undefined);
});

test('Voice: rejects malformed times, weekdays, counts and schedules', async () => {
	const ctx = singleContext({ operation: 'createQueueCampaign' });
	const base = { descricao_campanha: 'c', id_fila: '1' };
	await rejectsWith(
		call(hooks.validateVoiceRequest, ctx, voiceRequest({ ...base, hora_ini: '8:00' })),
		/hora_ini must use HH:mm:ss/,
	);
	await rejectsWith(
		call(hooks.validateVoiceRequest, ctx, voiceRequest({ ...base, hora_fim: '24:00:00' })),
		/hora_fim must use HH:mm:ss/,
	);
	await rejectsWith(
		call(hooks.validateVoiceRequest, ctx, voiceRequest({ ...base, dia_semana_ini: 8 })),
		/between 1 and 7/,
	);
	await rejectsWith(
		call(hooks.validateVoiceRequest, ctx, voiceRequest({ ...base, qtd_simultanea: 0 })),
		/positive integer/,
	);
	await rejectsWith(
		call(hooks.validateVoiceRequest, ctx, voiceRequest({ ...base, tentativas: 1.5 })),
		/positive integer/,
	);

	const contact = singleContext({ operation: 'addCampaignContact' });
	const fields = { id_campanha: '1', id_contato: '2', numero: '3199' };
	await call(
		hooks.validateVoiceRequest,
		contact,
		voiceRequest({ ...fields, data_hora: '2026-12-01 09:00:00' }),
	);
	await rejectsWith(
		call(
			hooks.validateVoiceRequest,
			contact,
			voiceRequest({ ...fields, data_hora: '2026-12-01T09:00' }),
		),
		/YYYY-MM-DD HH:mm:ss/,
	);
	await rejectsWith(
		call(
			hooks.validateVoiceRequest,
			contact,
			voiceRequest({ ...fields, data_hora: '2026-02-31 09:00:00' }),
		),
		/valid calendar date/,
	);
});

test('Voice: contacts file upload builds a multipart request without altering the file', async () => {
	const file = Buffer.from('nome;telefone\nAna;31999990000\n');
	const helpers = {
		assertBinaryData: (property) => ({ fileName: 'contatos.csv', mimeType: 'text/csv', property }),
		getBinaryDataBuffer: async () => file,
	};
	const ctx = singleContext(
		{ campaignId: '612413', priority: 2, inputBinaryProperty: 'data' },
		helpers,
	);
	const result = await call(hooks.uploadContacts, ctx, { method: 'POST', url: 'u' });
	const body = result.body.toString();
	assert.match(body, /name="acao"\r\n\r\nupload_arquivo_contato\r\n/);
	assert.match(body, /name="id_campanha"\r\n\r\n612413\r\n/);
	assert.match(body, /name="prioridade"\r\n\r\n2\r\n/);
	assert.match(
		body,
		/name="arquivo"; filename="contatos\.csv"\r\nContent-Type: text\/csv\r\n\r\nnome;telefone\nAna;31999990000\n\r\n/,
	);
	assert.match(
		result.headers['Content-Type'],
		/^multipart\/form-data; boundary=sonax-[a-f0-9]{48}$/,
	);
	assert.equal(result.json, false);
});

test('Voice: empty contacts file, missing campaign and bad priority are rejected', async () => {
	const helpers = {
		assertBinaryData: () => ({}),
		getBinaryDataBuffer: async () => Buffer.alloc(0),
	};
	await rejectsWith(
		call(hooks.uploadContacts, singleContext({ campaignId: '1', priority: 1 }, helpers), {
			method: 'POST',
			url: 'u',
		}),
		/file is empty/,
	);
	await rejectsWith(
		call(hooks.uploadContacts, singleContext({ campaignId: '', priority: 1 }, helpers), {
			method: 'POST',
			url: 'u',
		}),
		/Campaign is required/,
	);
	await rejectsWith(
		call(hooks.uploadContacts, singleContext({ campaignId: '1', priority: 0 }, helpers), {
			method: 'POST',
			url: 'u',
		}),
		/Priority must be a positive integer/,
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

test('responses: recording returns a URL as JSON and audio as binary data', async () => {
	const ctx = singleContext(
		{ callId: '6011875473/../x', outputBinaryProperty: 'audio' },
		{
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				fileName,
				mimeType,
				size: buffer.length,
			}),
		},
	);
	const url = await responses.recordingResponse.call(ctx, [], {
		body: Buffer.from('https://rec.sonax.net.br/a.mp3\n'),
		headers: {},
		statusCode: 200,
	});
	assert.deepEqual(url[0].json, { url: 'https://rec.sonax.net.br/a.mp3' });

	const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]);
	const audio = await responses.recordingResponse.call(ctx, [], {
		body: wav,
		headers: { 'content-type': 'audio/wav' },
		statusCode: 200,
	});
	assert.equal(audio[0].binary.audio.mimeType, 'audio/wav');
	assert.equal(audio[0].binary.audio.fileName, 'recording-6011875473____x.wav');
	assert.equal(audio[0].json.callId, '6011875473/../x');

	const mp3 = await responses.recordingResponse.call(ctx, [], {
		body: Buffer.from('ID3....'),
		headers: { 'content-type': 'audio/mpeg' },
		statusCode: 200,
	});
	assert.match(mp3[0].binary.audio.fileName, /\.mp3$/);

	const json = await responses.recordingResponse.call(ctx, [], {
		body: Buffer.from('{"gravacao":"https://x/y.wav"}'),
		headers: { 'content-type': 'application/json' },
		statusCode: 200,
	});
	assert.deepEqual(json[0].json, { gravacao: 'https://x/y.wav' });
	await rejectsWith(
		responses.recordingResponse.call(ctx, [], {
			body: Buffer.from('{"error":"sem gravação"}'),
			headers: {},
			statusCode: 200,
		}),
		/Sonax rejected the request/,
	);
});

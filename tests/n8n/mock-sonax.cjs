'use strict';
// Local stand-in for the four Sonax hosts, used to run real n8n workflows without side effects.
//
// n8n is started with HTTPS_PROXY pointing here and NODE_EXTRA_CA_CERTS trusting a throwaway CA, so
// the node, credentials and HTTP helpers run unchanged against these fixtures. Every request is
// recorded (secrets redacted) so a test can assert exactly what was sent. Any other host is refused,
// which keeps runs hermetic: nothing can reach a real Sonax tenant through this proxy.
//
// Response bodies are plausible fixtures, NOT captured from Sonax: the public docs publish no
// examples, apart from the pipe-delimited Voice v1 lists observed against a real tenant.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOSTS = [
	'api.sonax.net.br',
	'click2call.sonax.net.br',
	'apiv2.sonax.net.br',
	'api-chat.sonax.net.br',
];

// The fake credentials the mock accepts. They are also what the mock n8n credentials contain.
const MOCK = {
	clientId: 'mock-client',
	apiToken: 'mock-token',
	v2Password: 'mock-v2-password',
	v2Token: 'mock-v2-token',
	chatToken: 'mock-chat-token',
	wrongToken: 'wrong-token',
};

function run(command, args) {
	execFileSync(command, args, { stdio: 'pipe' });
}

/** Creates (or reuses) a throwaway CA and a server certificate valid for the mocked hosts. */
function ensureCerts(dir) {
	fs.mkdirSync(dir, { recursive: true });
	const file = (name) => path.join(dir, name);
	const fresh =
		fs.existsSync(file('leaf.pem')) &&
		Date.now() - fs.statSync(file('leaf.pem')).mtimeMs < 20 * 24 * 3600 * 1000;
	if (!fresh) {
		run('openssl', [
			'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
			'-keyout', file('ca.key'), '-out', file('ca.pem'), '-subj', '/CN=Sonax Mock Test CA',
			'-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
		]);
		run('openssl', [
			'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', file('leaf.key'),
			'-out', file('leaf.csr'), '-subj', `/CN=${HOSTS[0]}`,
		]);
		fs.writeFileSync(
			file('leaf.ext'),
			`subjectAltName=${HOSTS.map((host) => `DNS:${host}`).join(',')}\nextendedKeyUsage=serverAuth\n`,
		);
		run('openssl', [
			'x509', '-req', '-in', file('leaf.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key'),
			'-CAcreateserial', '-out', file('leaf.pem'), '-days', '30', '-extfile', file('leaf.ext'),
		]);
		for (const name of ['ca.key', 'leaf.key']) fs.chmodSync(file(name), 0o600);
	}
	return { ca: file('ca.pem'), key: file('leaf.key'), cert: file('leaf.pem') };
}

function parseMultipart(body, contentType) {
	const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
	const fields = {};
	if (!boundary) return { fields };
	for (const part of body.toString('latin1').split(`--${boundary}`).slice(1)) {
		if (part.startsWith('--')) break;
		const split = part.indexOf('\r\n\r\n');
		if (split < 0) continue;
		const headers = part.slice(0, split);
		const content = part.slice(split + 4, part.endsWith('\r\n') ? -2 : undefined);
		const name = /name="([^"]+)"/.exec(headers)?.[1];
		const filename = /filename="([^"]*)"/.exec(headers)?.[1];
		if (!name) continue;
		if (filename === undefined) {
			fields[name] = content;
		} else {
			const data = Buffer.from(content, 'latin1');
			fields[name] = {
				filename,
				contentType: /Content-Type: ([^\r\n]+)/i.exec(headers)?.[1],
				size: data.length,
				text: data.toString('utf8'),
			};
		}
	}
	return { fields };
}

const SECRET_KEYS = /^(token|authorization|senha)$/i;
function redact(object) {
	const out = {};
	for (const [key, value] of Object.entries(object ?? {})) {
		out[key] = SECRET_KEYS.test(key) ? '***' : value;
	}
	return out;
}

function wav() {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0, 'ascii');
	header.writeUInt32LE(36 + 800, 4);
	header.write('WAVEfmt ', 8, 'ascii');
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(8000, 24);
	header.writeUInt32LE(16000, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36, 'ascii');
	header.writeUInt32LE(800, 40);
	return Buffer.concat([header, Buffer.alloc(800)]);
}

const json = (value, status = 200) => ({ status, type: 'application/json', body: JSON.stringify(value) });
const text = (value, status = 200) => ({ status, type: 'text/html; charset=UTF-8', body: value });
const redirect = (location) => ({ status: 302, type: 'text/html; charset=UTF-8', body: '', headers: { Location: location } });

// Read-only Voice v1 actions. Only these may be forwarded to the real API, and only in passthrough mode.
const READ_ONLY_VOICE_ACTIONS = new Set(['lista_filas', 'lista_campanha', 'status_chamada', 'pega_gravacao']);

function voiceAction(action, params) {
	switch (action) {
		case 'lista_filas':
			return text('100|Mock queue A<br>200|Mock queue B');
		case 'lista_campanha':
			return text(
				['900001|Mock campaign one|a|b|c|d|e|f', '900002|Mock campaign two|a|b|c|d|e|f'].join('<br>'),
			);
		case 'cria_campanha':
		case 'criar_campanha_ura_reversa':
			// Observed on the real API (2026-11-05): without these three fields Sonax answers HTTP 200 with a text; with
			// them it answers the new campaign ID as plain digits.
			if (!params.descarte_caixa_postal || !params.auto_concluir || !params.qtd_simultanea) {
				return text(action === 'criar_campanha_ura_reversa' ? 'Faltando parâmetros' : 'Campos obrigatorios nao informados');
			}
			return text('900100');
		case 'chamada':
			return json({ success: true, id_chamada: 6011854393 });
		case 'play_campanha':
		case 'stop_campanha':
			return json({ success: true });
		case 'status_chamada':
			if (params.id_chamada === 'ERR') return json({ error: 'Chamada nao encontrada' });
			return json({ id_chamada: params.id_chamada, status: 'ANSWERED', duracao: 42 });
		case 'pega_gravacao':
			if (params.id_chamada === '1002') {
				return { status: 200, type: 'text/plain', body: 'https://gravacoes.sonax.example/1002.mp3' };
			}
			return { status: 200, type: 'audio/wav', body: wav() };
		default:
			return text(`acao desconhecida: ${action}`, 400);
	}
}

const USERS = [
	{ id: 'u1', name: 'Ana Mock', email: 'ana@example.test' },
	{ id: 'u2', name: 'Bruno Mock', email: 'bruno@example.test' },
];

function route(entry, params, fields) {
	const { host, method, pathname } = entry;
	if (host === 'api.sonax.net.br' && pathname.endsWith('/dbdial_webapi.php')) {
		const merged = { ...params, ...fields };
		const ok = merged.token === MOCK.apiToken && merged.id_cliente === MOCK.clientId;
		entry.authOk = ok;
		// Observed on the real API: a wrong Client ID or token redirects to an access-error page.
		if (!ok) return redirect('/click2call/erro_acesso_click2call.php');
		if (merged.acao === 'upload_arquivo_contato') {
			// Observed on the real API (2026-11-05): the layout is `id;telefone;nome` (phone without the country code, no header, no
			// blank lines). A file that does not match is answered with HTTP 200 and a text naming the lines; an accepted one with
			// "<id>,<quantidade>,<telefone>".
			const lines = fields.arquivo ? fields.arquivo.text.split(/\r?\n/) : [];
			const errors = [];
			lines.forEach((line, index) => {
				const columns = line.split(';');
				if (columns.length !== 3) errors.push(`LINHA ${index + 2}: Quantidade de colunas inválida.`);
				else if (!/^\d{10,13}$/.test(columns[1])) errors.push(`LINHA ${index + 2}: Telefone do contato inválido.`);
			});
			if (!lines.length || errors.length) {
				return text(`O arquivo contém valores que NÃO estão no formato do layout especificado. Verifique o arquivo e tente novamente.<br>Erro na(s) linha(s): \n<br>${errors.join('<br>')}<br>`);
			}
			return text(`28146879567,${lines.length},${lines[0].split(';')[1]}`);
		}
		return voiceAction(merged.acao, merged);
	}
	if (host === 'click2call.sonax.net.br') {
		entry.authOk = params.token === MOCK.apiToken;
		// Observed on the real API: HTTP 200 with a failure text.
		// Observed on the real API (2026-11-05): success is the call ID as plain digits.
		return entry.authOk ? text('28137648036') : text('Ligacao Falhou - Autenticacao Invalida');
	}
	if (host === 'apiv2.sonax.net.br' && pathname === '/login') {
		// Observed on the real API (2026-11-05): a wrong password is answered with HTTP 200 and error: true.
		entry.authOk = fields.id === MOCK.clientId && fields.senha === MOCK.v2Password;
		return entry.authOk
			? json({ error: false, code: 200, message: 'Sucesso em criar token de acesso', data: { token: MOCK.v2Token, expiracao: '1440' } })
			: json({ error: true, code: 401, message: 'Id ou senha inválido(s)', data: [] });
	}
	if (host === 'apiv2.sonax.net.br' && pathname === '/api/vingadora/listarUras') {
		entry.authOk = entry.headers.token === MOCK.v2Token && fields.idCliente === MOCK.clientId;
		// Observed on the real API: a missing or invalid token is a real HTTP 401 with an empty body.
		if (!entry.authOk) return { status: 401, type: 'text/plain', body: '' };
		return json({ error: false, code: 200, message: 'Sucesso', data: [{ id: 55, descricao: 'Mock IVR' }] });
	}
	if (host === 'api-chat.sonax.net.br') {
		entry.authOk = entry.headers.authorization === `Bearer ${MOCK.chatToken}`;
		if (!entry.authOk) return json({ error: 'unauthorized' }, 401);
		if (method === 'GET' && pathname === '/v2/external/users') return json({ users: USERS });
		if (method === 'GET' && pathname === '/v2/external/channels') {
			return json({ qrcodes: [], brokers: [{ name: 'Mock official channel', number: '5500000000001' }] });
		}
		if (method === 'GET' && pathname === '/v2/pabx/tenant/qrcodes-brokers-templates') {
			return json({ brokers: [{ number: '5500000000001', templates: [{ name: 'welcome' }, { name: 'reminder' }] }] });
		}
		if (method === 'GET' && pathname === '/v2/bot') return json([{ id: 'b1', name: 'Mock triage bot' }]);
		if (method === 'POST' && pathname === '/v2/send-message-protocol') {
			// Shape observed on the real API (2026-11-05): `error: false` is the success flag.
			return json({ error: false, protocol: { _id: 'protocol-1', protocol_number: '1700000000' }, wppFrom: '5500000000001', message: { _id: 'msg-123' }, messageId: 'msg-123' });
		}
		if (method === 'GET' && pathname.startsWith('/v2/message-data/')) {
			const id = decodeURIComponent(pathname.slice('/v2/message-data/'.length));
			if (id === 'missing') return json({ error: 'not found' }, 404);
			if (params.authorization !== MOCK.chatToken) return json({ error: 'authorization query missing' }, 401);
			return json({ id, status: 'delivered', to: '5500000000002' });
		}
		if (method === 'POST' && pathname === '/v2/task-api/create-contact') return json({ error: false, status: true, data: 'contact-1' });
		if (method === 'POST' && pathname === '/v2/task-api/create-task') return json({ error: false, status: true, data: 'task-1' });
	}
	return json({ error: `no mock for ${method} ${host}${pathname}` }, 404);
}

/**
 * Starts the proxy. Resolves to { port, requests, refused, reset, close }.
 *
 * `passthrough` is for an interactive editor session, not for tests: requests that carry a REAL Voice
 * Client ID (anything but the mock one) are forwarded to the real API when they are read-only lookups,
 * and every other host is tunnelled untouched so the rest of n8n keeps working. Mutating requests are
 * never forwarded. Without it, everything except the four Sonax hosts is refused.
 */
async function startMock({ certDir, port = 0, passthrough = false, onRequest }) {
	const tls = ensureCerts(certDir);
	const requests = [];
	const refused = [];

	const origin = https.createServer(
		{ key: fs.readFileSync(tls.key), cert: fs.readFileSync(tls.cert) },
		(request, response) => {
			const chunks = [];
			request.on('data', (chunk) => chunks.push(chunk));
			request.on('end', () => {
				const url = new URL(request.url, 'https://placeholder');
				const host = String(request.headers.host ?? '').split(':')[0];
				const body = Buffer.concat(chunks);
				const contentType = String(request.headers['content-type'] ?? '');
				const params = Object.fromEntries(url.searchParams);
				let fields = {};
				let jsonBody;
				if (contentType.startsWith('multipart/form-data')) fields = parseMultipart(body, contentType).fields;
				else if (contentType.includes('json') && body.length) {
					try { jsonBody = JSON.parse(body.toString('utf8')); } catch { jsonBody = '<invalid json>'; }
				}
				const entry = {
					host,
					method: request.method,
					pathname: url.pathname,
					headers: { authorization: request.headers.authorization, token: request.headers.token },
					authOk: false,
				};
				if (
					passthrough &&
					host === 'api.sonax.net.br' &&
					request.method === 'GET' &&
					READ_ONLY_VOICE_ACTIONS.has(params.acao) &&
					params.id_cliente !== MOCK.clientId
				) {
					const upstream = https.request(
						{ host, path: request.url, method: 'GET', headers: { accept: request.headers.accept ?? '*/*' } },
						(answer) => {
							response.writeHead(answer.statusCode, answer.headers);
							answer.pipe(response);
						},
					);
					upstream.on('error', () => {
						response.writeHead(502);
						response.end('Could not reach the real Sonax API');
					});
					upstream.end();
					const forwarded = { host, method: 'GET', pathname: url.pathname, forwarded: true, query: redact({ acao: params.acao }) };
					requests.push(forwarded);
					onRequest?.(forwarded);
					return;
				}
				const reply = route(entry, params, fields);
				requests.push({
					...entry,
					query: redact(params),
					form: redact(
						Object.fromEntries(
							Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v : { ...v }]),
						),
					),
					json: jsonBody,
					headers: {
						authorization: entry.headers.authorization ? 'Bearer ***' : undefined,
						token: entry.headers.token ? '***' : undefined,
					},
					status: reply.status,
				});
				onRequest?.({ ...entry, query: params, status: reply.status });
				response.writeHead(reply.status, { 'Content-Type': reply.type, ...reply.headers });
				response.end(reply.body);
			});
		},
	);

	const proxy = http.createServer((_request, response) => {
		response.writeHead(405);
		response.end('This proxy only supports CONNECT');
	});
	proxy.on('connect', (request, socket, head) => {
		const [host, targetPort] = String(request.url).split(':');
		if (!HOSTS.includes(host)) {
			if (passthrough && !/sonax/i.test(host)) {
				// Not a Sonax host: tunnel the connection untouched.
				const upstream = net.connect(Number(targetPort) || 443, host, () => {
					socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
					if (head?.length) upstream.write(head);
					upstream.pipe(socket);
					socket.pipe(upstream);
				});
				upstream.on('error', () => socket.destroy());
				socket.on('error', () => upstream.destroy());
				return;
			}
			refused.push(host);
			socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
			return;
		}
		socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
		if (head?.length) socket.unshift(head);
		origin.emit('connection', socket);
	});

	await new Promise((resolve) => proxy.listen(port, '127.0.0.1', resolve));
	return {
		port: proxy.address().port,
		caFile: tls.ca,
		requests,
		refused,
		reset() {
			requests.length = 0;
			refused.length = 0;
		},
		close() {
			proxy.closeAllConnections?.();
			origin.closeAllConnections?.();
			return new Promise((resolve) => proxy.close(() => origin.close(resolve)));
		},
	};
}

module.exports = { HOSTS, MOCK, startMock, ensureCerts };

if (require.main === module) {
	const certDir = path.join(__dirname, '..', '..', '.dev', 'mock-tls');
	const passthrough = process.argv.includes('--passthrough');
	const onRequest = (entry) => {
		// Never print query values: only the action, and for the mock whether it accepted the credentials.
		const detail = entry.forwarded ? 'forwarded to the REAL API (read-only)' : `mock → HTTP ${entry.status}${entry.authOk === false ? ' (credentials rejected)' : ''}`;
		console.log(`${new Date().toISOString().slice(11, 19)} ${entry.method} ${entry.host}${entry.pathname}${entry.query?.acao ? ` acao=${entry.query.acao}` : ''}  ${detail}`);
	};
	startMock({ certDir, port: Number(process.env.PORT ?? 8899), passthrough, onRequest }).then((mock) => {
		console.log(`Sonax mock proxy listening on http://127.0.0.1:${mock.port}${passthrough ? ' (passthrough: real read-only Voice lookups are forwarded)' : ''}`);
		console.log('Start n8n with:');
		console.log(`  HTTPS_PROXY=http://127.0.0.1:${mock.port} NO_PROXY=localhost,127.0.0.1 NODE_EXTRA_CA_CERTS=${mock.caFile} npm run dev`);
		setInterval(() => {}, 1 << 30);
	});
}

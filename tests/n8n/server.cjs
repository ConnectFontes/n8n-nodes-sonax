'use strict';
// Starts a throwaway n8n server for the editor-path suites: fresh database in the OS temp folder (never
// your data), a free port, this project linked as a custom node, an owner account, the MOCK credentials,
// and the Sonax mock as its HTTPS proxy.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMock } = require('./mock-sonax.cjs');
const { credentials } = require('./workflows.cjs');

const root = path.join(__dirname, '..', '..');
const OWNER = { email: 'owner@example.test', firstName: 'Test', lastName: 'Owner', password: 'Sonax-Test-1234' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

async function waitForReady(base, child, logFile) {
	for (let i = 0; i < 240; i++) {
		if (child.exitCode !== null) throw new Error(`n8n exited early (code ${child.exitCode}); see ${logFile}`);
		try {
			// /healthz answers while n8n is still starting; readiness waits for the database and routes.
			if ((await fetch(`${base}/healthz/readiness`)).ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error(`n8n did not become ready; see ${logFile}`);
}

async function startServer({ n8n, nodePrefix = 'CUSTOM', products = ['voip', 'chat'] }) {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sonax-n8n-test-'));
	const customModules = path.join(folder, '.n8n', 'custom', 'node_modules');
	fs.mkdirSync(customModules, { recursive: true });
	for (const product of products) {
		if (!['voip', 'chat'].includes(product)) throw new Error('Unknown product');
		fs.symlinkSync(path.join(root, 'sonax-' + product), path.join(customModules, 'n8n-nodes-sonax-' + product));
	}
	const logFile = path.join(folder, 'n8n.log');

	const mock = await startMock({ certDir: path.join(root, '.dev', 'mock-tls') });
	const proxy = `http://127.0.0.1:${mock.port}`;
	const port = await freePort();
	// The task broker listens on 5679 by default, which collides with any n8n already running on this machine.
	const brokerPort = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const log = fs.openSync(logFile, 'w');
	const child = spawn(n8n, ['start'], {
		cwd: folder,
		stdio: ['ignore', log, log],
		env: {
			...process.env,
			N8N_USER_FOLDER: folder,
			N8N_PORT: String(port),
			N8N_RUNNERS_BROKER_PORT: String(brokerPort),
			N8N_LISTEN_ADDRESS: '127.0.0.1',
			N8N_SECURE_COOKIE: 'false',
			N8N_DIAGNOSTICS_ENABLED: 'false',
			N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
			N8N_PERSONALIZATION_ENABLED: 'false',
			HTTPS_PROXY: proxy,
			https_proxy: proxy,
			NO_PROXY: 'localhost,127.0.0.1',
			no_proxy: 'localhost,127.0.0.1',
			NODE_EXTRA_CA_CERTS: mock.caFile,
		},
	});

	const server = { base, folder, logFile, mock, nodePrefix, stored: {} };
	server.stop = async (keepFolder) => {
		child.kill('SIGTERM');
		await sleep(1500);
		if (child.exitCode === null) child.kill('SIGKILL');
		await mock.close();
		fs.closeSync(log);
		if (keepFolder) console.log(`n8n server log kept at ${logFile}`);
		else fs.rmSync(folder, { recursive: true, force: true });
	};

	try {
		await waitForReady(base, child, logFile);
		const setup = await fetch(`${base}/rest/owner/setup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(OWNER),
		});
		if (!setup.ok) throw new Error(`owner setup failed: HTTP ${setup.status} ${(await setup.text()).slice(0, 200)}`);
		const cookie = setup.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
		server.call = async (method, url, body) => {
			const response = await fetch(`${base}/rest/${url}`, {
				method,
				headers: { 'Content-Type': 'application/json', Cookie: cookie, 'push-ref': 'sonax-test' },
				body: body ? JSON.stringify(body) : undefined,
			});
			const text = await response.text();
			let json;
			try { json = JSON.parse(text); } catch { json = undefined; }
			return { status: response.status, json, text };
		};
		for (const credential of credentials.filter(c => products.includes(c.type === 'sonaxVoiceApi' ? 'voip' : 'chat'))) {
			const created = await server.call('POST', 'credentials', { name: credential.name, type: credential.type, data: credential.data });
			const id = created.json?.data?.id ?? created.json?.id;
			if (!id) throw new Error(`could not create credential ${credential.name}: HTTP ${created.status} ${created.text.slice(0, 200)}`);
			server.stored[credential.id] = { id, name: credential.name };
		}
		return server;
	} catch (error) {
		await server.stop(true);
		throw error;
	}
}

module.exports = { startServer, sleep };

#!/usr/bin/env node
'use strict';
// Runs every workflow in workflows.cjs through a real n8n (`n8n execute`, the same execution engine as
// the editor) against the local Sonax mock, and checks both the node output and the exact requests
// that reached the mock. Nothing here talks to a real Sonax tenant.
//
//   node tests/n8n/run.cjs --n8n <path-to-n8n-binary> [--user-folder <dir>] [--node-prefix <prefix>]
//                          [--only <text>] [--skip-import] [--verbose]
//
// Defaults match `npm run dev`: user folder ~/.n8n-node-cli and node prefix CUSTOM. Use
// `--node-prefix community` for an n8n that has the package installed as a community node.
// The workflows and the MOCK credentials are imported into that n8n's database (re-running
// overwrites them by id), so they also show up in its editor.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMock } = require('./mock-sonax.cjs');
const { credentials, forNodeTypes } = require('./workflows.cjs');
const { evaluateExecution } = require('./check.cjs');

const root = path.join(__dirname, '..', '..');

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('--')) args[key] = true;
		else args[key] = argv[++i];
	}
	return args;
}

function exec(command, args, env, timeoutMs = 180000) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { env, cwd: root });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

function parseResult(stdout) {
	const start = stdout.search(/^\{$/m);
	const end = stdout.lastIndexOf('\n}');
	if (start < 0 || end < start) return undefined;
	try {
		return JSON.parse(stdout.slice(start, end + 2));
	} catch {
		return undefined;
	}
}

function outcomeOf(run) {
	const result = parseResult(run.stdout);
	const failure = result?.data?.resultData?.error;
	return {
		succeeded: run.code === 0 && !failure,
		errorText: `${run.stdout}\n${run.stderr}`,
		runData: result?.data?.resultData?.runData,
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const n8n = String(args.n8n ?? process.env.N8N_BIN ?? 'n8n');
	const userFolder = String(args['user-folder'] ?? path.join(os.homedir(), '.n8n-node-cli'));
	const nodePrefix = String(args['node-prefix'] ?? 'CUSTOM');
	const definitions = forNodeTypes(nodePrefix).filter(
		(definition) => !args.only || definition.name.toLowerCase().includes(String(args.only).toLowerCase()),
	);
	if (!definitions.length) throw new Error('No workflow matches --only');

	const mock = await startMock({ certDir: path.join(root, '.dev', 'mock-tls') });
	const proxy = `http://127.0.0.1:${mock.port}`;
	const env = {
		...process.env,
		N8N_USER_FOLDER: userFolder,
		N8N_DIAGNOSTICS_ENABLED: 'false',
		N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
		N8N_PERSONALIZATION_ENABLED: 'false',
		HTTPS_PROXY: proxy,
		https_proxy: proxy,
		NO_PROXY: 'localhost,127.0.0.1',
		no_proxy: 'localhost,127.0.0.1',
		NODE_EXTRA_CA_CERTS: mock.caFile,
	};
	delete env.HTTP_PROXY;
	delete env.http_proxy;

	console.log(`n8n: ${n8n}\nuser folder: ${userFolder}\nnode prefix: ${nodePrefix}\nmock proxy: ${proxy}\n`);

	const work = path.join(root, '.dev', 'n8n-test');
	fs.rmSync(path.join(work, 'workflows'), { recursive: true, force: true });
	fs.mkdirSync(path.join(work, 'workflows'), { recursive: true });
	fs.writeFileSync(path.join(work, 'credentials.json'), JSON.stringify(credentials, null, 2));
	for (const { expect: _expect, ...workflow } of definitions) {
		fs.writeFileSync(path.join(work, 'workflows', `${workflow.id}.json`), JSON.stringify(workflow, null, 2));
	}

	if (!args['skip-import']) {
		for (const [label, importArgs] of [
			['credentials', ['import:credentials', `--input=${path.join(work, 'credentials.json')}`]],
			['workflows', ['import:workflow', '--separate', `--input=${path.join(work, 'workflows')}`]],
		]) {
			const imported = await exec(n8n, importArgs, env);
			const ok = imported.code === 0 && /Successfully imported/.test(imported.stdout);
			console.log(`${ok ? 'imported' : 'FAILED to import'} ${label}`);
			if (!ok) {
				console.log(`${imported.stdout}\n${imported.stderr}`.split('\n').filter((line) => /error|ELOOP/i.test(line)).slice(0, 5).map((line) => line.slice(0, 300)).join('\n'));
				await mock.close();
				process.exit(1);
			}
		}
		console.log('');
	}

	let failed = 0;
	for (const definition of definitions) {
		mock.reset();
		const started = Date.now();
		const run = await exec(n8n, ['execute', `--id=${definition.id}`, '--rawOutput'], env);
		const problems = evaluateExecution(definition, outcomeOf(run), mock.requests, mock.refused);
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		if (args.verbose) {
			for (const request of mock.requests) {
				const { headers: _headers, ...shown } = request;
				console.log(`    request: ${JSON.stringify(shown)}`);
			}
		}
		if (problems.length) {
			failed++;
			console.log(`✖ ${definition.name} (${seconds}s)`);
			for (const problem of problems) console.log(`    - ${problem}`);
		} else {
			console.log(`✔ ${definition.name} (${seconds}s)`);
		}
	}

	await mock.close();
	console.log(`\n${definitions.length - failed}/${definitions.length} workflows passed`);
	process.exit(failed ? 1 : 0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

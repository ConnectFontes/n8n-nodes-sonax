'use strict';
// Shared by the n8n test suites: compares what a workflow did with what workflows.cjs says it must do.
const { isDeepStrictEqual } = require('node:util');

/** Mismatches between `actual` and `expected`; extra keys in `actual` are allowed. */
function subset(actual, expected, where = '') {
	if (expected === undefined) return actual === undefined ? [] : [`${where}: expected absent, got ${JSON.stringify(actual)}`];
	if (expected instanceof RegExp) return expected.test(String(actual)) ? [] : [`${where}: ${JSON.stringify(actual)} does not match ${expected}`];
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length !== expected.length) {
			return [`${where}: expected ${expected.length} item(s), got ${Array.isArray(actual) ? actual.length : JSON.stringify(actual)}`];
		}
		return expected.flatMap((item, index) => subset(actual[index], item, `${where}[${index}]`));
	}
	if (expected !== null && typeof expected === 'object') {
		if (actual === null || typeof actual !== 'object') return [`${where}: expected an object, got ${JSON.stringify(actual)}`];
		return Object.entries(expected).flatMap(([key, value]) => subset(actual[key], value, `${where}.${key}`));
	}
	return actual === expected ? [] : [`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

/** Query strings and form fields must match exactly (so stray parameters are caught); JSON bodies too. */
function compareRequest(actual, expected) {
	const problems = [];
	for (const key of ['host', 'method', 'pathname', 'authOk']) {
		if (expected[key] !== undefined && actual[key] !== expected[key]) {
			problems.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
		}
	}
	for (const key of ['query', 'form']) {
		if (!(key in expected)) continue;
		const wanted = Object.fromEntries(Object.entries(expected[key]).filter(([, value]) => value !== undefined));
		const got = actual[key] ?? {};
		const extra = Object.keys(got).filter((name) => !(name in wanted));
		const missing = Object.keys(wanted).filter((name) => !(name in got));
		if (extra.length) problems.push(`${key}: unexpected field(s) ${extra.join(', ')}`);
		if (missing.length) problems.push(`${key}: missing field(s) ${missing.join(', ')}`);
		problems.push(...subset(got, wanted, key).filter((line) => !/expected absent/.test(line)));
	}
	if ('json' in expected && !isDeepStrictEqual(actual.json, expected.json)) {
		problems.push(`json: expected ${JSON.stringify(expected.json)}, got ${JSON.stringify(actual.json)}`);
	}
	return problems;
}

function compareRequests(actual, expected) {
	if (actual.length !== expected.length) {
		return [`expected ${expected.length} request(s) to Sonax, saw ${actual.length}`];
	}
	const remaining = [...actual];
	const problems = [];
	for (const wanted of expected) {
		let best;
		const index = remaining.findIndex((candidate) => {
			const mismatches = compareRequest(candidate, wanted);
			if (!best || mismatches.length < best.length) best = mismatches;
			return mismatches.length === 0;
		});
		if (index < 0) problems.push(...(best ?? ['no request seen']).map((line) => `request ${wanted.method} ${wanted.pathname ?? wanted.host}: ${line}`));
		else remaining.splice(index, 1);
	}
	return problems;
}

/** n8n stores executions as a "flatted" array in which numeric strings are indexes into the array. */
function unflatten(text) {
	const array = JSON.parse(text);
	const cache = new Map();
	const resolve = (index) => {
		if (cache.has(index)) return cache.get(index);
		const value = array[index];
		if (Array.isArray(value)) {
			const out = [];
			cache.set(index, out);
			for (const item of value) out.push(reference(item));
			return out;
		}
		if (value !== null && typeof value === 'object') {
			const out = {};
			cache.set(index, out);
			for (const [key, item] of Object.entries(value)) out[key] = reference(item);
			return out;
		}
		cache.set(index, value);
		return value;
	};
	const reference = (item) => (typeof item === 'string' && /^\d+$/.test(item) ? resolve(Number(item)) : item);
	return resolve(0);
}

function nodeItems(runData, nodeName) {
	return (runData?.[nodeName] ?? []).flatMap((run) => (run.data?.main ?? []).flat().filter(Boolean));
}

/**
 * Checks one execution against its definition.
 * `outcome`: { succeeded, errorText, runData } where errorText is everything the user could read about a failure.
 */
function evaluateExecution(definition, outcome, requests, refused) {
	const { expect } = definition;
	const problems = [];
	if (refused.length) problems.push(`blocked connection(s) to unexpected host(s): ${[...new Set(refused)].join(', ')}`);
	if (/ELOOP/.test(outcome.errorText ?? '')) problems.push('n8n reported ELOOP (symlink loop while scanning custom nodes)');
	problems.push(...compareRequests(requests, expect.requests ?? []));

	if (expect.fails) {
		if (outcome.succeeded) problems.push('the workflow was expected to fail but succeeded');
		else if (!expect.fails.test(outcome.errorText ?? '')) problems.push(`the failure message does not match ${expect.fails}: ${String(outcome.errorText).slice(0, 200)}`);
		return problems;
	}
	if (!outcome.succeeded) {
		problems.push(`the workflow failed: ${String(outcome.errorText).slice(0, 300)}`);
		return problems;
	}
	if (!outcome.runData) return [...problems, 'could not read the execution result'];
	for (const [nodeName, wanted] of Object.entries(expect.outputs ?? {})) {
		const items = nodeItems(outcome.runData, nodeName);
		problems.push(...subset(items.map((item) => item.json), wanted, `output of "${nodeName}"`));
		for (const [property, details] of Object.entries(expect.binary?.[nodeName] ?? {})) {
			const actual = items[0]?.binary?.[property];
			if (!actual) problems.push(`"${nodeName}": missing binary property "${property}"`);
			else problems.push(...subset(actual, details, `binary "${property}" of "${nodeName}"`));
		}
	}
	return problems;
}

module.exports = { subset, compareRequest, compareRequests, unflatten, nodeItems, evaluateExecution };

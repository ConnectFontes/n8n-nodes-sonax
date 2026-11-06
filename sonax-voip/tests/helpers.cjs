'use strict';
const path = require('node:path');

const dist = (...parts) => require(path.join(__dirname, '..', 'dist', ...parts));

function fakeNode() {
	return {
		id: 'test',
		name: 'Sonax',
		type: 'n8n-nodes-sonax-voip.sonaxVoip',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
}

/** Minimal stand-in for IExecuteSingleFunctions, enough for the preSend/postReceive hooks. */
function singleContext(params = {}, helpers = {}) {
	return {
		getNode: fakeNode,
		getItemIndex: () => 0,
		getNodeParameter(name, fallback) {
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Parameter "${name}" is not set in the test context`);
		},
		helpers,
	};
}

/** Minimal stand-in for ILoadOptionsFunctions. `responses` maps a substring of "url?query" to the body returned for it. */
function loadContext(responses, params = {}) {
	const calls = [];
	return {
		calls,
		getNode: fakeNode,
		getNodeParameter(name, fallback) {
			return name in params ? params[name] : fallback;
		},
		helpers: {
			async httpRequestWithAuthentication(credential, options) {
				calls.push({ credential, options });
				const target = `${options.url}?${new URLSearchParams(options.qs ?? {})}`;
				const key = Object.keys(responses).find((fragment) => target.includes(fragment));
				if (key === undefined) throw new Error(`Unexpected request to ${options.url}`);
				const body = responses[key];
				if (body instanceof Error) throw body;
				return body;
			},
		},
	};
}

async function rejectsWith(promise, pattern) {
	const assert = require('node:assert/strict');
	await assert.rejects(promise, (error) => {
		assert.match(error.message, pattern);
		return true;
	});
}

module.exports = { dist, singleContext, loadContext, rejectsWith };

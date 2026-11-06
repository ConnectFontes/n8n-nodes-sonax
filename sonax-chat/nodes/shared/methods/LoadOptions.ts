import type {
	IDataObject,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { CHAT_BASE_URL } from '../transport/Constants';
import {
	checkResponse,
	credentialsRejected,
	decodeResponse,
	isObject,
} from '../transport/Response';

function statusOf(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const candidate = error as {
		response?: { status?: unknown; statusCode?: unknown };
		status?: unknown;
		statusCode?: unknown;
		httpCode?: unknown;
	};
	const value =
		candidate.response?.status ??
		candidate.response?.statusCode ??
		candidate.status ??
		candidate.statusCode ??
		candidate.httpCode;
	const status = Number(value);
	return Number.isInteger(status) ? status : undefined;
}

async function request(
	context: ILoadOptionsFunctions,
	credential: string,
	options: IHttpRequestOptions,
): Promise<unknown> {
	let response: unknown;
	try {
		response = decodeResponse(
			await context.helpers.httpRequestWithAuthentication.call(context, credential, {
				...options,
				json: options.json ?? true,
				disableFollowRedirect: true,
				timeout: 30000,
			}),
		);
	} catch (error) {
		// The transport error is intentionally not forwarded: it can echo the request URL, which carries the Voice token.
		// Only its status is inspected: wrong Voice credentials are answered with a redirect, Chat with 401/403.
		const status = statusOf(error);
		if (
			status !== undefined &&
			([301, 302, 303, 307, 308, 401, 403] as number[]).includes(status)
		) {
			credentialsRejected(context);
		}
		throw new NodeApiError(
			context.getNode(),
			{ message: 'Unable to load Sonax options' },
			{ description: 'Check the credential, permissions, and API availability.' },
		);
	}
	checkResponse(context, response);
	return response;
}

function unrecognized(context: ILoadOptionsFunctions): never {
	throw new NodeOperationError(
		context.getNode(),
		'The Sonax list response could not be recognized',
		{
			description:
				'The public documentation does not provide response schemas. Check the response structure with Sonax support; an existing value can also be supplied through an expression.',
		},
	);
}

/** Accept only explicit list envelopes, never silently turn an unknown response into options. */
export function records(value: unknown, keys: string[]): IDataObject[] | undefined {
	if (Array.isArray(value)) return value.every(isObject) ? value : undefined;
	if (!isObject(value)) return undefined;
	for (const key of [...keys, 'data', 'result', 'results']) {
		if (value[key] !== undefined) {
			const nested = records(value[key], keys);
			if (nested !== undefined) return nested;
		}
	}
	return undefined;
}

function pick(record: IDataObject, fields: string[]): string | undefined {
	for (const field of fields) {
		const value = record[field];
		if ((typeof value === 'string' || typeof value === 'number') && String(value).trim())
			return String(value).trim();
	}
	return undefined;
}

export function optionsFromRecords(
	context: ILoadOptionsFunctions,
	rows: IDataObject[] | undefined,
	values: string[],
	names: string[],
): INodePropertyOptions[] {
	if (!rows) return unrecognized(context);
	const options: INodePropertyOptions[] = [];
	for (const row of rows) {
		const value = pick(row, values);
		const name = pick(row, names);
		if (value === undefined || name === undefined) return unrecognized(context);
		if (!options.some((option) => option.value === value)) options.push({ name, value });
	}
	return options.sort((a, b) => a.name.localeCompare(b.name));
}

function envelope(value: unknown): unknown {
	if (isObject(value) && isObject(value.data)) return envelope(value.data);
	if (isObject(value) && isObject(value.result)) return envelope(value.result);
	return value;
}

export const loadOptions = {
	async getChatUsers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const data = await request(this, 'sonaxChatApi', {
			method: 'GET',
			url: `${CHAT_BASE_URL}/external/users`,
		});
		return optionsFromRecords(
			this,
			records(data, ['users', 'usuarios']),
			['id', '_id', 'id_usuario'],
			['name', 'nome'],
		);
	},

	async getChatUserEmails(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const data = await request(this, 'sonaxChatApi', {
			method: 'GET',
			url: `${CHAT_BASE_URL}/external/users`,
		});
		return optionsFromRecords(
			this,
			records(data, ['users', 'usuarios']),
			['email'],
			['name', 'nome'],
		);
	},

	async getOfficialChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const data = envelope(
			await request(this, 'sonaxChatApi', {
				method: 'GET',
				url: `${CHAT_BASE_URL}/external/channels`,
			}),
		);
		if (!isObject(data) || !('brokers' in data)) return unrecognized(this);
		return optionsFromRecords(
			this,
			records(data.brokers, ['brokers']),
			['number', 'numero', 'phone'],
			['name', 'nome'],
		);
	},

	async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const from = String(this.getNodeParameter('from', '') ?? '');
		if (!from || from.startsWith('=')) return [];
		const data = envelope(
			await request(this, 'sonaxChatApi', {
				method: 'GET',
				url: `${CHAT_BASE_URL}/pabx/tenant/qrcodes-brokers-templates`,
			}),
		);
		// Only inspect official brokers when both official and QR-code channels are returned.
		const channels = records(isObject(data) && 'brokers' in data ? data.brokers : data, [
			'channels',
			'templates',
		]);
		if (!channels) return unrecognized(this);
		const selected: IDataObject[] = [];
		for (const row of channels) {
			const channel = pick(row, ['number', 'numero', 'phone', 'from', 'channelNumber']);
			if (channel && channel.replace(/\D/g, '') !== from.replace(/\D/g, '')) continue;
			if ('templates' in row) {
				// Do not display another channel's templates when the response omits its number.
				if (!channel) return unrecognized(this);
				const templates = records(row.templates, ['templates']);
				if (!templates) return unrecognized(this);
				selected.push(...templates);
			} else {
				selected.push(row);
			}
		}
		return optionsFromRecords(
			this,
			selected,
			['name', 'templateName', 'nome'],
			['name', 'templateName', 'nome'],
		);
	},

	async getBots(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const data = await request(this, 'sonaxChatApi', {
			method: 'GET',
			url: `${CHAT_BASE_URL}/bot`,
		});
		return optionsFromRecords(
			this,
			records(data, ['bots']),
			['id', '_id', 'code'],
			['name', 'nome', 'title'],
		);
	},
};

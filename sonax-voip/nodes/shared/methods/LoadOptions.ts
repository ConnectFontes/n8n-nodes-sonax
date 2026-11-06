import type {
	IDataObject,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { IVR_LIST_URL, VOICE_URL, VOICE_V2_LOGIN_URL } from '../transport/Constants';
import { multipartRequest } from '../transport/Multipart';
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

/**
 * Voice V2 is called without the credential helper on purpose: its token is requested here, with the
 * Client ID and the Voice V2 Password, and lives only for this call (it is valid for 24 hours and a new
 * login does not invalidate older tokens). The URLs are fixed constants, so nothing is sent elsewhere.
 */
async function voiceV2(
	context: ILoadOptionsFunctions,
	url: string,
	fields: Record<string, string>,
	headers: Record<string, string> = {},
): Promise<unknown> {
	const multipart = multipartRequest(fields);
	try {
		return decodeResponse(
			await context.helpers.httpRequest({
				method: 'POST',
				url,
				...multipart,
				headers: { ...multipart.headers, ...headers },
				json: true,
				disableFollowRedirect: true,
				timeout: 30000,
			}),
		);
	} catch (error) {
		// Never forward the transport error: it can echo the request. A missing or invalid token is a real HTTP 401.
		if (statusOf(error) === 401) voiceV2Rejected(context);
		throw new NodeApiError(
			context.getNode(),
			{ message: 'Unable to load Sonax options' },
			{ description: 'Check the Voice V2 Password, permissions, and API availability.' },
		);
	}
}

function voiceV2Rejected(context: ILoadOptionsFunctions): never {
	throw new NodeApiError(
		context.getNode(),
		{ message: 'Sonax rejected the credentials' },
		{
			description:
				'The Voice V2 login was refused. Check the Voice V2 Password in the credential; the login ID is your Client ID.',
		},
	);
}

async function voiceV2Token(
	context: ILoadOptionsFunctions,
	clientId: string,
	password: string,
): Promise<string> {
	const body = await voiceV2(context, VOICE_V2_LOGIN_URL, { id: clientId, senha: password });
	// A wrong password is answered with HTTP 200 and { error: true, code: 401 } in the body.
	const token = isObject(body) && isObject(body.data) ? body.data.token : undefined;
	if ((isObject(body) && body.error === true) || typeof token !== 'string' || !token.trim())
		voiceV2Rejected(context);
	return token;
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

/** Voice v1 returns ID|label rows separated by HTML breaks, verified against the API. */
function voiceRecords(value: unknown, keys: string[], columns: number): IDataObject[] | undefined {
	if (typeof value !== 'string') return records(value, keys);
	const lines = value
		.split(/<br\s*\/?\s*>|\r?\n/i)
		.map((line) => line.trim())
		.filter(Boolean);
	if (!lines.length) return [];
	const output: IDataObject[] = [];
	for (const line of lines) {
		const parts = line.split('|');
		if (parts.length !== columns || !/^\d+$/.test(parts[0].trim()) || !parts[1].trim())
			return undefined;
		output.push({ id: parts[0].trim(), name: parts[1].trim() });
	}
	return output;
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

export const loadOptions = {
	async getVoiceQueues(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const data = await request(this, 'sonaxVoiceApi', {
			method: 'GET',
			url: VOICE_URL,
			qs: { acao: 'lista_filas' },
			json: false,
		});
		return optionsFromRecords(
			this,
			voiceRecords(data, ['filas', 'queues'], 2),
			['id_fila', 'id', 'idFila'],
			['nome', 'name', 'descricao', 'nome_fila', 'fila'],
		);
	},

	async getVoiceCampaigns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const data = await request(this, 'sonaxVoiceApi', {
			method: 'GET',
			url: VOICE_URL,
			qs: { acao: 'lista_campanha', id_campanha: 'todas' },
			json: false,
		});
		return optionsFromRecords(
			this,
			voiceRecords(data, ['campanhas', 'campaigns'], 8),
			['id_campanha', 'id', 'idCampanha'],
			['descricao_campanha', 'nome', 'name', 'descricao'],
		);
	},

	async getVoiceIvrs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const credentials = await this.getCredentials('sonaxVoiceApi');
		const clientId = String(credentials.clientId ?? '').trim();
		const password = String(credentials.v2Password ?? '').trim();
		if (!clientId) throw new NodeOperationError(this.getNode(), 'Client ID is required');
		if (!password)
			throw new NodeOperationError(
				this.getNode(),
				'Set the Voice V2 Password in the Sonax VoIP API credential to load IVRs',
				{
					description:
						'Or switch this field to Expression and type the IVR ID shown in your Sonax PBX panel.',
				},
			);
		const token = await voiceV2Token(this, clientId, password);
		const data = await voiceV2(this, IVR_LIST_URL, { idCliente: clientId }, { token });
		checkResponse(this, data);
		return optionsFromRecords(
			this,
			records(data, ['uras', 'ivrs']),
			['id_ura', 'id', 'idUra'],
			['nome', 'name', 'descricao', 'nome_ura'],
		);
	},
};

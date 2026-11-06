import type {
	IDataObject,
	IExecuteSingleFunctions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export function isObject(value: unknown): value is IDataObject {
	return (
		typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
	);
}

export function decodeResponse(body: unknown): unknown {
	const value = Buffer.isBuffer(body) ? body.toString('utf8') : body;
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

type ErrorContext = Pick<IExecuteSingleFunctions | ILoadOptionsFunctions, 'getNode'>;

const withoutAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A short excerpt of what Sonax answered, to help the user; secrets in a query string are masked. */
function excerpt(value: unknown): string | undefined {
	const raw =
		typeof value === 'string'
			? value
			: isObject(value) && typeof value.error === 'string'
				? value.error
				: isObject(value) && typeof value.message === 'string'
					? value.message
					: undefined;
	const text = raw
		?.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b(token|authorization)=[^&\s]*/gi, '$1=***');
	return text ? text.slice(0, 200) : undefined;
}

/** Sonax refused the Client ID / API Token. */
export function credentialsRejected(context: ErrorContext, detail?: string, hint?: string): never {
	throw new NodeApiError(
		context.getNode(),
		{ message: 'Sonax rejected the credentials' },
		{
			description: [
				'Check the Client ID and API Token in the credential used by this node.',
				hint,
				detail ? `Sonax answered: "${detail}"` : undefined,
			]
				.filter(Boolean)
				.join(' '),
		},
	);
}

export function checkResponse(context: ErrorContext, value: unknown): void {
	const failed =
		isObject(value) &&
		(value.success === false ||
			value.status === false ||
			(value.error !== undefined &&
				value.error !== false &&
				value.error !== null &&
				value.error !== ''));
	// Voice answers some failures with HTTP 200 and a short Portuguese text, e.g. "Ligacao Falhou - Autenticacao Invalida".
	const text = typeof value === 'string' ? withoutAccents(value.trim()).toLowerCase() : '';
	if (/autenticacao invalida/.test(text)) credentialsRejected(context, excerpt(value));
	// Observed on the real API (2026-11-05): creating a campaign without the mandatory fields answers HTTP 200 with
	// "Faltando parâmetros" (IVR) or "Campos obrigatorios nao informados" (queue). Anchored at the start and only for
	// short bodies without a "|", so a pipe-separated status line is never mistaken for a failure.
	const missingFields =
		text.length < 200 &&
		!text.includes('|') &&
		/^(?:faltando\b|campos? obrigatorios?\b|parametros? (?:obrigatorios?|invalidos?|faltando)\b|nao informad)/.test(
			text,
		);
	// Observed on the real API (2026-11-05): a contacts file that does not match the campaign layout is answered with HTTP 200 and
	// "O arquivo contém valores que NÃO estão no formato do layout especificado… Erro na(s) linha(s): LINHA 2: …".
	const badFile = /^o arquivo contem valores que nao estao no formato/.test(text);
	const failedText =
		missingFields ||
		badFile ||
		/^(?:404\s+not found\b|erro(?:r)?\s*[:-]|ligacao falhou\b)/.test(text);
	if (failed || failedText) {
		const detail = excerpt(value);
		throw new NodeApiError(
			context.getNode(),
			{ message: 'Sonax rejected the request' },
			{
				description: [
					'The API returned an error response. Check the selected resources, parameters, and credential permissions.',
					detail ? `Sonax answered: "${detail}"` : undefined,
				]
					.filter(Boolean)
					.join(' '),
			},
		);
	}
}

/**
 * Voice requests do not let n8n throw on non-2xx, so the reason can be explained here. Wrong credentials
 * are answered with a redirect to an access-error page, which is never followed.
 */
export function checkStatus(
	context: ErrorContext,
	response: Pick<IN8nHttpFullResponse, 'statusCode' | 'headers'>,
): void {
	const status = Number(response.statusCode);
	if (!Number.isFinite(status) || (status >= 200 && status < 300)) return;
	const location = String(response.headers?.location ?? '');
	if (
		status === 401 ||
		status === 403 ||
		(status >= 300 && status < 400 && /erro_acesso/i.test(location))
	) {
		credentialsRejected(context);
	}
	throw new NodeApiError(
		context.getNode(),
		{ message: `Sonax returned HTTP ${status}` },
		{
			httpCode: String(status),
			description:
				`Sonax answered with HTTP ${status}. ` +
				(status >= 300 && status < 400
					? 'It redirected the request instead of answering it: check the Client ID and API Token, and that the request targets a documented Sonax endpoint.'
					: 'Check the selected resources, parameters, and credential permissions.'),
		},
	);
}

export async function normalizeResponse(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	checkStatus(this, response);
	const value = decodeResponse(response.body);
	checkResponse(this, value);
	const values = Array.isArray(value) ? value : [value];
	return values.map((entry) => ({
		json: isObject(entry) ? entry : ({ result: entry ?? null } as IDataObject),
		pairedItem: { item: this.getItemIndex() },
	}));
}

export async function recordingResponse(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	checkStatus(this, response);
	const body = response.body as unknown;
	const value = decodeResponse(body);
	checkResponse(this, value);
	if (typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim())) {
		return [{ json: { url: value.trim() }, pairedItem: { item: this.getItemIndex() } }];
	}
	const contentType = String(
		response.headers['content-type'] ?? response.headers['Content-Type'] ?? '',
	).split(';')[0];
	const audio =
		Buffer.isBuffer(body) &&
		(body.subarray(0, 4).toString('ascii') === 'RIFF' ||
			body.subarray(0, 4).toString('ascii') === 'OggS' ||
			body.subarray(0, 4).toString('ascii') === 'fLaC' ||
			contentType.startsWith('audio/') ||
			(contentType === 'application/octet-stream' && !isObject(value) && !Array.isArray(value)));
	if (!audio || !Buffer.isBuffer(body)) return normalizeResponse.call(this, items, response);
	const property = String(this.getNodeParameter('outputBinaryProperty', 'data')).trim() || 'data';
	const id = String(this.getNodeParameter('callId')).replace(/[^a-zA-Z0-9_-]/g, '_');
	const extension = contentType.includes('mpeg')
		? 'mp3'
		: contentType.includes('ogg')
			? 'ogg'
			: 'wav';
	const binary = await this.helpers.prepareBinaryData(
		body,
		`recording-${id}.${extension}`,
		contentType.startsWith('audio/') ? contentType : 'audio/wav',
	);
	return [
		{
			json: { callId: this.getNodeParameter('callId') },
			binary: { [property]: binary },
			pairedItem: { item: this.getItemIndex() },
		},
	];
}

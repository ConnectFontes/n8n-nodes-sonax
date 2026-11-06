import type { IDataObject, IExecuteSingleFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { isObject } from './Response';

function fail(context: IExecuteSingleFunctions, message: string): never {
	throw new NodeOperationError(context.getNode(), message, { itemIndex: context.getItemIndex() });
}

function required(context: IExecuteSingleFunctions, value: unknown, label: string): string {
	if (typeof value !== 'string' && typeof value !== 'number')
		return fail(context, `${label} is required`);
	const text = String(value).trim();
	if (!text) return fail(context, `${label} is required`);
	return text;
}

function dateOnly(context: IExecuteSingleFunctions, value: unknown, label: string): string {
	const text = required(context, value, label);
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
	if (!match) return fail(context, `${label} must use YYYY-MM-DD`);
	const date = `${match[1]}-${match[2]}-${match[3]}`;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
		return fail(context, `${label} must be a valid calendar date`);
	return date;
}

function rows(value: unknown, key: string): IDataObject[] {
	return isObject(value) && Array.isArray(value[key])
		? (value[key] as unknown[]).filter(isObject)
		: [];
}

export async function prepareOfficialMessage(
	this: IExecuteSingleFunctions,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const body: IDataObject = { ...(isObject(request.body) ? request.body : {}) };
	for (const field of ['from', 'to', 'message']) body[field] = required(this, body[field], field);
	const params = rows(this.getNodeParameter('templateParameters', {}), 'values');
	if (params.length) {
		const values = params.map((row) => String(row.value ?? ''));
		if (values.some((value) => value.includes(',')))
			fail(
				this,
				'Template parameter values cannot contain commas: Sonax documents a comma-separated string without an escaping format',
			);
		body.paramsTemplate = values.join(',');
	}
	const client = this.getNodeParameter('clientData', {}) as IDataObject;
	if (Object.keys(client).length) {
		required(this, client.name, 'Contact Name');
		body.clientData = client;
	}
	const tags = rows(this.getNodeParameter('protocolTags', {}), 'values').map((row) =>
		required(this, row.tag, 'Protocol Tag'),
	);
	if (tags.length) body.protocolData = { tag: tags };
	return { ...request, body };
}

export async function validateContact(
	this: IExecuteSingleFunctions,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const body: IDataObject = { ...(isObject(request.body) ? request.body : {}) };
	body.nome = required(this, body.nome, 'Name');
	body.celular = required(this, body.celular, 'Mobile Phone');
	return { ...request, body };
}

export async function prepareTask(
	this: IExecuteSingleFunctions,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const body: IDataObject = { ...(isObject(request.body) ? request.body : {}) };
	for (const field of ['quadro', 'lista', 'titulo', 'responsavel'])
		body[field] = required(this, body[field], field);
	body.prazo = dateOnly(this, body.prazo, 'Due Date');
	const tags = rows(this.getNodeParameter('taskTags', {}), 'values').map((row) =>
		required(this, row.tag, 'Tag'),
	);
	const participants = this.getNodeParameter('participants', []) as unknown;
	if (!Array.isArray(participants)) fail(this, 'Participants must be a list of users');
	const participantEmails = participants.map((value) => required(this, value, 'Participant'));
	if (tags.length === 0) fail(this, 'At least one task tag is required');
	if (participantEmails.length === 0) fail(this, 'At least one participant is required');
	body.tag = tags;
	body.participantes = participantEmails;
	return { ...request, body };
}

export async function validateMessageId(
	this: IExecuteSingleFunctions,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	required(this, this.getNodeParameter('messageId'), 'Message ID');
	return request;
}

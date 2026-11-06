import type { IExecuteSingleFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { multipartRequest } from './Multipart';

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

function positiveInteger(context: IExecuteSingleFunctions, value: unknown, label: string): void {
	if (!Number.isInteger(Number(value)) || Number(value) < 1)
		fail(context, `${label} must be a positive integer`);
}

export async function validateVoiceRequest(
	this: IExecuteSingleFunctions,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const operation = String(this.getNodeParameter('operation'));
	const qs = { ...request.qs };
	// Sonax rejects a new campaign without these (HTTP 200 "Faltando parâmetros" / "Campos obrigatorios nao informados"),
	// so they always go out, with the values of the documentation examples that match the node's own defaults.
	if (operation === 'createQueueCampaign' || operation === 'createIvrCampaign') {
		if (qs.qtd_simultanea === undefined) qs.qtd_simultanea = 1;
		if (qs.descarte_caixa_postal === undefined) qs.descarte_caixa_postal = 'N';
		if (qs.auto_concluir === undefined) qs.auto_concluir = 'N';
	}
	const fields: Record<string, string[]> = {
		clickToCall: ['numero', 'ramal'],
		createQueueCampaign: ['descricao_campanha', 'id_fila'],
		createIvrCampaign: ['descricao_campanha', 'id_ura'],
		addCampaignContact: ['id_campanha', 'id_contato', 'numero'],
		startCampaign: ['id_campanha'],
		stopCampaign: ['id_campanha'],
		getCallRecording: ['id_chamada'],
		getCallStatus: ['id_chamada'],
	};
	for (const field of fields[operation] ?? []) qs[field] = required(this, qs[field], field);
	for (const field of ['qtd_simultanea', 'tentativas', 'prioridade']) {
		if (qs[field] !== undefined) positiveInteger(this, qs[field], field);
	}
	for (const field of ['dia_semana_ini', 'dia_semana_fim']) {
		if (
			qs[field] !== undefined &&
			(!Number.isInteger(Number(qs[field])) || Number(qs[field]) < 1 || Number(qs[field]) > 7)
		)
			fail(this, `${field} must be between 1 and 7`);
	}
	for (const field of ['hora_ini', 'hora_fim']) {
		if (qs[field] !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(String(qs[field])))
			fail(this, `${field} must use HH:mm:ss`);
	}
	if (qs.data_hora !== undefined && qs.data_hora !== '') {
		const value = String(qs.data_hora);
		if (!/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value))
			fail(this, 'Scheduled Time must use YYYY-MM-DD HH:mm:ss in the PBX time zone');
		dateOnly(this, value.slice(0, 10), 'Scheduled Time');
	}
	return { ...request, qs };
}

export async function uploadContacts(
	this: IExecuteSingleFunctions,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const campaign = required(this, this.getNodeParameter('campaignId'), 'Campaign');
	const priority = this.getNodeParameter('priority', 1);
	positiveInteger(this, priority, 'Priority');
	const property = required(
		this,
		this.getNodeParameter('inputBinaryProperty', 'data'),
		'Input Binary Field',
	);
	const metadata = this.helpers.assertBinaryData(property);
	const data = await this.helpers.getBinaryDataBuffer(property);
	if (!data.length) fail(this, 'The contacts file is empty');
	const multipart = multipartRequest(
		{ acao: 'upload_arquivo_contato', id_campanha: campaign, prioridade: String(priority) },
		{
			data,
			name: metadata.fileName || 'contacts.csv',
			mimeType: metadata.mimeType || 'application/octet-stream',
		},
	);
	return {
		...request,
		...multipart,
		headers: { Accept: 'application/json, text/plain, */*', ...multipart.headers },
	};
}

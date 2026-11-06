import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { CLICK_TO_CALL_URL, VOICE_URL } from '../shared/transport/Constants';
import { uploadContacts, validateVoiceRequest } from '../shared/transport/RequestHooks';
import { normalizeResponse, recordingResponse } from '../shared/transport/Response';
import { collection, listField, textField } from '../shared/fields';

function operation(
	name: string,
	value: string,
	action: string,
	apiAction?: string,
): INodePropertyOptions {
	return {
		name,
		value,
		action,
		routing: {
			request: {
				method: value === 'addCampaignContacts' ? 'POST' : 'GET',
				url: value === 'clickToCall' ? CLICK_TO_CALL_URL : VOICE_URL,
				// Wrong credentials are answered with a redirect: let the response hooks explain it.
				ignoreHttpStatusErrors: true,
				...(apiAction ? { qs: { acao: apiAction } } : {}),
				...(value === 'getCallRecording' ? { encoding: 'arraybuffer' as const, json: false } : {}),
			},
			send: { preSend: [value === 'addCampaignContacts' ? uploadContacts : validateVoiceRequest] },
			output: {
				postReceive: [value === 'getCallRecording' ? recordingResponse : normalizeResponse],
			},
		},
	};
}
function show(operations: string[]) {
	return { show: { operation: operations } };
}
const creating = ['createQueueCampaign', 'createIvrCampaign'];
const usingCampaign = ['addCampaignContact', 'startCampaign', 'stopCampaign'];

export const voiceProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			operation(
				'Add Contact to Campaign',
				'addCampaignContact',
				'Add a contact to a campaign',
				'chamada',
			),
			operation(
				'Add Contacts File to Campaign',
				'addCampaignContacts',
				'Add a contacts file to a campaign',
			),
			operation('Click to Call', 'clickToCall', 'Initiate a click to call'),
			operation(
				'Create IVR Campaign',
				'createIvrCampaign',
				'Create an IVR or voicebot campaign',
				'criar_campanha_ura_reversa',
			),
			operation(
				'Create Queue Campaign',
				'createQueueCampaign',
				'Create a human queue campaign',
				'cria_campanha',
			),
			operation('Get Call Recording', 'getCallRecording', 'Get a call recording', 'pega_gravacao'),
			operation('Get Call Status', 'getCallStatus', 'Get the status of a call', 'status_chamada'),
			operation('Start Campaign', 'startCampaign', 'Start a campaign', 'play_campanha'),
			operation('Stop Campaign', 'stopCampaign', 'Stop a campaign', 'stop_campanha'),
		],
		default: 'getCallStatus',
	},
	{
		...textField('Phone Number', 'number', 'numero', 'query'),
		required: true,
		displayOptions: show(['clickToCall', 'addCampaignContact']),
		description: 'Destination number in the format accepted by your Sonax PBX',
	},
	{
		...textField('Extension', 'extension', 'ramal', 'query'),
		required: true,
		displayOptions: show(['clickToCall']),
	},
	{
		...textField('Campaign Name', 'campaignName', 'descricao_campanha', 'query'),
		required: true,
		displayOptions: show(creating),
	},
	{
		...listField('Queue Name or ID', 'queueId', 'getVoiceQueues', 'id_fila', 'query'),
		required: true,
		displayOptions: show(['createQueueCampaign']),
	},
	{
		...listField('IVR Name or ID', 'ivrId', 'getVoiceIvrs', 'id_ura', 'query'),
		required: true,
		displayOptions: show(['createIvrCampaign']),
		hint: 'Loading this list needs the optional Voice V2 Password in your credential. Without it, switch to Expression and type the IVR ID shown in your Sonax PBX panel.',
	},
	{
		...listField('Campaign Name or ID', 'campaignId', 'getVoiceCampaigns', 'id_campanha', 'query'),
		required: true,
		displayOptions: show(usingCampaign),
	},
	{
		...listField('Campaign Name or ID', 'campaignId', 'getVoiceCampaigns'),
		required: true,
		displayOptions: show(['addCampaignContacts']),
	},
	{
		...textField('Contact ID', 'contactId', 'id_contato', 'query'),
		required: true,
		displayOptions: show(['addCampaignContact']),
		description: 'Your contact reference, such as a customer code or CPF',
	},
	{
		...textField('Call ID', 'callId', 'id_chamada', 'query'),
		required: true,
		displayOptions: show(['getCallRecording', 'getCallStatus']),
	},
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'number',
		default: 1,
		typeOptions: { minValue: 1, numberPrecision: 0 },
		displayOptions: show(['addCampaignContact']),
		routing: { send: { type: 'query', property: 'prioridade' } },
	},
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'number',
		default: 1,
		typeOptions: { minValue: 1, numberPrecision: 0 },
		displayOptions: show(['addCampaignContacts']),
	},
	{
		displayName: 'Input Binary Field',
		name: 'inputBinaryProperty',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: show(['addCampaignContacts']),
		description:
			'Name of the input binary field containing a contacts file accepted by Sonax. The file is uploaded without changing its contents.',
	},
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryProperty',
		type: 'string',
		default: 'data',
		displayOptions: show(['getCallRecording']),
		description:
			'Binary field for audio returned by Sonax. URL or JSON responses are returned as JSON.',
	},
	collection(
		'Campaign Options',
		'campaignOptions',
		[
			{
				displayName: 'Auto Complete',
				name: 'autoComplete',
				type: 'boolean',
				default: false,
				description: 'Whether to complete the campaign automatically',
				routing: {
					send: { type: 'query', property: 'auto_concluir', value: '={{$value ? "S" : "N"}}' },
				},
			},
			{
				displayName: 'Concurrent Calls',
				name: 'concurrentCalls',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1, numberPrecision: 0 },
				routing: { send: { type: 'query', property: 'qtd_simultanea' } },
			},
			{
				displayName: 'Discard Voicemail',
				name: 'discardVoicemail',
				type: 'boolean',
				default: false,
				description: 'Whether to discard calls answered by voicemail',
				routing: {
					send: {
						type: 'query',
						property: 'descarte_caixa_postal',
						value: '={{$value ? "S" : "N"}}',
					},
				},
			},
			{
				...textField('End Time', 'endTime', 'hora_fim', 'query'),
				default: '18:00:00',
				description: 'Time in HH:mm:ss in the PBX time zone',
			},
			{
				displayName: 'End Weekday',
				name: 'endWeekday',
				type: 'number',
				default: 6,
				typeOptions: { minValue: 1, maxValue: 7, numberPrecision: 0 },
				description: 'Weekday number according to your Sonax PBX configuration',
				routing: { send: { type: 'query', property: 'dia_semana_fim' } },
			},
			listField(
				'Negative Outcome Campaign Name or ID',
				'negativeCampaignId',
				'getVoiceCampaigns',
				'id_campanha_tabulacoes_negativas',
				'query',
			),
			{
				...textField('Negative Outcomes', 'negativeOutcomes', 'tabulacoes_negativas', 'query'),
				description: 'Comma-separated disposition names',
			},
			listField(
				'Pause Campaign Name or ID',
				'pauseCampaignId',
				'getVoiceCampaigns',
				'id_campanha_pausas',
				'query',
			),
			{
				...textField('Pauses', 'pauses', 'pausas', 'query'),
				description: 'Comma-separated pause names',
			},
			listField(
				'Positive Outcome Campaign Name or ID',
				'positiveCampaignId',
				'getVoiceCampaigns',
				'id_campanha_tabulacoes_positivas',
				'query',
			),
			{
				...textField('Positive Outcomes', 'positiveOutcomes', 'tabulacoes_positivas', 'query'),
				description: 'Comma-separated disposition names',
			},
			{
				...textField('Start Time', 'startTime', 'hora_ini', 'query'),
				default: '08:00:00',
				description: 'Time in HH:mm:ss in the PBX time zone',
			},
			{
				displayName: 'Start Weekday',
				name: 'startWeekday',
				type: 'number',
				default: 2,
				typeOptions: { minValue: 1, maxValue: 7, numberPrecision: 0 },
				description: 'Weekday number according to your Sonax PBX configuration',
				routing: { send: { type: 'query', property: 'dia_semana_ini' } },
			},
		],
		creating,
	),
	collection(
		'Queue Options',
		'queueOptions',
		[
			{
				displayName: 'Attempts',
				name: 'attempts',
				type: 'number',
				default: 3,
				typeOptions: { minValue: 1, numberPrecision: 0 },
				routing: { send: { type: 'query', property: 'tentativas' } },
			},
		],
		['createQueueCampaign'],
	),
	collection(
		'Contact Options',
		'voiceContactOptions',
		[
			{
				...textField('Scheduled Time', 'scheduledAt', 'data_hora', 'query'),
				placeholder: '2026-12-01 09:00:00',
				description: 'YYYY-MM-DD HH:mm:ss in the PBX time zone',
			},
			{ ...textField('Script', 'script', 'script', 'query'), typeOptions: { rows: 4 } },
		],
		['addCampaignContact'],
	),
];

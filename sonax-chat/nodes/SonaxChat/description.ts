import type { INodeProperties } from 'n8n-workflow';
import {
	prepareOfficialMessage,
	prepareTask,
	validateContact,
	validateMessageId,
} from '../shared/transport/RequestHooks';
import { normalizeResponse } from '../shared/transport/Response';
import { collection, listField, repeatedText, textField } from '../shared/fields';

function show(operations: string[]) {
	return { show: { operation: operations } };
}
const send = ['sendOfficialMessage'];
const contact = ['createContact'];
const task = ['createTask'];

export const chatProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getMessage',
		options: [
			{
				name: 'Create Contact',
				value: 'createContact',
				action: 'Create a contact',
				routing: {
					request: {
						method: 'POST',
						url: 'https://api-chat.sonax.net.br/v2/task-api/create-contact',
					},
					send: { preSend: [validateContact] },
					output: { postReceive: [normalizeResponse] },
				},
			},
			{
				name: 'Create Kanban Task',
				value: 'createTask',
				action: 'Create a kanban task',
				routing: {
					request: { method: 'POST', url: 'https://api-chat.sonax.net.br/v2/task-api/create-task' },
					send: { preSend: [prepareTask] },
					output: { postReceive: [normalizeResponse] },
				},
			},
			{
				name: 'Get Message',
				value: 'getMessage',
				action: 'Get a sent message',
				routing: {
					request: {
						method: 'GET',
						url: '=https://api-chat.sonax.net.br/v2/message-data/{{encodeURIComponent($parameter.messageId)}}',
					},
					send: { preSend: [validateMessageId] },
					output: { postReceive: [normalizeResponse] },
				},
			},
			{
				name: 'Send Official Message',
				value: 'sendOfficialMessage',
				action: 'Send a message through an official channel',
				routing: {
					request: {
						method: 'POST',
						url: 'https://api-chat.sonax.net.br/v2/send-message-protocol',
					},
					send: { preSend: [prepareOfficialMessage] },
					output: { postReceive: [normalizeResponse] },
				},
			},
		],
	},
	{
		...listField('Channel Name or Number', 'from', 'getOfficialChannels', 'from'),
		required: true,
		displayOptions: show(send),
		description:
			'Choose an official channel from the list, or specify its phone number using an expression',
	},
	{
		...listField('Template Name', 'templateName', 'getTemplates', 'message'),
		typeOptions: { loadOptionsMethod: 'getTemplates', loadOptionsDependsOn: ['from'] },
		required: true,
		displayOptions: show(send),
		description:
			'Choose an approved template from the list, or specify its name using an expression',
	},
	{
		...textField('Recipient Phone', 'to', 'to'),
		required: true,
		displayOptions: show(send),
		description: 'Destination phone number, including country and area code',
	},
	{
		...repeatedText('Template Parameters', 'templateParameters', 'value', 'Value'),
		displayOptions: show(send),
		description:
			'Values in template order. Sonax expects a comma-separated string; values containing commas are not supported by its documented format.',
	},
	collection(
		'Contact Data',
		'clientData',
		[
			textField('CPF', 'cpf'),
			{ ...textField('Email', 'email'), placeholder: 'name@example.com' },
			textField('Name', 'name'),
			textField('Tag', 'tag'),
		],
		send,
	),
	{ ...repeatedText('Protocol Tags', 'protocolTags', 'tag', 'Tag'), displayOptions: show(send) },
	collection(
		'Message Options',
		'messageOptions',
		[
			listField('Attendant Name or ID', 'attendant', 'getChatUsers', 'attendant'),
			listField('Bot Name or ID', 'customBotCode', 'getBots', 'customBotCode'),
		],
		send,
	),
	{ ...textField('Message ID', 'messageId'), required: true, displayOptions: show(['getMessage']) },
	{ ...textField('Name', 'contactName', 'nome'), required: true, displayOptions: show(contact) },
	{
		...textField('Mobile Phone', 'mobilePhone', 'celular'),
		required: true,
		displayOptions: show(contact),
	},
	collection(
		'Contact Options',
		'chatContactOptions',
		[
			textField('CPF', 'cpf', 'cpf'),
			textField('Customer ID', 'customerId', 'cliente'),
			{ ...textField('Email', 'email', 'email'), placeholder: 'name@example.com' },
			{ ...textField('Notes', 'notes', 'observacao'), typeOptions: { rows: 4 } },
			listField('Owner Name or ID', 'ownerId', 'getChatUsers', 'carteirizacao'),
			textField('Tag', 'tag', 'tag'),
		],
		contact,
	),
	{
		...textField('Board Name', 'boardName', 'quadro'),
		required: true,
		displayOptions: show(task),
		description: 'Exact Kanban board name. The documented API accepts a name.',
	},
	{
		...textField('Column Name', 'columnName', 'lista'),
		required: true,
		displayOptions: show(task),
		description: 'Exact column name within the board',
	},
	{ ...textField('Title', 'title', 'titulo'), required: true, displayOptions: show(task) },
	{
		...listField('Assignee Name or Email', 'assignee', 'getChatUserEmails', 'responsavel'),
		required: true,
		displayOptions: show(task),
		description: 'Choose a user from the list, or specify an email using an expression',
	},
	{
		...listField('Participant Names or Emails', 'participants', 'getChatUserEmails'),
		type: 'multiOptions',
		default: [],
		required: true,
		displayOptions: show(task),
		description: 'Choose users from the list, or specify their emails using an expression',
	},
	{
		...repeatedText('Tags', 'taskTags', 'tag', 'Tag'),
		required: true,
		displayOptions: show(task),
		description: 'At least one tag is required by the documented task endpoint',
	},
	{
		...textField('Due Date', 'dueDate', 'prazo'),
		required: true,
		displayOptions: show(task),
		placeholder: '2026-12-01',
		description: 'Calendar date in YYYY-MM-DD format',
	},
	collection(
		'Task Options',
		'taskOptions',
		[
			textField('Contact ID', 'contactId', 'contato'),
			{
				...listField('Creator Name or Email', 'creator', 'getChatUserEmails', 'criador'),
				description: 'Choose a user from the list, or specify an email using an expression',
			},
			textField('Customer ID', 'customerId', 'cliente'),
			{ ...textField('Description', 'description', 'descricao'), typeOptions: { rows: 4 } },
			{
				...textField('Priority', 'priority', 'prioridade'),
				description: 'Priority value accepted by your Sonax tenant',
			},
		],
		task,
	),
];

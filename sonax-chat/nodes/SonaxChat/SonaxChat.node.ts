import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { chatProperties } from './description';
import { loadOptions } from '../shared/methods/LoadOptions';
import { CHAT_BASE_URL } from '../shared/transport/Constants';

export class SonaxChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sonax Chat',
		name: 'sonaxChat',
		icon: { light: 'file:../shared/sonax.svg', dark: 'file:../shared/sonax.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Manage Sonax Chat messages, contacts, and Kanban tasks',
		defaults: { name: 'Sonax Chat' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sonaxChatApi', required: true }],
		requestDefaults: {
			baseURL: CHAT_BASE_URL,
			headers: { Accept: 'application/json, text/plain, */*' },
			timeout: 120000,
			disableFollowRedirect: true,
		},
		properties: chatProperties,
	};
	methods = {
		loadOptions: {
			getOfficialChannels: loadOptions.getOfficialChannels,
			getTemplates: loadOptions.getTemplates,
			getChatUsers: loadOptions.getChatUsers,
			getChatUserEmails: loadOptions.getChatUserEmails,
			getBots: loadOptions.getBots,
		},
	};
}

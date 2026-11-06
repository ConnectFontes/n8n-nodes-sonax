import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { voiceProperties } from './description';
import { loadOptions } from '../shared/methods/LoadOptions';
import { VOICE_URL } from '../shared/transport/Constants';

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- O upload de contatos e a gravação usam dados binários do fluxo.
export class SonaxVoip implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sonax VoIP',
		name: 'sonaxVoip',
		icon: { light: 'file:../shared/sonax.svg', dark: 'file:../shared/sonax.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Manage Sonax VoIP calls, dialer campaigns, contacts, and recordings',
		defaults: { name: 'Sonax VoIP' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sonaxVoiceApi', required: true }],
		requestDefaults: {
			baseURL: VOICE_URL,
			headers: { Accept: 'application/json, text/plain, */*' },
			timeout: 120000,
			disableFollowRedirect: true,
		},
		properties: voiceProperties,
	};
	methods = {
		loadOptions: {
			getVoiceQueues: loadOptions.getVoiceQueues,
			getVoiceCampaigns: loadOptions.getVoiceCampaigns,
			getVoiceIvrs: loadOptions.getVoiceIvrs,
		},
	};
}

import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { CLICK_TO_CALL_URL, VOICE_URL } from '../nodes/shared/transport/Constants';
import { authenticateMultipart } from '../nodes/shared/transport/Multipart';

export class SonaxVoiceApi implements ICredentialType {
	name = 'sonaxVoiceApi';
	displayName = 'Sonax VoIP API';
	documentationUrl = 'https://documenter.getpostman.com/view/39712701/2sB34eH2J9';
	icon = {
		light: 'file:../nodes/shared/sonax.svg',
		dark: 'file:../nodes/shared/sonax.dark.svg',
	} as const;
	properties: INodeProperties[] = [
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'Provided by Sonax when your PBX was activated',
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Voice API token provided by Sonax together with your Client ID',
		},
		{
			displayName: 'Voice V2 Password',
			name: 'v2Password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Optional. Only needed to pick IVRs from a list. Without it, type the IVR ID instead (switch the field to Expression)',
		},
		{
			// Sonax answers a wrong Client ID or token with a redirect (HTTP 302), which n8n reports as
			// "status code 302" (n8n 2.23) or "Found" (n8n 2.46).
			displayName:
				'If the connection test fails with "status code 302" or "Found", check the Client ID and the API Token.',
			name: 'connectionNotice',
			type: 'notice',
			default: '',
		},
	];
	test: ICredentialTestRequest = {
		request: {
			method: 'GET',
			url: VOICE_URL,
			qs: { acao: 'lista_filas' },
			disableFollowRedirect: true,
		},
	};

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		request: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const url = new URL(request.url, request.baseURL);
		const target = `${url.origin}${url.pathname}`;
		if (url.username || url.password || ![VOICE_URL, CLICK_TO_CALL_URL].includes(target)) {
			throw new Error(
				'Sonax Voice credentials can only be sent to the documented Sonax Voice endpoints',
			);
		}
		const clientId = String(credentials.clientId ?? '').trim();
		const token = String(credentials.apiToken ?? '').trim();
		if (!clientId || !token) throw new Error('Client ID and API Token are required');
		const options = { ...request, disableFollowRedirect: true };
		if (target === VOICE_URL && request.method === 'POST') {
			return authenticateMultipart(options, { id_cliente: clientId, token });
		}
		return {
			...options,
			qs: { ...request.qs, ...(target === VOICE_URL ? { id_cliente: clientId } : {}), token },
		};
	}
}

import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { CHAT_BASE_URL } from '../nodes/shared/transport/Constants';

export class SonaxChatApi implements ICredentialType {
	name = 'sonaxChatApi';
	displayName = 'Sonax Chat API';
	documentationUrl = 'https://documenter.getpostman.com/view/39712701/2sAY55ZHTG';
	icon = {
		light: 'file:../nodes/shared/sonax.svg',
		dark: 'file:../nodes/shared/sonax.dark.svg',
	} as const;
	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Chat API token provided by Sonax',
		},
	];
	test: ICredentialTestRequest = {
		request: { method: 'GET', url: `${CHAT_BASE_URL}/external/users`, disableFollowRedirect: true },
	};

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		request: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const url = new URL(request.url, request.baseURL);
		if (
			url.origin !== 'https://api-chat.sonax.net.br' ||
			!url.pathname.startsWith('/v2/') ||
			url.username ||
			url.password
		) {
			throw new Error('Sonax Chat credentials can only be sent to the documented Sonax Chat API');
		}
		const token = String(credentials.apiToken ?? '').trim();
		if (!token) throw new Error('API Token is required');
		return {
			...request,
			disableFollowRedirect: true,
			headers: { ...request.headers, Authorization: `Bearer ${token}` },
			// This endpoint explicitly documents authorization in the query as well.
			...(url.pathname.startsWith('/v2/message-data/')
				? { qs: { ...request.qs, authorization: token } }
				: {}),
		};
	}
}

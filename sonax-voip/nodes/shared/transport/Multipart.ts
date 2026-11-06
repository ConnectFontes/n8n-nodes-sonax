import { randomBytes } from 'crypto';
import type { IHttpRequestOptions } from 'n8n-workflow';

function fieldPart(boundary: string, name: string, value: string): Buffer {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid multipart field name');
	return Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
	);
}

export function multipartRequest(
	fields: Record<string, string>,
	file?: { data: Buffer; name: string; mimeType: string },
): Pick<IHttpRequestOptions, 'body' | 'headers' | 'json'> {
	const boundary = `sonax-${randomBytes(24).toString('hex')}`;
	const parts = Object.entries(fields).map(([name, value]) => fieldPart(boundary, name, value));
	if (file) {
		const name =
			file.name
				.split(/[\\/]/)
				.pop()
				?.replace(/[\r\n"]/g, '_')
				.split('\0')
				.join('_') || 'contacts.csv';
		const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType)
			? file.mimeType
			: 'application/octet-stream';
		parts.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${name}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
			),
			file.data,
			Buffer.from('\r\n'),
		);
	}
	parts.push(Buffer.from(`--${boundary}--\r\n`));
	return {
		body: Buffer.concat(parts),
		headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
		json: false,
	};
}

// The modern n8n HTTP helper accepts a Buffer as body. Authentication fields
// are prepended here instead of using the legacy, unsupported formData option.
export function authenticateMultipart(
	request: IHttpRequestOptions,
	fields: Record<string, string>,
): IHttpRequestOptions {
	const contentType = String(
		request.headers?.['Content-Type'] ?? request.headers?.['content-type'] ?? '',
	);
	const match = /^multipart\/form-data; boundary=(sonax-[a-f0-9]{48})$/.exec(contentType);
	if (!match || !Buffer.isBuffer(request.body)) throw new Error('Invalid Sonax multipart request');
	const prefix = Object.entries(fields).map(([name, value]) => fieldPart(match[1], name, value));
	return { ...request, body: Buffer.concat([...prefix, request.body]) };
}

import type { INodeProperties } from 'n8n-workflow';

/** Shared field shapes keep the documented API parameter names explicit at each call site. */
export function textField(
	displayName: string,
	name: string,
	apiName?: string,
	target: 'body' | 'query' = 'body',
): INodeProperties {
	return {
		displayName,
		name,
		type: 'string',
		default: '',
		...(apiName ? { routing: { send: { type: target, property: apiName } } } : {}),
	};
}

export function listField(
	displayName: string,
	name: string,
	method: string,
	apiName?: string,
	target: 'body' | 'query' = 'body',
): INodeProperties {
	return {
		...textField(displayName, name, apiName, target),
		type: 'options',
		typeOptions: { loadOptionsMethod: method },
		description: 'Choose from the list, or specify a value using an expression',
	};
}

export function collection(
	displayName: string,
	name: string,
	options: INodeProperties[],
	operations: string[],
): INodeProperties {
	return {
		displayName,
		name,
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options,
		displayOptions: { show: { operation: operations } },
	};
}

export function repeatedText(
	displayName: string,
	name: string,
	fieldName: string,
	fieldLabel: string,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'fixedCollection',
		default: {},
		placeholder: 'Add Value',
		typeOptions: { multipleValues: true },
		options: [
			{ displayName: 'Values', name: 'values', values: [textField(fieldLabel, fieldName)] },
		],
	};
}

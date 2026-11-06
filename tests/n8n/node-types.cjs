'use strict';
function nodeTypeFor(resource, nodePrefix = 'CUSTOM') {
 if (!['voice', 'chat'].includes(resource)) throw new Error('Unknown Sonax product: ' + resource);
 if (!['CUSTOM', 'community'].includes(nodePrefix)) throw new Error('Use --node-prefix CUSTOM or community');
 const name = resource === 'voice' ? 'sonaxVoip' : 'sonaxChat';
 const prefix = nodePrefix === 'CUSTOM' ? 'CUSTOM' : 'n8n-nodes-sonax-' + (resource === 'voice' ? 'voip' : 'chat');
 return prefix + '.' + name;
}
module.exports = { nodeTypeFor };

# Changelog

## 0.1.1

- Set `usableAsTool: true` on the node description so the node is explicitly tool-usable by AI agents,
  as required by the n8n Creator Portal's automated review. A previous `eslint-disable` comment satisfied
  local linting but not the portal's scanner, which ignores inline disable comments.

## 0.1.0 - Unreleased

- First independent package for Sonax VoIP, extracted from the combined n8n-nodes-sonax development project.
- Includes only its 9 operations and its own credential.
- Preserves saved credential identifiers and existing endpoint behavior.

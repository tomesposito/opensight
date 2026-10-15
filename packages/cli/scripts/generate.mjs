import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

export const specUrl = new URL('../../../docs/api/openapi-v1.yaml', import.meta.url);
const nouns = { analyses: 'analysis', datasets: 'dataset', dashboards: 'dashboard', sources: 'source', assets: 'asset', folders: 'folder' };
const headers = { Limit: 'limit', Cursor: 'cursor', 'Idempotency-Key': 'idempotencyKey', 'If-Match': 'ifMatch' };

export function inventory(spec) {
  function resolve(value, ancestors = []) {
    if (Array.isArray(value)) return value.map(v => resolve(v, ancestors));
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) {
      if (!value.$ref.startsWith('#/') || ancestors.includes(value.$ref)) throw Error('Unsupported OpenAPI reference');
      const target = value.$ref.slice(2).split('/').reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
      if (!target) throw Error('Unresolved OpenAPI reference');
      const { $ref, ...siblings } = value;
      return resolve({ ...target, ...siblings }, [...ancestors, $ref]);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, ancestors)]));
  }
  const ids = new Set(), commands = new Set(), operations = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method)) continue;
      const operationId = op.operationId;
      if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(operationId ?? '') || ids.has(operationId)) throw Error('Missing, duplicate or non-snake-case operationId');
      ids.add(operationId);
      const root = path.split('/')[1];
      const words = operationId.split('_');
      // REST resource first; the spec's publish tag and explicit asset-share vocabulary
      // place these operations under their D-71 nouns without creating aliases/routes.
      const noun = operationId === 'publish_analysis' ? nouns[op.tags?.[0]]
        : words.includes('asset') ? 'asset' : nouns[root];
      if (!noun) throw Error('Unsupported resource noun');
      const aliases = new Set([root, noun]);
      if (operationId === 'publish_analysis') aliases.add('analysis');
      let verb = words.filter(word => !aliases.has(word));
      if (operationId === 'run_dataset_query') verb = ['query'];
      const command = verb.join('-'), key = `${noun} ${command}`;
      if (!command || commands.has(key)) throw Error('Duplicate or empty CLI command');
      commands.add(key);
      const args = [], merged = new Map();
      for (const raw of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const p = resolve(raw); merged.set(`${p.in}:${p.name}`, p);
      }
      for (const p of merged.values()) {
        const name = p.in === 'path' ? p.name : headers[p.name];
        if (!name || !['path', 'header'].includes(p.in) || ['help', 'format', 'body', 'query'].includes(name) || args.some(a => a.name === name)) throw Error('Unsupported or colliding parameter');
        args.push({ name, wireName: p.name, location: p.in, required: !!p.required,
          positional: p.in === 'path' && name === 'id', schema: p.schema });
      }
      let body;
      if (op.requestBody) {
        const request = resolve(op.requestBody), schema = request.content?.['application/json']?.schema;
        if (!schema) throw Error('Unsupported request media type');
        body = { input: operationId === 'run_dataset_query' ? 'query' : 'body', required: !!request.required, schema };
        for (const [name, shape] of Object.entries(schema.properties ?? {})) {
          // A conflicting property remains available inside the complete JSON body.
          if (['help', 'format', body.input].includes(name) || args.some(a => a.name === name)) continue;
          args.push({ name, wireName: name, location: 'body', required: (schema.required ?? []).includes(name), positional: false, schema: shape });
        }
      }
      operations.push({ operationId, noun, command, method: method.toUpperCase(), path, arguments: args, ...(body ? { body } : {}) });
    }
  }
  return operations.sort((a, b) => `${a.noun} ${a.command}`.localeCompare(`${b.noun} ${b.command}`));
}
export function source(spec) {
  return `// Generated from docs/api/openapi-v1.yaml. Do not edit.\nimport type { Operation } from './types.js';\nexport const apiVersion = ${JSON.stringify(spec.info.version)};\nexport const operations: Operation[] = [\n${inventory(spec).map(op => `  ${JSON.stringify(op)}`).join(',\n')}\n];\n`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(new URL('../src/generated.ts', import.meta.url), source(load(readFileSync(specUrl, 'utf8'))));

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load as parse } from 'js-yaml';

export const specUrl = new URL('../../../docs/api/openapi-v1.yaml', import.meta.url);
export function inventory(spec) {
  const headerNames = { Limit: 'limit', Cursor: 'cursor', 'Idempotency-Key': 'idempotencyKey', 'If-Match': 'ifMatch' };
  function resolve(value, ancestors = []) {
    if (Array.isArray(value)) return value.map(v => resolve(v, ancestors));
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) {
      if (!value.$ref.startsWith('#/') || ancestors.includes(value.$ref)) throw new Error('Unsupported OpenAPI reference');
      const target = value.$ref.slice(2).split('/').reduce((v, key) => v?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
      if (!target) throw new Error('Unresolved OpenAPI reference');
      const { $ref, ...siblings } = value;
      return resolve({ ...target, ...siblings }, [...ancestors, $ref]);
    }
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, resolve(v, ancestors)]));
  }
  const names = new Set(), operations = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [verb, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(verb)) continue;
      const name = op.operationId;
      if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name ?? '') || names.has(name)) throw new Error('Missing, duplicate or non-snake-case operationId');
      names.add(name);
      const properties = {}, required = [], parameters = [];
      const merged = new Map();
      for (const raw of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const p = resolve(raw); merged.set(`${p.in}:${p.name}`, p);
      }
      for (const p of merged.values()) {
        const input = p.in === 'path' ? p.name : headerNames[p.name];
        if (!input || !['path', 'header'].includes(p.in) || Object.hasOwn(properties, input)) throw new Error('Unsupported or colliding parameter');
        properties[input] = { ...p.schema, description: `${p.in === 'header' ? `HTTP ${p.name} header. ` : ''}${p.description ?? p.schema.description ?? ''}`.trim() };
        if (p.required) required.push(input);
        parameters.push({ input, name: p.name, location: p.in });
      }
      let bodyInput, emptyBody = false;
      if (op.requestBody) {
        const body = resolve(op.requestBody), schema = body.content?.['application/json']?.schema;
        if (!schema) throw new Error('Unsupported request media type');
        emptyBody = schema.type === 'object' && schema.maxProperties === 0;
        if (!emptyBody) {
          bodyInput = name === 'run_dataset_query' ? 'query' : 'body';
          if (Object.hasOwn(properties, bodyInput)) throw new Error('Body parameter collision');
          properties[bodyInput] = schema;
          if (body.required) required.push(bodyInput);
        }
      }
      operations.push({ name, method: verb.toUpperCase(), path, parameters,
        ...(bodyInput ? { bodyInput } : {}), emptyBody,
        tool: { name, description: `${verb.toUpperCase()} /api/v1${path} — ${op.summary ?? name}.${op.description ? ` ${op.description}` : ''}`,
          inputSchema: { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) } } });
    }
  }
  return operations.sort((a, b) => a.name.localeCompare(b.name));
}
export function generate() {
  const spec = parse(readFileSync(specUrl, 'utf8'));
  const output = `// Generated from docs/api/openapi-v1.yaml. Do not edit.\nimport type { Operation } from './types.js';\nexport const apiVersion = ${JSON.stringify(spec.info.version)};\nexport const operations: Operation[] = ${JSON.stringify(inventory(spec), null, 2)};\n`;
  writeFileSync(new URL('../src/generated.ts', import.meta.url), output);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) generate();

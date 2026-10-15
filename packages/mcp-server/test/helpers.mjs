import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/index.js';
import { randomBytes } from 'node:crypto';
export function credentials(token = randomBytes(32).toString('hex')) {
  return { token, accessToken: async () => token, containsSecret: text => text.includes(token), invalidate() {} };
}
export async function connect(t, options = {}) {
  const server = createMcpServer({ baseUrl: 'https://opensight.example/api/v1', credentials: credentials(), ...options });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
export const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
export const call = (client, name, args = {}) => client.callTool({ name, arguments: args });

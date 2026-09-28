import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AutomationStore } from './automation-store.js';
import { method, send } from './automation-routes.js';
import { record, invalid, id } from './schedule.js';
import { readBody, RequestError } from './query.js';
import type { Identity, SecurityService } from './security.js';
import { AIError, PROVIDERS, providerAdapters, type AIProvider, type ProviderConfig, type Completion } from './ai-providers.js';

interface SavedConfig extends ProviderConfig { namespaceId: string; encryptedKey?: string }
interface State { version: 1; configs: SavedConfig[] }
export interface AIOptions {
  storePath?: string;
  /** 32 bytes, base64; environment/secret-manager only. Never persisted with ciphertext. */
  encryptionKey?: string;
  /** Trusted deployment allowlist; request bodies cannot choose arbitrary network destinations. */
  compatibleBaseUrls?: readonly string[];
  /** Optional default-namespace bootstrap; environment keys are never serialized. */
  bootstrap?: ProviderConfig & { key?: string };
  fetcher?: typeof fetch;
}
export function aiFromEnvironment(env: NodeJS.ProcessEnv = process.env): AIOptions {
  const provider = env.OPENSIGHT_AI_PROVIDER;
  return { storePath: env.OPENSIGHT_AI_STORE, encryptionKey: env.OPENSIGHT_AI_ENCRYPTION_KEY,
    compatibleBaseUrls: env.OPENSIGHT_AI_COMPATIBLE_URL ? [env.OPENSIGHT_AI_COMPATIBLE_URL] : [],
    ...(provider ? { bootstrap: { provider: provider as AIProvider, model: env.OPENSIGHT_AI_MODEL ?? '', key: env.OPENSIGHT_AI_API_KEY, ...(provider === 'openai-compatible' ? { baseUrl: env.OPENSIGHT_AI_COMPATIBLE_URL } : {}) } } : {}) };
}
function endpoint(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) invalid('$.baseUrl', 'expected a configured HTTPS endpoint');
  let url: URL; try { url = new URL(raw); } catch { return invalid('$.baseUrl', 'expected a configured HTTPS endpoint'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /(^|\.)(amazonaws\.com(?:\.cn)?|api\.aws|aws\.amazon\.com)$/.test(url.hostname)) invalid('$.baseUrl', 'expected a non-AWS HTTPS endpoint without credentials or query');
  return url.href.replace(/\/+$/, '');
}
function config(raw: unknown, allowed: readonly string[]): ProviderConfig {
  const value = record(raw, ['provider', 'model', 'baseUrl']);
  if (!(PROVIDERS as readonly unknown[]).includes(value.provider)) invalid('$.provider', 'unsupported provider');
  if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 256 || /[\x00-\x1f]/.test(value.model)) invalid('$.model', 'expected a model ID');
  if (value.provider !== 'openai-compatible' && value.baseUrl !== undefined) invalid('$.baseUrl', 'only compatible providers accept a base URL');
  const baseUrl = value.provider === 'openai-compatible' ? endpoint(value.baseUrl) : undefined;
  if (baseUrl && !allowed.includes(baseUrl)) invalid('$.baseUrl', 'endpoint is not allowed by server configuration');
  return { provider: value.provider as AIProvider, model: value.model.trim(), ...(baseUrl ? { baseUrl } : {}) };
}
export class AISettings {
  private readonly adapters;
  private constructor(private readonly store: AutomationStore<State>, private readonly options: AIOptions, private readonly encryptionKey: Buffer | undefined, private readonly allowed: readonly string[]) { this.adapters = providerAdapters(options.fetcher); }
  static async load(options: AIOptions): Promise<AISettings> {
    const allowed = (options.compatibleBaseUrls ?? []).map(endpoint);
    const encryptionKey = options.encryptionKey ? Buffer.from(options.encryptionKey, 'base64') : undefined;
    if (encryptionKey && (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== options.encryptionKey)) throw new Error('OPENSIGHT_AI_ENCRYPTION_KEY must be 32 bytes encoded as base64');
    const validate = (raw: unknown): State => {
      const state = record(raw, ['version', 'configs']);
      if (state.version !== 1 || !Array.isArray(state.configs) || state.configs.length > 256) invalid('$', 'invalid AI settings store');
      const configs = state.configs.map(raw => {
        const { namespaceId, encryptedKey, ...rest } = record(raw, ['namespaceId', 'provider', 'model', 'baseUrl', 'encryptedKey']);
        if (encryptedKey !== undefined && (typeof encryptedKey !== 'string' || encryptedKey.length > 16_000)) invalid('$.encryptedKey', 'invalid encrypted key');
        return { namespaceId: id(namespaceId, '$.namespaceId'), ...config(rest, allowed), ...(encryptedKey ? { encryptedKey: encryptedKey as string } : {}) };
      });
      if (new Set(configs.map(c => c.namespaceId)).size !== configs.length) invalid('$', 'duplicate namespace configuration');
      return { version: 1, configs };
    };
    const bootstrap = options.bootstrap ? config((({ key, ...rest }) => rest)(options.bootstrap), allowed) : undefined;
    const store = await AutomationStore.load<State>({ version: 1, configs: bootstrap ? [{ namespaceId: 'default', ...bootstrap }] : [] }, options.storePath, validate);
    const service = new AISettings(store, options, encryptionKey, allowed);
    for (const saved of store.read().configs) if (saved.encryptedKey) service.decrypt(saved);
    return service;
  }
  private aad(c: SavedConfig): Buffer { return Buffer.from(JSON.stringify([c.namespaceId, c.provider, c.baseUrl ?? ''])); }
  private encrypt(key: string, c: SavedConfig): string {
    if (!this.encryptionKey) throw new AIError(503, 'AI_SECURE_STORE_REQUIRED', 'Configure the server encryption key before saving provider keys');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv); cipher.setAAD(this.aad(c));
    const bytes = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), bytes].map(b => b.toString('base64')).join('.');
  }
  private decrypt(c: SavedConfig): string {
    try {
      if (!this.encryptionKey) throw new Error();
      const parts = c.encryptedKey!.split('.'); if (parts.length !== 3) throw new Error();
      const [iv, tag, bytes] = parts.map(p => Buffer.from(p, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv!); decipher.setAAD(this.aad(c)); decipher.setAuthTag(tag!);
      return Buffer.concat([decipher.update(bytes!), decipher.final()]).toString('utf8');
    } catch { throw new AIError(503, 'AI_KEY_UNAVAILABLE', 'Saved provider key cannot be decrypted'); }
  }
  private key(c: SavedConfig): string | undefined {
    if (c.encryptedKey) return this.decrypt(c);
    const b = this.options.bootstrap;
    return c.namespaceId === 'default' && b?.provider === c.provider && (b.baseUrl ? endpoint(b.baseUrl) : undefined) === c.baseUrl ? b.key : undefined;
  }
  private get(namespaceId: string): SavedConfig | undefined { return this.store.read().configs.find(c => c.namespaceId === namespaceId); }
  status(namespaceId: string) {
    const c = this.get(namespaceId), hasKey = !!c && !!this.key(c);
    return { configured: !!c && hasKey && c.provider !== 'bedrock', state: c?.provider === 'bedrock' ? 'needs-approval' : c && hasKey ? 'configured' : 'not-configured' };
  }
  summary(namespaceId: string) {
    const c = this.get(namespaceId);
    return { provider: c?.provider ?? null, model: c?.model ?? '', ...(c?.baseUrl ? { baseUrl: c.baseUrl } : {}), hasKey: !!c && !!this.key(c), ...this.status(namespaceId), keyStorage: this.options.storePath ? 'encrypted-file' : 'ephemeral', canSaveKey: !!this.encryptionKey, compatibleBaseUrls: this.allowed };
  }
  async complete(namespaceId: string, input: Completion): Promise<string> {
    const c = this.get(namespaceId);
    if (!c) throw new AIError(503, 'AI_NOT_CONFIGURED', 'AI provider is not configured');
    if (c.provider === 'bedrock') return this.adapters.bedrock.complete(c, '', input);
    const key = this.key(c);
    if (!key) throw new AIError(503, 'AI_NOT_CONFIGURED', 'Provider API key is not configured');
    const answer = await this.adapters[c.provider].complete(c, key, input);
    return answer.split(key).join('[redacted]');
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity, security: SecurityService): Promise<boolean> {
    const match = /^\/api\/admin\/ai(?:\/(key|test))?$/.exec(path);
    if (!match) return false;
    security.admin(identity);
    if (query) throw new RequestError(400, 'Query parameters are not supported');
    const action = match[1], verb = method(request, response, action ? ['POST'] : ['GET', 'POST']);
    if (verb === 'GET') { send(response, 200, this.summary(identity.namespaceId)); return true; }
    const raw = await readBody(request);
    if (action === 'test') {
      record(raw, []); security.admin(identity);
      await this.complete(identity.namespaceId, { system: 'Reply with OK only.', prompt: 'Connection test', maxTokens: 32 });
      security.admin(identity); send(response, 200, { ok: true }); return true;
    }
    const body = record(raw, action === 'key' ? ['key'] : ['provider', 'model', 'baseUrl']);
    await this.store.change(state => {
      security.admin(identity);
      let current = state.configs.find(c => c.namespaceId === identity.namespaceId);
      if (action === 'key') {
        if (!current) throw new AIError(409, 'AI_NOT_CONFIGURED', 'Save provider and model before saving a key');
        if (typeof body.key !== 'string' || body.key.length < 1 || body.key.length > 4096 || /[\x00-\x20]/.test(body.key)) invalid('$.key', 'expected a nonempty API key without whitespace');
        if (current.provider === 'bedrock') throw new AIError(409, 'AI_BEDROCK_APPROVAL_REQUIRED', 'Bedrock needs explicit approval');
        current.encryptedKey = this.encrypt(body.key, current);
      } else {
        const next = config(body, this.allowed);
        if (current) {
          if (current.provider !== next.provider || current.baseUrl !== next.baseUrl) delete current.encryptedKey;
          delete current.baseUrl; Object.assign(current, next);
        } else { current = { namespaceId: identity.namespaceId, ...next }; state.configs.push(current); }
      }
    });
    send(response, 200, this.summary(identity.namespaceId)); return true;
  }
}

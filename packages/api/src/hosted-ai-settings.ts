import { S3Client } from '@aws-sdk/client-s3';
import { AIError, estimateTokens, providerAdapters, type Completion, type ProviderConfig } from './ai-providers.js';
import { aiEndpoint, aiProviderConfig, type AiMeter } from './ai-settings.js';
import type { BedrockOptions } from './ai-bedrock.js';
import type { DeliveredCompletion } from './o-generative.js';
import { encryptMetadataSecret, decryptMetadataSecret } from './metadata-secrets.js';
import { MetadataError } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { record, invalid } from './schedule.js';

export type AIMode = 'managed' | 'byo' | 'off';
export interface HostedAIOptions { fetcher?: typeof fetch; bedrock?: BedrockOptions }
const configKey = { kind: 'ai-config' as const, id: 'provider' }, secretKey = { kind: 'secret' as const, id: 'ai-provider' };
/** Only deployment configuration can select Bedrock or the deterministic test provider. */
export function managedAI(env: NodeJS.ProcessEnv, injected?: BedrockOptions) {
  const managed = env.OPENSIGHT_AI_MANAGED;
  if (!managed) {
    if (env.OPENSIGHT_AI_BEDROCK_MODEL || env.OPENSIGHT_AI_TEST_STUB) throw new MetadataError('AI_MANAGED_CONFIG_INVALID', 503);
    return undefined;
  }
  if (managed === 'stub' && env.NODE_ENV === 'test' && env.OPENSIGHT_AI_TEST_STUB === '1') return { provider: 'stub' as const, model: 'persona-grounded' };
  const model = env.OPENSIGHT_AI_BEDROCK_MODEL, region = env.AWS_REGION;
  if (managed !== 'bedrock' || env.OPENSIGHT_AI_TEST_STUB || !model?.trim() || model.length > 2048 || /[\x00-\x20]/.test(model) || !region || !/^(?:us|eu|ap|ca|sa|me|af|il|mx)-(?:[a-z]+-)+\d$/.test(region)) throw new MetadataError('AI_MANAGED_CONFIG_INVALID', 503);
  const credentials = async () => {
    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) };
    // Reuse the already-shipped SDK's standard credential chain, without any S3 request.
    const client = new S3Client({ region });
    try { return await client.config.credentials(); } finally { client.destroy(); }
  };
  return { provider: 'bedrock' as const, model, bedrock: injected ?? { region, credentials } };
}
export class HostedAISettings {
  readonly managed;
  readonly allowed: readonly string[];
  private readonly adapters;
  constructor(private readonly metadata: TenantMetadata, private readonly encryptionKey: string, env: NodeJS.ProcessEnv,
    private readonly meter?: AiMeter, options: HostedAIOptions = {}) {
    this.managed = managedAI(env, options.bedrock);
    this.allowed = env.OPENSIGHT_AI_COMPATIBLE_URL ? [aiEndpoint(env.OPENSIGHT_AI_COMPATIBLE_URL)] : [];
    this.adapters = providerAdapters(options.fetcher, this.managed && 'bedrock' in this.managed ? this.managed.bedrock : undefined);
  }
  private async saved(context: TenantContext) {
    try { return await this.metadata.get(context, configKey); }
    catch (e) { if (e instanceof MetadataError && e.code === 'RESOURCE_NOT_FOUND') return undefined; throw e; }
  }
  private mode(body?: Record<string, unknown>): AIMode { return body?.mode as AIMode ?? (body?.provider ? 'byo' : this.managed ? 'managed' : 'off'); }
  private provider(body: Record<string, unknown>): ProviderConfig {
    return aiProviderConfig({ provider: body.provider, model: body.model, ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}) }, this.allowed);
  }
  private async key(context: TenantContext, body: Record<string, unknown>): Promise<string | undefined> {
    if (!body.secretId) return undefined;
    const secret = await this.metadata.get(context, { kind: 'secret', id: String(body.secretId) });
    return decryptMetadataSecret(String(secret.body.ciphertext), this.encryptionKey, context, secret);
  }
  async summary(context: TenantContext) {
    const saved = await this.saved(context), body = saved?.body, mode = this.mode(body);
    const credits = this.meter?.credits ? await this.meter.credits(context.namespaceId) : null;
    const hasKey = !!body && !!await this.key(context, body);
    const configured = mode === 'managed' ? !!this.managed && credits?.limit !== null && credits !== null && credits.remaining > 0
      : mode === 'byo' && !!body?.provider && body.provider !== 'bedrock' && hasKey;
    const state = mode === 'managed' && this.managed && credits?.limit !== null && credits !== null && credits.remaining === 0 ? 'credit-limit'
      : configured ? 'configured' : mode === 'byo' && body?.provider === 'bedrock' ? 'needs-approval' : 'not-configured';
    return { mode, configured, state, credits, managedAvailable: !!this.managed && credits !== null && credits.limit !== null,
      provider: mode === 'managed' ? 'bedrock' : body?.provider ?? null, model: mode === 'managed' ? this.managed?.model ?? '' : body?.model ?? '',
      ...(body?.baseUrl ? { baseUrl: body.baseUrl } : {}), hasKey, keyStorage: 'encrypted-metadata', canSaveKey: true, compatibleBaseUrls: this.allowed };
  }
  async status(context: TenantContext) {
    const { mode, configured, state, credits, managedAvailable } = await this.summary(context);
    return { mode, configured, state, credits, managedAvailable };
  }
  async save(context: TenantContext, raw: unknown) {
    const body = record(raw, ['mode', 'provider', 'model', 'baseUrl']), mode = body.mode ?? 'byo';
    if (!['managed', 'byo', 'off'].includes(String(mode))) invalid('$.mode', 'expected managed, byo or off');
    const current = await this.saved(context);
    if (mode === 'managed' && !this.managed) throw new AIError(503, 'AI_MANAGED_UNAVAILABLE', 'Managed AI is not enabled for this deployment');
    const next = mode === 'byo' ? this.provider(body) : undefined;
    if (next?.provider === 'bedrock') throw new AIError(409, 'AI_BEDROCK_APPROVAL_REQUIRED', 'Amazon Bedrock is managed only');
    const retain = !next || current?.body.provider === next.provider && current.body.baseUrl === next.baseUrl;
    const savedBody = next ? { ...next, mode, ...(retain && current?.body.secretId ? { secretId: current.body.secretId } : {}) } : { ...current?.body, mode };
    await this.metadata.put(context, configKey, savedBody, current?.version ?? 0);
  }
  async saveKey(context: TenantContext, raw: unknown) {
    const body = record(raw, ['key']), saved = await this.saved(context);
    if (!saved?.body.provider) throw new AIError(409, 'AI_NOT_CONFIGURED', 'Save provider and model before saving a key');
    if (saved.body.provider === 'bedrock') throw new AIError(409, 'AI_BEDROCK_APPROVAL_REQUIRED', 'Amazon Bedrock is managed only');
    if (typeof body.key !== 'string' || !body.key.length || body.key.length > 4096 || /[\x00-\x20]/.test(body.key)) invalid('$.key', 'expected a nonempty API key without whitespace');
    let version = 0;
    try { version = (await this.metadata.get(context, secretKey)).version; } catch (e) { if (!(e instanceof MetadataError && e.code === 'RESOURCE_NOT_FOUND')) throw e; }
    await this.metadata.batch(context, [
      { key: secretKey, body: encryptMetadataSecret(body.key, this.encryptionKey, context, secretKey), expectedVersion: version },
      { key: configKey, body: { ...saved.body, secretId: secretKey.id }, expectedVersion: saved.version },
    ]);
  }
  async complete(context: TenantContext, input: Completion, test = false): Promise<DeliveredCompletion> {
    const saved = await this.saved(context), mode = this.mode(saved?.body);
    let key = '', config: ProviderConfig, adapter;
    if (mode === 'managed') {
      if (!this.managed || !this.meter?.commit || !this.meter.credits || (await this.meter.credits(context.namespaceId)).limit === null) throw new AIError(503, 'AI_MANAGED_UNAVAILABLE', 'Managed AI is unavailable for this workspace');
      config = { provider: 'bedrock', model: this.managed.model }; adapter = this.adapters[this.managed.provider];
      // Connection tests are credit-free, not cost-free: the pre-call gate
      // (monthly credits + daily spend cap) applies to them too (#217).
      await this.meter.check(context.namespaceId, true);
    } else if (mode === 'byo' && saved) {
      config = this.provider(saved.body);
      if (config.provider === 'bedrock') throw new AIError(409, 'AI_BEDROCK_APPROVAL_REQUIRED', 'Amazon Bedrock is managed only');
      key = await this.key(context, saved.body) ?? '';
      if (!key) throw new AIError(503, 'AI_NOT_CONFIGURED', 'Provider API key is not configured');
      adapter = this.adapters[config.provider];
    } else throw new AIError(503, 'AI_NOT_CONFIGURED', 'AI provider is not configured');
    const result = await adapter.complete(config, key, input);
    // Token spend is an operator cost even when grammar/policy later rejects delivery.
    // Count zero leaves the monthly delivered-answer allowance untouched.
    // Connection tests commit the same way (#217): their tokens land in the
    // spend ledger so the daily cap accounts for them, still at zero credits.
    if (mode === 'managed') await this.meter!.commit!(context.namespaceId, result.tokens ?? estimateTokens(input.system, input.prompt, result.text), result.tokens === undefined, 0);
    let committed = false;
    return { text: key ? result.text.split(key).join('[redacted]') : result.text, remaining: async () => mode === 'managed' ? (await this.meter!.credits!(context.namespaceId)).remaining : Infinity, commit: async (count = 1) => {
      if (committed || test || mode !== 'managed') return;
      await this.meter!.commit!(context.namespaceId, 0, false, count);
      committed = true;
    } };
  }
}

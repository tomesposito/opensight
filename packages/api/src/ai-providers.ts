import { SecurityError } from './security.js';
import { isObject } from './mapping.js';

export const PROVIDERS = ['openai', 'anthropic', 'openai-compatible', 'bedrock'] as const;
export type AIProvider = typeof PROVIDERS[number];
export interface ProviderConfig { provider: AIProvider; model: string; baseUrl?: string }
export interface Completion { system: string; prompt: string; maxTokens?: number }
export interface ProviderAdapter { complete(config: ProviderConfig, key: string, input: Completion): Promise<string> }
export class AIError extends SecurityError {}
const invalidResponse = () => new AIError(502, 'AI_INVALID_RESPONSE', 'Provider returned an invalid or empty response');

/** One transport boundary: no SDK, redirects, tools, retries, or provider error-body forwarding. */
abstract class HTTPAdapter implements ProviderAdapter {
  constructor(protected readonly fetcher: typeof fetch) {}
  abstract complete(config: ProviderConfig, key: string, input: Completion): Promise<string>;
  protected async post(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AIError(502, response.status === 401 || response.status === 403 ? 'AI_AUTH_FAILED' : response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED', 'Provider connection failed; check configuration and account access');
      }
      const reader = response.body?.getReader();
      if (!reader) throw invalidResponse();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > 128 * 1024) { await reader.cancel(); throw invalidResponse(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!isObject(raw)) throw invalidResponse();
      return raw;
    } catch (error) {
      if (error instanceof AIError) throw error;
      throw new AIError(502, 'AI_CONNECTION_FAILED', 'Unable to connect to the configured provider');
    }
  }
  protected text(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 32_000) throw invalidResponse();
    return raw;
  }
}
class OpenAIAdapter extends HTTPAdapter {
  async complete(config: ProviderConfig, key: string, input: Completion): Promise<string> {
    const raw = await this.post('https://api.openai.com/v1/responses', { Authorization: `Bearer ${key}` }, {
      model: config.model, instructions: input.system, input: input.prompt, max_output_tokens: input.maxTokens ?? 2048, store: false,
    });
    if (!Array.isArray(raw.output)) throw invalidResponse();
    return this.text(raw.output.flatMap(item => isObject(item) && item.type === 'message' && Array.isArray(item.content)
      ? item.content.flatMap(c => isObject(c) && c.type === 'output_text' && typeof c.text === 'string' ? [c.text] : []) : []).join('\n'));
  }
}
class CompatibleAdapter extends HTTPAdapter {
  async complete(config: ProviderConfig, key: string, input: Completion): Promise<string> {
    const raw = await this.post(`${config.baseUrl}/chat/completions`, { Authorization: `Bearer ${key}` }, {
      model: config.model, max_tokens: input.maxTokens ?? 2048, messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }],
    });
    const choice = Array.isArray(raw.choices) ? raw.choices[0] : undefined;
    return this.text(isObject(choice) && isObject(choice.message) ? choice.message.content : undefined);
  }
}
class AnthropicAdapter extends HTTPAdapter {
  async complete(config: ProviderConfig, key: string, input: Completion): Promise<string> {
    const raw = await this.post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
      model: config.model, system: input.system, max_tokens: input.maxTokens ?? 2048, messages: [{ role: 'user', content: input.prompt }],
    });
    return this.text(Array.isArray(raw.content) ? raw.content.flatMap(c => isObject(c) && c.type === 'text' && typeof c.text === 'string' ? [c.text] : []).join('\n') : undefined);
  }
}
class BedrockAdapter implements ProviderAdapter {
  async complete(): Promise<never> { throw new AIError(409, 'AI_BEDROCK_APPROVAL_REQUIRED', 'Bedrock needs explicit approval; live AWS calls are disabled'); }
}
export function providerAdapters(fetcher: typeof fetch = globalThis.fetch): Readonly<Record<AIProvider, ProviderAdapter>> {
  return { openai: new OpenAIAdapter(fetcher), anthropic: new AnthropicAdapter(fetcher), 'openai-compatible': new CompatibleAdapter(fetcher), bedrock: new BedrockAdapter() };
}

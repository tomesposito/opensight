import { isEmbedDataEvent, type EmbedDataEvent } from '@opensight/embedding-sdk/events';
import type { EmbedShell } from './embed-transport.js';

/** One parent, exact origin and nonce for the lifetime of this frame. */
export function createEmbedChannel(shell: EmbedShell, view: Window, live: () => boolean) {
  let binding: { parentOrigin: string; channelId: string } | undefined;
  return {
    initialize(event: MessageEvent<unknown>) {
      if (binding || view.parent === view || event.source !== view.parent || event.origin === view.location.origin || !shell.allowedDomains.includes(event.origin)) return;
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (Object.keys(data).length !== 4 || !['version', 'type', 'sessionId', 'channelId'].every(k => Object.hasOwn(data, k))
        || data.version !== 2 || data.type !== 'opensight:initialize' || data.sessionId !== shell.sessionId || typeof data.channelId !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data.channelId)) return;
      binding = { parentOrigin: event.origin, channelId: data.channelId };
      return binding;
    },
    status(event: string) {
      if (binding) view.parent.postMessage({ version: 2, type: 'opensight:session', sessionId: shell.sessionId, channelId: binding.channelId, event }, binding.parentOrigin);
    },
    emit(payload: EmbedDataEvent) {
      if (binding && live() && isEmbedDataEvent(payload)) view.parent.postMessage({ version: 2, type: 'opensight:data', sessionId: shell.sessionId, channelId: binding.channelId, payload }, binding.parentOrigin);
    },
  };
}

import { allowsHostAction } from '@opensight/embedding-sdk/surface';
import { isActionMessage, isCustomActions, isEmbedDataEvent, type EmbedCustomAction, type EmbedDataEvent, type EmbedHostAction } from '@opensight/embedding-sdk/events';
import type { EmbedShell } from './embed-transport.js';

/** One parent, exact origin and nonce for the lifetime of this frame. */
export function createEmbedChannel(shell: EmbedShell, view: Window, live: () => boolean) {
  let binding: { parentOrigin: string; channelId: string } | undefined;
  let customActions: EmbedCustomAction[] = [];
  const listeners = new Set<(action: EmbedHostAction) => void>();
  return {
    live,
    get customActions(): readonly EmbedCustomAction[] { return customActions; },
    onAction(listener: (action: EmbedHostAction) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    receive(event: MessageEvent<unknown>) {
      if (!binding || event.source !== view.parent || event.origin !== binding.parentOrigin || !isActionMessage(event.data, shell.sessionId, binding.channelId)) return;
      const action = event.data.payload;
      if (!allowsHostAction(shell.surface, action) || !live()) return;
      for (const listener of listeners) listener(action);
    },
    initialize(event: MessageEvent<unknown>) {
      if (binding || view.parent === view || event.source !== view.parent || event.origin === view.location.origin || !shell.allowedDomains.includes(event.origin)) return;
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      const hasActions = Object.hasOwn(data, 'customActions');
      if (Object.keys(data).length !== (hasActions ? 5 : 4) || !['version', 'type', 'sessionId', 'channelId'].every(k => Object.hasOwn(data, k))
        || data.version !== 2 || data.type !== 'opensight:initialize' || data.sessionId !== shell.sessionId || typeof data.channelId !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data.channelId)) return;
      if (hasActions) {
        if (!isCustomActions(data.customActions)) return;
        customActions = structuredClone(data.customActions);
      }
      binding = { parentOrigin: event.origin, channelId: data.channelId };
      return binding;
    },
    status(event: string) {
      if (binding) view.parent.postMessage({ version: 2, type: 'opensight:session', sessionId: shell.sessionId, channelId: binding.channelId, event }, binding.parentOrigin);
    },
    emit(payload: EmbedDataEvent) {
      if (binding && live() && isEmbedDataEvent(payload, customActions)) view.parent.postMessage({ version: 2, type: 'opensight:data', sessionId: shell.sessionId, channelId: binding.channelId, payload }, binding.parentOrigin);
    },
  };
}

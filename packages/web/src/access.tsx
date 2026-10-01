import type { AIStatus, createApiClient } from './api-client.js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { hasCapability, type Capability, type Role } from '@opensight/query-engine/browser';
export interface Session { id: string; namespaceId: string; name: string; role: Role }
export interface Access { mode: 'demo' | 'hosted'; session?: Session; aiClient?: Pick<ReturnType<typeof createApiClient>, 'getAIStatus' | 'generateO' | 'generateCalculation'> }
// Public sample preview has a fixed author_ai persona, never a hosted credential.
const demo: Access = { mode: 'demo', session: { id: 'sample', namespaceId: 'sample', name: 'Public sample preview', role: 'author_ai' } };
const Context = createContext<Access>(demo);
export function AccessProvider({ access, children }: { access: Access; children: ReactNode }) { return <Context.Provider value={access}>{children}</Context.Provider>; }
export function useAccess() { return useContext(Context); }
export function allowed(access: Access, capability: Capability): boolean { return hasCapability(access.session?.role, capability); }

export function useAI() {
  const access = useAccess(), client = access.aiClient;
  const enabled = access.mode === 'hosted' && allowed(access, 'ai');
  const [status, setStatus] = useState<AIStatus>({ configured: false, state: 'not-configured' });
  useEffect(() => {
    let active = true;
    setStatus({ configured: false, state: 'not-configured' });
    if (enabled && client) void client.getAIStatus().then(value => { if (active) setStatus(value); }).catch(() => { if (active) setStatus({ configured: false, state: 'not-configured' }); });
    return () => { active = false; };
  }, [enabled, client]);
  return { ...status, available: enabled && !!client && status.configured, client: enabled ? client : undefined };
}

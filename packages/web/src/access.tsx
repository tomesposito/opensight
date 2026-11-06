import type { TrialInfo, BillingState } from './TrialBilling.js';
import type { AIStatus, createApiClient } from './api-client.js';
import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { hasCapability, type Capability, type Role } from '@opensight/query-engine/browser';
export interface Session {
  id: string; namespaceId: string; tenantId?: string; name: string; role: Role;
  /** Workspace display label (display_name with tenant_id fallback) and internal slug. */
  billingPaused?: boolean; trial?: TrialInfo | null; billing?: BillingState;
  workspaceName?: string; workspaceSlug?: string | null;
}
export interface Access { mode: 'demo' | 'hosted' | 'local'; session?: Session; signOut?(): Promise<void>; aiClient?: Pick<ReturnType<typeof createApiClient>, 'getAIStatus' | 'generateO' | 'generateCalculation' | 'planO' | 'reviseO'> }
// Public sample preview has a fixed author_ai persona, never a hosted credential.
export const demoAccess: Access = { mode: 'demo', session: { id: 'sample', namespaceId: 'sample', name: 'Public sample preview', role: 'author_ai' } };
const Context = createContext<Access>(demoAccess);
export function AccessProvider({ access, children }: { access: Access; children: ReactNode }) { return <Context.Provider value={access}>{children}</Context.Provider>; }
export function useAccess() { return useContext(Context); }
export function allowed(access: Access, capability: Capability): boolean { return access.mode === 'local' ? capability === 'build' : hasCapability(access.session?.role, capability); }

export function useAI() {
  const access = useAccess(), client = access.aiClient;
  const enabled = access.mode === 'hosted' && allowed(access, 'ai');
  const [status, setStatus] = useState<AIStatus>({ configured: false, state: 'not-configured' });
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const current = epoch.current;
    if (!enabled || !client) return;
    try { const value = await client.getAIStatus(); if (current === epoch.current) setStatus(value); }
    catch { if (current === epoch.current) setStatus({ configured: false, state: 'not-configured' }); }
  }, [enabled, client]);
  useEffect(() => {
    epoch.current++; setStatus({ configured: false, state: 'not-configured' }); void refresh();
    return () => { epoch.current++; };
  }, [refresh]);
  return { ...status, refresh, available: enabled && !!client && status.configured, client: enabled ? client : undefined };
}

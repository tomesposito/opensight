import { createContext, useContext, type ReactNode } from 'react';
import { hasCapability, type Capability, type Role } from '@opensight/query-engine/browser';
export interface Session { id: string; namespaceId: string; name: string; role: Role }
export interface Access { mode: 'demo' | 'hosted'; session?: Session }
// Public sample preview has a fixed author_ai persona, never a hosted credential.
const demo: Access = { mode: 'demo', session: { id: 'sample', namespaceId: 'sample', name: 'Public sample preview', role: 'author_ai' } };
const Context = createContext<Access>(demo);
export function AccessProvider({ access, children }: { access: Access; children: ReactNode }) { return <Context.Provider value={access}>{children}</Context.Provider>; }
export function useAccess() { return useContext(Context); }
export function allowed(access: Access, capability: Capability): boolean { return hasCapability(access.session?.role, capability); }

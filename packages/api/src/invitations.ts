import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRole } from '@opensight/query-engine';
import { method, routeId, send } from './automation-routes.js';
import { readBody, RequestError } from './query.js';
import { id, invalid, record } from './schedule.js';
import { resourceName } from './organization.js';
import { SecurityError, validateSecurityState, type Invitation, type Identity, type SecurityService } from './security.js';

const publicInvitation = ({ tokenHash, ...invitation }: Invitation) => invitation;
/** No email credentials or login passwords are provisioned. The deployment verifier owns sign-in. */
export async function invitationRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity, security: SecurityService): Promise<boolean> {
  const match = /^\/api\/invitations(?:\/([^/]+))?$/.exec(path);
  if (!match) return false;
  const accept = match[1] === 'accept';
  if (!accept) security.admin(identity);
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  const verb = method(request, response, accept ? ['POST'] : match[1] ? ['DELETE'] : ['GET', 'POST']);
  if (accept) {
    const body = record(await readBody(request), ['token']);
    if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new SecurityError(400, 'SECURITY_INVITATION_INVALID', 'Invalid invitation token');
    const hash = createHash('sha256').update(body.token).digest();
    const user = await security.store.change(state => {
      const invitation = state.invitations?.find(i => timingSafeEqual(Buffer.from(i.tokenHash, 'hex'), hash));
      if (!invitation) throw new SecurityError(404, 'SECURITY_INVITATION_INVALID', 'Invitation is invalid or already used');
      if (invitation.namespaceId !== identity.namespaceId || invitation.id !== identity.userId) throw new SecurityError(403, 'SECURITY_INVITATION_PRINCIPAL_MISMATCH', 'Sign in as the invited identity in the invited namespace');
      if (Date.parse(invitation.expiresAt) <= Date.now()) throw new SecurityError(410, 'SECURITY_INVITATION_EXPIRED', 'Invitation expired; request a new invitation');
      security.admin({ namespaceId: invitation.namespaceId, userId: invitation.invitedBy }, state);
      if (state.users.some(u => u.id === identity.userId && u.namespaceId === identity.namespaceId)) throw new RequestError(409, 'User already exists');
      const user = { id: invitation.id, namespaceId: invitation.namespaceId, name: invitation.name, role: invitation.role };
      state.users.push(user); state.invitations = state.invitations!.filter(i => i !== invitation);
      validateSecurityState(state, security.columns); return user;
    });
    send(response, 200, user); return true;
  }
  if (verb === 'GET') { send(response, 200, (security.store.read().invitations ?? []).filter(i => i.namespaceId === identity.namespaceId).map(publicInvitation)); return true; }
  if (verb === 'DELETE') {
    const userId = routeId(match[1]!);
    await security.store.change(state => {
      security.admin(identity, state);
      if (!state.invitations?.some(i => i.id === userId && i.namespaceId === identity.namespaceId)) throw new RequestError(404, 'Invitation not found');
      state.invitations = state.invitations.filter(i => i.id !== userId || i.namespaceId !== identity.namespaceId);
    });
    send(response, 200, { deleted: true }); return true;
  }
  const body = record(await readBody(request), ['id', 'name', 'role']);
  const userId = id(body.id, '$.id');
  if (userId === 'accept') invalid('$.id', 'reserved user ID');
  if (!isRole(body.role)) invalid('$.role', 'expected a supported role');
  const token = randomBytes(32).toString('hex');
  const invite: Invitation = { id: userId, namespaceId: identity.namespaceId, name: resourceName(body.name), role: body.role, invitedBy: identity.userId, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(), tokenHash: createHash('sha256').update(token).digest('hex') };
  await security.store.change(state => {
    security.admin(identity, state);
    if (state.users.some(u => u.id === userId && u.namespaceId === identity.namespaceId) || state.invitations?.some(i => i.id === userId && i.namespaceId === identity.namespaceId)) throw new RequestError(409, 'User or pending invitation already exists');
    (state.invitations ??= []).push(invite); validateSecurityState(state, security.columns);
  });
  send(response, 201, { invitation: publicInvitation(invite), token }); return true;
}

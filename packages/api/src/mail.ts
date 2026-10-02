import { connect } from 'node:tls';
import { randomUUID } from 'node:crypto';
import { invalid } from './schedule.js';

export interface MailMessage { to: string[]; subject: string; html: string; dedupeKey?: string }
export interface MailTransport { readonly configured: boolean; send(message: MailMessage, authorize?: () => Promise<void>): Promise<void> }
export class MailError extends Error {
  constructor(readonly code: 'SMTP_NOT_CONFIGURED' | 'SMTP_SEND_FAILED') { super(code === 'SMTP_NOT_CONFIGURED' ? 'SMTP is not configured' : 'SMTP delivery failed'); this.name = 'MailError'; }
}
export function emailAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value);
}
export function recipients(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 50 || !value.every(emailAddress) || new Set(value.map(v => v.toLowerCase())).size !== value.length) invalid('$.recipients', 'expected 1–50 unique email addresses');
  return [...value];
}
/** Tests must explicitly inject this transport; it never opens a connection. */
export class StubMailTransport implements MailTransport {
  readonly configured = true;
  readonly messages: MailMessage[] = [];
  constructor(private readonly receipts = new Set<string>()) {}
  async send(message: MailMessage, authorize?: () => Promise<void>): Promise<void> {
    await authorize?.();
    if (message.dedupeKey && this.receipts.has(message.dedupeKey)) return;
    this.messages.push(structuredClone(message));
    if (message.dedupeKey) this.receipts.add(message.dedupeKey);
  }
}

/** Environment is the ONLY SMTP configuration source. No HTTP or resource config. */
export function smtpFromEnvironment(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const host = env.OPENSIGHT_SMTP_HOST, from = env.OPENSIGHT_SMTP_FROM;
  const portText = env.OPENSIGHT_SMTP_PORT ?? '465';
  const user = env.OPENSIGHT_SMTP_USER, password = env.OPENSIGHT_SMTP_PASSWORD;
  const supplied = Object.keys(env).some(k => k.startsWith('OPENSIGHT_SMTP_') && env[k] !== undefined);
  if (!supplied) return { configured: false, async send() { throw new MailError('SMTP_NOT_CONFIGURED'); } };
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host) || !emailAddress(from) || !/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535 || Boolean(user) !== Boolean(password)) throw new Error('Invalid SMTP environment configuration');
  if (Object.keys(env).some(k => k.startsWith('OPENSIGHT_SMTP_') && !['HOST', 'FROM', 'PORT', 'USER', 'PASSWORD'].some(n => k === `OPENSIGHT_SMTP_${n}`))) throw new Error('Unsupported SMTP environment setting');
  const port = Number(portText);
  return { configured: true, async send(message, authorize) {
    // Implicit TLS only, with certificate verification. No plaintext downgrade.
    const socket = connect({ host, port, servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true });
    socket.setTimeout(30000, () => socket.destroy(new Error('SMTP timeout')));
    const deadline = setTimeout(() => socket.destroy(new Error('SMTP deadline')), 60000);
    try {
      const lines = smtpLines(socket)[Symbol.asyncIterator]();
      const response = async (expected: number[]) => {
        let code: number | undefined;
        for (let count = 0; count < 100; count++) {
          const line = await lines.next();
          const match = !line.done && /^(\d{3})([ -])(.*)$/.exec(line.value);
          if (!match || code !== undefined && Number(match[1]) !== code) throw new Error('Invalid SMTP response');
          code = Number(match[1]);
          if (match[2] === ' ') { if (!expected.includes(code)) throw new Error('SMTP rejected command'); return; }
        }
        throw new Error('SMTP response limit');
      };
      const command = async (text: string, expected: number[]) => { socket.write(`${text}\r\n`); await response(expected); };
      // Validate again at the boundary; caller-supplied messages cannot inject headers.
      recipients(message.to);
      if (!message.subject || /[\r\n\0]/.test(message.subject)) throw new Error('Invalid subject');
      if (message.dedupeKey !== undefined && !/^[a-f0-9]{64}$/.test(message.dedupeKey)) throw new Error('Invalid dedupe key');
      await response([220]); await command('EHLO opensight.local', [250]);
      if (user && password) {
        await command('AUTH LOGIN', [334]); await command(Buffer.from(user).toString('base64'), [334]); await command(Buffer.from(password).toString('base64'), [235]);
      }
      await command(`MAIL FROM:<${from}>`, [250]);
      for (const to of message.to) await command(`RCPT TO:<${to}>`, [250, 251]);
      await authorize?.();
      await command('DATA', [354]);
      const encoded = Buffer.from(message.html).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
      socket.write([`From: <${from}>`, `To: ${message.to.map(to => `<${to}>`).join(', ')}`, `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${message.dedupeKey ?? randomUUID()}@opensight.local>`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded, '.', ''].join('\r\n'));
      await response([250]);
      // Acceptance of DATA is the delivery boundary; a failed QUIT must not duplicate mail.
      socket.end('QUIT\r\n');
    } catch { throw new MailError('SMTP_SEND_FAILED'); }
    finally { clearTimeout(deadline); socket.destroy(); }
  } };
}
async function* smtpLines(stream: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let pending = '';
  for await (const bytes of stream) {
    pending += bytes.toString('utf8');
    if (pending.length > 65536) throw new Error('SMTP response limit');
    let offset: number;
    while ((offset = pending.indexOf('\r\n')) >= 0) { yield pending.slice(0, offset); pending = pending.slice(offset + 2); }
  }
  if (pending) throw new Error('Truncated SMTP response');
}

'use strict';
const { randomUUID } = require('node:crypto');
const MAX_INPUT = 25 * 1024 * 1024, MAX_OUTPUT = 40 * 1024 * 1024;
const fail = code => { throw Error(code); };
function settings(env) {
  const email = value => typeof value === 'string' && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) && value.length <= 254;
  const aliases = [env.MAIL_SUPPORT, env.MAIL_PRIVACY];
  if (!email(env.MAIL_DESTINATION) || !email(env.MAIL_SENDER) || aliases.some(a => !email(a))
    || new Set(aliases).size !== 2 || aliases.includes(env.MAIL_DESTINATION)
    || !aliases.includes(env.MAIL_SENDER) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.MAIL_BUCKET ?? '')) fail('MAIL_CONFIGURATION_INVALID');
  return { sender: env.MAIL_SENDER, destination: env.MAIL_DESTINATION, aliases, bucket: env.MAIL_BUCKET };
}
function envelope(event, config) {
  if (!Array.isArray(event?.Records) || event.Records.length !== 1) fail('MAIL_EVENT_INVALID');
  const record = event.Records[0], mail = record.ses?.mail, receipt = record.ses?.receipt;
  if (record.eventSource !== 'aws:ses' || !/^[A-Za-z0-9-]{1,128}$/.test(mail?.messageId ?? '')
    || !Array.isArray(receipt?.recipients) || !receipt.recipients.length
    || receipt.recipients.some(a => !config.aliases.includes(a))) fail('MAIL_ENVELOPE_DENIED');
  if (receipt.spamVerdict?.status !== 'PASS' || receipt.virusVerdict?.status !== 'PASS') fail('MAIL_QUARANTINED');
  return { id: mail.messageId, aliases: [...new Set(receipt.recipients)] };
}
function rawMessage(bytes, config, aliases) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_INPUT) fail('MAIL_SIZE_LIMIT');
  const boundary = 'opensight-' + randomUUID();
  // Original headers never become forwarding headers. Preserve the exact bytes
  // as an attachment, including forged To/Bcc/From/Subject fields.
  const encoded = bytes.toString('base64').match(/.{1,76}/g).join('\r\n');
  const result = Buffer.from([
    `From: ${config.sender}`, `To: ${config.destination}`, 'Subject: OpenSight inbound contact',
    'Auto-Submitted: auto-generated', 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 7bit', '',
    `Mail received for ${aliases.join(', ')}. The original message is attached.`, '', `--${boundary}`,
    'Content-Type: application/octet-stream; name="original.eml"',
    'Content-Disposition: attachment; filename="original.eml"', 'Content-Transfer-Encoding: base64', '', encoded,
    `--${boundary}--`, '',
  ].join('\r\n'));
  if (result.length > MAX_OUTPUT) fail('MAIL_SIZE_LIMIT');
  return result;
}
async function forward(event, env, io) {
  const config = settings(env), message = envelope(event, config), key = 'raw/' + message.id;
  const size = await io.size(config.bucket, key);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_INPUT) fail('MAIL_SIZE_LIMIT');
  const bytes = await io.read(config.bucket, key, size);
  if (bytes.length !== size) fail('MAIL_OBJECT_CHANGED');
  const raw = rawMessage(bytes, config, message.aliases);
  const claim = await io.claim(config.bucket, 'receipts/' + message.id, { state: 'claimed', at: new Date().toISOString() });
  if (!claim) {
    const prior = await io.receipt(config.bucket, 'receipts/' + message.id);
    if (prior.state === 'sent') return { state: 'duplicate' };
    fail('MAIL_RECONCILIATION_REQUIRED');
  }
  let sent;
  try { sent = await io.send(config.sender, config.destination, raw); }
  catch { fail('MAIL_SEND_RECONCILIATION_REQUIRED'); }
  if (typeof sent !== 'string' || !sent) fail('MAIL_SEND_RECONCILIATION_REQUIRED');
  await io.complete(config.bucket, 'receipts/' + message.id, { state: 'sent', at: new Date().toISOString(), messageId: sent });
  return { state: 'sent' };
}
exports.settings = settings; exports.envelope = envelope; exports.rawMessage = rawMessage;
exports.forward = forward; exports.MAX_INPUT = MAX_INPUT;
exports.handler = async event => {
  const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  const s3 = new S3Client({ maxAttempts: 2 });
  // A retried SendEmail could duplicate an accepted message after a lost response.
  const ses = new SESv2Client({ maxAttempts: 1 });
  const io = {
    size: async (Bucket, Key) => (await s3.send(new HeadObjectCommand({ Bucket, Key }))).ContentLength,
    read: async (Bucket, Key, limit) => {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
      if (r.ContentLength !== limit) { r.Body?.destroy(); fail('MAIL_OBJECT_CHANGED'); }
      const chunks = []; let length = 0;
      for await (const chunk of r.Body) {
        length += chunk.length;
        if (length > limit) { r.Body.destroy(); fail('MAIL_SIZE_LIMIT'); }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, length);
    },
    claim: async (Bucket, Key, value) => {
      try { await s3.send(new PutObjectCommand({ Bucket, Key, Body: JSON.stringify(value), ContentType: 'application/json', ServerSideEncryption: 'AES256', IfNoneMatch: '*' })); return true; }
      catch (e) { if (e.$metadata?.httpStatusCode === 412) return false; throw e; }
    },
    receipt: async (Bucket, Key) => JSON.parse((await io.read(Bucket, Key, await io.size(Bucket, Key))).toString()),
    complete: async (Bucket, Key, value) => s3.send(new PutObjectCommand({ Bucket, Key, Body: JSON.stringify(value), ContentType: 'application/json', ServerSideEncryption: 'AES256' })),
    send: async (sender, destination, bytes) => (await ses.send(new SendEmailCommand({ FromEmailAddress: sender,
      Destination: { ToAddresses: [destination] }, Content: { Raw: { Data: bytes } } })).catch(error => {
        const denied = error.name === 'AccessDeniedException';
        // Emit only fixed classifications; provider messages can contain private identities.
        const code = denied ? (String(error.message).includes('identity/' + destination) ? 'MAIL_DESTINATION_IDENTITY_DENIED' : 'MAIL_SEND_ACCESS_DENIED')
          : ['MessageRejected','BadRequestException','TooManyRequestsException','MailFromDomainNotVerifiedException'].includes(error.name) ? 'MAIL_PROVIDER_' + error.name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() : 'MAIL_PROVIDER_FAILED';
        console.error(code); throw Error('MAIL_SEND_RECONCILIATION_REQUIRED');
      })).MessageId,
  };
  try { return await forward(event, process.env, io); }
  catch (error) {
    // Only a stable code reaches logs. Provider errors may contain addresses.
    const code = /^MAIL_[A-Z_]+$/.test(error.message) ? error.message : 'MAIL_OPERATION_FAILED';
    console.error(code); throw Error(code);
  }
};

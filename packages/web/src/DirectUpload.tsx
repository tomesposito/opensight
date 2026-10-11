import { useEffect, useRef, useState } from 'react';
import type { createApiClient } from './api-client.js';
import type { OperationStatus, ReservationStatus, UploadProgress } from './object-transfers.js';

export type DirectUploadClient = Pick<ReturnType<typeof createApiClient>, 'uploadDirectFile' | 'getOperation' | 'getUploadReservation' | 'cancelOperation' | 'cancelUploadReservation'>;
const pending = (operation?: OperationStatus) => !!operation && ['queued', 'running'].includes(operation.state);
const message = (error: unknown) => error instanceof Error ? error.message : 'The upload could not be confirmed.';
/** Polling belongs only to this visible, bounded user action. No accepted work is cancelled on unmount. */
export function DirectUpload({ client, file, config, onUploaded, onPrep }: { client: DirectUploadClient; file?: File; config: Readonly<Record<string, string>>;
  onUploaded?: (source: string) => void; onPrep?: (source: string) => void }) {
  const [expires, setExpires] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState<UploadProgress>(), [reservation, setReservation] = useState<ReservationStatus>(), [operation, setOperation] = useState<OperationStatus>();
  const [pollAttempt, setPollAttempt] = useState(0), [paused, setPaused] = useState(false);
  const mounted = useRef(true), current = useRef<AbortController | undefined>(undefined), poll = useRef<AbortController | undefined>(undefined), notified = useRef('');
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.visibilityState === 'hidden') { current.current?.abort(); poll.current?.abort(); setPaused(true); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; current.current?.abort(); poll.current?.abort(); document.removeEventListener('visibilitychange', hidden); };
  }, [client]);
  const receive = (value: OperationStatus) => {
    if (!mounted.current) return;
    setOperation(value);
    if (value.state === 'completed' && value.sourceId && notified.current !== value.id) { notified.current = value.id; onUploaded?.(value.sourceId); }
  };
  const pollId = pending(operation) ? operation!.id : undefined;
  useEffect(() => {
    if (!pollId || document.visibilityState === 'hidden') return;
    const controller = new AbortController(), started = Date.now(); poll.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined, delay = 2000;
    setPaused(false);
    const read = async () => {
      if (controller.signal.aborted || document.visibilityState === 'hidden') return;
      if (Date.now() - started >= 120000) { setPaused(true); return; }
      try {
        const result = await client.getOperation(pollId, controller.signal);
        if (controller.signal.aborted || !mounted.current) return;
        receive(result);
        if (pending(result)) { delay = Math.min(15000, Math.ceil(delay * 1.5)); timer = setTimeout(() => void read(), delay); }
      } catch (error) { if (mounted.current) { setPaused(true); if (!controller.signal.aborted) setError(message(error)); } }
    };
    const deadline = setTimeout(() => controller.abort(), 120000);
    timer = setTimeout(() => void read(), delay);
    const abort = () => { clearTimeout(timer); if (mounted.current) setPaused(true); }; controller.signal.addEventListener('abort', abort, { once: true });
    return () => { controller.signal.removeEventListener('abort', abort); controller.abort(); clearTimeout(timer); clearTimeout(deadline); if (poll.current === controller) poll.current = undefined; };
  }, [client, pollId, pollAttempt]);
  const action = async (run: (signal: AbortSignal) => Promise<void>) => {
    if (busy || document.visibilityState === 'hidden') return;
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 120000); current.current = controller; setBusy(true); setError('');
    try { await run(controller.signal); }
    catch (error) { if (mounted.current) setError(controller.signal.aborted ? 'Stopped checking this upload. Accepted ingestion continues; use Check status to resume.' : message(error)); }
    finally { clearTimeout(deadline); if (current.current === controller) current.current = undefined; if (mounted.current) setBusy(false); }
  };
  const start = () => void action(async signal => {
    if (!file) throw new Error('Choose a file to upload.');
    if (!expires || !Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.now()) throw new Error('Choose a future expiry for this data.');
    setOperation(undefined); setReservation(undefined); setPaused(false);
    const result = await client.uploadDirectFile(file, config, new Date(expires).toISOString(), value => {
      if (!mounted.current || signal.aborted) return;
      setProgress(value); if ('reservation' in value && value.reservation) setReservation(value.reservation);
      if (value.stage === 'accepted') receive(value.operation);
    }, signal);
    if (!signal.aborted) receive(result);
  });
  const check = () => void action(async signal => {
    if (operation) { const latest = await client.getOperation(operation.id, signal); if (signal.aborted) return; receive(latest); }
    else if (reservation) {
      const latest = await client.getUploadReservation(reservation.id, signal); if (signal.aborted) return;
      setReservation(latest); if (latest.operationId) { const result = await client.getOperation(latest.operationId, signal); if (signal.aborted) return; receive(result); }
    }
    setPollAttempt(n => n + 1);
  });
  const cancel = () => void action(async signal => {
    poll.current?.abort();
    if (operation && pending(operation)) { const latest = await client.cancelOperation(operation.id, operation.revision, signal); if (signal.aborted || !mounted.current) return; receive(latest); }
    else if (reservation) { const latest = await client.cancelUploadReservation(reservation.id, reservation.revision, signal); if (signal.aborted || !mounted.current) return; setReservation(latest); }
    setProgress(undefined);
  });
  const reservationPending = !!reservation && ['reserved', 'accepted'].includes(reservation.state) && !operation;
  const active = pending(operation) || reservationPending, complete = operation?.state === 'completed' && operation.sourceId;
  const stages = { hashing: 'Checking file…', reserving: 'Reserving upload…', uploading: 'Uploading file…', accepting: 'Starting ingestion…', accepted: 'Ingestion accepted' };
  return <section className="direct-upload" aria-label="Durable file upload">
    <label>Data expires<input type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} required disabled={busy || active} /></label>
    <p className="connector-help">Choose the retention deadline in your local time. This source is private to your user and workspace.</p>
    <button type="button" className="connector-submit" onClick={start} disabled={busy || active || !file || !expires}>{busy && progress ? stages[progress.stage] : operation || reservation ? 'Upload another file' : 'Upload file'}</button>
    {error && <p className="connector-error" role="alert">{error}</p>}
    {(operation || reservation || busy) && <div className="upload-result" role="status">
      <h3>{complete ? 'Upload saved' : operation ? `Ingestion ${operation.state}` : reservation ? `Upload ${reservation.state}` : progress ? stages[progress.stage] : 'Preparing upload'}</h3>
      {operation?.errorCode && <p>{operation.errorCode}</p>}
      {operation && <p>Operation: {operation.id}</p>}
      {paused && active && <p>Automatic status checks are paused.</p>}
      {active && <><button type="button" disabled={busy} onClick={check}>Check status</button><button type="button" disabled={busy} onClick={cancel}>Cancel upload</button></>}
      {complete && <><p>Saved privately until <time dateTime={reservation?.sourceExpiresAt ?? new Date(expires).toISOString()}>{reservation?.sourceExpiresAt ?? new Date(expires).toISOString()}</time>. Survives API restarts.</p>{onPrep && <button type="button" onClick={() => onPrep(complete)}>Prepare this upload</button>}</>}
    </div>}
    <p className="connector-help">8 MiB maximum. Closing this page stops status checks; an accepted upload continues processing. Reopen Data preparation to find completed sources.</p>
  </section>;
}

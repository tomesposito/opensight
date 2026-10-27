import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Minimal offline Chromium driver over its DevTools pipe; no npm dependency. */
export async function chromiumPage() {
  const executable = process.env.OPENSIGHT_CHROMIUM ?? [
    '/opt/meta-chromium/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync);
  if (!executable) throw new Error('Browser tests require Chromium: set OPENSIGHT_CHROMIUM to its executable.');
  const profile = await mkdtemp(join(tmpdir(), 'opensight-browser-test-'));
  const child = spawn(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', `--user-data-dir=${profile}`],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let sequence = 0, buffer = '', diagnostics = '';
  const pending = new Map();
  const rejectPending = error => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
  child.on('error', rejectPending);
  child.stdio[3].on('error', rejectPending);
  const exited = new Promise(resolve => child.once('close', code => {
    rejectPending(new Error(`Chromium exited (${code}): ${diagnostics}`)); resolve();
  }));
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\0')) >= 0;) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Chromium timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
      child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
  async function close() {
    // Closing the pipe terminates Chromium, including when startup failed.
    child.stdio[3].end();
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited; clearTimeout(timeout);
    await rm(profile, { recursive: true, force: true });
  }
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    let hoveredNodes = [];
    let cssEnabled = false;
    let documentRoot;
    const getDocument = async () => {
      // Re-requesting the document invalidates the previous frontend node IDs.
      documentRoot ??= (await send('DOM.getDocument', { depth: -1 }, sessionId)).root;
      return documentRoot;
    };
    const setHovered = async selector => {
      if (!cssEnabled) {
        await send('DOM.enable', {}, sessionId);
        await send('CSS.enable', {}, sessionId);
        cssEnabled = true;
      }
      for (const nodeId of hoveredNodes) {
        await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, sessionId);
      }
      hoveredNodes = [];
      if (selector === null) return;
      const root = await getDocument();
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }, sessionId);
      if (!nodeId) throw new Error(`Cannot hover missing element: ${selector}`);
      const pathTo = (node, ancestors = []) => {
        const path = node.nodeType === 1 ? [...ancestors, node.nodeId] : ancestors;
        if (node.nodeId === nodeId) return path;
        for (const child of node.children ?? []) {
          const found = pathTo(child, path);
          if (found) return found;
        }
      };
      // Like a pointer over a descendant, hover also applies to its ancestors.
      hoveredNodes = pathTo(root);
      if (!hoveredNodes) throw new Error(`Cannot resolve hover ancestry: ${selector}`);
      for (const id of hoveredNodes) {
        await send('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses: ['hover'] }, sessionId);
      }
    };
    const evaluate = async (fn, argument) => {
      const result = await send('Runtime.evaluate', {
        expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`, returnByValue: true, awaitPromise: true,
      }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    return {
      evaluate, close, setHovered,
      hoverState: async selector => {
        const root = await getDocument();
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }, sessionId);
        if (!nodeId) throw new Error(`Missing interaction target: ${selector}`);
        const { matchedCSSRules } = await send('CSS.getMatchedStylesForNode', { nodeId }, sessionId);
        return {
          hovered: hoveredNodes.includes(nodeId),
          rules: matchedCSSRules.flatMap(({ rule, matchingSelectors }) => [
            rule.selectorList.text,
            ...matchingSelectors.map(index => rule.selectorList.selectors[index].text),
          ]),
        };
      },
      emulateMedia: media => send('Emulation.setEmulatedMedia', { media }, sessionId),
      printToPDF: () => send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }, sessionId),
      setViewportSize: size => send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false }, sessionId),
      setContent: async html => {
        if (hoveredNodes.length) await setHovered(null);
        await evaluate(content => { document.open(); document.write(content); document.close(); },
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${html}`);
        documentRoot = undefined;
      },
    };
  } catch (error) { await close(); throw error; }
}

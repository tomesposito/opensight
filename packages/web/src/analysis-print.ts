/** Print the currently rendered sheet, preserving SVGs, tables and visible state.
 * The browser supplies printing/PDF rendering; no data is fetched or re-queried. */
export function prepareAnalysisPrint(workspace: HTMLElement, title: string, sheetName: string): () => void {
  const doc = workspace.ownerDocument;
  const center = workspace.querySelector<HTMLElement>('.author-center');
  if (!center) throw new Error('The analysis sheet is unavailable. Reopen the analysis and retry.');
  if (center.querySelector('[aria-busy="true"], .visual-skeleton')) throw new Error('Wait for the analysis visuals to finish loading, then retry.');
  doc.querySelector('.analysis-print-root')?.remove();
  const root = doc.createElement('section');
  root.className = 'analysis-print-root'; root.setAttribute('aria-hidden', 'true'); root.inert = true;
  const heading = doc.createElement('h1'); heading.textContent = title.trim() || 'Untitled analysis';
  const sheet = doc.createElement('p'); sheet.textContent = `Current sheet: ${sheetName}`;
  const notice = doc.createElement('p'); notice.className = 'analysis-print-notice';
  notice.textContent = workspace.querySelector('.fixture-notice')?.textContent ?? '';
  const clone = center.cloneNode(true) as HTMLElement;
  // Pair scrollers before removing debug footers, which can themselves contain
  // tables ahead of the visible table visuals in document order.
  const originalScrollers = center.querySelectorAll('.table-scroll');
  const scrollPositions = Array.from(clone.querySelectorAll('.table-scroll'), (node, index) => ({
    node, top: originalScrollers[index]!.scrollTop, left: originalScrollers[index]!.scrollLeft,
  }));
  // Keep the captured width, so SVG geometry and grid placements cannot reflow
  // when the browser changes media. Fit this snapshot on one landscape page.
  const width = Math.max(center.getBoundingClientRect().width, center.scrollWidth, 1);
  const height = Math.max(center.getBoundingClientRect().height, center.scrollHeight, 1);
  clone.className = 'analysis-print-sheet';
  clone.style.width = `${width}px`;
  clone.style.zoom = String(Math.min(1, 980 / width, 550 / height));
  const originalControls = center.querySelectorAll('input, select, textarea, button');
  clone.querySelectorAll('input, select, textarea, button').forEach((control, index) => {
    const original = originalControls[index]!;
    if (control.tagName === 'BUTTON' && !control.closest('.table-scroll')) { control.remove(); return; }
    const text = doc.createElement('span');
    if (control.tagName === 'SELECT') text.textContent = Array.from((original as HTMLSelectElement).selectedOptions).map(option => option.textContent).join(', ');
    else if (control.tagName === 'INPUT') {
      const input = original as HTMLInputElement;
      text.textContent = ['checkbox', 'radio'].includes(input.type) ? (input.checked ? 'Yes' : 'No') : input.value;
    } else text.textContent = control.tagName === 'TEXTAREA' ? (original as HTMLTextAreaElement).value : original.textContent;
    control.replaceWith(text);
  });
  clone.querySelectorAll('.sheet-toolbar, .author-card-toolbar, .react-resizable-handle, .canvas-label, .card-footer, .controls-heading, .control-settings, .control-form, script, iframe').forEach(node => node.remove());
  clone.querySelectorAll('.controls-strip').forEach(strip => { if (!strip.querySelector('.control-container')) strip.remove(); });
  // Isolate SVG clip paths and other fragment references from the live editor.
  const ids = new Map<string, string>();
  let sequence = 0;
  clone.querySelectorAll('[id]').forEach(node => {
    let next: string;
    do { next = `opensight-print-${sequence++}`; } while (doc.getElementById(next));
    ids.set(node.id, next); node.id = next;
  });
  clone.querySelectorAll('*').forEach(node => {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith('on')) { node.removeAttribute(attribute.name); continue; }
      let value = attribute.value;
      for (const [id, next] of ids) {
        value = value.replaceAll(`url(#${id})`, `url(#${next})`);
        if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value === `#${id}`) value = `#${next}`;
      }
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  });
  root.append(heading, sheet, notice, clone); doc.body.append(root);
  // cloneNode does not preserve scroll offsets. Keep the table viewport shown
  // to the user, rather than silently replacing it with its first rows.
  for (const { node, top, left } of scrollPositions) {
    if (node.isConnected) { node.scrollTop = top; node.scrollLeft = left; }
  }
  return () => root.remove();
}

export function printAnalysis(workspace: HTMLElement, title: string, sheetName: string): () => void {
  const view = workspace.ownerDocument.defaultView;
  if (!view || typeof view.print !== 'function') throw new Error('Printing is unavailable in this browser. Use a browser with printing and Save as PDF support.');
  const cleanup = prepareAnalysisPrint(workspace, title, sheetName);
  const previousTitle = workspace.ownerDocument.title;
  let finished = false;
  const finish = () => { if (finished) return; finished = true; cleanup(); workspace.ownerDocument.title = previousTitle; view.removeEventListener('afterprint', finish); };
  view.addEventListener('afterprint', finish, { once: true });
  workspace.ownerDocument.title = title.trim() || 'Untitled analysis';
  try { view.print(); } catch (error) { finish(); throw error; }
  // Some browsers return before their preview closes. afterprint owns cleanup;
  // the caller also cleans up on navigation or before another print.
  return finish;
}

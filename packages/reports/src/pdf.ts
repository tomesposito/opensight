import { jsPDF } from 'jspdf';
import { fail, type ReportDefinition } from './model.js';
import { checkText, MAX_PAGES, PT_MM, type Page } from './layout.js';
import { pageDimensions, validateDefinition } from './validation.js';

/** Render only our bounded text/rectangle display list: no HTML, links, fonts or images. */
export function renderPdf(definition: ReportDefinition, layoutResult: readonly Page[]): Uint8Array {
  validateDefinition(definition);
  const [width, height] = pageDimensions(definition);
  const invalid = () => fail('REPORT_INVALID_LAYOUT', '$.pages', 'Expected the bounded display list from layoutReport');
  if (!Array.isArray(layoutResult) || !layoutResult.length || layoutResult.length > MAX_PAGES) invalid();
  let items = 0;
  for (const [i, p] of layoutResult.entries()) {
    if (!p || p.number !== i + 1 || p.totalPages !== layoutResult.length || p.width !== width || p.height !== height || !Array.isArray(p.items) || !p.items.length) invalid();
    items += p.items.length;
    if (items > 250000) fail('REPORT_LIMIT_EXCEEDED', '$.pages', 'At most 250000 drawing items');
    for (const item of p.items) {
      if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y) || item.x < 0 || item.y < 0 || item.x > width || item.y > height) invalid();
      if (item.kind === 'text') {
        if (typeof item.text !== 'string' || item.text.includes('\n') || !item.style || !Number.isFinite(item.style.fontSize) || item.style.fontSize < 8 || item.style.fontSize > 32
          || typeof item.style.bold !== 'boolean' || typeof item.style.italic !== 'boolean' || !/^#[a-fA-F0-9]{6}$/.test(item.style.color)
          || item.x + item.text.length * item.style.fontSize * PT_MM * 0.6 > width + 1e-7) invalid();
        checkText(item.text, '$.pages.text');
      } else if (item.kind === 'rect') {
        if (!Number.isFinite(item.width) || !Number.isFinite(item.height) || item.width <= 0 || item.height <= 0 || item.x + item.width > width + 1e-7 || item.y + item.height > height + 1e-7 || !/^#[a-fA-F0-9]{6}$/.test(item.fill)) invalid();
      } else invalid();
    }
  }
  const pdf = new jsPDF({ orientation: definition.pageSetup.orientation, unit: 'mm', format: [width, height], compress: false, putOnlyUsedFonts: true });
  // Fixed UTC metadata epoch; the caller's report date lives in page content.
  pdf.setCreationDate("D:19700101000000+00'00'");
  // Stable PDF document ID, not a security hash. Reproducible for identical inputs.
  let hash = 2166136261;
  for (const c of JSON.stringify([definition, layoutResult])) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  pdf.setFileId((hash >>> 0).toString(16).padStart(8, '0').repeat(4));
  // Keep report strings in escaped content streams, never library metadata/HTML APIs.
  for (const [i, page] of layoutResult.entries()) {
    if (i) pdf.addPage([width, height], definition.pageSetup.orientation);
    for (const item of page.items) {
      if (item.kind === 'rect') {
        pdf.setFillColor(item.fill); pdf.setDrawColor('#cbd5e1'); pdf.setLineWidth(0.15);
        pdf.rect(item.x, item.y, item.width, item.height, 'FD');
      } else {
        pdf.setFont('courier', item.style.bold ? item.style.italic ? 'bolditalic' : 'bold' : item.style.italic ? 'italic' : 'normal');
        pdf.setFontSize(item.style.fontSize); pdf.setTextColor(item.style.color);
        pdf.text(item.text, item.x, item.y);
      }
    }
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorReducer, emptyDraft, activeSheet, validateDraft,
  referenceLineValid, serializeDraft as serializeAnalysis,
} from '../build/test/authoring.js';
import { rowsToCsv, rowsToSpreadsheetMl, sanitizeSheetName } from '../build/test/visual-export.js';

const edit = (draft, ...actions) => actions.reduce(authorReducer, draft);
const withVisual = () => edit(emptyDraft(), { type: 'assign-with-no-selection', field: 'region', well: 'rows' });
const visual = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);

test('reference-line-add creates a line with defaults on the selected visual', () => {
  const draft = authorReducer(withVisual(), { type: 'reference-line-add' });
  const lines = visual(draft).referenceLines;
  assert.equal(lines.length, 1);
  assert.match(lines[0].id, /^refline-[1-9][0-9]*$/);
  assert.equal(lines[0].value, 0);
  assert.equal(lines[0].label, '');
  assert.equal(lines[0].color, '#c0392b');
  assert.equal(referenceLineValid(lines[0]), true);
  validateDraft(draft);
});

test('reference-line-update changes value, label and color; rejects invalid patches', () => {
  let draft = authorReducer(withVisual(), { type: 'reference-line-add' });
  const id = visual(draft).referenceLines[0].id;
  draft = authorReducer(draft, { type: 'reference-line-update', id, patch: { value: 42.5, label: 'Target', color: '#00ff00' } });
  assert.deepEqual(visual(draft).referenceLines[0], { id, value: 42.5, label: 'Target', color: '#00ff00' });
  const before = visual(draft).referenceLines[0];
  draft = authorReducer(draft, { type: 'reference-line-update', id, patch: { value: NaN } });
  assert.deepEqual(visual(draft).referenceLines[0], before, 'NaN value rejected');
  draft = authorReducer(draft, { type: 'reference-line-update', id, patch: { color: 'red' } });
  assert.deepEqual(visual(draft).referenceLines[0], before, 'non-hex color rejected');
  validateDraft(draft);
});

test('reference-line-remove deletes the line; last removal clears the array', () => {
  let draft = authorReducer(withVisual(), { type: 'reference-line-add' });
  draft = authorReducer(draft, { type: 'reference-line-add' });
  assert.equal(visual(draft).referenceLines.length, 2);
  const [first, second] = visual(draft).referenceLines;
  draft = authorReducer(draft, { type: 'reference-line-remove', id: first.id });
  assert.deepEqual(visual(draft).referenceLines.map(l => l.id), [second.id]);
  draft = authorReducer(draft, { type: 'reference-line-remove', id: second.id });
  assert.equal(visual(draft).referenceLines, undefined, 'empty array removed');
  validateDraft(draft);
});

test('referenceLineValid rejects malformed lines', () => {
  assert.equal(referenceLineValid({ id: 'refline-1', value: 1, label: '', color: '#ffffff' }), true);
  assert.equal(referenceLineValid({ id: 'bad', value: 1, label: '', color: '#ffffff' }), false);
  assert.equal(referenceLineValid({ id: 'refline-1', value: NaN, label: '', color: '#ffffff' }), false);
  assert.equal(referenceLineValid({ id: 'refline-1', value: 1, label: '', color: 'white' }), false);
  assert.equal(referenceLineValid(null), false);
});

test('reference lines serialize into the bundle definition', () => {
  let draft = withVisual();
  draft = authorReducer(draft, { type: 'assign', field: 'revenue', well: 'values' });
  draft = authorReducer(draft, { type: 'reference-line-add' });
  const id = visual(draft).referenceLines[0].id;
  draft = authorReducer(draft, { type: 'reference-line-update', id, patch: { value: 100, label: 'Goal' } });
  const resource = serializeAnalysis(draft);
  const body = Object.values(resource.definition.sheets[0].visuals[0])[0];
  assert.deepEqual(body.opensightReferenceLines, [{ value: 100, label: 'Goal', color: '#c0392b' }]);
});

test('rowsToCsv escapes commas, quotes and newlines', () => {
  const csv = rowsToCsv([
    { region: 'East', revenue: 100 },
    { region: 'West, "coast"', revenue: 200 },
    { region: 'North\nSouth', revenue: null },
  ]);
  assert.equal(csv, 'region,revenue\r\nEast,100\r\n"West, ""coast""",200\r\n"North\nSouth",\r\n');
});

test('rowsToSpreadsheetMl produces valid XML workbook', () => {
  const xml = rowsToSpreadsheetMl([{ region: 'East', revenue: 100 }], 'Sales');
  assertWellFormedXml(xml);
  assert.ok(xml.startsWith('<?xml version="1.0"?>'));
  assert.ok(xml.includes('<Worksheet ss:Name="Sales">'));
  assert.ok(xml.includes('<Data ss:Type="String">region</Data>'));
  assert.ok(xml.includes('<Data ss:Type="Number">100</Data>'));
});

// Strict XML 1.0 well-formedness checker for the export tests below. It parses
// the document (processing instructions, comments, tags, attributes, text) on
// a stack instead of matching substrings, so a test fails whenever the emitted
// workbook is not consumable by an XML parser. No new dependencies: this is a
// small self-contained validator, not a general-purpose XML parser.
const XML_NAME = '[A-Za-z_][\\w.:-]*';
const ENTITY_RE = /^&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/;

function assertWellFormedXml(xml) {
  const stack = [];
  let i = 0;
  let roots = 0;
  const fail = (msg) => { throw new assert.AssertionError({ message: `not well-formed XML at offset ${i}: ${msg}` }); };
  const validChar = (cp) =>
    cp === 0x9 || cp === 0xA || cp === 0xD ||
    (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) ||
    (cp >= 0x10000 && cp <= 0x10FFFF);
  for (const ch of xml) {
    if (!validChar(ch.codePointAt(0))) fail('invalid XML 1.0 character');
  }
  // Every & in text or attribute values must start a valid entity reference.
  const checkEntities = (text) => {
    let p = 0;
    while (p < text.length) {
      if (text[p] === '&') {
        const m = ENTITY_RE.exec(text.slice(p));
        if (!m) fail(`bare & or invalid entity near "${text.slice(Math.max(0, p - 8), p + 8)}"`);
        p += m[0].length;
      } else {
        p++;
      }
    }
  };
  const startTagRe = new RegExp(`^<(${XML_NAME})((?:\\s+${XML_NAME}\\s*=\\s*(?:"[^"]*"|'[^']*'))*)\\s*(/?)>`);
  while (i < xml.length) {
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end === -1) fail('unterminated comment');
      if (xml.slice(i + 4, end).includes('--')) fail('double hyphen inside comment');
      i = end + 3;
    } else if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end === -1) fail('unterminated processing instruction');
      i = end + 2;
    } else if (xml[i] === '<') {
      if (xml.startsWith('</', i)) {
        const m = new RegExp(`^</(${XML_NAME})\\s*>`).exec(xml.slice(i));
        if (!m) fail('malformed end tag');
        const open = stack.pop();
        if (open === undefined) fail('stray end tag');
        if (open !== m[1]) fail(`mismatched end tag: expected </${open}>`);
        if (stack.length === 0) roots++;
        i += m[0].length;
      } else {
        const m = startTagRe.exec(xml.slice(i));
        if (!m) fail('malformed start tag');
        const attrRe = new RegExp(`(${XML_NAME})\\s*=\\s*("[^"]*"|'[^']*')`, 'g');
        const seen = new Set();
        let am;
        while ((am = attrRe.exec(m[2]))) {
          if (seen.has(am[1])) fail(`duplicate attribute ${am[1]}`);
          seen.add(am[1]);
          const val = am[2].slice(1, -1);
          if (val.includes('<')) fail('unescaped < in attribute value');
          checkEntities(val);
        }
        if (m[3] !== '/') stack.push(m[1]);
        else if (stack.length === 0) roots++;
        i += m[0].length;
      }
    } else {
      let p = i;
      while (p < xml.length && xml[p] !== '<') p++;
      checkEntities(xml.slice(i, p));
      i = p;
    }
  }
  if (stack.length) fail(`unclosed element <${stack[stack.length - 1]}>`);
  if (roots !== 1) fail(`expected exactly one root element, found ${roots}`);
}

const worksheetNameAttr = (xml) => {
  const m = /<Worksheet ss:Name="([^"]*)">/.exec(xml);
  assert.ok(m, 'worksheet ss:Name attribute present');
  return m[1];
};
const decodeXmlAttr = (s) => s
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('rowsToSpreadsheetMl escapes quotes in the sheet-name attribute', () => {
  // Exact repro from the issue: a quoted title used to end the attribute early.
  const xml = rowsToSpreadsheetMl([{ region: 'East', revenue: 123 }], 'Revenue "plan"');
  assertWellFormedXml(xml);
  assert.ok(xml.includes('<Worksheet ss:Name="Revenue &quot;plan&quot;">'));
  assert.equal(decodeXmlAttr(worksheetNameAttr(xml)), 'Revenue "plan"');
});

test('rowsToSpreadsheetMl keeps ampersands and unicode well-formed', () => {
  const xml = rowsToSpreadsheetMl(
    [{ region: 'R&D <tag>', revenue: 5, note: 'déjà vu ☃' }],
    'Q3 — R&D "final"',
  );
  assertWellFormedXml(xml);
  assert.equal(decodeXmlAttr(worksheetNameAttr(xml)), 'Q3 — R&D "final"');
  assert.ok(xml.includes('<Data ss:Type="String">R&amp;D &lt;tag&gt;</Data>'));
  assert.ok(xml.includes('déjà vu ☃'));
});

test('rowsToSpreadsheetMl strips invalid XML control characters', () => {
  const xml = rowsToSpreadsheetMl([{ region: 'a\x00b\x07', revenue: 1 }], 'Bad\x01Name\x7F');
  assertWellFormedXml(xml);
  assert.equal(decodeXmlAttr(worksheetNameAttr(xml)), 'BadName');
  assert.ok(xml.includes('<Data ss:Type="String">ab</Data>'));
});

test('sanitizeSheetName enforces Excel worksheet-name rules', () => {
  assert.equal(sanitizeSheetName('Sales'), 'Sales');
  assert.equal(sanitizeSheetName('a'.repeat(40)), 'a'.repeat(31));
  assert.equal(sanitizeSheetName('Q1 [draft]: plan/actual? *final*\\rev'), 'Q1 draft planactual finalrev');
  assert.equal(sanitizeSheetName('   '), 'Sheet1');
  assert.equal(sanitizeSheetName(''), 'Sheet1');
});

test('tooltipVisible toggles via the display action', () => {
  const before = withVisual();
  assert.equal(visual(before).tooltipVisible, true);
  const draft = authorReducer(before, { type: 'display', property: 'tooltipVisible', value: false });
  assert.equal(visual(draft).tooltipVisible, false);
  validateDraft(draft);
  const withMeasure = authorReducer(draft, { type: 'assign', field: 'revenue', well: 'values' });
  const resource = serializeAnalysis(withMeasure);
  const body = Object.values(resource.definition.sheets[0].visuals[0])[0];
  assert.equal(body.chartConfiguration?.tooltip?.tooltipVisibility, 'HIDDEN');
});

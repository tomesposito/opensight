import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorReducer, emptyDraft, activeSheet, validateDraft,
  referenceLineValid, serializeDraft as serializeAnalysis,
} from '../build/test/authoring.js';
import { rowsToCsv, rowsToSpreadsheetMl } from '../build/test/visual-export.js';

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
  assert.ok(xml.startsWith('<?xml version="1.0"?>'));
  assert.ok(xml.includes('<Worksheet ss:Name="Sales">'));
  assert.ok(xml.includes('<Data ss:Type="String">region</Data>'));
  assert.ok(xml.includes('<Data ss:Type="Number">100</Data>'));
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

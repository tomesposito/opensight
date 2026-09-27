import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeEditor } from '../build/test/ThemeEditor.js';
import { Author } from '../build/test/Author.js';
import { LIGHT_THEME, DARK_THEME, themeValid } from '../build/test/themes.js';
import { authorReducer, emptyDraft, serializeDraft, serializeVisual, loadDraft, saveDraft } from '../build/test/authoring.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { parseQsBundle } from '@opensight/bundle-parser';
import { compileVisual } from '../build/test/compiler.js';
const add = () => authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
const visual = d => d.sheets[0].visuals[0];
const compiled = d => compileVisual({ source: 'bundle', path: '$', definition: serializeVisual(visual(d), false), theme: d.theme, rows: [{ region: 'East', revenue: 40 }], bindings: {} });
test('analysis palette, fonts, background and visual override apply independently', () => {
  let d = authorReducer(add(), { type: 'theme', theme: { ...DARK_THEME, fontFamily: 'Georgia, serif' } });
  let c = compiled(d); assert.deepEqual(c.option.color, DARK_THEME.palette); assert.equal(c.option.backgroundColor, DARK_THEME.surface); assert.equal(c.option.textStyle.fontFamily, 'Georgia, serif'); assert.equal(c.option.xAxis.axisLabel.color, DARK_THEME.textColor);
  d = authorReducer(d, { type: 'palette', palette: ['#ff0000', '#00ff00'] }); c = compiled(d); assert.deepEqual(c.option.color, ['#ff0000', '#00ff00']); assert.equal(c.option.textStyle.fontFamily, 'Georgia, serif');
  d = authorReducer(d, { type: 'palette' }); assert.deepEqual(compiled(d).option.color, DARK_THEME.palette);
});
test('themes and overrides round-trip in .qs camelCase JSON without UI chrome or rows', async () => {
  let d = authorReducer(add(), { type: 'theme', theme: structuredClone(DARK_THEME) });
  d = authorReducer(d, { type: 'palette', palette: ['#112233'] }); d = authorReducer(d, { type: 'chrome', mode: 'dark' });
  const resource = serializeDraft(d); assert.deepEqual(resource.definition.opensightTheme, DARK_THEME);
  assert.deepEqual(resource.definition.sheets[0].visuals[0].barChartVisual.opensightPalette, ['#112233']); assert.doesNotMatch(JSON.stringify(resource), /chrome|"rows"/);
  const bundle = await parseQsBundle(await downloadBundleBytes(d)); const restored = importBundle(bundle); assert.deepEqual(restored.theme, d.theme); assert.deepEqual(visual(restored).palette, ['#112233']); assert.deepEqual(exportBundle(restored), bundle);
  const edited = authorReducer(restored, { type: 'theme', theme: structuredClone(LIGHT_THEME) }); assert.deepEqual(exportBundle(edited).members[0].resource.definition.opensightTheme, LIGHT_THEME);
});
test('theme validation rejects active CSS and invalid palettes; unknown imported theme is preserved and reported', () => {
  assert.equal(themeValid({ ...LIGHT_THEME, fontFamily: 'url(https://example.invalid/font)' }), false);
  for (const palette of [[], ['red'], ['#123456;url(x)'], Array(13).fill('#000000')]) {
    assert.equal(authorReducer(add(), { type: 'palette', palette }).sheets[0].visuals[0].palette, undefined);
  }
  const resource = serializeDraft(add()); resource.definition.opensightTheme = { vendorTheme: 'future' };
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] }, imported = importBundle(bundle);
  assert.equal(imported.theme, undefined); assert.match(JSON.stringify(imported.bundle.report), /unsupported definition retained/); assert.deepEqual(exportBundle(imported), bundle);
});
test('NEW LOOK persists separately and theme editor exposes palette, fonts and backgrounds', () => {
  let d = authorReducer(add(), { type: 'theme', theme: structuredClone(DARK_THEME) }); d = authorReducer(d, { type: 'chrome', mode: 'dark' });
  let saved; const storage = { getItem: () => saved ?? null, setItem: (_, value) => { saved = value; } }; saveDraft(d, () => storage); assert.deepEqual(loadDraft(() => storage).draft, d);
  const html = renderToStaticMarkup(createElement(ThemeEditor, { draft: d, visual: visual(d), dispatch() {} }));
  for (const label of ['Analysis theme', 'Analysis font', 'Canvas background', 'Visual background', 'Visual palette override']) assert.ok(html.includes(label));
  assert.match(renderToStaticMarkup(createElement(Author)), /NEW LOOK/);
});

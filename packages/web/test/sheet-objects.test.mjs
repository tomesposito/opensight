import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSheet, authorReducer, emptyDraft, validateDraft, serializeDraft, parseDraft } from '../build/test/authoring.js';
import { authorHistoryReducer, createAuthorHistory } from '../build/test/author-history.js';
import { exportBundle, importBundle, importBundleFile, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { convertDefinition } from '../build/test/definition-converter.js';
import { EMBEDDED_IMAGE_LIMIT, IMAGE_TOO_LARGE, imageFileProblem, imageDataProblem, serializeObject } from '../build/test/sheet-objects.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { SheetObjectCard, SheetObjectProperties } from '../build/test/SheetObjectCard.js';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#166f7a"/></svg>';
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const add = (draft, kind) => authorReducer(draft, kind === 'text' ? { type: 'object-add', kind } : { type: 'object-add', kind, dataUri });
const object = draft => activeSheet(draft).objects.at(-1);
const normalized = draft => draft.sheets.map(s => ({ objects: s.objects?.map(({ id, importedId, ...o }) => o), layout: s.layout.map(({ i, ...p }) => p) }));
for (const kind of ['text', 'image']) {
  test(`${kind}: add, grid move/resize, style, select, remove and history restore exactly`, () => {
    let state = createAuthorHistory(emptyDraft());
    const apply = action => { state = authorHistoryReducer(state, action); validateDraft(state.draft); };
    const initial = state.draft;
    apply(kind === 'text' ? { type: 'object-add', kind } : { type: 'object-add', kind, dataUri });
    const added = state.draft, id = object(added).id;
    assert.equal(activeSheet(added).selectedId, id);
    apply({ type: 'layout', sheetId: 'sheet-1', layout: [{ i: id, x: 2, y: 3, w: 8, h: 6 }] });
    const placed = state.draft;
    apply(kind === 'text' ? { type: 'object-text', id, content: 'Revenue < 20 & growth\nSecond line' } : { type: 'object-image', id, alt: 'Synthetic teal rectangle' });
    apply(kind === 'text' ? { type: 'object-style', id, style: { fontSize: 28, bold: true, italic: true, underline: true, color: '#804000', alignment: 'right' } } : { type: 'object-image', id, keepAspectRatio: false, opacity: 0.6 });
    const styled = state.draft;
    apply({ type: 'remove', id }); assert.equal(activeSheet(state.draft).objects.length, 0); assert.equal(activeSheet(state.draft).layout.length, 0);
    apply({ type: 'undo' }); assert.deepEqual(state.draft, styled);
    apply({ type: 'undo' }); apply({ type: 'undo' }); assert.deepEqual(state.draft, placed);
    apply({ type: 'undo' }); assert.deepEqual(state.draft, added);
    apply({ type: 'undo' }); assert.deepEqual(state.draft, initial);
    for (let i = 0; i < 4; i++) apply({ type: 'redo' }); assert.deepEqual(state.draft, styled);
    apply({ type: 'redo' }); assert.equal(activeSheet(state.draft).objects.length, 0);
  });
}
test('visuals and objects share layout and valid selection, preserving old drafts', () => {
  let draft = add(authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }), 'text');
  draft = add(draft, 'image');
  const before = structuredClone(draft);
  for (const id of activeSheet(draft).layout.map(p => p.i)) { draft = authorReducer(draft, { type: 'select', id }); validateDraft(draft); }
  draft = authorReducer(draft, { type: 'select', id: 'visual-1' });
  draft = authorReducer(draft, { type: 'remove', id: 'visual-1' }); validateDraft(draft); assert.equal(activeSheet(draft).selectedId, 'object-1');
  assert.deepEqual(parseDraft(JSON.stringify(before)), before);
  assert.deepEqual(parseDraft(JSON.stringify(emptyDraft())), emptyDraft());
  assert.equal(authorReducer(draft, { type: 'layout', sheetId: 'sheet-1', layout: [] }), draft);
  assert.equal(authorReducer(draft, { type: 'layout', sheetId: 'sheet-1', layout: activeSheet(draft).layout.map(p => ({ ...p, x: -1 })) }), draft);
});
test('JSON definition and .qs bytes round-trip text formatting and embedded image bytes on multiple sheets', async () => {
  let draft = add(emptyDraft(), 'text');
  draft = authorReducer(draft, { type: 'object-text', id: 'object-1', content: 'Synthetic <report> & “notes”\nLine two' });
  draft = authorReducer(draft, { type: 'object-style', id: 'object-1', style: { fontSize: 32, bold: true, italic: true, underline: true, color: '#168cbb', alignment: 'center' } });
  draft = add(draft, 'image');
  draft = authorReducer(draft, { type: 'object-image', id: 'object-2', opacity: 0.42, alt: 'Generated rectangle', keepAspectRatio: false });
  draft = authorReducer(draft, { type: 'sheet-add' }); draft = add(draft, 'text');
  const resource = serializeDraft(draft), bytes = Buffer.from(JSON.stringify(resource));
  const fromJson = await importBundleFile({ name: 'objects.json', size: bytes.length, arrayBuffer: async () => bytes });
  assert.deepEqual(normalized(fromJson), normalized(draft));
  const zip = await downloadBundleBytes(draft);
  const fromZip = await importBundleFile({ name: 'objects.qs', size: zip.length, arrayBuffer: async () => zip });
  assert.deepEqual(normalized(fromZip), normalized(draft));
  assert.deepEqual(exportBundle(fromZip), exportBundle(draft));
  const sheet = resource.definition.sheets[0];
  assert.deepEqual(sheet.layouts[0].configuration.gridLayout.elements.map(e => e.elementType), ['TEXT_BOX', 'IMAGE']);
  assert.match(sheet.textBoxes[0].content, /&lt;report&gt; &amp;/);
  assert.equal(sheet.images[0].source.opensightDataUri, dataUri);
});
test('editing or removing imported objects patches only those elements and their layouts', () => {
  const original = exportBundle(add(add(emptyDraft(), 'text'), 'image'));
  const raw = original.members[0].resource.definition.sheets[0];
  raw.textBoxes[0].future = { preserved: true }; raw.images[0].future = 42;
  raw.textBoxes.push({ sheetTextBoxId: 'foreign', content: '<script>unsupported</script>' });
  raw.images.push({ sheetImageId: 'remote', source: { customContentConfiguration: { contentUrl: 'https://example.invalid/never-fetch.svg' } } });
  raw.layouts[0].configuration.gridLayout.elements.push({ elementId: 'foreign', elementType: 'TEXT_BOX', columnIndex: 0, columnSpan: 18, rowIndex: 20, rowSpan: 4 });
  let draft = importBundle(original); assert.deepEqual(exportBundle(draft), original);
  assert.ok(draft.bundle.report.flatMap(r => r.messages).some(m => m.includes('remote') && m.includes('read-only')));
  assert.equal(activeSheet(draft).objects.length, 2);
  draft = authorReducer(draft, { type: 'object-text', id: 'object-1', content: 'Edited' });
  draft = authorReducer(draft, { type: 'remove', id: activeSheet(draft).objects.find(o => o.kind === 'image').id });
  const exported = exportBundle(draft).members[0].resource.definition.sheets[0];
  assert.equal(exported.images.length, 1); assert.equal(exported.images[0].sheetImageId, 'remote');
  assert.deepEqual(exported.textBoxes.find(o => o.sheetTextBoxId === 'object-1').future, { preserved: true });
  assert.equal(exported.textBoxes.find(o => o.sheetTextBoxId === 'object-1').opensightText.content, 'Edited');
  assert.ok(exported.layouts[0].configuration.gridLayout.elements.some(e => e.elementId === 'foreign'));
  assert.ok(!exported.layouts[0].configuration.gridLayout.elements.some(e => e.elementId === 'object-2'));
  validateDraft(importBundle(exportBundle(draft)));
});
test('PascalCase sheet TextBoxes and Images convert their supported mapping without touching extension keys', () => {
  const text = serializeObject(object(add(emptyDraft(), 'text'))), image = serializeObject(object(add(emptyDraft(), 'image')));
  const converted = convertDefinition({ DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 'sheet', TextBoxes: [{ SheetTextBoxId: 'object-1', Content: text.content, OpenSightText: text.opensightText }], Images: [{ SheetImageId: 'object-1', Source: { OpenSightDataUri: dataUri }, Scaling: { ScalingType: 'SCALE_TO_FIT' }, ImageContentAltText: image.imageContentAltText, OpenSightOpacity: 1 }] }] });
  assert.deepEqual(converted.sheets[0].textBoxes, [text]); assert.deepEqual(converted.sheets[0].images, [image]);
});
test('named oversize errors, MIME validation and unsafe imported/storage values fail closed', () => {
  assert.equal(imageFileProblem({ type: 'image/svg+xml', size: EMBEDDED_IMAGE_LIMIT + 1 }), IMAGE_TOO_LARGE);
  assert.equal(imageFileProblem({ type: 'image/png', size: EMBEDDED_IMAGE_LIMIT }), undefined);
  assert.match(imageFileProblem({ type: 'text/html', size: 20 }), /IMAGE_TYPE_UNSUPPORTED/);
  assert.equal(imageDataProblem(`data:image/png;base64,${Buffer.alloc(EMBEDDED_IMAGE_LIMIT + 1).toString('base64')}`), IMAGE_TOO_LARGE);
  for (const uri of ['https://example.invalid/a.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,!!!', 'data:image/png;base64,AAAA=']) {
    const draft = emptyDraft(); assert.equal(authorReducer(draft, { type: 'object-add', kind: 'image', dataUri: uri }), draft);
    const stored = add(draft, 'image'); object(stored).dataUri = uri; assert.throws(() => validateDraft(stored));
  }
  let draft = add(emptyDraft(), 'text');
  for (const style of [{ color: 'url(https://example.invalid)' }, { fontSize: NaN }, { alignment: 'invalid' }]) assert.equal(authorReducer(draft, { type: 'object-style', id: 'object-1', style }), draft);
  assert.equal(authorReducer(draft, { type: 'object-text', id: 'object-1', content: 'x'.repeat(20001) }), draft);
});
test('object canvas and Properties expose text formatting, embedded image semantics and keyboard placement', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  for (const kind of ['text', 'image']) {
    const draft = add(emptyDraft(), kind), o = object(draft), actions = [];
    let renderer;
    await act(() => { renderer = create(createElement(SheetObjectCard, { object: o, sheet: activeSheet(draft), selected: false, dispatch: a => actions.push(a) })); });
    const handle = renderer.root.findByProps({ className: 'drag-handle' });
    handle.props.onKeyDown({ key: 'ArrowRight', shiftKey: false, preventDefault() {}, stopPropagation() {} });
    assert.equal(actions.at(-1).layout[0].x, 1);
    handle.props.onKeyDown({ key: 'ArrowDown', shiftKey: true, preventDefault() {}, stopPropagation() {} });
    assert.equal(actions.at(-1).layout[0].h, 5);
    if (kind === 'text') { renderer.root.findByType('textarea').props.onChange({ target: { value: 'Edited in place' } }); assert.equal(actions.at(-1).type, 'object-text'); }
    else assert.equal(renderer.root.findByType('img').props.style.objectFit, 'contain');
    await act(() => renderer.unmount());
    const html = renderToStaticMarkup(createElement(SheetObjectProperties, { object: o, draft, dispatch() {} }));
    assert.match(html, /Object width/); assert.match(html, /Remove selected object/);
    assert.match(html, kind === 'text' ? /Text hyperlinks and parameters-in-text are not supported/ : /Remote image URLs are unavailable/);
  }
});
test('Insert and Objects actions are native keyboard buttons with actual callbacks and an honest no-canvas reason', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const draft = add(emptyDraft(), 'text'), actions = [];
  const props = { draft, dispatch: a => actions.push(a), fit: true, onFit() {}, onJson() {}, onBundle() {}, onImport() {} };
  let renderer;
  await act(() => { renderer = create(createElement(AuthorToolbar, props)); });
  const button = label => renderer.root.findAllByType('button').find(b => b.children.join('') === label);
  for (const label of ['Add Text', 'Add Image', 'Text box 1', 'Remove selected object', 'Format Object', 'Placement', 'Style']) {
    assert.ok(button(label)); assert.equal(button(label).props['aria-disabled'], false); assert.equal(button(label).props.disabled, undefined);
  }
  button('Add Text').props.onClick(); assert.deepEqual(actions.at(-1), { type: 'object-add', kind: 'text' });
  button('Text box 1').props.onClick(); assert.deepEqual(actions.at(-1), { type: 'select', id: 'object-1' });
  button('Remove selected object').props.onClick(); assert.deepEqual(actions.at(-1), { type: 'remove', id: 'object-1' });
  await act(() => renderer.update(createElement(AuthorToolbar, { ...props, dataAvailable: false })));
  for (const label of ['Add Text', 'Add Image']) { assert.equal(button(label).props['aria-disabled'], true); assert.match(button(label).props.title, /NO_SHEET_CANVAS/); }
  await act(() => renderer.unmount());
});

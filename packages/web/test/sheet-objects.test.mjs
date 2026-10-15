import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSheet, authorReducer, emptyDraft, validateDraft, serializeDraft, parseDraft } from '../build/test/authoring.js';
import { authorHistoryReducer, createAuthorHistory } from '../build/test/author-history.js';
import { exportBundle, importBundle, importBundleFile, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { convertDefinition } from '../build/test/definition-converter.js';
import { EMBEDDED_IMAGE_LIMIT, IMAGE_TOO_LARGE, LINK_URL_INVALID, defaultTextStyle, imageFileProblem, imageDataProblem, importObjects, linkUrlProblem, resolveTextParameters, serializeObject, sheetObjectValid } from '../build/test/sheet-objects.js';
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
    assert.match(html, kind === 'text' ? /Hyperlink/ : /Remote image URLs are unavailable/);
    if (kind === 'text') { assert.match(html, /Insert parameter/); assert.doesNotMatch(html, /not supported yet/); }
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
test('text-box hyperlinks validate fail-closed and the object-link reducer keeps only valid URLs', () => {
  assert.equal(linkUrlProblem(undefined), undefined);
  assert.equal(LINK_URL_INVALID.split(':')[0], 'LINK_URL_INVALID');
  for (const url of ['https://example.com', 'http://example.com/a?b=c#d', 'https://example.com:8443/x']) assert.equal(linkUrlProblem(url), undefined);
  for (const url of ['', 'notaurl', 'relative/path', 'ftp://example.com/x', 'javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'https://exa mple.com', 'https://example.com\nx', 'x'.repeat(2049)]) assert.match(linkUrlProblem(url), /LINK_URL_INVALID/);
  let draft = add(emptyDraft(), 'text');
  draft = authorReducer(draft, { type: 'object-link', id: 'object-1', linkUrl: 'https://example.com/docs' });
  assert.equal(object(draft).linkUrl, 'https://example.com/docs');
  draft = authorReducer(draft, { type: 'object-link', id: 'object-1', linkUrl: '  https://example.com/trimmed  ' });
  assert.equal(object(draft).linkUrl, 'https://example.com/trimmed');
  draft = authorReducer(draft, { type: 'object-link', id: 'object-1', linkUrl: '   ' });
  assert.equal(object(draft).linkUrl, undefined);
  draft = authorReducer(draft, { type: 'object-link', id: 'object-1', linkUrl: 'https://example.com/ok' });
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'relative/path']) assert.equal(authorReducer(draft, { type: 'object-link', id: 'object-1', linkUrl: bad }), draft);
  assert.equal(object(draft).linkUrl, 'https://example.com/ok');
  assert.equal(authorReducer(draft, { type: 'object-link', id: 'object-999', linkUrl: 'https://example.com' }), draft);
  const withImage = add(draft, 'image');
  assert.deepEqual(authorReducer(withImage, { type: 'object-link', id: 'object-2', linkUrl: 'https://example.com' }), withImage);
  const tampered = add(emptyDraft(), 'text'); object(tampered).linkUrl = 'javascript:alert(1)';
  assert.throws(() => validateDraft(tampered));
  const extraKey = add(emptyDraft(), 'text'); object(extraKey).linkUrl = 'https://example.com';
  object(extraKey).evil = true; assert.throws(() => validateDraft(extraKey));
  assert.ok(sheetObjectValid({ id: 'object-1', kind: 'text', content: 'x', style: defaultTextStyle(), linkUrl: 'https://example.com' }));
});
test('text-box hyperlinks serialize to a native anchor and round-trip through opensightText', () => {
  let draft = add(emptyDraft(), 'text');
  draft = authorReducer(draft, { type: 'object-text', id: 'object-1', content: 'See <docs> & notes' });
  draft = authorReducer(draft, { type: 'object-link', id: 'object-1', linkUrl: 'https://example.com/a?b=c' });
  const serialized = serializeObject(object(draft));
  assert.match(serialized.content, /<a href="https:\/\/example\.com\/a\?b=c">See &lt;docs&gt; &amp; notes<\/a>/);
  assert.equal(serialized.opensightText.linkUrl, 'https://example.com/a?b=c');
  const reimported = importBundle(exportBundle(draft));
  assert.equal(activeSheet(reimported).objects[0].linkUrl, 'https://example.com/a?b=c');
  assert.deepEqual(exportBundle(reimported), exportBundle(draft));
  const noLink = add(emptyDraft(), 'text');
  const plain = serializeObject(object(noLink));
  assert.doesNotMatch(plain.content, /<a href/);
  assert.equal(plain.opensightText.linkUrl, undefined);
});
test('invalid imported hyperlinks are discarded with a message; valid ones import', () => {
  const messages = []; let n = 0;
  const objs = importObjects({ textBoxes: [
    { sheetTextBoxId: 't1', content: '<text-box/>', opensightText: { content: 'Good', style: defaultTextStyle(), linkUrl: 'https://example.com/ok' } },
    { sheetTextBoxId: 't2', content: '<text-box/>', opensightText: { content: 'Bad', style: defaultTextStyle(), linkUrl: 'javascript:alert(1)' } },
  ] }, () => `object-${++n}`, messages);
  assert.equal(objs.length, 2);
  assert.equal(objs[0].linkUrl, 'https://example.com/ok');
  assert.equal(objs[1].linkUrl, undefined);
  assert.ok(messages.some(m => m.includes('t2') && m.includes('hyperlink')));
});
test('resolveTextParameters substitutes $name placeholders against current parameter values', () => {
  const params = [{ name: 'Region', values: ['East'] }, { name: 'Years', values: [2024, 2025] }, { name: 'Empty', values: [] }];
  assert.equal(resolveTextParameters('Sales in $Region for $Years.', params), 'Sales in East for 2024, 2025.');
  assert.equal(resolveTextParameters('Unknown $Nope stays literal.', params), 'Unknown $Nope stays literal.');
  assert.equal(resolveTextParameters('Nothing: $Empty.', params), 'Nothing: .');
  assert.equal(resolveTextParameters('Costs $100 and $9lives untouched.', params), 'Costs $100 and $9lives untouched.');
  assert.equal(resolveTextParameters('$Region$Years', params), 'East2024, 2025');
  assert.equal(resolveTextParameters('No placeholders here.', params), 'No placeholders here.');
});
test('canvas card shows the hyperlink row only when a link is set', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const draft = add(emptyDraft(), 'text'), plain = object(draft);
  let renderer;
  await act(() => { renderer = create(createElement(SheetObjectCard, { object: plain, sheet: activeSheet(draft), selected: false, dispatch() {} })); });
  assert.equal(renderer.root.findAllByType('a').length, 0);
  await act(() => renderer.unmount());
  const linked = { ...plain, linkUrl: 'https://example.com/x' };
  await act(() => { renderer = create(createElement(SheetObjectCard, { object: linked, sheet: activeSheet(draft), selected: false, dispatch() {} })); });
  const anchor = renderer.root.findByType('a');
  assert.equal(anchor.props.href, 'https://example.com/x');
  assert.equal(anchor.props.target, '_blank');
  assert.equal(anchor.props.rel, 'noopener noreferrer');
  await act(() => renderer.unmount());
});
test('text-box Properties edits hyperlinks and inserts $parameter placeholders', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const p = (name, values = ['East']) => ({ name, type: 'string', multiple: false, values, defaultValues: values });
  const draft = authorReducer(add(emptyDraft(), 'text'), { type: 'parameter-add', parameter: p('Region') });
  const o = object(draft), actions = [];
  let renderer;
  await act(() => { renderer = create(createElement(SheetObjectProperties, { object: o, draft, dispatch: a => actions.push(a) })); });
  const hyper = renderer.root.findByProps({ children: 'Hyperlink' });
  await act(() => hyper.props.onClick());
  const input = renderer.root.findByProps({ 'aria-label': 'Hyperlink URL' });
  await act(() => input.props.onChange({ target: { value: 'javascript:alert(1)' } }));
  assert.match(String(renderer.root.findByProps({ role: 'alert' }).props.children), /LINK_URL_INVALID/);
  await act(() => input.props.onChange({ target: { value: 'https://example.com/docs' } }));
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
  await act(() => renderer.root.findByProps({ children: 'Apply' }).props.onClick());
  assert.deepEqual(actions.at(-1), { type: 'object-link', id: o.id, linkUrl: 'https://example.com/docs' });
  const insert = renderer.root.findByProps({ children: 'Insert parameter' });
  await act(() => insert.props.onClick());
  await act(() => renderer.root.findByProps({ children: '$Region' }).props.onClick());
  assert.equal(actions.at(-1).type, 'object-text');
  assert.ok(actions.at(-1).content.includes('$Region'));
  await act(() => renderer.unmount());
});

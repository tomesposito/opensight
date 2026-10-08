import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHOR_SHORTCUTS, listenForAuthorShortcuts, shortcutForEvent, shortcutKeys } from '../build/test/keyboard-shortcuts.js';

function key(options = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...options }).map(([name, value]) => [name, { value }])));
  return event;
}
const input = tag => ({ nodeType: 1, closest: selector => selector.includes(tag) ? {} : null });

for (const shortcut of AUTHOR_SHORTCUTS) test(`${shortcut.id}: matches its registered keys and renders a combo`, () => {
  if (shortcut.modifier) {
    for (const modifier of ['metaKey', 'ctrlKey']) for (const value of [shortcut.key, shortcut.key.toUpperCase()]) {
      assert.equal(shortcutForEvent(key({ key: value, [modifier]: true }))?.id, shortcut.id);
    }
    assert.deepEqual(shortcutKeys(shortcut), ['Cmd/Ctrl', shortcut.key.toUpperCase()]);
  } else {
    assert.equal(shortcutForEvent(key({ key: shortcut.key, shiftKey: shortcut.key === '?' }))?.id, shortcut.id);
    assert.deepEqual(shortcutKeys(shortcut), shortcut.key === '?' ? ['Shift', '/'] : ['Esc']);
  }
});

test('question mark works by character and Shift+/; bare slash and extra modifiers do not match', () => {
  for (const options of [{ key: '?' }, { key: '?', shiftKey: true }, { key: '/', shiftKey: true }]) {
    assert.equal(shortcutForEvent(key(options))?.id, 'shortcuts-help');
  }
  for (const options of [
    { key: '/' }, { key: 's' }, { key: 's', ctrlKey: true, metaKey: true },
    { key: 's', ctrlKey: true, shiftKey: true }, { key: '?', ctrlKey: true },
    { key: 'k', metaKey: true, altKey: true }, { key: 'f', ctrlKey: true, altKey: true },
    { key: 'Escape', shiftKey: true }, { key: 'Escape', metaKey: true },
  ]) assert.equal(shortcutForEvent(key(options)), undefined, JSON.stringify(options));
});

test('all actions ignore editable targets, ancestors, text nodes and shadow event paths; Escape passes through', () => {
  const inherited = { nodeType: 1, closest: () => ({}) };
  for (const target of [input('input'), input('textarea'), input('select'), inherited,
    { nodeType: 1, isContentEditable: true }, { parentElement: inherited }]) {
    for (const shortcut of AUTHOR_SHORTCUTS) {
      const event = key({ target, key: shortcut.key, ctrlKey: !!shortcut.modifier, shiftKey: shortcut.key === '?' });
      assert.equal(shortcutForEvent(event)?.id, shortcut.id === 'close-dialog' ? shortcut.id : undefined);
    }
  }
  assert.equal(shortcutForEvent(key({ key: 's', ctrlKey: true, composedPath: () => [input('input')] })), undefined);
});

test('consumed events, repeats and IME keydown variants never run actions', () => {
  for (const shortcut of AUTHOR_SHORTCUTS) for (const blocked of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
    assert.equal(shortcutForEvent(key({ key: shortcut.key, ctrlKey: !!shortcut.modifier, ...blocked })), undefined);
  }
  const consumed = key({ key: '?', shiftKey: true }); consumed.preventDefault();
  assert.equal(shortcutForEvent(consumed), undefined);
});

test('document dispatch handles every action, reserves the future palette and preserves native Escape', () => {
  const document = new EventTarget(); document.querySelector = () => null;
  const calls = [];
  const actions = Object.fromEntries(AUTHOR_SHORTCUTS.filter(s => !s.native).map(s => [s.id, () => calls.push(s.id)]));
  const cleanup = listenForAuthorShortcuts(document, actions);
  for (const shortcut of AUTHOR_SHORTCUTS) {
    const event = key({ key: shortcut.key, ctrlKey: !!shortcut.modifier });
    document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, !shortcut.native, shortcut.id);
  }
  assert.deepEqual(calls, ['save-draft', 'focus-search', 'toggle-command-palette', 'shortcuts-help']);
  assert.equal(AUTHOR_SHORTCUTS.find(s => s.id === 'toggle-command-palette').coming, 'coming in #53');
  cleanup(); document.dispatchEvent(key({ key: 's', ctrlKey: true }));
  assert.equal(calls.length, 4);
});

test('composition lifecycle, window blur, modal guards and cleanup apply to the document listener', () => {
  const document = new EventTarget(), view = new EventTarget();
  document.defaultView = view; document.querySelector = () => null;
  let saved = 0;
  const cleanup = listenForAuthorShortcuts(document, { 'save-draft': () => saved++ });
  const save = () => { const event = key({ key: 's', metaKey: true }); document.dispatchEvent(event); return event.defaultPrevented; };
  document.dispatchEvent(new Event('compositionstart')); assert.equal(save(), false);
  document.dispatchEvent(new Event('compositionend')); assert.equal(save(), true);
  document.dispatchEvent(new Event('compositionstart')); view.dispatchEvent(new Event('blur')); assert.equal(save(), true);
  document.querySelector = () => ({}); assert.equal(save(), false);
  document.querySelector = () => null;
  cleanup(); assert.equal(save(), false); assert.equal(saved, 2);
});

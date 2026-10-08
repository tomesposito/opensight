type Shortcut = {
  id: string;
  label: string;
  group: 'Analysis' | 'Navigation' | 'Help';
  key: string;
  modifier?: boolean;
  native?: boolean;
};

/** The single source for Author key matching and the shortcuts help dialog. */
export const AUTHOR_SHORTCUTS = [
  { id: 'save-draft', label: 'Save draft', group: 'Analysis', key: 's', modifier: true },
  { id: 'focus-search', label: 'Focus search', group: 'Navigation', key: 'f', modifier: true },
  { id: 'toggle-command-palette', label: 'Open command palette', group: 'Navigation', key: 'k', modifier: true },
  { id: 'shortcuts-help', label: 'Keyboard shortcuts', group: 'Help', key: '?' },
  // Native <dialog> cancel and the existing non-modal panel/menu handlers own
  // dismissal and focus restoration. Never consume Escape ahead of them.
  { id: 'close-dialog', label: 'Close dialog', group: 'Help', key: 'Escape', native: true },
] as const satisfies readonly Shortcut[];

export type AuthorShortcutId = typeof AUTHOR_SHORTCUTS[number]['id'];
export type AuthorShortcutActions = Record<Exclude<AuthorShortcutId, 'close-dialog'>, () => void>;

export function shortcutKeys(shortcut: Shortcut): string[] {
  if (shortcut.modifier) return ['Cmd/Ctrl', shortcut.key.toUpperCase()];
  return shortcut.key === '?' ? ['Shift', '/'] : [shortcut.key === 'Escape' ? 'Esc' : shortcut.key];
}

function isTypingTarget(target: EventTarget | null): boolean {
  // Structural checks also work across document realms and in the Node tests.
  const node = target as Node | null;
  const element = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement;
  return !!(element?.isContentEditable || element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

export function shortcutForEvent(event: KeyboardEvent): typeof AUTHOR_SHORTCUTS[number] | undefined {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey) return;
  if (event.key !== 'Escape' && [event.target, ...(event.composedPath?.() ?? [])].some(isTypingTarget)) return;
  return AUTHOR_SHORTCUTS.find((shortcut: Shortcut) => {
    if (shortcut.modifier) return !!event.metaKey !== !!event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === shortcut.key;
    if (event.metaKey || event.ctrlKey) return false;
    if (shortcut.key === '?') return event.key === '?' || (event.key === '/' && event.shiftKey);
    return !event.shiftKey && event.key === shortcut.key;
  });
}

/** Author binds its actions while mounted; the shared palette binds only K.
 * Composition tracking also covers IMEs
 * whose keydown events omit isComposing. Return a complete listener cleanup. */
export function listenForAuthorShortcuts(document: Document, actions: Partial<AuthorShortcutActions>): () => void {
  let composing = false;
  const start = () => { composing = true; };
  const end = () => { composing = false; };
  const keydown = (event: KeyboardEvent) => {
    if (composing) return;
    const shortcut = shortcutForEvent(event);
    if (!shortcut || shortcut.id === 'close-dialog') return;
    const action = actions[shortcut.id];
    if (!action) return;
    // Do not save the background analysis, move focus behind a modal, or stack
    // help over another modal. Escape remains the browser's cancel action.
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    action();
  };
  document.addEventListener('keydown', keydown);
  document.addEventListener('compositionstart', start);
  document.addEventListener('compositionend', end);
  document.defaultView?.addEventListener('blur', end);
  return () => {
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('compositionstart', start);
    document.removeEventListener('compositionend', end);
    document.defaultView?.removeEventListener('blur', end);
  };
}

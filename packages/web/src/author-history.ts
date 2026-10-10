import { authorReducer, type AuthorAction, type AuthorDraft } from './authoring.js';

export const AUTHOR_HISTORY_LIMIT = 50;

/** A reversible command stores the reducer's complete immutable result and
 * inverse. This also restores dependent layout, selection, and action mappings
 * when removing a visual. Redo never reruns an operation against new selection. */
export interface AuthorCommand {
  operation: AuthorAction['type'];
  forward: AuthorDraft;
  inverse: AuthorDraft;
}
export interface AuthorHistory {
  draft: AuthorDraft;
  undo: readonly AuthorCommand[];
  redo: readonly AuthorCommand[];
}
export type AuthorHistoryAction = AuthorAction | { type: 'undo' } | { type: 'redo' };
export const createAuthorHistory = (draft: AuthorDraft): AuthorHistory => ({ draft, undo: [], redo: [] });

// Chrome is a user preference, not analysis content. Selection changes do not
// consume history, but replay restores the command's sheet/visual context.
const restore = (snapshot: AuthorDraft, current: AuthorDraft): AuthorDraft => {
  const { chrome: _chrome, ...content } = snapshot;
  return current.chrome === undefined ? content : { ...content, chrome: current.chrome };
};

export function authorHistoryReducer(state: AuthorHistory, action: AuthorHistoryAction): AuthorHistory {
  if (action.type === 'undo') {
    const command = state.undo.at(-1);
    return command ? { draft: restore(command.inverse, state.draft), undo: state.undo.slice(0, -1), redo: [...state.redo, command] } : state;
  }
  if (action.type === 'redo') {
    const command = state.redo.at(-1);
    return command ? { draft: restore(command.forward, state.draft), undo: [...state.undo, command], redo: state.redo.slice(0, -1) } : state;
  }
  const draft = authorReducer(state.draft, action);
  // Imports, source replacement, opening/deleting/copying an analysis are
  // document boundaries. Never allow history to reach the previous document.
  if (action.type === 'import') return createAuthorHistory(draft);
  if (draft === state.draft || JSON.stringify(draft) === JSON.stringify(state.draft)) return state;
  if (action.type === 'select' || action.type === 'sheet-select' || action.type === 'chrome') return { ...state, draft };
  const command: AuthorCommand = { operation: action.type, forward: draft, inverse: state.draft };
  return { draft, undo: [...state.undo, command].slice(-AUTHOR_HISTORY_LIMIT), redo: [] };
}

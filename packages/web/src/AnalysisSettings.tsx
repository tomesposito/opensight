import { useId, useLayoutEffect, useRef, useState, type Dispatch } from 'react';
import { analysisSettingsError, type AuthorAction, type AuthorDraft } from './authoring.js';
import { DARK_THEME, LIGHT_THEME } from './themes.js';
import { AuthorMenuItem } from './AuthorMenuItem.js';

export function AnalysisSettings({ draft, dispatch, onClose }: { draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; onClose: () => void }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(draft.title), [description, setDescription] = useState(draft.description ?? '');
  const [preset, setPreset] = useState('current'), [error, setError] = useState('');
  const theme = preset === 'light' ? LIGHT_THEME : preset === 'dark' ? DARK_THEME : draft.theme;
  useLayoutEffect(() => {
    const dialog = ref.current, previous = dialog?.ownerDocument.activeElement;
    dialog?.showModal(); dialog?.querySelector('input')?.select();
    return () => {
      dialog?.close();
      if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="analysis-file-dialog analysis-settings-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      const problem = analysisSettingsError({ title, description, theme });
      if (problem) { setError(problem); return; }
      dispatch({ type: 'analysis-settings', title, description, theme }); onClose();
    }}>
      <h2 id={`${id}-title`}>Analysis Settings</h2>
      <p id={`${id}-help`}>Settings belong to this analysis and are saved on this device. Apply changes together; Undo restores the previous settings.</p>
      <label>Analysis name<input autoFocus value={title} maxLength={256} onChange={event => setTitle(event.target.value)} /></label>
      <label>Description<textarea value={description} rows={3} maxLength={4000} onChange={event => setDescription(event.target.value)} /></label>
      <label>Analysis theme<select aria-label="Analysis theme" value={preset} onChange={event => setPreset(event.target.value)}>
        <option value="current">Keep current theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option>
      </select></label>
      <div className="settings-palette" aria-label="Analysis palette preview">{(theme ?? LIGHT_THEME).palette.map((color, index) => <span key={index} style={{ backgroundColor: color }} title={color} />)}</div>
      <p>The theme sets chart colors, font and canvas background. Per-visual overrides and imported secondary resource themes remain in effect. Use Edit → Themes for custom colors and fonts.</p>
      <p>Name, description and theme are included in definition downloads. Description and theme use OpenSight extensions.</p>
      <AuthorMenuItem label="Locale and date-format defaults" reason="Analysis-wide locale and date-format defaults are not supported yet. Date grouping remains UTC; this dialog does not change date rendering." />
      <AuthorMenuItem label="Sharing and permissions" reason="Sharing and permissions need a saved hosted analysis and hosted API integration. Device-local settings do not grant access." />
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="submit" disabled={!title.trim()}>Apply settings</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </dialog>;
}

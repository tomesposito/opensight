import { useId, useRef, useState } from 'react';
import type { AuthorDataset } from './authoring.js';
import { closestFields, fieldSearchParts, fieldToken, resolveFieldSearch, searchFields } from './field-search.js';

/** Same combobox/listbox and keyboard conventions as GlobalSearch. */
export function FieldSearchInput({ dataset, value, onChange }: { dataset?: AuthorDataset; value: string; onChange: (text: string) => void }) {
  const id = useId(), input = useRef<HTMLInputElement>(null), composing = useRef(false);
  const [selected, setSelected] = useState(0), [focused, setFocused] = useState(false);
  const parts = fieldSearchParts(value), role = parts.length > 1 ? 'dimension' : 'measure';
  const token = parts.at(-1)!.trim().replace(/^\[/, '').replace(/\]$/, '').replaceAll(']]', ']');
  const shown = closestFields(token, searchFields(dataset, role));
  const active = Math.min(selected, Math.max(0, shown.length - 1));
  const expanded = focused && shown.length > 0 && parts.length <= 2;
  const result = value.trim() ? resolveFieldSearch(value, dataset) : undefined;
  const change = (text: string) => { onChange(text); setSelected(0); };
  const pick = (name: string) => {
    change(`${parts.length > 1 ? `${parts[0]!.trim()} by ` : ''}${fieldToken(name)}`);
    setFocused(false); input.current?.focus();
  };
  return <section className="field-search" aria-label="Create from fields">
    <label htmlFor={`${id}-input`}>Explore fields (optional)</label>
    <input ref={input} id={`${id}-input`} type="text" role="combobox" autoComplete="off" spellCheck={false} maxLength={1024}
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined}
      aria-activedescendant={expanded ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`}
      placeholder="[revenue] by [region]" value={value}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={event => { change(event.target.value); setFocused(true); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setFocused(true);
          if (shown.length) setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
        } else if (event.key === 'Enter' && expanded) {
          event.preventDefault(); if (!event.repeat && shown[active]) pick(shown[active].name);
        } else if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setFocused(false); }
      }} />
    {expanded && <ul id={`${id}-results`} role="listbox" aria-label={`Closest ${role} fields`}>
      {shown.map((field, index) => <li key={`${field.name}-${index}`} id={`${id}-option-${index}`} role="option" aria-selected={active === index}
        className="search-row" onPointerDown={event => event.preventDefault()} onClick={() => pick(field.name)}>
        <span className="search-name">{field.name}</span><small>{field.type} · {field.role}</small>
      </li>)}
    </ul>}
    <p id={`${id}-help`}>One numeric measure, optionally by one dimension. ↑↓ Navigate · Enter Pick · Esc Close suggestions. Fields only; no AI.</p>
    {result && (result.ok ? <div className="field-search-result"><p role="status">SUM {result.value.measure.name}{result.value.dimension ? ` by ${result.value.dimension.name} → Bar chart` : ' → KPI'}</p>
      {!result.value.dimension && searchFields(dataset, 'dimension').length > 0 && <button type="button" onClick={() => { change(`${fieldToken(result.value.measure.name)} by `); input.current?.focus(); setFocused(true); }}>Add by dimension</button>}
    </div> : <p role="alert">{result.message}</p>)}
  </section>;
}

import { fieldGroup, type DataField } from './authoring.js';

const TYPES: Record<string, { glyph: string; label: string }> = {
  INTEGER: { glyph: '#', label: 'Integer' },
  DECIMAL: { glyph: '0.0', label: 'Decimal' },
  STRING: { glyph: 'Abc', label: 'Text' },
  DATETIME: { glyph: '▣', label: 'Date and time' },
  BOOLEAN: { glyph: 'T/F', label: 'Boolean' },
};

export function FieldIcon({ field, id, pill = false }: { field: DataField; id?: string; pill?: boolean }) {
  const calculated = fieldGroup(field) === 'Calculated';
  const geography = !calculated && fieldGroup(field) === 'Geography';
  const type = TYPES[field.type] ?? { glyph: '?', label: `Unknown type (${field.type})` };
  const label = calculated ? 'Calculated field' : geography ? `Geography · ${type.label}` : type.label;
  return <span id={id} className="field-icon" role="img" aria-label={label} title={label}>
    {calculated ? 'ƒ' : geography ? <svg viewBox="0 0 20 24" aria-hidden="true">
      <path d="M10 22S2 14 2 10a8 8 0 0 1 16 0c0 4-8 12-8 12Z" />
      <circle cx="10" cy="10" r="5" /><path d="M5 10h10M10 5c-3 3-3 7 0 10M10 5c3 3 3 7 0 10" />
    </svg> : field.type === 'DATETIME' ? <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="13.5" rx="1" /><path d="M6 2v5M14 2v5M3 9h14M6 12h2M11 12h2M6 15h2" />
    </svg> : pill && (field.type === 'INTEGER' || field.type === 'DECIMAL') ? '#' : type.glyph}
  </span>;
}

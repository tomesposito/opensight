import type { PrepColumn, PrepStep } from '@opensight/bundle-parser/prep';

export function PrepTypeIcon({ type }: { type: PrepColumn['type'] }) {
  return <span className={`prep-type-icon type-${type.toLowerCase()}`} role="img" aria-label={type} title={type}>{({ STRING: '▱', INTEGER: '#', DECIMAL: '#', DATETIME: '▦', BOOLEAN: '◐' })[type]}</span>;
}
/** Intersection/lobes are drawn directly so the selected join has no external asset. */
export function PrepJoinIcon({ type }: { type: Extract<PrepStep, { kind: 'join' }>['config']['joinType'] }) {
  return <svg width="28" height="18" viewBox="0 0 28 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25">
    {(type === 'left' || type === 'full') && <path d="M14 3.8a6.5 6.5 0 1 0 0 10.4 6.5 6.5 0 0 1 0-10.4Z" fill="currentColor" stroke="none" />}
    {(type === 'right' || type === 'full') && <path d="M14 3.8a6.5 6.5 0 1 1 0 10.4 6.5 6.5 0 0 0 0-10.4Z" fill="currentColor" stroke="none" />}
    <path d="M14 3.8a6.5 6.5 0 0 1 0 10.4 6.5 6.5 0 0 1 0-10.4Z" fill="currentColor" stroke="none" />
    <circle cx="10" cy="9" r="6.5" /><circle cx="18" cy="9" r="6.5" />
  </svg>;
}
export function PrepStepIcon({ kind }: { kind: PrepStep['kind'] }) {
  return <span aria-hidden="true">{({ calculate: 'ƒ', changeType: '⇄', rename: '✎', select: '⊞', append: '⊟', join: '⋈', aggregate: 'Σ', filter: '▽', pivot: '↱', unpivot: '↳' })[kind]}</span>;
}

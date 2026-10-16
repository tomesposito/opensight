import { useId } from 'react';

// The OpenSight brand mark: four arcs in the brand diagonal gradient
// (sky #38BDF8 → blue #3B82F6 → violet #6D3BFF). Rendered as inline SVG so
// the gradient stays self-contained; the gradient id is unique per
// instance so several marks on one page never collide.
export function BrandMark({ size = 20 }: { size?: number }) {
  const gradientId = `brand-g-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const ref = `url(#${gradientId})`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#38BDF8" />
          <stop offset="0.5" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#6D3BFF" />
        </linearGradient>
      </defs>
      <path d="M 58.28 19.09 A 32 32 0 0 1 80.91 41.72" fill="none" stroke={ref} strokeWidth="13" strokeLinecap="round" />
      <path d="M 80.91 58.28 A 32 32 0 0 1 58.28 80.91" fill="none" stroke={ref} strokeWidth="13" strokeLinecap="round" />
      <path d="M 41.72 80.91 A 32 32 0 0 1 19.09 58.28" fill="none" stroke={ref} strokeWidth="13" strokeLinecap="round" />
      <path d="M 19.09 41.72 A 32 32 0 0 1 41.72 19.09" fill="none" stroke={ref} strokeWidth="13" strokeLinecap="round" />
    </svg>
  );
}

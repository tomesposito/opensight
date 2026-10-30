import { useId } from 'react';

// The OpenSight brand mark: four filled sparkle arms in the brand diagonal
// gradient (sky #38BDF8 → blue #3B82F6 → violet #6D3BFF), redrawn
// 2026-10-30 to match the approved brand sheets (filled arms, four-point
// star center hole). One compound path keeps the gradient fixed across the
// whole mark; the gradient id is unique per instance so several marks on
// one page never collide. The path is inset to the footprint the previous
// arc mark occupied, so header sizing is unchanged.
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
      <path d="M 34.2851 0 L 44.2 0 C 45.5807 0 46.7 1.1193 46.7 2.5 L 46.7 6.5 C 46.7 28.7018 28.7018 46.7 6.5 46.7 L 2.5 46.7 C 1.1193 46.7 0 45.5807 0 44.2 L 0 34.2851 C 0 33.398 0.6463 32.6432 1.5227 32.5066 C 17.4905 30.0171 30.0171 17.4905 32.5066 1.5227 C 32.6432 0.6463 33.398 0 34.2851 0 Z M 100 34.2851 L 100 44.2 C 100 45.5807 98.8807 46.7 97.5 46.7 L 93.5 46.7 C 71.2982 46.7 53.3 28.7018 53.3 6.5 L 53.3 2.5 C 53.3 1.1193 54.4193 0 55.8 0 L 65.7149 0 C 66.602 0 67.3568 0.6463 67.4934 1.5227 C 69.9829 17.4905 82.5095 30.0171 98.4773 32.5066 C 99.3537 32.6432 100 33.398 100 34.2851 Z M 65.7149 100 L 55.8 100 C 54.4193 100 53.3 98.8807 53.3 97.5 L 53.3 93.5 C 53.3 71.2982 71.2982 53.3 93.5 53.3 L 97.5 53.3 C 98.8807 53.3 100 54.4193 100 55.8 L 100 65.7149 C 100 66.602 99.3537 67.3568 98.4773 67.4934 C 82.5095 69.9829 69.9829 82.5095 67.4934 98.4773 C 67.3568 99.3537 66.602 100 65.7149 100 Z M 0 65.7149 L 0 55.8 C 0 54.4193 1.1193 53.3 2.5 53.3 L 6.5 53.3 C 28.7018 53.3 46.7 71.2982 46.7 93.5 L 46.7 97.5 C 46.7 98.8807 45.5807 100 44.2 100 L 34.2851 100 C 33.398 100 32.6432 99.3537 32.5066 98.4773 C 30.0171 82.5095 17.4905 69.9829 1.5227 67.4934 C 0.6463 67.3568 0 66.602 0 65.7149 Z" fill={ref} transform="translate(11.5 11.5) scale(0.77)" />
    </svg>
  );
}

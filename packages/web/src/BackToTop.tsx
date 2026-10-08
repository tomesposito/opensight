import { useCallback, useEffect, useState } from 'react';

const SHOW_AFTER_PX = 600;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function scrollPosition(): number {
  return typeof window === 'undefined' ? 0 : window.scrollY ?? 0;
}

/** Floating back-to-top button. Appears after scrolling down ~600px, hides at the top. */
export function BackToTop() {
  const [visible, setVisible] = useState(() => scrollPosition() > SHOW_AFTER_PX);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window;
    const onScroll = () => setVisible(win.scrollY > SHOW_AFTER_PX);
    onScroll();
    win.addEventListener('scroll', onScroll, { passive: true });
    return () => win.removeEventListener('scroll', onScroll);
  }, []);
  const scrollToTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, []);
  if (!visible) return null;
  return <button type="button" className="back-to-top" aria-label="Back to top" onClick={scrollToTop}>↑ Back to top</button>;
}

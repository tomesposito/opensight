import type { ReactNode } from 'react';
import type { SurfaceState } from '@opensight/embedding-sdk/surface';

/** A group may contain links, disclosures and inputs. Inert covers all of them,
 * including keyboard focus. Visible controls keep their existing DOM layout. */
export function SurfaceControl({ state, children }: { state?: SurfaceState; children: ReactNode }) {
  if (state === 'hidden') return null;
  if (state === 'disabled') return <div className="embed-disabled-controls" inert aria-disabled="true">{children}</div>;
  return <>{children}</>;
}

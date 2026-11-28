import { useCallback } from 'react';
import { VisualCard } from './VisualCard.js';
import type { CompiledVisual } from './compiler.js';
import type { FixtureVisual, Row } from './model.js';
import type { EmbedTransport } from './embed-transport.js';

export function EmbedVisualCard({ visual, events }: { visual: FixtureVisual & { id: string }; events: EmbedTransport['events'] }) {
  const select = useCallback((row: Row, { model }: CompiledVisual) => {
    const fields = [...model.dimensions, ...[model.trendDimension, model.facet, model.breakdown].filter(f => f !== undefined)];
    const values = Object.fromEntries(fields.flatMap(field => {
      const alias = visual.bindings[field.id];
      return alias !== undefined && Object.hasOwn(visual.bindings, field.id) && Object.hasOwn(row, alias) ? [[field.column, row[alias]!]] : [];
    }));
    events.emit({ type: 'selection', visualId: visual.id, values });
  }, [events, visual]);
  return <VisualCard visual={visual} onResultSelect={select} />;
}

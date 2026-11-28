import { useCallback, useState, type ComponentProps } from 'react';
import type { EmbedValues } from '@opensight/embedding-sdk/events';
import { VisualActionMenu } from './VisualActionMenu.js';
import { VisualCard } from './VisualCard.js';
import type { CompiledVisual } from './compiler.js';
import type { FixtureVisual, Row } from './model.js';
import type { EmbedTransport } from './embed-transport.js';

type Visual = FixtureVisual & { id: string; contextColumns?: Record<string, string> };

/** The server derives this mapping from the CLS-checked plan. Never look up a
 * host-supplied name directly in a row: a result alias can shadow a denied name. */
function project(visual: Visual, row: Row, columns: string[]): EmbedValues | undefined {
  const bindings = visual.contextColumns;
  if (!bindings) return;
  const entries: [string, Row[string]][] = [];
  for (const column of columns) {
    if (!Object.hasOwn(bindings, column)) return;
    const alias = bindings[column]!;
    if (!Object.hasOwn(row, alias)) return;
    entries.push([column, row[alias]!]);
  }
  return Object.fromEntries(entries);
}

export function EmbedVisualCard({ visual, events, ...card }: { visual: Visual; events: EmbedTransport['events'] }
  & Pick<ComponentProps<typeof VisualCard>, 'loading' | 'provenance' | 'dataMessage'>) {
  const [selection, setSelection] = useState<{ visual: Visual; row: Row }>();
  const selected = selection?.visual === visual ? selection.row : undefined;
  const select = useCallback((row: Row, { model }: CompiledVisual) => {
    setSelection({ visual, row });
    const fields = [...model.dimensions, ...[model.trendDimension, model.facet, model.breakdown].filter(f => f !== undefined)];
    const columns = fields.map(f => f.column).filter(column => Object.hasOwn(visual.contextColumns ?? {}, column));
    events.emit({ type: 'selection', visualId: visual.id, values: project(visual, row, columns) ?? {} });
  }, [events, visual]);
  const actions = events?.customActions ?? [];
  const menu = actions.length > 0 && <VisualActionMenu items={actions.map(action => ({ ...action, name: action.label }))} selection={selected}
    onInvoke={action => {
      if (!selected) return;
      const values = project(visual, selected, action.columns);
      if (values) events.emit({ type: 'customAction', visualId: visual.id, actionId: action.id, values });
    }} />;
  return <VisualCard {...card} visual={visual} onResultSelect={select} actionMenu={menu} />;
}

import { useRef, useState, type DragEvent } from 'react';

export type ColumnDrag = { list: string; name: string; index?: number };
type Edge = 'before' | 'after' | 'assign';
const mime = 'application/x-opensight-prep-column';

export function reorderPrepColumns<T>(items: readonly T[], from: number, to: number, after = false): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return [...items];
  const next = [...items], [item] = next.splice(from, 1);
  next.splice(to + (after ? 1 : 0) - (from < to ? 1 : 0), 0, item!);
  return next;
}

/** Only an active drag from this editor may mutate its columns. The opaque
 * token prevents external payloads and stale/source-switched drags being used. */
export function usePrepColumnDrag(scope: string) {
  const active = useRef<{ scope: string; token: string; value: ColumnDrag } | null>(null);
  const [over, setOver] = useState<{ id: string; edge: Edge; scope: string } | null>(null);
  const clear = () => { active.current = null; setOver(null); };
  const source = (value: ColumnDrag) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      const token = globalThis.crypto.randomUUID();
      active.current = { scope, token, value }; setOver(null);
      e.dataTransfer.effectAllowed = 'copyMove'; e.dataTransfer.setData(mime, token);
      e.stopPropagation();
    },
    onDragEnd: clear,
  });
  const target = (id: string, accepts: (value: ColumnDrag) => boolean, drop: (value: ColumnDrag, after: boolean) => void, axis?: 'x' | 'y') => {
    const valid = (e: DragEvent<HTMLElement>) => active.current?.scope === scope && Array.from(e.dataTransfer.types).includes(mime) && accepts(active.current.value);
    const edge = (e: DragEvent<HTMLElement>): Edge => {
      if (!axis) return 'assign';
      const box = e.currentTarget.getBoundingClientRect();
      return (axis === 'x' ? e.clientX > box.left + box.width / 2 : e.clientY > box.top + box.height / 2) ? 'after' : 'before';
    };
    return {
      'data-prep-drop': over?.id === id && over.scope === scope ? over.edge : undefined,
      onDragOver: (e: DragEvent<HTMLElement>) => {
        e.stopPropagation();
        if (!valid(e)) { e.dataTransfer.dropEffect = 'none'; setOver(null); return; }
        e.preventDefault(); e.dataTransfer.dropEffect = axis ? 'move' : 'copy'; setOver({ id, edge: edge(e), scope });
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault(); e.stopPropagation();
        const current = active.current;
        if (valid(e) && current && e.dataTransfer.getData(mime) === current.token) drop(current.value, edge(e) === 'after');
        clear();
      },
    };
  };
  return { source, target };
}

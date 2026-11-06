import { describeInterpretation, type Interpretation } from '@opensight/o-interpreter';
import type { AuthorDraft, AuthorVisual, Placement } from './authoring.js';
import type { OPlan, OPlanTile } from './api-client.js';
import { prepareOVisual, type PreparedOVisual } from './o-authoring.js';
import type { OStepPatch } from './OSteps.js';
export interface StagedTile extends OPlanTile { kept: boolean; interpretation?: Interpretation; prepared?: PreparedOVisual }
export interface StagedPlan { sheetTitle: string; tiles: StagedTile[]; delivered: number }
export function editOInterpretation(i: Interpretation, patch: OStepPatch): Interpretation {
  const next = { ...i, ...patch };
  next.explanation = describeInterpretation(next);
  const fieldsUsed = [...new Set([...(next.measure ? [next.measure] : []), ...next.dimensions, ...next.filters.map(f => f.field)])];
  next.grounding = { ...i.grounding, fieldsUsed, synonymsMatched: i.grounding.synonymsMatched.filter(s => fieldsUsed.includes(s.field)) };
  return next;
}
/** Rebuild in plan order after any edit; removed tiles cannot own helpers used by kept tiles. */
export function prepareOPlan(plan: OPlan | StagedPlan, draft: AuthorDraft): StagedPlan {
  const existing = [...draft.calculatedFields];
  const tiles = plan.tiles.map(tile => {
    const staged = tile as StagedTile, interpretation = staged.interpretation ?? tile.result?.interpretations[0];
    const next: StagedTile = { ...tile, kept: staged.kept ?? true, interpretation, prepared: undefined };
    if (!interpretation) return next;
    try {
      next.prepared = prepareOVisual(interpretation, existing, draft.dataset);
      if (next.kept) existing.push(...next.prepared.calculatedFields);
      next.status = 'ok'; delete next.code; delete next.message;
    } catch (e) { next.status = 'failed'; next.code = 'O_PREPARATION_FAILED'; next.message = e instanceof Error ? e.message : String(e); }
    return next;
  });
  return { ...plan, tiles };
}
/** Stable class order, with a fresh row at each class boundary. */
export function packOTiles(visuals: readonly Pick<AuthorVisual, 'id' | 'kind'>[], bottom = 0): Placement[] {
  const result: Placement[] = [];
  let y = bottom;
  for (const kinds of [['kpi'], ['bar', 'line', 'pie'], ['table']]) {
    const group = visuals.filter(v => kinds.includes(v.kind));
    const w = kinds[0] === 'kpi' ? 3 : kinds[0] === 'table' ? 12 : 6, h = w === 3 ? 4 : 8;
    group.forEach((v, i) => result.push({ i: v.id, x: (i % (12 / w)) * w, y: y + Math.floor(i / (12 / w)) * h, w, h }));
    y += Math.ceil(group.length / (12 / w)) * h;
  }
  return result;
}
export function oPlanItems(plan: StagedPlan, draft: AuthorDraft, bottom = 0) {
  const ready = prepareOPlan(plan, draft).tiles.flatMap((tile, index) => tile.kept && tile.status === 'ok' && tile.prepared ? [{ ...tile.prepared, visual: { ...tile.prepared.visual, id: `o-plan-${index}` } }] : []);
  const placements = packOTiles(ready.map(p => p.visual), bottom);
  return ready.map(p => ({ ...p, placement: placements.find(l => l.i === p.visual.id)! }));
}

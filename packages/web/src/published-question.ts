import { emptyDraft } from './authoring.js';
import { normalizeVisual } from './compiler.js';
import { buildApiPreview } from './api-preview.js';
import type { PublishedDashboard } from './published-dashboard.js';

/** Vocabulary from the viewer's published definition; execution remains dashboard-scoped. */
export function publishedQuestionDraft(value: PublishedDashboard) {
  const preview = buildApiPreview(value, 'dashboard', []);
  const columns = new Map<string, { name: string; type: 'STRING' | 'DATETIME' | 'DECIMAL' }>();
  for (const sheet of preview.sheets) for (const visual of sheet.visuals) {
    try {
      const model = normalizeVisual(visual.source, visual.definition, visual.path);
      for (const field of [...model.dimensions, ...(model.trendDimension ? [model.trendDimension] : [])]) columns.set(field.column, { name: field.column, type: field.dateGranularity ? 'DATETIME' : 'STRING' });
      for (const field of [...model.measures, ...(model.targetMeasure ? [model.targetMeasure] : [])]) columns.set(field.column, { name: field.column, type: 'DECIMAL' });
    } catch { /* Unsupported visuals retain their published diagnostics. */ }
  }
  return { ...emptyDraft(), title: value.name, dataset: { id: value.id, name: value.name, columns: [...columns.values()].filter(c => !c.name.startsWith('__metric_')), metrics: value.metrics } };
}

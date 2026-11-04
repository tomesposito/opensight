import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { queryPrepared } from '@opensight/query-engine/browser';
import type { FixtureVisual } from './model.js';
export interface NotebookParameter { name: string; type: 'string' | 'number' | 'date'; default?: string | number }
export interface NotebookChart { type: 'bar' | 'line' | 'pie' | 'table'; dimension: string; measure: string; aggregation: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' }
export type NotebookCell = { id: string; kind: 'markdown'; text: string } | { id: string; kind: 'sql'; text: string; datasetRefs: string[] } | { id: string; kind: 'visual'; sourceCellId: string; chart: NotebookChart };
export interface NotebookSummary { id: string; name: string; ownerId: string; published: boolean; cellCount: number; parameterCount: number; version: number; updatedAt: string; canEdit: boolean; canManage: boolean }
export interface NotebookData { columns: PrepColumn[]; rows: Record<string, string | number | boolean | null>[]; rowCount: number; truncated: boolean }
export interface NotebookResult { cellId: string; kind: NotebookCell['kind']; executedAt: string; elapsedMs: number; data?: NotebookData; sourceCellId?: string; error?: { code: string; message: string } }
export interface NotebookRun { id: string; notebookId: string; notebookVersion: number; executedAt: string; executedBy: string; results?: NotebookResult[]; resultsRedacted?: boolean }
export interface NotebookSnapshot { id: string; cellId: string; asOf: string; rowCount: number; truncated: boolean; columns: PrepColumn[] }
export interface Notebook extends NotebookSummary { namespaceId: string; parameters: NotebookParameter[]; cells: NotebookCell[]; snapshots: NotebookSnapshot[] }
export interface NotebookDataset { id: string; columns: PrepColumn[]; asOf?: string }
export type NotebookContent = Pick<Notebook, 'name' | 'published' | 'parameters' | 'cells'>;

/** Same prepared-data planner/evaluator and definition compiler used by analyses. */
export function notebookVisual(cell: Extract<NotebookCell, { kind: 'visual' }>, data: NotebookData): FixtureVisual {
  const { chart } = cell;
  const dimensionColumn = data.columns.find(c => c.name === chart.dimension), measureColumn = data.columns.find(c => c.name === chart.measure);
  if (!dimensionColumn || !measureColumn) throw new Error('NOTEBOOK_VISUAL_FIELD_NOT_FOUND: Choose columns returned by the source SQL cell.');
  if (dimensionColumn.type === 'BOOLEAN' || !['INTEGER', 'DECIMAL'].includes(measureColumn.type)) throw new Error('NOTEBOOK_VISUAL_FIELD_TYPE: Choose a text, number or date dimension and numeric measure.');
  const result = queryPrepared(data.columns, data.rows.length, (r, c) => data.rows[r]![data.columns[c]!.name]!, {
    dimensions: [{ fieldId: 'category', columnName: chart.dimension, ...(dimensionColumn.type === 'DATETIME' ? { granularity: 'DAY' as const } : {}) }], measures: [{ fieldId: 'value', columnName: chart.measure, aggregation: chart.aggregation }], filters: [],
  });
  const column = (name: string) => ({ columnName: name, dataSetIdentifier: 'notebook' });
  const dimension = { [dimensionColumn.type === 'DATETIME' ? 'dateDimensionField' : dimensionColumn.type === 'STRING' ? 'categoricalDimensionField' : 'numericalDimensionField']: { fieldId: 'category', column: column(chart.dimension), ...(dimensionColumn.type === 'DATETIME' ? { dateGranularity: 'DAY' } : {}) } };
  // The compiler consumes already-aggregated result bindings. Each dimension
  // has one row after queryPrepared; SUM here is the compiler's result contract,
  // while the requested aggregation above determines the value.
  const measure = { numericalMeasureField: { fieldId: 'value', column: column(chart.measure), aggregationFunction: { simpleNumericalAggregation: 'SUM' } } };
  const variant = { bar: 'barChartVisual', line: 'lineChartVisual', pie: 'pieChartVisual', table: 'tableVisual' }[chart.type];
  const wells = { bar: 'barChartAggregatedFieldWells', line: 'lineChartAggregatedFieldWells', pie: 'pieChartAggregatedFieldWells', table: 'tableAggregatedFieldWells' }[chart.type];
  return { source: 'bundle', path: `notebook.${cell.id}`, placement: { column: 0, columns: 36, row: 0, rows: 6 },
    definition: { [variant]: { visualId: cell.id, title: { visibility: 'VISIBLE', formatText: { plainText: `${chart.aggregation} of ${chart.measure} by ${chart.dimension}` } }, chartConfiguration: { fieldWells: { [wells]: { [chart.type === 'table' ? 'groupBy' : 'category']: [dimension], values: [measure] } } } } },
    bindings: { category: result.columns[0]!.name, value: result.columns[1]!.name }, rows: result.rows };
}

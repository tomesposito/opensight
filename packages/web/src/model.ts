import type { AnalysisTheme } from './themes.js';
import type { LegendPosition, VisualFormatting } from './formatting.js';
import type { BundleVisual, VisualBody } from '@opensight/bundle-parser';
import type { VisualKind } from './visual-catalog.js';
import type { ResourceKind } from './api-client.js';

export type Cell = string | number | boolean | null;
export type Row = Readonly<Record<string, Cell>>;
export interface Field {
  id: string;
  column: string;
  dataSet: string;
  dateGranularity?: 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR';
}
export interface VisualModel {
  id: string;
  title: string;
  titleVisible: boolean;
  subtitle: string; subtitleVisible: boolean; legendPosition: LegendPosition;
  kind: VisualKind;
  palette?: string[];
  formatting?: VisualFormatting;
  gaugeMin: number;
  gaugeMax: number;
  bins: number;
  dimensions: Field[];
  measures: Field[];
  rowDimensions: Field[];
  columnDimensions: Field[];
  totals: boolean;
  subtotals: boolean;
  columnTotals: boolean;
  columnSubtotals: boolean;
  innerRadius: string;
  horizontal: boolean;
  stacked: boolean;
  labels: boolean;
  tooltip: boolean;
  legend: boolean;
  referenceLines?: { value: number; label: string; color: string }[];
  sort?: { fieldId: string; direction: 'ASC' | 'DESC' };
  warnings: string[];
  insightConfiguration?: Record<string, unknown>;
}
export interface FixtureVisual {
  theme?: AnalysisTheme;
  source: 'bundle' | 'api';
  definition: BundleVisual | Record<string, VisualBody>;
  rows: Row[] | null;
  /** Explicit result aliases: e.g. date field order_date -> SQL result month. */
  bindings: Record<string, string>;
  placement: { column: number; columns: number; row: number; rows: number };
  path: string;
}
export interface Fixture {
  id: string;
  name: string;
  description: string;
  provenance: string;
  notice: string;
  /** Pinned source definition, used only to authorize reuse of fixture results. */
  apiResource?: { kind: ResourceKind; definition: unknown; source: 'bundle' | 'api' };
  sheets: { id: string; name: string; visuals: FixtureVisual[] }[];
}

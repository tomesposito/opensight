import type { AnalysisTheme } from './themes.js';
import type { LegendPosition, VisualFormatting } from './formatting.js';
import type { BundleVisual, VisualBody } from '@opensight/bundle-parser';
import type { VisualKind } from './visual-catalog.js';
import type { ResourceKind } from './api-client.js';
import type { FilterAction, NavigationAction, UrlAction } from './interactions.js';

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
  /** Small-multiples facet dimension (pie only for now). Rendered as a grid of
   *  per-facet charts; part of the view-data table but never a series field. */
  facet?: Field;
  /** Waterfall breakdown dimension (QuickSight Breakdowns well parity). Each
   *  breakdown value's deltas render as floating bars between the category
   *  subtotals; part of the view-data table but never a series field. */
  breakdown?: Field;
  /** Multiples Options panel state (pie small multiples only). Absent means the
   *  automatic layout: heuristic grid, up to 20 panels, small centered titles. */
  multiplesOptions?: MultiplesOptions;
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
  /** Interactions-tab tooltip detail (QuickSight SelectedTooltipType / FieldBasedTooltip parity). */
  tooltipDetail?: {
    type: 'basic' | 'detailed';
    titleType: 'primaryValue' | 'fieldId';
    aggregations: boolean;
    /** Field ids hidden from the detailed tooltip; all visual fields show by default. */
    hiddenFields: string[];
  };
  /** Extra dataset measure fields rendered as additional detailed-tooltip rows.
   *  Not part of the visual's wells: they never affect grouping, series, or the data table. */
  tooltipExtraFields?: { id: string; label?: string; aggregation: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' }[];
  legend: boolean;
  referenceLines?: { value: number; label: string; color: string }[];
  sort?: { fieldId: string; direction: 'ASC' | 'DESC' };
  /** Pie slice limit (QuickSight CategoryItemsLimit): show the top N categories,
   *  rolling the rest into an "Other" bucket when includeOther. Applied per facet
   *  group for faceted pies. Absent means no limit: all result rows are shown. */
  sliceLimit?: { count: number; includeOther: boolean };
  warnings: string[];
  insightConfiguration?: Record<string, unknown>;
}
/** QuickSight "Multiples Options" panel settings for pie small multiples
 *  (OpenSight extension: the bundle carries them as
 *  chartConfiguration.opensightMultiplesOptions). ECharts titles cannot
 *  underline and ECharts grid chrome cannot dash, so `title.underline` and
 *  `border.style` are preserved in the model and exports but not rendered. */
export interface MultiplesOptions {
  visibleRows: 'auto' | number;
  visibleColumns: 'auto' | number;
  /** Maximum panels rendered; the renderer also enforces the 20-panel cap with a truncation warning. */
  panelCount: number;
  title: { size: 'small' | 'medium' | 'large'; bold: boolean; italic: boolean; underline: boolean; align: 'left' | 'center' | 'right' };
  border: { enabled: boolean; widthPx: number; style: 'solid' | 'dashed' | 'dotted'; color: string };
  gutter: boolean;
  background: boolean;
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
  /** Interaction actions threaded from the source definition (author visual or live body). View-mode surfaces consume these; absent means none were recognized. */
  filterActions?: FilterAction[];
  urlActions?: UrlAction[];
  navigationActions?: NavigationAction[];
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

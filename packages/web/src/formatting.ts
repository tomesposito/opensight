import { colorValid } from './themes.js';
import type { Cell, Field } from './model.js';
import type { VisualKind } from './visual-catalog.js';
import type { CSSProperties } from 'react';
export const hasLegend = (kind: VisualKind): boolean => ['bar', 'line', 'pie', 'combo', 'area', 'bar100', 'radar', 'sankey', 'waterfall'].includes(kind);
export const hasDataLabels = (kind: VisualKind): boolean => !['insight', 'table', 'pivot', 'kpi', 'gauge', 'box', 'wordCloud', 'pointMap'].includes(kind);
export const hasReferenceLines = (kind: VisualKind): boolean => ['bar', 'bar100', 'line', 'area', 'combo', 'scatter'].includes(kind);
export const LEGEND_POSITIONS = ['AUTO', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT'] as const;
export type LegendPosition = typeof LEGEND_POSITIONS[number];
export const legendPositionValid = (raw: unknown): raw is LegendPosition => LEGEND_POSITIONS.some(p => p === raw);
export const binsValid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;
export function gaugeValid(v: unknown): v is { min: number; max: number } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const g = v as Record<string, unknown>;
  return Object.keys(g).every(k => k === 'min' || k === 'max') && typeof g.min === 'number' && typeof g.max === 'number' && Number.isFinite(g.min) && Number.isFinite(g.max) && g.min < g.max;
}
/** QuickSight Display settings · Card style reference defaults. These are the
 *  values the Properties panel shows for an untouched card; the reducer strips
 *  saved values back to `undefined` when they equal these, so the model and
 *  exports stay lean. Opacity defaults to 100% when a color is set without one. */
export const CARD_DEFAULTS = {
  backgroundColor: '#ffffff', backgroundOpacityPct: 85,
  borderColor: '#cccccc', borderOpacityPct: 100, borderWidthPx: 1,
  selectionColor: '#000000', selectionOpacityPct: 100,
  loadingAnimation: true, paddingPx: 24,
} as const;
/** Card chrome color at an opacity percent (0–100). */
export interface CardSwatch { color: string; opacityPct?: number }
/** Card border color at an opacity percent with a width in px (0 = no border). */
export interface CardBorder { color: string; opacityPct?: number; widthPx?: number }
/** Per-visual card style (QuickSight Display settings · Card style parity).
 *  Selection has no ECharts/chart primitive, so it is saved and exported but
 *  never rendered — the panel says so, following the underline precedent. */
export interface CardStyle { background?: CardSwatch; border?: CardBorder; selection?: CardSwatch; loadingAnimation?: boolean }
/** Per-visual card layout (QuickSight Display settings · Card layout parity). */
export interface CardLayout { paddingPx?: number }
const opacityPctValid = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;
export function cardSwatchValid(raw: unknown): raw is CardSwatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  return styleKeys(s, ['color', 'opacityPct']) && colorValid(s.color) && (s.opacityPct === undefined || opacityPctValid(s.opacityPct));
}
export function cardBorderValid(raw: unknown): raw is CardBorder {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const b = raw as Record<string, unknown>;
  return styleKeys(b, ['color', 'opacityPct', 'widthPx']) && colorValid(b.color) && (b.opacityPct === undefined || opacityPctValid(b.opacityPct))
    && (b.widthPx === undefined || Number.isInteger(b.widthPx) && Number(b.widthPx) >= 0 && Number(b.widthPx) <= 8);
}
export function cardStyleValid(raw: unknown): raw is CardStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  return styleKeys(s, ['background', 'border', 'selection', 'loadingAnimation'])
    && (s.background === undefined || cardSwatchValid(s.background))
    && (s.border === undefined || cardBorderValid(s.border))
    && (s.selection === undefined || cardSwatchValid(s.selection))
    && (s.loadingAnimation === undefined || typeof s.loadingAnimation === 'boolean');
}
export function cardLayoutValid(raw: unknown): raw is CardLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const l = raw as Record<string, unknown>;
  return styleKeys(l, ['paddingPx']) && (l.paddingPx === undefined || Number.isInteger(l.paddingPx) && Number(l.paddingPx) >= 0 && Number(l.paddingPx) <= 64);
}
/** Strip a card style back to `undefined` when it equals the reference defaults;
 *  drop per-part values that are no-ops (100% opacity, 1px border) so saved
 *  settings stay lean. */
export function cleanCardStyle(style: CardStyle | undefined): CardStyle | undefined {
  if (!style) return undefined;
  const out: CardStyle = {};
  if (style.background !== undefined && !(style.background.color === CARD_DEFAULTS.backgroundColor && (style.background.opacityPct ?? 100) === CARD_DEFAULTS.backgroundOpacityPct)) {
    const background: CardSwatch = { color: style.background.color };
    if (style.background.opacityPct !== undefined && style.background.opacityPct !== 100) background.opacityPct = style.background.opacityPct;
    out.background = background;
  }
  if (style.border !== undefined && !(style.border.color === CARD_DEFAULTS.borderColor && (style.border.opacityPct ?? 100) === CARD_DEFAULTS.borderOpacityPct && (style.border.widthPx ?? 1) === CARD_DEFAULTS.borderWidthPx)) {
    const border: CardBorder = { color: style.border.color };
    if (style.border.opacityPct !== undefined && style.border.opacityPct !== 100) border.opacityPct = style.border.opacityPct;
    if (style.border.widthPx !== undefined && style.border.widthPx !== 1) border.widthPx = style.border.widthPx;
    out.border = border;
  }
  if (style.selection !== undefined && !(style.selection.color === CARD_DEFAULTS.selectionColor && (style.selection.opacityPct ?? 100) === CARD_DEFAULTS.selectionOpacityPct)) {
    const selection: CardSwatch = { color: style.selection.color };
    if (style.selection.opacityPct !== undefined && style.selection.opacityPct !== 100) selection.opacityPct = style.selection.opacityPct;
    out.selection = selection;
  }
  if (style.loadingAnimation === false) out.loadingAnimation = false;
  return Object.keys(out).length ? out : undefined;
}
/** Strip a card layout back to `undefined` when the padding equals the default. */
export function cleanCardLayout(layout: CardLayout | undefined): CardLayout | undefined {
  if (!layout || layout.paddingPx === undefined || layout.paddingPx === CARD_DEFAULTS.paddingPx) return undefined;
  return { paddingPx: layout.paddingPx };
}
const hexByte = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16);
const swatchCss = (color: string, opacityPct?: number): string => {
  const alpha = (opacityPct ?? 100) / 100;
  return alpha >= 1 ? color : `rgba(${hexByte(color, 1)}, ${hexByte(color, 3)}, ${hexByte(color, 5)}, ${alpha})`;
};
/** Inline CSS for the visual card chrome from formatting. Returns `{}` when no
 *  card options are set, so untouched visuals render byte-identically. */
export function cardChromeStyle(formatting: VisualFormatting | undefined): CSSProperties {
  const style: CSSProperties = {};
  const card = formatting?.cardStyle, layout = formatting?.cardLayout;
  if (card?.background) style.background = swatchCss(card.background.color, card.background.opacityPct);
  if (card?.border) {
    if (card.border.widthPx === 0) { style.borderWidth = 0; style.borderStyle = 'none'; }
    else style.border = `${card.border.widthPx ?? 1}px solid ${swatchCss(card.border.color, card.border.opacityPct)}`;
  }
  if (layout?.paddingPx !== undefined) style.padding = `${layout.paddingPx}px`;
  return style;
}
/** Whether the card's loading skeleton animates; the reference default is on. */
export const cardLoadingAnimation = (formatting: VisualFormatting | undefined): boolean => formatting?.cardStyle?.loadingAnimation ?? true;
export interface ConditionalRule { fieldId: string; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; threshold: number; color: string; background: string }
/** Text styling for legend title and legend value entries (QuickSight Legend panel parity). */
export interface LegendTextStyle { fontSize?: number; color?: string; bold?: boolean; italic?: boolean; underline?: boolean }
export interface LegendTitle { show?: boolean; text?: string; style?: LegendTextStyle }
/** Group/Color well title (QuickSight Group/Color panel parity): shown above the
 *  field entries the way QS shows it in the panel; the chart draws no separate
 *  group title (no ECharts primitive), so it is saved/exported but not rendered. */
export interface GroupTitle { show?: boolean; text?: string; style?: LegendTextStyle }
export const DATA_LABEL_POSITIONS = ['auto', 'inside', 'outside'] as const;
export type DataLabelPosition = typeof DATA_LABEL_POSITIONS[number];
export const dataLabelPositionValid = (raw: unknown): raw is DataLabelPosition => DATA_LABEL_POSITIONS.some(p => p === raw);
/** Which parts of a data label are shown (QuickSight Data labels panel parity). */
export interface DataLabelContent { category?: boolean; metric?: boolean }
export function dataLabelContentValid(raw: unknown): raw is DataLabelContent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const c = raw as Record<string, unknown>;
  return styleKeys(c, ['category', 'metric'])
    && (c.category === undefined || typeof c.category === 'boolean')
    && (c.metric === undefined || typeof c.metric === 'boolean');
}
/** Data label content/styling options; absent means today's defaults. Underline has no
 *  ECharts label primitive, so the flag stays in the model and exports but never renders. */
export interface DataLabels { content?: DataLabelContent; position?: DataLabelPosition; style?: LegendTextStyle; allowOverlap?: boolean }
export function dataLabelsValid(raw: unknown): raw is DataLabels {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const d = raw as Record<string, unknown>;
  return styleKeys(d, ['content', 'position', 'style', 'allowOverlap'])
    && (d.content === undefined || dataLabelContentValid(d.content))
    && (d.position === undefined || dataLabelPositionValid(d.position))
    && (d.style === undefined || legendTextStyleValid(d.style))
    && (d.allowOverlap === undefined || typeof d.allowOverlap === 'boolean');
}
const styleKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export function legendTextStyleValid(raw: unknown): raw is LegendTextStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  return styleKeys(s, ['fontSize', 'color', 'bold', 'italic', 'underline'])
    && (s.fontSize === undefined || Number.isInteger(s.fontSize) && Number(s.fontSize) >= 8 && Number(s.fontSize) <= 32)
    && (s.color === undefined || colorValid(s.color))
    && ['bold', 'italic', 'underline'].every(k => s[k] === undefined || typeof s[k] === 'boolean');
}
export function legendTitleValid(raw: unknown): raw is LegendTitle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const t = raw as Record<string, unknown>;
  return styleKeys(t, ['show', 'text', 'style'])
    && (t.show === undefined || typeof t.show === 'boolean')
    && (t.text === undefined || typeof t.text === 'string' && !!t.text.trim() && t.text.length <= 128)
    && (t.style === undefined || legendTextStyleValid(t.style));
}
export function groupTitleValid(raw: unknown): raw is GroupTitle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const t = raw as Record<string, unknown>;
  return styleKeys(t, ['show', 'text', 'style'])
    && (t.show === undefined || typeof t.show === 'boolean')
    && (t.text === undefined || typeof t.text === 'string' && !!t.text.trim() && t.text.length <= 128)
    && (t.style === undefined || legendTextStyleValid(t.style));
}
/** Custom accessible description for a visual's chart (QuickSight Display settings ·
 *  Card title "Alt text" parity). Saved with the visual and exported; when set it
 *  becomes the chart's accessible description, and when unset the chart title
 *  serves as it does today. */
export const ALT_TEXT_MAX_LENGTH = 500;
export const altTextValid = (v: unknown): v is string =>
  typeof v === 'string' && !!v.trim() && v.trim().length <= ALT_TEXT_MAX_LENGTH;
/** Normalize saved alt text: trim; blank clears to `undefined`. */
export function cleanAltText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return trimmed ? trimmed : undefined;
}
export interface PivotOptions {
  metricPlacement?: 'columns' | 'rows';
  hideEmptyRows?: boolean; hideEmptyColumns?: boolean;
  wordWrap?: boolean; columnWidth?: number;
  /** Typed row-dimension prefixes; omitted groups are expanded. */
  collapsedRowGroups?: Cell[][];
}
export function rowGroupPathValid(raw: unknown): raw is Cell[] {
  return Array.isArray(raw) && raw.length > 0 && raw.every(value => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value));
}
export function pivotOptionsValid(raw: unknown): raw is PivotOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  return Object.keys(p).every(k => ['metricPlacement', 'hideEmptyRows', 'hideEmptyColumns', 'wordWrap', 'columnWidth', 'collapsedRowGroups'].includes(k))
    && (p.collapsedRowGroups === undefined || Array.isArray(p.collapsedRowGroups) && p.collapsedRowGroups.every(rowGroupPathValid) && new Set(p.collapsedRowGroups.map(path => JSON.stringify(path))).size === p.collapsedRowGroups.length)
    && (p.metricPlacement === undefined || p.metricPlacement === 'columns' || p.metricPlacement === 'rows')
    && ['hideEmptyRows', 'hideEmptyColumns', 'wordWrap'].every(k => p[k] === undefined || typeof p[k] === 'boolean')
    && (p.columnWidth === undefined || Number.isInteger(p.columnWidth) && Number(p.columnWidth) >= 60 && Number(p.columnWidth) <= 400);
}
export interface VisualFormatting {
  pivot?: PivotOptions;
  titleFontSize?: number; barCategoryGap?: number; legendPosition?: LegendPosition;
  /** Legend title (show/text/style) and legend value-entry text styling; absent means theme defaults. */
  legendTitle?: LegendTitle; legendValueStyle?: LegendTextStyle;
  /** Group/Color well title (show/text/style); saved with the visual and exports, not drawn by the chart. */
  groupTitle?: GroupTitle;
  /** Custom accessible description for the visual's chart (Alt text parity); absent means the chart title serves. */
  altText?: string;
  /** Data label content/styling options (QuickSight Data labels panel); absent means today's defaults. */
  dataLabels?: DataLabels;
  /** Per-visual card style (background/border/selection/loading animation); absent means the reference defaults. */
  cardStyle?: CardStyle;
  /** Per-visual card layout (inner padding); absent means the reference default. */
  cardLayout?: CardLayout;
  headersVisible?: boolean; rowNamesVisible?: boolean; columnNamesVisible?: boolean; valueNamesVisible?: boolean;
  headerColor?: string; headerBackground?: string; cellColor?: string; cellBackground?: string;
  fontSize?: number; decimalPlaces?: number; names?: Record<string, string>; rules?: ConditionalRule[];
}
export function formattingValid(raw: unknown): raw is VisualFormatting {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const f = raw as Record<string, unknown>;
  const booleans = ['headersVisible', 'rowNamesVisible', 'columnNamesVisible', 'valueNamesVisible'];
  const colors = ['headerColor', 'headerBackground', 'cellColor', 'cellBackground'];
  if (Object.keys(f).some(k => ![...booleans, ...colors, 'fontSize', 'decimalPlaces', 'names', 'rules', 'pivot', 'titleFontSize', 'barCategoryGap', 'legendPosition', 'legendTitle', 'legendValueStyle', 'groupTitle', 'altText', 'dataLabels', 'cardStyle', 'cardLayout'].includes(k))) return false;
  if (f.legendPosition !== undefined && !legendPositionValid(f.legendPosition)) return false;
  if (f.legendTitle !== undefined && !legendTitleValid(f.legendTitle)) return false;
  if (f.groupTitle !== undefined && !groupTitleValid(f.groupTitle)) return false;
  if (f.altText !== undefined && !altTextValid(f.altText)) return false;
  if (f.legendValueStyle !== undefined && !legendTextStyleValid(f.legendValueStyle)) return false;
  if (f.dataLabels !== undefined && !dataLabelsValid(f.dataLabels)) return false;
  if (f.cardStyle !== undefined && !cardStyleValid(f.cardStyle)) return false;
  if (f.cardLayout !== undefined && !cardLayoutValid(f.cardLayout)) return false;
  if (f.pivot !== undefined && !pivotOptionsValid(f.pivot)) return false;
  if (f.titleFontSize !== undefined && (!Number.isInteger(f.titleFontSize) || Number(f.titleFontSize) < 8 || Number(f.titleFontSize) > 48)) return false;
  if (f.barCategoryGap !== undefined && (!Number.isInteger(f.barCategoryGap) || Number(f.barCategoryGap) < 0 || Number(f.barCategoryGap) > 80)) return false;
  if (booleans.some(k => f[k] !== undefined && typeof f[k] !== 'boolean') || colors.some(k => f[k] !== undefined && !colorValid(f[k]))) return false;
  if (f.fontSize !== undefined && (!Number.isInteger(f.fontSize) || Number(f.fontSize) < 8 || Number(f.fontSize) > 32) || f.decimalPlaces !== undefined && (!Number.isInteger(f.decimalPlaces) || Number(f.decimalPlaces) < 0 || Number(f.decimalPlaces) > 12)) return false;
  if (f.names !== undefined && (!f.names || typeof f.names !== 'object' || Array.isArray(f.names) || Object.entries(f.names).some(([k, v]) => !k || typeof v !== 'string' || !v.trim() || v.length > 128))) return false;
  if (f.rules !== undefined && (!Array.isArray(f.rules) || f.rules.length > 20 || !f.rules.every(r => r && typeof r === 'object' && Object.keys(r).every(k => ['fieldId', 'operator', 'threshold', 'color', 'background'].includes(k)) && typeof r.fieldId === 'string' && !!r.fieldId && ['gt', 'gte', 'lt', 'lte', 'eq'].includes(r.operator) && typeof r.threshold === 'number' && Number.isFinite(r.threshold) && colorValid(r.color) && colorValid(r.background)))) return false;
  return true;
}
export function matchingRule(rules: readonly ConditionalRule[] | undefined, fieldId: string, value: Cell): ConditionalRule | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  return rules?.find(r => r.fieldId === fieldId && ({ gt: value > r.threshold, gte: value >= r.threshold, lt: value < r.threshold, lte: value <= r.threshold, eq: value === r.threshold })[r.operator]);
}
export function fieldName(field: Field, formatting?: VisualFormatting): string {
  const names = formatting?.names;
  return names && Object.hasOwn(names, field.column) ? names[field.column]! : names && Object.hasOwn(names, field.id) ? names[field.id]! : field.column;
}
export function fieldRule(formatting: VisualFormatting | undefined, field: Field, value: Cell): ConditionalRule | undefined {
  return formatting?.rules?.find(rule => (rule.fieldId === field.column || rule.fieldId === field.id) && matchingRule([rule], rule.fieldId, value));
}

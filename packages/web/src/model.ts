import type { BundleVisual, VisualBody } from '@opensight/bundle-parser';

export type Cell = string | number | boolean | null;
export type Row = Readonly<Record<string, Cell>>;
export interface Field {
  id: string;
  column: string;
  dataSet: string;
}
export interface VisualModel {
  id: string;
  title: string;
  titleVisible: boolean;
  kind: 'pie' | 'bar' | 'kpi' | 'line' | 'table';
  dimensions: Field[];
  measures: Field[];
  innerRadius: string;
  horizontal: boolean;
  stacked: boolean;
  labels: boolean;
  tooltip: boolean;
  legend: boolean;
  sort?: { fieldId: string; direction: 'ASC' | 'DESC' };
  warnings: string[];
}
export interface FixtureVisual {
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
  sheets: { id: string; name: string; visuals: FixtureVisual[] }[];
}

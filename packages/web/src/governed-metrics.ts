import { metricColumn, type MetricDefinition, type MetricDataset, type PublishedMetric, type MetricFormat } from '@opensight/query-engine/browser';
import type { VisualFormatting } from './formatting.js';
export interface PromotableCalculation { id: string; name: string; expression: string; definition?: MetricDefinition; errorCode?: string }
export interface MetricDatasetOption { calculations?: PromotableCalculation[]; dataset: MetricDataset; name: string; columns: { name: string; type: string }[]; canPublish: boolean; owned: boolean; errorCode?: string }
export interface MetricSummary {
  provenance?: { kind: 'dataset-calculation'; calculationId: string; datasetVersion: number; name: string; expression: string };
  id: string; dataset: MetricDataset; version: number; publishedVersion: number | null;
  state: 'draft' | 'published'; definition: MetricDefinition; published: PublishedMetric | null;
  permissions: { edit: boolean; publish: boolean };
}
export interface MetricList { items: MetricSummary[]; canCreate: boolean; canPublish: boolean }
export interface MetricHistory { version: number; state: 'draft' | 'published'; definition: MetricDefinition; actor: string; at: string }
export function metricFormatting(formatting: VisualFormatting | undefined, metrics: readonly PublishedMetric[] = []): VisualFormatting | undefined {
  if (!metrics.length) return formatting;
  return { ...formatting, names: { ...formatting?.names, ...Object.fromEntries(metrics.map(m => [metricColumn(m.id), m.name])) },
    metricFormats: { ...formatting?.metricFormats, ...Object.fromEntries(metrics.map(m => [metricColumn(m.id), m.format])) } };
}
export function validMetricFormat(raw: unknown): raw is MetricFormat {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const f = raw as Record<string, unknown>;
  return Object.keys(f).every(k => ['style', 'decimalPlaces', 'currency'].includes(k)) && ['number', 'percent', 'currency'].includes(String(f.style)) && Number.isInteger(f.decimalPlaces) && Number(f.decimalPlaces) >= 0 && Number(f.decimalPlaces) <= 10 && (f.style === 'currency' ? typeof f.currency === 'string' && /^[A-Z]{3}$/.test(f.currency) : f.currency === undefined);
}
export function formatMetric(value: unknown, format?: MetricFormat): string | undefined {
  if (!format || typeof value !== 'number' || !Number.isFinite(value)) return;
  return value.toLocaleString('en-US', { style: format.style === 'number' ? 'decimal' : format.style, minimumFractionDigits: format.decimalPlaces, maximumFractionDigits: format.decimalPlaces, ...(format.currency ? { currency: format.currency } : {}) });
}

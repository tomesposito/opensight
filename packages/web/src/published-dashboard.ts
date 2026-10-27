import type { BundleDefinition, BundleSheet } from '@opensight/bundle-parser';
import { importControls } from './bundle-controls.js';
import { importParameter, type AuthorParameter, type ParameterValue } from './parameters.js';
import type { AuthorControl } from './controls.js';
import { normalizeVisual } from './compiler.js';
import type { FixtureVisual } from './model.js';

export interface DashboardSummary { id: string; name: string; version: number; publishedAt: string; sourceAnalysisId: string }
export interface PublishedDashboard { revision?: number; id: string; name: string; version: number; definition: BundleDefinition; errors: { errorCode: string; message: string; path: string }[] }
export type ControlValues = Record<string, ParameterValue[]>;
export function readerControls(definition: BundleDefinition, sheet: BundleSheet) {
  const messages: string[] = [];
  const parameters = (definition.parameterDeclarations ?? []).flatMap((raw, i) => {
    const p = importParameter(raw, `parameter-${i + 1}`, 'published'); return p ? [p] : [];
  });
  const controls = importControls(sheet.parameterControls, parameters, () => false, messages, sheet.sheetId);
  const bindings: { control: AuthorControl; parameter: AuthorParameter; problem?: string }[] = controls.map(control => ({
    control: { ...control, id: control.importedId! }, parameter: parameters.find(p => p.id === control.parameterId)!,
    ...(control.source ? { problem: 'DASHBOARD_CONTROL_OPTIONS_UNAVAILABLE: Linked dataset choices are unavailable in this reader.' } : {}),
  }));
  if (Array.isArray(sheet.filterControls) && sheet.filterControls.length) messages.push('DASHBOARD_CONTROL_UNSUPPORTED: Imported filter controls are not supported in this reader. Saved filters still apply.');
  return { bindings, messages: messages.filter(message => !message.includes(': live; bound to ')) };
}
/** The v1 query contract uses field IDs as aliases, with date grains as aliases. */
export function publishedBindings(visual: FixtureVisual): Record<string, string> {
  const model = normalizeVisual(visual.source, visual.definition, visual.path);
  return Object.fromEntries([...model.dimensions, ...model.measures].map(f => [f.id, f.dateGranularity?.toLowerCase() ?? f.id]));
}

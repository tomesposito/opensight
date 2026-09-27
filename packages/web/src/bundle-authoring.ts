import { assembleQsBundle, parseBundleJson, parseQsBundle, summarizeQsBundle, ZIP_LIMITS } from '@opensight/bundle-parser/browser';
import type { BundleDefinition, BundleSheet, BundleVisual, QsBundle } from '@opensight/bundle-parser';
import { defaults, emptyDraft, serializeDraft, serializeVisual, tabular, singleMeasure, validateDraft, dataFields, calculationError } from './authoring.js';
import type { AuthorDraft, AuthorSheet, AuthorVisual, CalculatedField, CategoryFilter, ImportResult, ImportedVisual, Placement, VisualKind } from './authoring.js';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const string = (v: unknown, fallback = ''): string => typeof v === 'string' ? v : fallback;
const copy = <T,>(v: T): T => structuredClone(v);
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export const LOCAL_SALES_ARN = 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales';
const LOCAL_IDENTIFIER = 'opensight_local_sales';
const kinds: Record<string, VisualKind> = { barChartVisual: 'bar', lineChartVisual: 'line', pieChartVisual: 'pie', kpiVisual: 'kpi', tableVisual: 'table', pivotTableVisual: 'pivot' };

/** Every unmodeled property/value is named; the original JSON stays in bundle.original. */
function differences(raw: unknown, projected: unknown, path: string): string[] {
  if (equal(raw, projected)) return [];
  if (Array.isArray(raw)) return raw.flatMap((v, i) => differences(v, list(projected)[i], `${path}[${i}]`));
  if (raw !== null && typeof raw === 'object') {
    return Object.entries(obj(raw)).flatMap(([k, v]) => ['visualId', 'fieldId', 'dataSetIdentifier'].includes(k) ? []
      : Object.hasOwn(obj(projected), k) ? differences(v, obj(projected)[k], `${path}.${k}`) : [`${path}.${k} (retained, read-only)`]);
  }
  return [`${path} = ${JSON.stringify(raw)} (retained, read-only)`];
}
function references(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap(references);
  const o = obj(raw);
  return [...(typeof o.dataSetIdentifier === 'string' ? [o.dataSetIdentifier] : []), ...Object.values(o).flatMap(v => v && typeof v === 'object' ? references(v) : [])];
}
function grid(sheet: BundleSheet, visuals: AuthorVisual[]): Placement[] {
  const elements = list(obj(obj(obj(sheet.layouts?.[0]).configuration).gridLayout).elements);
  return visuals.map((v, index) => {
    const e = obj(elements.find(e => obj(e).elementId === v.imported?.visualId));
    const x = Number(e.columnIndex) / 3, w = Number(e.columnSpan) / 3, y = Number(e.rowIndex), h = Number(e.rowSpan);
    return [x, w, y, h].every(Number.isSafeInteger) && x >= 0 && w >= 3 && x + w <= 12 && y >= 0 && h >= 4 && y + h <= 10000
      ? { i: v.id, x, y, w, h } : { i: v.id, x: 0, y: index * 8, w: 6, h: 8 };
  });
}
function localBinding(arn: string | undefined, bundle: QsBundle, identifier: string): boolean {
  // The reserved identifier selects the configured local dataset explicitly.
  // Otherwise an imported dependency cannot inherit the example ARN's binding.
  return arn === LOCAL_SALES_ARN && (identifier === LOCAL_IDENTIFIER || !bundle.members.some(m => m.resource.resourceType === 'dataset' && m.resource.dataSetId === 'renderable-sales'));
}
function importVisual(raw: BundleVisual, id: string, definition: BundleDefinition, bundle: QsBundle): AuthorVisual {
  const [variant, value] = Object.entries(raw)[0]!;
  const body = obj(value), config = obj(body.chartConfiguration), outer = obj(config.fieldWells);
  const kind = Object.hasOwn(kinds, variant) ? kinds[variant]! : 'bar';
  const wells = kind === 'kpi' ? obj(outer.kpiFieldWells ?? outer) : obj(Object.values(outer)[0]);
  const names = (v: unknown) => [...new Set(list(v).flatMap(f => {
    const column = obj(obj(Object.values(obj(f))[0]).column);
    return typeof column.columnName === 'string' ? [column.columnName] : [];
  }))];
  const rows = names(wells[kind === 'pivot' ? 'rows' : kind === 'table' ? 'groupBy' : 'category']);
  const columns = kind === 'pivot' ? names(wells.columns).filter(n => !rows.includes(n)) : [];
  const measures = names(wells.values);
  const total = obj(config.totalOptions);
  const visual: AuthorVisual = { ...defaults(), id, kind, title: string(obj(obj(body.title).formatText).plainText),
    titleVisible: obj(body.title).visibility !== 'HIDDEN', dimension: kind === 'kpi' ? null : rows[0] ?? null,
    rows: tabular(kind) ? rows : [], columns, measures: singleMeasure(kind) ? measures.slice(0, 1) : measures,
    donut: kind === 'pie' && ['SMALL', 'MEDIUM', 'LARGE'].includes(string(obj(obj(config.donutOptions).arcOptions).arcThickness)),
    legend: obj(config.legend).visibility !== 'HIDDEN', labels: obj(config.dataLabels).visibility === 'VISIBLE' || kind === 'pie' && obj(config.dataLabels).visibility === undefined,
    horizontal: config.orientation === 'HORIZONTAL', stacked: config.barsArrangement === 'STACKED',
    totals: (kind === 'pivot' ? obj(total.rowTotalOptions) : total).totalsVisibility === 'VISIBLE',
    subtotals: (kind === 'pivot' ? obj(total.rowSubtotalOptions) : obj(config.opensightSubtotalOptions)).totalsVisibility === 'VISIBLE',
  };
  const dataSets = [...new Set(references(body))].map(identifier => ({ identifier, arn: definition.dataSetIdentifierDeclarations.find(d => d.identifier === identifier)?.dataSetArn }));
  const issues = Object.hasOwn(kinds, variant) ? differences(raw, projectVisual(visual, raw), variant) : [`Unsupported visual type: ${variant}`];
  if (dataSets.length > 1) issues.push('Multiple datasets in one visual are unsupported');
  visual.imported = { visualId: string(body.visualId), variant, dataSets, issues, unmappedFields: [],
    local: dataSets.length === 1 && localBinding(dataSets[0]!.arn, bundle, dataSets[0]!.identifier),
    baseline: copy(visual), filterGroups: [],
  };
  return visual;
}

function scopeMatches(group: Obj, sheetId: string, visualId: string): boolean {
  const scope = obj(group.scopeConfiguration);
  return Object.hasOwn(scope, 'allSheets') || list(obj(scope.selectedSheets).sheetVisualScopingConfigurations).some(s => {
    const c = obj(s);
    return c.sheetId === sheetId && (c.scope === 'ALL_VISUALS' || list(c.visualIds).includes(visualId));
  });
}
function scopeResolved(group: Obj, definition: BundleDefinition): boolean {
  const scope = obj(group.scopeConfiguration);
  if (Object.hasOwn(scope, 'allSheets')) return true;
  const scopes = list(obj(scope.selectedSheets).sheetVisualScopingConfigurations);
  return scopes.length > 0 && scopes.every(value => {
    const s = obj(value), sheet = definition.sheets?.find(sheet => sheet.sheetId === s.sheetId);
    return !!sheet && (s.scope === 'ALL_VISUALS' || s.scope === 'SELECTED_VISUALS' && list(s.visualIds).every(id => sheet.visuals?.some(v => Object.values(v)[0]?.visualId === id)));
  });
}
/** Only a single, enabled EQUALS list on one visual can be edited without changing scope semantics. */
function editableFilter(group: Obj, sheet: AuthorSheet, visual: AuthorVisual): CategoryFilter | undefined {
  const scopes = list(obj(obj(group.scopeConfiguration).selectedSheets).sheetVisualScopingConfigurations);
  const scope = obj(scopes[0]), filters = list(group.filters), filter = obj(obj(filters[0]).categoryFilter);
  const config = obj(obj(filter.configuration).filterListConfiguration), column = obj(filter.column);
  if (group.status !== 'ENABLED' || group.crossDataset !== 'SINGLE_DATASET' || filters.length !== 1 || scopes.length !== 1 || scope.scope !== 'SELECTED_VISUALS' || scope.sheetId !== sheet.imported?.sheetId || !equal(scope.visualIds, [visual.imported?.visualId]) || config.matchOperator !== 'EQUALS' || config.nullOption !== 'NON_NULLS_ONLY' || !Array.isArray(config.categoryValues) || !config.categoryValues.every(v => typeof v === 'string' && !v.includes('\0')) || typeof column.columnName !== 'string' || !visual.imported?.dataSets.some(d => d.identifier === column.dataSetIdentifier)) return;
  if (!dataFields().some(f => f.name === column.columnName && f.type === 'STRING')) return;
  return { columnName: column.columnName, values: [...new Set(config.categoryValues as string[])] };
}

export function importBundle(bundle: QsBundle): AuthorDraft {
  const summary = summarizeQsBundle(bundle);
  const original = copy(bundle), draft = emptyDraft(), sheets: AuthorSheet[] = [], report: ImportResult[] = [];
  let visualIndex = 0;
  const primary = original.members.find(m => m.resource.resourceType === 'analysis') ?? original.members.find(m => m.resource.resourceType === 'dashboard');
  draft.title = primary?.resource.name ?? 'Imported resources';
  for (const member of original.members) {
    const r = member.resource, messages: string[] = [];
    report.push({ path: member.path, name: r.name, messages });
    if (r.resourceType !== 'analysis' && r.resourceType !== 'dashboard') {
      messages.push(`${r.resourceType}: retained verbatim; remote dataset connections are not resolved or executed.`);
      for (const key of Object.keys(r)) if (!['resourceType', 'dataSetId', 'dataSourceId', 'name'].includes(key)) messages.push(`${r.resourceType}.${key}: retained, read-only; not executed.`);
      continue;
    }
    const d = r.definition, calculationProblems = new Map<string, string>(), addedCalculations = new Set<CalculatedField>();
    for (const key of Object.keys(r)) if (!['resourceType', 'analysisId', 'dashboardId', 'name', 'definition'].includes(key)) messages.push(`${key}: retained, read-only.`);
    for (const key of Object.keys(d)) if (!['dataSetIdentifierDeclarations', 'sheets', 'calculatedFields', 'parameterDeclarations', 'filterGroups'].includes(key)) messages.push(`definition.${key}: retained, read-only.`);
    for (const declaration of d.dataSetIdentifierDeclarations) for (const key of Object.keys(declaration)) if (!['identifier', 'dataSetArn'].includes(key)) messages.push(`Dataset declaration ${declaration.identifier}.${key}: retained, read-only.`);
    for (const parameter of d.parameterDeclarations ?? []) {
      const [kind, value] = Object.entries(obj(parameter))[0]!;
      messages.push(`Parameter ${string(obj(value).name, kind)} features (${Object.keys(obj(value)).join(', ')}): display only.`);
      messages.push(`Parameter ${string(obj(value).name, kind)} (${kind}): display only; parameter editing and execution are unsupported.`);
    }
    for (const value of d.calculatedFields ?? []) {
      const c = obj(value), field: CalculatedField = { name: string(c.name), expression: string(c.expression), role: 'measure' };
      // Local authored calculations retain the v1 editor/query behavior. Foreign ones are display-only.
      const local = d.dataSetIdentifierDeclarations.some(ds => ds.identifier === c.dataSetIdentifier && localBinding(ds.dataSetArn, original, ds.identifier));
      const dimensionUse = (d.sheets ?? []).some(s => (s.visuals ?? []).some(v => {
        const imported = importVisual(v, 'visual-1', d, original);
        return imported.dimension === field.name || imported.rows.includes(field.name) || imported.columns.includes(field.name);
      }));
      if (dimensionUse) field.role = 'dimension';
      if (local) {
        const problem = calculationError(field, dataFields(draft.calculatedFields));
        if (!problem) { draft.calculatedFields.push(field); addedCalculations.add(field); }
        else if (!draft.calculatedFields.some(existing => equal(existing, field))) {
          calculationProblems.set(field.name, problem);
          messages.push(`Calculated field ${field.name}: display only — ${problem}`);
        }
      }
      for (const key of Object.keys(c)) if (!['dataSetIdentifier', 'name', 'expression'].includes(key)) {
        messages.push(`Calculated field ${field.name}.${key}: retained, read-only.`);
        if (local) calculationProblems.set(field.name, `unsupported property ${key}`);
      }
      messages.push(`Calculated field ${field.name} (${string(c.dataSetIdentifier)}): ${local ? 'imported where compatible; expression execution depends on the query engine' : 'display only; remote expression retained verbatim'}.`);
    }
    const calculations = summary.members.find(m => m.path === member.path)?.definition?.calculatedFields ?? [];
    // Conflicting/opaque calculations also block their transitive dependents.
    for (let pass = 0; pass < calculations.length; pass++) for (const c of calculations) {
      const dependency = c.dependencies.calculatedFields.find(name => calculationProblems.has(name));
      if (dependency && !calculationProblems.has(c.name)) calculationProblems.set(c.name, `depends on unsupported calculated field ${dependency}`);
    }
    // Keep unsupported expressions in the read-only panel, out of the selectable
    // local field list, so newly authored cards cannot bypass their diagnostics.
    draft.calculatedFields = draft.calculatedFields.filter(field => !addedCalculations.has(field) || !calculationProblems.has(field.name));
    for (const s of d.sheets ?? []) {
      const id = `sheet-${sheets.length + 1}`, visuals = (s.visuals ?? []).map(v => importVisual(v, `visual-${++visualIndex}`, d, original));
      const layout = grid(s, visuals);
      const sheet: AuthorSheet = { id, name: s.name?.trim() || 'Untitled sheet', visuals, layout, selectedId: visuals[0]?.id ?? null,
        imported: { memberPath: member.path, sheetId: s.sheetId, name: s.name?.trim() || 'Untitled sheet', layout: copy(layout) } };
      sheets.push(sheet);
      messages.push(`Sheet ${s.name ?? s.sheetId}: ${visuals.length} visual(s) imported.`);
      for (const key of Object.keys(s)) if (!['sheetId', 'name', 'visuals', 'layouts'].includes(key)) messages.push(`Sheet ${s.sheetId}.${key}: retained, read-only.`);
      if (s.layouts?.length) messages.push(`Sheet ${s.sheetId}.layouts: grid geometry projected where compatible; original layouts and other layout features retained until edited.`);
      for (const v of visuals) {
        const meta = v.imported!;
        for (const name of [v.dimension, ...v.rows, ...v.columns, ...v.measures]) if (name && calculationProblems.has(name)) meta.issues.push(`Calculated field ${name}: ${calculationProblems.get(name)}`);
        messages.push(`Visual ${meta.visualId} (${meta.variant}): ${meta.local ? 'local sales binding' : `unresolved dataset ${meta.dataSets.map(d => d.arn ?? d.identifier).join(', ') || '(none)'}`}.`);
        for (const value of d.filterGroups ?? []) {
          const group = obj(value);
          if (!scopeResolved(group, d) && group.status !== 'DISABLED') {
            meta.issues.push(`Filter group ${string(group.filterGroupId)}: unresolved scope; execution blocked for the resource`);
            continue;
          }
          if (!scopeMatches(group, s.sheetId, meta.visualId)) continue;
          const filter = editableFilter(group, sheet, v);
          if (filter && !v.filters.some(f => f.columnName === filter.columnName)) {
            v.filters.push(filter); meta.filterGroups.push({ id: string(group.filterGroupId), columnName: filter.columnName });
            const projected = obj(generatedFilters(sheet, { ...v, filters: [filter] }, meta.dataSets[0]?.identifier ?? '')[0]);
            projected.filterGroupId = group.filterGroupId;
            obj(obj(list(projected.filters)[0]).categoryFilter).filterId = obj(obj(list(group.filters)[0]).categoryFilter).filterId;
            meta.issues.push(...differences(group, projected, `Filter group ${string(group.filterGroupId)}`));
          } else if (group.status !== 'DISABLED') meta.issues.push(`Filter group ${string(group.filterGroupId)}: scope or filter semantics are display-only`);
        }
        messages.push(...meta.issues.map(issue => `Visual ${meta.visualId}: ${issue}`));
        meta.baseline = copy({ ...v, imported: undefined });
      }
    }
    for (const value of d.filterGroups ?? []) {
      const group = obj(value), editable = sheets.some(s => s.imported?.memberPath === member.path && s.visuals.some(v => v.imported?.filterGroups.some(g => g.id === group.filterGroupId)));
      for (const key of Object.keys(group)) if (!['filterGroupId', 'crossDataset', 'status', 'scopeConfiguration', 'filters'].includes(key)) messages.push(`Filter group ${string(group.filterGroupId)}.${key}: retained, read-only.`);
      messages.push(`Filter group ${string(group.filterGroupId)} (${list(group.filters).flatMap(f => Object.keys(obj(f))).join(', ')}): ${editable ? 'editable category list in Properties' : 'display only; scope, status and configuration retained'}.`);
    }
  }
  if (sheets.length) { draft.sheets = sheets; draft.activeSheetId = sheets[0]!.id; }
  draft.bundle = { original, primaryPath: primary?.path ?? '', title: draft.title, report, calculations: copy(draft.calculatedFields), ...(!sheets.length ? { emptySheetId: draft.activeSheetId } : {}) };
  validateDraft(draft);
  return draft;
}

/** Check File.size before allocating; all parsing is local and atomic. */
export async function importBundleFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<AuthorDraft> {
  const json = /\.json$/iu.test(file.name);
  if (!json && !/\.qs$/iu.test(file.name)) throw new Error('Choose a .qs ZIP or a single bundle .json member.');
  if (file.size > (json ? ZIP_LIMITS.memberBytes : ZIP_LIMITS.archiveBytes)) throw new Error(json ? 'JSON exceeds member byte limit' : 'ZIP exceeds archive byte limit');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importBundle(json ? parseBundleJson(bytes) : await parseQsBundle(bytes));
}

/** Apply only edited projected properties. Unknown siblings and untouched subtrees survive. */
function patch(raw: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return copy(raw);
  if (Array.isArray(after)) {
    const identity = (v: unknown) => string(obj(obj(Object.values(obj(v))[0]).column).columnName);
    return after.map((v, i) => {
      const name = identity(v), oldIndex = name ? list(before).findIndex(b => identity(b) === name) : i;
      const rawIndex = name ? list(raw).findIndex(b => identity(b) === name) : i;
      return oldIndex < 0 || rawIndex < 0 ? copy(v) : patch(list(raw)[rawIndex], list(before)[oldIndex], v);
    });
  }
  if (after !== null && typeof after === 'object') {
    const result = { ...obj(raw) };
    for (const key of new Set([...Object.keys(obj(before)), ...Object.keys(obj(after))])) {
      if (equal(obj(before)[key], obj(after)[key])) continue;
      if (!Object.hasOwn(obj(after), key)) delete result[key];
      else Object.defineProperty(result, key, { value: patch(obj(raw)[key], obj(before)[key], obj(after)[key]), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  return copy(after);
}
function rebind(value: unknown, identifier: string): void {
  if (Array.isArray(value)) { value.forEach(v => rebind(v, identifier)); return; }
  const o = obj(value);
  if (typeof o.dataSetIdentifier === 'string') o.dataSetIdentifier = identifier;
  Object.values(o).forEach(v => { if (v && typeof v === 'object') rebind(v, identifier); });
}
/** Match the original well wrapper and dataset identifiers when projecting edits. */
function projectVisual(visual: AuthorVisual, raw: BundleVisual): BundleVisual {
  const projected = serializeVisual(visual), body = obj(Object.values(projected)[0]), original = obj(Object.values(raw)[0]);
  const originalWells = obj(obj(original.chartConfiguration).fieldWells), config = obj(body.chartConfiguration);
  const identifiers = new Map<string, string>();
  const collect = (value: unknown): void => {
    const o = obj(value), column = obj(o.column);
    if (typeof column.columnName === 'string' && typeof column.dataSetIdentifier === 'string') identifiers.set(column.columnName, column.dataSetIdentifier);
    Object.values(o).forEach(v => { if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object') collect(v); });
  };
  collect(originalWells);
  const assign = (value: unknown): void => {
    const o = obj(value), column = obj(o.column);
    if (typeof column.columnName === 'string') column.dataSetIdentifier = identifiers.get(column.columnName) ?? [...identifiers.values()][0] ?? 'sales_data';
    Object.values(o).forEach(v => { if (Array.isArray(v)) v.forEach(assign); else if (v && typeof v === 'object') assign(v); });
  };
  assign(config.fieldWells);
  if (visual.kind === 'kpi' && Object.hasOwn(originalWells, 'kpiFieldWells')) config.fieldWells = { kpiFieldWells: config.fieldWells };
  return projected;
}
const usesRemappedDataset = (meta: ImportedVisual): boolean => meta.local && (!!meta.remapped || !meta.dataSets.every(d => d.arn === LOCAL_SALES_ARN));
function exportVisual(v: AuthorVisual, raw: BundleVisual | undefined): BundleVisual {
  if (!v.imported || !raw) return serializeVisual(v);
  const meta = v.imported, baseline = meta.baseline;
  const before = obj(Object.values(projectVisual(baseline, raw))[0]), after = obj(Object.values(projectVisual(v, raw))[0]);
  const originalBody = Object.values(raw)[0]!;
  const changedKind = !!meta.replaced;
  const body = changedKind ? Object.values(serializeVisual(v))[0]! : patch(originalBody, before, after) as typeof originalBody;
  body.visualId = meta.visualId;
  if (!changedKind && v.title !== baseline.title && v.title.trim()) {
    // Rich/plain text are a union; a plain-title edit replaces that union, not its unknown siblings.
    body.title = { ...obj(body.title), formatText: { plainText: v.title.trim() } };
  }
  if (usesRemappedDataset(meta)) {
    // A remap intentionally replaces editable wells. The complete original resource is archived on export.
    const generated = obj(Object.values(changedKind ? serializeVisual(v) : projectVisual(v, raw))[0]).chartConfiguration;
    const config = obj(body.chartConfiguration);
    config.fieldWells = copy(obj(generated).fieldWells); body.chartConfiguration = config;
    rebind(config.fieldWells, LOCAL_IDENTIFIER);
  }
  if (changedKind && !usesRemappedDataset(meta)) rebind(obj(body.chartConfiguration).fieldWells, meta.dataSets[0]?.identifier ?? 'sales_data');
  return { [changedKind ? Object.keys(serializeVisual(v))[0]! : meta.variant]: body };
}
function exportLayout(sheet: AuthorSheet, raw: BundleSheet): void {
  if (sheet.imported && equal(sheet.layout, sheet.imported.layout)) return;
  const layouts = copy(raw.layouts ?? []), first = obj(layouts[0]), config = obj(first.configuration), grid = obj(config.gridLayout);
  // Layout configurations are a union. A grid edit replaces a free-form or
  // paginated variant; the extension preserves the complete original layout.
  delete config.freeFormLayout; delete config.sectionBasedLayout;
  const old = list(grid.elements);
  grid.elements = [...old.filter(e => obj(e).elementType !== 'VISUAL'), ...sheet.layout.map(p => {
    const id = sheet.visuals.find(v => v.id === p.i)?.imported?.visualId ?? p.i;
    return { ...obj(old.find(e => obj(e).elementId === id)), elementId: id, elementType: 'VISUAL', columnIndex: p.x * 3, columnSpan: p.w * 3, rowIndex: p.y, rowSpan: p.h };
  })];
  config.gridLayout = grid; first.configuration = config; layouts[0] = first; raw.layouts = layouts;
}
function generatedFilters(sheet: AuthorSheet, visual: AuthorVisual, identifier: string, existingIds: ReadonlySet<string> = new Set()): unknown[] {
  const visualId = visual.imported?.visualId ?? visual.id;
  const used = new Set(existingIds);
  return visual.filters.map((filter, i) => {
    let id = `${visualId}-opensight-filter-${i}`;
    while (used.has(id)) id = `${visualId}-opensight-filter-${++i}`;
    used.add(id);
    return { filterGroupId: id, status: 'ENABLED', crossDataset: 'SINGLE_DATASET',
      scopeConfiguration: { selectedSheets: { sheetVisualScopingConfigurations: [{ sheetId: sheet.imported?.sheetId ?? sheet.id, scope: 'SELECTED_VISUALS', visualIds: [visualId] }] } },
      filters: [{ categoryFilter: { filterId: id, column: { dataSetIdentifier: identifier, columnName: filter.columnName },
        configuration: { filterListConfiguration: { matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', categoryValues: copy(filter.values) } } } }],
    };
  });
}

export function exportBundle(draft: AuthorDraft): QsBundle {
  validateDraft(draft);
  if (!draft.bundle) {
    const resource = serializeDraft(draft), bundle = { members: [{ path: `analysis/${resource.analysisId}.json`, resource }] };
    summarizeQsBundle(bundle); return bundle;
  }
  const origin = draft.bundle, bundle = copy(origin.original);
  for (const member of bundle.members) {
    const r = member.resource;
    if (r.resourceType !== 'analysis' && r.resourceType !== 'dashboard') continue;
    const d = r.definition, primary = member.path === origin.primaryPath;
    if (primary && draft.title !== origin.title) r.name = draft.title.trim() || 'Untitled analysis';
    const sheets = draft.sheets.filter(s => s.imported ? s.imported.memberPath === member.path : primary && (s.id !== origin.emptySheetId || s.visuals.length > 0 || s.name !== 'Sheet 1'));
    if (d.sheets !== undefined || sheets.length) d.sheets = sheets.map(sheet => {
      const raw = copy(d.sheets?.find(s => s.sheetId === sheet.imported?.sheetId) ?? { sheetId: sheet.id, name: sheet.name });
      if (!sheet.imported || sheet.name !== sheet.imported.name) raw.name = sheet.name;
      if (raw.visuals !== undefined || sheet.visuals.length) raw.visuals = sheet.visuals.map(v => exportVisual(v, raw.visuals?.find(r => Object.values(r)[0]?.visualId === v.imported?.visualId)));
      exportLayout(sheet, raw);
      return raw;
    });
    const originalResource = origin.original.members.find(m => m.path === member.path)!.resource;
    if ((originalResource.resourceType === 'analysis' || originalResource.resourceType === 'dashboard') && d.filterGroups) {
      const originalSheets = originalResource.definition.sheets ?? [];
      d.filterGroups = d.filterGroups.flatMap(value => {
        const group = obj(value), selected = obj(obj(group.scopeConfiguration).selectedSheets);
        if (!Array.isArray(selected.sheetVisualScopingConfigurations)) return [value];
        const scopes = selected.sheetVisualScopingConfigurations;
        let changed = false;
        const next = scopes.flatMap(value => {
          const scope = obj(value), previous = originalSheets.find(s => s.sheetId === scope.sheetId), current = d.sheets?.find(s => s.sheetId === scope.sheetId);
          if (!previous) return [value];
          if (!current) { changed = true; return []; }
          if (scope.scope !== 'SELECTED_VISUALS') return [value];
          const ids = list(scope.visualIds).filter(id => !previous.visuals?.some(v => Object.values(v)[0]?.visualId === id) || current.visuals?.some(v => Object.values(v)[0]?.visualId === id));
          if (equal(ids, scope.visualIds)) return [value];
          changed = true;
          return ids.length ? [{ ...scope, visualIds: ids }] : [];
        });
        if (!changed) return [value];
        selected.sheetVisualScopingConfigurations = next;
        return next.length ? [value] : [];
      });
    }
    const needsLocal = sheets.some(s => s.visuals.some(v => !v.imported || usesRemappedDataset(v.imported)));
    if (needsLocal) {
      if (d.dataSetIdentifierDeclarations.some(ds => ds.identifier === LOCAL_IDENTIFIER && ds.dataSetArn !== LOCAL_SALES_ARN)) throw new Error(`Cannot export: ${LOCAL_IDENTIFIER} is already bound to another dataset.`);
      if (!d.dataSetIdentifierDeclarations.some(ds => ds.identifier === LOCAL_IDENTIFIER)) d.dataSetIdentifierDeclarations.push({ identifier: LOCAL_IDENTIFIER, dataSetArn: LOCAL_SALES_ARN });
      for (const sheet of d.sheets ?? []) for (const visual of sheet.visuals ?? []) {
        const authorSheet = sheets.find(s => (s.imported?.sheetId ?? s.id) === sheet.sheetId);
        const authorVisual = authorSheet?.visuals.find(v => (v.imported?.visualId ?? v.id) === Object.values(visual)[0]?.visualId);
        if (authorVisual && !authorVisual.imported) rebind(visual, LOCAL_IDENTIFIER);
      }
    }
    for (const sheet of sheets) for (const v of sheet.visuals) {
      const meta = v.imported, identifier = meta?.local ? usesRemappedDataset(meta) ? LOCAL_IDENTIFIER : meta.dataSets[0]?.identifier ?? LOCAL_IDENTIFIER : meta?.dataSets[0]?.identifier ?? LOCAL_IDENTIFIER;
      const before = meta?.baseline.filters ?? [];
      if (equal(before, v.filters) && !(meta && usesRemappedDataset(meta))) continue;
      const existing = d.filterGroups ?? [];
      for (const binding of meta?.filterGroups ?? []) {
        const group = existing.find(g => obj(g).filterGroupId === binding.id), filter = v.filters.find(f => f.columnName === binding.columnName);
        if (!group) continue;
        if (!filter) existing.splice(existing.indexOf(group), 1);
        else {
          const category = obj(obj(list(obj(group).filters)[0]).categoryFilter);
          obj(category.column).dataSetIdentifier = identifier;
          obj(obj(category.configuration).filterListConfiguration).categoryValues = copy(filter.values);
        }
      }
      const added = v.filters.filter(f => !meta?.filterGroups.some(g => g.columnName === f.columnName));
      if (added.length) existing.push(...generatedFilters(sheet, { ...v, filters: added }, identifier, new Set(existing.map(g => string(obj(g).filterGroupId)))));
      if (existing.length || d.filterGroups !== undefined) d.filterGroups = existing;
    }
    if ((primary || sheets.some(s => s.visuals.some(v => !v.imported || v.imported.local))) && !equal(draft.calculatedFields, origin.calculations)) {
      const added = draft.calculatedFields.filter(f => !origin.calculations.some(c => c.name === f.name));
      if (added.length) {
        let localIds = d.dataSetIdentifierDeclarations.filter(ds => ds.dataSetArn === LOCAL_SALES_ARN).map(ds => ds.identifier);
        if (!localIds.length) {
          if (d.dataSetIdentifierDeclarations.some(ds => ds.identifier === LOCAL_IDENTIFIER)) throw new Error(`Cannot export: ${LOCAL_IDENTIFIER} is already bound to another dataset.`);
          d.dataSetIdentifierDeclarations.push({ identifier: LOCAL_IDENTIFIER, dataSetArn: LOCAL_SALES_ARN }); localIds = [LOCAL_IDENTIFIER];
        }
        d.calculatedFields = [...(d.calculatedFields ?? []), ...localIds.flatMap(dataSetIdentifier => added.map(({ name, expression }) => ({ name, expression, dataSetIdentifier })))];
      }
    }
  }
  // A dataset-only import can still become an authored analysis without losing dependency members.
  if (!origin.primaryPath && (draft.sheets.some(s => s.visuals.length || s.id !== origin.emptySheetId || s.name !== 'Sheet 1') || draft.calculatedFields.length || draft.title !== origin.title)) {
    const resource = serializeDraft({ ...draft, bundle: undefined });
    bundle.members.push({ path: `analysis/${resource.analysisId}.json`, resource });
  }
  for (const member of bundle.members) {
    const original = origin.original.members.find(m => m.path === member.path)?.resource;
    if (!original || equal(original, member.resource)) continue;
    if (Object.hasOwn(original, 'opensightRoundTrip')) {
      const extension = obj(original.opensightRoundTrip);
      if (extension.version !== 1 || !extension.originalResource || (extension.priorResources !== undefined && !Array.isArray(extension.priorResources))) throw new Error('Export blocked: reserved opensightRoundTrip extension already exists with an unsupported value.');
      const snapshot = copy(original); delete snapshot.opensightRoundTrip;
      const prior = list(extension.priorResources);
      if (!equal(snapshot, extension.originalResource) && !prior.some(r => equal(r, snapshot))) {
        member.resource.opensightRoundTrip = { ...extension, priorResources: [...copy(prior), snapshot] };
      }
    } else member.resource.opensightRoundTrip = { version: 1, originalResource: copy(original) };
  }
  summarizeQsBundle(bundle);
  return bundle;
}
export const downloadBundleBytes = (draft: AuthorDraft): Promise<Uint8Array> => assembleQsBundle(exportBundle(draft));

/** Newly added cards must not ignore read-only all-sheet filters in an imported definition. */
export function importedFilterProblem(draft: AuthorDraft, sheet: AuthorSheet, visual: AuthorVisual): string | undefined {
  const resource = draft.bundle?.original.members.find(m => m.path === (sheet.imported?.memberPath ?? draft.bundle?.primaryPath))?.resource;
  if (!resource || (resource.resourceType !== 'analysis' && resource.resourceType !== 'dashboard')) return;
  const blocked = (resource.definition.filterGroups ?? []).filter(value => {
    const group = obj(value);
    return group.status !== 'DISABLED' && (!scopeResolved(group, resource.definition) || scopeMatches(group, sheet.imported?.sheetId ?? sheet.id, visual.imported?.visualId ?? visual.id) && !visual.imported?.filterGroups.some(g => g.id === group.filterGroupId));
  });
  if (blocked.length) return `Unsupported filter groups: ${blocked.map(g => string(obj(g).filterGroupId)).join(', ')} (display only)`;
}

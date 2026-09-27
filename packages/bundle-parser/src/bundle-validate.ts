import type { BundleResource } from './bundle-types.js';
import { bundleCalculation, bundleColumn, bundleFilterGroup, bundleParameter } from './bundle-features.js';
import {
  array, enumeration, fail, nonempty, object, optional, required, singleVariant,
  string, type Validator,
} from './validation.js';

const opaqueArray = array(() => {});

const columnField: Validator = (value, path) => {
  const f = object(value, path);
  required(f, 'fieldId', path, nonempty);
  required(f, 'column', path, bundleColumn);
  optional(f, 'dateGranularity', path, nonempty);
  optional(f, 'formatConfiguration', path, object);
};

const dimension: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  if (['categoricalDimensionField', 'dateDimensionField', 'numericalDimensionField'].includes(kind)) columnField(body, `${path}.${kind}`);
};

const measure: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  const p = `${path}.${kind}`;
  if (kind === 'calculatedMeasureField') {
    required(body, 'fieldId', p, nonempty);
    required(body, 'expression', p, nonempty);
    return;
  }
  if (!['numericalMeasureField', 'categoricalMeasureField', 'dateMeasureField'].includes(kind)) return;
  columnField(body, p);
  optional(body, 'aggregationFunction', p, (value, p) => {
    if (kind !== 'numericalMeasureField') { nonempty(value, p); return; }
    optional(object(value, p), 'simpleNumericalAggregation', p, nonempty);
  });
};

const title: Validator = (value, path) => {
  const t = object(value, path);
  optional(t, 'visibility', path, string);
  optional(t, 'formatText', path, (value, p) => {
    const [kind, text] = Object.entries(object(value, p))[0] ?? [];
    if (Object.keys(value as object).length !== 1 || (kind !== 'plainText' && kind !== 'richText')) fail(p, 'expected plainText or richText');
    string(text, `${p}.${kind}`);
  });
};

const wellKinds: Record<string, string> = {
  pieChartVisual: 'pieChartAggregatedFieldWells', barChartVisual: 'barChartAggregatedFieldWells',
  lineChartVisual: 'lineChartAggregatedFieldWells', tableVisual: 'tableAggregatedFieldWells',
  comboChartVisual: 'comboChartAggregatedFieldWells', scatterPlotVisual: 'scatterPlotCategoricallyAggregatedFieldWells',
  kpiVisual: 'kpiFieldWells',
};
const fieldWells: Validator = (value, path) => {
  const wells = object(value, path);
  for (const key of ['category', 'groupBy', 'colors', 'smallMultiples', 'trendGroups', 'label']) optional(wells, key, path, array(dimension));
  for (const key of ['values', 'targetValues', 'barValues', 'lineValues', 'xAxis', 'yAxis', 'size']) optional(wells, key, path, array(measure));
};

const visual: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  const p = `${path}.${kind}`;
  required(body, 'visualId', p, nonempty);
  optional(body, 'title', p, title);
  optional(body, 'subtitle', p, title);
  if (!Object.hasOwn(wellKinds, kind)) return;
  optional(body, 'actions', p, opaqueArray);
  optional(body, 'columnHierarchies', p, opaqueArray);
  optional(body, 'chartConfiguration', p, (value, p) => {
    const c = object(value, p);
    for (const key of ['sortConfiguration', 'donutOptions', 'dataLabels', 'tooltip', 'kpiOptions', 'tableOptions']) {
      optional(c, key, p, object);
    }
    optional(c, 'fieldWells', p, (value, p) => {
      // Public samples contain both direct KPI wells and a KPIFieldWells wrapper.
      if (kind === 'kpiVisual' && !Object.hasOwn(object(value, p), 'kpiFieldWells')) {
        if (!['values', 'targetValues', 'trendGroups'].some(key => Object.hasOwn(value as object, key))) fail(p, 'expected KPI values, targetValues or trendGroups');
        fieldWells(value, p);
        return;
      }
      const [wellKind, wells] = singleVariant(value, p);
      if (wellKind !== wellKinds[kind]) fail(p, `expected ${wellKinds[kind]}`);
      fieldWells(wells, `${p}.${wellKind}`);
    });
  });
};

const definition: Validator = (value, path) => {
  const d = object(value, path);
  required(d, 'dataSetIdentifierDeclarations', path, array((value, p) => {
    const ds = object(value, p);
    required(ds, 'identifier', p, nonempty);
    required(ds, 'dataSetArn', p, nonempty);
  }));
  optional(d, 'sheets', path, array((value, p) => {
    const s = object(value, p);
    required(s, 'sheetId', p, nonempty);
    optional(s, 'name', p, string);
    optional(s, 'visuals', p, array(visual));
    optional(s, 'layouts', p, array(object));
    optional(s, 'contentType', p, string);
  }));
  optional(d, 'calculatedFields', path, array(bundleCalculation));
  optional(d, 'parameterDeclarations', path, array(bundleParameter));
  optional(d, 'filterGroups', path, array(bundleFilterGroup));
  for (const key of ['analysisDefaults', 'options', 'queryExecutionOptions']) {
    optional(d, key, path, object);
  }
  // Duplicate identities make inventories and calculated-field references ambiguous.
  const unique = (values: unknown, p: string, identity: (v: Record<string, unknown>) => string | undefined): void => {
    const seen = new Set<string>();
    (values as unknown[] | undefined)?.forEach((value, index) => {
      const id = identity(object(value, `${p}[${index}]`));
      if (id === undefined) return;
      if (seen.has(id)) fail(`${p}[${index}]`, 'duplicate identity');
      seen.add(id);
    });
  };
  unique(d.dataSetIdentifierDeclarations, `${path}.dataSetIdentifierDeclarations`, v => v.identifier as string);
  unique(d.sheets, `${path}.sheets`, v => v.sheetId as string);
  (d.sheets as Record<string, unknown>[] | undefined)?.forEach((s, index) => {
    unique(s.visuals, `${path}.sheets[${index}].visuals`, v => singleVariant(v, path)[1].visualId as string);
  });
  unique(d.calculatedFields, `${path}.calculatedFields`, v => JSON.stringify([v.dataSetIdentifier, v.name]));
  unique(d.parameterDeclarations, `${path}.parameterDeclarations`, v => {
    const name = singleVariant(v, path)[1].name;
    return typeof name === 'string' ? name : undefined;
  });
  unique(d.filterGroups, `${path}.filterGroups`, v => v.filterGroupId as string);
  (d.filterGroups as Record<string, unknown>[] | undefined)?.forEach((g, index) => {
    unique(g.filters, `${path}.filterGroups[${index}].filters`, v => {
      const id = singleVariant(v, path)[1].filterId;
      return typeof id === 'string' ? id : undefined;
    });
  });
};

const physicalTable: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  if (kind !== 'relationalTable') return;
  const p = `${path}.${kind}`;
  required(body, 'dataSourceArn', p, nonempty);
  required(body, 'name', p, nonempty);
  optional(body, 'catalog', p, string);
  optional(body, 'schema', p, string);
  required(body, 'inputColumns', p, array((value, p) => {
    const c = object(value, p);
    required(c, 'name', p, nonempty);
    required(c, 'type', p, nonempty);
    optional(c, 'id', p, nonempty);
  }));
};

/** Only typed properties are validated; unobserved configuration stays opaque. */
export function assertBundleResource(raw: unknown, path = '$'): asserts raw is BundleResource {
  const r = object(raw, path);
  required(r, 'resourceType', path, enumeration('analysis', 'dashboard', 'dataset', 'datasource'));
  required(r, 'name', path, nonempty);
  switch (r.resourceType) {
    case 'analysis':
    case 'dashboard':
      required(r, r.resourceType === 'analysis' ? 'analysisId' : 'dashboardId', path, nonempty);
      required(r, 'definition', path, definition);
      optional(r, 'validationStrategy', path, (value, p) => {
        required(object(value, p), 'mode', p, nonempty);
      });
      if (r.resourceType === 'dashboard') {
        optional(r, 'dashboardPublishOptions', path, object);
        optional(r, 'linkEntities', path, array(nonempty));
      }
      break;
    case 'dataset':
      required(r, 'dataSetId', path, nonempty);
      required(r, 'importMode', path, nonempty);
      required(r, 'physicalTableMap', path, (value, p) => {
        for (const [key, table] of Object.entries(object(value, p))) {
          physicalTable(table, `${p}[${JSON.stringify(key)}]`);
        }
      });
      for (const key of ['dataSetRefreshProperties', 'dataPrepConfiguration', 'semanticModelConfiguration']) {
        optional(r, key, path, object);
      }
      break;
    case 'datasource':
      required(r, 'dataSourceId', path, nonempty);
      required(r, 'type', path, nonempty);
      optional(r, 'dataSourceParameters', path, (value, p) => {
        optional(object(value, p), 'athenaParameters', p, (value, p) => {
          optional(object(value, p), 'workGroup', p, string);
        });
      });
      optional(r, 'sslProperties', path, (value, p) => {
        optional(object(value, p), 'disableSsl', p, (value, p) => {
          if (typeof value !== 'boolean') fail(p, 'expected a boolean');
        });
      });
  }
}

/** Retains the original object, including unknown properties and absent fields. */
export function parseBundleResource(raw: unknown): BundleResource {
  assertBundleResource(raw);
  return raw;
}

import type { BundleResource } from './bundle-types.js';
import {
  array, enumeration, fail, nonempty, object, optional, required, singleVariant,
  string, type Validator,
} from './validation.js';

const opaqueArray = array(() => {});

const columnField: Validator = (value, path) => {
  const f = object(value, path);
  required(f, 'fieldId', path, nonempty);
  required(f, 'column', path, (value, p) => {
    const c = object(value, p);
    required(c, 'dataSetIdentifier', p, nonempty);
    required(c, 'columnName', p, nonempty);
  });
};

const dimension: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  if (kind === 'categoricalDimensionField') columnField(body, `${path}.${kind}`);
};

const measure: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  if (kind !== 'numericalMeasureField') return;
  const p = `${path}.${kind}`;
  columnField(body, p);
  optional(body, 'aggregationFunction', p, (value, p) => {
    optional(object(value, p), 'simpleNumericalAggregation', p, nonempty);
  });
};

const title: Validator = (value, path) => {
  optional(object(value, path), 'visibility', path, string);
};

const visual: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  const p = `${path}.${kind}`;
  required(body, 'visualId', p, nonempty);
  optional(body, 'title', p, title);
  optional(body, 'subtitle', p, title);
  if (kind !== 'pieChartVisual') return;
  optional(body, 'actions', p, opaqueArray);
  optional(body, 'columnHierarchies', p, opaqueArray);
  optional(body, 'chartConfiguration', p, (value, p) => {
    const c = object(value, p);
    for (const key of ['sortConfiguration', 'donutOptions', 'dataLabels', 'tooltip']) {
      optional(c, key, p, object);
    }
    optional(c, 'fieldWells', p, (value, p) => {
      const [kind, wells] = singleVariant(value, p);
      if (kind !== 'pieChartAggregatedFieldWells') return;
      optional(wells, 'category', `${p}.${kind}`, array(dimension));
      optional(wells, 'values', `${p}.${kind}`, array(measure));
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
  for (const key of ['calculatedFields', 'parameterDeclarations', 'filterGroups']) {
    optional(d, key, path, opaqueArray);
  }
  for (const key of ['analysisDefaults', 'options', 'queryExecutionOptions']) {
    optional(d, key, path, object);
  }
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

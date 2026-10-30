import { datetime, numeric, type Interpretation } from '@opensight/o-interpreter';
import { calculationInfo, dataFields, defaults, type AuthorDataset, type AuthorVisual, type CalculatedField } from './authoring.js';

export interface PreparedOVisual { visual: AuthorVisual; calculatedFields: CalculatedField[] }
/** O compiles into ordinary Phase 2c expressions and scoped filters, shared by all engines. */
export function prepareOVisual(interpretation: Interpretation, existing: readonly CalculatedField[] = [], dataset?: AuthorDataset): PreparedOVisual {
  const fields = dataFields(existing, dataset), calculatedFields: CalculatedField[] = [];
  const field = (name: string) => {
    const f = fields.find(f => f.name === name);
    if (!f || /[{}\0]/.test(name)) throw new Error(`O_UNKNOWN_FIELD: ${name}`);
    if (existing.some(c => c.name === name) && ![undefined, 'row'].includes(calculationInfo(name, existing, dataset).level)) throw new Error(`O_UNSUPPORTED_CALCULATION: ${name} is already an aggregate or table calculation.`);
    return f;
  };
  // Edits can reach combinations the parser never constructs. Reject them before
  // helpers or a query are produced, retaining the normal preview error surface.
  if (!['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].includes(interpretation.aggregation)
    || (interpretation.measure === null || !numeric(field(interpretation.measure))) && interpretation.aggregation !== 'COUNT') throw new Error('O_UNSUPPORTED_INTERPRETATION: This measure supports only compatible aggregations (COUNT for non-numeric fields or rows).');
  if (interpretation.topN !== null && (!Number.isSafeInteger(interpretation.topN) || interpretation.topN < 1 || interpretation.topN > 10000)) throw new Error('O_INVALID_TOP_N: Use one Top N integer from 1 to 10,000.');
  if (interpretation.topN !== null && !interpretation.dimensions.length) throw new Error('O_MISSING_DIMENSION: Top N needs a grouping field.');
  const kind = interpretation.suggestedVisualType;
  if (!['bar', 'line', 'pie', 'table', 'kpi'].includes(kind)
    || kind === 'kpi' && interpretation.dimensions.length > 0
    || kind !== 'table' && interpretation.dimensions.length > 1) throw new Error('O_UNSUPPORTED_INTERPRETATION: Use table for multiple dimensions, or remove dimensions for a KPI.');
  if (kind !== 'kpi' && !interpretation.dimensions.length) throw new Error('O_MISSING_DIMENSION: This visual needs a grouping field. Choose KPI for an ungrouped measure.');
  if (interpretation.granularity !== null && (!['YEAR', 'QUARTER', 'MONTH', 'DAY'].includes(interpretation.granularity)
    || !interpretation.dimensions.some(name => datetime(field(name))))) throw new Error('O_UNSUPPORTED_INTERPRETATION: Granularity needs a datetime grouping field.');
  const ref = (name: string) => { field(name); return `{${name}}`; };
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const add = (label: string, expression: string, role: CalculatedField['role']) => {
    // Reuse equivalent helpers; never overwrite an existing field or expression.
    const found = [...existing, ...calculatedFields].find(c => c.expression === expression && c.role === role);
    if (found) return found.name;
    const base = `O ${label}`.replace(/[^A-Za-z0-9_ ]/g, ' ').slice(0, 110);
    let name = base, n = 2;
    while ([...fields, ...calculatedFields].some(f => f.name.toLowerCase() === name.toLowerCase())) name = `${base} ${n++}`;
    calculatedFields.push({ name, expression, role }); return name;
  };
  const aggregation = interpretation.aggregation.toLowerCase();
  const expression = interpretation.measure === null ? 'count(1)' : `${aggregation}(${ref(interpretation.measure)})`;
  const measure = add(`${aggregation} ${interpretation.measure ?? 'rows'}`, expression, 'measure');
  const grain = interpretation.granularity ?? 'MONTH';
  const dates = interpretation.dimensions.filter(name => datetime(field(name)));
  const dimensions = interpretation.dimensions.map(name => {
    const f = field(name);
    if (dates.length > 1 && datetime(f)) return add(`${name} ${grain.toLowerCase()}`, `formatDate(truncDate('${({ YEAR: 'YYYY', QUARTER: 'Q', MONTH: 'MM', DAY: 'DD' })[grain]}', ${ref(name)}), 'yyyy-MM-dd')`, 'dimension');
    return numeric(f) ? add(`${name} category`, `toString(${ref(name)})`, 'dimension') : name;
  });
  const filters = interpretation.filters.map(f => {
    const source = field(f.field);
    if (f.operator === 'year') return { columnName: add(`${f.field} year`, `formatDate(${ref(f.field)}, 'yyyy')`, 'dimension'), values: [String(f.value)] };
    if (numeric(source) || datetime(source)) {
      const value = datetime(source) ? `parseDate(${literal(String(f.value))})` : String(f.value);
      return { columnName: add(`${f.field} matches`, `ifelse(${ref(f.field)} = ${value}, 'yes', 'no')`, 'dimension'), values: ['yes'] };
    }
    return { columnName: f.field, values: [String(f.value)] };
  });
  if (interpretation.topN !== null) {
    // Every grouping key breaks measure ties, making this exactly N groups, deterministically.
    const sort = [expression + ' DESC', ...dimensions.map(name => `{${name}} ASC`)];
    filters.push({ columnName: add(`top ${interpretation.topN}`, `ifelse(rank([${sort.join(', ')}], [], POST_AGG_FILTER) <= ${interpretation.topN}, 'yes', 'no')`, 'dimension'), values: ['yes'] });
  }
  return { calculatedFields, visual: {
    ...defaults(), id: 'o-preview', kind, title: interpretation.explanation.replace(/^Showing /, '').replace(/\.$/, ''),
    dimension: dimensions[0] ?? null, rows: kind === 'table' ? dimensions : [], measures: [measure],
    donut: false, filters, ...(dates.length === 1 ? { dateGrain: grain } : {}),
  } };
}

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
  const kind = interpretation.suggestedVisualType;
  return { calculatedFields, visual: {
    ...defaults(), id: 'o-preview', kind, title: interpretation.explanation.replace(/^Showing /, '').replace(/\.$/, ''),
    dimension: dimensions[0] ?? null, rows: kind === 'table' ? dimensions : [], measures: [measure],
    donut: false, filters, ...(dates.length === 1 ? { dateGrain: grain } : {}),
  } };
}

import type { ResultValue, RowExpression, SqlDialect } from './types.js';
import { quoteLiteral as q } from './validation.js';
export const dateUnits: Record<string, string> = { YYYY: 'year', YY: 'year', Q: 'quarter', MM: 'month', WK: 'week', DD: 'day', D: 'day', HH: 'hour', MI: 'minute', SS: 'second', MS: 'millisecond' };
export function asDate(value: ResultValue): Date {
  const text = String(value); return new Date(/^\d{4}-\d\d-\d\d$/.test(text) ? `${text}T00:00:00Z` : /(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}
export function addDate(value: ResultValue, amount: number, unit: string): string | null {
  const date = asDate(value); amount = Math.trunc(amount);
  const months = unit === 'YYYY' || unit === 'YY' ? amount * 12 : unit === 'Q' ? amount * 3 : unit === 'MM' ? amount : 0;
  if (['YYYY', 'YY', 'Q', 'MM'].includes(unit)) {
    const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
    const last = new Date(date.getTime()); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
    date.setUTCDate(Math.min(day, last.getUTCDate()));
  } else date.setTime(date.getTime() + amount * ({ WK: 604800000, DD: 86400000, D: 86400000, HH: 3600000, MI: 60000, SS: 1000, MS: 1 }[unit] ?? NaN));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function truncateDate(value: ResultValue, unit: string): string | null {
  const d = asDate(value);
  if (['YYYY', 'YY', 'Q', 'MM'].includes(unit)) { if (unit === 'YYYY' || unit === 'YY') d.setUTCMonth(0); else if (unit === 'Q') d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3); d.setUTCDate(1); }
  if (unit === 'WK') d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  if (['YYYY', 'YY', 'Q', 'MM', 'WK', 'DD', 'D'].includes(unit)) d.setUTCHours(0);
  if (!['MI', 'SS', 'MS'].includes(unit)) d.setUTCMinutes(0);
  if (!['SS', 'MS'].includes(unit)) d.setUTCSeconds(0);
  if (unit !== 'MS') d.setUTCMilliseconds(0);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
interface FormatPart { token?: string; literal?: string }
export function formatParts(format: string): FormatPart[] {
  const parts: FormatPart[] = []; let i = 0;
  while (i < format.length) {
    if (format[i] === "'") { let literal = ''; i++; while (i < format.length) { if (format[i] === "'") { i++; if (format[i] !== "'") break; } literal += format[i++]!; } parts.push({ literal }); }
    else { const token = /^(yyyy|YYYY|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|SS|S|EEEE|EEE|EE|E|a|ZZ|Z)/.exec(format.slice(i));
      if (token) { parts.push({ token: token[0] }); i += token[0].length; }
      else { if (/[A-Za-z]/.test(format[i]!)) throw new Error(`Unsupported date format token at ${format.slice(i)}`); parts.push({ literal: format[i++]! }); }
    }
  }
  return parts;
}
export function formatDate(value: ResultValue, format: string): string | null {
  const d = asDate(value); if (!Number.isFinite(d.getTime())) return null;
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  const tokens: Record<string, string> = { yyyy: pad(d.getUTCFullYear(), 4), YYYY: pad(d.getUTCFullYear(), 4), yy: pad(d.getUTCFullYear() % 100), MMMM: months[d.getUTCMonth()]!, MMM: months[d.getUTCMonth()]!.slice(0, 3), MM: pad(d.getUTCMonth() + 1), M: String(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()), d: String(d.getUTCDate()), HH: pad(d.getUTCHours()), H: String(d.getUTCHours()), hh: pad(d.getUTCHours() % 12 || 12), h: String(d.getUTCHours() % 12 || 12), mm: pad(d.getUTCMinutes()), m: String(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()), s: String(d.getUTCSeconds()), SSS: pad(d.getUTCMilliseconds(), 3), SS: pad(d.getUTCMilliseconds(), 3).slice(0, 2), S: pad(d.getUTCMilliseconds(), 3)[0]!, EEEE: days[d.getUTCDay()]!, EEE: days[d.getUTCDay()]!.slice(0, 3), EE: days[d.getUTCDay()]!.slice(0, 3), E: days[d.getUTCDay()]!.slice(0, 3), a: d.getUTCHours() < 12 ? 'AM' : 'PM', Z: '+0000', ZZ: '+00:00' };
  return formatParts(format).map(p => p.literal ?? tokens[p.token!]!).join('');
}
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function parsePattern(format: string): { pattern: string; tokens: string[] } {
  const tokens: string[] = [];
  const pattern = formatParts(format).map(p => { if (p.literal !== undefined) return escapeRegex(p.literal);
    const token = p.token!; tokens.push(token);
    return `(${['yyyy', 'YYYY'].includes(token) ? '[0-9]{4}' : token === 'yy' ? '[0-9]{2}' : token === 'SSS' ? '[0-9]{3}' : token === 'SS' ? '[0-9]{2}' : token === 'S' ? '[0-9]' : token === 'MMMM' ? months.join('|') : token === 'MMM' ? months.map(m => m.slice(0, 3)).join('|') : token === 'a' ? 'AM|PM' : token === 'Z' ? '[+-][0-9]{4}' : token === 'ZZ' ? '[+-][0-9]{2}:[0-9]{2}' : token.startsWith('E') ? days.map(d => token === 'EEEE' ? d : d.slice(0, 3)).join('|') : token.length === 2 ? '[0-9]{2}' : '[0-9]{1,2}'})`;
  }).join('');
  return { pattern: `^${pattern}$`, tokens };
}
export function parseDate(value: ResultValue, format: string): string | null {
  const { pattern, tokens } = parsePattern(format), match = new RegExp(pattern).exec(String(value)); if (!match) return null;
  const values = Object.fromEntries(tokens.map((t, i) => [t, match[i + 1]!]));
  const number = (keys: string[], fallback: number) => Number(keys.map(k => values[k]).find(v => v !== undefined) ?? fallback);
  let year = number(['yyyy', 'YYYY'], 2000); if (values.yy) year = 2000 + Number(values.yy);
  let month = number(['MM', 'M'], 1); if (values.MMM || values.MMMM) month = months.findIndex(m => values.MMMM === m || values.MMM === m.slice(0, 3)) + 1;
  const day = number(['dd', 'd'], 1), minute = number(['mm', 'm'], 0), second = number(['ss', 's'], 0), ms = Number((values.SSS ?? values.SS ?? values.S ?? '0').padEnd(3, '0'));
  let hour = number(['HH', 'H', 'hh', 'h'], 0); if (values.hh || values.h) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (values.a === 'PM' ? 12 : 0); }
  const d = new Date(0); d.setUTCFullYear(year, month - 1, day); d.setUTCHours(hour, minute, second, ms);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59 || d.getUTCMonth() !== month - 1) return null;
  const zone = values.Z ?? values.ZZ;
  if (zone) { const h = Number(zone.slice(1, 3)), m = Number(zone.slice(-2)); if (h > 23 || m > 59) return null; d.setUTCMinutes(d.getUTCMinutes() - (zone[0] === '-' ? -1 : 1) * (h * 60 + m)); }
  return d.toISOString();
}
export function datetimeValue(name: string, args: readonly ResultValue[]): ResultValue | undefined {
  if (!['addDateTime', 'dateDiff', 'truncDate', 'extract', 'formatDate', 'parseDate'].includes(name)) return undefined;
  if (args.some(a => a === null)) return null;
  const [a, b, c] = args;
  if (name === 'addDateTime') return addDate(c!, Number(a), String(b).toUpperCase());
  if (name === 'truncDate') return truncateDate(b!, String(a).toUpperCase());
  if (name === 'parseDate') return parseDate(a!, String(b ?? 'yyyy-MM-dd'));
  if (name === 'formatDate') return formatDate(a!, String(b ?? "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
  if (name === 'extract') {
    const d = asDate(b!); const unit = String(a).toUpperCase();
    return ({ YYYY: d.getUTCFullYear(), YY: d.getUTCFullYear(), Q: Math.floor(d.getUTCMonth() / 3) + 1, MM: d.getUTCMonth() + 1, DD: d.getUTCDate(), D: d.getUTCDate(), WD: d.getUTCDay() + 1, HH: d.getUTCHours(), MI: d.getUTCMinutes(), SS: d.getUTCSeconds(), MS: d.getUTCMilliseconds() } as Record<string, number>)[unit] ?? null;
  }
  const unit = String(c ?? 'DD').toUpperCase(), x = asDate(a!), y = asDate(b!);
  const monthDiff = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth();
  if (unit === 'YYYY' || unit === 'YY') return y.getUTCFullYear() - x.getUTCFullYear();
  if (unit === 'Q') return (y.getUTCFullYear() - x.getUTCFullYear()) * 4 + Math.floor(y.getUTCMonth() / 3) - Math.floor(x.getUTCMonth() / 3);
  if (unit === 'MM') return monthDiff;
  return Math.round((asDate(truncateDate(b!, unit)).getTime() - asDate(truncateDate(a!, unit)).getTime()) / ({ WK: 604800000, DD: 86400000, D: 86400000, HH: 3600000, MI: 60000, SS: 1000, MS: 1 }[unit] ?? NaN));
}
export const constant = (e: RowExpression | undefined, fallback = ''): string => e?.kind === 'literal' || e?.kind === 'symbol' ? String(e.value) : fallback;
export function datetimeSql(e: Extract<RowExpression, {kind: 'call'}>, dialect: SqlDialect, compile: (e: RowExpression) => string): string | undefined {
  const node = (i: number) => compile(e.args[i]!);
  const trunc = (date: string, unit: string): string => unit === 'WK' ? `(DATE_TRUNC('week', ${date} + INTERVAL '1 day') - INTERVAL '1 day')` : `DATE_TRUNC('${dateUnits[unit]}', ${date})`;
  if (e.name === 'addDateTime') return `(${node(2)} + CAST(TRUNC(${node(0)}) AS INTEGER) * INTERVAL '1 ${dateUnits[constant(e.args[1]).toUpperCase()]}')`;
  if (e.name === 'truncDate') return trunc(node(1), constant(e.args[0]).toUpperCase());
  if (e.name === 'extract') {
    const unit = constant(e.args[0]).toUpperCase(), value = node(1);
    return unit === 'WD' ? `(EXTRACT(DOW FROM ${value}) + 1)` : unit === 'MS' ? `MOD(EXTRACT(MILLISECONDS FROM ${value}), 1000)` : `FLOOR(EXTRACT(${dateUnits[unit]} FROM ${value}))`;
  }
  if (e.name === 'dateDiff') {
    const unit = constant(e.args[2], 'DD').toUpperCase(), a = node(0), b = node(1);
    if (dialect === 'duckdb' && unit !== 'WK') return `DATE_DIFF('${dateUnits[unit]}', ${a}, ${b})`;
    const diff = (part: string) => `(EXTRACT(${part} FROM ${b}) - EXTRACT(${part} FROM ${a}))`;
    if (unit === 'YYYY' || unit === 'YY') return diff('year');
    if (unit === 'Q') return `(${diff('year')} * 4 + ${diff('quarter')})`;
    if (unit === 'MM') return `(${diff('year')} * 12 + ${diff('month')})`;
    return `(EXTRACT(EPOCH FROM (${trunc(b, unit)} - ${trunc(a, unit)})) / ${{ WK: 604800, DD: 86400, D: 86400, HH: 3600, MI: 60, SS: 1, MS: 0.001 }[unit]})`;
  }
  if (e.name === 'formatDate') {
    const a = node(0), format = constant(e.args[1], "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    const pg: Record<string, string> = { yyyy: 'YYYY', YYYY: 'YYYY', yy: 'YY', MMMM: 'FMMonth', MMM: 'Mon', MM: 'MM', M: 'FMMM', dd: 'DD', d: 'FMDD', HH: 'HH24', H: 'FMHH24', hh: 'HH12', h: 'FMHH12', mm: 'MI', m: 'FMMI', ss: 'SS', s: 'FMSS', SSS: 'MS', EEEE: 'FMDay', EEE: 'Dy', EE: 'Dy', E: 'Dy', a: 'AM' };
    const duck: Record<string, string> = { yyyy: '%Y', YYYY: '%Y', yy: '%y', MMMM: '%B', MMM: '%b', MM: '%m', M: '%-m', dd: '%d', d: '%-d', HH: '%H', H: '%-H', hh: '%I', h: '%-I', mm: '%M', m: '%-M', ss: '%S', s: '%-S', SSS: '%g', EEEE: '%A', EEE: '%a', EE: '%a', E: '%a', a: '%p' };
    return `(${formatParts(format).map(p => { if (p.literal !== undefined) return q(p.literal); const t = p.token!; if (t === 'Z' || t === 'ZZ') return q(t === 'Z' ? '+0000' : '+00:00');
      const token = t === 'S' || t === 'SS' ? 'SSS' : t;
      const value = dialect === 'postgres' ? `TO_CHAR(${a}, ${q(pg[token]!)})` : `STRFTIME(${a}, ${q(duck[token]!)})`;
      return t === 'S' || t === 'SS' ? `LEFT(${value}, ${t.length})` : value;
    }).join(' || ')})`;
  }
  if (e.name !== 'parseDate') return undefined;
  const a = node(0), { pattern, tokens } = parsePattern(constant(e.args[1], 'yyyy-MM-dd'));
  const match = (t: string) => { const i = tokens.indexOf(t) + 1; return dialect === 'postgres' ? `(REGEXP_MATCH(${a}, ${q(pattern)}))[${i}]` : `NULLIF(REGEXP_EXTRACT(${a}, ${q(pattern)}, ${i}), '')`; };
  const num = (keys: string[], fallback: string) => { const t = keys.find(t => tokens.includes(t)); return t ? `CAST(${match(t)} AS INTEGER)` : fallback; };
  const y = num(['yyyy', 'YYYY'], tokens.includes('yy') ? `2000 + ${num(['yy'], '0')}` : '2000');
  const monthToken = tokens.includes('MMMM') ? 'MMMM' : tokens.includes('MMM') ? 'MMM' : undefined;
  const m = monthToken ? `(CASE ${match(monthToken)} ${months.map((m, i) => `WHEN ${q(monthToken === 'MMM' ? m.slice(0, 3) : m)} THEN ${i + 1}`).join(' ')} END)` : num(['MM', 'M'], '1');
  const d = num(['dd', 'd'], '1'), rawH = num(['HH', 'H', 'hh', 'h'], '0'), h = tokens.includes('hh') || tokens.includes('h') ? `(MOD(${rawH}, 12) + ${tokens.includes('a') ? `(CASE WHEN ${match('a')} = 'PM' THEN 12 ELSE 0 END)` : '0'})` : rawH;
  const mi = num(['mm', 'm'], '0'), ss = `(${num(['ss', 's'], '0')} + ${num(['SSS'], tokens.includes('SS') ? `${num(['SS'], '0')} * 10` : `${num(['S'], '0')} * 100`)} / 1000.0)`;
  const valid = dialect === 'postgres' ? `${a} ~ ${q(pattern)}` : `REGEXP_FULL_MATCH(${a}, ${q(pattern)})`;
  const timestamp = dialect === 'postgres' ? `MAKE_TIMESTAMP(${y}, ${m}, ${d}, ${h}, ${mi}, CAST(${ss} AS DOUBLE PRECISION))` : `MAKE_TIMESTAMP(${y}, ${m}, ${d}, ${h}, ${mi}, ${ss})`;
  const zoneToken = tokens.includes('ZZ') ? 'ZZ' : tokens.includes('Z') ? 'Z' : undefined;
  const zone = zoneToken ? match(zoneToken) : undefined;
  const zh = zone ? `CAST(SUBSTRING(${zone}, 2, 2) AS INTEGER)` : '0', zm = zone ? `CAST(RIGHT(${zone}, 2) AS INTEGER)` : '0';
  const offset = zone ? ` - (CASE WHEN LEFT(${zone}, 1) = '-' THEN -1 ELSE 1 END) * (${zh} * 60 + ${zm}) * INTERVAL '1 minute'` : '';
  return `(CASE WHEN ${valid} AND ${y} BETWEEN 1 AND 9999 AND ${m} BETWEEN 1 AND 12 AND ${d} BETWEEN 1 AND 31 AND ${rawH} BETWEEN ${tokens.includes('hh') || tokens.includes('h') ? '1 AND 12' : '0 AND 23'} AND ${mi} BETWEEN 0 AND 59 AND ${ss} >= 0 AND ${ss} < 60 AND ${zh} <= 23 AND ${zm} <= 59 THEN CASE WHEN ${d} <= EXTRACT(DAY FROM (MAKE_DATE(${y}, ${m}, 1) + INTERVAL '1 month' - INTERVAL '1 day')) THEN ${timestamp}${offset} END END)`;
}

import type { PrepColumn, PrepStep } from '@opensight/bundle-parser/prep';

type JoinKey = Extract<PrepStep, { kind: 'join' }>['config']['keys'][number];

/** Metadata hints only: callers must ask the author to confirm each key.
 * Case-insensitive whole names match; similar names and coercible types do not.
 * Ambiguous names on either side are deliberately excluded. */
export function suggestPrepJoinKeys(left: readonly PrepColumn[], right: readonly PrepColumn[]): JoinKey[] {
  return left.flatMap(column => {
    const name = column.name.toLowerCase();
    const matches = right.filter(c => c.name.toLowerCase() === name);
    return left.filter(c => c.name.toLowerCase() === name).length === 1 && matches.length === 1 && matches[0]!.type === column.type
      ? [{ left: column.name, right: matches[0]!.name }] : [];
  });
}

import { productSections, visiblePage } from './app-navigation.js';
import type { Navigate } from './AppNavigation.js';
import type { Access } from './access.js';

export interface Command {
  id: string;
  label: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

/** Small, deterministic subsequence matcher. Contiguous words rank first. */
export function fuzzyScore(text: string, query: string): number | undefined {
  const value = text.toLowerCase(), needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const substring = value.indexOf(needle);
  const boundary = (index: number) => index === 0 || /[^\p{L}\p{N}]/u.test(value[index - 1]!);
  if (substring >= 0) return 1000 + (boundary(substring) ? 100 : 0) - substring;
  let cursor = 0, previous = -2, score = 0;
  for (const character of needle) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return;
    score += 10 + (boundary(index) ? 20 : 0) + (index === previous + 1 ? 10 : 0);
    score -= index - cursor;
    cursor = index + 1; previous = index;
  }
  return score;
}

export function filterCommands(commands: readonly Command[], query: string): Command[] {
  return commands.map(command => ({ command, score: fuzzyScore(`${command.label} ${command.keywords ?? ''}`, query) }))
    .filter((item): item is { command: Command; score: number } => item.score !== undefined)
    .sort((a, b) => b.score - a.score).map(item => item.command);
}

export function navigationCommands(access: Access, navigate: Navigate): Command[] {
  return [...productSections, { title: 'Author', page: 'author' } as const]
    .filter(item => visiblePage(access, item.page))
    .map(item => ({ id: `go-${item.page}`, label: `Go to ${item.title}`, run: () => navigate({ page: item.page }) }));
}

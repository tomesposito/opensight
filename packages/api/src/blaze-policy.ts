import type { PrepInput, PrepPipeline } from '@opensight/bundle-parser/prep';
import type { ExecutionMode } from './blaze.js';

interface Dataset { id: string; pipeline: PrepPipeline; mode: ExecutionMode }
interface Requirement { sources: Set<string>; reason: string | null }
/** Inspect saved metadata, including dependencies behind cache boundaries, without reading sources. */
export function materializationReason(id: string, datasets: readonly Dataset[]): string | null {
  const byId = new Map(datasets.map(d => [d.id, d])), visited = new Map<string, Requirement>();
  const dataset = (key: string): Requirement => {
    const previous = visited.get(key);
    if (previous) return previous;
    const result: Requirement = { sources: new Set(), reason: null };
    visited.set(key, result); // Invalid/cyclic graphs are rejected by the existing graph validator.
    const definition = byId.get(key);
    if (!definition) return result;
    const { pipeline } = definition;
    const outputSteps = new Set<string>();
    const visit = (id: string | undefined): void => {
      if (id === undefined || outputSteps.has(id)) return;
      outputSteps.add(id);
      const index = pipeline.steps.findIndex(s => s.id === id), step = pipeline.steps[index];
      if (!step) return;
      visit(step.from ?? pipeline.steps[index - 1]?.id);
      if (step.kind === 'join' && typeof step.config.source === 'object' && 'step' in step.config.source) visit(step.config.source.step);
    };
    visit(pipeline.output ?? pipeline.steps.at(-1)?.id);
    const path = pipeline.steps.filter(s => outputSteps.has(s.id));
    const advanced = path.find(s => ['pivot', 'unpivot', 'append', 'aggregate'].includes(s.kind));
    if (advanced) result.reason = `The ${advanced.kind} preparation step requires Blaze materialization.`;
    const input = (ref: PrepInput) => {
      if (typeof ref === 'string') { result.sources.add(`source:${ref}`); return; }
      const child = dataset(ref.dataset);
      result.reason ??= child.reason;
      if (byId.get(ref.dataset)?.mode === 'BLAZE') result.sources.add(`dataset:${ref.dataset}`);
      else for (const source of child.sources) result.sources.add(source);
    };
    input(definition.pipeline.input);
    for (const step of path) {
      if (step.kind === 'append') input(step.config.source);
      if (step.kind === 'join' && !(typeof step.config.source === 'object' && 'step' in step.config.source)) input(step.config.source);
    }
    if (result.sources.size > 1) result.reason ??= 'Cross-source joins require Blaze materialization.';
    return result;
  };
  return dataset(id).reason;
}

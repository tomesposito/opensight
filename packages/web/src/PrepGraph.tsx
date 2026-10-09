import type { ReactNode } from 'react';
import type { PrepPipeline, PrepStep } from '@opensight/bundle-parser/prep';
import { PrepJoinIcon, PrepStepIcon } from './PrepIcons.js';
import { prepLeftInput, prepStepLabel, prepRefKey } from './data-prep.js';
import { PrepViewport } from './PrepViewport.js';

/** Left inputs form a tree within the DAG. Secondary join edges remain labeled
 *  links on their target nodes. Flex branches keep connectors aligned at any
 *  node height, including long authored names and visible validation errors. */
export function PrepGraph({ pipeline, selected, issues, input, output, secondary, select, branch, setOutput, disabled }: {
  pipeline: PrepPipeline; selected: string | null; issues: readonly string[];
  input: ReactNode; output: ReactNode; secondary: (step: PrepStep, index: number) => ReactNode;
  select: (id: string) => void; branch: (id: string) => void; setOutput: (id: string) => void; disabled: boolean;
}) {
  const outputId = pipeline.output ?? pipeline.steps.at(-1)?.id ?? null;
  const children = new Map<string | null, PrepStep[]>(), detached: PrepStep[] = [];
  pipeline.steps.forEach((step, i) => {
    const parent = prepLeftInput(pipeline, step);
    if (parent !== null && !pipeline.steps.slice(0, i).some(s => s.id === parent)) detached.push(step);
    else children.set(parent, [...children.get(parent) ?? [], step]);
  });
  const descendants = (id: string | null): ReactNode => {
    const steps = children.get(id) ?? [];
    if (!steps.length && id !== outputId) return null;
    return <ul className="prep-branches">
      {steps.map(step => node(step))}
      {id === outputId && <li className="prep-node-wrap"><span className="prep-edge" aria-label="Selected output connection" data-from={id ?? 'input'} data-to="output" /><div className="prep-output">{output}</div></li>}
    </ul>;
  };
  const node = (step: PrepStep): ReactNode => {
    const i = pipeline.steps.findIndex(s => s.id === step.id), issue = issues[i] ?? '', parent = prepLeftInput(pipeline, step);
    return <li className="prep-node-wrap" key={step.id} data-combine={step.kind === 'join' || step.kind === 'append' || undefined}>
      <span className="prep-edge" aria-label={`Left input: ${parent ?? 'Input'} to ${step.id}`} data-from={parent ?? 'input'} data-to={step.id}>{step.kind === 'join' && <span className="prep-port-label">LEFT</span>}</span>
      <div className="prep-step-node" data-step-id={step.id}>
        {secondary(step, i)}
        {(step.kind === 'join' || step.kind === 'append') && <span className="prep-right-edge" aria-label={`${step.kind === 'join' ? 'Right' : 'Append'} input to ${step.id}`} data-right-from={prepRefKey(step.config.source)} data-right-to={step.id}><span className="prep-port-label">{step.kind === 'join' ? 'RIGHT' : 'APPEND'}</span></span>}
        <button className={`prep-node${selected === step.id ? ' selected' : ''}${issue ? ' unconfigured' : ''}`} aria-pressed={selected === step.id} title={issue || undefined} onClick={() => select(step.id)}>
          <span className="prep-node-icon">{step.kind === 'join' ? <PrepJoinIcon type={step.config.joinType} /> : <PrepStepIcon kind={step.kind} />}</span><strong>{prepStepLabel(step)}</strong>
          {outputId === step.id && <span className="prep-output-marker">Output</span>}
          <span className="sr-only">Configure · Preview</span>{issue && <span className="prep-flag">{issue}</span>}
        </button>
        <div className="prep-node-actions"><button disabled={disabled} onClick={() => branch(step.id)}>Add branch</button><button disabled={outputId === step.id} onClick={() => setOutput(step.id)}>Set as output</button></div>
      </div>{descendants(step.id)}
    </li>;
  };
  return <PrepViewport><div className="prep-graph"><ul className="prep-nodes"><li className="prep-node-wrap"><div>{input}</div>{descendants(null)}</li></ul>
    {detached.length > 0 && <div className="prep-detached"><p>Invalid left input — configure the affected step to repair its reference.</p><ul className="prep-nodes">{detached.map(node)}</ul></div>}
  </div></PrepViewport>;
}

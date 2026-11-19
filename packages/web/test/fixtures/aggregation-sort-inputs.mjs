// Fixed baseline cases captured from master 6cd1f7eb before implementation.
import { activeSheet, authorReducer, emptyDraft, serializeVisual } from '../../build/test/authoring.js';
export const baselineInputs = () => {
const inputs = {};
for (const kind of ['bar', 'bar100', 'pie', 'line', 'area', 'combo']) {
  const draft = authorReducer(emptyDraft(), { type: 'add', kind });
  const visual = activeSheet(draft).visuals[0];
  visual.dimension = 'region'; visual.measures = kind === 'combo' ? ['revenue', 'profit'] : ['revenue'];
  for (const facet of [false, true]) for (const sort of [undefined, {fieldId:'region',direction:'DESC'}]) for (const data of ['rows','empty','unavailable']) {
    const v = structuredClone(visual);
    if (facet) v.smallMultiples = ['category'];
    if (sort) v.groupSort = sort;
    const input = { source:'bundle',path:'$.baseline',bindings:{},definition:serializeVisual(v), rows:data === 'unavailable' ? null : data === 'empty' ? [] : [{region:'West',category:'B',revenue:10,profit:2},{region:'East',category:'A',revenue:20,profit:3}] };
    inputs[`${kind}/${facet}/${sort?.direction ?? 'none'}/${data}`]=input;
  }
}
return inputs;
};

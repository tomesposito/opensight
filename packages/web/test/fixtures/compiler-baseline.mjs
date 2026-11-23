import assert from 'node:assert/strict';

/** Compare legacy output oracles while checking the metadata added in #313. */
export function withoutBindingAggregation(compiled) {
  const field = ({ aggregation, ...rest }) => {
    assert.equal(aggregation, 'SUM');
    return rest;
  };
  return { ...compiled, model: { ...compiled.model,
    measures: compiled.model.measures.map(field),
    ...(compiled.model.targetMeasure ? { targetMeasure: field(compiled.model.targetMeasure) } : {}),
  } };
}

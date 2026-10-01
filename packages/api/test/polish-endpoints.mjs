// Issue #35: same concrete routes in fixture/local and real hosted auth audits.
export const polishEndpoints = [
  ['/api/datasets/sales/query', 'POST'],
  ['/api/datasets/polish/query', 'POST'],
  ['/api/o/query', 'POST'], ['/api/o/generate', 'POST'],
  ['/api/uploads', 'POST'], ['/api/uploads/missing', 'GET'],
  ['/api/prep-sources', 'GET'], ['/api/prep-datasets', 'GET'],
  ['/api/datasets/polish/prep', 'GET'], ['/api/datasets/polish/prep', 'PUT'], ['/api/datasets/polish/prep', 'DELETE'],
  ['/api/datasets/polish/prep/preview', 'POST'],
  ['/api/datasets/polish/execution', 'GET'], ['/api/datasets/polish/execution', 'PUT'],
  ['/api/datasets/polish/rows', 'GET'], ['/api/datasets/polish/refresh', 'POST'],
];

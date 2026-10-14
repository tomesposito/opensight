import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The SDK must map 1:1 onto the implemented v1 OpenAPI surface: every
 * path+method in docs/api/openapi-v1.yaml is covered by a client method,
 * and no client method invents a path that is not in the spec.
 * (Issue #95: the loop may draft, but never invent, API surface.)
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const spec = readFileSync(join(repoRoot, 'docs', 'api', 'openapi-v1.yaml'), 'utf8');

// Collect [path, method] pairs from the paths section.
function specRoutes() {
  const routes = [];
  const lines = spec.split('\n');
  let currentPath = null;
  for (const line of lines) {
    if (line === 'components:') break;
    const pathMatch = line.match(/^  (\/[^:]*):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const verbMatch = line.match(/^    (get|put|post|delete|patch):$/);
    if (verbMatch && currentPath) routes.push([currentPath, verbMatch[1].toUpperCase()]);
  }
  return routes;
}

const ROUTES = specRoutes();

// The client method that implements each spec route.
const COVERAGE = {
  '/analyses/{id}/publish|POST': 'publishAnalysis',
  '/dashboards|GET': 'listDashboards',
  '/dashboards/{id}|GET': 'getDashboard',
  '/dashboards/{id}|DELETE': 'deleteDashboard',
  '/dashboards/{id}/versions|GET': 'listDashboardVersions',
  '/dashboards/{id}/versions/{version}|GET': 'getDashboardVersion',
  '/dashboards/{id}/versions/{version}|DELETE': 'deleteDashboardVersion',
  '/dashboards/{id}/shares/{principalType}/{principalId}|GET': 'getDashboardShare',
  '/dashboards/{id}/shares/{principalType}/{principalId}|PUT': 'setDashboardShare',
  '/dashboards/{id}/shares/{principalType}/{principalId}|DELETE': 'deleteDashboardShare',
  '/dashboards/{id}/versions/{version}/visuals/{visualId}/query|POST': 'queryDashboardVisual',
  '/dashboards/{id}/exports|POST': 'createDashboardExport',
  '/analyses|GET': 'listAnalyses',
  '/analyses|POST': 'createAnalysis',
  '/analyses/{id}|GET': 'getAnalysis',
  '/analyses/{id}|PUT': 'updateAnalysis',
  '/analyses/{id}|DELETE': 'deleteAnalysis',
  '/analyses/{id}/sheets/{sheetId}/visuals|POST': 'addVisual',
  '/analyses/{id}/sheets/{sheetId}/visuals/{visualId}|PUT': 'updateVisual',
  '/analyses/{id}/sheets/{sheetId}/visuals/{visualId}|DELETE': 'removeVisual',
  '/analyses/{id}/sheets/{sheetId}/layouts|PUT': 'setLayouts',
  '/analyses/{id}/filter-groups|POST': 'addFilterGroup',
  '/analyses/{id}/filter-groups/{filterGroupId}|PUT': 'updateFilterGroup',
  '/analyses/{id}/filter-groups/{filterGroupId}|DELETE': 'removeFilterGroup',
  '/analyses/{id}/calculated-fields|PUT': 'setCalculatedFields',
  '/datasets|GET': 'listDatasets',
  '/datasets/{id}|GET': 'getDataset',
  '/datasets/{id}|PUT': 'saveDataset',
  '/datasets/{id}|DELETE': 'deleteDataset',
  '/datasets/{id}/lineage|GET': 'getDatasetLineage',
  '/datasets/{id}/query|POST': 'queryDataset',
  '/datasets/{id}/refresh|POST': 'refreshDataset',
  '/datasets/{id}/refresh-status|GET': 'getRefreshStatus',
  '/sources|GET': 'listSources',
  '/sources/{id}|GET': 'getSource',
  '/sources/{id}|DELETE': 'deleteSource',
};

describe('openapi coverage', () => {
  it('every spec route is mapped by the client', () => {
    assert.ok(ROUTES.length > 0, 'expected to parse routes from openapi-v1.yaml');
    for (const [path, method] of ROUTES) {
      const key = `${path}|${method}`;
      assert.ok(
        key in COVERAGE,
        `spec route ${method} ${path} has no SDK method — add it, or the spec moved`,
      );
    }
  });

  it('no coverage entry invents a route that is not in the spec', () => {
    const specKeys = new Set(ROUTES.map(([p, m]) => `${p}|${m}`));
    for (const key of Object.keys(COVERAGE)) {
      assert.ok(specKeys.has(key), `coverage entry ${key} is not in the spec — the SDK must not invent endpoints`);
    }
  });

  it('every covered method exists on OpenSightClient', async () => {
    const { OpenSightClient } = await import('../dist/index.js');
    const seen = new Set();
    for (const method of Object.values(COVERAGE)) {
      if (seen.has(method)) continue;
      seen.add(method);
      assert.equal(
        typeof OpenSightClient.prototype[method],
        'function',
        `OpenSightClient#${method} is missing`,
      );
    }
  });
});

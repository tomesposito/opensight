import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromiumPage } from './chromium.mjs';

test('mounted KPI keeps its SVG when targets and arrows are added or removed without reload', async () => {
  const entry = fileURLToPath(new URL('./kpi-lifecycle.virtual.js', import.meta.url));
  const card = fileURLToPath(new URL('../src/VisualCard.tsx', import.meta.url));
  const result = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [{ name: 'kpi-lifecycle', resolveId(id) { if (id === entry) return id; }, load(id) { if (id === entry) return `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { VisualCard } from ${JSON.stringify(card)};
      const root = createRoot(document.getElementById('app'));
      window.renderKpi = visual => flushSync(() => root.render(React.createElement(VisualCard, { visual })));
    `; } }],
    build: { write: false, minify: false, lib: { entry, name: 'KpiLifecycle', formats: ['iife'] } },
  });
  const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
  const page = await chromiumPage();
  try {
    await page.setContent('<div id="app"></div><style>.visual-content{height:240px;position:relative}.chart{position:absolute;inset:0;width:100%;height:100%}</style>');
    await page.evaluate(code => (0, eval)(code), code);
    const measure = (fieldId, columnName) => ({ numericalMeasureField: { fieldId, column: { dataSetIdentifier: 'data', columnName }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
    const visual = { source: 'bundle', path: '$', bindings: {}, rows: [{ revenue: 10, budget: 20 }], placement: { column: 0, columns: 36, row: 0, rows: 6 },
      definition: { kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: { values: [measure('value', 'revenue')] } } } } };
    const render = async () => {
      await page.evaluate(v => window.renderKpi(v), visual);
      return page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { count: document.querySelectorAll('.chart svg').length, text: document.querySelector('.chart svg')?.textContent, label: document.querySelector('.chart')?.getAttribute('aria-label') };
      });
    };
    assert.equal((await render()).count, 1);
    const config = visual.definition.kpiVisual.chartConfiguration;
    config.fieldWells.targetValues = [measure('target', 'budget')]; config.kpiOptions = { progressBar: {} };
    let rendered = await render(); assert.equal(rendered.count, 1); assert.match(rendered.text, /Target: 20/); assert.match(rendered.label, /50% of target/);
    delete config.fieldWells.targetValues;
    rendered = await render(); assert.equal(rendered.count, 1); assert.doesNotMatch(rendered.text, /Target/);
    config.fieldWells.trendGroups = [{ categoricalDimensionField: { fieldId: 'period', column: { dataSetIdentifier: 'data', columnName: 'period' } } }];
    visual.rows = [{ period: 'A', revenue: 10 }, { period: 'B', revenue: 15 }];
    config.kpiOptions = { comparison: { comparisonMethod: 'DIFFERENCE' }, trendArrows: {} };
    rendered = await render(); assert.equal(rendered.count, 1); assert.match(rendered.text, /↑ 5/); assert.match(rendered.label, /Trend up: 5/);
    config.kpiOptions.trendArrows.visibility = 'HIDDEN';
    rendered = await render(); assert.equal(rendered.count, 1); assert.doesNotMatch(rendered.text, /↑/);
  } finally { await page.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 18: hover feedback for sheet tabs. A fresh
// interactive-state audit of the remaining surfaces (landing pages were fully
// covered by slices 8/16/17; the author chrome and menu items already carry
// hover rules) found sheet tabs — the Dashboard sheet switcher
// (aria-current) and the author sheet toolbar (role=tab, aria-selected) —
// had zero hover state: hovering an unselected tab changed nothing. An
// unselected tab now previews the selected state (teal text #126e76 +
// underline #157f88), the same preview language slice 17 used for the
// account-menu summary. The 3px underline is already reserved in the resting
// rule, so the hover changes color only — no layout shift. The selected tab
// keeps its flat state, and the state is instantaneous, so no
// prefers-reduced-motion variant is needed.
const css = styles['style.css'];

test('unselected sheet tabs preview the selected state on hover', () => {
  const rule = css.match(
    /\.sheet-tabs\s+button:hover:not\(\[aria-current\]\):not\(\[aria-selected=true\]\)\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'expected .sheet-tabs button:hover excluding the selected tab');
  assert.match(rule[1], /color:\s*#126e76/);
  assert.match(rule[1], /border-bottom-color:\s*#157f88/);
});

test('the selected-tab rules still win over the hover preview', () => {
  const current = css.match(/\.sheet-tabs\s+button\[aria-current\]\s*\{([^}]*)\}/);
  assert.ok(current, 'expected the dashboard selected-tab rule to remain');
  assert.match(current[1], /color:\s*#126e76/);
  assert.match(current[1], /border-color:\s*#157f88/);
  const selected = css.match(/\.sheet-tabs\s+button\[aria-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the author selected-tab rule to remain');
  assert.match(selected[1], /color:\s*#126e76/);
  assert.match(selected[1], /border-bottom-color:\s*#157f88/);
});

test('hover cannot shift tab geometry', () => {
  const base = css.match(/\.sheet-tabs\s+button\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the base .sheet-tabs button rule');
  assert.match(base[1], /border-bottom:\s*3px\s+solid\s+transparent/);
  const hover = css.match(
    /\.sheet-tabs\s+button:hover:not\(\[aria-current\]\):not\(\[aria-selected=true\]\)\s*\{([^}]*)\}/,
  );
  assert.ok(hover);
  assert.ok(!/padding|margin|border-bottom-width|font-size/.test(hover[1]), 'hover must change colors only');
});

defineHoverCases('unselected sheet tabs', {
  html: `<nav class="sheet-tabs"><button id="dashboard">Overview</button><button id="current" aria-current="page">Sales</button></nav>
    <div class="author-workspace"><div class="sheet-toolbar"><nav class="sheet-tabs"><button id="author" role="tab" aria-selected="false">Overview</button><button id="selected" role="tab" aria-selected="true">Sales</button></nav></div></div>`,
  cases: ['#dashboard', '#author'].map(target => ({
    target, rule: '.sheet-tabs button:hover:not([aria-current]):not([aria-selected=true])',
    resting: { color: target === '#dashboard' ? 'rgb(82, 108, 122)' : 'rgb(25, 56, 74)', borderBottomColor: 'rgba(0, 0, 0, 0)' },
    hovered: { color: 'rgb(18, 110, 118)', borderBottomColor: 'rgb(21, 127, 136)' },
    paintOnly: true,
    excluded: ['#current', '#selected'],
  })),
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 22: hover feedback for the standalone Ask O trigger
// button (.q-trigger). A fresh interactive-state audit on the fixture demo
// found the trigger had zero hover feedback in its standalone rendering
// (home sample dashboard, dashboard view): hovering changed nothing, while
// every other landing control already carries a hover state (slices
// 8/16/17/18/20/21). The author-chrome rendering of the same button keeps its
// existing header hover tint via the more specific .author-menu > button:hover
// rule, which wins over this rule in the cascade. The trigger takes the
// established menu-item hover tint (#eaf3f7), same language as the data-page
// buttons and tabs (slices 16/19/21); disabled triggers keep their flat state.
// Background only, so resting geometry is identical. Static (no animation),
// so no reduced-motion variant is needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.q-trigger:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the Ask O trigger has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .q-trigger:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected .q-trigger:hover:not(:disabled)');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting trigger rule still reserves the geometry the hover keeps', () => {
  const matches = [...css.matchAll(/([^{}]*\.q-trigger[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selector]) => !selector.includes(':'));
  assert.ok(matches.length, 'expected a non-pseudo .q-trigger rule');
  const resting = matches.find(([, , body]) => /border:\s*1px\s+solid\s+#c9d8de/.test(body));
  assert.ok(resting, 'expected the base rule with the resting border');
  assert.match(resting[2], /background:\s*#fff/);
});

test('the author-chrome button hover rule still outranks the new rule', () => {
  // In the author menu the trigger already takes the header hover tint via
  // .author-workspace[data-chrome] .author-menu > button:hover:not(:disabled),
  // which must keep winning over the standalone rule (no !important anywhere).
  const authorRule = css.match(/\.author-workspace\[data-chrome\]\s+\.author-menu\s*>\s*button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
  assert.ok(authorRule, 'expected the author-chrome menu button hover rule to still exist');
  assert.match(authorRule[1], /background:\s*var\(--header-hover\)/);
  assert.ok(!/!important/.test(hoverRule[1]), 'standalone hover rule must not use !important');
});

defineHoverCases('q-trigger hover', {
  html: `<div class="q-entry"><button type="button" class="q-trigger"><span class="o-mark">O</span><span class="q-trigger-label">Ask a question about Local sales</span></button><button type="button" class="q-trigger" disabled><span class="o-mark">O</span><span class="q-trigger-label">Ask a question about Local sales</span></button></div>`,
  cases: [
    {
      target: '.q-entry .q-trigger:not([disabled])',
      rule: '.q-trigger:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      excluded: [{ target: '.q-entry .q-trigger[disabled]', resting: { backgroundColor: 'rgb(255, 255, 255)' } }],
    },
  ],
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 32: hover feedback for the folders "About folders
// and sharing" link. A fresh behavioral hover audit (real mouse hover with
// computed-style delta measurement, Chromium, demo-mode bridge) re-audited
// the landing routes first (0 candidates: the landing-surface hover thread
// stays complete since slice 29) and then the top-level offline-demo routes,
// finding `.folder-empty-state a` (My folders and Shared folders pages) as
// the last user-facing control with zero hover state: hovering the link
// changed nothing. It shares its teal resting color (#126e76) with the
// slice-25 my-stuff quick links and now takes the same app-wide menu-item
// hover tint (#eaf3f7, slices 16/21/25/26). Paint-only: the rule changes the
// background, so resting geometry is identical and there is no animation to
// need a reduced-motion variant.
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const linkRule = chromeCss.match(/\.folder-empty-state\s+a:hover\s*\{([^}]*)\}/);

test('the folders about-link has a hover state with the menu-item tint', () => {
  assert.ok(linkRule, 'expected .folder-empty-state a:hover');
  assert.match(linkRule[1], /background:\s*#eaf3f7/);
});

test('the about-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linkRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(linkRule[1]), 'hover must change background only');
});

test('the about-link resting rule keeps the teal text color the hover preserves', () => {
  const base = chromeCss.match(/\.my-stuff-links\s+a,\s*\.folder-empty-state\s+a\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the shared resting color rule');
  assert.match(base[1], /color:\s*#126e76/);
  assert.ok(!/background:/.test(base[1]), 'resting rule must not set a background');
});

describe('folders about-link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${chromeCss}</style>`
      + `<section class="collection-page folder-page"><div class="collection-card folder-empty-state"><p>Folders organize analyses and dashboards.</p><a href="#/admin/organization" id="a">About folders and sharing</a></div></section>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#a');
      const rules = find('.folder-empty-state a:hover');
      const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        rest,
        hovered,
        backgroundColor: rules[0].style.getPropertyValue('background-color'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.color, actual.hovered.color);
    assert.equal(actual.rest.box, actual.hovered.box);
  });
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 43: hover feedback for the Page-not-found
// "Go to Home" link. A fresh behavioral hover audit (real mouse hover with
// computed-style delta measurement, Chromium, demo route) used a
// whole-document selector set (header/nav included) with every <details>
// expanded, over 11 routes. Every zero-hover hit was explained except this
// one: opened-menu summaries rest at their hover/pressed tint, current-page
// nav links rest at their hover tint by design (slice-31 precedent), and
// the 13x13 favorites checkbox is a by-design native control (slices
// 33/37/38). The not-found link (any unknown route) measured
// transparent -> transparent with :hover applied and hit-test confirmed:
// hovering it changed nothing. The not-found section now carries the
// .not-found-page hook and the link takes the app-wide menu-item hover
// tint (#eaf3f7, slices 16/21/25/26/32). Paint-only: the rule changes the
// background, so resting geometry is identical and there is no animation
// to need a reduced-motion variant.
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const appTsx = await readFile(new URL('../src/Application.tsx', import.meta.url), 'utf8');

const linkRule = chromeCss.match(/\.not-found-page\s+a:hover\s*\{([^}]*)\}/);

test('the not-found page section carries the hook the hover rule targets', () => {
  assert.match(appTsx, /<section className="not-found-page"><h1>Page not found<\/h1>/);
  assert.match(appTsx, /<AppLink to=\{\{ page: 'home' \}\} navigate=\{navigate\}>Go to Home<\/AppLink>/);
});

test('the not-found link has a hover state with the menu-item tint', () => {
  assert.ok(linkRule, 'expected .not-found-page a:hover');
  assert.match(linkRule[1], /background:\s*#eaf3f7/);
});

test('the not-found link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linkRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(linkRule[1]), 'hover must change background only');
});

test('the not-found link hover coexists with the other text-link hovers', () => {
  assert.ok(chromeCss.match(/\.folder-empty-state\s+a:hover\s*\{\s*background:\s*#eaf3f7/), 'the slice-32 folders about-link hover must still be present');
  assert.ok(chromeCss.match(/\.my-stuff-links\s+a:hover\s*\{\s*background:\s*#eaf3f7/), 'the slice-25 my-stuff quick-link hover must still be present');
  assert.ok(chromeCss.match(/\.recent-pages\s+a:hover\s*\{\s*background:\s*#eaf3f7/), 'the slice-26 recent-pages hover must still be present');
});

describe('not-found link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${chromeCss}</style>`
      + `<section class="not-found-page"><h1>Page not found</h1><p>Choose a section in the navigation to continue.</p><a href="#/" id="a">Go to Home</a></section><a href="#/" id="outside">Outside link</a>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const measure = el => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        for (const rule of find('.not-found-page a:hover')) {
          if (el.matches('.not-found-page a')) for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop));
        }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const rules = find('.not-found-page a:hover');
      return {
        ruleCount: rules.length,
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        link: measure(document.querySelector('#a')),
        outside: measure(document.querySelector('#outside')),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.link.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.link.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.link.rest.color, actual.link.hovered.color);
    assert.equal(actual.link.rest.box, actual.link.hovered.box);
    assert.equal(actual.outside.hovered.background, actual.outside.rest.background, 'links outside the not-found section keep their own states');
  });
});

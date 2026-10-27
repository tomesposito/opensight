import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Keep the same order as main.tsx. Every fixture gets the complete cascade,
// including shell overrides; static rule checks can reuse these sources too.
export const styles = Object.fromEntries(await Promise.all(
  ['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
    .map(async name => [name, await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')]),
));
const stylesheet = Object.values(styles).join('\n');

export async function loadInteractionFixture(page, html) {
  await page.setContent(`<style>${stylesheet}</style>${html}`);
}

async function snapshot(page, selector, properties) {
  // Let existing dialog/menu entrance animations finish before comparing
  // geometry. Do not disable or override any product CSS in the fixture.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
  });
  return page.evaluate(({ selector, properties }) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing interaction target: ${selector}`);
    const computed = getComputedStyle(element);
    return {
      values: Object.fromEntries(properties.map(property => [property, computed[property]])),
      box: element.getBoundingClientRect().toJSON(),
      inline: element.getAttribute('style'),
    };
  }, { selector, properties });
}

async function matches(page, target, rule) {
  // CDP-forced pseudo states affect the style engine, not Element.matches().
  const normalize = selector => selector.replaceAll('"', '').replace(/\s+/g, ' ').trim();
  return (await page.hoverState(target)).rules.some(selector => normalize(selector) === normalize(rule));
}

function expectValues(actual, expected, message) {
  for (const [property, value] of Object.entries(expected)) {
    assert.equal(actual.values[property], value, `${message}: ${property}`);
  }
}

/** Check real selector applicability and cascade, never inline declarations.
 * Exclusions stay at rest while the target hovers, then are themselves hovered
 * to prove they cannot match this rule. An exclusion may also specify its own
 * resting/hovered values (e.g. an unavailable selected row stays flat).
 */
export async function checkHoverCase(page, {
  target, rule, resting, hovered, paintOnly = true, unchanged = [], excluded = [],
}) {
  assert.ok(Object.keys(resting).length, 'supply expected resting computed values');
  assert.ok(Object.keys(hovered).length, 'supply expected hovered computed values');
  assert.ok(rule.includes(':hover'), 'supply the actual hover selector under test');
  const properties = [...new Set([...Object.keys(resting), ...Object.keys(hovered), ...unchanged])];
  await page.setHovered(null);
  const rest = await snapshot(page, target, properties);
  assert.equal((await page.hoverState(target)).hovered, false, `${target} starts without hover`);
  expectValues(rest, resting, `${target} at rest`);
  const exclusions = [];
  for (const exclusion of excluded) {
    const entry = typeof exclusion === 'string' ? { target: exclusion } : exclusion;
    const props = [...new Set([...properties, ...Object.keys(entry.resting ?? {}), ...Object.keys(entry.hovered ?? {})])];
    const before = await snapshot(page, entry.target, props);
    expectValues(before, entry.resting ?? {}, `${entry.target} excluded rest`);
    exclusions.push({ ...entry, properties: props, before });
  }
  await page.setHovered(target);
  const active = await snapshot(page, target, properties);
  assert.equal((await page.hoverState(target)).hovered, true, `${target} has real :hover`);
  assert.equal(await matches(page, target, rule), true, `${target} matches ${rule} while hovered`);
  expectValues(active, hovered, `${target} hovered`);
  assert.equal(active.inline, rest.inline, 'hover must not modify inline styles');
  if (paintOnly) assert.deepEqual(active.box, rest.box, `${target} hover preserves geometry`);
  for (const property of unchanged) {
    assert.equal(active.values[property], rest.values[property], `${target} preserves ${property}`);
  }
  for (const entry of exclusions) {
    const current = await snapshot(page, entry.target, entry.properties);
    assert.deepEqual(current.values, entry.before.values, `${entry.target} stays at rest while ${target} hovers`);
    if (paintOnly) assert.deepEqual(current.box, entry.before.box, `${entry.target} preserves geometry`);
  }
  await page.setHovered(null);
  const reset = await snapshot(page, target, properties);
  assert.deepEqual(reset, rest, `${target} returns to its resting state`);
  for (const entry of exclusions) {
    await page.setHovered(entry.target);
    assert.equal(await matches(page, entry.target, entry.rule ?? rule), false,
      `${entry.target} must not match the excluded rule under real hover`);
    const current = await snapshot(page, entry.target, entry.properties);
    expectValues(current, entry.hovered ?? {}, `${entry.target} excluded hover`);
    if (paintOnly) assert.deepEqual(current.box, entry.before.box, `${entry.target} hover preserves geometry`);
    await page.setHovered(null);
  }
}

/** Share a browser across a file's cases; reload the complete CSS per case.
 * A dark variant can override html, target, rule and expectations, with the
 * same assertions as its light case. Geometry stability defaults to true.
 */
export function defineHoverCases(name, { html, cases }) {
  describe(name, () => {
    let page;
    before(async () => { page = await chromiumPage(); });
    after(async () => { await page?.close(); });
    for (const entry of cases) {
      const { dark, ...base } = entry;
      for (const [variant, options] of [['', base], ...(dark ? [[' (dark)', { ...base, ...dark }]] : [])]) {
        test(`${options.name ?? options.target}${variant}: real hover`, async () => {
          await loadInteractionFixture(page, options.html ?? html);
          await checkHoverCase(page, options);
        });
      }
    }
  });
}

export function defineHoverCase(name, options) {
  defineHoverCases(name, { html: options.html, cases: [options] });
}

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 87: hover feedback for the "Open operator
// user removal" link (UserManagement.tsx — the hosted-tenant branch
// of Users and invitations). It is a plain <a> inside
// .admin-settings, so slice 59's admin button/input/select hovers
// never reach it, and every a:hover rule in the cascade is scoped
// elsewhere (.app-nav/.section-nav, .fixture-notice, .first-run-docs,
// .product-header .breadcrumbs, the rail/folder/not-found/data-page
// scopes), so it kept the pure UA default (transparent background,
// default link blue, underline) and matched no :hover rule. A CSSOM
// probe with all five real stylesheets (1,339 rules) in the real
// ancestor context confirmed zero matching :hover rules and
// rest == hover on every paint property. It is the only <a> inside
// .admin-settings anywhere (the AI settings, operator-removal, users
// and accept-invitation branches render no other links), so the
// scope is tight. The link now takes the admin surface's established
// hover tint (#edf7f7, slice 59). Background only, so the UA link
// colour/underline and resting geometry are unchanged; the admin
// surface is fixed light, so no dark variant is added.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = css.match(/^\.admin-settings a:hover\s*\{([^}]*)\}/m);

test('the admin-settings link hover rule exists and uses the admin surface tint', () => {
  assert.ok(rule, 'expected the .admin-settings a:hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint is the established admin-surface hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-59 admin button hover must remain #edf7f7');
  assert.ok(css.match(/\.admin-settings input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\), \.admin-settings select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-59 admin field hover must remain #edf7f7');
  assert.notEqual('#edf7f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the link hover rule is paint-only: resting geometry and link presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:|text-decoration/.test(rule[1]), 'hover must change background only');
});

test('the resting admin-settings rules are preserved', () => {
  assert.ok(css.match(/\.admin-settings\s*\{[^}]*max-width:\s*52rem/), 'the admin-settings layout rule must remain');
  assert.ok(css.match(/\.admin-settings button\s*\{[^}]*padding:\s*\.65rem 1rem/), 'the admin button resting rule must remain');
});

describe('Admin operator link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and links outside .admin-settings are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="app-shell"><main><section class="admin-settings"><h1>Users and invitations</h1>`
      + `<p>Membership in this hosted tenant is managed by the operator.</p>`
      + `<a id="op" href="#operator-users">Open operator user removal</a><p>The operator credential is required.</p></section></main></div>`
      + `<section><a id="outside" href="#">Outside</a></section>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.admin-settings a:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, decoration: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, decoration: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const outside = document.querySelector('#outside');
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        op: found ? measure(document.querySelector('#op'), found) : null,
        outsideMatches: found ? outside.matches(found.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.op.rest.background, 'rgba(0, 0, 0, 0)', 'operator link rest');
    assert.equal(actual.op.hovered.background, 'rgb(237, 247, 247)', 'operator link hover');
    assert.notEqual(actual.op.rest.background, actual.op.hovered.background);
    assert.equal(actual.op.rest.color, 'rgb(0, 0, 238)', 'operator link keeps the UA link colour at rest');
    assert.equal(actual.op.rest.color, actual.op.hovered.color, 'operator link colour unchanged on hover');
    assert.equal(actual.op.rest.decoration, 'underline', 'operator link keeps its underline at rest');
    assert.equal(actual.op.rest.decoration, actual.op.hovered.decoration, 'operator link underline unchanged on hover');
    assert.equal(actual.op.rest.box, actual.op.hovered.box, 'operator link geometry');
    assert.equal(actual.outsideMatches, false, 'a link outside .admin-settings must be out of scope');
  });
});

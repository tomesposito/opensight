import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 93: hover feedback for the plain
// connector-details buttons (.connector-details button without
// .connector-submit — "Prepare PostgreSQL data" and "Prepare this
// upload" in DataSources.tsx's ConnectorDetails, and "Check
// status" / "Cancel upload" / the completed-state "Prepare this
// upload" in DirectUpload.tsx, all inside aside.connector-details
// in the standalone connector gallery). They had zero hover
// feedback and no resting rule of their own: they rest at the UA
// default. Every button:hover rule in the cascade is scoped
// elsewhere — the data-dialog button hover covers these same
// buttons only inside the create-dataset dialog, and the
// app-shell scopes (data-sources heading, slice 92) and the
// connector-submit hover (slice 66) do not reach plain buttons.
// A CSSOM probe with all five real stylesheets (1,345 rules) in
// the real ancestor context confirmed zero matching :hover rules
// and a UA-default rest for all of them, while the gallery's
// fields (slice 91) and its submit (slice 66) do step. They now
// take the app surfaces' established secondary-button hover tint
// (#eaf3f7 — the data-dialog button hover these mirror in the
// dialog context, and the details fields' hover, slice 91), so
// no new colour is introduced. The primary submit is excluded so
// it keeps its #126e76 step. Background only, so resting
// geometry is identical and there is no animation. The gallery
// is a fixed-light app-shell surface, so no dark variant is
// added.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const dataCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/^\.connector-details button:hover:not\(:disabled\):not\(\.connector-submit\)\s*\{([^}]*)\}/m);

test('the connector-details plain button hover rule exists and uses the established secondary tint', () => {
  assert.ok(rule, 'expected the .connector-details button :hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the data-dialog button hover and the slice-91 field hover, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog button hover must remain #eaf3f7');
  assert.ok(css.match(/\.connector-details input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.connector-details select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the connector-details field hover must remain #eaf3f7');
});

test('the button hover rule is paint-only: resting geometry and button presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting connector-details rules are preserved and plain buttons still have no resting rule of their own', () => {
  assert.ok(!/^\.connector-details button\s*\{/m.test(css), 'plain connector-details buttons must keep their UA-default rest');
  assert.ok(css.match(/\.connector-submit\s*\{[^}]*background:\s*#087cb8/), 'the connector-submit resting background must remain #087cb8');
  assert.ok(css.match(/\.connector-submit:disabled\s*\{[^}]*background:\s*#dbe3e9/), 'the connector-submit disabled rule must remain');
  assert.ok(css.match(/\.connector-details input, \.connector-details select\s*\{[^}]*background:\s*white/), 'the connector-details field resting rule must remain');
});

describe('Connector-details plain button hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and the submit, disabled and outside buttons are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout">`
      + `<aside class="connector-details" aria-label="PostgreSQL setup">`
      + `<button id="pgBtn">Prepare PostgreSQL data</button>`
      + `<div class="upload-result"><button id="uploadBtn">Prepare this upload</button></div>`
      + `<button id="statusBtn" type="button">Check status</button>`
      + `<button id="disabledBtn" disabled>Prepare PostgreSQL data</button>`
      + `<form><button id="submitBtn" class="connector-submit" type="submit">Validate configuration</button></form>`
      + `</aside></div></section></main></div>`
      + `<button id="outsideBtn">Prepare data</button>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '').includes('.connector-details button:hover')) ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        pg: found ? measure(document.querySelector('#pgBtn'), found) : null,
        upload: found ? measure(document.querySelector('#uploadBtn'), found) : null,
        status: found ? measure(document.querySelector('#statusBtn'), found) : null,
        submitMatches: found ? document.querySelector('#submitBtn').matches(bare) : null,
        disabledMatches: found ? document.querySelector('#disabledBtn').matches(bare) : null,
        outsideMatches: found ? document.querySelector('#outsideBtn').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const kind of ['pg', 'upload', 'status']) {
      assert.equal(actual[kind].rest.background, 'rgb(239, 239, 239)', `connector-details ${kind} button rest (UA default)`);
      assert.equal(actual[kind].hovered.background, 'rgb(234, 243, 247)', `connector-details ${kind} button hover`);
      assert.notEqual(actual[kind].rest.background, actual[kind].hovered.background);
      assert.equal(actual[kind].rest.color, actual[kind].hovered.color, `connector-details ${kind} button colour unchanged on hover`);
      assert.equal(actual[kind].rest.box, actual[kind].hovered.box, `connector-details ${kind} button geometry`);
    }
    assert.equal(actual.submitMatches, false, 'the connector-submit inside .connector-details must be out of scope');
    assert.equal(actual.disabledMatches, false, 'a disabled plain button must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a button outside .connector-details must be out of scope');
  });
});

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 62: hover feedback for the local workspace
// banner's "Remove sample data" button (.app-shell .workspace-banner
// button in Application.tsx). Static audit follow-on to slices
// 57/59/60/61: the banner renders as an <aside> directly inside
// .app-shell, outside <main> and outside .author-workspace, .data-page,
// .collection-card and .admin-settings, so no :hover rule in any
// stylesheet reached its button — its only rule sets
// min-height/padding/font-size — and hovering changed nothing while
// buttons on every other surface tint. The banner renders only in local
// mode once sample data is loaded, so hosted/demo route audits never
// reach it in this state. The button now takes #dceff0 — app-chrome's
// own shell-control hover tint (.product-navigation .rail-search /
// .rail-more / .app-nav a hover). The lighter #eaf3f7/#eaf4f4 tints were
// rejected here because the banner itself rests at #eaf4f4, so the
// button would blend into it on hover. Background only, so resting
// geometry is identical. Static (no animation), so no reduced-motion
// variant is needed; :not(:disabled) follows the house pattern (the
// button is never disabled in the app today).
const css = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const buttonHover = css.match(/\.app-shell \.workspace-banner button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the workspace-banner button hover rule exists with the shell tint', () => {
  assert.ok(buttonHover, 'expected the workspace-banner button hover rule');
  assert.match(buttonHover[1], /background:\s*#dceff0/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(buttonHover, 'expected the workspace-banner button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(buttonHover[1]), 'hover must change background only');
});

test('the resting workspace-banner rules are preserved', () => {
  const banner = css.match(/\.app-shell \.workspace-banner\s*\{([^}]*)\}/);
  assert.ok(banner, 'expected the workspace-banner resting rule');
  assert.match(banner[1], /background:\s*#eaf4f4/);
  const button = css.match(/\.app-shell \.workspace-banner button\s*\{([^}]*)\}/);
  assert.ok(button, 'expected the workspace-banner button resting rule');
  assert.match(button[1], /min-height:\s*28px/);
  assert.match(button[1], /padding:\s*4px 8px/);
});

test('the neighbouring app-chrome hover rules are untouched', () => {
  assert.ok(css.match(/\.product-navigation \.rail-search:hover, \.product-navigation \.rail-more:hover,\s*\.product-navigation \.app-nav a:hover\s*\{[^}]*background:\s*#dceff0/), 'the product-navigation hover rule must still be present');
  assert.ok(css.match(/\.collection-card button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the collection-card button hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="app-shell"><aside class="workspace-banner">
      <span><strong>Local workspace</strong></span><span>Sample sales data loaded</span>
      <button id="remove" type="button">Remove sample data</button>
      <button id="off" type="button" disabled>Remove sample data</button>
    </aside></div>`);
    const actual = await page.evaluate(() => {
      let found;
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.app-shell .workspace-banner button:hover:not(:disabled)') found = rule;
        }
      }
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const off = document.querySelector('#off');
      return {
        remove: found ? measure(document.querySelector('#remove'), found) : null,
        offMatches: found ? off.matches(found.selectorText.replace(':hover', '')) : null,
      };
    });
    assert.ok(actual.remove, 'expected the button hover rule in the CSSOM');
    assert.equal(actual.remove.rest.background, 'rgb(239, 239, 239)', 'remove rest');
    assert.equal(actual.remove.hovered.background, 'rgb(220, 239, 240)', 'remove hover');
    assert.equal(actual.remove.rest.box, actual.remove.hovered.box, 'remove geometry');
    assert.equal(actual.offMatches, false, 'disabled buttons must be excluded from the hover rule');
  });
}

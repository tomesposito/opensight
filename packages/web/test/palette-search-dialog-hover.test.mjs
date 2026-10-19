import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 47: hover feedback for the command palette
// and global search dialogs. The two dialogs are CSS twins (identical
// --palette-* variables, identical dark headers) mounted at the
// app-shell level, so no workspace hover rule reaches them: their
// header Close buttons rested transparent, their search inputs rested
// flat white, and the global search type filter chips rested
// transparent — hovering any of them changed nothing while their list
// rows underlined. The Close buttons now take the dark-chrome hover
// tint (#365764, the .toast / product-header language); the inputs and
// unpressed chips take the dialogs' own selected tint
// (var(--palette-selected)). The input rule sets background-color
// only, so the global search input's search-icon background image
// survives. All rules are paint-only, so resting geometry is
// identical; static (no animation), so no reduced-motion variant is
// needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const closeRule = css.match(/\.command-palette header button:hover, \.global-search header button:hover\s*\{([^}]*)\}/);
const inputRule = css.match(/\.command-palette input:hover:not\(:disabled\), \.global-search > input:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const chipRule = css.match(/\.global-search \.search-types button:hover:not\(\[aria-pressed=true\]\)\s*\{([^}]*)\}/);

test('the palette/search dialog hover rules exist with the dialog tints', () => {
  assert.ok(closeRule, 'expected the grouped header Close button hover rule');
  assert.match(closeRule[1], /background:\s*#365764/);
  assert.ok(inputRule, 'expected the grouped search input hover rule');
  assert.match(inputRule[1], /background-color:\s*var\(--palette-selected\)/);
  assert.ok(chipRule, 'expected the search-types chip hover rule');
  assert.match(chipRule[1], /background:\s*var\(--palette-selected\)/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const [name, rule] of [['close', closeRule], ['input', inputRule], ['chip', chipRule]]) {
    assert.ok(rule, `expected the ${name} hover rule`);
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rule[1]), `${name} hover must change background only`);
  }
  assert.ok(!/background-image/.test(inputRule[1]), 'input hover must not touch the background image');
});

test('the resting rules still reserve the geometry the hover keeps', () => {
  const cpClose = css.match(/\.command-palette header button\s*\{([^}]*)\}/);
  assert.ok(cpClose, 'expected the command-palette resting header button rule');
  assert.match(cpClose[1], /background:\s*transparent/);
  const gsInput = css.match(/\.global-search > input\s*\{([^}]*)\}/);
  assert.ok(gsInput, 'expected the global-search resting input rule');
  assert.match(gsInput[1], /background:.*url\("data:image\/svg\+xml/);
  const chip = css.match(/\.global-search \.search-types button\s*\{([^}]*)\}/);
  assert.ok(chip, 'expected the resting search-types chip rule');
  assert.match(chip[1], /background:\s*transparent/);
  const pressed = css.match(/\.global-search \.search-types button\[aria-pressed=true\]\s*\{([^}]*)\}/);
  assert.ok(pressed, 'expected the pressed chip rule the hover excludes');
  assert.match(pressed[1], /background:\s*var\(--palette-selected\)/);
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style>
    <dialog class="command-palette" open>
      <header><h2>Command palette</h2><button type="button" id="cp-close">Close <span aria-hidden="true">×</span></button></header>
      <input id="cp-input" type="text" placeholder="Search commands…">
    </dialog>
    <dialog class="global-search" open>
      <header><h2>Search</h2><button type="button" id="gs-close">Close <span aria-hidden="true">×</span></button></header>
      <input id="gs-input" type="text" placeholder="Find anything">
      <div class="search-types" role="group"><span aria-hidden="true">Type</span>
        <button type="button" id="gs-chip" aria-pressed="false">☆ Favorites</button>
        <button type="button" id="gs-chip-pressed" aria-pressed="true">Analyses</button>
      </div>
    </dialog>`);
    const actual = await page.evaluate(() => {
      const wanted = new Set([
        '.command-palette header button:hover, .global-search header button:hover',
        '.command-palette input:hover:not(:disabled), .global-search > input:hover:not(:disabled)',
        '.global-search .search-types button:hover:not([aria-pressed=true])',
      ]);
      const bySelector = {};
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          // Chromium normalizes attribute values in selectorText with quotes.
          const sel = (rule.selectorText || '').replaceAll('"', '');
          if (wanted.has(sel)) bySelector[sel] = rule;
        }
      }
      // Append the declaration block as written: iterating rule.style
      // expands the var() shorthand into longhands whose individual
      // values do not re-apply (the var resolves only in the shorthand).
      const apply = (el, rule) => { el.style.cssText += rule.style.cssText; };
      const measure = (id, rule) => {
        const el = document.querySelector(id);
        const rest = { background: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage.slice(0, 4), box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        apply(el, rule);
        const hovered = { background: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage.slice(0, 4), box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const close = bySelector['.command-palette header button:hover, .global-search header button:hover'];
      const input = bySelector['.command-palette input:hover:not(:disabled), .global-search > input:hover:not(:disabled)'];
      const chip = bySelector['.global-search .search-types button:hover:not([aria-pressed=true])'];
      const chipSelectorNoHover = '.global-search .search-types button:not([aria-pressed=true])';
      return {
        ruleKeys: Object.keys(bySelector),
        cpClose: close ? measure('#cp-close', close) : null,
        gsClose: close ? measure('#gs-close', close) : null,
        cpInput: input ? measure('#cp-input', input) : null,
        gsInput: input ? measure('#gs-input', input) : null,
        gsChip: chip ? measure('#gs-chip', chip) : null,
        chipMatchesUnpressed: document.querySelector('#gs-chip').matches(chipSelectorNoHover),
        chipMatchesPressed: document.querySelector('#gs-chip-pressed').matches(chipSelectorNoHover),
      };
    });
    assert.equal(actual.ruleKeys.length, 3, 'expected exactly the three palette/search hover rules');
    for (const key of ['cpClose', 'gsClose']) {
      assert.ok(actual[key], `expected measurements for ${key}`);
      assert.equal(actual[key].hovered.background, 'rgb(54, 87, 100)');
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.box, actual[key].hovered.box);
    }
    for (const key of ['cpInput', 'gsInput', 'gsChip']) {
      assert.ok(actual[key], `expected measurements for ${key}`);
      assert.equal(actual[key].hovered.background, 'rgb(226, 242, 250)');
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.box, actual[key].hovered.box);
    }
    assert.equal(actual.gsInput.hovered.image, 'url(', 'the search icon must survive the input hover');
    assert.equal(actual.chipMatchesUnpressed, true);
    assert.equal(actual.chipMatchesPressed, false, 'pressed chips keep their resting selected tint');
  });
}

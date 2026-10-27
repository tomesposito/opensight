import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

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
const css = styles['style.css'];

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

defineHoverCases('admin-operator-link hover', {
  html: `<div class="app-shell"><main><section class="admin-settings"><h1>Users and invitations</h1>`
      + `<p>Membership in this hosted tenant is managed by the operator.</p>`
      + `<a id="op" href="#operator-users">Open operator user removal</a><p>The operator credential is required.</p></section></main></div>`
      + `<section><a id="outside" href="#">Outside</a></section>`,
  cases: [
    {
      target: '#op',
      rule: '.admin-settings a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color', 'textDecorationLine'],
      excluded: ['#outside'],
    },
  ],
});

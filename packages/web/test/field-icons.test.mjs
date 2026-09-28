import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldIcon } from '../build/test/FieldIcon.js';

const render = (type, name = 'field', group) => renderToStaticMarkup(createElement(FieldIcon, { field: { name, type, role: 'dimension', group } }));

test('all five scalar types have distinct visible icons and accessible labels', () => {
  const icons = [['INTEGER', 'Integer', '#'], ['DECIMAL', 'Decimal', '0.0'], ['STRING', 'Text', 'Abc'], ['DATETIME', 'Date and time', '<svg'], ['BOOLEAN', 'Boolean', 'T/F']];
  const visible = [];
  for (const [type, label, glyph] of icons) {
    const html = render(type);
    assert.ok(html.includes(glyph));
    assert.ok(html.includes(`role="img" aria-label="${label}"`));
    visible.push(html.slice(html.indexOf('>') + 1));
  }
  assert.equal(new Set(visible).size, 5);
});

test('region has a globe pin, calculations take precedence, and unknown types are explicit', () => {
  assert.match(render('STRING', 'region'), /Geography · Text/);
  assert.match(render('STRING', 'region'), /<circle/);
  assert.doesNotMatch(render('STRING', 'category'), /<svg/);
  const calculated = render('STRING', 'region', 'Calculated');
  assert.match(calculated, /aria-label="Calculated field"/);
  assert.match(calculated, />ƒ</);
  assert.doesNotMatch(calculated, /<svg|Geography/);
  assert.match(render('FUTURE'), /Unknown type \(FUTURE\)/);
  assert.match(render('FUTURE'), />\?</);
});

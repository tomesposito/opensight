import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationNotice } from '../build/test/AutomationNotice.js';

test('static automation preview exposes honest hosted requirements and no usable mutation controls', () => {
  const html = renderToStaticMarkup(createElement(AutomationNotice));
  assert.match(html, /Dataset refresh schedules/); assert.match(html, /Email report subscriptions/); assert.match(html, /Threshold alerts/);
  assert.match(html, /No schedules, subscriptions or alert rules are created here/);
  assert.equal((html.match(/<button disabled=""/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<form|<input|<a |onSubmit|successfully|scheduled for/);
  assert.match(html, /SMTP configured by its administrator/);
});

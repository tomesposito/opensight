import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsToCsv } from '../build/test/visual-export.js';

test('issue reproduction: formula-prefixed string is text-marked', () => {
  assert.equal(rowsToCsv([{ region: '=1+1', revenue: 100 }]), "region,revenue\r\n'=1+1,100\r\n");
});

test('all OWASP formula prefixes are defused on strings', () => {
  const rows = [{
    a: '=1+1',
    b: '+1+1',
    c: '-1+1',
    d: '@SUM(A1)',
    e: '\tcmd',
    f: '\rcmd',
  }];
  assert.equal(
    rowsToCsv(rows),
    "a,b,c,d,e,f\r\n'=1+1,'+1+1,'-1+1,'@SUM(A1),'\tcmd,\"'\rcmd\"\r\n"
  );
});

test('formula prefix combined with delimiter/quote escaping', () => {
  assert.equal(
    rowsToCsv([{ cell: '=SUM("a",b)' }]),
    "cell\r\n\"'=SUM(\"\"a\"\",b)\"\r\n"
  );
});

test('actual numeric types are preserved, not defused', () => {
  // A real -5 is data, not a formula: numbers pass through verbatim.
  assert.equal(rowsToCsv([{ n: -5, label: 'ok' }]), "n,label\r\n-5,ok\r\n");
  assert.equal(rowsToCsv([{ n: 1e6 }]), "n\r\n1000000\r\n");
  assert.equal(rowsToCsv([{ b: true }]), "b\r\ntrue\r\n");
});

test('a string "-5" is treated as text, not a formula', () => {
  assert.equal(rowsToCsv([{ n: '-5' }]), "n\r\n'-5\r\n");
});

test('formula-prefixed headers are defused', () => {
  assert.equal(rowsToCsv([{ '=h': 1 }]), "'=h\r\n1\r\n");
});

test('ordinary strings pass through unchanged', () => {
  assert.equal(
    rowsToCsv([{ region: 'East', note: 'a,b "c"\nline2' }]),
    "region,note\r\nEast,\"a,b \"\"c\"\"\nline2\"\r\n"
  );
});

test('null, undefined and empty rows', () => {
  assert.equal(rowsToCsv([]), '');
  assert.equal(rowsToCsv([{ a: null, b: undefined }]), "a,b\r\n,\r\n");
});

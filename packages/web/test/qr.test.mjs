import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encodeQr } from '../build/test/qr.js';
const require=createRequire(import.meta.url);
// Independent MIT implementation already installed for API operator tooling.
// Never shipped in the browser. Compare every module, including RS parity,
// placement, format/version information and mask, for the exact byte string.
const Reference=require('qrcode-terminal/vendor/QRCode/index.js');
const Blocks=require('qrcode-terminal/vendor/QRCode/QRRSBlock.js');
function compare(text) {
  const qr=encodeQr(text), reference=new Reference(qr.version,1);
  reference.addData(text); reference.makeImpl(false,qr.mask);
  assert.deepEqual(qr.modules,reference.modules);
  assert.equal(qr.modules.length,qr.version*4+17);
  return qr;
}
const capacity=version=>Blocks.getRSBlocks(version,1).reduce((n,b)=>n+b.dataCount,0)-(version<10?2:3);
for(let version=1;version<=40;version++) test(`Issue #152: QR v${version} exact reference matrix at capacity and version boundary`,()=>{
  assert.equal(compare('a'.repeat(capacity(version))).version,version);
  if(version>1) assert.equal(compare('b'.repeat(capacity(version-1)+1)).version,version);
});
for(const account of ['reader@example.test','a+b&c@example.test', 'x'.repeat(300)+'@example.test', 'é'.repeat(150)+'@example.test']) {
  test('Issue #152: exact otpauth URI, percent-encoded account, all parameters and base32 secret encode without alteration',()=>{
    const uri=`otpauth://totp/${encodeURIComponent(`OpenSight:${account}`)}?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=OpenSight&algorithm=SHA1&digits=6&period=30`;
    compare(uri);
  });
}
test('Issue #152: QR rejects unsupported input rather than truncating or fabricating a matrix',()=>{
  for(const value of ['', 'é', 'a'.repeat(2954)]) assert.throws(()=>encodeQr(value),/QR_INPUT/);
});

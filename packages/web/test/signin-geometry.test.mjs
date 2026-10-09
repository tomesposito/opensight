import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignIn } from '../build/test/SignIn.js';
import { chromiumPage } from './chromium.mjs';
const css=(await Promise.all(['style.css','sign-in.css'].map(name=>readFile(new URL(`../src/${name}`,import.meta.url),'utf8')))).join('\n');
describe('Issue #63: hosted sign-in layout',()=>{
  let page;
  before(async()=>{page=await chromiumPage();});
  after(async()=>{await page?.close();});
  for(const width of [1440,760,390,320]) for(const expired of [false,true]) test(`${width}px ${expired?'expired':'initial'} form fits and preserves accessible controls`,async()=>{
    await page.setViewportSize({width,height:900});
    const html=renderToStaticMarkup(h(SignIn,{onSignIn:async()=>{},onRetry(){},onDemo(){},...(expired?{notice:{message:'Your session has expired. Sign in again to continue.',code:'SESSION_EXPIRED'}}:{})}));
    await page.setContent(`<style>${css}\nhtml { scrollbar-width: none; }</style>${html}`);
    const actual=await page.evaluate(()=>{
      const card=document.querySelector('.sign-in-card').getBoundingClientRect();
      return {width:document.documentElement.scrollWidth,card:{left:card.left,right:card.right,width:card.width},fields:[...document.querySelectorAll('input')].map(input=>({label:input.labels.length,height:input.getBoundingClientRect().height})),password:document.querySelector('#signin-password').type};
    });
    assert.equal(actual.width,width);
    assert.ok(actual.card.left>=16&&actual.card.right<=width-16);
    assert.equal(actual.card.width,Math.min(360,width-32));
    assert.ok(actual.fields.every(field=>field.label>0));
    assert.equal(actual.password,'password');
  });
});

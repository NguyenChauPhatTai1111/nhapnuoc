'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {CONTENT_SECURITY_POLICY,SECURITY_HEADERS,createRateLimiter}=require('./security');

test('CSP chỉ cho phép API và tài nguyên cùng nguồn',()=>{
  assert.match(CONTENT_SECURITY_POLICY,/script-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY,/connect-src 'self'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY,/supabase/i);
  assert.match(CONTENT_SECURITY_POLICY,/frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY,/trusted-types 'none'/);
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'],'nosniff');
  assert.equal(SECURITY_HEADERS['X-Frame-Options'],'DENY');
});

test('rate limiter tách client và reset đúng cửa sổ',()=>{
  const allow=createRateLimiter({windowMs:1000,max:2});
  assert.equal(allow('a',0).allowed,true);
  assert.equal(allow('a',10).allowed,true);
  assert.equal(allow('a',20).allowed,false);
  assert.equal(allow('b',20).allowed,true);
  assert.equal(allow('a',1000).allowed,true);
});

test('rate limiter giới hạn bộ nhớ dùng để theo dõi client',()=>{
  const allow=createRateLimiter({maxClients:2});
  allow('a',0); allow('b',0); allow('c',0);
  assert.equal(allow('a',1).remaining,119);
});

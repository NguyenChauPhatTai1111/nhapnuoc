'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createAppServer,hardenServer}=require('./server');

async function withServer(run) {
  const server=hardenServer(createAppServer({rateLimit:10}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {await run(`http://127.0.0.1:${server.address().port}`);}
  finally {await new Promise(resolve=>server.close(resolve));}
}

test('server phục vụ file với security headers',()=>withServer(async origin=>{
  const response=await fetch(`${origin}/`);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(await response.text(),/<!doctype html>/i);
}));

test('server chặn phương thức ghi và tài nguyên ngoài whitelist',()=>withServer(async origin=>{
  assert.equal((await fetch(`${origin}/`,{method:'POST'})).status,405);
  assert.equal((await fetch(`${origin}/package.json`)).status,404);
  assert.equal((await fetch(`${origin}/..%2fpackage.json`)).status,404);
}));

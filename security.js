'use strict';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'none'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "trusted-types 'none'",
  "require-trusted-types-for 'script'",
  'upgrade-insecure-requests'
].join('; ');

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none'
});

function applySecurityHeaders(response) {
  for (const [name,value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name,value);
  response.setHeader('Cache-Control','no-store, max-age=0');
  response.setHeader('Pragma','no-cache');
}

function createRateLimiter({windowMs=60_000,max=120,maxClients=10_000}={}) {
  const clients=new Map();
  return function allow(key,now=Date.now()) {
    let entry=clients.get(key);
    if(!entry||now-entry.startedAt>=windowMs) {
      if(!entry&&clients.size>=maxClients) clients.delete(clients.keys().next().value);
      entry={startedAt:now,count:0};clients.set(key,entry);
    }
    entry.count++;
    return {allowed:entry.count<=max,remaining:Math.max(0,max-entry.count),resetAt:entry.startedAt+windowMs};
  };
}

module.exports={CONTENT_SECURITY_POLICY,SECURITY_HEADERS,applySecurityHeaders,createRateLimiter};

'use strict';

const http=require('node:http');
const {createReadStream}=require('node:fs');
const {stat}=require('node:fs/promises');
const path=require('node:path');
const {applySecurityHeaders,createRateLimiter}=require('./security');

const HOST=process.env.HOST||'127.0.0.1';
const PORT=readInteger(process.env.PORT,3000,1,65535);
const RATE_LIMIT=readInteger(process.env.RATE_LIMIT,120,10,10_000);
const ROOT=__dirname;
const ALLOWED_FILES=new Map([
  ['/','index.html'], ['/index.html','index.html'], ['/app.js','app.js'], ['/style.css','style.css'], ['/supabase-config.js','supabase-config.js']
]);
const TYPES=new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8']]);

function readInteger(value,fallback,min,max) {
  if(value===undefined||value==='') return fallback;
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<min||number>max) throw Error(`Giá trị cấu hình phải là số nguyên từ ${min} đến ${max}.`);
  return number;
}

function clientAddress(request) {
  // Không tin X-Forwarded-For: proxy production nên tự rate-limit ở lớp ngoài.
  return request.socket.remoteAddress||'unknown';
}

function send(response,status,message,extraHeaders={}) {
  response.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Content-Length':Buffer.byteLength(message),...extraHeaders});
  response.end(message);
}

function createAppServer({rateLimit=RATE_LIMIT}={}) {
  const allowRequest=createRateLimiter({max:rateLimit});
  return http.createServer(async (request,response)=>{
    applySecurityHeaders(response);
    response.setHeader('X-RateLimit-Limit',String(rateLimit));
    const rate=allowRequest(clientAddress(request));
    response.setHeader('X-RateLimit-Remaining',String(rate.remaining));
    response.setHeader('X-RateLimit-Reset',String(Math.ceil(rate.resetAt/1000)));
    if(!rate.allowed) return send(response,429,'Quá nhiều yêu cầu. Vui lòng thử lại sau.\n',{'Retry-After':String(Math.max(1,Math.ceil((rate.resetAt-Date.now())/1000)))});
    if(request.method!=='GET'&&request.method!=='HEAD') {
      response.setHeader('Allow','GET, HEAD'); return send(response,405,'Phương thức không được phép.\n');
    }
    let pathname;
    try {pathname=new URL(request.url,'http://localhost').pathname;} catch {return send(response,400,'Yêu cầu không hợp lệ.\n');}
    const filename=ALLOWED_FILES.get(pathname);
    if(!filename) return send(response,404,'Không tìm thấy tài nguyên.\n');
    const filePath=path.join(ROOT,filename);
    try {
      const info=await stat(filePath);
      response.writeHead(200,{'Content-Type':TYPES.get(path.extname(filename)),'Content-Length':info.size});
      if(request.method==='HEAD') return response.end();
      const stream=createReadStream(filePath); stream.on('error',()=>response.destroy()); stream.pipe(response);
    } catch(error) {
      console.error('Không thể đọc tài nguyên:',error.code||error.message);
      if(!response.headersSent) send(response,500,'Lỗi máy chủ.\n'); else response.destroy();
    }
  });
}

function hardenServer(server) {
  server.requestTimeout=10_000;
  server.headersTimeout=5_000;
  server.keepAliveTimeout=5_000;
  server.maxHeadersCount=50;
  server.on('clientError',(_error,socket)=>{if(socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
  return server;
}

if(require.main===module) {
  const server=hardenServer(createAppServer());
  server.listen(PORT,HOST,()=>console.log(`Sổ nước đang chạy tại http://${HOST}:${PORT}`));
}

module.exports={createAppServer,hardenServer,readInteger};

/**
 * 人生阅读本地静态服务
 *
 * - 固定监听 http://127.0.0.1:48123（数据与浏览器该源绑定，勿随意改端口）
 * - 仅托管 dist 目录；浏览器中通过 POST /api/quit 可停止服务
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RSY_PORT ?? 48123);
const ROOT = fileURLToPath(new URL('../dist', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function sendFile(response, filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) return false;
  response.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Content-Length': info.size,
    'Cache-Control': 'no-cache'
  });
  createReadStream(filePath).pipe(response);
  return true;
}

function json(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, { ok: true, name: 'rensheng-yuedu', port: PORT });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/quit') {
    json(response, 200, { ok: true });
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 60);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }

  const decoded = decodeURIComponent(url.pathname);
  const relative = decoded.startsWith('/') ? decoded.slice(1) : decoded;
  let filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end();
    return;
  }

  const candidates =
    relative === ''
      ? [path.join(ROOT, 'index.html')]
      : [filePath, path.join(filePath, 'index.html')];

  for (const candidate of candidates) {
    try {
      if (await sendFile(response, candidate)) return;
    } catch {
      // 继续尝试下一个候选
    }
  }

  // SPA：纯路径下回退首页（不把缺失的 /assets/... 错误回退到 HTML）。
  if (!decoded.startsWith('/assets/')) {
    try {
      if (await sendFile(response, path.join(ROOT, 'index.html'))) return;
    } catch {
      // 未构建时给出提示
    }
  }

  response.writeHead(404).end('Not Found');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用：人生阅读服务可能已在运行。`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`人生阅读运行于 http://${HOST}:${PORT}`);
});

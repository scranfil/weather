import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_USER_AGENT } from './js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const NWS_ORIGIN = 'https://api.weather.gov';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export function nwsProxyHeaders(clientAccept) {
  return {
    'User-Agent': APP_USER_AGENT,
    Accept: clientAccept || 'application/geo+json'
  };
}

function fileForRequest(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded.replace(/^[/\\]+/, '');
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function sendFile(res, filePath) {
  const stat = fs.statSync(filePath);
  const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

async function proxyNws(req, res) {
  const upstreamPath = req.url.slice('/nws'.length) || '/';
  const upstream = new URL(upstreamPath, NWS_ORIGIN);
  const upstreamRes = await fetch(upstream, { headers: nwsProxyHeaders(req.headers.accept) });
  const body = Buffer.from(await upstreamRes.arrayBuffer());
  const headers = {
    'Content-Type': upstreamRes.headers.get('content-type') || 'application/geo+json',
    'Cache-Control': 'no-store',
    'x-weather-nws-proxy': '1'
  };
  res.writeHead(upstreamRes.status, headers);
  res.end(body);
}

export function createAppServer(root = ROOT) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/nws' || url.pathname.startsWith('/nws/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'x-weather-nws-proxy': '1' });
          res.end();
          return;
        }
        await proxyNws(req, res);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }

      const filePath = fileForRequest(root, url.pathname);
      if (!filePath) {
        res.writeHead(403);
        res.end();
        return;
      }
      let target = filePath;
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('Not found');
        return;
      }
      if (req.method === 'HEAD') {
        const stat = fs.statSync(target);
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'Content-Length': stat.size
        });
        res.end();
        return;
      }
      sendFile(res, target);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'x-weather-nws-proxy': '1' });
      }
      res.end(error?.message || 'Proxy failed');
    }
  });
}

export function startServer({ port = 8765, host = '127.0.0.1', root = ROOT } = {}) {
  const server = createAppServer(root);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

const ranDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (ranDirectly) {
  const port = Number(process.env.PORT) || 8765;
  startServer({ port }).then((server) => {
    const address = server.address();
    console.log(`Weather app at http://127.0.0.1:${address.port}/`);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

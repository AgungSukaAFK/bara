// Server Smart BARA untuk Coolify (pengganti hosting statis + serverless Vercel).
// - File statis: halaman *.html di root (juga tanpa .html), folder js/, css/, assets/.
// - /smart-asset[-project]/... : Smart Asset Monitor (api/smart-asset.js).
// - POST /api/budget-ai        : endpoint AI (server/budget-ai.mts), dulu edge function GOA.
// - GET  /api/health           : healthcheck Coolify.
// - /budget/...                : Aplikasi Budget 2027 (container terpisah), diteruskan ke BUDGET_UPSTREAM
//                                dengan prefix /budget dipotong. Login lewat budget-gate.html (SSO).
// Env runtime: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, PORT (default 3000),
//              BUDGET_UPSTREAM (mis. http://<container-budget>:3000).
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleBudgetAi } from './server/budget-ai.mts';

const require = createRequire(import.meta.url);
const smartAsset = require('./api/smart-asset.js');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const STATIC_DIRS = new Set(['js', 'css', 'assets']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

// Hanya file yang memang publik: *.html di root, dan isi js/ css/ assets/. Folder lain (data/, supabase/,
// server/, docs/, dll.) tidak pernah disajikan.
function resolveStaticPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  let relative = path.posix.normalize(decoded).replace(/^\/+/, '');
  if (relative === '' || relative === '.') relative = 'index.html';
  if (relative.split('/').some(part => part.startsWith('.') || part === '..')) return null;

  const segments = relative.split('/');
  if (segments.length === 1) {
    if (!path.extname(relative)) relative += '.html';
    if (!relative.endsWith('.html')) return null;
  } else if (!STATIC_DIRS.has(segments[0])) {
    return null;
  }
  const absolute = path.resolve(ROOT, relative);
  return absolute.startsWith(ROOT + path.sep) ? absolute : null;
}

async function serveStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath).toLowerCase();
    const body = req.method === 'HEAD' ? undefined : await readFile(filePath);
    // HTML selalu dicek ulang; aset js/css memakai ?v= di HTML untuk cache busting.
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
    send(res, 200, body, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Payload terlalu besar.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ---- Proxy Aplikasi Budget 2027 (/budget/* -> BUDGET_UPSTREAM/*) ----
// Streaming (tanpa buffer) supaya upload/restore besar dan download Excel/PPT tetap lancar.
const BUDGET_PREFIX = '/budget';
const BUDGET_UPSTREAM = String(process.env.BUDGET_UPSTREAM || '').trim().replace(/\/+$/, '');
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function proxyToBudget(req, res) {
  if (!BUDGET_UPSTREAM) return sendJson(res, 503, { error: 'Aplikasi Budget belum dikonfigurasi di server (BUDGET_UPSTREAM).' });
  const target = new URL(BUDGET_UPSTREAM);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  headers.host = target.host;
  headers['x-forwarded-host'] = req.headers['x-forwarded-host'] || req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
  headers['x-forwarded-prefix'] = BUDGET_PREFIX;
  // Host asli BARA untuk cek origin SSO di Budget (header X-Forwarded-* bisa ditimpa Traefik bila upstream lewat domain publik).
  headers['x-bara-host'] = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const upstreamPath = target.pathname.replace(/\/+$/, '') + (req.url.slice(BUDGET_PREFIX.length) || '/');
  const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: req.method,
    path: upstreamPath,
    headers
  }, upstreamRes => {
    const responseHeaders = {};
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (!HOP_BY_HOP.has(key)) responseHeaders[key] = value;
    }
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(res);
  });
  upstream.on('error', error => {
    console.error('[budget-proxy]', error.message);
    if (!res.headersSent) sendJson(res, 502, { error: 'Aplikasi Budget tidak dapat dihubungi. Coba lagi beberapa saat.' });
    else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

async function proxyToWebHandler(req, res, handler) {
  const body = await readBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  const request = new Request(`http://internal${req.url}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
  });
  const response = await handler(request);
  const responseHeaders = Object.fromEntries(response.headers.entries());
  send(res, response.status, Buffer.from(await response.arrayBuffer()), responseHeaders);
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://internal');

    if (pathname === BUDGET_PREFIX) {
      // Path relatif di halaman Budget butuh garis miring penutup.
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return send(res, 308, '', { Location: `${BUDGET_PREFIX}/${query}` });
    }
    if (pathname.startsWith(`${BUDGET_PREFIX}/`)) return proxyToBudget(req, res);
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (pathname === '/api/budget-ai') return await proxyToWebHandler(req, res, handleBudgetAi);
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });

    const assetMatch = pathname.match(/^\/smart-asset(?:-project)?(?:\/(.*))?$/);
    if (assetMatch) {
      req.url = `/api/smart-asset?path=${encodeURIComponent(assetMatch[1] || 'index.html')}`;
      return smartAsset(req, res);
    }

    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed');
    // /rekonsil dan /rekonsil.html sama-sama dilayani tanpa redirect: kode frontend memakai
    // link "*.html" dan mengecek pathname.endsWith('/login.html').
    return await serveStatic(req, res, pathname);
  } catch (error) {
    console.error('[server]', error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'Terjadi kesalahan server.' });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Smart BARA berjalan di http://127.0.0.1:${PORT}`));

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', 'smart-asset-project');
const PUBLIC_ASSET_FILES = new Set(['index.html', 'styles.css', 'app.js', 'tail.js']);
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
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function sanitiseRequestPath(rawPath) {
  const decoded = decodeURIComponent(String(rawPath || ''));
  const trimmed = decoded.split('?')[0].replace(/^\/smart-asset/, '').replace(/^\/+/, '');
  return trimmed || 'index.html';
}

function resolveFile(requestPath) {
  const relativePath = sanitiseRequestPath(requestPath);
  if (!PUBLIC_ASSET_FILES.has(relativePath)) return null;
  const basePath = path.resolve(PROJECT_ROOT, relativePath);
  return basePath.startsWith(PROJECT_ROOT) && fs.existsSync(basePath) ? basePath : null;
}

module.exports = (req, res) => {
  const requestUrl = new URL(req.url, 'https://example.com');
  const requestPath = requestUrl.searchParams.get('path') || requestUrl.pathname;
  const filePath = resolveFile(requestPath);

  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Smart Asset file not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';

  if (extension === '.html') {
    let html = fs.readFileSync(filePath, 'utf8');
    html = html.replace('<head>', '<head><base href="/smart-asset/">')
      .replace('<script src="data.js"></script>', '');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(html);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(buffer);
};

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', 'smart-asset-project');
const DB_PATH = path.join(PROJECT_ROOT, 'db.json');
const SEED_PATH = path.join(PROJECT_ROOT, 'data.json');
const SUPABASE_URL = 'https://cjspxjtbgrumfklhewkf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Nx2dMQeYYas_U4yqbBxZoQ_FiOucSzJ';

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function ensureDb() {
  const fallbackDb = {
    assets: [],
    locationMap: {},
    codeFormats: [],
    version: 1
  };

  const seedData = readJson(SEED_PATH, []);
  const existingDb = readJson(DB_PATH, fallbackDb);

  if (!existingDb || typeof existingDb !== 'object') {
    return { ...fallbackDb, assets: Array.isArray(seedData) ? seedData : [] };
  }

  existingDb.assets = Array.isArray(existingDb.assets) ? existingDb.assets : [];
  existingDb.locationMap = existingDb.locationMap || {};
  existingDb.codeFormats = Array.isArray(existingDb.codeFormats) ? existingDb.codeFormats : [];
  existingDb.version = existingDb.version || 1;

  if (!fs.existsSync(DB_PATH) && Array.isArray(seedData)) existingDb.assets = seedData;

  return existingDb;
}

async function hasAuthenticatedUser(authorization) {
  if (!/^Bearer\s+\S+/i.test(String(authorization || ''))) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smartbara_is_member`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization, 'Content-Type': 'application/json' },
      body: '{}'
    });
    return response.ok && (await response.json()) === true;
  } catch(error) {
    return false;
  }
}

module.exports = async (req, res) => {
  const origin = String(req.headers.origin || '');
  const isAllowedOrigin = origin === 'https://bara.lourdes.cloud';
  const headers = {
    'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'https://bara.lourdes.cloud',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (!await hasAuthenticatedUser(req.headers.authorization)) {
    res.writeHead(401, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Login Smart BARA diperlukan untuk mengakses migrasi data aset.' }));
    return;
  }

  if (req.method === 'GET') {
    const db = ensureDb();
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(db));
    return;
  }

  res.writeHead(405, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'Method not allowed. Simpan data melalui Supabase.' }));
};

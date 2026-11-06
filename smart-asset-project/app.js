/* ===== Smart Asset Monitor - app.js ===== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* ---------- State ---------- */
let assets = [];
let charts = {};
let sortKey = 'id';
let sortDir = 'asc';
let currentPage = 1;
let pageSize = 25;
let pendingImport = null;
let confirmCallback = null;
let locationMap = {};
let locationFallback = '';
let useApi = false;
let cloudAssetStateUpdatedAt = '';
let assetCloudSaveInProgress = false;
let assetCloudRetryTimer = null;
let assetCloudRealtimeChannel = null;
let audits = [];
let auditSortKey = 'kode', auditSortDir = 'asc';
const SETTINGS_STORAGE_KEY = 'smartAssetSettings';
const UPLOAD_HISTORY_KEY = 'smartAssetUploadHistory';
const ASSET_CLOUD_STATE_KEY = 'asset_monitor_legacy_snapshot';
const ASSET_CLOUD_SYNC_QUEUE_KEY = 'smartAssetPendingCloudSnapshot_v1';
let uploadHistory = [];
let activeUploadHistoryId = '';
let codeFormats = [
  { id: 'CF-1', name: 'Format Default', category: 'Semua', minValue: 0, slots: [
    {type:'text', value:'AST'}, {type:'column', value:'tipe'}, {type:'column', value:'lokasi'}, {type:'text', value:'01'}, {type:'seq', value:''}
  ]}
];
// monthly view globals
let monthlyBasis = null, monthlyCat = null, monthlyLoc = null;
function loadUploadHistory() {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    const rawHistory = Array.isArray(settings.uploadHistory)
      ? settings.uploadHistory
      : JSON.parse(localStorage.getItem(UPLOAD_HISTORY_KEY) || '[]');
    uploadHistory = Array.isArray(rawHistory) ? rawHistory : [];
    activeUploadHistoryId = settings.defaultUploadHistoryId || '';
  } catch (error) {
    uploadHistory = [];
    activeUploadHistoryId = '';
  }
}
function saveUploadHistory() {
  const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
  const safeHistory = Array.isArray(uploadHistory) ? uploadHistory.slice(0, 10) : [];
  settings.uploadHistory = safeHistory;
  if (activeUploadHistoryId) settings.defaultUploadHistoryId = activeUploadHistoryId;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  localStorage.setItem(UPLOAD_HISTORY_KEY, JSON.stringify(safeHistory));
}
function addUploadHistoryEntry({ label, mode, rows, snapshot = [] }) {
  const entry = {
    id: 'hist-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6),
    label: label || `Backup ${new Date().toLocaleString('id-ID')}`,
    mode: mode || 'append',
    rows: Number(rows) || 0,
    createdAt: new Date().toISOString(),
    snapshot: Array.isArray(snapshot) ? snapshot.map((item) => ({ ...item })) : []
  };
  uploadHistory = [entry, ...uploadHistory.filter((item) => item.id !== entry.id)].slice(0, 10);
  activeUploadHistoryId = entry.id;
  saveUploadHistory();
  renderUploadHistory();
  return entry;
}
function restoreUploadHistoryEntry(historyId) {
  const entry = (uploadHistory || []).find((item) => item.id === historyId);
  if (!entry || !Array.isArray(entry.snapshot)) return false;
  const restored = entry.snapshot.map((item) => normalizeAsset({ ...item }));
  assets = restored;
  ensureLocations();
  saveAssets();
  activeUploadHistoryId = historyId;
  saveUploadHistory();
  renderUploadHistory();
  renderAssetTable();
  renderDashboard();
  return true;
}
function renderUploadHistory() {
  const root = document.getElementById('uploadHistoryList');
  if (!root) return;
  if (!uploadHistory.length) {
    root.innerHTML = '<div class="empty-state">Belum ada riwayat upload. Setelah import data, history akan muncul di sini.</div>';
    return;
  }
  root.innerHTML = uploadHistory.map((entry) => `
    <button class="history-item ${activeUploadHistoryId === entry.id ? 'active' : ''}" data-history-id="${esc(entry.id)}" data-action="select-upload-history" type="button">
      <div class="history-main">
        <span class="history-name">${esc(entry.label)}</span>
        <span class="history-meta">${esc(entry.mode === 'replace' ? 'Ganti semua data' : 'Append')} • ${entry.rows} aset</span>
      </div>
      <span class="history-time">${new Date(entry.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</span>
    </button>
  `).join('');
  root.querySelectorAll('[data-action="select-upload-history"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.historyId;
      if (!id) return;
      activeUploadHistoryId = id;
      saveUploadHistory();
      renderUploadHistory();
      restoreUploadHistoryEntry(id);
      toast('Backup history dipilih sebagai default', 'success');
    });
  });
}
function loadLocationMap(){
  try {
    const rawSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    const rawMap = rawSettings.locationMap && typeof rawSettings.locationMap === 'object' ? rawSettings.locationMap : JSON.parse(localStorage.getItem('locationMap') || '{}');
    locationMap = rawMap && typeof rawMap === 'object' ? rawMap : {};
    locationFallback = String(rawSettings.locationFallback || '');
  } catch (e) {
    locationMap = {};
    locationFallback = '';
  }
}
function saveLocationMap(){
  const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
  const payload = {
    ...stored,
    locationMap,
    locationFallback,
    codeFormats: Array.isArray(codeFormats) ? codeFormats : [],
    uploadHistory: Array.isArray(uploadHistory) ? uploadHistory : [],
    defaultUploadHistoryId: activeUploadHistoryId || stored.defaultUploadHistoryId || ''
  };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem('locationMap', JSON.stringify(locationMap));
  if (useApi) { apiSaveDb(); }
}

async function apiLoadDb() {
  const client = window.smartAssetSupabase;
  if (!client) throw new Error('Koneksi Supabase Smart BARA tidak tersedia.');

  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const session = sessionData?.session;
    if (!session) throw new Error('Login Smart BARA diperlukan untuk mengakses data aset cloud.');

    const { data: cloudRow, error: readError } = await client.from('smart_asset_monitor_config')
      .select('value, updated_at')
      .eq('key', ASSET_CLOUD_STATE_KEY)
      .maybeSingle();
    if (readError) throw readError;
    if (!cloudRow || !Array.isArray(cloudRow.value?.assets)) {
      throw new Error('Snapshot aset cloud belum tersedia. Hubungi admin; data lokal tidak akan digunakan.');
    }
    const remoteState = cloudRow.value;
    cloudAssetStateUpdatedAt = cloudRow.updated_at || '';

    const pending = readPendingAssetCloudSnapshot();
    if (pending?.userId === session.user.id) {
      if (pending.baseUpdatedAt === cloudAssetStateUpdatedAt) {
        remoteState = pending.state;
        window.smartAssetSyncPending = true;
      } else {
        toast('Ada perubahan aset cloud lain saat perubahan lokal menunggu. Muat ulang dan tinjau perubahan sebelum menyimpan.', 'warning');
      }
    }

    const db = remoteState && typeof remoteState === 'object' ? remoteState : {};
    assets = Array.isArray(db.assets) ? db.assets.map(normalizeAsset) : [];
    locationMap = db.locationMap && typeof db.locationMap === 'object' ? db.locationMap : {};
    locationFallback = String(db.locationFallback || '');
    codeFormats = Array.isArray(db.codeFormats) ? db.codeFormats.map(ensureCodeFormatShape).filter(Boolean) : [];
    audits = Array.isArray(db.audits) ? db.audits : [];
    useApi = true;
    setupAssetStateRealtime(client);
    if (pending?.userId === session.user.id && pending.baseUpdatedAt === cloudAssetStateUpdatedAt) scheduleAssetCloudRetry();
    return true;
  } catch (error) {
    console.warn('Gagal memuat snapshot aset cloud:', error);
    useApi = false;
    return false;
  }
}

async function apiSaveDb() {
  let userId = '';
  let expectedUpdatedAt = cloudAssetStateUpdatedAt;
  try {
    if (!useApi) return false;
    const value = { assets, locationMap, locationFallback, codeFormats, audits, version: 1 };

    const client = window.smartAssetSupabase;
    if (!client) return false;
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session) throw new Error('Sesi login berakhir. Login kembali sebelum menyimpan aset.');
    userId = sessionData.session.user.id;
    const pending = readPendingAssetCloudSnapshot();
    if (pending?.userId === userId) expectedUpdatedAt = pending.baseUpdatedAt;

    const updatedAt = new Date().toISOString();
    assetCloudSaveInProgress = true;
    const { data, error } = await client.from('smart_asset_monitor_config')
      .update({ value, updated_at: updatedAt })
      .eq('key', ASSET_CLOUD_STATE_KEY)
      .eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
      .maybeSingle();
    assetCloudSaveInProgress = false;
    if (error) throw error;
    if (!data) throw new Error('Data aset diubah pengguna lain. Muat ulang data sebelum menyimpan perubahan.');
    cloudAssetStateUpdatedAt = data.updated_at || updatedAt;
    localStorage.removeItem(ASSET_CLOUD_SYNC_QUEUE_KEY);
    window.smartAssetSyncPending = false;
    return true;
  } catch (err) {
    assetCloudSaveInProgress = false;
    console.warn('Gagal menyimpan snapshot aset Supabase:', err);
    if (userId && isRetryableAssetCloudError(err)) {
      const previous = readPendingAssetCloudSnapshot();
      const queued = {
        userId,
        state: { assets, locationMap, locationFallback, codeFormats, audits, version: 1 },
        baseUpdatedAt: previous?.userId === userId ? previous.baseUpdatedAt : expectedUpdatedAt,
        updatedAt: new Date().toISOString(),
        lastError: err.message || 'Koneksi cloud terputus.'
      };
      try {
        localStorage.setItem(ASSET_CLOUD_SYNC_QUEUE_KEY, JSON.stringify(queued));
        window.smartAssetSyncPending = true;
        scheduleAssetCloudRetry();
        toast('Perubahan aset menunggu sinkronisasi cloud.', 'warning');
        return true;
      } catch (storageError) {
        toast('Perubahan belum tersimpan ke cloud dan antrean lokal penuh.', 'error');
        return false;
      }
    }
    toast(err.message || 'Gagal menyimpan aset ke cloud.', 'warning');
    return false;
  }
}

function readPendingAssetCloudSnapshot() {
  try {
    const pending = JSON.parse(localStorage.getItem(ASSET_CLOUD_SYNC_QUEUE_KEY) || 'null');
    return pending && typeof pending === 'object' ? pending : null;
  } catch (error) {
    return null;
  }
}

function isRetryableAssetCloudError(error) {
  return Boolean(!navigator.onLine || error instanceof TypeError || /network|fetch|timeout|temporar|offline|connection|gateway|\b50[234]\b/i.test(error?.message || ''));
}

function scheduleAssetCloudRetry() {
  if (!navigator.onLine || assetCloudRetryTimer) return;
  assetCloudRetryTimer = setTimeout(async () => {
    assetCloudRetryTimer = null;
    if (!readPendingAssetCloudSnapshot() || !useApi) return;
    const synced = await apiSaveDb();
    if (!synced && isRetryableAssetCloudError(new Error('Retry cloud gagal.'))) scheduleAssetCloudRetry();
  }, 15000);
}

window.addEventListener('online', async () => {
  if (readPendingAssetCloudSnapshot() && !useApi) {
    const loaded = await apiLoadDb();
    if (!loaded) return;
  }
  scheduleAssetCloudRetry();
});

function setupAssetStateRealtime(client) {
  if (assetCloudRealtimeChannel || !client) return;
  assetCloudRealtimeChannel = client.channel('smart-asset-state-sync')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'smart_asset_monitor_config',
      filter: `key=eq.${ASSET_CLOUD_STATE_KEY}`
    }, payload => {
      if (assetCloudSaveInProgress) return;
      const pending = readPendingAssetCloudSnapshot();
      if (pending && payload.new?.updated_at !== pending.baseUpdatedAt) {
        toast('Data cloud berubah saat ada perubahan lokal yang menunggu. Periksa konflik sebelum menyimpan ulang.', 'warning');
        return;
      }
      apiLoadDb().then(loaded => {
        if (!loaded) return;
        ensureLocations();
        renderAssetTable();
        renderDashboard();
        renderReport();
      });
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Realtime Smart Asset terputus; perubahan akan dicoba ulang.', 'warning');
    });
}

const LOC_BLACKLIST = new Set(['GMI','DTS','FN','IT','USB','OHP','DOM','PABX','ELK','FRN','LX','LT','SCM']);
function normalizeSearchText(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function resolveLocationKey(token) {
  const raw = String(token ?? '').trim();
  if (!raw) return '';
  const normalizedRaw = normalizeSearchText(raw);
  const keys = Object.keys(locationMap || {});
  const direct = keys.find((key) => normalizeSearchText(key) === normalizedRaw);
  if (direct) return direct;
  const exactUpper = keys.find((key) => key.toUpperCase() === raw.toUpperCase());
  if (exactUpper) return exactUpper;
  const contains = keys.find((key) => normalizeSearchText(key).includes(normalizedRaw) || normalizedRaw.includes(normalizeSearchText(key)));
  if (contains) return contains;
  return raw;
}
function locationTokenMatchesCode(token, code){
  const tokenParts = String(token || '').match(/[A-Za-z0-9]+/g) || [];
  const codeParts = String(code || '').match(/[A-Za-z0-9]+/g) || [];
  if (!tokenParts.length) return false;
  const normalizedToken = normalizeSearchText(tokenParts.join(''));
  return codeParts.some((_, index) =>
    normalizeSearchText(codeParts.slice(index, index + tokenParts.length).join('')) === normalizedToken
  );
}
function extractLocationToken(kode){
  const haystack = String(kode || '');
  const rawTokens = (haystack.match(/[A-Za-z]{2,}/g) || []).map((token) => token.toUpperCase());
  const tokens = [...new Set(rawTokens)];
  const filtered = tokens.filter((token) => !LOC_BLACKLIST.has(token) && token.length >= 2);
  const mapKeys = Object.keys(locationMap || {});
  const mappedSequence = mapKeys
    .slice()
    .sort((a, b) => normalizeSearchText(b).length - normalizeSearchText(a).length)
    .find((key) => locationTokenMatchesCode(key, haystack));
  if (mappedSequence) return mappedSequence;
  const direct = filtered.find((token) => {
    const matchByName = mapKeys.some((key) => normalizeSearchText(key) === normalizeSearchText(token));
    const matchByToken = mapKeys.some((key) => key.toUpperCase() === token);
    return matchByName || matchByToken;
  });
  if (direct) return direct;
  const flexibleMatch = filtered.find((token) => mapKeys.some((key) => {
    const nKey = normalizeSearchText(key);
    const nToken = normalizeSearchText(token);
    return nKey.includes(nToken) || nToken.includes(nKey);
  }));
  if (flexibleMatch) return mapKeys.find((key) => normalizeSearchText(key) === normalizeSearchText(flexibleMatch)) || flexibleMatch;
  const tokenFromMap = mapKeys.find((key) => normalizeSearchText(key).includes(normalizeSearchText(haystack)) || normalizeSearchText(haystack).includes(normalizeSearchText(key)));
  if (tokenFromMap) return tokenFromMap;
  if (filtered.length) return filtered[0];
  return '';
}
function locationFullName(token){
  if (!token) return 'Belum diatur';
  const resolvedKey = resolveLocationKey(token);
  return locationMap[resolvedKey] || locationMap[resolvedKey.toUpperCase()] || token;
}
function getConfiguredLocationKey(token){
  return Object.keys(locationMap || {}).find((key) =>
    normalizeSearchText(key) === normalizeSearchText(token) &&
    normalizeSearchText(locationMap[key]) !== normalizeSearchText(key)
  ) || '';
}
function applyLocationRule(asset){
  const token = extractLocationToken(asset.kode || asset.nama || '');
  if (!token) return false;
  const mappedKey = getConfiguredLocationKey(token);
  asset.lokasiToken = mappedKey || token;
  asset.lokasi = mappedKey ? locationMap[mappedKey] : (locationFallback || token);
  asset.lokasiManual = false;
  return true;
}
function parseUmurMonths(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v * 12));
  const s = String(v).trim().toLowerCase();
  if (!s) return 0;

  const compact = s.replace(/\s+/g, '').replace(/,/g, '.');
  const yearMatch = compact.match(/(\d+(?:\.\d+)?)\s*(?:yr|yrs|year|years|tahun|thn|y)/);
  const monthMatch = compact.match(/(\d+(?:\.\d+)?)\s*(?:mo|mth|month|months|bulan|bln|m)/);

  if (yearMatch || monthMatch) {
    const years = yearMatch ? Number(yearMatch[1]) : 0;
    const months = monthMatch ? Number(monthMatch[1]) : 0;
    return Math.max(0, Math.round((years * 12) + months));
  }

  const numeric = Number(s.replace(/[^0-9.]/g, ''));
  if (!Number.isNaN(numeric)) return Math.max(0, Math.round(numeric * 12));
  return 0;
}
function isStraightLine(metode) {
  const m = String(metode || '').toLowerCase();
  if (m.includes('saldo') || m.includes('declining') || m.includes('db')) return false;
  return true;
}
function normalizeCategoryNumberMap(value) {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  Object.entries(value).forEach(([key, raw]) => {
    const label = String(key || '').trim();
    const num = Number(raw);
    if (!label || !Number.isFinite(num)) return;
    result[normalizeCategoryName(label)] = num;
  });
  return result;
}
function getCategorySequenceBase(format, asset) {
  const map = normalizeCategoryNumberMap(format && format.categoryNumberMap ? format.categoryNumberMap : {});
  const category = String(asset?.tipe || asset?.kategori || asset?.category || '').trim();
  if (!category) return 1;
  const normalized = normalizeCategoryName(category);
  return Number(map[normalized] ?? 1);
}
function normalizeAsset(a){
  if (a.dsScore === undefined) a.dsScore = '';
  if (a.lokasiToken === undefined) a.lokasiToken = '';
  if (a.lokasi === undefined) a.lokasi = '';
  if (a.lokasiManual === undefined) a.lokasiManual = false;

  const harga = Number(a.harga) || 0;
  const totalMonthsUseful = parseUmurMonths(a.umur);
  const umurYears = totalMonthsUseful > 0 ? totalMonthsUseful / 12 : 0;
  const metode = a.metode || '';
  const straight = isStraightLine(metode);
  const manualRate = Number(a.rasio);
  const yearlyRate = Number.isFinite(manualRate) && manualRate > 0 ? manualRate : (umurYears > 0 ? (100 / umurYears) : 0);
  const tglBeli = a.tglBeli ? new Date(a.tglBeli) : null;
  const tglPakai = a.tglPakai ? new Date(a.tglPakai) : (tglBeli || null);
  const now = new Date();

  let totalMonths = 0;
  if (tglPakai && !isNaN(tglPakai.getTime())) {
    totalMonths = (now.getFullYear() - tglPakai.getFullYear()) * 12 + (now.getMonth() - tglPakai.getMonth());
    if (now.getDate() < tglPakai.getDate()) totalMonths--;
    totalMonths = Math.max(0, totalMonths);
  }
  if (totalMonthsUseful > 0) totalMonths = Math.min(totalMonths, totalMonthsUseful);

  const isFullyDepreciated = totalMonthsUseful > 0 && totalMonths >= totalMonthsUseful;
  let monthlyDepreciation = 0;
  let accumulatedDepreciation = 0;
  let currentPeriodDepreciation = 0;
  let bookValue = harga;

  if (totalMonthsUseful > 0 && harga > 0) {
    if (straight) {
      monthlyDepreciation = harga * (yearlyRate / 100) / 12;
      if (!Number.isFinite(monthlyDepreciation) || monthlyDepreciation <= 0) {
        monthlyDepreciation = harga / totalMonthsUseful;
      }
      accumulatedDepreciation = Math.min(monthlyDepreciation * totalMonths, harga);
      currentPeriodDepreciation = isFullyDepreciated ? 0 : Math.min(monthlyDepreciation, Math.max(harga - accumulatedDepreciation, 0));
      bookValue = Math.max(harga - accumulatedDepreciation, 0);
    } else {
      const rate = (Number.isFinite(manualRate) && manualRate > 0 ? manualRate : (200 / (umurYears || 1))) / 100;
      const monthlyRate = rate / 12;
      let remainingValue = harga;
      let accDep = 0;

      for (let m = 0; m < totalMonths; m++) {
        const dep = Math.min(remainingValue * monthlyRate, remainingValue);
        accDep += dep;
        remainingValue -= dep;
        if (remainingValue <= 0) break;
      }
      accumulatedDepreciation = Math.min(accDep, harga);
      currentPeriodDepreciation = isFullyDepreciated ? 0 : Math.min(remainingValue * monthlyRate, remainingValue);
      bookValue = Math.max(harga - accumulatedDepreciation, 0);
    }
  }

  const monthsRemaining = Math.max(0, totalMonthsUseful - totalMonths);

  a.depreciation = {
    monthly: Math.round(monthlyDepreciation),
    accumulated: Math.round(accumulatedDepreciation),
    currentPeriod: Math.round(currentPeriodDepreciation),
    bookValue: Math.round(bookValue),
    totalMonths,
    totalMonthsUseful,
    monthsRemaining,
    isFullyDepreciated,
    metode: metode || 'Metode Garis Lurus',
    yearlyRate
  };
  a.status = totalMonthsUseful > 0 && isFullyDepreciated ? 'Sudah Habis Disusutkan' : 'Belum Habis Disusutkan';
  return a;
}

function getLatestAudit(assetId) {
  const list = Array.isArray(audits) ? audits.filter((item) => item.assetId === assetId) : [];
  if (!list.length) return null;
  return list.sort((a, b) => new Date(b.tanggal || 0) - new Date(a.tanggal || 0))[0];
}

function getAuditStatusText(asset) {
  if (!asset) return 'Belum';
  const latest = getLatestAudit(asset.id);
  return latest ? latest.kondisi || 'Belum' : 'Belum';
}

function getAssetStatusText(asset) {
  if (!asset) return 'Belum Habis Disusutkan';
  return asset.status || (asset.depreciation?.isFullyDepreciated ? 'Sudah Habis Disusutkan' : 'Belum Habis Disusutkan');
}

function formatDateShort(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function safeText(value) {
  return String(value ?? '').trim() || '-';
}

function setSort(key) {
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'asc';
  }
  renderAssetTable();
}

function setAuditSort(key) {
  if (auditSortKey === key) {
    auditSortDir = auditSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    auditSortKey = key;
    auditSortDir = 'asc';
  }
  renderAuditView();
}

window.setSort = setSort;
window.setAuditSort = setAuditSort;

/* ---------- Helpers ---------- */
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; }
function rupiah(n) { return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 }); }
function shortNum(n) { if (n >= 1e9) return (n / 1e9).toFixed(1) + ' M'; if (n >= 1e6) return (n / 1e6).toFixed(1) + ' Jt'; return Number(n).toLocaleString('id-ID'); }
function migrateCodeFormat(cf) {
  if (!cf) return null;
  if (Array.isArray(cf.normal)) return cf;
  // migrate old format
  return {
    threshold: cf.threshold || 5000000,
    normal: [
      {type:'text', value: cf.text1 || ''},
      {type:'column', value: cf.field1 || ''},
      {type:'column', value: cf.field2 || ''},
      {type:'text', value: cf.text2 || ''},
      {type:'seq', value:''}
    ],
    high: [
      {type:'text', value: cf.text1High || cf.text1 || ''},
      {type:'column', value: cf.field1 || ''},
      {type:'column', value: cf.field2 || ''},
      {type:'text', value: cf.text2High || cf.text2 || ''},
      {type:'seq', value:''}
    ]
  };
}
function migrateCodeFormatToFormat(cf) {
  if (!cf) return null;
  if (Array.isArray(cf.slots)) return { id: 'CF-' + Date.now(), name: cf.name || 'Format', category: cf.category || 'Semua', minValue: cf.minValue || 0, slots: cf.slots };
  return {
    id: 'CF-' + Date.now(),
    name: cf.name || 'Format',
    category: cf.category || 'Semua',
    minValue: cf.minValue || 0,
    slots: [
      {type:'text', value: cf.text1 || ''},
      {type:'column', value: cf.field1 || ''},
      {type:'column', value: cf.field2 || ''},
      {type:'text', value: cf.text2 || ''},
      {type:'seq', value:''}
    ]
  };
}
const ASSET_FIELD_OPTIONS = [
  { value: 'kode', label: 'Kode Aset' },
  { value: 'nama', label: 'Nama Aset' },
  { value: 'category', label: 'Kategori / Tipe' },
  { value: 'kategori', label: 'Kategori' },
  { value: 'tipe', label: 'Tipe / Kategori' },
  { value: 'lokasi', label: 'Lokasi' },
  { value: 'lokasiToken', label: 'Token Lokasi' },
  { value: 'noAkun', label: 'No. Akun' },
  { value: 'harga', label: 'Harga' },
  { value: 'tglBeli', label: 'Tanggal Beli' },
  { value: 'tglPakai', label: 'Tanggal Pakai' },
  { value: 'umur', label: 'Umur' },
  { value: 'rasio', label: 'Rasio' },
  { value: 'dsScore', label: 'DS Score' },
  { value: 'metode', label: 'Metode' },
  { value: 'id', label: 'ID' }
];

const CATEGORY_SHORTCUTS = {
  bangunan: 'BGN',
  bangunansemi: 'BSP',
  bangunansemipermanen: 'BSP',
  kendaraan: 'KDR',
  mesin: 'MSN',
  komputer: 'KPT',
  elektronik: 'ELK',
  alat: 'ALT',
  furniture: 'FNR',
  peralatan: 'PRL',
  software: 'SFT',
  inventaris: 'INV',
  aset: 'AST',
  umum: 'UMM'
};

const LOCATION_SHORTCUTS = {
  balikpapan: 'BPN',
  bpn: 'BPN',
  jakarta: 'JKT',
  jkt: 'JKT',
  makassar: 'MKS',
  mks: 'MKS',
  medan: 'MDN',
  mdn: 'MDN',
  bandung: 'BDG',
  bdg: 'BDG',
  surabaya: 'SBY',
  sby: 'SBY',
  semarang: 'SMG',
  smg: 'SMG',
  palembang: 'PLB',
  plb: 'PLB',
  yogyakarta: 'YOG',
  yog: 'YOG',
  pontianak: 'PTK',
  ptk: 'PTK'
};

const DATE_FORMAT_PRESETS = [
  { label: 'YYYYMMDD', pattern: 'yyyyMMdd' },
  { label: 'DDMMYYYY', pattern: 'ddMMyyyy' },
  { label: 'YYYYMM', pattern: 'yyyyMM' },
  { label: 'YYMMDD', pattern: 'yyMMdd' }
];

function normalizeCategoryName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCategoryShortcut(value = '') {
  const key = normalizeCategoryName(value);
  if (!key) return 'AST';
  const direct = CATEGORY_SHORTCUTS[key] || CATEGORY_SHORTCUTS[String(key).replace(/\s+/g, '')];
  if (direct) return direct;
  const words = String(value || '').trim().split(/\s+|\/|\-|&/).filter(Boolean);
  if (!words.length) return 'AST';
  return words.slice(0, 3).map((word) => word.charAt(0).toUpperCase()).join('').slice(0, 3) || 'AST';
}

function getLocationShortcut(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'LOC';
  const normalized = text.toLowerCase().replace(/[^a-z]/g, '');
  const direct = LOCATION_SHORTCUTS[normalized];
  if (direct) return direct;
  const words = text.split(/\s+|\/|\-|_/).filter(Boolean);
  if (!words.length) return 'LOC';
  return words.slice(0, 3).map((word) => word.charAt(0).toUpperCase()).join('').slice(0, 3) || 'LOC';
}

function formatDateToken(rawValue, pattern) {
  const value = String(rawValue ?? '').trim();
  if (!value) return '';
  const dateValue = value.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(value + 'T00:00:00') : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return value.replace(/[^0-9]/g, '');
  const year = dateValue.getFullYear();
  const shortYear = String(year).slice(-2);
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  const monthName = dateValue.toLocaleString('id-ID', { month: 'short' });

  let result = String(pattern || 'yyyyMMdd');
  result = result.replace(/yyyy/g, String(year));
  result = result.replace(/yy/g, shortYear);
  result = result.replace(/MMMM/g, monthName);
  result = result.replace(/MM/g, month);
  result = result.replace(/M/g, String(dateValue.getMonth() + 1));
  result = result.replace(/dd/g, day);
  result = result.replace(/d/g, String(dateValue.getDate()));
  return result;
}

function resolveAssetFieldValue(asset, fieldName) {
  const field = String(fieldName || '').trim();
  if (!field) return '';
  const aliases = {
    category: ['category', 'kategori', 'tipe'],
    kategori: ['kategori', 'category', 'tipe'],
    tipe: ['tipe', 'category', 'kategori'],
    lokasi: ['lokasi', 'lokasiToken'],
    lokasiToken: ['lokasiToken', 'lokasi']
  };
  const candidates = aliases[field] || [field];
  for (const name of candidates) {
    const value = asset && asset[name] !== undefined ? asset[name] : '';
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return asset && asset[field] !== undefined ? asset[field] : '';
}
function getAssetFieldLabel(fieldName) {
  const raw = String(fieldName || '').trim();
  const aliasMap = {
    category: 'Kategori / Tipe',
    kategori: 'Kategori',
    tipe: 'Tipe / Kategori'
  };
  const found = ASSET_FIELD_OPTIONS.find((option) => option.value === raw);
  if (found) return found.label;
  if (aliasMap[raw]) return aliasMap[raw];
  return raw || 'Kolom';
}
function normalizeCodeSlot(slot = {}) {
  const type = slot.type === 'seq' ? 'seq' : (slot.type === 'column' ? 'column' : 'text');
  return {
    type,
    value: slot.value ?? '',
    format: slot.format || 'full',
    custom: slot.custom || ''
  };
}
function parseCategoryNumberMap(rawValue) {
  const map = {};
  const text = String(rawValue || '').trim();
  if (!text) return map;
  const rows = text.split(/[\n;]+/).map((row) => row.trim()).filter(Boolean);
  rows.forEach((row) => {
    const cleaned = row.replace(/\s*[:=]\s*/, ':');
    const [label, value] = cleaned.split(':');
    if (!label || value === undefined) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    map[normalizeCategoryName(label)] = number;
  });
  return map;
}
function ensureCodeFormatShape(format) {
  if (!format || typeof format !== 'object') return null;
  const slots = Array.isArray(format.slots) ? format.slots.map(normalizeCodeSlot) : [
    { type: 'text', value: 'AST', format: 'full', custom: '' },
    { type: 'column', value: 'tipe', format: 'short', custom: '' },
    { type: 'column', value: 'lokasi', format: 'short', custom: '' },
    { type: 'text', value: '01', format: 'full', custom: '' },
    { type: 'seq', value: '', format: 'full', custom: '' }
  ];
  return {
    id: format.id || ('CF-' + Date.now()),
    name: format.name || 'Format Baru',
    category: format.category || 'Semua',
    minValue: Number(format.minValue) || 0,
    categoryNumberMap: normalizeCategoryNumberMap(format.categoryNumberMap || format.categoryNumber || format.categoryMap || ''),
    slots
  };
}
function loadCodeFormats() {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    const raw = Array.isArray(settings.codeFormats)
      ? settings.codeFormats
      : JSON.parse(localStorage.getItem('smartAssetCodeFormats') || '[]');
    const parsed = Array.isArray(raw) ? raw.map(ensureCodeFormatShape).filter(Boolean) : [];
    codeFormats = parsed.length ? parsed : [{
      id: 'CF-1',
      name: 'Format Default',
      category: 'Semua',
      minValue: 0,
      slots: [
        { type: 'text', value: 'AST', format: 'full', custom: '' },
        { type: 'column', value: 'tipe', format: 'short', custom: '' },
        { type: 'column', value: 'lokasi', format: 'short', custom: '' },
        { type: 'text', value: '01', format: 'full', custom: '' },
        { type: 'seq', value: '', format: 'full', custom: '' }
      ]
    }];
  } catch (err) {
    console.warn('Gagal memuat format kode', err);
    codeFormats = [{
      id: 'CF-1',
      name: 'Format Default',
      category: 'Semua',
      minValue: 0,
      slots: [
        { type: 'text', value: 'AST', format: 'full', custom: '' },
        { type: 'column', value: 'tipe', format: 'short', custom: '' },
        { type: 'column', value: 'lokasi', format: 'short', custom: '' },
        { type: 'text', value: '01', format: 'full', custom: '' },
        { type: 'seq', value: '', format: 'full', custom: '' }
      ]
    }];
  }
  saveCodeFormats();
}
function saveCodeFormats() {
  const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
  const payload = {
    ...stored,
    locationMap,
    codeFormats: Array.isArray(codeFormats) ? codeFormats : [],
    uploadHistory: Array.isArray(uploadHistory) ? uploadHistory : [],
    defaultUploadHistoryId: activeUploadHistoryId || stored.defaultUploadHistoryId || ''
  };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem('smartAssetCodeFormats', JSON.stringify(codeFormats || []));
  if (useApi) { apiSaveDb(); }
}
function formatCustomPattern(rawValue, fieldName, pattern) {
  const value = String(rawValue ?? '').trim();
  const cleanPattern = String(pattern || '').trim();
  if (!cleanPattern) return value.replace(/[^0-9]/g, '');

  if (/(yyyy|yy|MM|M|dd|d)/i.test(cleanPattern)) {
    const dateValue = value.match(/^\d{4}-\d{2}-\d{2}$/)
      ? new Date(value + 'T00:00:00')
      : (value ? new Date(value) : null);
    if (dateValue && !Number.isNaN(dateValue.getTime())) {
      return formatDateToken(dateValue.toISOString().slice(0, 10), cleanPattern);
    }
    if (!value) return cleanPattern.replace(/(yyyy|yy|MM|M|dd|d)/gi, '');
  }

  if (cleanPattern.includes('{value}')) return cleanPattern.replace(/\{value\}/gi, value);
  if (cleanPattern.includes('value')) return cleanPattern.replace(/value/gi, value);
  return cleanPattern;
}

function getCategoryFormatPreset(category = '') {
  const normalized = normalizeCategoryName(category);
  const presets = {
    bangunan: { prefix: 'BGN', pattern: 'yyyyMMdd' },
    bangunansemi: { prefix: 'BSP', pattern: 'yyyyMMdd' },
    kendaraan: { prefix: 'KDR', pattern: 'yyyyMMdd' },
    mesin: { prefix: 'MSN', pattern: 'yyyyMMdd' },
    komputer: { prefix: 'KPT', pattern: 'yyyyMMdd' },
    elektronik: { prefix: 'ELK', pattern: 'yyyyMMdd' },
    alat: { prefix: 'ALT', pattern: 'yyyyMMdd' },
    furniture: { prefix: 'FNR', pattern: 'yyyyMMdd' },
    inventaris: { prefix: 'INV', pattern: 'yyyyMMdd' },
    aset: { prefix: 'AST', pattern: 'yyyyMMdd' }
  };
  return presets[normalized] || { prefix: getCategoryShortcut(category), pattern: 'yyyyMMdd' };
}

function buildAutoCodeToken(asset = {}) {
  const category = String(asset.tipe || asset.kategori || asset.category || 'Aset').trim() || 'Aset';
  const preset = getCategoryFormatPreset(category);
  const location = getLocationShortcut(asset.lokasi || asset.lokasiToken || 'LOK');
  const date = formatDateToken(asset.tglBeli || asset.tglPakai || new Date().toISOString().slice(0, 10), preset.pattern || 'yyyyMMdd');
  const seq = String((Number(asset.harga) || 0)).slice(-3).padStart(3, '0');
  return `${preset.prefix}-${location}-${date}-${seq}`;
}

function selectCodeFormat(a) {
  const list = Array.isArray(codeFormats) ? codeFormats : [];
  const category = normalizeCategoryName(a && (a.tipe || a.kategori || a.category || 'Semua')) || 'semua';
  const cands = list.filter((f) => {
    const fmtCat = normalizeCategoryName(f.category || 'Semua') || 'semua';
    const minValue = Number(f.minValue) || 0;
    const matchCat = fmtCat === 'semua' || fmtCat === category || category.includes(fmtCat) || fmtCat.includes(category);
    return matchCat && ((Number(a && a.harga) || 0) >= minValue);
  });
  cands.sort((x, y) => ((x.category !== 'Semua') - (y.category !== 'Semua')) || ((Number(y.minValue) || 0) - (Number(x.minValue) || 0)));
  return cands.length ? cands[0] : (list[0] || null);
}
function applySlotFormat(slot, a, formatOverride = null) {
  if (!slot) return '';
  if (slot.type === 'text') return String(slot.value || '').trim();
  if (slot.type === 'seq') {
    const format = formatOverride || selectCodeFormat(a);
    const categoryBase = getCategorySequenceBase(format, a);
    const currentCategory = normalizeCategoryName(String(a?.tipe || a?.kategori || a?.category || ''));
    const sameCategory = assets.filter((item) => normalizeCategoryName(String(item.tipe || item.kategori || item.category || '')) === currentCategory);
    const currentIndex = sameCategory.findIndex((item) => item.id === a.id);
    const seqOffset = currentIndex >= 0 ? currentIndex : sameCategory.length;
    const seqNumber = Math.max(1, categoryBase + seqOffset);
    const prefix = String(slot.value || '').trim();
    const value = String(seqNumber).padStart(3, '0');
    return prefix ? `${prefix}${value}` : value;
  }
  if (slot.type === 'column') {
    const field = slot.value || 'kode';
    const raw = resolveAssetFieldValue(a, field);
    const value = String(raw ?? '').trim();
    const fmt = (slot.format || 'full').toLowerCase();
    if (fmt === 'full') return value;
    if (fmt === 'short') {
      if (String(field).toLowerCase().includes('tgl')) return formatDateToken(value, 'yyMMdd');
      if (String(field).toLowerCase().includes('lokasi')) return getLocationShortcut(value);
      if (String(field).toLowerCase().includes('kategori') || String(field).toLowerCase().includes('tipe') || String(field).toLowerCase().includes('category')) return getCategoryShortcut(value);
      return value ? value.slice(0, 3).toUpperCase() : '';
    }
    if (fmt === 'custom') {
      return formatCustomPattern(value, field, slot.custom || 'yyyyMMdd');
    }
  }
  return '';
}
function adjustCode(a) {
  const f = selectCodeFormat(a);
  const slots = f ? (f.slots || []) : [];
  const parts = slots.map((slot) => applySlotFormat(slot, a, f));
  return parts.filter((v) => String(v || '').trim() !== '').join('-');
}

function renderCodeFormatSettings() {
  const root = document.getElementById('codeFormatSettings');
  if (!root) return;
  root.innerHTML = `
    <div class="card glass">
      <div class="card-head">
        <h3>Format Kode Aset</h3>
        <button type="button" class="btn btn-primary btn-sm" data-action="new-format">Tambah Format</button>
      </div>
      <div class="format-list">
        ${(codeFormats || []).map((format) => {
          const preview = (format.slots || []).map((slot) => {
            if (slot.type === 'text') return slot.value || 'Teks';
            if (slot.type === 'seq') return '#';
            return getAssetFieldLabel(slot.value || 'kode');
          }).join(' / ');
          const categoryMapText = Object.entries(normalizeCategoryNumberMap(format.categoryNumberMap || {})).map(([key, value]) => `${key}:${value}`).join(', ');
          return `
            <div class="format-card">
              <div class="format-card-header">
                <div>
                  <div class="format-card-name">${esc(format.name || 'Format Baru')}</div>
                  <div class="format-meta">
                    <span class="format-pill">${esc(format.category || 'Semua')}</span>
                    <span class="format-pill">Min ${esc(Number(format.minValue) || 0)}</span>
                    ${categoryMapText ? `<span class="format-pill">${esc(categoryMapText)}</span>` : ''}
                  </div>
                </div>
                <div class="format-actions compact">
                  <button type="button" class="btn btn-ghost btn-sm" data-action="edit-format" data-format-id="${esc(format.id || '')}">Edit</button>
                  <button type="button" class="btn btn-danger btn-sm" data-action="delete-format" data-format-id="${esc(format.id || '')}">Hapus</button>
                </div>
              </div>
              <div class="format-preview">${esc(preview || 'Belum ada slot')}</div>
            </div>
          `;
        }).join('') || '<div class="format-empty">Belum ada format kode.</div>'}
      </div>
    </div>
  `;
}
function buildFormatEditorSlot(slot = {}, idx = 0) {
  const type = slot.type || 'text';
  const value = slot.value || '';
  const format = slot.format || 'full';
  const custom = slot.custom || '';
  return `
    <div class="format-slot" data-slot-index="${idx}">
      <div class="format-slot-header">
        <span>Slot ${idx + 1}</span>
        <button type="button" class="btn btn-ghost btn-xs" data-action="remove-slot" data-slot-index="${idx}">Hapus</button>
      </div>
      <div class="format-slot-grid">
        <div class="field compact-field">
          <label>Tipe</label>
          <select class="cf-slot-type select" data-slot-index="${idx}">
            <option value="text" ${type === 'text' ? 'selected' : ''}>Teks</option>
            <option value="column" ${type === 'column' ? 'selected' : ''}>Kolom aset</option>
            <option value="seq" ${type === 'seq' ? 'selected' : ''}>Nomor urut</option>
          </select>
        </div>
        <div class="field compact-field ${type === 'column' ? '' : 'hidden'}">
          <label>Format</label>
          <select class="cf-slot-format select" data-slot-index="${idx}">
            <option value="full" ${format === 'full' ? 'selected' : ''}>Penuh</option>
            <option value="short" ${format === 'short' ? 'selected' : ''}>Singkat</option>
            <option value="custom" ${format === 'custom' ? 'selected' : ''}>Kustom</option>
          </select>
        </div>
        <div class="field full ${type === 'text' ? '' : 'hidden'}">
          <label>Nilai teks</label>
          <input type="text" class="cf-slot-text" data-slot-index="${idx}" value="${esc(value)}" placeholder="Contoh: AST" />
        </div>
        <div class="field full ${type === 'column' ? '' : 'hidden'}">
          <label>Pilih kolom</label>
          <select class="cf-slot-col select" data-slot-index="${idx}">
            ${ASSET_FIELD_OPTIONS.map((opt) => `<option value="${opt.value}" ${String(value) === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
          </select>
        </div>
        <div class="field full ${type === 'column' && format === 'custom' ? '' : 'hidden'}">
          <label>Custom format</label>
          <input type="text" class="cf-slot-custom" data-slot-index="${idx}" value="${esc(custom)}" placeholder="contoh: yyyyMMdd, ddMMyyyy, {value}" />
        </div>
        <div class="field full ${type === 'seq' ? '' : 'hidden'}">
          <label>Prefix urut</label>
          <input type="text" class="cf-slot-text" data-slot-index="${idx}" value="${esc(value)}" placeholder="Opsional" />
        </div>
      </div>
    </div>
  `;
}
function renderCodeFormatNumberMapEditor(initialValue = '') {
  const root = document.getElementById('cfCategoryNumberMapWrap');
  if (!root) return;
  root.innerHTML = `
    <div class="field full">
      <label>Nomor awal per kategori</label>
      <textarea id="cfCategoryNumberMap" rows="3" placeholder="kendaraan=1\nperalatan kerja=2\n">${esc(initialValue || '')}</textarea>
    </div>
  `;
}
function renderCodeFormatSlotEditor(slots = []) {
  const root = document.getElementById('cfSlots');
  if (!root) return;
  const slotList = slots.length ? slots : [{ type: 'text', value: 'AST', format: 'full', custom: '' }];
  root.innerHTML = slotList.map((slot, idx) => buildFormatEditorSlot(slot, idx)).join('');
  root.insertAdjacentHTML('beforeend', '<div class="format-slot-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="add-slot">Tambah Slot</button></div>');
  root.querySelectorAll('.cf-slot-type').forEach((select) => {
    select.addEventListener('change', (e) => {
      const slotEl = e.target.closest('.format-slot');
      const type = e.target.value;
      const textInput = slotEl.querySelector('.cf-slot-text');
      const colInput = slotEl.querySelector('.cf-slot-col');
      const colFormat = slotEl.querySelector('.cf-slot-format');
      if (type === 'column') {
        if (!colInput.value) colInput.value = 'tipe';
        if (!colFormat.value) colFormat.value = 'full';
      }
      if (type === 'text' && !textInput.value) textInput.value = 'AST';
      if (type === 'seq' && !textInput.value) textInput.value = '';
      syncCodeFormatSlotVisibility(slotEl);
      updateCodeFormatPreview();
    });
  });
  root.querySelectorAll('.cf-slot-format').forEach((select) => {
    select.addEventListener('change', (e) => {
      const slotEl = e.target.closest('.format-slot');
      syncCodeFormatSlotVisibility(slotEl);
      updateCodeFormatPreview();
    });
  });
  root.querySelectorAll('.cf-slot-text, .cf-slot-col, .cf-slot-custom').forEach((input) => {
    input.addEventListener('input', () => {
      const slotEl = input.closest('.format-slot');
      syncCodeFormatSlotVisibility(slotEl);
      updateCodeFormatPreview();
    });
  });
  updateCodeFormatPreview();
}
function updateCodeFormatPreview() {
  const root = document.getElementById('cfSlots');
  const previewEl = document.getElementById('cfPreview');
  if (!root || !previewEl) return;
  const rows = [...root.querySelectorAll('.format-slot')];
  const slots = rows.map((row) => ({
    type: row.querySelector('.cf-slot-type')?.value || 'text',
    value: row.querySelector('.cf-slot-text')?.value || row.querySelector('.cf-slot-col')?.value || '',
    format: row.querySelector('.cf-slot-format')?.value || 'full',
    custom: row.querySelector('.cf-slot-custom')?.value || ''
  }));
  const sample = assets[0] || { kode: 'AST-001', nama: 'Sample', tipe: 'Kategori', kategori: 'Kategori', category: 'Kategori', lokasi: 'LOC', tglBeli: '2024-01-15', harga: 1000000 };
  const parts = slots.map((slot) => {
    if (slot.type === 'text') return String(slot.value || '').trim();
    if (slot.type === 'seq') return '001';
    if (slot.type === 'column') {
      const field = slot.value || 'kode';
      const raw = resolveAssetFieldValue(sample, field);
      const value = String(raw ?? '').trim();
      const fmt = (slot.format || 'full').toLowerCase();
      if (fmt === 'full') return value;
      if (fmt === 'short') {
        if (String(field).toLowerCase().includes('tgl')) return value.replace(/[^0-9]/g, '').slice(-4);
        return value ? value.slice(0, 3).toUpperCase() : '';
      }
      if (fmt === 'custom') return formatCustomPattern(value, field, slot.custom || '');
    }
    return '';
  }).filter((v) => String(v || '').trim() !== '');
  previewEl.textContent = 'Pratinjau: ' + (parts.join('-') || '-');
}
function syncCodeFormatSlotVisibility(slotEl) {
  if (!slotEl) return;
  const type = slotEl.querySelector('.cf-slot-type')?.value || 'text';
  const format = slotEl.querySelector('.cf-slot-format')?.value || 'full';
  const textBox = slotEl.querySelector('.cf-slot-text');
  const colBox = slotEl.querySelector('.cf-slot-col');
  const customBox = slotEl.querySelector('.cf-slot-custom');
  const rowText = slotEl.querySelectorAll('.field')[2];
  const rowCol = slotEl.querySelectorAll('.field')[3];
  const rowCustom = slotEl.querySelectorAll('.field')[4];
  if (rowText) rowText.classList.toggle('hidden', type !== 'text' && type !== 'seq');
  if (rowCol) rowCol.classList.toggle('hidden', type !== 'column');
  if (rowCustom) rowCustom.classList.toggle('hidden', type !== 'column' || format !== 'custom');
  if (textBox && type === 'seq' && !textBox.value) textBox.value = '';
  if (customBox && type === 'column' && format === 'custom' && !customBox.value) customBox.value = 'yyyyMMdd';
  if (colBox && type === 'column' && !colBox.value) colBox.value = 'tipe';
}
function openCodeFormatModal(formatId = '') {
  const modal = document.getElementById('codeFormatModal');
  if (!modal) return;
  const format = (codeFormats || []).find((item) => item.id === formatId) || {
    id: '',
    name: '',
    category: 'Semua',
    minValue: 0,
    categoryNumberMap: {},
    slots: [{ type: 'text', value: 'AST', format: 'full', custom: '' }]
  };
  const categoryMapText = Object.entries(normalizeCategoryNumberMap(format.categoryNumberMap || {}))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  document.getElementById('cfEditId').value = format.id || '';
  document.getElementById('cfName').value = format.name || '';
  document.getElementById('cfCategory').value = format.category || 'Semua';
  document.getElementById('cfMinValue').value = Number(format.minValue) || 0;
  renderCodeFormatNumberMapEditor(categoryMapText);
  renderCodeFormatSlotEditor(format.slots || [{ type: 'text', value: 'AST', format: 'full', custom: '' }]);
  modal.classList.add('open');
}

function closeModals() {
  document.querySelectorAll('.modal').forEach((modal) => modal.classList.remove('open'));
}
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
let smartAssetLoadingTimeout = null;

function showLoading(title = 'Memproses...', detail = 'Menyiapkan data aset...') {
  const overlay = document.getElementById('loadingOverlay');
  const titleEl = document.getElementById('smartAssetLoadingTitle');
  const detailEl = document.getElementById('smartAssetLoadingDetail');

  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;

  if (overlay) {
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
  }

  if (smartAssetLoadingTimeout) window.clearTimeout(smartAssetLoadingTimeout);
  smartAssetLoadingTimeout = window.setTimeout(() => {
    if (overlay && overlay.classList.contains('is-visible')) {
      console.warn('Smart Asset loading timed out; forcing cleanup.');
      hideLoading();
    }
  }, 12000);
}
function hideLoading() {
  if (smartAssetLoadingTimeout) {
    window.clearTimeout(smartAssetLoadingTimeout);
    smartAssetLoadingTimeout = null;
  }
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.remove('is-visible');
    overlay.setAttribute('aria-hidden', 'true');
  }
}
function renderStartupSequence() {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try {
      if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    } catch (error) {
      console.warn('Gagal refresh ikon lucide:', error);
    }
    hideLoading();
  };

  const safeExec = (label, fn) => {
    try {
      fn();
    } catch (error) {
      console.error('Startup render failed at ' + label + ':', error);
    }
  };

  const stage1 = () => {
    safeExec('stage1', () => {
      const lastView = localStorage.getItem('smartAssetLastView') || 'dashboard';
      if (document.getElementById('view-' + lastView)) setView(lastView); else setView('dashboard');
      renderCodeFormatSettings();
      renderLocationSettings();
      renderUploadHistory();
    });
  };

  const stage2 = () => {
    safeExec('stage2', () => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          renderDashboard();
          renderAssetTable();
        });
        return;
      }
      renderDashboard();
      renderAssetTable();
    });
  };

  const stage3 = () => {
    safeExec('stage3', () => {
      renderAuditView();
      renderReport();
      renderMonthlyView();
    });
    finish();
  };

  stage1();
  window.setTimeout(stage2, 16);
  window.setTimeout(stage3, 80);
  window.setTimeout(finish, 1800);
}
function toast(message, type = 'info') {
  if (type === 'success' && window.smartAssetSyncPending) {
    message = `${message}. Menunggu sinkronisasi cloud.`;
    type = 'warning';
  }
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2200);
}
function confirmAction(title, msg, callback) {
  const modal = document.getElementById('confirmModal');
  if (!modal) return;
  const titleEl = document.getElementById('confirmTitle');
  const msgEl = document.getElementById('confirmMsg');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = msg;
  confirmCallback = callback;
  modal.classList.add('open');
}
function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  if (window.SmartBaraTheme?.isNormal()) window.SmartBaraTheme.setMode(next);
  else localStorage.setItem('theme', next);
  const icon = document.querySelector('#themeToggle i');
  if (icon) icon.setAttribute('data-lucide', next === 'dark' ? 'moon' : 'sun');
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}
function setView(viewName) {
  const validViews = ['dashboard', 'assets', 'monthly', 'audit', 'add', 'report', 'upload', 'settings'];
  const nextView = validViews.includes(viewName) ? viewName : 'dashboard';
  document.querySelectorAll('.view').forEach((panel) => panel.classList.toggle('active', panel.id === 'view-' + nextView));
  document.querySelectorAll('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === nextView));
  try { localStorage.setItem('smartAssetLastView', nextView); } catch (e) {}
  if (nextView === 'settings') {
    renderCodeFormatSettings();
    renderLocationSettings();
  }
  const titleMap = {
    dashboard: ['Dashboard', 'Ringkasan monitoring aset Anda'],
    assets: ['Daftar Aset', 'Kelola data aset secara detail'],
    monthly: ['Per Bulan', 'Analisis aset berdasarkan periode'],
    audit: ['Audit Asset', 'Catatan dan evaluasi aset'],
    add: ['Tambah Aset', 'Input aset baru'],
    report: ['Rekap & Export', 'Ekspor, ringkasan, dan laporan'],
    upload: ['Upload Data', 'Import data ke aplikasi'],
    settings: ['Pengaturan', 'Atur tema, lokasi, dan format kode']
  };
  const view = titleMap[nextView] || titleMap.dashboard;
  const titleEl = document.getElementById('viewTitle');
  const subtitleEl = document.getElementById('viewSubtitle');
  if (titleEl) titleEl.textContent = view[0];
  if (subtitleEl) subtitleEl.textContent = view[1];

  if (nextView === 'assets') renderAssetTable();
  if (nextView === 'audit') renderAuditView();
  if (nextView === 'report') renderReport();
  if (nextView === 'monthly') renderMonthlyView();
  if (nextView === 'dashboard') renderDashboard();
}

function renderAssetTable() {
  const table = document.getElementById('assetTable');
  const tbody = table?.querySelector('tbody');
  const pagination = document.getElementById('pagination');
  if (!table || !tbody) return;

  const search = ($('#assetSearch')?.value || '').trim().toLowerCase();
  const category = $('#assetFilterCat')?.value || '';
  const location = $('#assetFilterLoc')?.value || '';
  const depFilter = $('#depFilter')?.value || '';
  const priceMin = Number($('#priceMin')?.value || 0);
  const priceMax = Number($('#priceMax')?.value || Infinity);
  const pageSize = Number($('#pageSize')?.value || 25);

  const filtered = assets.filter((asset) => {
    const name = String(asset.nama || '').toLowerCase();
    const code = String(asset.kode || '').toLowerCase();
    const aCategory = String(asset.tipe || '').toLowerCase();
    const loc = String(asset.lokasi || '').toLowerCase();
    const status = getAssetStatusText(asset).toLowerCase();
    const nullableSearch = !search || code.includes(search) || name.includes(search) || String(asset.noAkun || '').toLowerCase().includes(search);
    const matchesCategory = !category || aCategory === category || category === 'Semua' || category === 'all';
    const matchesLocation = !location || loc.includes(location.toLowerCase());
    const matchesDep = !depFilter || (depFilter === 'belum' ? status.includes('belum') : status.includes('habis'));
    const matchesPrice = (Number(asset.harga) || 0) >= (Number.isFinite(priceMin) ? priceMin : 0) && (Number(asset.harga) || 0) <= (Number.isFinite(priceMax) ? priceMax : Infinity);
    return nullableSearch && matchesCategory && matchesLocation && matchesDep && matchesPrice;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aValue = (a[sortKey] ?? a.depreciation?.bookValue ?? a.harga ?? 0);
    const bValue = (b[sortKey] ?? b.depreciation?.bookValue ?? b.harga ?? 0);
    const valA = typeof aValue === 'string' ? aValue.toLowerCase() : aValue;
    const valB = typeof bValue === 'string' ? bValue.toLowerCase() : bValue;
    if (typeof valA === 'number' && typeof valB === 'number') return sortDir === 'asc' ? valA - valB : valB - valA;
    if (typeof valA === 'string' && typeof valB === 'string') return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    return sortDir === 'asc' ? (Number(valA) || 0) - (Number(valB) || 0) : (Number(valB) || 0) - (Number(valA) || 0);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / (pageSize || 1)));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  tbody.innerHTML = pageItems.map((asset) => {
    const latestAudit = getLatestAudit(asset.id);
    const auditStatus = latestAudit ? (latestAudit.kondisi || 'Belum') : 'Belum';
    const status = getAssetStatusText(asset);
    return `
      <tr data-asset-id="${asset.id}">
        <td><button class="link-btn" data-action="view-asset" data-asset-id="${asset.id}">${esc(asset.kode || '-')}</button></td>
        <td>${esc(asset.kode || '-')}</td>
        <td class="asset-name" title="${esc(asset.nama || '-')}">${esc(asset.nama || '-')}</td>
        <td>${esc(asset.tipe || '-')}</td>
        <td>${esc(asset.lokasi || '-')}</td>
        <td>${esc(asset.noAkun || '-')}</td>
        <td>${rupiah(Number(asset.harga) || 0)}</td>
        <td>${formatDateShort(asset.tglPakai)}</td>
        <td>${formatDateShort(asset.tglBeli)}</td>
        <td>${esc(asset.umur || '-')}</td>
        <td>${esc(String(asset.depreciation?.totalMonthsUseful || 0))}</td>
        <td>${esc(asset.rasio ?? '-')}</td>
        <td>${esc(asset.dsScore ?? '-')}</td>
        <td>${rupiah(Number(asset.depreciation?.monthly || 0))}</td>
        <td>${rupiah(Number(asset.depreciation?.accumulated || 0))}</td>
        <td>${rupiah(Number(asset.depreciation?.currentPeriod || 0))}</td>
        <td>${rupiah(Number(asset.depreciation?.bookValue || 0))}</td>
        <td>${rupiah(Number(asset.depreciation?.monthsRemaining && asset.depreciation.totalMonthsUseful ? asset.depreciation.totalMonthsUseful - asset.depreciation.totalMonths : 0) || 0)}</td>
        <td><span class="badge ${status.includes('Habis') ? 'warn' : 'ok'}">${status}</span></td>
        <td><span class="badge ${auditStatus === 'Belum' ? 'neutral' : 'info'}">${auditStatus}</span></td>
        <td>
          <div class="action-btns">
            <button class="mini-btn" title="Detail" data-action="view-asset" data-asset-id="${asset.id}"><i data-lucide="eye"></i></button>
            <button class="mini-btn" title="Audit" data-action="audit-asset" data-asset-id="${asset.id}"><i data-lucide="clipboard-check"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const pageButtons = [];
  for (let i = 1; i <= totalPages; i++) {
    pageButtons.push(`<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`);
  }
  pagination.innerHTML = `
    <div class="info">Menampilkan ${sorted.length ? start + 1 : 0}-${Math.min(start + pageItems.length, sorted.length)} dari ${sorted.length} aset</div>
    <div class="pages">${pageButtons.join('')}</div>
  `;

  pagination.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentPage = Number(btn.dataset.page || 1);
      renderAssetTable();
    });
  });

  tbody.querySelectorAll('[data-action="view-asset"]').forEach((btn) => {
    btn.addEventListener('click', () => openAssetDetail(btn.dataset.assetId));
  });
  tbody.querySelectorAll('[data-action="audit-asset"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.assetId;
      const asset = assets.find((item) => item.id === id);
      if (!asset) return;
      $('#auditAssetId').value = asset.id;
      $('#auditKode').value = asset.kode || '';
      $('#auditNama').value = asset.nama || '';
      $('#auditTanggal').value = new Date().toISOString().slice(0, 10);
      $('#auditKondisi').value = '';
      $('#auditNewLocField').style.display = 'none';
      $('#auditCatatan').value = '';
      $('#auditFotoPreview').innerHTML = '';
      openModal('auditModal');
    });
  });

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function renderAuditView() {
  const table = document.getElementById('auditAssetTable');
  const tbody = table?.querySelector('tbody');
  if (!table || !tbody) return;

  const query = ($('#auditSearch')?.value || '').trim().toLowerCase();
  const cat = ($('#auditFilterCat')?.value || '').trim();
  const loc = ($('#auditFilterLoc')?.value || '').trim();
  const cond = ($('#auditFilterCond')?.value || '').trim();

  const items = assets.map((asset) => {
    const latest = getLatestAudit(asset.id);
    const status = latest ? (latest.kondisi || 'Belum') : 'Belum';
    return { ...asset, latestAudit: latest, statusAudit: status };
  }).filter((asset) => {
    const q = !query || (String(asset.kode || '').toLowerCase().includes(query) || String(asset.nama || '').toLowerCase().includes(query));
    const c = !cat || String(asset.tipe || '').toLowerCase() === cat.toLowerCase();
    const l = !loc || String(asset.lokasi || '').toLowerCase().includes(loc.toLowerCase());
    const k = !cond || (cond === 'Belum' ? asset.statusAudit === 'Belum' : asset.statusAudit === cond || (cond === 'Pindah' && asset.statusAudit === 'Pindah'));
    return q && c && l && k;
  });

  const sorted = [...items].sort((a, b) => {
    const av = a[auditSortKey] ?? (a.latestAudit ? a.latestAudit[auditSortKey] : '');
    const bv = b[auditSortKey] ?? (b.latestAudit ? b.latestAudit[auditSortKey] : '');
    const aVal = typeof av === 'string' ? av.toLowerCase() : (av ?? '');
    const bVal = typeof bv === 'string' ? bv.toLowerCase() : (bv ?? '');
    if (typeof aVal === 'number' || typeof bVal === 'number') {
      return auditSortDir === 'asc' ? (Number(aVal) || 0) - (Number(bVal) || 0) : (Number(bVal) || 0) - (Number(aVal) || 0);
    }
    return auditSortDir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
  });

  tbody.innerHTML = sorted.map((asset) => {
    const latest = asset.latestAudit;
    const status = asset.statusAudit || 'Belum';
    return `
      <tr data-asset-id="${esc(asset.id)}">
        <td>${esc(asset.kode || '-')}</td>
        <td class="asset-name" title="${esc(asset.nama || '-')}">${esc(asset.nama || '-')}</td>
        <td>${esc(asset.tipe || '-')}</td>
        <td>${esc(asset.lokasi || '-')}</td>
        <td><span class="badge ${status === 'Belum' ? 'neutral' : 'info'}">${status}</span></td>
        <td>${esc(latest ? latest.kondisi || '-' : '-')}</td>
        <td>${formatDateShort(latest ? latest.tanggal : '')}</td>
        <td>
          <div class="action-btns">
            <button class="mini-btn" data-action="view-asset" data-asset-id="${asset.id}" title="Lihat detail"><i data-lucide="eye"></i></button>
            <button class="btn btn-ghost btn-xs" data-action="audit-asset" data-asset-id="${asset.id}" title="Audit aset">Audit</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action="view-asset"]').forEach((btn) => btn.addEventListener('click', () => openAssetDetail(btn.dataset.assetId)));
  tbody.querySelectorAll('[data-action="audit-asset"]').forEach((btn) => btn.addEventListener('click', () => {
    const asset = assets.find((item) => item.id === btn.dataset.assetId);
    if (!asset) return;
    $('#auditAssetId').value = asset.id;
    $('#auditKode').value = asset.kode || '';
    $('#auditNama').value = asset.nama || '';
    $('#auditTanggal').value = new Date().toISOString().slice(0, 10);
    $('#auditKondisi').value = '';
    $('#auditNewLocField').style.display = 'none';
    $('#auditCatatan').value = '';
    $('#auditFotoPreview').innerHTML = '';
    openModal('auditModal');
  }));

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function openAssetDetail(assetId) {
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) return;
  const latestAudit = getLatestAudit(assetId);
  const detailBody = document.getElementById('detailBody');
  if (!detailBody) return;
  detailBody.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item full"><div class="label">Kode</div><div class="value mono">${esc(asset.kode || '-')}</div></div>
      <div class="detail-item"><div class="label">Nama Aset</div><div class="value">${esc(asset.nama || '-')}</div></div>
      <div class="detail-item"><div class="label">Kategori</div><div class="value">${esc(asset.tipe || '-')}</div></div>
      <div class="detail-item"><div class="label">Lokasi</div><div class="value">${esc(asset.lokasi || '-')}</div></div>
      <div class="detail-item"><div class="label">No Akun</div><div class="value mono">${esc(asset.noAkun || '-')}</div></div>
      <div class="detail-item"><div class="label">Harga</div><div class="value mono">${rupiah(Number(asset.harga) || 0)}</div></div>
      <div class="detail-item"><div class="label">Tgl Beli</div><div class="value">${formatDateShort(asset.tglBeli)}</div></div>
      <div class="detail-item"><div class="label">Tgl Pakai</div><div class="value">${formatDateShort(asset.tglPakai)}</div></div>
      <div class="detail-item"><div class="label">Umur</div><div class="value">${esc(asset.umur || '-')}</div></div>
      <div class="detail-item"><div class="label">Rasio</div><div class="value">${esc(asset.rasio ?? '-')}</div></div>
      <div class="detail-item"><div class="label">DS Score</div><div class="value">${esc(asset.dsScore ?? '-')}</div></div>
      <div class="detail-item"><div class="label">Status</div><div class="value">${getAssetStatusText(asset)}</div></div>
      <div class="detail-item"><div class="label">Status Audit</div><div class="value">${latestAudit ? latestAudit.kondisi || 'Belum' : 'Belum'}</div></div>
      <div class="detail-item"><div class="label">Audit Terakhir</div><div class="value">${formatDateShort(latestAudit ? latestAudit.tanggal : '')}</div></div>
      <div class="detail-item full"><div class="label">Catatan Audit</div><div class="value">${esc(latestAudit ? (latestAudit.catatan || '-') : '-')}</div></div>
    </div>
    <div class="form-actions" style="margin-top:18px;justify-content:flex-end">
      <button type="button" class="btn btn-ghost" data-close="detailModal">Tutup</button>
      <button type="button" class="btn btn-primary" data-action="open-drill" data-asset-id="${asset.id}">Lihat Detail Lebih Lengkap</button>
    </div>
  `;

  const btn = document.querySelector('[data-action="open-drill"]');
  btn?.addEventListener('click', () => openAssetDrill(assetId));
  const modal = document.getElementById('detailModal');
  if (modal) modal.classList.add('open');
}

function openTableRowDetail(table, row) {
  const headers = [...(table.tHead?.rows[0]?.cells || [])];
  const cells = [...row.cells];
  if (cells.some((cell) => cell.hasAttribute('colspan'))) return;
  const details = cells.map((cell, index) => ({
    label: headers[index]?.textContent.trim() || `Kolom ${index + 1}`,
    value: cell.innerText.trim()
  })).filter((item) => item.value);
  if (!details.length) return;

  const title = [...document.querySelectorAll('.card-head h3')]
    .find((heading) => heading.closest('.card')?.contains(table))?.textContent.trim() || 'Detail Baris';
  const titleEl = document.getElementById('drillTitle');
  const bodyEl = document.getElementById('drillBody');
  if (!titleEl || !bodyEl) return;

  titleEl.textContent = `Detail ${title}`;
  bodyEl.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  details.forEach(({ label, value }) => {
    const item = document.createElement('div');
    item.className = 'detail-item';
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'value';
    valueEl.textContent = value;
    item.append(labelEl, valueEl);
    grid.append(item);
  });
  bodyEl.append(grid);
  document.getElementById('drillModal')?.classList.add('open');
}

function openAssetDrill(assetId) {
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) return;
  const history = audits.filter((item) => item.assetId === assetId).sort((a, b) => new Date(b.tanggal || 0) - new Date(a.tanggal || 0));
  const drillBody = document.getElementById('drillBody');
  const drillTitle = document.getElementById('drillTitle');
  if (!drillBody || !drillTitle) return;
  drillTitle.textContent = asset.nama || asset.kode || 'Detail Aset';
  drillBody.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><div class="label">ID</div><div class="value mono">${esc(asset.id || '-')}</div></div>
      <div class="detail-item"><div class="label">Kode</div><div class="value mono">${esc(asset.kode || '-')}</div></div>
      <div class="detail-item"><div class="label">Nama</div><div class="value">${esc(asset.nama || '-')}</div></div>
      <div class="detail-item"><div class="label">Kategori</div><div class="value">${esc(asset.tipe || '-')}</div></div>
      <div class="detail-item"><div class="label">Lokasi</div><div class="value">${esc(asset.lokasi || '-')}</div></div>
      <div class="detail-item"><div class="label">Token Lokasi</div><div class="value mono">${esc(asset.lokasiToken || '-')}</div></div>
      <div class="detail-item"><div class="label">No Akun</div><div class="value mono">${esc(asset.noAkun || '-')}</div></div>
      <div class="detail-item"><div class="label">Harga Perolehan</div><div class="value mono">${rupiah(Number(asset.harga) || 0)}</div></div>
      <div class="detail-item"><div class="label">Tgl Pembelian</div><div class="value">${formatDateShort(asset.tglBeli)}</div></div>
      <div class="detail-item"><div class="label">Tgl Pakai</div><div class="value">${formatDateShort(asset.tglPakai)}</div></div>
      <div class="detail-item"><div class="label">Umur</div><div class="value">${esc(asset.umur || '-')}</div></div>
      <div class="detail-item"><div class="label">Metode</div><div class="value">${esc(asset.metode || '-')}</div></div>
      <div class="detail-item"><div class="label">Rasio</div><div class="value">${esc(asset.rasio ?? '-')}</div></div>
      <div class="detail-item"><div class="label">DS Score</div><div class="value">${esc(asset.dsScore ?? '-')}</div></div>
      <div class="detail-item"><div class="label">Penyusutan Bulanan</div><div class="value mono">${rupiah(Number(asset.depreciation?.monthly || 0))}</div></div>
      <div class="detail-item"><div class="label">Akumulasi</div><div class="value mono">${rupiah(Number(asset.depreciation?.accumulated || 0))}</div></div>
      <div class="detail-item"><div class="label">Nilai Buku</div><div class="value mono">${rupiah(Number(asset.depreciation?.bookValue || 0))}</div></div>
      <div class="detail-item full"><div class="label">Riwayat Audit</div>
        <div class="value">
          ${history.length ? history.map((item) => `
            <div class="detail-row" style="margin-top:8px">
              <div class="detail-key">${formatDateShort(item.tanggal)}</div>
              <div class="detail-val">${esc(item.kondisi || '-')}${item.newLocation ? ' • ' + esc(item.newLocation) : ''}</div>
            </div>
          `).join('') : '<div class="detail-row"><div class="detail-key">Belum ada</div><div class="detail-val">-</div></div>'}
        </div>
      </div>
    </div>
  `;
  closeModals();
  document.getElementById('drillModal')?.classList.add('open');
}

function renderDashboardCharts() {
  if (typeof Chart === 'undefined') return;

  const na = { ...charts };
  Object.keys(na).forEach((key) => {
    if (na[key] && typeof na[key].destroy === 'function') na[key].destroy();
  });
  charts = {};

  const chartConfig = (canvasId, config) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    charts[canvasId] = new Chart(canvas, config);
  };

  const categoryMap = {};
  const valueMap = {};
  const locMap = {};
  const yearMap = {};

  assets.forEach((asset) => {
    const category = String(asset.tipe || 'Lainnya').trim() || 'Lainnya';
    categoryMap[category] = (categoryMap[category] || 0) + 1;
    valueMap[category] = (valueMap[category] || 0) + (Number(asset.harga) || 0);

    const loc = String(asset.lokasi || 'Belum diatur').trim() || 'Belum diatur';
    locMap[loc] = (locMap[loc] || 0) + (Number(asset.harga) || 0);

    const rawDate = asset.tglBeli || asset.tglPakai;
    if (!rawDate) return;
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return;
    const year = String(date.getFullYear());
    yearMap[year] = (yearMap[year] || 0) + 1;
  });

  const pieLabels = Object.keys(categoryMap);
  const pieValues = Object.values(categoryMap);
  const barLabels = Object.keys(valueMap);
  const barValues = Object.values(valueMap);
  const locLabels = Object.keys(locMap);
  const locValues = Object.values(locMap);
  const lineLabels = Object.keys(yearMap).sort((a, b) => Number(a) - Number(b));
  const lineValues = lineLabels.map((year) => yearMap[year]);

  const palette = ['#6366f1', '#22d3ee', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#f97316', '#ec4899', '#38bdf8', '#a3e635'];

  chartConfig('chartPie', {
    type: 'doughnut',
    data: {
      labels: pieLabels,
      datasets: [{
        data: pieValues,
        backgroundColor: pieLabels.map((_, idx) => palette[idx % palette.length]),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        const index = elements[0]?.index;
        if (index === undefined) return;
        const category = pieLabels[index];
        openDrill(`Kategori: ${category}`, assets.filter((asset) => String(asset.tipe || 'Lainnya').trim() === category));
      },
      plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', usePointStyle: true } } }
    }
  });

  chartConfig('chartBar', {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [{
        label: 'Nilai per Kategori',
        data: barValues,
        backgroundColor: barLabels.map((_, idx) => palette[idx % palette.length]),
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { display: false } },
        y: { ticks: { color: '#cbd5e1', callback: (value) => 'Rp ' + Number(value).toLocaleString('id-ID') }, grid: { color: 'rgba(148, 163, 184, 0.12)' } }
      },
      onClick: (_event, elements) => {
        const index = elements[0]?.index;
        if (index === undefined) return;
        const category = barLabels[index];
        openDrill(`Nilai Kategori: ${category}`, assets.filter((asset) => String(asset.tipe || 'Lainnya').trim() === category));
      },
      plugins: { legend: { display: false } }
    }
  });

  chartConfig('chartLoc', {
    type: 'bar',
    data: {
      labels: locLabels,
      datasets: [{
        label: 'Nilai per Lokasi',
        data: locValues,
        backgroundColor: locLabels.map((_, idx) => palette[(idx + 2) % palette.length]),
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { display: false } },
        y: { ticks: { color: '#cbd5e1', callback: (value) => 'Rp ' + Number(value).toLocaleString('id-ID') }, grid: { color: 'rgba(148, 163, 184, 0.12)' } }
      },
      onClick: (_event, elements) => {
        const index = elements[0]?.index;
        if (index === undefined) return;
        const location = locLabels[index];
        openDrill(`Lokasi: ${location}`, assets.filter((asset) => String(asset.lokasi || 'Belum diatur').trim() === location));
      },
      plugins: { legend: { display: false } }
    }
  });

  chartConfig('chartLine', {
    type: 'line',
    data: {
      labels: lineLabels,
      datasets: [{
        label: 'Pembelian per Tahun',
        data: lineValues,
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34, 211, 238, 0.18)',
        fill: true,
        tension: 0.28,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { display: false } },
        y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(148, 163, 184, 0.12)' } }
      },
      onClick: (_event, elements) => {
        const index = elements[0]?.index;
        if (index === undefined) return;
        const year = lineLabels[index];
        openDrill(`Pembelian Tahun ${year}`, assets.filter((asset) => {
          const date = new Date(asset.tglBeli || asset.tglPakai);
          return !Number.isNaN(date.getTime()) && String(date.getFullYear()) === year;
        }));
      },
      plugins: { legend: { display: false } }
    }
  });
}

function renderDashboard() {
  const recentTable = document.getElementById('recentTable');
  if (recentTable) {
    const tbody = recentTable.querySelector('tbody');
    const recent = [...assets].sort((a, b) => (b.id || '').localeCompare(a.id || '')).slice(0, 10);
    tbody.innerHTML = recent.map((asset) => `
      <tr data-asset-id="${esc(asset.id)}">
        <td>${esc(asset.kode || '-')}</td>
        <td class="asset-name" title="${esc(asset.nama || '-')}">${esc(asset.nama || '-')}</td>
        <td>${esc(asset.tipe || '-')}</td>
        <td>${rupiah(Number(asset.harga) || 0)}</td>
        <td>${formatDateShort(asset.tglBeli)}</td>
        <td><button class="mini-btn" data-action="view-asset" data-asset-id="${asset.id}"><i data-lucide="eye"></i></button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="view-asset"]').forEach((btn) => {
      btn.addEventListener('click', () => openAssetDetail(btn.dataset.assetId));
    });
  }

  const total = assets.length;
  const totalNilai = assets.reduce((sum, asset) => sum + (Number(asset.harga) || 0), 0);
  const uniqueCat = new Set(assets.map((asset) => String(asset.tipe || '').trim()).filter(Boolean)).size;
  const average = total ? totalNilai / total : 0;
  const allStatValues = document.querySelectorAll('.stat-card .stat-value');
  allStatValues.forEach((el, idx) => {
    if (idx === 0) el.textContent = total;
    if (idx === 1) el.textContent = rupiah(totalNilai);
    if (idx === 2) el.textContent = uniqueCat;
    if (idx === 3) el.textContent = rupiah(average);
  });

  renderDashboardCharts();

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function renderMonthlyView() {
  const table = document.getElementById('monthlyTable');
  const tbody = table?.querySelector('tbody');
  const summary = document.getElementById('monthlySummary');
  if (!table || !tbody || !summary) return;

  const basis = document.getElementById('monthlyBasis')?.value || 'tglBeli';
  const cat = document.getElementById('monthlyCat')?.value || '';
  const loc = document.getElementById('monthlyLoc')?.value || '';

  const aggregate = new Map();
  assets.forEach((asset) => {
    if (cat && String(asset.tipe || '').trim() !== cat) return;
    if (loc && String(asset.lokasi || '').trim() !== loc) return;
    const raw = asset[basis];
    if (!raw) return;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!aggregate.has(key)) aggregate.set(key, { count: 0, total: 0, monthly: 0, acc: 0, book: 0 });
    const entry = aggregate.get(key);
    entry.count += 1;
    entry.total += Number(asset.harga) || 0;
    entry.monthly += Number(asset.depreciation?.monthly || 0);
    entry.acc += Number(asset.depreciation?.accumulated || 0);
    entry.book += Number(asset.depreciation?.bookValue || 0);
  });

  const rows = [...aggregate.entries()].sort(([a], [b]) => a.localeCompare(b));
  summary.innerHTML = rows.length ? `
    <div class="summary-box"><div class="label">Periode</div><div class="val">${rows.length}</div></div>
    <div class="summary-box"><div class="label">Total Nilai</div><div class="val">${rupiah(rows.reduce((sum, [, v]) => sum + v.total, 0))}</div></div>
    <div class="summary-box"><div class="label">Penyusutan</div><div class="val">${rupiah(rows.reduce((sum, [, v]) => sum + v.monthly, 0))}</div></div>
    <div class="summary-box"><div class="label">Nilai Buku</div><div class="val">${rupiah(rows.reduce((sum, [, v]) => sum + v.book, 0))}</div></div>
  ` : '<div class="summary-box"><div class="label">Belum ada data</div><div class="val">-</div></div>';

  tbody.innerHTML = rows.map(([key, value]) => `
    <tr>
      <td>${key}</td>
      <td>${value.count}</td>
      <td>${rupiah(value.total)}</td>
      <td>${rupiah(value.monthly)}</td>
      <td>${rupiah(value.acc)}</td>
      <td>${rupiah(value.book)}</td>
    </tr>
  `).join('');
}

function getFilteredReportAssets() {
  const cat = document.getElementById('repCat')?.value || '';
  const loc = document.getElementById('repLoc')?.value || '';
  const search = (document.getElementById('repSearch')?.value || '').trim().toLowerCase();
  const from = document.getElementById('repFrom')?.value || '';
  const to = document.getElementById('repTo')?.value || '';
  const priceMin = Number(document.getElementById('repPriceMin')?.value || 0);
  const priceMax = Number(document.getElementById('repPriceMax')?.value || Infinity);

  return assets.filter((asset) => {
    const matchCat = !cat || String(asset.tipe || '').trim() === cat;
    const matchLoc = !loc || String(asset.lokasi || '').trim() === loc;
    const matchSearch = !search || String(asset.kode || '').toLowerCase().includes(search) || String(asset.nama || '').toLowerCase().includes(search);
    const matchFrom = !from || (asset.tglBeli || '') >= from;
    const matchTo = !to || (asset.tglBeli || '') <= to;
    const matchPrice = (Number(asset.harga) || 0) >= priceMin && (Number(asset.harga) || 0) <= priceMax;
    return matchCat && matchLoc && matchSearch && matchFrom && matchTo && matchPrice;
  });
}

function renderReport() {
  const table = document.getElementById('reportTable');
  const tbody = table?.querySelector('tbody');
  const summary = document.getElementById('reportSummary');
  if (!table || !tbody || !summary) return;

  const filtered = getFilteredReportAssets();
  const total = filtered.reduce((sum, asset) => sum + (Number(asset.harga) || 0), 0);
  summary.innerHTML = `
    <div class="summary-box"><div class="label">Data</div><div class="val">${filtered.length}</div></div>
    <div class="summary-box"><div class="label">Total Nilai</div><div class="val">${rupiah(total)}</div></div>
    <div class="summary-box"><div class="label">Harga Rata-rata</div><div class="val">${rupiah(filtered.length ? total / filtered.length : 0)}</div></div>
    <div class="summary-box"><div class="label">Status</div><div class="val">${filtered.length ? 'Siap Export' : 'Kosong'}</div></div>
  `;

  tbody.innerHTML = filtered.map((asset) => `
    <tr data-asset-id="${esc(asset.id)}">
      <td>${esc(asset.kode || '-')}</td>
      <td class="asset-name" title="${esc(asset.nama || '-')}">${esc(asset.nama || '-')}</td>
      <td>${esc(asset.tipe || '-')}</td>
      <td>${esc(asset.lokasi || '-')}</td>
      <td>${rupiah(Number(asset.harga) || 0)}</td>
      <td>${esc(asset.dsScore ?? '-')}</td>
      <td>${formatDateShort(asset.tglBeli)}</td>
    </tr>
  `).join('');
  setTableRowsInteractive(document);
}

async function loadAssets() {
  const loaded = await apiLoadDb();
  if (!loaded) throw new Error('Data aset cloud tidak dapat dimuat. Periksa sesi dan koneksi Supabase.');
  ensureLocations();
  return assets;
}

async function saveAssets() {
  const safe = Array.isArray(assets) ? assets.map(normalizeAsset) : [];
  assets = safe;
  const ok = await apiSaveDb();
  if (!ok) throw new Error('Aset belum tersimpan ke cloud. Periksa status koneksi dan coba lagi.');
  ensureLocations();
  return safe;
}

async function ensureSeed() {
  if (Array.isArray(assets) && assets.length) return assets;
  if (Array.isArray(window.SEED_DATA) && window.SEED_DATA.length) {
    assets = window.SEED_DATA.map(normalizeAsset);
    ensureLocations();
    await saveAssets();
  }
  return assets;
}

function ensureLocations() {
  const categoryValues = [...new Set(assets.map((asset) => String(asset.tipe || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const locValues = [...new Set(assets.map((asset) => String(asset.lokasi || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const populate = (id, values, placeholder) => {
    const el = document.getElementById(id);
    if (!el) return;
    const selected = el.value || '';
    el.innerHTML = '<option value="">' + placeholder + '</option>' + values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if (selected && values.includes(selected)) el.value = selected;
  };

  populate('assetFilterCat', categoryValues, 'Semua Kategori');
  populate('monthlyCat', categoryValues, 'Semua');
  populate('repCat', categoryValues, 'Semua');
  populate('auditFilterCat', categoryValues, 'Semua Kategori');
  populate('assetFilterLoc', locValues, 'Semua Lokasi');
  populate('monthlyLoc', locValues, 'Semua');
  populate('repLoc', locValues, 'Semua');
  populate('auditFilterLoc', locValues, 'Semua Lokasi');

  const datalistCat = document.getElementById('catList');
  if (datalistCat) datalistCat.innerHTML = categoryValues.map((value) => `<option value="${esc(value)}"></option>`).join('');
  const datalistLoc = document.getElementById('locList');
  if (datalistLoc) datalistLoc.innerHTML = locValues.map((value) => `<option value="${esc(value)}"></option>`).join('');

  const newLoc = document.getElementById('auditNewLoc');
  if (newLoc) {
    const current = newLoc.value || '';
    const available = locValues.length ? locValues : [''];
    newLoc.innerHTML = '<option value="">Pilih lokasi</option>' + available.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if (current && available.includes(current)) newLoc.value = current;
  }
}

function renderLocationSettings() {
  const mapBody = document.querySelector('#locMapTable tbody');
  const unknownBody = document.querySelector('#locUnknownTable tbody');
  const unknownCount = document.getElementById('locUnknownCount');
  if (mapBody) {
    const entries = Object.entries(locationMap || {}).sort(([a], [b]) => a.localeCompare(b));
    mapBody.innerHTML = entries.length ? entries.map(([token, name]) => `
      <tr>
        <td>${esc(token)}</td>
        <td>${esc(name)}</td>
        <td>${esc(assets.filter((asset) => String(asset.lokasiToken || '').toUpperCase() === token.toUpperCase() || String(asset.lokasi || '').toLowerCase() === String(name || '').toLowerCase()).length)}</td>
        <td><button class="mini-btn" data-action="delete-location" data-token="${esc(token)}" title="Hapus"><i data-lucide="trash-2"></i></button></td>
      </tr>
    `).join('') : '<tr><td colspan="4">Belum ada mapping lokasi.</td></tr>';

    mapBody.querySelectorAll('[data-action="delete-location"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const token = btn.dataset.token;
        if (!token) return;
        delete locationMap[token];
        saveLocationMap();
        ensureLocations();
        renderLocationSettings();
      });
    });
  }

  if (unknownBody) {
    const rows = assets.filter((asset) => !asset.lokasi || !String(asset.lokasi || '').trim() || !asset.lokasiToken).map((asset) => `
      <tr data-asset-id="${esc(asset.id || '')}">
        <td>${esc(asset.kode || '-')}</td>
        <td class="asset-name" title="${esc(asset.nama || '-')}">${esc(asset.nama || '-')}</td>
        <td>${esc(asset.lokasi || 'Belum diatur')}</td>
        <td><button class="btn btn-ghost btn-sm" data-action="assign-location" data-asset-id="${esc(asset.id || '')}">Atur</button></td>
      </tr>
    `).join('');
    unknownBody.innerHTML = rows || '<tr><td colspan="4">Semua lokasi sudah diatur.</td></tr>';
    unknownBody.querySelectorAll('[data-action="assign-location"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const asset = assets.find((item) => item.id === btn.dataset.assetId);
        if (!asset) return;
        const token = extractLocationToken((asset.kode || '').toUpperCase()) || '';
        if (token) {
          asset.lokasiToken = token;
          asset.lokasi = locationMap[token] || token;
          asset.lokasiManual = false;
          saveAssets();
          renderLocationSettings();
        }
      });
    });
  }

  if (unknownCount) {
    const count = assets.filter((asset) => !asset.lokasi || !String(asset.lokasi || '').trim() || !asset.lokasiToken).length;
    unknownCount.textContent = count ? `${count} aset belum memiliki lokasi yang jelas` : 'Semua aset memiliki lokasi yang jelas';
  }

  const fallbackInput = document.getElementById('locFallbackInput');
  if (fallbackInput && document.activeElement !== fallbackInput) fallbackInput.value = locationFallback;

  setTableRowsInteractive(document);
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function resetForm() {
  const form = document.getElementById('assetForm');
  if (form) form.reset();
  const title = document.getElementById('formTitle');
  if (title) title.textContent = 'Tambah Aset Baru';
  const fId = document.getElementById('fId');
  if (fId) fId.value = '';
  const fKode = document.getElementById('fKode');
  if (fKode) fKode.focus();
}

function openDrill(title, data) {
  const titleEl = document.getElementById('drillTitle');
  const bodyEl = document.getElementById('drillBody');
  if (!titleEl || !bodyEl) return;
  titleEl.textContent = title || 'Detail';
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    bodyEl.innerHTML = '<div class="empty-state">Tidak ada data.</div>';
    document.getElementById('drillModal')?.classList.add('open');
    return;
  }
  bodyEl.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Kode</th><th>Nama</th><th>Kategori</th><th>Lokasi</th><th>Harga</th></tr></thead>
        <tbody>
          ${rows.map((asset) => `
            <tr>
              <td>${esc(asset.kode || '-')}</td>
              <td class="asset-name" title="${esc(asset.nama || '-')}">${esc(asset.nama || '-')}</td>
              <td>${esc(asset.tipe || '-')}</td>
              <td>${esc(asset.lokasi || '-')}</td>
              <td>${rupiah(Number(asset.harga) || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('drillModal')?.classList.add('open');
}

function showCategoryBreakdown() {
  const groups = assets.reduce((acc, asset) => {
    const key = String(asset.tipe || 'Lainnya').trim() || 'Lainnya';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  openDrill('Breakdown Kategori', entries.map(([name, count]) => ({
    kode: `${count} aset`,
    nama: name,
    tipe: 'Kategori',
    lokasi: '-',
    harga: count
  })));
}

async function handleFile(file) {
  if (!file) return;
  showLoading();
  try {
    const name = String(file.name || '').toLowerCase();
    if (typeof XLSX !== 'undefined' && (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv'))) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { raw: false, defval: '' });
      pendingImport = rows
        .map((row) => {
          const item = {};
          item.id = ('AST-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
          item.kode = row['Kode Aktiva'] || row.kode || row['Kode'] || '';
          item.nama = row['Nama Aktiva'] || row.nama || row['Nama'] || '';
          item.tipe = row['Nama Tipe Aktiva'] || row.tipe || row['Kategori'] || row['Jenis'] || '';
          item.noAkun = row['No. Akun Aktiva'] || row['No. Akun'] || row.noAkun || '';
          item.harga = Number(String(row['Harga Perolehan'] || row.harga || 0).replace(/[^0-9.-]/g, '')) || 0;
          item.tglPakai = row['Tgl Pemakaian'] || row.tglPakai || row['Tanggal Pakai'] || '';
          item.tglBeli = row['Tgl Pembelian'] || row.tglBeli || row['Tanggal Beli'] || item.tglPakai || '';
          item.umur = row['Estimasi Umur'] || row.umur || '5 Yr 0 Mth';
          item.rasio = row['% Rasio Depr.'] || row.rasio || '';
          item.metode = row['Metode Penyusutan'] || row.metode || 'Metode Garis Lurus';
          item.lokasi = row['Lokasi'] || row.lokasi || '';
          const detectedToken = extractLocationToken((item.kode || item.nama || '') + ' ' + (item.lokasi || ''));
          item.lokasiToken = detectedToken || '';
          const mappedKey = getConfiguredLocationKey(detectedToken);
          if (mappedKey) {
            item.lokasi = locationMap[mappedKey];
            item.lokasiManual = false;
          } else if (detectedToken && locationFallback) {
            item.lokasi = locationFallback;
            item.lokasiManual = false;
          } else if (detectedToken && item.lokasi) {
            item.lokasiManual = true;
          }
          if (item.lokasi && !item.lokasiToken) item.lokasiManual = true;
          return item;
        })
        .filter((item) => item.kode || item.nama);
      document.getElementById('uploadPreview').innerHTML = `<div class="preview-count">${pendingImport.length} aset siap diimpor</div>`;
      document.getElementById('uploadActions').style.display = 'flex';
    }
  } catch (err) {
    console.error(err);
    toast('File gagal diproses: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

Object.defineProperty(window, 'assets', {
  get: () => assets,
  set: (value) => { assets = Array.isArray(value) ? value : []; },
  configurable: true
});
Object.defineProperty(window, 'audits', {
  get: () => audits,
  set: (value) => { audits = Array.isArray(value) ? value : []; },
  configurable: true
});
Object.defineProperty(window, 'locationMap', {
  get: () => locationMap,
  set: (value) => { locationMap = value && typeof value === 'object' ? value : {}; },
  configurable: true
});

window.openDrill = openDrill;
window.showCategoryBreakdown = showCategoryBreakdown;
window.resetForm = resetForm;
window.renderLocationSettings = renderLocationSettings;
window.handleFile = handleFile;
window.loadAssets = loadAssets;
window.saveAssets = saveAssets;
window.ensureSeed = ensureSeed;

function buildReportExportSheetData() {
  const rows = getFilteredReportAssets();
  return rows.map((asset, idx) => ({
    No: idx + 1,
    Kode: asset.kode || '',
    NamaAset: asset.nama || '',
    Kategori: asset.tipe || '',
    Lokasi: asset.lokasi || '',
    HargaPerolehan: Number(asset.harga) || 0,
    TglBeli: asset.tglBeli || '',
    TglPakai: asset.tglPakai || '',
    Umur: asset.umur || '',
    DSScore: asset.dsScore ?? '',
    Status: getAssetStatusText(asset),
    StatusAudit: getAuditStatusText(asset)
  }));
}

function exportReportToXlsx() {
  if (typeof XLSX === 'undefined') {
    toast('Library Excel belum tersedia di browser.', 'warning');
    return;
  }
  const rows = buildReportExportSheetData();
  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.json_to_sheet(rows, {
    header: ['No', 'Kode', 'NamaAset', 'Kategori', 'Lokasi', 'HargaPerolehan', 'TglBeli', 'TglPakai', 'Umur', 'DSScore', 'Status', 'StatusAudit']
  });
  dataSheet['!cols'] = [
    { wch: 6 }, { wch: 18 }, { wch: 26 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 16 }
  ];
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'DataAset');

  const totalNilai = rows.reduce((sum, row) => sum + Number(row.HargaPerolehan || 0), 0);
  const summaryData = [
    ['Ringkasan Aset', ''],
    ['Total Aset', rows.length],
    ['Total Nilai Perolehan', totalNilai],
    ['Rata-rata Nilai', rows.length ? totalNilai / rows.length : 0],
    ['Jenis Kategori', '=COUNTA(DataAset!D2:D999)'],
    ['Total Status Audit Belum', '=COUNTIF(DataAset!L2:L999,"Belum")'],
    ['Total Status Audit Lain', '=COUNTIF(DataAset!L2:L999,"<>Belum")'],
    ['Tanggal Export', new Date().toISOString().slice(0, 10)]
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [{ wch: 25 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan');
  XLSX.writeFile(workbook, `smart-asset-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Excel laporan berhasil diunduh', 'success');
}

function exportReportToCsv() {
  const rows = buildReportExportSheetData();
  if (!rows.length) {
    toast('Tidak ada data untuk diekspor', 'warning');
    return;
  }
  const header = ['No', 'Kode', 'NamaAset', 'Kategori', 'Lokasi', 'HargaPerolehan', 'TglBeli', 'TglPakai', 'Umur', 'DSScore', 'Status', 'StatusAudit'];
  const csvRows = [header, ...rows.map((row) => [
    row.No, row.Kode, row.NamaAset, row.Kategori, row.Lokasi, row.HargaPerolehan, row.TglBeli, row.TglPakai, row.Umur, row.DSScore, row.Status, row.StatusAudit
  ])].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smart-asset-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV laporan berhasil diunduh', 'success');
}

async function exportReportToPpt() {
  if (typeof PptxGenJS === 'undefined') {
    toast('Library PowerPoint belum tersedia.', 'warning');
    return;
  }
  if (typeof JSZip === 'undefined') {
    toast('Library transisi PowerPoint belum tersedia.', 'warning');
    return;
  }
  const rows = getFilteredReportAssets();
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Smart Asset';
  pptx.company = 'Smart Asset';
  pptx.subject = 'Laporan Lengkap Aset';
  pptx.title = 'Smart Asset | Laporan Aset';
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'id-ID' };

  const colors = { ink: '16352B', green: '087F5B', lime: 'C7F36B', mint: 'E8F5EC', paper: 'F7FAF6', muted: '64736B', line: 'DCE7DE', white: 'FFFFFF' };
  const totalValue = rows.reduce((sum, asset) => sum + (Number(asset.harga) || 0), 0);
  const averageValue = rows.length ? totalValue / rows.length : 0;
  const categories = Object.entries(rows.reduce((groups, asset) => {
    const key = String(asset.tipe || 'Lainnya').trim() || 'Lainnya';
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {})).sort((a, b) => b[1] - a[1]);
  const locations = Object.entries(rows.reduce((groups, asset) => {
    const key = String(asset.lokasi || 'Belum diatur').trim() || 'Belum diatur';
    groups[key] = (groups[key] || 0) + (Number(asset.harga) || 0);
    return groups;
  }, {})).sort((a, b) => b[1] - a[1]);
  const auditStatuses = rows.reduce((groups, asset) => {
    const key = getAuditStatusText(asset) || 'Belum';
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
  const formatMoney = (value) => `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
  const dateLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const addShape = (slide, shape, opts) => slide.addShape(shape, opts);
  const addText = (slide, text, opts) => slide.addText(String(text ?? ''), { fontFace: 'Aptos', margin: 0, breakLine: false, ...opts });
  const addHeader = (slide, section, index) => {
    slide.background = { color: colors.paper };
    addShape(slide, pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.16, line: { color: colors.green, transparency: 100 }, fill: { color: colors.green } });
    addText(slide, section.toUpperCase(), { x: 0.55, y: 0.34, w: 9.5, h: 0.25, fontSize: 9, bold: true, charSpacing: 1.3, color: colors.green });
    addShape(slide, pptx.ShapeType.line, { x: 0.55, y: 7.05, w: 12.2, h: 0, line: { color: colors.line, width: 1 } });
    addText(slide, 'SMART ASSET  |  GA 7.10 HZ', { x: 0.55, y: 7.12, w: 6, h: 0.18, fontSize: 8, bold: true, color: colors.muted });
    addText(slide, `${index}  |  ${dateLabel}`, { x: 9.5, y: 7.12, w: 3.25, h: 0.18, fontSize: 8, color: colors.muted, align: 'right' });
  };
  const addTitle = (slide, title, subtitle) => {
    addText(slide, title, { x: 0.55, y: 0.75, w: 12.1, h: 0.55, fontSize: 25, bold: true, color: colors.ink, fit: 'shrink' });
    if (subtitle) addText(slide, subtitle, { x: 0.58, y: 1.34, w: 12, h: 0.3, fontSize: 10, color: colors.muted, fit: 'shrink' });
  };
  const addBarList = (slide, entries, valueFormatter, maxValue, yStart = 2.0) => {
    const shown = entries.slice(0, 7);
    if (!shown.length) {
      addText(slide, 'Belum ada data untuk ditampilkan.', { x: 0.75, y: yStart + 0.25, w: 8, h: 0.35, fontSize: 12, color: colors.muted });
      return;
    }
    shown.forEach(([label, value], index) => {
      const y = yStart + index * 0.63;
      addText(slide, label, { x: 0.72, y, w: 3.0, h: 0.24, fontSize: 10, bold: true, color: colors.ink, fit: 'shrink' });
      addShape(slide, pptx.ShapeType.roundRect, { x: 3.8, y: y + 0.02, w: 6.7, h: 0.22, rectRadius: 0.05, line: { color: colors.line, transparency: 100 }, fill: { color: colors.line } });
      addShape(slide, pptx.ShapeType.roundRect, { x: 3.8, y: y + 0.02, w: Math.max(0.06, 6.7 * Number(value) / (maxValue || 1)), h: 0.22, rectRadius: 0.05, line: { color: colors.green, transparency: 100 }, fill: { color: index % 2 ? colors.green : '24A675' } });
      addText(slide, valueFormatter(value), { x: 10.75, y: y - 0.01, w: 1.8, h: 0.25, fontSize: 10, bold: true, color: colors.ink, align: 'right', fit: 'shrink' });
    });
  };

  const cover = pptx.addSlide();
  cover.background = { color: colors.ink };
  addShape(cover, pptx.ShapeType.rect, { x: 9.55, y: 0, w: 3.783, h: 7.5, line: { color: '1C4938', transparency: 100 }, fill: { color: '1C4938' } });
  addShape(cover, pptx.ShapeType.ellipse, { x: 9.1, y: 0.5, w: 3.4, h: 3.4, line: { color: colors.green, transparency: 100 }, fill: { color: colors.green, transparency: 12 } });
  addShape(cover, pptx.ShapeType.ellipse, { x: 10.2, y: 2.3, w: 2.6, h: 2.6, line: { color: colors.lime, transparency: 100 }, fill: { color: colors.lime, transparency: 8 } });
  addText(cover, 'HZ', { x: 0.72, y: 0.62, w: 1.05, h: 0.62, fontSize: 30, bold: true, color: '050807', align: 'center', valign: 'mid', fill: { color: colors.lime }, line: { color: colors.lime, transparency: 100 }, radius: 0.08 });
  addText(cover, 'SMART ASSET', { x: 0.72, y: 1.62, w: 6.7, h: 0.38, fontSize: 13, bold: true, charSpacing: 2.2, color: colors.lime });
  addText(cover, 'Laporan\nAset & Monitoring', { x: 0.72, y: 2.35, w: 8.3, h: 1.65, fontSize: 34, bold: true, color: colors.white, breakLine: false, fit: 'shrink' });
  addText(cover, 'Ringkasan eksekutif, analisis distribusi, status audit, dan daftar aset lengkap.', { x: 0.76, y: 4.35, w: 6.8, h: 0.75, fontSize: 15, color: 'D2E4D9', breakLine: false, fit: 'shrink' });
  addShape(cover, pptx.ShapeType.line, { x: 0.76, y: 5.45, w: 5.0, h: 0, line: { color: colors.green, width: 2 } });
  addText(cover, `Diterbitkan ${dateLabel}  |  ${rows.length.toLocaleString('id-ID')} aset dalam cakupan`, { x: 0.76, y: 5.72, w: 7.8, h: 0.32, fontSize: 10, color: 'D2E4D9', fit: 'shrink' });

  let slideNumber = 1;
  const summary = pptx.addSlide();
  addHeader(summary, 'Ringkasan Eksekutif', ++slideNumber);
  addTitle(summary, 'Ringkasan portofolio aset', 'Snapshot data mengikuti filter aktif pada menu Rekap & Export.');
  const kpis = [
    ['TOTAL ASET', rows.length.toLocaleString('id-ID')],
    ['NILAI PEROLEHAN', formatMoney(totalValue)],
    ['RATA-RATA NILAI', formatMoney(averageValue)],
    ['KATEGORI / LOKASI', `${categories.length} / ${locations.length}`]
  ];
  kpis.forEach(([label, value], index) => {
    const x = 0.6 + index * 3.18;
    addShape(summary, pptx.ShapeType.roundRect, { x, y: 2.02, w: 2.9, h: 1.25, rectRadius: 0.1, line: { color: colors.line, width: 1 }, fill: { color: index === 1 ? colors.mint : colors.white }, shadow: { type: 'outer', color: '9DB2A3', blur: 2, angle: 45, distance: 1, opacity: 0.12 } });
    addText(summary, label, { x: x + 0.18, y: 2.23, w: 2.55, h: 0.24, fontSize: 8, bold: true, charSpacing: 0.8, color: colors.muted, fit: 'shrink' });
    addText(summary, value, { x: x + 0.18, y: 2.62, w: 2.56, h: 0.42, fontSize: index === 1 ? 16 : 21, bold: true, color: colors.ink, fit: 'shrink' });
  });
  addShape(summary, pptx.ShapeType.roundRect, { x: 0.6, y: 3.7, w: 12.12, h: 2.35, rectRadius: 0.08, line: { color: colors.line, width: 1 }, fill: { color: colors.white } });
  addText(summary, 'CATATAN CAKUPAN', { x: 0.92, y: 4.02, w: 3.2, h: 0.24, fontSize: 9, bold: true, charSpacing: 0.9, color: colors.green });
  addText(summary, rows.length ? `Laporan ini merangkum ${rows.length.toLocaleString('id-ID')} aset dengan nilai perolehan ${formatMoney(totalValue)}. Data rinci disajikan pada lampiran dan mencakup kode, identitas, lokasi, tanggal, umur, DS Score, status aset, serta status audit.` : 'Tidak ada aset yang sesuai dengan filter laporan saat ini.', { x: 0.92, y: 4.48, w: 11.25, h: 0.86, fontSize: 15, color: colors.ink, breakLine: false, valign: 'mid', fit: 'shrink' });

  const categorySlide = pptx.addSlide();
  addHeader(categorySlide, 'Analisis Kategori', ++slideNumber);
  addTitle(categorySlide, 'Sebaran aset per kategori', 'Kategori dengan jumlah aset terbanyak dalam cakupan laporan.');
  addBarList(categorySlide, categories, (value) => `${value} aset`, Math.max(1, ...categories.map((entry) => entry[1])));

  const locationSlide = pptx.addSlide();
  addHeader(locationSlide, 'Analisis Lokasi', ++slideNumber);
  addTitle(locationSlide, 'Nilai perolehan per lokasi', 'Lokasi diurutkan berdasarkan total nilai perolehan.');
  addBarList(locationSlide, locations, formatMoney, Math.max(1, ...locations.map((entry) => entry[1])));

  const auditSlide = pptx.addSlide();
  addHeader(auditSlide, 'Status & Audit', ++slideNumber);
  addTitle(auditSlide, 'Status aset dan audit', 'Ringkasan status berdasarkan data aset dan catatan audit terbaru.');
  const statusCounts = rows.reduce((groups, asset) => {
    const key = getAssetStatusText(asset) || 'Tidak diketahui';
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
  addText(auditSlide, 'STATUS ASET', { x: 0.72, y: 1.95, w: 5.4, h: 0.25, fontSize: 10, bold: true, charSpacing: 1, color: colors.green });
  addText(auditSlide, 'STATUS AUDIT', { x: 6.9, y: 1.95, w: 5.4, h: 0.25, fontSize: 10, bold: true, charSpacing: 1, color: colors.green });
  const addCountCards = (entries, xStart) => entries.slice(0, 6).forEach(([label, value], index) => {
    const x = xStart + (index % 2) * 2.85;
    const y = 2.45 + Math.floor(index / 2) * 1.12;
    addShape(auditSlide, pptx.ShapeType.roundRect, { x, y, w: 2.55, h: 0.84, rectRadius: 0.08, line: { color: colors.line, width: 1 }, fill: { color: index === 0 ? colors.mint : colors.white } });
    addText(auditSlide, label, { x: x + 0.16, y: y + 0.13, w: 1.7, h: 0.2, fontSize: 9, bold: true, color: colors.muted, fit: 'shrink' });
    addText(auditSlide, value, { x: x + 1.78, y: y + 0.17, w: 0.58, h: 0.32, fontSize: 17, bold: true, color: colors.ink, align: 'right' });
  });
  addCountCards(Object.entries(statusCounts).sort((a, b) => b[1] - a[1]), 0.72);
  addCountCards(Object.entries(auditStatuses).sort((a, b) => b[1] - a[1]), 6.9);

  const pageSize = 9;
  const assetPages = Math.max(1, Math.ceil(rows.length / pageSize));
  for (let pageIndex = 0; pageIndex < assetPages; pageIndex++) {
    const slide = pptx.addSlide();
    addHeader(slide, 'Lampiran Data Aset', ++slideNumber);
    addTitle(slide, 'Daftar aset lengkap', `Halaman ${pageIndex + 1} dari ${assetPages}  |  ${rows.length.toLocaleString('id-ID')} aset`);
    const pageRows = rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
    const tableRows = [
      [
        { text: 'No', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Kode', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Nama Aset', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Kategori', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Lokasi', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Nilai Perolehan', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Tgl Beli', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Tgl Pakai', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Umur', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'DS Score', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Status', options: { bold: true, color: colors.white, fill: colors.ink } },
        { text: 'Status Audit', options: { bold: true, color: colors.white, fill: colors.ink } }
      ],
      ...pageRows.map((asset, index) => {
        const fill = (pageIndex * pageSize + index) % 2 ? 'F0F6F1' : colors.white;
        return [
          String(pageIndex * pageSize + index + 1), asset.kode || '-', asset.nama || '-', asset.tipe || '-', asset.lokasi || '-', formatMoney(asset.harga), formatDateShort(asset.tglBeli) || '-', formatDateShort(asset.tglPakai) || '-', asset.umur || '-', String(asset.dsScore ?? '-'), getAssetStatusText(asset) || '-', getAuditStatusText(asset) || 'Belum'
        ].map((text) => ({ text: String(text), options: { fill } }));
      })
    ];
    slide.addTable(tableRows, {
      x: 0.52, y: 1.92, w: 12.3, h: 4.75,
      colW: [0.38, 1.0, 2.02, 1.02, 1.12, 1.35, 0.92, 0.92, 0.62, 0.68, 1.12, 1.15],
      rowH: 0.44, fontFace: 'Aptos', fontSize: 7.2, color: colors.ink,
      border: { type: 'solid', color: colors.line, pt: 0.55 },
      fill: { color: colors.white }, margin: 0.055, valign: 'mid',
      autoPage: false
    });
  }

  try {
    const fileName = `smart-asset-report-${new Date().toISOString().slice(0, 10)}.pptx`;
    const pptxBlob = await pptx.write({ outputType: 'blob' });
    const archive = await JSZip.loadAsync(pptxBlob);
    await Promise.all(pptx.slides.map(async (_slide, index) => {
      const slidePath = `ppt/slides/slide${index + 1}.xml`;
      const slideFile = archive.file(slidePath);
      if (!slideFile) return;
      const xml = await slideFile.async('string');
      const transition = '<p:transition spd="med" advClick="1"><p:fade/></p:transition>';
      archive.file(slidePath, xml.replace('</p:sld>', `${transition}</p:sld>`));
    }));
    const finalBlob = await archive.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const url = URL.createObjectURL(finalBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('PowerPoint lengkap berhasil diunduh', 'success');
  } catch (error) {
    console.error('Gagal membuat PowerPoint:', error);
    toast('Gagal membuat PowerPoint. Coba muat ulang aplikasi.', 'warning');
  }
}

async function init() {
  showLoading();
  try {
    if (!window.smartAssetSupabase) throw new Error('Koneksi Supabase Smart BARA tidak tersedia.');
    const { data: sessionData, error: sessionError } = await window.smartAssetSupabase.auth.getSession();
    if (sessionError || !sessionData?.session) {
      const app = document.querySelector('.app');
      if (app) app.style.display = 'none';
      const gate = document.getElementById('assetAuthGate');
      if (gate) {
        gate.hidden = false;
        gate.style.display = 'grid';
      }
      hideLoading();
      return;
    }

    loadLocationMap();
    loadUploadHistory();
    loadCodeFormats();
    const t = window.SmartBaraTheme?.isNormal()
      ? window.SmartBaraTheme.getResolvedMode()
      : (localStorage.getItem('theme') || 'dark');
    document.documentElement.setAttribute('data-theme', t);
    const icon = t === 'dark' ? 'moon' : 'sun';
    const ti = $('#themeToggle')?.querySelector('i');
    if (ti) ti.setAttribute('data-lucide', icon);

    await loadAssets();
  } catch (err) {
    console.error('Gagal menginisialisasi aplikasi:', err);
    const app = document.querySelector('.app');
    if (app) app.style.display = 'none';
    toast(err.message || 'Data cloud gagal dimuat. Periksa koneksi dan muat ulang.', 'error');
    hideLoading();
    return;
  }

  try {
    renderStartupSequence();
  } catch (err) {
    console.error('Gagal merender aplikasi:', err);
    toast('Tampilan tidak termuat sepenuhnya. Muat ulang halaman.', 'error');
    hideLoading();
  }
}


function setTableRowsInteractive(root) {
  if (!root) return;
  root.querySelectorAll('.data-table tbody tr').forEach((row) => {
    if (row.cells.length === 1 && row.cells[0].hasAttribute('colspan')) return;
    row.tabIndex = 0;
    const firstValue = row.cells[0]?.innerText.trim();
    row.setAttribute('aria-label', `Lihat detail${firstValue ? `: ${firstValue}` : ''}`);
  });
}

/* ---------- Event wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  const sidebarEl = $('#sidebar');
  const menuBtn = $('#menuBtn');
  const syncSidebarState = () => {
    if (!sidebarEl) return;
    const main = $('.main');
    const desktop = window.innerWidth > 900;
    document.body.classList.toggle('sidebar-open', !desktop && sidebarEl.classList.contains('open'));
    if (desktop) {
      sidebarEl.classList.add('open');
      sidebarEl.classList.remove('open');
      main?.classList.toggle('sidebar-collapsed', sidebarEl.classList.contains('collapsed'));
      return;
    }
    main?.classList.remove('sidebar-collapsed');
    if (!sidebarEl.classList.contains('open')) {
      sidebarEl.classList.remove('collapsed');
    }
  };
  const toggleSidebar = () => {
    if (!sidebarEl) return;
    if (window.innerWidth > 900) {
      sidebarEl.classList.toggle('collapsed');
      const main = $('.main');
      main?.classList.toggle('sidebar-collapsed', sidebarEl.classList.contains('collapsed'));
      sidebarEl.classList.add('open');
      document.body.classList.remove('sidebar-open');
      return;
    }
    const nextState = !sidebarEl.classList.contains('open');
    sidebarEl.classList.toggle('open', nextState);
    sidebarEl.classList.remove('collapsed');
    document.body.classList.toggle('sidebar-open', nextState);
  };

  menuBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSidebar();
  });
  window.addEventListener('resize', syncSidebarState);
  syncSidebarState();
  document.addEventListener('click', (event) => {
    if (!sidebarEl || !menuBtn) return;
    const clickedSidebar = sidebarEl.contains(event.target);
    const clickedMenu = menuBtn.contains(event.target);
    if (!clickedSidebar && !clickedMenu && window.innerWidth <= 900) {
      sidebarEl.classList.remove('open');
    }
  });

  setTableRowsInteractive(document);

  const showTableRowDetail = (row, target) => {
    if (target.closest('button,a,input,select,textarea,[data-action]')) return;
    const table = row.closest('table.data-table');
    if (!table) return;
    if (row.dataset.assetId) {
      openAssetDetail(row.dataset.assetId);
      return;
    }
    openTableRowDetail(table, row);
  };
  document.addEventListener('click', (event) => {
    const row = event.target.closest('.data-table tbody tr');
    if (row) showTableRowDetail(row, event.target);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof HTMLTableRowElement)) return;
    const row = event.target;
    if (!row.matches('.data-table tbody tr')) return;
    event.preventDefault();
    showTableRowDetail(row, event.target);
  });

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModals()));
  $('#confirmOk').addEventListener('click', async () => {
    if (!confirmCallback) { closeModals(); return; }
    const cb = confirmCallback; confirmCallback = null;
    closeModals();
    await cb();
  });

  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#settingsTheme')?.addEventListener('click', toggleTheme);
  document.getElementById('codeFormatSettings')?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'new-format') return openCodeFormatModal();
    if (action === 'edit-format') return openCodeFormatModal(target.dataset.formatId);
    if (action === 'delete-format') {
      const id = target.dataset.formatId;
      if (!id) return;
      const index = (codeFormats || []).findIndex((fmt) => fmt.id === id);
      if (index >= 0) {
        codeFormats.splice(index, 1);
        saveCodeFormats();
        renderCodeFormatSettings();
      }
    }
  });

  monthlyBasis = $('#monthlyBasis');
  monthlyCat = $('#monthlyCat');
  monthlyLoc = $('#monthlyLoc');
  if (monthlyBasis) monthlyBasis.addEventListener('change', renderMonthlyView);
  if (monthlyCat) monthlyCat.addEventListener('change', renderMonthlyView);
  if (monthlyLoc) monthlyLoc.addEventListener('change', renderMonthlyView);

  $('#assetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#fId').value || ('AST-' + Date.now());
    const lokasiVal = $('#fLokasi').value.trim();
    let lokasiToken = lokasiVal ? (extractLocationToken(lokasiVal.toUpperCase()) || lokasiVal) : extractLocationToken($('#fKode').value.trim());
    if (lokasiVal) {
      if (!locationMap[lokasiToken]) locationMap[lokasiToken] = lokasiVal;
    }
    const item = {
      id,
      kode: $('#fKode').value.trim(),
      nama: $('#fNama').value.trim(),
      tipe: $('#fTipe').value.trim(),
      lokasiToken: lokasiToken,
      lokasi: lokasiVal || locationFullName(lokasiToken),
      lokasiManual: !!lokasiVal,
      noAkun: $('#fNoAkun').value.trim(),
      harga: Number($('#fHarga').value) || 0,
      tglPakai: $('#fTglPakai').value,
      tglBeli: $('#fTglBeli').value,
      umur: $('#fUmur').value.trim(),
      rasio: $('#fRasio').value === '' ? '' : Number($('#fRasio').value),
      dsScore: $('#fDsScore').value === '' ? '' : Number($('#fDsScore').value),
      metode: $('#fMetode').value.trim(),
    };
    const idx = assets.findIndex((a) => a.id === id);
    if (idx >= 0) assets[idx] = item; else assets.push(item);
    ensureLocations();
    assets = assets.map(normalizeAsset);
    await saveAssets();
    toast('Aset disimpan', 'success');
    resetForm();
    if ($('#view-assets').classList.contains('active')) renderAssetTable();
    if ($('#view-dashboard').classList.contains('active')) renderDashboard();
    if ($('#view-report').classList.contains('active')) renderReport();
  });
  $('#formReset').addEventListener('click', resetForm);

  $('#globalSearch').addEventListener('input', () => { if ($('#view-assets').classList.contains('active')) renderAssetTable(); });
  $('#assetSearch').addEventListener('input', () => renderAssetTable());
  $('#assetFilterCat').addEventListener('change', () => renderAssetTable());
  $('#assetFilterLoc').addEventListener('change', () => renderAssetTable());
  $('#depFilter').addEventListener('change', () => renderAssetTable());
  $('#priceMin').addEventListener('input', () => renderAssetTable());
  $('#priceMax').addEventListener('input', () => renderAssetTable());
  $('#assetSort').addEventListener('change', (e) => { sortKey = e.target.value; renderAssetTable(); });
  $('#sortDirBtn').addEventListener('click', () => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    $('#sortDirBtn').querySelector('i').setAttribute('data-lucide', sortDir === 'asc' ? 'arrow-down' : 'arrow-up');
    lucide.createIcons();
    renderAssetTable();
  });
  $('#pageSize').addEventListener('change', () => { currentPage = 1; renderAssetTable(); });
  $('#clearFilters').addEventListener('click', () => {
    $('#assetSearch').value = ''; $('#globalSearch').value = ''; $('#assetFilterCat').value = '';
    $('#assetFilterLoc').value = ''; $('#depFilter').value = '';
    $('#priceMin').value = ''; $('#priceMax').value = '';
    $('#assetSort').value = 'id'; sortKey = 'id'; sortDir = 'asc'; currentPage = 1; renderAssetTable();
  });

  ['repCat', 'repLoc', 'repFrom', 'repTo', 'repPriceMin', 'repPriceMax', 'repSearch'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', renderReport);
    if (el) el.addEventListener('change', renderReport);
  });

  const uploadZone = $('#uploadZone');
  if (uploadZone) {
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
    uploadZone.addEventListener('drop', (e) => { e.preventDefault(); uploadZone.classList.remove('drag'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  }
  $('#fileInput').addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  $('#confirmImport').addEventListener('click', async () => {
    if (!pendingImport || !pendingImport.length) { toast('Tidak ada data', 'warning'); return; }
    const mode = $('#importMode').value;
    showLoading();
    try {
      const before = Array.isArray(assets) ? assets.map((item) => ({ ...item })) : [];
      if (mode === 'replace') { assets = []; }
      for (const item of pendingImport) { assets.push(normalizeAsset(item)); }
      assets = assets.map(normalizeAsset);
      ensureLocations();
      await saveAssets();
      addUploadHistoryEntry({ label: mode === 'replace' ? 'Import replace' : 'Import append', mode, rows: pendingImport.length, snapshot: mode === 'replace' ? before : [...before, ...pendingImport] });
      hideLoading();
      toast(`Berhasil impor ${pendingImport.length} aset`, 'success');
      pendingImport = null;
      $('#uploadPreview').innerHTML = '';
      $('#uploadActions').style.display = 'none';
      $('#fileInput').value = '';
      renderAssetTable(); renderDashboard(); renderUploadHistory();
    } catch (err) { hideLoading(); toast('Gagal impor: ' + err.message, 'error'); }
  });
  $('#cancelImport').addEventListener('click', () => {
    pendingImport = null; $('#uploadPreview').innerHTML = ''; $('#uploadActions').style.display = 'none'; $('#fileInput').value = '';
  });

  $('#quickExport').addEventListener('click', () => { setView('report'); setTimeout(() => $('#exportXlsx')?.click(), 250); });
  $('#exportXlsx')?.addEventListener('click', exportReportToXlsx);
  $('#exportCsv')?.addEventListener('click', exportReportToCsv);
  $('#exportPpt')?.addEventListener('click', exportReportToPpt);
  $('#exportMonthlyXlsx')?.addEventListener('click', () => { const rows = buildReportExportSheetData(); if (!rows.length) { toast('Tidak ada data per bulan', 'warning'); return; } exportReportToXlsx(); });
  $('#exportMonthlyPpt')?.addEventListener('click', exportReportToPpt);

  $('#backupJson').addEventListener('click', () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      assets: JSON.parse(JSON.stringify(assets.map(normalizeAsset))),
      locationMap,
      locationFallback,
      codeFormats,
      audits
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `backup_aset_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    addUploadHistoryEntry({ label: 'Backup manual', mode: 'append', rows: assets.length, snapshot: JSON.parse(JSON.stringify(assets)) });
    toast('Backup diunduh', 'success');
  });
  $('#restoreJson').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    showLoading();
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : (Array.isArray(data.assets) ? data.assets : null);
      if (!list) throw new Error('Format tidak valid');
      assets = list.map(normalizeAsset);
      if (data.locationMap && typeof data.locationMap === 'object') {
        locationMap = data.locationMap;
      }
      if (Object.prototype.hasOwnProperty.call(data, 'locationFallback')) {
        locationFallback = String(data.locationFallback || '');
      }
      if (Array.isArray(data.codeFormats)) {
        codeFormats = data.codeFormats.map(ensureCodeFormatShape).filter(Boolean);
      }
      audits = Array.isArray(data.audits) ? data.audits : [];
      saveLocationMap();
      saveCodeFormats();
      ensureLocations();
      await saveAssets();
      hideLoading();
      toast(`Restore ${list.length} aset`, 'success');
      renderAssetTable(); renderDashboard(); renderLocationSettings();
    } catch (err) { hideLoading(); toast('Gagal restore: ' + err.message, 'error'); }
    e.target.value = '';
  });

  $('#clearAllData').addEventListener('click', () => {
    confirmAction('Hapus Semua Data Cloud', 'Hapus semua aset dan riwayat audit dari cloud Smart BARA untuk seluruh pengguna?', async () => {
      assets = []; audits = [];
      await saveAssets();
      toast('Semua data cloud dihapus', 'info');
      renderAssetTable(); renderDashboard();
    });
  });
  $('#reloadSeed').addEventListener('click', () => {
    confirmAction('Muat Ulang Data Awal', 'Timpa data dengan data asli dari file ASET 30 OKTOBER 2026?', async () => {
      showLoading();
      assets = [];
      if (window.SEED_DATA) {
        assets = window.SEED_DATA.map(normalizeAsset);
        ensureLocations();
      }
      await saveAssets();
      hideLoading();
      toast('Data awal dimuat', 'success');
      renderAssetTable(); renderDashboard();
    });
  });

  $('#locAutoExtract')?.addEventListener('click', () => {
    assets.forEach((a) => {
      if (!a.lokasiManual) applyLocationRule(a);
    });
    saveLocationMap();
    saveAssets();
    ensureLocations();
    renderLocationSettings();
    toast('Lokasi diekstrak', 'success');
  });
  $('#locFallbackApply')?.addEventListener('click', () => {
    const previousFallback = locationFallback;
    const nextFallback = ($('#locFallbackInput').value || '').trim();
    if (!nextFallback) {
      locationFallback = '';
      assets.forEach((asset) => {
        const token = extractLocationToken(asset.kode || asset.nama || '');
        if (!previousFallback || !token || asset.lokasiManual || asset.lokasi !== previousFallback) return;
        const isMapped = !!getConfiguredLocationKey(token);
        if (isMapped) return;
        asset.lokasiToken = token;
        asset.lokasi = token;
      });
      saveLocationMap();
      ensureLocations();
      toast('Fallback lokasi dinonaktifkan', 'info');
      renderLocationSettings();
      return;
    }
    locationFallback = nextFallback;
    assets.forEach((asset) => {
      const token = extractLocationToken(asset.kode || asset.nama || '');
      if (!token) return;
      const isMapped = !!getConfiguredLocationKey(token);
      if (!isMapped) {
        asset.lokasiToken = token;
        asset.lokasi = locationFallback;
        asset.lokasiManual = false;
      }
    });
    saveLocationMap();
    ensureLocations();
    renderLocationSettings();
    toast(`Lokasi fallback diterapkan: ${locationFallback}`, 'success');
  });
  $('#locDeleteAllTokens')?.addEventListener('click', () => {
    Object.keys(locationMap).forEach((key) => { delete locationMap[key]; });
    assets.forEach((asset) => {
      asset.lokasiToken = '';
      asset.lokasiManual = false;
      asset.lokasi = asset.lokasi || '';
    });
    saveLocationMap();
    saveAssets();
    renderLocationSettings();
    toast('Semua token lokasi berhasil dihapus', 'success');
  });
  $('#locAddMap')?.addEventListener('click', () => {
    const token = ($('#locTokenInput').value || '').trim().toUpperCase();
    const name = ($('#locNameInput').value || '').trim();
    if (!token || !name) { toast('Isi kode token dan nama lokasi', 'warning'); return; }
    locationMap[token] = name;
    assets.forEach((asset) => {
      if (!locationTokenMatchesCode(token, asset.kode || '')) return;
      asset.lokasiToken = token;
      asset.lokasi = name;
      asset.lokasiManual = false;
    });
    saveLocationMap();
    ensureLocations();
    renderLocationSettings();
    $('#locTokenInput').value = '';
    $('#locNameInput').value = '';
    toast('Mapping ditambahkan', 'success');
  });

  $('#auditSearch')?.addEventListener('input', renderAuditView);
  $('#auditFilterCond')?.addEventListener('change', renderAuditView);
  $('#auditFilterCat')?.addEventListener('change', renderAuditView);
  $('#auditFilterLoc')?.addEventListener('change', renderAuditView);
  $('#auditKondisi')?.addEventListener('change', () => {
    const v = $('#auditKondisi').value;
    $('#auditNewLocField').style.display = (v === 'Pindah') ? '' : 'none';
  });
  $('#auditFoto')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { $('#auditFotoPreview').innerHTML = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      $('#auditFotoPreview').innerHTML = '<img src="' + reader.result + '" style="max-width:160px;max-height:160px;border-radius:8px;border:1px solid var(--border)" />';
    };
    reader.readAsDataURL(file);
  });
  $('#auditForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const assetId = $('#auditAssetId').value;
    const a = assets.find(x => x.id === assetId);
    if (!a) return;
    const kondisi = $('#auditKondisi').value;
    const tanggal = $('#auditTanggal').value;
    const catatan = $('#auditCatatan').value.trim();
    const newLoc = (kondisi === 'Pindah') ? $('#auditNewLoc').value : '';
    let foto = '';
    const previewImg = $('#auditFotoPreview img');
    if (previewImg) foto = previewImg.src;
    const audit = {
      id: 'AUD-' + Date.now(),
      assetId: a.id,
      assetKode: a.kode,
      assetNama: a.nama,
      tanggal,
      kondisi,
      newLocation: newLoc,
      catatan,
      foto
    };
    audits.push(audit);
    if (kondisi === 'Pindah' && newLoc) {
      a.lokasiManual = true;
      const token = extractLocationToken(newLoc.toUpperCase().replace(/[^A-Z]/g,'')) || newLoc;
      if (!locationMap[token]) locationMap[token] = newLoc;
      a.lokasiToken = token;
      a.lokasi = newLoc;
      ensureLocations();
    }
    await saveAssets();
    closeModals();
    toast('Audit disimpan', 'success');
    renderAuditView();
  });

  $('#codeFormatForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#cfEditId').value;
    const name = $('#cfName').value.trim();
    const category = $('#cfCategory').value.trim() || 'Semua';
    const minValue = Number($('#cfMinValue').value) || 0;
    const categoryNumberMap = parseCategoryNumberMap($('#cfCategoryNumberMap')?.value || '');
    const container = $('#cfSlots');
    const slots = [];
    const rows = container ? container.querySelectorAll('.format-slot') : [];
    rows.forEach((row) => {
      const type = row.querySelector('.cf-slot-type')?.value || 'text';
      const value = row.querySelector('.cf-slot-text')?.value || row.querySelector('.cf-slot-col')?.value || '';
      const format = row.querySelector('.cf-slot-format')?.value || 'full';
      const custom = row.querySelector('.cf-slot-custom')?.value || '';
      if (type === 'text' || type === 'seq') {
        slots.push({ type, value: row.querySelector('.cf-slot-text')?.value || '', format: 'full', custom: '' });
      } else if (type === 'column') {
        slots.push({ type, value: row.querySelector('.cf-slot-col')?.value || '', format, custom });
      }
    });
    if (!name) {
      toast('Nama format wajib diisi', 'warning');
      return;
    }
    if (!slots.length) {
      toast('Minimal satu slot format', 'warning');
      return;
    }
    if (id) {
      const f = (codeFormats || []).find((x) => x.id === id);
      if (f) { f.name = name; f.category = category; f.minValue = minValue; f.categoryNumberMap = categoryNumberMap; f.slots = slots; }
    } else {
      codeFormats.push({ id: 'CF-' + Date.now(), name, category, minValue, categoryNumberMap, slots });
    }
    saveCodeFormats();
    closeModals();
    renderCodeFormatSettings();
    toast('Format disimpan', 'success');
  });

  document.getElementById('cfSlots')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="remove-slot"]');
    if (!btn) return;
    const slotIndex = Number(btn.dataset.slotIndex);
    const root = document.getElementById('cfSlots');
    const rows = [...(root?.querySelectorAll('.format-slot') || [])];
    if (rows.length <= 1) {
      toast('Minimal ada satu slot di format', 'warning');
      return;
    }
    rows[slotIndex]?.remove();
    const updated = [...root.querySelectorAll('.format-slot')].map((row, idx) => {
      row.dataset.slotIndex = String(idx);
      row.querySelectorAll('[data-slot-index]').forEach((el) => { el.dataset.slotIndex = String(idx); });
      const header = row.querySelector('.format-slot-header span');
      if (header) header.textContent = 'Slot ' + (idx + 1);
      return row;
    });
    if (!updated.length) {
      root.innerHTML = buildFormatEditorSlot({ type: 'text', value: 'AST', format: 'full', custom: '' }, 0);
    }
  });

  document.getElementById('cfSlots')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="add-slot"]');
    if (!btn) return;
    const root = document.getElementById('cfSlots');
    const slots = [...(root?.querySelectorAll('.format-slot') || [])].map((row) => ({
      type: row.querySelector('.cf-slot-type')?.value || 'text',
      value: row.querySelector('.cf-slot-text')?.value || row.querySelector('.cf-slot-col')?.value || '',
      format: row.querySelector('.cf-slot-format')?.value || 'full',
      custom: row.querySelector('.cf-slot-custom')?.value || ''
    }));
    slots.push({ type: 'text', value: 'AST', format: 'full', custom: '' });
    renderCodeFormatSlotEditor(slots);
  });

  init();
});
window.__appLoaded = true;

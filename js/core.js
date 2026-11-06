// ==============================================================================
// SMART BARA 7.10 HZ - CORE ENGINE, STORE, MULTI-DEPT & REALTIME CONCURRENCY
// ==============================================================================

window.SmartBaraCore = (function() {
    const PERIOD_REGISTRY_KEYS = ['smartbara_period_registry_v3', 'smartbara_period_registry_v2', 'smartbara_period_registry_v1'];

    function sanitizePeriodName(value) {
        if (value === null || value === undefined) return '';
        const cleaned = String(value).trim().replace(/\s+/g, ' ');
        if (!cleaned) return '';
        const safe = cleaned.replace(/[^a-zA-Z0-9\s\-_/./]/g, '').trim();
        if (!safe) return '';

        const lower = safe.toLowerCase();
        const monthNames = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember', 'january', 'february', 'march', 'may', 'june', 'july', 'august', 'october', 'december'];
        const matchesYear = /\d{4}/.test(lower);
        const matchesMonth = monthNames.some(month => lower.includes(month));
        return matchesYear || matchesMonth ? safe : '';
    }

    function resolveStoredPeriod(value) {
        const period = sanitizePeriodName(value);
        const configuredDefault = sanitizePeriodName(window.SMART_BARA_CONFIG.DEFAULT_PERIOD);
        if (/^\d{4}$/.test(period) && configuredDefault && configuredDefault !== period && configuredDefault.endsWith(period)) {
            return configuredDefault;
        }
        return period;
    }

    function readLocalPeriodRegistry() {
        for (const key of PERIOD_REGISTRY_KEYS) {
            try {
                const registry = JSON.parse(localStorage.getItem(key) || 'null');
                if (!registry || typeof registry !== 'object' || Array.isArray(registry)) continue;
                const names = Array.isArray(registry.names)
                    ? registry.names.map(item => sanitizePeriodName(item)).filter(Boolean)
                    : [];
                const activePeriod = sanitizePeriodName(registry.activePeriod);
                const defaultPeriod = sanitizePeriodName(registry.defaultPeriod);
                return {
                    names: [...new Set(names)],
                    activePeriod: activePeriod || '',
                    defaultPeriod: defaultPeriod || ''
                };
            } catch(e) {}
        }
        return {};
    }

    const savedPeriodRegistry = readLocalPeriodRegistry();
    let supabaseClient = null;
    let supabaseSession = null;
    let currentUser = null;
    let isAdmin = false;
    const DEFAULT_SUPERADMIN_EMAIL = 'spv.ga@garudamart.com';

    function resolveActivePeriodPreference() {
        const storedActivePeriod = resolveStoredPeriod(localStorage.getItem('smartbara_active_period'));
        if (storedActivePeriod) return storedActivePeriod;
        const storedDefaultPeriod = resolveStoredPeriod(localStorage.getItem('smartbara_default_period') || savedPeriodRegistry.defaultPeriod || window.SMART_BARA_CONFIG.DEFAULT_PERIOD);
        return storedDefaultPeriod || window.SMART_BARA_CONFIG.DEFAULT_PERIOD;
    }

    let activePeriod = resolveActivePeriodPreference();
    let availablePeriods = [];
    let availablePeriodsLoaded = false;
    let availablePeriodsLoadPromise = null;
    let authInitPromise = null;
    let databaseDept = {}; // { 'DEPT_NAME': [ { ...transactionRows } ] }
    let selectedDepartments = ['ALL']; // ['ALL'] = Gabungan Semua Departemen
    let cloudVersions = {}; // { 'period:key': timestamp }
    const realtimeListeners = [];
    const PENDING_CLOUD_WRITES_KEY = 'smartbara_pending_cloud_writes_v1';
    let pendingCloudFlush = null;
    let pendingCloudRetryTimer = null;
    const realtimePendingPayloads = new Map();
    let realtimeNotifyTimer = null;
    let realtimeChannel = null;
    let realtimeState = 'idle';
    let realtimeReconnectTimer = null;
    let realtimeNoticeTimer = null;
    let realtimeReconnectAttempt = 0;
    let realtimeNoticeShown = false;
    let realtimeLifecycleListenersBound = false;
    let isStoreLoading = false;
    const periodLoadPromises = new Map();
    const cloudLoadedPeriods = new Set();

    function normalizeDepartmentSelection(selection, fallback = ['ALL']) {
        if (!Array.isArray(selection)) return [...fallback];
        const next = [...new Set(selection
            .map(item => String(item ?? '').trim())
            .filter(Boolean))];
        if (!next.length) return [...fallback];
        const filtered = next.filter(item => item !== 'ALL');
        return next.includes('ALL') ? ['ALL'] : (filtered.length ? filtered : [...fallback]);
    }

    function isValidDepartmentStorePayload(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        if (Object.prototype.hasOwnProperty.call(value, 'warning')) return false;
        const keys = Object.keys(value);
        if (!keys.length) return false;
        return keys.every(key => String(key || '').trim().length > 0);
    }

    function getStoreCachePeriod(key) {
        const timestampPrefix = 'smartbara_store_updated_at_';
        const storePrefix = 'smartbara_store_';
        if (key.startsWith(timestampPrefix)) return key.slice(timestampPrefix.length);
        if (key.startsWith(storePrefix)) return key.slice(storePrefix.length);
        return '';
    }

    function getStoreCacheTimestamp(periodName) {
        return Number(localStorage.getItem(`smartbara_store_updated_at_${periodName}`) || 0) || 0;
    }

    function removeStoreCache(periodName) {
        localStorage.removeItem(`smartbara_store_${periodName}`);
        localStorage.removeItem(`smartbara_store_updated_at_${periodName}`);
    }

    function safeLocalStorageSet(key, value, options = {}) {
        const maxAttempts = options.maxAttempts || 2;
        const fallbackKeys = options.fallbackKeys || [];
        const largePayloadLimit = options.maxBytes || 900000;
        const payloadString = typeof value === 'string' ? value : JSON.stringify(value);
        const storePattern = /^smartbara_store_(?!updated_at_)/;
        const storePeriod = storePattern.test(key) ? getStoreCachePeriod(key) : '';

        resetStalePeriodStorage();

        const tryWrite = candidateValue => {
            try {
                localStorage.setItem(key, candidateValue);
                return true;
            } catch (error) {
                return false;
            }
        };

        const trySessionWrite = candidateValue => {
            try {
                sessionStorage.setItem(key, candidateValue);
                return true;
            } catch (error) {
                return false;
            }
        };

        const stageStoreInSession = () => {
            if (!storePeriod || !trySessionWrite(payloadString)) return false;
            removeStoreCache(storePeriod);
            return true;
        };

        if (payloadString && payloadString.length > largePayloadLimit && storePattern.test(key)) {
            if (stageStoreInSession()) return true;
        }

        if (tryWrite(value)) return true;
        if (payloadString && payloadString.length > largePayloadLimit && storePattern.test(key)) {
            if (stageStoreInSession()) return true;
        }

        const protectedPeriods = new Set([activePeriod, storePeriod].filter(Boolean));
        const oldStorePeriods = [...new Set(Object.keys(localStorage)
            .filter(item => item.startsWith('smartbara_store_') && !item.startsWith('smartbara_store_updated_at_'))
            .map(getStoreCachePeriod)
            .filter(periodName => periodName && !protectedPeriods.has(periodName)))
        ].sort((a, b) => getStoreCacheTimestamp(a) - getStoreCacheTimestamp(b));
        const candidates = [...fallbackKeys, ...oldStorePeriods.map(periodName => `smartbara_store_${periodName}`)];

        for (let index = 0; index < Math.min(candidates.length, 5); index++) {
            const candidateKey = candidates[index];
            if (!candidateKey) continue;
            try {
                const candidatePeriod = getStoreCachePeriod(candidateKey);
                if (candidatePeriod && candidateKey === `smartbara_store_${candidatePeriod}`) {
                    removeStoreCache(candidatePeriod);
                } else {
                    localStorage.removeItem(candidateKey);
                }
            } catch (error) {
                // ignored: stale cache cleanup is best-effort only
            }
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (tryWrite(value)) return true;
            if (stageStoreInSession()) return true;
        }

        return false;
    }

    // 1. Initialize Supabase Client
    function initSupabase() {
        if (supabaseClient) return supabaseClient;
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
            supabaseClient = window.supabase.createClient(
                window.SMART_BARA_CONFIG.SUPABASE_URL,
                window.SMART_BARA_CONFIG.SUPABASE_ANON_KEY
            );
            authInitPromise = initAuth();
            setupRealtimeSubscription();
            return supabaseClient;
        }
        return null;
    }

    async function init(options = {}) {
        const client = initSupabase();
        if (!client) return null;
        const pendingPeriod = sessionStorage.getItem('smartbara_period_transition');
        const loadingTask = window.SmartBaraLayout?.beginLoading(
            pendingPeriod ? 'Mengganti periode' : 'Menghubungkan Smart BARA',
            pendingPeriod ? `Menyinkronkan periode ${pendingPeriod}...` : 'Memeriksa sesi dan memuat data...'
        );
        let initSucceeded = false;

        try {
            await authInitPromise;
            window.SmartBaraLayout?.updateLoading(loadingTask, '', 'Sesi terverifikasi. Memuat daftar periode...', 30);
            if (!currentUser && !window.location.pathname.endsWith('/login.html')) {
                window.location.replace(new URL('login.html', window.location.href).href);
                return client;
            }
            await loadAvailablePeriods();
            window.SmartBaraLayout?.updateLoading(loadingTask, '', 'Daftar periode siap. Memuat data transaksi...', 56);
            const storedActivePeriod = resolveStoredPeriod(localStorage.getItem('smartbara_active_period'));
            const defaultPeriod = getDefaultPeriod();
            if (storedActivePeriod && storedActivePeriod !== activePeriod) {
                activePeriod = storedActivePeriod;
                localStorage.setItem('smartbara_active_period', storedActivePeriod);
                persistLocalPeriodRegistry();
            } else if (!storedActivePeriod && defaultPeriod && defaultPeriod !== activePeriod) {
                activePeriod = defaultPeriod;
                localStorage.setItem('smartbara_active_period', defaultPeriod);
                persistLocalPeriodRegistry();
            }
            if (currentUser) {
                applySessionDefaults();
            }
            if (!options.skipPeriodStore) {
                await loadPeriodStore(activePeriod, false, { showOverlay: false });
            }
            window.SmartBaraLayout?.updateLoading(loadingTask, '', 'Data periode siap.', 88);
            initSucceeded = true;
        } catch (e) {
            console.warn('Core init error:', e);
        } finally {
            window.SmartBaraLayout?.endLoading(loadingTask, initSucceeded);
        }

        return client;
    }

    function initAuthOnly() {
        return initSupabase();
    }

    // 2. Authentication & Session
    async function initAuth() {
        if (!supabaseClient) return;
        try {
            const { data } = await supabaseClient.auth.getSession();
            if (data?.session) {
                supabaseSession = data.session;
                currentUser = data.session.user;
                checkUserRole();
                dispatchCoreEvent('auth_change', { user: currentUser, isAdmin });
            } else {
                currentUser = null;
                isAdmin = false;
                dispatchCoreEvent('auth_change', { user: null, isAdmin: false });
            }
            supabaseClient.auth.onAuthStateChange((event, session) => {
                supabaseSession = session;
                currentUser = session?.user || null;
                checkUserRole();
                dispatchCoreEvent('auth_change', { user: currentUser, isAdmin });
            });
        } catch(e) {
            console.warn('Auth initialization error:', e);
        }
    }

    function checkUserRole() {
        if (!currentUser) {
            isAdmin = false;
            return;
        }
        isAdmin = getAccessLevel(currentUser) === 'superadmin';
    }

    function inferDefaultDepartmentSelection(user = currentUser) {
        const email = String(user?.email || '').trim().toLowerCase();
        const knownDepartments = ['GA', 'IT', 'LEGAL', 'HR', 'FINANCE', 'HSE', 'LOGISTIK', 'OPERASIONAL', 'PRODUKSI', 'SHE', 'TAMBANG', 'SHIPPING', 'UMUM'];
        // Cocokkan per kata di bagian sebelum @: substring membuat semua email @garudamart.com
        // (mengandung "ga") atau nama berisi "it"/"hr" otomatis terkunci ke satu departemen.
        const emailTokens = email.split('@')[0].split(/[^a-z0-9]+/).filter(Boolean);
        const match = knownDepartments.find(dept => emailTokens.includes(dept.toLowerCase()));
        if (match) return [match];

        const metadataDept = String(user?.app_metadata?.department || user?.user_metadata?.department || '').trim();
        if (metadataDept) return [String(metadataDept).trim().toUpperCase()];

        return ['ALL'];
    }

    function applySessionDefaults() {
        const storedActivePeriod = resolveStoredPeriod(localStorage.getItem('smartbara_active_period'));
        const defaultPeriod = getDefaultPeriod();
        if (storedActivePeriod) {
            activePeriod = storedActivePeriod;
            localStorage.setItem('smartbara_active_period', storedActivePeriod);
        } else if (defaultPeriod && defaultPeriod !== activePeriod) {
            activePeriod = defaultPeriod;
            localStorage.setItem('smartbara_active_period', defaultPeriod);
        }
        persistLocalPeriodRegistry();

        const selectionKey = `smartbara_selected_depts_${activePeriod}`;
        let storedSelection = null;
        try {
            const parsed = JSON.parse(localStorage.getItem(selectionKey) || 'null');
            if (Array.isArray(parsed) && parsed.length) storedSelection = normalizeDepartmentSelection(parsed);
        } catch (error) {}

        if (storedSelection) {
            selectedDepartments = storedSelection;
        } else {
            const userSelection = inferDefaultDepartmentSelection();
            selectedDepartments = Array.isArray(userSelection) && userSelection.length ? userSelection : ['ALL'];
            safeLocalStorageSet(selectionKey, JSON.stringify(selectedDepartments));
        }
        dispatchCoreEvent('dept_filter_change', {
            selectedDepartments: getSelectedDepartments(),
            isCombined: isCombinedDepartments()
        });
        return { period: activePeriod, departments: selectedDepartments };
    }

    function getAccessLevel(user = currentUser) {
        if (!user) return 'viewer';
        if (String(user.email || '').trim().toLowerCase() === DEFAULT_SUPERADMIN_EMAIL) return 'superadmin';
        const role = String(user.app_metadata?.role || '').trim().toLowerCase();
        if (role === 'superadmin' || role === 'admin') return 'superadmin';
        if (role === 'spv') return 'spv';
        if (role === 'tim' || role === 'editor') return 'tim';
        return 'viewer';
    }

    function canDeleteData() {
        return Boolean(currentUser && ['superadmin', 'spv'].includes(getAccessLevel()));
    }

    function canWriteData() {
        return Boolean(currentUser && ['superadmin', 'spv', 'tim'].includes(getAccessLevel()));
    }

    function canManageSettings() {
        return Boolean(currentUser && getAccessLevel() === 'superadmin');
    }

    function canApproveAllDepartments(user = currentUser) {
        return Boolean(user && getAccessLevel(user) === 'superadmin');
    }

    function getApprovalState(periodName = activePeriod) {
        try {
            const raw = localStorage.getItem(`smartbara_approval_state_${periodName}`);
            return raw ? JSON.parse(raw) : { status: 'pending', scope: 'ALL', approver: '', approved_at: '', approval_level: 'superadmin' };
        } catch (error) {
            return { status: 'pending', scope: 'ALL', approver: '', approved_at: '', approval_level: 'superadmin' };
        }
    }

    function setApprovalState(periodName = activePeriod, nextState = {}) {
        const currentState = getApprovalState(periodName);
        const normalizedStatus = String(nextState.status || currentState.status || 'pending').toLowerCase();
        const finalState = {
            ...currentState,
            ...nextState,
            scope: 'ALL',
            approval_level: 'superadmin',
            status: normalizedStatus === 'approved' ? 'approved' : normalizedStatus === 'rejected' ? 'rejected' : 'pending',
            approved_by: nextState.approved_by || currentState.approved_by || '',
            approved_at: nextState.approved_at || currentState.approved_at || '',
            updated_at: new Date().toISOString()
        };

        localStorage.setItem(`smartbara_approval_state_${periodName}`, JSON.stringify(finalState));

        if (['approved', 'rejected'].includes(finalState.status)) {
            try {
                const historyKey = 'smartbara_approval_history';
                const currentHistory = JSON.parse(localStorage.getItem(historyKey) || '[]');
                const entry = {
                    id: `${periodName}-${finalState.approved_by || 'superadmin'}-${Date.now()}`,
                    period_name: periodName,
                    department_scope: 'ALL',
                    approval_level: 'superadmin',
                    status: finalState.status,
                    approver: finalState.approved_by || currentUser?.email || 'superadmin',
                    approved_by: finalState.approved_by || currentUser?.email || 'superadmin',
                    approved_at: finalState.approved_at || new Date().toISOString(),
                    action: nextState.action || (finalState.status === 'approved' ? 'manual_approve' : 'manual_reject'),
                    departments: Array.isArray(nextState.departments) ? nextState.departments : ['ALL'],
                    scope: 'ALL',
                    updated_at: new Date().toISOString()
                };
                const nextHistory = [entry, ...Array.isArray(currentHistory) ? currentHistory : []].slice(0, 100);
                localStorage.setItem(historyKey, JSON.stringify(nextHistory));
            } catch (error) {
                console.warn('Approval history save error:', error);
            }
        }

        return finalState;
    }

    function getApprovalHistory(limit = 10) {
        try {
            const history = JSON.parse(localStorage.getItem('smartbara_approval_history') || '[]');
            return Array.isArray(history) ? history.slice(0, limit) : [];
        } catch (error) {
            return [];
        }
    }

    function requireApprovalDecision(periodName = activePeriod, context = {}) {
        if (!canApproveAllDepartments()) {
            throw new Error('Hanya akun Superadmin yang dapat menyetujui perubahan data. Semua Superadmin dapat approve semua departemen.');
        }
        const approver = currentUser?.email || 'superadmin';
        const state = setApprovalState(periodName, {
            status: 'approved',
            scope: 'ALL',
            approver,
            approved_by: approver,
            approved_at: new Date().toISOString(),
            department_scope: 'ALL',
            approval_level: 'superadmin',
            ...context
        });
        return state;
    }

    function rejectApprovalDecision(periodName = activePeriod, context = {}) {
        if (!canApproveAllDepartments()) {
            throw new Error('Hanya akun Superadmin yang dapat menolak perubahan data. Semua Superadmin dapat menolak semua departemen.');
        }
        const approver = currentUser?.email || 'superadmin';
        const state = setApprovalState(periodName, {
            status: 'rejected',
            scope: 'ALL',
            approver,
            approved_by: approver,
            approved_at: new Date().toISOString(),
            department_scope: 'ALL',
            approval_level: 'superadmin',
            ...context
        });
        return state;
    }

    function requireAccess(permission) {
        const allowed = permission === 'settings'
            ? canManageSettings()
            : permission === 'delete'
                ? canDeleteData()
                : canWriteData();
        if (!allowed) throw new Error('Akses ditolak untuk level akses akun ini.');
    }

    async function login(email, password) {
        if (!supabaseClient) throw new Error('Supabase belum terhubung.');
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: isMember, error: memberError } = await supabaseClient.rpc('smartbara_is_member');
        if (memberError || isMember !== true) {
            await supabaseClient.auth.signOut({ scope: 'local' });
            throw new Error(memberError ? 'Gagal memeriksa akses Smart BARA. Coba lagi.' : 'Akun ini tidak terdaftar di Smart BARA.');
        }
        supabaseSession = data.session;
        currentUser = data.user;
        checkUserRole();
        const preferredPeriod = sanitizePeriodName(localStorage.getItem('smartbara_active_period') || savedPeriodRegistry.activePeriod) || getDefaultPeriod();
        if (preferredPeriod && preferredPeriod !== activePeriod) {
            setPeriod(preferredPeriod);
        }
        await loadAvailablePeriods();
        await loadPeriodStore(activePeriod, true, { showOverlay: false });
        applySessionDefaults();
        dispatchCoreEvent('auth_change', { user: currentUser, isAdmin });
        return data;
    }

    async function verifyCurrentPassword(password) {
        if (!supabaseClient || !currentUser?.email) throw new Error('Sesi akun tidak tersedia untuk verifikasi password.');
        if (!String(password || '').trim()) throw new Error('Password wajib diisi.');
        const userId = currentUser.id;
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email: currentUser.email, password });
        if (error) throw new Error('Password akun tidak valid.');
        if (data.user?.id !== userId) throw new Error('Akun yang diverifikasi tidak cocok dengan sesi aktif.');
        supabaseSession = data.session;
        currentUser = data.user;
        checkUserRole();
        return true;
    }

    async function signUp(email, password) {
        if (!supabaseClient) throw new Error('Supabase belum terhubung.');
        return supabaseClient.auth.signUp({ email, password });
    }

    async function requestPasswordReset(email) {
        if (!supabaseClient) throw new Error('Supabase belum terhubung.');
        const redirectTo = new URL('login.html?mode=recovery', window.location.href).href;
        return supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    }

    async function updatePassword(password) {
        if (!supabaseClient) throw new Error('Supabase belum terhubung.');
        return supabaseClient.auth.updateUser({ password });
    }

    async function logout() {
        if (supabaseClient) {
            await supabaseClient.auth.signOut();
        }
        supabaseSession = null;
        currentUser = null;
        isAdmin = false;
        const preferredPeriod = sanitizePeriodName(localStorage.getItem('smartbara_active_period') || savedPeriodRegistry.activePeriod) || getDefaultPeriod();
        if (preferredPeriod && preferredPeriod !== activePeriod) {
            setPeriod(preferredPeriod);
        }
        selectedDepartments = ['ALL'];
        safeLocalStorageSet(`smartbara_selected_depts_${activePeriod}`, JSON.stringify(selectedDepartments));
        dispatchCoreEvent('dept_filter_change', {
            selectedDepartments: getSelectedDepartments(),
            isCombined: isCombinedDepartments()
        });
        dispatchCoreEvent('auth_change', { user: null, isAdmin: false });
    }

    function canWriteCloud() {
        return Boolean(supabaseClient && canWriteData());
    }

    function readPendingCloudWrites() {
        try {
            const queue = JSON.parse(localStorage.getItem(PENDING_CLOUD_WRITES_KEY) || '[]');
            return Array.isArray(queue) ? queue : [];
        } catch (error) {
            return [];
        }
    }

    function writePendingCloudWrites(queue) {
        try {
            if (queue.length) localStorage.setItem(PENDING_CLOUD_WRITES_KEY, JSON.stringify(queue));
            else localStorage.removeItem(PENDING_CLOUD_WRITES_KEY);
            return true;
        } catch (error) {
            showSyncStatus('Antrean sinkronisasi tidak dapat disimpan di browser.', 'error');
            return false;
        }
    }

    function getPendingCloudWriteKey(job) {
        const ownerId = job.ownerId || currentUser?.id || 'anonymous';
        if (job.type === 'department-store') return `${ownerId}:${job.type}:${job.periodName}:${job.deptName}`;
        if (job.type === 'bulk-upsert') return `${ownerId}:${job.type}:${job.tableName}:${job.queueKey}`;
        return `${ownerId}:${job.tableName}:${job.periodName}:${job.versionKey}`;
    }

    function isRetryableCloudError(error) {
        return Boolean(error?.retryable || !navigator.onLine || error instanceof TypeError || /network|fetch|timeout|temporar|offline|connection|gateway|\b50[234]\b/i.test(error?.message || ''));
    }

    function enqueueCloudWrite(job, error) {
        if (!canWriteData()) return false;
        const queue = readPendingCloudWrites();
        const queueKey = getPendingCloudWriteKey(job);
        const existing = queue.find(item => item.queueKey === queueKey);
        const entry = {
            ...job,
            ownerId: currentUser?.id || 'anonymous',
            queueKey,
            attempts: existing?.attempts || 0,
            queuedAt: existing?.queuedAt || new Date().toISOString(),
            lastError: error?.message || 'Cloud tidak dapat dijangkau.'
        };
        const nextQueue = [...queue.filter(item => item.queueKey !== queueKey), entry];
        if (!writePendingCloudWrites(nextQueue)) return false;
        showSyncStatus(`${job.label || 'Perubahan'} menunggu sinkronisasi cloud (${nextQueue.length}).`, 'info');
        if (navigator.onLine) schedulePendingCloudRetry();
        return true;
    }

    function removePendingCloudWrite(job) {
        const queueKey = getPendingCloudWriteKey(job);
        const queue = readPendingCloudWrites();
        const nextQueue = queue.filter(item => item.queueKey !== queueKey);
        if (nextQueue.length !== queue.length) writePendingCloudWrites(nextQueue);
    }

    function schedulePendingCloudRetry() {
        if (pendingCloudRetryTimer) clearTimeout(pendingCloudRetryTimer);
        pendingCloudRetryTimer = setTimeout(() => {
            pendingCloudRetryTimer = null;
            flushPendingCloudWrites();
        }, 15000);
    }

    async function flushPendingCloudWrites() {
        if (pendingCloudFlush) return pendingCloudFlush;
        if (!canWriteCloud() || !navigator.onLine) return false;
        const ownerId = currentUser?.id || 'anonymous';
        const queuedWrites = readPendingCloudWrites().filter(job => job.ownerId === ownerId);
        if (!queuedWrites.length) return true;

        pendingCloudFlush = (async () => {
            let syncedCount = 0;
            for (const job of queuedWrites) {
                try {
                    if (job.type === 'row-upsert') {
                        await syncVersionedRow(job.tableName, job.periodName, job.filters, job.values, job.versionKey, job.label, { queueOnFailure: false });
                    } else if (job.type === 'row-delete') {
                        await deleteVersionedRow(job.tableName, job.periodName, job.filters, job.versionKey, job.label, { queueOnFailure: false });
                    } else if (job.type === 'bulk-upsert') {
                        await syncCloudUpsert(job.tableName, job.rows, job.conflictColumns, job.queueKey, job.label, { queueOnFailure: false });
                    } else if (job.type === 'department-store') {
                        await writeDepartmentStoreToCloud(job.periodName, job.deptName, job.rows);
                        removePendingCloudWrite(job);
                    }
                    syncedCount++;
                } catch (error) {
                    const queue = readPendingCloudWrites();
                    const updatedQueue = queue.map(item => item.queueKey === job.queueKey
                        ? { ...item, attempts: (item.attempts || 0) + 1, lastError: error.message || String(error) }
                        : item);
                    writePendingCloudWrites(updatedQueue);
                    if (isRetryableCloudError(error)) schedulePendingCloudRetry();
                    else showSyncStatus(`Sinkronisasi tertahan: ${error.message || error}`, 'error');
                    break;
                }
            }
            const remaining = readPendingCloudWrites().filter(job => job.ownerId === ownerId).length;
            if (syncedCount && !remaining) showSyncStatus(`${syncedCount} perubahan berhasil disinkronkan ke cloud.`, 'success');
            else if (remaining) showSyncStatus(`${remaining} perubahan masih menunggu cloud.`, 'info');
            return remaining === 0;
        })();

        try {
            return await pendingCloudFlush;
        } finally {
            pendingCloudFlush = null;
        }
    }

    function scheduleRealtimeNotice() {
        if (realtimeNoticeTimer || realtimeNoticeShown) return;
        realtimeNoticeTimer = setTimeout(() => {
            realtimeNoticeTimer = null;
            if (realtimeState !== 'disconnected' || !navigator.onLine || document.visibilityState !== 'visible') return;
            realtimeNoticeShown = true;
            showSyncStatus('Koneksi realtime sedang dipulihkan otomatis. Perubahan tetap tersimpan ke cloud.', 'info');
        }, 30000);
    }

    function scheduleRealtimeReconnect() {
        if (realtimeReconnectTimer || !navigator.onLine || document.visibilityState === 'hidden') return;
        const delay = Math.min(30000, 1000 * (2 ** Math.min(realtimeReconnectAttempt, 5))) + Math.floor(Math.random() * 500);
        realtimeReconnectAttempt++;
        realtimeReconnectTimer = setTimeout(() => {
            realtimeReconnectTimer = null;
            setupRealtimeSubscription(true);
        }, delay);
    }

    function markRealtimeDisconnected() {
        realtimeState = 'disconnected';
        scheduleRealtimeNotice();
        scheduleRealtimeReconnect();
    }

    function bindRealtimeLifecycleListeners() {
        if (realtimeLifecycleListenersBound) return;
        realtimeLifecycleListenersBound = true;
        window.addEventListener('online', () => {
            if (realtimeState !== 'connected') markRealtimeDisconnected();
            setupRealtimeSubscription(true);
            flushPendingCloudWrites();
        });
        window.addEventListener('offline', () => {
            if (realtimeState !== 'connected') markRealtimeDisconnected();
        });
        window.addEventListener('focus', () => {
            if (document.visibilityState !== 'visible') return;
            if (realtimeState !== 'connected') setupRealtimeSubscription(true);
            flushPendingCloudWrites();
        });
        window.addEventListener('pagehide', () => {
            if (realtimeReconnectTimer) {
                clearTimeout(realtimeReconnectTimer);
                realtimeReconnectTimer = null;
            }
            if (realtimeNoticeTimer) {
                clearTimeout(realtimeNoticeTimer);
                realtimeNoticeTimer = null;
            }
            const staleChannel = realtimeChannel;
            realtimeChannel = null;
            realtimeState = 'idle';
            if (staleChannel && supabaseClient) {
                supabaseClient.removeChannel(staleChannel).catch(() => {});
            }
        });
        window.addEventListener('pageshow', event => {
            if (event.persisted && supabaseClient) setupRealtimeSubscription(true);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            setupRealtimeSubscription(true);
            flushPendingCloudWrites();
        });
        window.addEventListener('smartbara:auth_change', () => {
            if (currentUser && realtimeState !== 'connected') setupRealtimeSubscription(true);
            flushPendingCloudWrites();
        });
    }

    // 3. Realtime Subscription (Multi-user safe)
    function setupRealtimeSubscription(forceReconnect = false) {
        if (!supabaseClient || !navigator.onLine || document.visibilityState === 'hidden') return;
        if (realtimeChannel && realtimeState === 'connecting') return;
        if (realtimeChannel && !forceReconnect && realtimeState === 'connected') return;
        bindRealtimeLifecycleListeners();

        const wasDisconnected = realtimeState === 'disconnected';
        if (realtimeReconnectTimer) {
            clearTimeout(realtimeReconnectTimer);
            realtimeReconnectTimer = null;
        }
        if (realtimeChannel) {
            const staleChannel = realtimeChannel;
            realtimeChannel = null;
            supabaseClient.removeChannel(staleChannel).catch(() => {});
        }

        realtimeState = 'connecting';
        try {
            const channel = supabaseClient.channel('smartbara_realtime_sync')
                .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
                    notifyRealtime(payload);
                });
            realtimeChannel = channel;
            channel.subscribe(status => {
                if (realtimeChannel !== channel) return;
                if (status === 'SUBSCRIBED') {
                    realtimeState = 'connected';
                    realtimeReconnectAttempt = 0;
                    if (realtimeNoticeTimer) {
                        clearTimeout(realtimeNoticeTimer);
                        realtimeNoticeTimer = null;
                    }
                    if (wasDisconnected && realtimeNoticeShown) showSyncStatus('Koneksi realtime pulih.', 'info');
                    realtimeNoticeShown = false;
                    flushPendingCloudWrites();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    markRealtimeDisconnected();
                }
            });
        } catch(error) {
            console.warn('Realtime channel error:', error);
            markRealtimeDisconnected();
        }
    }

    function onRealtimeChange(callback) {
        if (typeof callback === 'function') realtimeListeners.push(callback);
    }

    function notifyRealtime(payload) {
        // Project GOA dipakai bersama; abaikan event tabel aplikasi lain.
        if (!/^(smartbara_|smart_asset_)/.test(String(payload.table || ''))) return;
        realtimePendingPayloads.set(payload.table, payload);
        if (realtimeNotifyTimer) return;
        realtimeNotifyTimer = setTimeout(() => {
            const pendingPayloads = [...realtimePendingPayloads.values()];
            realtimePendingPayloads.clear();
            realtimeNotifyTimer = null;
            pendingPayloads.forEach(change => {
                realtimeListeners.forEach(fn => {
                    try { fn(change); } catch(e) {}
                });
            });
            showSyncStatus(`${pendingPayloads.length} tabel diperbarui dari cloud.`, 'info');
        }, 250);
    }

    // 4. Central Store & Multi-Department Data Engine
    function resolveLatestStoredPeriod() {
        const candidates = [];
        const allKeys = new Set([...Object.keys(localStorage), ...Object.keys(sessionStorage)]);

        allKeys.forEach(key => {
            if (!key.startsWith('smartbara_store_') || key.includes('_updated_at')) return;
            const periodName = key.replace('smartbara_store_', '');
            const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
            if (!raw) return;
            try {
                const parsed = JSON.parse(raw);
                const hasData = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && isValidDepartmentStorePayload(parsed);
                if (hasData) {
                    const timestamp = Number(localStorage.getItem(`smartbara_store_updated_at_${periodName}`) ?? sessionStorage.getItem(`smartbara_store_updated_at_${periodName}`) ?? 0);
                    candidates.push({ periodName, timestamp });
                }
            } catch (error) {
                // ignore malformed cached data
            }
        });

        if (!candidates.length) return null;
        candidates.sort((left, right) => right.timestamp - left.timestamp);
        return candidates[0].periodName;
    }

    async function loadPeriodStore(periodName = activePeriod, forceReload = false, options = {}) {
        const localCache = localStorage.getItem(`smartbara_store_${periodName}`) ?? sessionStorage.getItem(`smartbara_store_${periodName}`);
        const cacheTimestamp = Number(localStorage.getItem(`smartbara_store_updated_at_${periodName}`) ?? sessionStorage.getItem(`smartbara_store_updated_at_${periodName}`) ?? 0);
        const hasFreshCache = Boolean(localCache) && Number.isFinite(cacheTimestamp) && Date.now() - cacheTimestamp < 60000;
        if (!localCache) databaseDept = {};
        const isExplicitManualSelection = Boolean(periodName) && (availablePeriods.includes(periodName) || sanitizePeriodName(periodName) === sanitizePeriodName(activePeriod));
        // Jangan pernah mengganti periode yang diminta dengan periode lain yang memiliki data;
        // periode baru/kosong harus tetap kosong, bukan "bocor" data periode lain.
        if (localCache) {
            try {
                const cachedDepartments = JSON.parse(localCache);
                if (cachedDepartments && typeof cachedDepartments === 'object' && !Array.isArray(cachedDepartments) && isValidDepartmentStorePayload(cachedDepartments)) {
                    databaseDept = cachedDepartments;
                } else {
                    localStorage.removeItem(`smartbara_store_${periodName}`);
                    localStorage.removeItem(`smartbara_store_updated_at_${periodName}`);
                    databaseDept = {};
                }
            } catch(e) {
                localStorage.removeItem(`smartbara_store_${periodName}`);
                localStorage.removeItem(`smartbara_store_updated_at_${periodName}`);
                databaseDept = {};
            }
        } else {
            databaseDept = {};
        }

        const savedDepts = localStorage.getItem(`smartbara_selected_depts_${periodName}`);
        if (savedDepts) {
            try {
                const parsed = JSON.parse(savedDepts);
                selectedDepartments = normalizeDepartmentSelection(parsed);
            } catch(e) {
                selectedDepartments = ['ALL'];
            }
        }

        if (!Object.keys(databaseDept).length) {
            if (!Array.isArray(selectedDepartments) || !selectedDepartments.length) {
                selectedDepartments = ['ALL'];
            }
        } else if (!Array.isArray(selectedDepartments) || !selectedDepartments.length) {
            selectedDepartments = ['ALL'];
        } else if (!selectedDepartments.includes('ALL')) {
            // 'ALL' tetap disimpan apa adanya: mengubahnya jadi daftar dept dari cache
            // membuat dept baru dari cloud tidak ikut terpilih di mode Gabungan.
            const valid = selectedDepartments.filter(dept => Object.keys(databaseDept).includes(String(dept)) || Object.keys(databaseDept).map(item => String(item).toUpperCase()).includes(String(dept).toUpperCase()));
            selectedDepartments = valid.length ? valid : ['ALL'];
        }

        dispatchCoreEvent('store_loaded', { period: periodName, databaseDept });

        if (periodLoadPromises.has(periodName)) return periodLoadPromises.get(periodName);
        if (hasFreshCache && !forceReload) {
            return databaseDept;
        }
        if (cloudLoadedPeriods.has(periodName) && !forceReload && Object.keys(databaseDept || {}).length > 0) return databaseDept;

        const loadPromise = (async () => {
            const loadingTask = options.showOverlay === false ? null : window.SmartBaraLayout?.beginLoading('Memuat data periode', `Sinkronisasi periode ${periodName}...`);
            isStoreLoading = true;
            let loadSucceeded = false;
            showSyncStatus('Menyinkronkan data database...', 'info');
            try {
                if (supabaseClient) {
                    const { data: storeRows, error } = await supabaseClient
                        .from('smartbara_store')
                        .select('*')
                        .eq('period_name', periodName);

                    if (error) throw error;
                    if (Array.isArray(storeRows) && storeRows.length > 0) {
                        databaseDept = {};
                        storeRows.forEach(row => {
                            const dName = (row.dept_name || row.department || 'UMUM').toUpperCase();
                            const items = Array.isArray(row.row_data)
                                ? row.row_data
                                : Array.isArray(row.rows_data)
                                    ? row.rows_data
                                    : Array.isArray(row.dept_data)
                                        ? row.dept_data
                                        : [];

                            items.forEach(it => {
                                if (!it.dept && !it._department) it.dept = dName;
                            });
                            databaseDept[dName] = items;
                            cloudVersions[`${periodName}:${dName}`] = row.updated_at;
                        });
                        safeLocalStorageSet(`smartbara_store_${periodName}`, JSON.stringify(databaseDept));
                        safeLocalStorageSet(`smartbara_store_updated_at_${periodName}`, String(Date.now()));
                        showSyncStatus(`Terhubung: ${storeRows.length} departemen dimuat`, 'success');
                    } else {
                        if (!localCache) databaseDept = {};
                        showSyncStatus('Periode aktif belum memiliki data transaksi.', 'info');
                    }
                    cloudLoadedPeriods.add(periodName);
                }

                dispatchCoreEvent('store_loaded', { period: periodName, databaseDept });
                loadSucceeded = true;
                return databaseDept;
            } catch(err) {
                console.error('Error loading period store:', err);
                showSyncStatus('Gagal membaca data dari Supabase: ' + err.message, 'error');
                dispatchCoreEvent('store_loaded', { period: periodName, databaseDept });
                if (options.throwOnError) throw err;
                return databaseDept;
            } finally {
                isStoreLoading = false;
                if (loadingTask) window.SmartBaraLayout?.endLoading(loadingTask, loadSucceeded);
            }
        })();

        periodLoadPromises.set(periodName, loadPromise);
        try {
            return await loadPromise;
        } finally {
            if (periodLoadPromises.get(periodName) === loadPromise) periodLoadPromises.delete(periodName);
        }
    }

    function getDepartments() {
        return Object.keys(databaseDept || {}).sort();
    }

    function resetStalePeriodStorage() {
        const storeKeys = Object.keys(localStorage).filter(key =>
            key.startsWith('smartbara_store_') && !key.startsWith('smartbara_store_updated_at_')
        );
        for (const key of storeKeys) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) {
                    removeStoreCache(getStoreCachePeriod(key));
                    continue;
                }
                const parsed = JSON.parse(raw);
                if (!isValidDepartmentStorePayload(parsed)) {
                    removeStoreCache(getStoreCachePeriod(key));
                }
            } catch (error) {
                removeStoreCache(getStoreCachePeriod(key));
            }
        }

        const allStorePeriods = [...new Set(Object.keys(localStorage)
            .filter(key => key.startsWith('smartbara_store_') && !key.startsWith('smartbara_store_updated_at_'))
            .map(getStoreCachePeriod)
            .filter(Boolean))];
        const orderedPeriods = allStorePeriods.sort((a, b) => getStoreCacheTimestamp(b) - getStoreCacheTimestamp(a));
        const keepPeriods = new Set(orderedPeriods.slice(0, 6));
        if (allStorePeriods.includes(activePeriod)) keepPeriods.add(activePeriod);

        allStorePeriods.forEach(periodName => {
            if (!keepPeriods.has(periodName)) removeStoreCache(periodName);
        });

        Object.keys(localStorage)
            .filter(key => key.startsWith('smartbara_store_updated_at_'))
            .forEach(key => {
                const periodName = getStoreCachePeriod(key);
                if (!localStorage.getItem(`smartbara_store_${periodName}`)) localStorage.removeItem(key);
            });
    }

    function getSelectedDepartments() {
        const allDepts = getDepartments();
        if (!Array.isArray(selectedDepartments) || !selectedDepartments.length) return allDepts.length ? [...allDepts] : ['ALL'];
        const activeSelection = selectedDepartments.map(item => String(item).trim()).filter(Boolean);
        if (activeSelection.includes('ALL')) return allDepts.length ? [...allDepts] : ['ALL'];
        if (allDepts.length === 0) return activeSelection.length ? activeSelection : ['ALL'];
        const valid = activeSelection.filter(d => allDepts.includes(String(d)) || allDepts.map(item => String(item).toUpperCase()).includes(String(d).toUpperCase()));
        return valid.length ? valid : [...allDepts];
    }

    function isCombinedDepartments() {
        const allDepts = getDepartments();
        if (!Array.isArray(selectedDepartments) || !selectedDepartments.length) return true;
        if (selectedDepartments.includes('ALL')) return true;
        if (allDepts.length === 0) return false;
        const selected = new Set(selectedDepartments.map(dept => String(dept).toUpperCase()));
        const knownDepts = allDepts.map(dept => String(dept).toUpperCase());
        // Pilihan yang tidak ada di periode ini jatuh ke semua dept (lihat getSelectedDepartments),
        // jadi harus dianggap Gabungan agar baris dept tanpa transaksi tidak ikut tersaring.
        if (!knownDepts.some(dept => selected.has(dept))) return true;
        return knownDepts.every(dept => selected.has(dept));
    }

    function setSelectedDepartments(deptArray) {
        selectedDepartments = normalizeDepartmentSelection(deptArray);
        safeLocalStorageSet(`smartbara_selected_depts_${activePeriod}`, JSON.stringify(selectedDepartments));
        dispatchCoreEvent('dept_filter_change', {
            selectedDepartments: getSelectedDepartments(),
            isCombined: isCombinedDepartments()
        });
    }

    function getTransactions(periodName = activePeriod) {
        const selected = getSelectedDepartments();
        const results = [];
        selected.forEach(d => {
            const rows = databaseDept[d] || [];
            rows.forEach(r => {
                results.push({
                    ...r,
                    dept: r.dept || r._department || d
                });
            });
        });
        return results;
    }

    function getAllTransactions() {
        const selected = new Set(getSelectedDepartments().map(department => String(department).toUpperCase()));
        return Object.entries(databaseDept)
            .filter(([department]) => selected.has(String(department).toUpperCase()))
            .flatMap(([department, rows]) =>
            (Array.isArray(rows) ? rows : []).map(row => ({
                ...row,
                dept: row.dept || row._department || department
            }))
            );
    }

    function getDepartmentStore() {
        try {
            return JSON.parse(JSON.stringify(databaseDept || {}));
        } catch (error) {
            const snapshot = {};
            Object.entries(databaseDept || {}).forEach(([dept, rows]) => {
                snapshot[dept] = Array.isArray(rows) ? [...rows] : rows;
            });
            return snapshot;
        }
    }

    function createTransactionId(transaction, department, occurrence = 1) {
        const identity = [
            String(department || '').toUpperCase(),
            transaction.nama_akun || transaction.akun,
            transaction.proyek,
            transaction.no_sumber,
            transaction.keterangan
        ].map(value => String(value || '').trim().toLowerCase()).join('|');
        let hash = 2166136261;
        for (let charIndex = 0; charIndex < identity.length; charIndex++) {
            hash ^= identity.charCodeAt(charIndex);
            hash = Math.imul(hash, 16777619);
        }
        return `TRX-${(hash >>> 0).toString(36).toUpperCase()}-${occurrence}`;
    }

    async function writeDepartmentStoreToCloud(periodName, normalizedDept, rows) {
        if (!supabaseClient) {
            const error = new Error('Cloud belum siap. Data transaksi menunggu koneksi.');
            error.retryable = true;
            throw error;
        }
        const payload = {
            period_name: periodName,
            dept_name: normalizedDept,
            row_data: rows,
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabaseClient
            .from('smartbara_store')
            .upsert(payload, { onConflict: 'period_name,dept_name' })
            .select('*')
            .maybeSingle();
        if (error) throw error;
        if (data?.updated_at) cloudVersions[`${periodName}:${normalizedDept}`] = data.updated_at;
        removePendingCloudWrite({ type: 'department-store', periodName, deptName: normalizedDept });
        dispatchCoreEvent('store_updated', { period: periodName, dept: normalizedDept, count: rows.length });
        return data;
    }

    async function saveDepartmentStore(periodName, deptName, rows) {
        if (!deptName || !Array.isArray(rows)) return;
        requireAccess('write');
        const normalizedDept = deptName.trim().toUpperCase();

        databaseDept[normalizedDept] = rows;
        safeLocalStorageSet(`smartbara_store_${periodName}`, JSON.stringify(databaseDept));
        safeLocalStorageSet(`smartbara_store_updated_at_${periodName}`, String(Date.now()));

        try {
            await writeDepartmentStoreToCloud(periodName, normalizedDept, rows);
        } catch (error) {
            if (isRetryableCloudError(error)) {
                error.queuedForSync = enqueueCloudWrite({ type: 'department-store', periodName, deptName: normalizedDept, rows, label: `Transaksi ${normalizedDept}` }, error);
            }
            console.error('Save department store cloud error:', error);
            throw error;
        }
    }

    function mapBudgetCloudValues(tableName, values) {
        if (!['smartbara_budget', 'smartbara_budget_site'].includes(tableName)) return values;
        const mapped = { ...values };
        const accountFields = ['nama', 'nama_akun', 'account_name'];
        const projectFields = ['nama', 'nama_proyek', 'nama_proyek_up', 'project_name'];
        const nameFields = tableName === 'smartbara_budget_site' ? projectFields : accountFields;
        const departmentFields = ['dept', 'departemen', 'department'];
        const nameField = nameFields.find(field => Object.prototype.hasOwnProperty.call(mapped, field));
        const departmentField = departmentFields.find(field => Object.prototype.hasOwnProperty.call(mapped, field));

        if (nameField) {
            const name = mapped[nameField];
            nameFields.forEach(field => delete mapped[field]);
            mapped[tableName === 'smartbara_budget_site' ? 'nama_proyek_up' : 'nama_akun'] = name;
        }
        if (departmentField) {
            const department = mapped[departmentField];
            departmentFields.forEach(field => delete mapped[field]);
            mapped.departemen = department;
        }
        return mapped;
    }

    // 5. Concurrency-Safe Versioned Row Sync
    async function syncVersionedRow(tableName, periodName, filters, values, versionKey, label, options = {}) {
        requireAccess('write');
        if (!periodName) throw new Error('Periode penyimpanan tidak tersedia.');
        const cloudValues = mapBudgetCloudValues(tableName, values);
        const job = { type: 'row-upsert', tableName, periodName, filters, values: cloudValues, versionKey, label };
        const cacheKey = `${periodName}:${versionKey}`;
        try {
            if (!supabaseClient) {
                const error = new Error('Cloud belum siap. Perubahan menunggu koneksi.');
                error.retryable = true;
                throw error;
            }

            const baseline = cloudVersions[cacheKey];
            const { data: remote, error: readError } = await supabaseClient
                .from(tableName)
                .select('*')
                .match(filters)
                .maybeSingle();
            if (readError) throw readError;

            if (remote) {
                const valuesAlreadyApplied = Object.entries(cloudValues).every(([key, value]) => JSON.stringify(remote[key]) === JSON.stringify(value));
                if (valuesAlreadyApplied) {
                    cloudVersions[cacheKey] = remote.updated_at || null;
                    removePendingCloudWrite(job);
                    return remote;
                }
                if (baseline && remote.updated_at && remote.updated_at !== baseline) {
                    throw new Error(`Konflik ${label}: Data telah diubah oleh pengguna lain di perangkat lain. Muat ulang halaman untuk mengambil versi terbaru.`);
                }

                let updateQuery = supabaseClient
                    .from(tableName)
                    .update({ ...cloudValues, updated_at: new Date().toISOString() })
                    .match(filters);
                if (remote.updated_at) updateQuery = updateQuery.eq('updated_at', remote.updated_at);
                const { data, error } = await updateQuery.select('*').maybeSingle();
                if (error) throw error;
                if (!data) throw new Error(`Konflik ${label}: Pengguna lain menyimpan pembaruan terlebih dahulu. Muat ulang halaman.`);
                cloudVersions[cacheKey] = data.updated_at;
                removePendingCloudWrite(job);
                flushPendingCloudWrites();
                return data;
            }

            const { data, error } = await supabaseClient
                .from(tableName)
                .insert({ ...filters, ...cloudValues, updated_at: new Date().toISOString() })
                .select('*')
                .single();
            if (error) throw error;
            cloudVersions[cacheKey] = data?.updated_at || null;
            removePendingCloudWrite(job);
            flushPendingCloudWrites();
            return data;
        } catch (error) {
            if (options.queueOnFailure !== false && isRetryableCloudError(error)) {
                error.queuedForSync = enqueueCloudWrite(job, error);
                if (error.queuedForSync) error.message = `${error.message || 'Koneksi cloud gagal.'} Perubahan disimpan di antrean sinkronisasi.`;
            }
            throw error;
        }
    }

    async function syncCloudUpsert(tableName, rows, conflictColumns, queueKey, label, options = {}) {
        requireAccess('write');
        if (!Array.isArray(rows) || !rows.length) return true;
        const cloudRows = rows.map(row => mapBudgetCloudValues(tableName, row));
        const job = { type: 'bulk-upsert', tableName, rows: cloudRows, conflictColumns, queueKey, label };
        try {
            if (!supabaseClient) {
                const error = new Error('Cloud belum siap. Perubahan menunggu koneksi.');
                error.retryable = true;
                throw error;
            }
            for (let offset = 0; offset < cloudRows.length; offset += 200) {
                const { error } = await supabaseClient.from(tableName).upsert(cloudRows.slice(offset, offset + 200), { onConflict: conflictColumns });
                if (error) throw error;
            }
            removePendingCloudWrite(job);
            flushPendingCloudWrites();
            return true;
        } catch (error) {
            if (options.queueOnFailure !== false && isRetryableCloudError(error)) {
                error.queuedForSync = enqueueCloudWrite(job, error);
                if (error.queuedForSync) error.message = `${error.message || 'Koneksi cloud gagal.'} Perubahan disimpan di antrean sinkronisasi.`;
            }
            throw error;
        }
    }

    async function deleteVersionedRow(tableName, periodName, filters, versionKey, label, options = {}) {
        requireAccess('delete');
        if (!periodName) throw new Error('Periode penyimpanan tidak tersedia.');
        const job = { type: 'row-delete', tableName, periodName, filters, versionKey, label };
        const cacheKey = `${periodName}:${versionKey}`;
        try {
            if (!supabaseClient) {
                const error = new Error('Cloud belum siap. Penghapusan menunggu koneksi.');
                error.retryable = true;
                throw error;
            }
            const baseline = cloudVersions[cacheKey];
            const { data: remote, error: readError } = await supabaseClient
                .from(tableName)
                .select('updated_at')
                .match(filters)
                .maybeSingle();
            if (readError) throw readError;
            if (remote && baseline && remote.updated_at && remote.updated_at !== baseline) {
                throw new Error(`Konflik ${label}: Data telah diubah pengguna lain. Muat ulang.`);
            }
            const { error } = await supabaseClient.from(tableName).delete().match(filters);
            if (error) throw error;
            delete cloudVersions[cacheKey];
            removePendingCloudWrite(job);
            flushPendingCloudWrites();
            return true;
        } catch (error) {
            if (options.queueOnFailure !== false && isRetryableCloudError(error)) {
                error.queuedForSync = enqueueCloudWrite(job, error);
                if (error.queuedForSync) error.message = `${error.message || 'Koneksi cloud gagal.'} Penghapusan disimpan di antrean sinkronisasi.`;
            }
            throw error;
        }
    }

    // 6. Period Management (Dynamic & Configurable Default)
    async function loadAvailablePeriods(forceReload = false) {
        if (authInitPromise) await authInitPromise;
        const fallback = ['2026', '2025'];
        if (!forceReload && availablePeriodsLoaded) return availablePeriods;
        if (availablePeriodsLoadPromise) return availablePeriodsLoadPromise;

        const localRegistry = readLocalPeriodRegistry();
        const localNames = Array.isArray(localRegistry.names)
            ? localRegistry.names.map(item => sanitizePeriodName(item)).filter(Boolean)
            : [];
        if (!forceReload && localNames.length && !supabaseClient) {
            availablePeriods = sortPeriodNames([...new Set([
                ...localNames,
                activePeriod,
                localRegistry.defaultPeriod,
                localStorage.getItem('smartbara_default_period')
            ].map(value => sanitizePeriodName(value)).filter(Boolean))]);
            availablePeriodsLoaded = true;
            return availablePeriods;
        }

        const loadPromise = (async () => {
            if (!supabaseClient) {
                availablePeriods = fallback;
                availablePeriodsLoaded = true;
                return availablePeriods;
            }

            const periodTables = [
                'smartbara_periods', 'smartbara_store', 'smartbara_meta', 'smartbara_budget',
                'smartbara_budget_site', 'smartbara_future_budget', 'smartbara_asset', 'smartbara_dept_visibility'
            ];
            const remoteNamesByTable = await Promise.all(periodTables.map(async tableName => {
                let timeoutId;
                try {
                    const query = supabaseClient.from(tableName).select('period_name').limit(1000);
                    const timeout = new Promise(resolve => {
                        timeoutId = window.setTimeout(() => resolve({ data: null, error: new Error('Timeout daftar periode') }), 3000);
                    });
                    const { data, error } = await Promise.race([query, timeout]);
                    return error ? [] : (data || []).map(row => row.period_name).filter(Boolean);
                } catch(e) {
                    return [];
                } finally {
                    if (timeoutId) window.clearTimeout(timeoutId);
                }
            }));
            const refreshedRegistry = readLocalPeriodRegistry();
            const refreshedNames = Array.isArray(refreshedRegistry.names)
                ? refreshedRegistry.names.map(item => sanitizePeriodName(item)).filter(Boolean)
                : [];
            const remoteNames = remoteNamesByTable.flat().map(item => sanitizePeriodName(item)).filter(Boolean);
            const cleanedLocalNames = refreshedNames.filter(name =>
                remoteNames.includes(name) ||
                name === sanitizePeriodName(activePeriod) ||
                name === sanitizePeriodName(refreshedRegistry.defaultPeriod) ||
                name === sanitizePeriodName(localStorage.getItem('smartbara_default_period')) ||
                hasPeriodLocalEvidence(name)
            );
            const hasRegisteredPeriods = remoteNames.length > 0 || cleanedLocalNames.length > 0;
            const preferredPeriod = sanitizePeriodName(localStorage.getItem('smartbara_active_period') || activePeriod || refreshedRegistry.activePeriod || refreshedRegistry.defaultPeriod);
            const knownNames = [...new Set([
                ...(hasRegisteredPeriods ? [...remoteNames, ...cleanedLocalNames] : fallback), activePeriod,
                refreshedRegistry.defaultPeriod, localStorage.getItem('smartbara_default_period'), preferredPeriod
            ].map(value => sanitizePeriodName(value)).filter(Boolean))];
            availablePeriods = sortPeriodNames(knownNames);
            writePeriodRegistry(knownNames, preferredPeriod || activePeriod, localStorage.getItem('smartbara_default_period') || refreshedRegistry.defaultPeriod || window.SMART_BARA_CONFIG.DEFAULT_PERIOD);

            availablePeriodsLoaded = true;
            return availablePeriods;
        })();

        availablePeriodsLoadPromise = loadPromise;
        try {
            return await loadPromise;
        } finally {
            if (availablePeriodsLoadPromise === loadPromise) availablePeriodsLoadPromise = null;
        }
    }

    function sortPeriodNames(periodNames) {
        const monthNames = [
            ['januari', 1], ['january', 1], ['februari', 2], ['february', 2], ['maret', 3], ['march', 3],
            ['april', 4], ['mei', 5], ['may', 5], ['juni', 6], ['june', 6], ['juli', 7], ['july', 7],
            ['agustus', 8], ['august', 8], ['september', 9], ['oktober', 10], ['october', 10],
            ['november', 11], ['desember', 12], ['december', 12], ['agu', 8], ['ags', 8], ['agt', 8], ['agst', 8], ['agts', 8], ['aug', 8]
        ];
        const getMonth = value => {
            const normalized = String(value || '').trim().toLowerCase();
            const tokens = normalized.split(/[^a-z]+/).filter(Boolean);
            const namedMonth = monthNames.find(([name]) => tokens.includes(name));
            if (namedMonth) return namedMonth[1];
            const numericMonth = normalized.match(/(?:^|\D)(1[0-2]|0?[1-9])(?:\D|$)/);
            return numericMonth ? Number(numericMonth[1]) : 0;
        };
        const getYear = value => Number(String(value || '').match(/\d{4}/)?.[0] || 0);
        return [...periodNames].sort((left, right) =>
            getYear(right) - getYear(left) || getMonth(right) - getMonth(left) || right.localeCompare(left)
        );
    }

    function hasPeriodLocalEvidence(periodName) {
        const prefixChecks = [
            'smartbara_store_', 'smartbara_store_updated_at_',
            'smartbara_meta_', 'smartbara_budget_v2_', 'smartbara_budget_site_v2_',
            'smartbara_budget_future_v1_'
        ];
        return prefixChecks.some(prefix => localStorage.getItem(`${prefix}${periodName}`) !== null);
    }

    function writePeriodRegistry(names, activePeriodName, defaultPeriodName) {
        const safeNames = [...new Set((Array.isArray(names) ? names : []).map(item => sanitizePeriodName(item)).filter(Boolean))];
        const nextActivePeriod = sanitizePeriodName(activePeriodName) || safeNames[0] || '';
        const nextDefaultPeriod = sanitizePeriodName(defaultPeriodName) || safeNames[0] || window.SMART_BARA_CONFIG.DEFAULT_PERIOD;
        const payload = {
            names: safeNames,
            activePeriod: nextActivePeriod,
            defaultPeriod: nextDefaultPeriod
        };

        PERIOD_REGISTRY_KEYS.forEach(key => {
            try {
                localStorage.removeItem(key);
                localStorage.setItem(key, JSON.stringify(payload));
            } catch (error) {}
        });

        if (nextDefaultPeriod) localStorage.setItem('smartbara_default_period', nextDefaultPeriod);
        if (nextActivePeriod) localStorage.setItem('smartbara_active_period', nextActivePeriod);
        else localStorage.removeItem('smartbara_active_period');

        return payload;
    }

    function persistLocalPeriodRegistry() {
        try {
            const previous = readLocalPeriodRegistry();
            const previousNames = Array.isArray(previous.names) ? previous.names : [];
            const names = [...new Set([...(previousNames || []), ...(availablePeriods || []), activePeriod].map(item => sanitizePeriodName(item)).filter(Boolean))];
            const defaultPeriod = sanitizePeriodName(localStorage.getItem('smartbara_default_period') || previous.defaultPeriod || window.SMART_BARA_CONFIG.DEFAULT_PERIOD) || window.SMART_BARA_CONFIG.DEFAULT_PERIOD;
            const activePeriodName = sanitizePeriodName(activePeriod) || defaultPeriod;
            writePeriodRegistry(names, activePeriodName, defaultPeriod);
        } catch(e) {}
    }

    async function addPeriod(newPeriodName, setAsDefault = false) {
        requireAccess('settings');
        if (!newPeriodName) throw new Error('Nama periode tidak boleh kosong.');
        const cleanName = newPeriodName.trim();
        await syncVersionedRow('smartbara_periods', 'global', { period_name: cleanName }, {}, `period:${cleanName}`, 'Periode');

        if (setAsDefault) {
            setDefaultPeriod(cleanName);
        }

        await loadAvailablePeriods(true);
        setPeriod(cleanName);
        return cleanName;
    }

    async function readAllPeriodRows(tableName, periodName) {
        const pageSize = 1000;
        const rows = [];
        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await supabaseClient.from(tableName).select('*').eq('period_name', periodName).range(offset, offset + pageSize - 1);
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < pageSize) return rows;
        }
    }

    // PostgREST memotong hasil di 1000 baris, sehingga tanpa paginasi baris sebagian dept
    // hilang diam-diam. Bentuk hasilnya sama dengan query Supabase: { data, error }.
    async function fetchPeriodRows(tableName, periodName, { columns = '*', orderBy = 'id', ascending = true } = {}) {
        const pageSize = 1000;
        const rows = [];
        for (let offset = 0; ; offset += pageSize) {
            let query = supabaseClient.from(tableName).select(columns).eq('period_name', periodName).order(orderBy, { ascending });
            if (orderBy !== 'id') query = query.order('id');
            const { data, error } = await query.range(offset, offset + pageSize - 1);
            if (error) return { data: null, error };
            rows.push(...(data || []));
            if (!data || data.length < pageSize) return { data: rows, error: null };
        }
    }

    async function periodHasData(periodName) {
        const periodTables = [
            'smartbara_store', 'smartbara_meta', 'smartbara_budget', 'smartbara_budget_site',
            'smartbara_future_budget', 'smartbara_asset', 'smartbara_dept_visibility',
            'smartbara_history', 'smartbara_budget_creator_planning'
        ];
        const checks = await Promise.all(periodTables.map(tableName =>
            supabaseClient.from(tableName).select('period_name').eq('period_name', periodName).limit(1)
        ));
        const failedCheck = checks.find(result => result.error);
        if (failedCheck) throw failedCheck.error;
        if (checks.some(result => result.data?.length)) return true;

        const [creatorSettings, reconcileSettings, settingsByPeriod] = await Promise.all([
            supabaseClient.from('smartbara_settings').select('key').eq('key', `budget_creator_planning_${periodName}`).limit(1),
            supabaseClient.from('smartbara_settings').select('key').like('key', `smartbara_reconcile_override_${periodName}_%`).limit(1),
            supabaseClient.from('smartbara_settings').select('key').like('key', `%${periodName}%`).limit(1)
        ]);
        const settingsCheckError = [creatorSettings, reconcileSettings, settingsByPeriod].find(result => result.error);
        if (settingsCheckError) throw settingsCheckError.error;
        if (settingsByPeriod.error) throw settingsByPeriod.error;
        return Boolean(creatorSettings.data?.length || reconcileSettings.data?.length || settingsByPeriod.data?.length);
    }

    async function writeRowsInBatches(tableName, rows) {
        for (let offset = 0; offset < rows.length; offset += 200) {
            const { error } = await supabaseClient.from(tableName).insert(rows.slice(offset, offset + 200));
            if (error) throw error;
        }
    }

    function rewritePeriodInValue(value, sourcePeriod, targetPeriod) {
        if (Array.isArray(value)) return value.map(item => rewritePeriodInValue(item, sourcePeriod, targetPeriod));
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            key === 'period_name' && item === sourcePeriod ? targetPeriod : rewritePeriodInValue(item, sourcePeriod, targetPeriod)
        ]));
    }

    async function deletePeriodRows(periodName, includeRegistry = true) {
        const periodTables = [
            'smartbara_history', 'smartbara_budget_creator_planning', 'smartbara_budget_site',
            'smartbara_budget', 'smartbara_future_budget', 'smartbara_asset',
            'smartbara_dept_visibility', 'smartbara_meta', 'smartbara_store'
        ];
        const results = await Promise.all(periodTables.map(tableName => supabaseClient.from(tableName).delete().eq('period_name', periodName)));
        const failed = results.find(result => result.error);
        if (failed) throw failed.error;

        const { error: settingsDeleteError } = await supabaseClient.from('smartbara_settings').delete().like('key', `%${periodName}%`);
        if (settingsDeleteError) throw settingsDeleteError;
        if (includeRegistry) {
            const { error } = await supabaseClient.from('smartbara_periods').delete().eq('period_name', periodName);
            if (error) throw error;
        }
    }

    async function renamePeriod(periodName, newPeriodName) {
        requireAccess('settings');
        const source = sanitizePeriodName(periodName);
        const target = sanitizePeriodName(newPeriodName);
        if (!source || !target) throw new Error('Nama periode tidak valid.');
        if (source === target) return source;
        if (!canWriteCloud()) throw new Error('Login dengan akun yang memiliki akses tulis diperlukan.');

        const periods = await loadAvailablePeriods(true);
        if (periods.includes(target)) throw new Error(`Periode ${target} sudah tersedia.`);

        if (supabaseClient) {
            const { error: periodError } = await supabaseClient
                .from('smartbara_periods')
                .update({ period_name: target })
                .eq('period_name', source);
            if (periodError) throw periodError;

            const tableNames = [
                'smartbara_history', 'smartbara_budget_creator_planning', 'smartbara_budget_site',
                'smartbara_budget', 'smartbara_future_budget', 'smartbara_asset',
                'smartbara_dept_visibility', 'smartbara_meta', 'smartbara_store'
            ];

            for (const tableName of tableNames) {
                const { error } = await supabaseClient
                    .from(tableName)
                    .update({ period_name: target })
                    .eq('period_name', source);
                if (error) throw error;
            }

            const { data: settingsRows = [], error: settingsReadError } = await supabaseClient
                .from('smartbara_settings')
                .select('*')
                .like('key', `%${source}%`);
            if (settingsReadError) throw settingsReadError;

            for (const row of settingsRows) {
                const updatedKey = String(row.key || '').replace(source, target);
                const updatedValue = rewritePeriodInValue(row.value, source, target);

                const { error: settingsError } = await supabaseClient
                    .from('smartbara_settings')
                    .update({ key: updatedKey, value: updatedValue })
                    .eq('id', row.id);
                if (settingsError) throw settingsError;
            }
        }

        const renamedPeriods = periods.map(item => sanitizePeriodName(item) === source ? target : item);
        availablePeriods = sortPeriodNames([...new Set(renamedPeriods)]);

        if (activePeriod === source) {
            activePeriod = target;
            localStorage.setItem('smartbara_active_period', target);
        }
        if (getDefaultPeriod() === source) {
            localStorage.setItem('smartbara_default_period', target);
        }

        const renameMap = [
            'smartbara_store_', 'smartbara_store_updated_at_', 'smartbara_selected_depts_',
            'smartbara_meta_', 'smartbara_budget_v2_', 'smartbara_budget_site_v2_',
            'smartbara_budget_future_v1_', 'smartbara_reconcile_overrides_'
        ];
        renameMap.forEach(prefix => {
            const oldKey = `${prefix}${source}`;
            const newKey = `${prefix}${target}`;
            const value = localStorage.getItem(oldKey);
            if (value !== null) {
                localStorage.setItem(newKey, value);
                localStorage.removeItem(oldKey);
            }
        });

        Object.keys(localStorage)
            .filter(key => key.startsWith(`smartbara_reconcile_override_${source}_`))
            .forEach(key => {
                const suffix = key.slice(`smartbara_reconcile_override_${source}_`.length);
                const newKey = `smartbara_reconcile_override_${target}_${suffix}`;
                const value = localStorage.getItem(key);
                if (value !== null) {
                    localStorage.setItem(newKey, value);
                    localStorage.removeItem(key);
                }
            });

        Object.keys(cloudVersions).filter(key => key.startsWith(`${source}:`)).forEach(key => {
            cloudVersions[key.replace(new RegExp(`^${source}:`), `${target}:`)] = cloudVersions[key];
            delete cloudVersions[key];
        });

        writePeriodRegistry(availablePeriods, activePeriod, getDefaultPeriod());
        await loadAvailablePeriods(true);
        setPeriod(target);
        return target;
    }

    async function deletePeriod(periodName, password) {
        requireAccess('settings');
        const target = String(periodName || '').trim();
        if (!target) throw new Error('Periode tidak valid.');
        if (target === activePeriod) throw new Error('Periode aktif tidak dapat dihapus. Pindah ke periode lain terlebih dahulu.');
        if (!canWriteCloud()) throw new Error('Login dengan akun yang memiliki akses tulis diperlukan.');
        await verifyCurrentPassword(password);

        const periods = await loadAvailablePeriods(true);
        const fallback = periods.find(period => period !== target);
        if (!fallback) throw new Error('Periode terakhir tidak dapat dihapus.');
        await deletePeriodRows(target);

        availablePeriods = periods.filter(period => period !== target);
        const defaultPeriod = getDefaultPeriod() === target ? fallback : getDefaultPeriod();
        localStorage.setItem('smartbara_default_period', defaultPeriod);
        [
            `smartbara_store_${target}`, `smartbara_store_updated_at_${target}`, `smartbara_selected_depts_${target}`,
            `smartbara_meta_${target}`, `smartbara_budget_v2_${target}`, `smartbara_budget_site_v2_${target}`,
            `smartbara_budget_future_v1_${target}`, `budget_creator_planning_${target}`,
            `smartbara_reconcile_overrides_${target}`
        ].forEach(key => localStorage.removeItem(key));
        Object.keys(localStorage).filter(key => key.startsWith(`smartbara_reconcile_override_${target}_`)).forEach(key => localStorage.removeItem(key));
        writePeriodRegistry(availablePeriods, activePeriod, defaultPeriod);
        cloudLoadedPeriods.delete(target);
        periodLoadPromises.delete(target);
        Object.keys(cloudVersions).filter(key => key.startsWith(`${target}:`)).forEach(key => delete cloudVersions[key]);
        await loadAvailablePeriods(true);
        return target;
    }

    async function duplicatePeriod(sourcePeriod, targetPeriod) {
        requireAccess('settings');
        const source = String(sourcePeriod || '').trim();
        const target = String(targetPeriod || '').trim();
        if (!source || !target || source === target) throw new Error('Periode sumber dan tujuan harus berbeda.');
        if (!canWriteCloud()) throw new Error('Login dengan akun yang memiliki akses tulis diperlukan.');
        const periods = await loadAvailablePeriods(true);
        if (periods.includes(target)) throw new Error(`Periode ${target} sudah tersedia.`);
        if (await periodHasData(target)) throw new Error(`Periode ${target} sudah memiliki data. Pilih nama periode tujuan yang baru.`);

        const tableNames = [
            'smartbara_store', 'smartbara_meta', 'smartbara_budget', 'smartbara_budget_site',
            'smartbara_future_budget', 'smartbara_asset', 'smartbara_dept_visibility',
            'smartbara_history', 'smartbara_budget_creator_planning'
        ];
        const sourceRows = await Promise.all(tableNames.map(async tableName => [tableName, await readAllPeriodRows(tableName, source)]));
        const settingsResults = await Promise.all([
            supabaseClient.from('smartbara_settings').select('*').like('key', `%${source}%`)
        ]);
        const settingsError = settingsResults.find(result => result.error);
        if (settingsError) throw settingsError.error;

        try {
            const counts = {};
            for (const [tableName, rows] of sourceRows) {
                const copies = rows.map(row => {
                    const copy = { ...row, period_name: target };
                    delete copy.id;
                    return copy;
                });
                await writeRowsInBatches(tableName, copies);
                counts[tableName] = copies.length;
            }

            const settings = settingsResults.flatMap(result => result.data || []).map(row => {
                const copy = { ...row, key: row.key.replace(source, target), value: rewritePeriodInValue(row.value, source, target) };
                delete copy.id;
                return copy;
            });
            await writeRowsInBatches('smartbara_settings', settings);
            counts.smartbara_settings = settings.length;

            const { error } = await supabaseClient.from('smartbara_periods').insert({ period_name: target });
            if (error) throw error;
            await loadAvailablePeriods(true);
            setPeriod(target);
            return counts;
        } catch(error) {
            try { await deletePeriodRows(target); } catch(cleanupError) { console.error('Period clone cleanup error:', cleanupError); }
            throw error;
        }
    }

    function setDefaultPeriod(periodName) {
        requireAccess('settings');
        localStorage.setItem('smartbara_default_period', periodName);
        persistLocalPeriodRegistry();
        showSyncStatus(`Periode default disetel ke: ${periodName}`, 'success');
    }

    function getDefaultPeriod() {
        const value = localStorage.getItem('smartbara_default_period') || savedPeriodRegistry.defaultPeriod || window.SMART_BARA_CONFIG.DEFAULT_PERIOD;
        const normalized = resolveStoredPeriod(value) || window.SMART_BARA_CONFIG.DEFAULT_PERIOD;
        localStorage.setItem('smartbara_default_period', normalized);
        return normalized;
    }

    function setPeriod(period) {
        const nextPeriod = sanitizePeriodName(period);
        if (!nextPeriod) return;
        activePeriod = nextPeriod;
        localStorage.setItem('smartbara_active_period', nextPeriod);
        if (!availablePeriods.includes(nextPeriod)) availablePeriods = sortPeriodNames([...new Set([...availablePeriods, nextPeriod])]);
        const preferredPeriod = sanitizePeriodName(localStorage.getItem('smartbara_active_period') || nextPeriod) || nextPeriod;
        if (preferredPeriod !== nextPeriod) localStorage.setItem('smartbara_active_period', nextPeriod);
        persistLocalPeriodRegistry();
        dispatchCoreEvent('period_change', { period: nextPeriod });
        loadPeriodStore(nextPeriod, true);
    }

    function getSyncHistory(limit = 10) {
        try {
            const raw = localStorage.getItem('smartbara_sync_history');
            const items = raw ? JSON.parse(raw) : [];
            return Array.isArray(items) ? items.slice(0, limit) : [];
        } catch (error) {
            console.warn('Unable to read sync history:', error);
            return [];
        }
    }

    function getLatestSyncEntry() {
        const items = getSyncHistory(20);
        return items[0] || null;
    }

    function recordSyncEntry(msg, type = 'info') {
        try {
            const entry = {
                at: new Date().toISOString(),
                time: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
                user: currentUser?.email || 'System',
                userName: currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.fullName || currentUser?.user_metadata?.name || currentUser?.email || 'System',
                type,
                message: String(msg || '').trim(),
                period: activePeriod
            };
            const existing = JSON.parse(localStorage.getItem('smartbara_sync_history') || '[]');
            const history = Array.isArray(existing) ? existing : [];
            history.unshift(entry);
            const trimmed = history.slice(0, 25);
            localStorage.setItem('smartbara_sync_history', JSON.stringify(trimmed));
            return entry;
        } catch (error) {
            console.warn('Unable to save sync history:', error);
            return null;
        }
    }

    // 7. UI Status Pill
    function showSyncStatus(msg, type = 'info') {
        recordSyncEntry(msg, type);
        const el = document.getElementById('globalSyncPill');
        if (!el) return;
        const color = type === 'error' ? 'text-rose-400 bg-rose-950/40 border-rose-800'
                    : type === 'success' ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800'
                    : 'text-teal-400 bg-teal-950/40 border-teal-800';
        el.className = `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${color}`;
        el.innerHTML = `<span class="w-2 h-2 rounded-full ${type==='error'?'bg-rose-500':type==='success'?'bg-emerald-500':'bg-teal-500 animate-pulse'}"></span><span>${msg}</span>`;
        el.classList.remove('opacity-0');
        if (type === 'success' || type === 'info') {
            setTimeout(() => { if (el) el.classList.add('opacity-0'); }, 4000);
        }
    }

    function dispatchCoreEvent(name, detail) {
        window.dispatchEvent(new CustomEvent(`smartbara:${name}`, { detail }));
    }

    return {
        init,
        initAuthOnly,
        getClient: () => supabaseClient,
        get supabase() { return supabaseClient; },
        login,
        applySessionDefaults,
        verifyCurrentPassword,
        signUp,
        requestPasswordReset,
        updatePassword,
        logout,
        getUser: () => currentUser,
        getAccessLevel,
        isAdmin: () => isAdmin,
        canWriteCloud,
        canWriteData,
        canDeleteData,
        canManageSettings,
        canApproveAllDepartments,
        getApprovalState,
        setApprovalState,
        getApprovalHistory,
        requireApprovalDecision,
        rejectApprovalDecision,
        getActivePeriod: () => activePeriod,
        setPeriod,
        getDefaultPeriod,
        setDefaultPeriod,
        getAvailablePeriods: () => availablePeriods,
        loadAvailablePeriods,
        addPeriod,
        renamePeriod,
        deletePeriod,
        duplicatePeriod,
        loadPeriodStore,
        getDepartments,
        getSelectedDepartments,
        fetchPeriodRows,
        isCombinedDepartments,
        setSelectedDepartments,
        getTransactions,
        getAllTransactions,
        getDepartmentStore,
        createTransactionId,
        saveDepartmentStore,
        syncVersionedRow,
        syncCloudUpsert,
        rewritePeriodInValue,
        deleteVersionedRow,
        onRealtimeChange,
        getSyncHistory,
        getLatestSyncEntry,
        showSyncStatus,
        flushPendingCloudWrites,
        setCloudVersion: (period, key, val) => { cloudVersions[`${period}:${key}`] = val; }
    };
})();

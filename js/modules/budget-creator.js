// ==============================================================================
// SMART BARA 7.10 HZ - BUDGET CREATOR PLANNING MODULE
// ==============================================================================

window.BudgetCreatorModule = (function() {
    let items = [];
    const expandedAccountGroups = new Set();
    let storageMode = 'table'; // 'table' or 'settings'
    let aiDraftRows = [];
    let aiChatMessages = [];
    let currentAiBudgetId = '';
    let isEditingExistingAiBatch = false;
    let manualProjectOptions = [];
    let referenceAccountOptions = [];
    let referenceProjectOptions = [];
    let pendingImport = null;
    let importPlanCache = null;
    let importBusy = false;
    let bulkOperationInProgress = false;
    let reloadAfterBulk = false;
    let reloadTimer = null;
    let renderTimer = null;

    const TABLE_NAME = 'smartbara_budget_creator_planning';
    const BULK_CHUNK_SIZE = 250;
    const MAX_IMPORT_ROWS = 10000;
    const PRIORITIES = ['Tinggi', 'Normal', 'Rendah'];
    const STATUSES = ['Draft', 'Diajukan', 'Disetujui', 'Ditolak'];
    const FINAL_STATUSES = ['Disetujui', 'Ditolak'];

    function getCacheKey(period = window.SmartBaraCore.getActivePeriod()) {
        return `budget_creator_planning_${period}`;
    }

    function persistLocal(period = window.SmartBaraCore.getActivePeriod(), list = items) {
        try {
            localStorage.setItem(getCacheKey(period), JSON.stringify(list));
        } catch(error) {
            console.warn('Cache lokal Budget Creator penuh/tidak tersedia:', error);
        }
    }

    function normalizeKey(value) {
        return String(value ?? '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
    }

    function getRowTotal(row) {
        return (Number(row.quantity) || 0) * (Number(row.estimated_unit_price) || 0);
    }

    function getRowFingerprint(row) {
        return [
            normalizeKey(row.department), normalizeKey(row.account_name), normalizeKey(row.project_name),
            normalizeKey(row.item_name), normalizeKey(row.specification), String(row.needed_by || '').slice(0, 10),
            Number(row.quantity) || 0, Math.round((Number(row.estimated_unit_price) || 0) * 100)
        ].join('|');
    }

    // Bulk upsert supabase-js mengisi kolom yang tidak dikirim dengan NULL, jadi setiap
    // baris harus membawa seluruh kolom dengan nilai default yang sah.
    function toCloudRow(row, period) {
        const now = new Date().toISOString();
        return {
            id: row.id || crypto.randomUUID(),
            period_name: period,
            department: String(row.department || '').trim(),
            account_name: String(row.account_name || '').trim(),
            project_name: String(row.project_name || '').trim(),
            item_name: String(row.item_name || '').trim(),
            specification: String(row.specification || '').trim(),
            catatan: String(row.catatan || '').trim(),
            ai_budget_id: row.ai_budget_id || null,
            quantity: Number(row.quantity) || 1,
            unit: String(row.unit || 'unit').trim() || 'unit',
            estimated_unit_price: Number(row.estimated_unit_price) || 0,
            priority: PRIORITIES.includes(row.priority) ? row.priority : 'Normal',
            needed_by: row.needed_by || null,
            status: STATUSES.includes(row.status) ? row.status : 'Draft',
            created_by: row.created_by || null,
            created_at: row.created_at || now,
            updated_at: now
        };
    }

    function isRetryableError(error) {
        return Boolean(!navigator.onLine || error instanceof TypeError
            || /network|fetch|timeout|temporar|offline|connection|gateway|\b50[234]\b/i.test(error?.message || ''));
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function mergeIntoItems(rows) {
        if (!rows.length) return;
        const incomingIds = new Set(rows.map(row => String(row.id)));
        items = [...rows, ...items.filter(item => !incomingIds.has(String(item.id)))];
    }

    function scheduleReload() {
        if (bulkOperationInProgress) {
            reloadAfterBulk = true;
            return;
        }
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => loadData(true), 700);
    }

    function scheduleRender() {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderTable, 180);
    }

    /**
     * Simpan banyak baris sekaligus (upsert per chunk, idempoten karena memakai id).
     * Chunk yang gagal karena jaringan dicoba ulang; jika tetap gagal, sisa baris masuk
     * antrean sinkronisasi core. Error non-jaringan menghentikan proses tanpa kehilangan
     * informasi baris mana yang sudah tersimpan.
     */
    async function bulkUpsertRows(rows, { label = 'Budget Creator', onProgress } = {}) {
        const client = window.SmartBaraCore.getClient();
        const period = window.SmartBaraCore.getActivePeriod();
        const result = { saved: [], queued: [], failed: [], error: null };
        const cloudRows = rows.map(row => toCloudRow(row, period));
        const batchKey = crypto.randomUUID();

        for (let offset = 0; offset < cloudRows.length; offset += BULK_CHUNK_SIZE) {
            const chunk = cloudRows.slice(offset, offset + BULK_CHUNK_SIZE);
            let lastError = null;
            let data = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                const response = await client.from(TABLE_NAME).upsert(chunk, { onConflict: 'id' }).select('id, updated_at');
                if (!response.error) {
                    data = response.data || [];
                    lastError = null;
                    break;
                }
                lastError = response.error;
                if (!isRetryableError(lastError) || attempt === 3) break;
                await wait(700 * attempt);
            }

            if (lastError) {
                const remaining = cloudRows.slice(offset);
                if (isRetryableError(lastError)) {
                    try {
                        await window.SmartBaraCore.syncCloudUpsert(TABLE_NAME, remaining, 'id', `budgetCreator:bulk:${batchKey}`, label);
                        result.saved.push(...remaining);
                    } catch(queueError) {
                        if (queueError.queuedForSync) result.queued.push(...remaining);
                        else result.failed.push(...remaining);
                        result.error = queueError;
                    }
                } else {
                    result.failed.push(...remaining);
                    result.error = lastError;
                }
                onProgress?.(result.saved.length, cloudRows.length);
                return result;
            }

            const versions = new Map(data.map(entry => [String(entry.id), entry.updated_at]));
            chunk.forEach(row => {
                const updatedAt = versions.get(String(row.id)) || row.updated_at;
                const savedRow = { ...row, updated_at: updatedAt };
                window.SmartBaraCore.setCloudVersion(period, `budgetCreator:${row.id}`, updatedAt);
                result.saved.push(savedRow);
            });
            onProgress?.(result.saved.length, cloudRows.length);
        }
        return result;
    }

    /** Cek dalam satu query apakah baris yang akan ditimpa/dihapus sudah diubah pengguna lain. */
    async function findRemoteConflicts(rows) {
        const client = window.SmartBaraCore.getClient();
        const baselines = new Map(rows
            .filter(row => row.updated_at)
            .map(row => [String(row.id), Date.parse(row.updated_at)]));
        if (!client || !baselines.size) return [];
        const ids = [...baselines.keys()];
        const conflicts = [];
        for (let offset = 0; offset < ids.length; offset += 200) {
            const { data, error } = await client.from(TABLE_NAME).select('id, updated_at').in('id', ids.slice(offset, offset + 200));
            if (error) throw error;
            (data || []).forEach(remote => {
                const baseline = baselines.get(String(remote.id));
                if (Number.isFinite(baseline) && Date.parse(remote.updated_at) !== baseline) conflicts.push(String(remote.id));
            });
        }
        return conflicts;
    }

    /** Simpan baris ke cloud (bulk) lalu gabungkan ke state lokal. Dipakai Import Excel & Budget AI. */
    async function commitRows(rows, { title, label }) {
        const period = window.SmartBaraCore.getActivePeriod();
        if (!rows.length) return { saved: [], queued: [], failed: [], error: null, mode: 'none' };

        if (!window.SmartBaraCore.canWriteCloud()) {
            mergeIntoItems(rows);
            persistLocal(period);
            renderTable();
            return { saved: rows, queued: [], failed: [], error: null, mode: 'local' };
        }

        if (storageMode === 'settings') {
            mergeIntoItems(rows);
            persistLocal(period);
            renderTable();
            try {
                await window.SmartBaraCore.syncVersionedRow('smartbara_settings', period, { key: getCacheKey(period) }, { value: items }, 'budgetCreatorFallback', label);
                return { saved: rows, queued: [], failed: [], error: null, mode: 'settings' };
            } catch(error) {
                return { saved: [], queued: error.queuedForSync ? rows : [], failed: error.queuedForSync ? [] : rows, error, mode: 'settings' };
            }
        }

        const taskId = window.SmartBaraLayout.beginLoading(title, `Menyimpan ${rows.length.toLocaleString('id-ID')} baris ke periode ${period}...`, 600000);
        bulkOperationInProgress = true;
        let result;
        try {
            result = await bulkUpsertRows(rows, {
                label,
                onProgress: (done, total) => window.SmartBaraLayout.updateLoading(
                    taskId, '', `${done.toLocaleString('id-ID')} / ${total.toLocaleString('id-ID')} baris tersimpan...`, (done / total) * 100
                )
            });
        } catch(error) {
            result = { saved: [], queued: [], failed: rows, error };
        } finally {
            bulkOperationInProgress = false;
        }

        const kept = [...result.saved, ...result.queued];
        mergeIntoItems(kept);
        persistLocal(period);
        renderTable();
        window.SmartBaraLayout.endLoading(taskId, !result.failed.length && !result.queued.length);
        if (reloadAfterBulk) {
            reloadAfterBulk = false;
            scheduleReload();
        }
        return { ...result, mode: 'table' };
    }

    function describeCommitResult(result, noun = 'baris') {
        const parts = [`${result.saved.length.toLocaleString('id-ID')} ${noun} tersimpan`];
        if (result.mode === 'local') parts[0] = `${result.saved.length.toLocaleString('id-ID')} ${noun} disimpan lokal (cloud belum tersambung)`;
        if (result.queued.length) parts.push(`${result.queued.length.toLocaleString('id-ID')} menunggu sinkronisasi otomatis`);
        if (result.failed.length) parts.push(`${result.failed.length.toLocaleString('id-ID')} gagal: ${result.error?.message || 'error tidak diketahui'}`);
        return parts.join(' · ');
    }

    function getAiBudgetDisplayId(aiBudgetId) {
        const fullUuid = String(aiBudgetId || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0];
        const hexValue = (fullUuid || String(aiBudgetId || '').split('-').pop() || '').replace(/[^0-9a-f]/gi, '');
        if (hexValue) {
            const shortSpace = 2176782336n;
            return (BigInt(`0x${hexValue}`) % shortSpace).toString(36).toUpperCase().padStart(6, '0');
        }
        const normalized = String(aiBudgetId || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
        let hashValue = 0;
        for (const character of normalized) hashValue = (hashValue * 31 + character.charCodeAt(0)) >>> 0;
        return hashValue.toString(36).toUpperCase().padStart(6, '0').slice(-6);
    }

    function createAiBudgetId() {
        const period = String(window.SmartBaraCore.getActivePeriod()).replace(/[^a-z0-9]/gi, '').slice(0, 8);
        let budgetId = '';
        do {
            budgetId = `AI-${period}-${crypto.randomUUID().toUpperCase()}`;
        } while (items.some(item => getAiBudgetDisplayId(item.ai_budget_id) === getAiBudgetDisplayId(budgetId)));
        return budgetId;
    }

    function updateAiBudgetIdDisplay() {
        const element = document.getElementById('creatorAiBudgetId');
        if (element) {
            element.textContent = currentAiBudgetId ? getAiBudgetDisplayId(currentAiBudgetId) : 'ID belum dibuat';
            element.title = currentAiBudgetId ? `Kode 6 karakter. ID internal: ${currentAiBudgetId}` : 'ID belum dibuat';
        }
    }

    async function init() {
        renderTable();
        // Listen to period change
        window.addEventListener('smartbara:period_change', async () => {
            await Promise.all([loadData(), loadReferenceOptions()]);
        });
        window.addEventListener('smartbara:dept_filter_change', () => renderTable());
        window.addEventListener('smartbara:store_loaded', event => {
            if (event.detail?.period === window.SmartBaraCore.getActivePeriod()) loadReferenceOptions();
        });

        // Listen to realtime change from other users
        window.SmartBaraCore.onRealtimeChange(payload => {
            if (payload.table === TABLE_NAME || payload.table === 'smartbara_settings') {
                scheduleReload();
            } else if (['smartbara_budget', 'smartbara_budget_site', 'smartbara_store'].includes(payload.table)) {
                loadReferenceOptions();
            }
        });
        document.getElementById('creatorAiPrompt')?.addEventListener('keydown', event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                sendAiMessage();
            }
        });
        document.getElementById('creatorAiBudgetSearchId')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                loadAiBudgetById();
            }
        });
        document.getElementById('creatorAiPrompt')?.addEventListener('input', updateAiPromptGuide);
        document.querySelectorAll('input[name="creatorAiMode"]').forEach(input => {
            input.addEventListener('change', () => setAiMode(input.value));
        });
        ['creatorAiManualDepartment', 'creatorAiManualAccount', 'creatorAiManualItem',
            'creatorAiManualSpecification', 'creatorAiManualQuantity', 'creatorAiManualUnit', 'creatorAiManualAnnualBudget',
            'creatorAiManualYear', 'creatorAiManualPriority', 'creatorAiManualNote', 'creatorAiManualRecurrence',
            'creatorAiManualMonth', 'creatorAiManualDay'].forEach(id => {
            const input = document.getElementById(id);
            input?.addEventListener('input', buildManualBudgetPreview);
            input?.addEventListener('change', buildManualBudgetPreview);
        });
        document.getElementById('creatorAiManualRecurrence')?.addEventListener('change', updateManualRecurrenceFields);
        document.getElementById('creatorAiManualProjectOptions')?.addEventListener('change', () => {
            updateManualProjectCount();
            buildManualBudgetPreview();
        });
        document.getElementById('creatorAiManualProjectAdd')?.addEventListener('click', addManualProjectOption);
        document.getElementById('creatorAiManualProjectOptions')?.addEventListener('click', event => {
            const button = event.target.closest('[data-remove-project]');
            if (!button) return;
            const project = button.dataset.removeProject;
            const selected = getSelectedManualProjects().filter(name => name !== project);
            renderManualProjectOptions(manualProjectOptions.filter(name => name !== project), selected);
            filterManualProjects();
            updateManualProjectCount();
            buildManualBudgetPreview();
        });
        document.getElementById('creatorAiManualProjectSearch')?.addEventListener('input', filterManualProjects);
        // Delegasi event tabel: satu listener untuk semua baris, bukan dipasang ulang setiap render.
        document.getElementById('creatorTableBody')?.addEventListener('click', event => {
            const toggle = event.target.closest('[data-creator-group-toggle]');
            if (toggle) {
                const key = toggle.dataset.groupKey;
                if (expandedAccountGroups.has(key)) expandedAccountGroups.delete(key);
                else expandedAccountGroups.add(key);
                renderTable();
                return;
            }
            const groupDelete = event.target.closest('[data-creator-group-delete]');
            if (groupDelete) return deleteAccountGroup(groupDelete.dataset.groupKey);
            const batchButton = event.target.closest('[data-ai-budget-id]');
            if (batchButton) return openAiBudget(batchButton.dataset.aiBudgetId);
            const actionButton = event.target.closest('[data-creator-action]');
            if (!actionButton) return;
            const id = actionButton.dataset.itemId;
            if (actionButton.dataset.creatorAction === 'edit') openForm(id);
            else if (actionButton.dataset.creatorAction === 'approve') approveBudgetItem(id);
            else if (actionButton.dataset.creatorAction === 'delete') deleteItem(id);
        });
        document.getElementById('creatorImportIssueFilter')?.addEventListener('change', renderImportReview);
        window.addEventListener('beforeunload', event => {
            if (!bulkOperationInProgress) return;
            event.preventDefault();
            event.returnValue = '';
        });
        await Promise.all([loadData(), loadReferenceOptions()]);
    }

    async function loadData(silent = false) {
        const period = window.SmartBaraCore.getActivePeriod();
        const client = window.SmartBaraCore.getClient();
        const fallbackKey = `budget_creator_planning_${period}`;

        // Load local cache first for instant display (0ms lag)
        try {
            const cached = JSON.parse(localStorage.getItem(fallbackKey) || '[]');
            if (Array.isArray(cached) && cached.length) {
                items = cached;
                renderTable();
            }
        } catch(e) {}

        if (!silent) setStatus('Memuat referensi dan rencana pembelian...');

        if (!client) {
            setStatus(`${items.length} rencana dimuat (mode lokal)`);
            return;
        }

        try {
            const itemRes = await window.SmartBaraCore.fetchPeriodRows(TABLE_NAME, period, { orderBy: 'created_at', ascending: false });
            if (period !== window.SmartBaraCore.getActivePeriod()) return;

            if (itemRes.error && /not exist|schema cache|could not find/i.test(itemRes.error.message || '')) {
                storageMode = 'settings';
                const { data: settingData } = await client.from('smartbara_settings').select('value, updated_at').eq('key', fallbackKey).maybeSingle();
                if (settingData && Array.isArray(settingData.value)) {
                    items = settingData.value;
                    window.SmartBaraCore.setCloudVersion(period, 'budgetCreatorFallback', settingData.updated_at);
                }
            } else if (itemRes.data) {
                storageMode = 'table';
                items = itemRes.data;
                items.forEach(it => window.SmartBaraCore.setCloudVersion(period, `budgetCreator:${it.id}`, it.updated_at));
            }

            persistLocal(period);
            renderTable();
            setStatus(`${items.length} kebutuhan pembelian siap.`);
        } catch(err) {
            console.warn('Load budget creator error:', err);
            renderTable();
            setStatus(`${items.length} kebutuhan (cache lokal).`);
        }
    }

    function readReferenceCache(key) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(value) ? value : [];
        } catch(e) {
            return [];
        }
    }

    function getReferenceField(row, names) {
        const entries = Object.entries(row || {});
        for (const name of names) {
            const key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
            const entry = entries.find(([candidate]) => String(candidate).toLowerCase().replace(/[^a-z0-9]/g, '') === key);
            if (entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '') return entry[1];
        }
        return undefined;
    }

    function normalizeReferenceNames(rows, fields) {
        const values = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const value = String(getReferenceField(row, fields) || '').trim();
            const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (value && key && !values.has(key)) values.set(key, value);
        });
        return [...values.values()].sort((a, b) => a.localeCompare(b, 'id'));
    }

    async function loadReferenceOptions() {
        const period = window.SmartBaraCore.getActivePeriod();
        const accountKey = `smartbara_budget_v2_${period}`;
        const projectKey = `smartbara_budget_site_v2_${period}`;
        let accountRows = readReferenceCache(accountKey);
        let projectRows = readReferenceCache(projectKey);
        const client = window.SmartBaraCore.getClient();

        if (client) {
            try {
                const [accountResult, projectResult] = await Promise.all([
                    client.from('smartbara_budget').select('nama_akun').eq('period_name', period),
                    client.from('smartbara_budget_site').select('nama_proyek_up').eq('period_name', period)
                ]);
                if (!accountResult.error && accountResult.data?.length) accountRows = accountResult.data;
                if (!projectResult.error && projectResult.data?.length) projectRows = projectResult.data;
                try {
                    localStorage.setItem(accountKey, JSON.stringify(accountRows));
                    localStorage.setItem(projectKey, JSON.stringify(projectRows));
                } catch(e) {}
            } catch(error) {
                console.warn('Load budget account/project references warning:', error);
            }
        }

        referenceAccountOptions = normalizeReferenceNames(accountRows, ['nama', 'nama_akun', 'account_name']);
        const transactionProjectRows = window.SmartBaraCore.getAllTransactions().map(transaction => ({
            nama: getReferenceField(transaction, ['proyek_manual', 'nama proyek up', 'nama proyek', 'proyek'])
        }));
        referenceProjectOptions = normalizeReferenceNames([...projectRows, ...transactionProjectRows], ['nama', 'nama_proyek_up', 'nama_proyek', 'project_name']);
        renderReferenceDatalists();
    }

    function renderReferenceDatalists() {
        const accountList = document.getElementById('creatorAccountReferenceOptions');
        const projectList = document.getElementById('creatorProjectReferenceOptions');
        if (accountList) accountList.innerHTML = referenceAccountOptions.map(value => `<option value="${window.Formatters.escapeHtml(value)}"></option>`).join('');
        if (projectList) projectList.innerHTML = referenceProjectOptions.map(value => `<option value="${window.Formatters.escapeHtml(value)}"></option>`).join('');
    }

    function openAiDialog() {
        aiDraftRows = [];
        currentAiBudgetId = createAiBudgetId();
        isEditingExistingAiBatch = false;
        updateAiBudgetIdDisplay();
        aiChatMessages = [{ role: 'assistant', text: 'Ceritakan kebutuhan budget yang ingin dibuat. Saya akan membentuk baris usulan untuk diperiksa sebelum diimpor.' }];
        renderAiChat();
        initializeManualAiFields();
        document.querySelector('input[name="creatorAiMode"][value="description"]').checked = true;
        setAiMode('description');
        renderAiPreview();
        document.getElementById('creatorAiPrompt').value = '';
        document.getElementById('creatorAiBudgetSearchId').value = '';
        document.getElementById('creatorAiImportStatus').textContent = '';
        const modal = document.getElementById('creatorAiModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
        document.getElementById('creatorAiPrompt').focus();
    }

    function initializeManualAiFields() {
        const lists = getDatabaseLists();
        const fillSelect = (id, values, placeholder) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = values.map(value => `<option value="${window.Formatters.escapeHtml(value)}">${window.Formatters.escapeHtml(value)}</option>`).join('');
            if (!values.length) select.innerHTML = `<option value="">${window.Formatters.escapeHtml(placeholder)}</option>`;
        };
        fillSelect('creatorAiManualDepartment', lists.departments, 'Pilih departemen');
        fillSelect('creatorAiManualAccount', lists.accounts, 'Pilih akun');
        fillSelect('creatorAiManualUnit', lists.units, 'Pilih satuan');
        renderManualProjectOptions(lists.projects);
        updateManualRecurrenceFields();

        const selectedDepts = window.SmartBaraCore.getSelectedDepartments();
        if (selectedDepts.length === 1 && lists.departments.includes(selectedDepts[0])) {
            document.getElementById('creatorAiManualDepartment').value = selectedDepts[0];
        }
        const activeYear = Number(String(window.SmartBaraCore.getActivePeriod()).match(/\d{4}/)?.[0]) || new Date().getFullYear();
        const yearSelect = document.getElementById('creatorAiManualYear');
        yearSelect.innerHTML = Array.from({ length: 16 }, (_, index) => activeYear + index)
            .map(year => `<option value="${year}">${year}</option>`).join('');
        yearSelect.value = String(activeYear + 1);
        const priority = document.getElementById('creatorAiManualPriority');
        priority.innerHTML = lists.priorities.map(value => `<option>${window.Formatters.escapeHtml(value)}</option>`).join('');
    }

    function setAiMode(mode) {
        const manual = mode === 'manual';
        document.getElementById('creatorAiChatMessages')?.classList.toggle('hidden', manual);
        document.getElementById('creatorAiDescriptionPanel')?.classList.toggle('hidden', manual);
        document.getElementById('creatorAiManualPanel')?.classList.toggle('hidden', !manual);
        aiChatMessages = [{
            role: 'assistant',
            text: manual
                ? 'Isi parameter prediksi manual. Pilih rutin bulanan untuk alokasi rata selama 12 bulan, atau tidak rutin untuk menempatkan seluruh budget pada satu tanggal.'
                : 'Ceritakan kebutuhan budget yang ingin dibuat. Saya akan membentuk baris usulan untuk diperiksa sebelum diimpor.'
        }];
        renderAiChat();
        if (manual) {
            const manualPane = document.getElementById('creatorAiManualPanel')?.closest('section');
            if (manualPane) manualPane.scrollTop = 0;
            document.getElementById('creatorAiManualDepartment')?.focus({ preventScroll: true });
            buildManualBudgetPreview();
        }
        else {
            updateAiPromptGuide();
            previewAiDraft();
        }
    }

    function updateAiPromptGuide() {
        const guide = document.getElementById('creatorAiPromptGuide');
        const text = document.getElementById('creatorAiPrompt')?.value.trim() || '';
        if (!guide || !text) return;
        const lists = getDatabaseLists();
        const missing = [];
        if (!findKnownValue(text, lists.departments) && !extractLabeledValue(text, ['departemen', 'dept'])) missing.push('Departemen');
        if (!findKnownValue(text, lists.accounts) && !extractLabeledValue(text, ['akun', 'account'])) missing.push('Akun');
        if (!findKnownValue(text, lists.projects) && !extractLabeledValue(text, ['proyek', 'project', 'site'])) missing.push('Proyek');
        const hints = [];
        if (missing.length) hints.push(`Lengkapi ${missing.join(', ')} agar baris masuk ke dimensi yang benar.`);
        if (/\b(?:setahun|tahunan|per tahun|12\s*bulan)\b/i.test(text) && !/\b(?:dibagi|per bulan|perbulan|bulanan)\b/i.test(text)) {
            hints.push('Jika angka yang ditulis total setahun, tambahkan “dibagi rata per bulan”.');
        }
        if (/(?:tanggal|dibutuhkan|deadline)\s*[:=]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i.test(text) && !/\b20\d{2}-\d{2}-\d{2}\b/.test(text)) {
            hints.push('Gunakan format tanggal YYYY-MM-DD, contoh 2027-03-15.');
        }
        if (!/\b(?:qty|jumlah|sebanyak|\d+(?:[.,]\d+)?\s*(?:unit|pcs|buah|paket|set|rim|dus|box|liter|kg|meter|bulan|orang))\b/i.test(text)) {
            hints.push('Sebutkan jumlah dan satuannya, contoh “12 bulan” atau “2 unit”.');
        }
        guide.textContent = hints.length
            ? hints.join(' ')
            : 'Format terbaca. Pastikan total tahunan/per bulan, satuan, spesifikasi, dan tanggal sudah jelas.';
        guide.className = `m-0 mt-1.5 min-h-8 text-[10px] leading-4 ${missing.length ? 'text-amber-300' : 'text-slate-400'}`;
    }

    function buildManualBudgetPreview() {
        const itemName = document.getElementById('creatorAiManualItem')?.value.trim() || '';
        const annualBudget = Number(document.getElementById('creatorAiManualAnnualBudget')?.value) || 0;
        const quantity = Number(document.getElementById('creatorAiManualQuantity')?.value) || 0;
        const department = document.getElementById('creatorAiManualDepartment')?.value || '';
        const account = document.getElementById('creatorAiManualAccount')?.value || '';
        const projects = getSelectedManualProjects();
        const recurring = document.getElementById('creatorAiManualRecurrence')?.value !== 'no';
        if (!itemName || !annualBudget || !quantity || !department || !account || !projects.length) {
            aiDraftRows = [];
            renderAiPreview();
            return;
        }

        const year = Number(document.getElementById('creatorAiManualYear')?.value) || getMonthlyTargetYear('setahun kedepan');
        const selectedMonth = Number(document.getElementById('creatorAiManualMonth')?.value) || 1;
        const dayInput = document.getElementById('creatorAiManualDay');
        const maxDay = new Date(year, selectedMonth, 0).getDate();
        const selectedDay = Math.min(maxDay, Math.max(1, Number(dayInput?.value) || 1));
        if (dayInput) {
            dayInput.max = String(maxDay);
            if (dayInput.value !== String(selectedDay)) dayInput.value = String(selectedDay);
        }
        const unit = document.getElementById('creatorAiManualUnit')?.value || 'unit';
        const specification = document.getElementById('creatorAiManualSpecification')?.value.trim() || '';
        const catatan = document.getElementById('creatorAiManualNote')?.value.trim() || '';
        const priority = document.getElementById('creatorAiManualPriority')?.value || 'Normal';
        const annualPerProject = annualBudget / projects.length;
        const amountPerRow = recurring ? annualPerProject / 12 : annualPerProject;
        const unitPrice = amountPerRow / quantity;
        const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        const allocations = recurring
            ? monthNames.map((monthName, monthIndex) => ({ monthName, monthIndex, day: 1 }))
            : [{ monthName: monthNames[selectedMonth - 1], monthIndex: selectedMonth - 1, day: selectedDay }];

        aiDraftRows = projects.flatMap(projectName => allocations.map(({ monthName, monthIndex, day }) => ({
            id: crypto.randomUUID(),
            ai_budget_id: currentAiBudgetId,
            department,
            account_name: account,
            project_name: projectName,
            item_name: itemName,
            specification: [specification, `Budget ${recurring ? 'tahunan' : 'sekali'} per proyek ${window.Formatters.formatRupiah(annualPerProject)}; alokasi ${day} ${monthName} ${year}${recurring ? ' (rutin bulanan)' : ''}.`].filter(Boolean).join(' '),
            catatan,
            quantity,
            unit,
            estimated_unit_price: unitPrice,
            priority,
            needed_by: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            status: 'Draft'
        })));
        renderAiPreview();
    }

    function renderManualProjectOptions(projects, selectedProjects = []) {
        const container = document.getElementById('creatorAiManualProjectOptions');
        if (!container) return;
        manualProjectOptions = [...new Set((projects || []).filter(Boolean))];
        container.innerHTML = manualProjectOptions.length ? manualProjectOptions.map(project => `
            <div class="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" data-project-option>
                <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input type="checkbox" class="h-4 w-4 accent-teal-400" value="${window.Formatters.escapeHtml(project)}" ${selectedProjects.includes(project) ? 'checked' : ''}>
                    <span class="min-w-0 truncate">${window.Formatters.escapeHtml(project)}</span>
                </label>
                <button type="button" class="px-1 text-slate-500 hover:text-rose-300" data-remove-project="${window.Formatters.escapeHtml(project)}" aria-label="Hapus ${window.Formatters.escapeHtml(project)} dari pilihan">×</button>
            </div>
        `).join('') : '<p class="m-0 p-1 text-[10px] text-slate-500">Belum ada referensi proyek UP.</p>';
        updateManualProjectCount();
    }

    function addManualProjectOption() {
        const input = document.getElementById('creatorAiManualProjectNew');
        const project = input?.value.trim();
        if (!project) return;
        const selected = getSelectedManualProjects();
        if (!manualProjectOptions.includes(project)) manualProjectOptions.push(project);
        if (!selected.includes(project)) selected.push(project);
        renderManualProjectOptions(manualProjectOptions, selected);
        input.value = '';
        filterManualProjects();
        buildManualBudgetPreview();
    }

    function getSelectedManualProjects() {
        return [...document.querySelectorAll('#creatorAiManualProjectOptions input[type="checkbox"]:checked')]
            .map(input => input.value);
    }

    function updateManualProjectCount() {
        const count = getSelectedManualProjects().length;
        const countEl = document.getElementById('creatorAiManualProjectCount');
        const rowsPerProject = document.getElementById('creatorAiManualRecurrence')?.value === 'no' ? 1 : 12;
        if (countEl) countEl.textContent = `${count} proyek dipilih${count ? ` · ${count * rowsPerProject} baris${rowsPerProject === 1 ? '' : ' bulanan'}` : ''}`;
    }

    function updateManualRecurrenceFields() {
        const recurring = document.getElementById('creatorAiManualRecurrence')?.value !== 'no';
        document.getElementById('creatorAiManualOneTimeDate')?.classList.toggle('hidden', recurring);
        updateManualProjectCount();
        buildManualBudgetPreview();
    }

    function filterManualProjects() {
        const query = (document.getElementById('creatorAiManualProjectSearch')?.value || '').trim().toLowerCase();
        document.querySelectorAll('#creatorAiManualProjectOptions [data-project-option]').forEach(label => {
            label.classList.toggle('hidden', !label.textContent.toLowerCase().includes(query));
        });
    }

    async function recommendManualBudget() {
        const button = document.getElementById('creatorAiRecommendButton');
        const status = document.getElementById('creatorAiManualStatus');
        const department = document.getElementById('creatorAiManualDepartment')?.value || '';
        const account = document.getElementById('creatorAiManualAccount')?.value || '';
        const projects = getSelectedManualProjects();
        const item = document.getElementById('creatorAiManualItem')?.value.trim() || '';
        const specification = document.getElementById('creatorAiManualSpecification')?.value.trim() || '';
        if (!department || !account || !projects.length || !item) {
            status.textContent = 'Pilih departemen, akun, minimal satu proyek, lalu isi kebutuhan/barang sebelum meminta rekomendasi.';
            status.className = 'm-0 sm:col-span-2 text-[10px] text-amber-300';
            return;
        }
        const client = window.SmartBaraCore.getClient();
        if (!client?.functions?.invoke) {
            status.textContent = 'Koneksi AI belum tersedia.';
            status.className = 'm-0 sm:col-span-2 text-[10px] text-rose-300';
            return;
        }

        button.disabled = true;
        button.textContent = '...';
        status.textContent = 'Menganalisis histori budget, rekonsil, dan sumber web...';
        status.className = 'm-0 sm:col-span-2 text-[10px] text-slate-400';
        try {
            const context = {
                period: window.SmartBaraCore.getActivePeriod(),
                department,
                account_name: account,
                project_names: projects,
                item_name: item,
                specification,
                quantity: Number(document.getElementById('creatorAiManualQuantity')?.value) || 1,
                unit: document.getElementById('creatorAiManualUnit')?.value || 'unit',
                current_annual_budget: Number(document.getElementById('creatorAiManualAnnualBudget')?.value) || 0,
                target_year: Number(document.getElementById('creatorAiManualYear')?.value) || getMonthlyTargetYear('tahun depan')
            };
            const { data, error } = await window.SmartBaraCore.invokeBudgetAiRequest({
                body: { action: 'recommend-budget', context }
            });
            if (error) throw new Error(await window.AISettingsModule.getErrorMessage(error));
            if (!data?.recommendation || !data?.sources?.length) throw new Error(data?.error || 'AI tidak mengembalikan rekomendasi beserta sumber web.');

            const recommendation = data.recommendation;
            document.getElementById('creatorAiManualAnnualBudget').value = String(Math.round(Number(recommendation.annualBudget) || 0));
            const sourceNotes = data.sources.map((source, index) => `${index + 1}. ${source.title} - ${source.url}`);
            const factors = Array.isArray(recommendation.factors) ? recommendation.factors.map(factor => `- ${factor}`) : [];
            const perProject = Number(recommendation.annualBudget) / projects.length;
            document.getElementById('creatorAiManualNote').value = [
                `Rekomendasi ${context.target_year}: kenaikan ${Number(recommendation.increasePercent || 0).toFixed(1)}%.`,
                `Pagu total ${window.Formatters.formatRupiah(recommendation.annualBudget)} dibagi rata ke ${projects.length} proyek (${window.Formatters.formatRupiah(perProject)} per proyek).`,
                recommendation.analysisNote || '',
                ...factors,
                'Sumber web:',
                ...sourceNotes
            ].filter(Boolean).join('\n');
            renderManualSources(data.sources);
            buildManualBudgetPreview();
            const rowsPerProject = document.getElementById('creatorAiManualRecurrence')?.value === 'no' ? 1 : 12;
            status.textContent = `Rekomendasi total ${window.Formatters.formatRupiah(recommendation.annualBudget)} untuk ${projects.length} proyek (${projects.length * rowsPerProject} baris), dari ${data.history?.length || 0} tahun histori dan ${data.sources.length} sumber web. Periksa sebelum dipakai.`;
            status.className = 'm-0 sm:col-span-2 text-[10px] text-emerald-300';
        } catch(error) {
            status.textContent = `Rekomendasi gagal: ${error.message}`;
            status.className = 'm-0 sm:col-span-2 text-[10px] text-rose-300';
        } finally {
            button.disabled = false;
            button.textContent = '✦ AI';
        }
    }

    function renderManualSources(sources) {
        const container = document.getElementById('creatorAiManualSources');
        if (!container) return;
        const links = (Array.isArray(sources) ? sources : []).filter(source => {
            try { return new URL(source.url).protocol === 'https:'; } catch(e) { return false; }
        });
        container.classList.toggle('hidden', !links.length);
        container.innerHTML = links.map(source => `
            <a href="${window.Formatters.escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" class="block truncate text-sky-300 hover:text-sky-200 underline" title="${window.Formatters.escapeHtml(source.title)}">
                ${window.Formatters.escapeHtml(source.title)}
            </a>
        `).join('');
    }

    function closeAiDialog() {
        const modal = document.getElementById('creatorAiModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 200);
    }

    function renderAiChat() {
        const container = document.getElementById('creatorAiChatMessages');
        if (!container) return;
        container.innerHTML = aiChatMessages.map(message => `
            <div class="flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}">
                <p class="m-0 max-w-[92%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-xs leading-5 ${message.role === 'user' ? 'border-teal-400/30 bg-teal-500/15 text-teal-50' : 'border-white/10 bg-white/[0.04] text-slate-300'}">${window.Formatters.escapeHtml(message.text)}</p>
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function findKnownValue(text, candidates) {
        const normalizedText = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
        return [...candidates].filter(Boolean).sort((a, b) => String(b).length - String(a).length)
            .find(candidate => {
                const normalizedCandidate = ` ${String(candidate).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
                return normalizedCandidate.trim() && normalizedText.includes(normalizedCandidate);
            }) || '';
    }

    function extractLabeledValue(text, labels) {
        for (const label of labels) {
            const match = String(text).match(new RegExp(`\\b${label}\\s*[:=]?\\s*([^,;\\n]+)`, 'i'));
            if (match) return match[1].trim();
        }
        return '';
    }

    function parseAiMoney(text) {
        const match = String(text).match(/(?:harga(?:\s+satuan)?|seharga|@|rp)\s*(?:rp\s*)?([\d.,]+(?:\s*(?:juta|jt|ribu|rb))?)/i);
        if (!match) return 0;
        const token = match[1].trim();
        const shorthand = token.match(/^([\d.,]+)\s*(juta|jt|ribu|rb)$/i);
        if (!shorthand) return window.Formatters.parseNumber(token, 0);
        const value = window.Formatters.parseNumber(shorthand[1], 0);
        return value * (/juta|jt/i.test(shorthand[2]) ? 1000000 : 1000);
    }

    function parseAiQuantity(text) {
        const unitPattern = 'unit|pcs|buah|paket|set|rim|dus|box|lembar|liter|kg|meter|bulan|orang|kegiatan';
        const match = String(text).match(new RegExp(`(?:sebanyak|qty|jumlah)\\s*[:=]?\\s*([\\d.,]+)(?:\\s*(${unitPattern}))?`, 'i'))
            || String(text).match(new RegExp(`([\\d.,]+)\\s*(${unitPattern})\\b`, 'i'))
            || String(text).match(/(?:butuh|membutuhkan|beli|membeli|pengadaan|sediakan)\s+([\d.,]+)/i)
            || String(text).match(/(?:^|[:,]\s*)([\d.,]+)\s+(?=[a-z])/i);
        if (!match) return { quantity: 1, unit: 'unit' };
        const quantity = window.Formatters.parseNumber(match[1], 1);
        return { quantity: quantity > 0 ? quantity : 1, unit: match[2] || 'unit' };
    }

    function parseAiDate(text) {
        const iso = String(text).match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (iso) return iso[1];
        const dmy = String(text).match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
        return dmy ? `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}` : '';
    }

    function requestsMonthlyAllocation(description) {
        return /\b(?:setahun|satu tahun|12\s*bulan|per bulan|perbulan|tiap bulan|setiap bulan|bulanan|monthly|dibagi(?:\s+(?:per|ke|menjadi))?\s+bulan)\b/i.test(String(description || ''));
    }

    function getMonthlyTargetYear(description) {
        const mentionedYears = [...String(description || '').matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
        if (mentionedYears.length) return mentionedYears[mentionedYears.length - 1];
        const activeYear = Number(String(window.SmartBaraCore.getActivePeriod()).match(/\d{4}/)?.[0]) || new Date().getFullYear();
        return /(?:setahun\s*ke\s*depan|satu\s+tahun\s*ke\s*depan|tahun\s+depan|kedepan)/i.test(String(description || '')) ? activeYear + 1 : activeYear;
    }

    function isAnnualTotalDescription(description) {
        const text = String(description || '');
        const annualContext = /\b(?:setahun|satu tahun|per tahun|tahunan|12\s*bulan|tahun depan)\b/i.test(text);
        const monthlyContext = /\b(?:dibagi|per bulan|perbulan|tiap bulan|setiap bulan|bulanan)\b/i.test(text);
        const hasAnnualAmount = /\b(?:total|jumlah keseluruhan|budget|anggaran|pagu|plafon)\b/i.test(text);
        const hasMonthlyUnitPrice = /(?:rp\s*[\d.,]+\s*(?:juta|jt|ribu|rb)?\s*(?:per|\/)\s*bulan|(?:per|\/)\s*bulan\s*[:=]?\s*rp\s*[\d.,]+)/i.test(text);
        return annualContext && monthlyContext && hasAnnualAmount && !hasMonthlyUnitPrice;
    }

    function resolveProjectName(projectName, description) {
        const projects = getDatabaseLists().projects;
        const exactProject = findKnownValue(projectName, projects);
        if (exactProject) return exactProject;
        const normalizedText = ` ${String(description || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
        const mentionedProjects = projects.filter(project => normalizedText.includes(` ${String(project).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `))
            .sort((left, right) => String(right).length - String(left).length);
        if (mentionedProjects.length === 1) return mentionedProjects[0];
        const labeledProject = extractLabeledValue(description, ['proyek up', 'proyek', 'project', 'site']);
        return findKnownValue(labeledProject, projects) || projectName || labeledProject;
    }

    function expandMonthlyBudgetRows(rows, description, pricesAreMonthly = false) {
        const normalizedRows = rows.map(row => ({ ...row, project_name: resolveProjectName(row.project_name, description) || '' }));
        if (!requestsMonthlyAllocation(description)) return normalizedRows;

        const targetYear = getMonthlyTargetYear(description);
        const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        const groupedRows = new Map();
        normalizedRows.forEach(row => {
            const key = [row.department, row.account_name, row.project_name, row.item_name, row.unit, row.priority]
                .map(value => String(value || '').trim().toLowerCase()).join('|');
            if (!groupedRows.has(key)) groupedRows.set(key, []);
            groupedRows.get(key).push(row);
        });

        return [...groupedRows.values()].flatMap(group => {
            const rowsByMonth = new Map();
            group.forEach(row => {
                const match = String(row.needed_by || '').match(new RegExp(`^${targetYear}-(\\d{2})`));
                if (match) rowsByMonth.set(Number(match[1]), row);
            });
            if (rowsByMonth.size === 12) return group;

            const hasMonthlyValues = rowsByMonth.size > 0;
            const divideAnnualAmount = !pricesAreMonthly && !hasMonthlyValues && isAnnualTotalDescription(description);
            const baseRow = group[0];
            const annualPrice = Number(baseRow.estimated_unit_price) || 0;
            return monthNames.map((monthName, monthIndex) => {
                const monthRow = rowsByMonth.get(monthIndex + 1) || baseRow;
                return {
                    ...monthRow,
                    id: crypto.randomUUID(),
                    quantity: /bulan/i.test(String(monthRow.unit || '')) && Number(monthRow.quantity) >= 12 ? 1 : Number(monthRow.quantity) || 1,
                    estimated_unit_price: divideAnnualAmount ? annualPrice / 12 : Number(monthRow.estimated_unit_price) || 0,
                    specification: [monthRow.specification, `Alokasi ${monthName} ${targetYear}.`].filter(Boolean).join(' '),
                    needed_by: `${targetYear}-${String(monthIndex + 1).padStart(2, '0')}-01`,
                    status: monthRow.status || 'Draft'
                };
            });
        });
    }

    function parseBudgetDescription(description) {
        const lists = getDatabaseLists();
        const globalDepts = window.SmartBaraCore.getSelectedDepartments();
        const defaultDept = globalDepts.length === 1 ? globalDepts[0] : lists.departments[0] || '';
        const lines = String(description || '').split(/[\n;]+/).map(line => line.trim()).filter(Boolean);
        const inheritedDept = findKnownValue(description, lists.departments) || extractLabeledValue(description, ['departemen', 'dept']) || defaultDept;
        const inheritedAccount = findKnownValue(description, lists.accounts) || extractLabeledValue(description, ['akun', 'account']);
        const inheritedProject = findKnownValue(description, lists.projects) || extractLabeledValue(description, ['proyek', 'project', 'site']);
        const drafts = [];

        lines.forEach(line => {
            const dept = findKnownValue(line, lists.departments) || extractLabeledValue(line, ['departemen', 'dept']) || inheritedDept;
            const account = findKnownValue(line, lists.accounts) || extractLabeledValue(line, ['akun', 'account']) || inheritedAccount;
            const project = findKnownValue(line, lists.projects) || extractLabeledValue(line, ['proyek', 'project', 'site']) || inheritedProject;
            const itemSegments = line.split(/\s+(?:dan|serta)\s+(?=\d+(?:[.,]\d+)?\s*(?:unit|pcs|buah|paket|set|rim|dus|box|lembar|kg|meter)\b)/i);

            itemSegments.forEach(segment => {
                const { quantity, unit } = parseAiQuantity(segment);
                const price = parseAiMoney(segment);
                const priority = /prioritas\s+tinggi|urgent|mendesak/i.test(segment) ? 'Tinggi' : /prioritas\s+rendah/i.test(segment) ? 'Rendah' : 'Normal';
                const specificationMatch = segment.match(/(?:spesifikasi|spek|alasan|keterangan)\s*[:=]?\s*(.+?)(?=,|;|$)/i);
                let itemName = segment;
                [
                    [/\b(?:departemen|dept)\s*[:=]?\s*/i, dept],
                    [/\b(?:akun|account)\s*[:=]?\s*/i, account],
                    [/\b(?:proyek\s+up|proyek|project|site)\s*[:=]?\s*/i, project]
                ].forEach(([labelPattern, value]) => {
                    if (!value) return;
                    itemName = itemName.replace(new RegExp(`${labelPattern.source}${escapeRegExp(value)}`, 'i'), ' ');
                    itemName = itemName.replace(new RegExp(`\\b${escapeRegExp(value)}\\b`, 'ig'), ' ');
                });
                itemName = itemName
                    .replace(/(?:harga(?:\s+satuan)?|seharga|@|rp)\s*(?:rp\s*)?[\d.,]+(?:\s*(?:juta|jt|ribu|rb))?/ig, ' ')
                    .replace(/(?:prioritas\s+(?:tinggi|normal|rendah)|urgent|mendesak|prioritas)/ig, ' ')
                    .replace(/(?:tanggal\s+dibutuhkan|dibutuhkan\s+tanggal|deadline)\s*[:=]?\s*\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/ig, ' ')
                    .replace(/\b(?:dibagi(?:\s+rata)?(?:\s+(?:per|ke|menjadi))?\s+bulan|per bulan|perbulan|tiap bulan|setiap bulan|bulanan|monthly)\b/ig, ' ')
                    .replace(/\b(?:setahun\s*ke\s*depan|satu\s+tahun\s*ke\s*depan|setahun|satu tahun|per tahun|tahunan|12\s*bulan|tahun depan|kedepan|ke depan|anggaran|budget|pagu|plafon)\b/ig, ' ')
                    .replace(/(?:spesifikasi|spek|alasan|keterangan)\s*[:=]?\s*.+$/i, ' ')
                    .replace(/\b(?:departemen|dept|akun|account|proyek\s+up|proyek|project|site)\s*[:=]?/ig, ' ')
                    .replace(/\b(?:butuh|membutuhkan|beli|membeli|pengadaan|sediakan|adakan)\b/ig, ' ')
                    .replace(/\b(?:sebanyak|qty|jumlah)\s*[:=]?\s*[\d.,]+/ig, ' ')
                    .replace(/\b[\d.,]+\s*(?:unit|pcs|buah|paket|set|rim|dus|box|lembar|liter|kg|meter|bulan|orang|kegiatan)\b/ig, ' ')
                    .replace(/^\s*[\d.,]+\s+/, ' ');
                [dept, account, project].filter(Boolean).forEach(value => {
                    itemName = itemName.replace(new RegExp(escapeRegExp(value), 'ig'), ' ');
                });
                itemName = itemName.replace(/^[\s,:.-]+|[\s,:.-]+$/g, '').replace(/\s+[,;:]+/g, ' ').replace(/\s{2,}/g, ' ');
                if (!itemName || /^(untuk|dan|serta)$/i.test(itemName)) itemName = 'Kebutuhan budget';

                drafts.push({
                    id: crypto.randomUUID(),
                    department: dept,
                    account_name: account,
                    project_name: project,
                    item_name: itemName,
                    specification: specificationMatch?.[1]?.trim() || '',
                    quantity,
                    unit,
                    estimated_unit_price: price,
                    priority,
                    needed_by: parseAiDate(segment),
                    status: 'Draft'
                });
            });
        });
        return drafts;
    }

    async function createAiDraft(description) {
        const functionName = window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION;
        const client = window.SmartBaraCore.getClient();
        if (!client) throw new Error('Server AI belum tersedia.');

        const { data, error } = await window.SmartBaraCore.invokeBudgetAiRequest({
            body: {
                prompt: description,
                period: window.SmartBaraCore.getActivePeriod(),
                dimensions: getDatabaseLists(),
                monthlyAllocation: requestsMonthlyAllocation(description),
                monthlyTargetYear: getMonthlyTargetYear(description)
            }
        });
        if (error) throw new Error(`Server AI gagal: ${await window.AISettingsModule.getErrorMessage(error)}`);
        const resultRows = Array.isArray(data) ? data : data?.items;
        if (!Array.isArray(resultRows) || !resultRows.length) throw new Error(data?.error || 'Server AI tidak mengembalikan item budget.');
        const rows = resultRows.map(row => ({
            id: crypto.randomUUID(), department: row.department || '', account_name: row.account_name || '',
            project_name: row.project_name || '', item_name: row.item_name || '', specification: row.specification || '', catatan: row.catatan || '',
            quantity: Number(row.quantity) || 1, unit: row.unit || 'unit', estimated_unit_price: Number(row.estimated_unit_price) || 0,
            priority: row.priority || 'Normal', needed_by: row.needed_by || '', status: 'Draft'
        }));
        return { rows: expandMonthlyBudgetRows(rows, description), source: 'AI', provider: data.provider || 'AI' };
    }

    function previewAiDraft() {
        const prompt = document.getElementById('creatorAiPrompt')?.value || '';
        aiDraftRows = prompt.trim()
            ? expandMonthlyBudgetRows(parseBudgetDescription(prompt), prompt).map(row => ({ ...row, ai_budget_id: currentAiBudgetId }))
            : [];
        renderAiPreview();
    }

    async function sendAiMessage() {
        const input = document.getElementById('creatorAiPrompt');
        const prompt = input?.value.trim();
        if (!prompt) return;
        currentAiBudgetId = createAiBudgetId();
        isEditingExistingAiBatch = false;
        updateAiBudgetIdDisplay();
        aiChatMessages.push({ role: 'user', text: prompt });
        renderAiChat();
        const sendButton = document.querySelector('#creatorAiModal button[onclick="BudgetCreatorModule.sendAiMessage()"]');
        if (sendButton) sendButton.disabled = true;
        const status = document.getElementById('creatorAiImportStatus');
        if (status) status.textContent = 'Menyusun preview...';
        try {
            const result = await createAiDraft(prompt);
            aiDraftRows = result.rows.map(row => ({ ...row, ai_budget_id: currentAiBudgetId }));
            const total = aiDraftRows.reduce((sum, row) => sum + row.quantity * row.estimated_unit_price, 0);
            const sourceNote = `Draf dibuat oleh ${result.provider || 'AI'}.`;
            aiChatMessages.push({ role: 'assistant', text: `${sourceNote} Saya menyiapkan ${aiDraftRows.length} baris dengan estimasi ${window.Formatters.formatRupiah(total)}. Periksa dan sesuaikan preview sebelum impor.` });
            renderAiChat();
            renderAiPreview();
            if (input) input.value = '';
            if (status) status.textContent = result.source === 'AI' ? 'Preview siap ditinjau.' : 'Preview lokal siap ditinjau.';
        } catch(error) {
            aiChatMessages.push({ role: 'assistant', text: `Saya belum dapat menyusun preview: ${error.message}` });
            renderAiChat();
        } finally {
            if (sendButton) sendButton.disabled = false;
        }
    }

    function renderAiPreview() {
        const tbody = document.getElementById('creatorAiPreviewBody');
        if (!tbody) return;
        const options = getDatabaseLists().departments;
        const total = aiDraftRows.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.estimated_unit_price) || 0), 0);
        document.getElementById('creatorAiPreviewCount').textContent = `${aiDraftRows.length.toLocaleString('id-ID')} baris`;
        document.getElementById('creatorAiPreviewTotal').textContent = window.Formatters.formatRupiah(total);
        const importButton = document.getElementById('creatorAiImportButton');
        importButton.disabled = aiDraftRows.length === 0;
        importButton.textContent = isEditingExistingAiBatch ? 'Simpan Perubahan' : 'Import ke Database';
        if (!aiDraftRows.length) {
            tbody.innerHTML = '<tr><td colspan="13" class="py-10 text-center text-slate-500">Preview budget akan tampil di sini.</td></tr>';
            return;
        }
        const priorities = ['Tinggi', 'Normal', 'Rendah'];
        const statuses = ['Draft', 'Diajukan', 'Disetujui', 'Ditolak'];
        tbody.innerHTML = aiDraftRows.map((row, index) => `
            <tr>
                <td><select class="form-select w-32 text-[11px]" data-ai-row="${index}" data-ai-field="department">${options.map(dept => `<option value="${window.Formatters.escapeHtml(dept)}" ${dept === row.department ? 'selected' : ''}>${window.Formatters.escapeHtml(dept)}</option>`).join('')}</select></td>
                <td><input class="form-input w-36 text-[11px]" data-ai-row="${index}" data-ai-field="account_name" list="creatorAccountReferenceOptions" value="${window.Formatters.escapeHtml(row.account_name)}" placeholder="Nama akun"></td>
                <td><input class="form-input w-36 text-[11px]" data-ai-row="${index}" data-ai-field="project_name" list="creatorProjectReferenceOptions" value="${window.Formatters.escapeHtml(row.project_name)}" placeholder="Proyek"></td>
                <td><input class="form-input w-44 text-[11px]" data-ai-row="${index}" data-ai-field="item_name" value="${window.Formatters.escapeHtml(row.item_name)}"></td>
                <td><input class="form-input w-44 text-[11px]" data-ai-row="${index}" data-ai-field="specification" value="${window.Formatters.escapeHtml(row.specification)}"></td>
                <td><textarea rows="2" class="form-textarea w-64 text-[11px]" data-ai-row="${index}" data-ai-field="catatan">${window.Formatters.escapeHtml(row.catatan || '')}</textarea></td>
                <td><input type="date" class="form-input w-36 text-[11px]" data-ai-row="${index}" data-ai-field="needed_by" value="${window.Formatters.escapeHtml(row.needed_by)}"></td>
                <td><div class="flex items-center gap-1"><input type="number" min="0.01" step="any" class="form-input w-20 text-right text-[11px]" data-ai-row="${index}" data-ai-field="quantity" value="${row.quantity}"><input class="form-input w-20 text-[11px]" data-ai-row="${index}" data-ai-field="unit" value="${window.Formatters.escapeHtml(row.unit)}" aria-label="Satuan"></div></td>
                <td><input type="number" min="0" step="1000" class="form-input w-32 text-right text-[11px]" data-ai-row="${index}" data-ai-field="estimated_unit_price" value="${row.estimated_unit_price}"></td>
                <td class="text-right font-extrabold text-teal-300" data-ai-total="${index}">${window.Formatters.formatRupiah((Number(row.quantity) || 0) * (Number(row.estimated_unit_price) || 0))}</td>
                <td><select class="form-select w-24 text-[11px]" data-ai-row="${index}" data-ai-field="priority">${priorities.map(priority => `<option ${priority === row.priority ? 'selected' : ''}>${priority}</option>`).join('')}</select></td>
                <td><select class="form-select w-28 text-[11px]" data-ai-row="${index}" data-ai-field="status">${statuses.map(status => `<option ${status === row.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td>
                <td><button type="button" class="text-rose-300 hover:text-rose-200" data-ai-remove="${index}" aria-label="Hapus baris preview">Hapus</button></td>
            </tr>
        `).join('');
        tbody.querySelectorAll('[data-ai-field]').forEach(input => {
            input.addEventListener('input', updateAiDraftField);
            input.addEventListener('change', updateAiDraftField);
        });
        tbody.querySelectorAll('[data-ai-remove]').forEach(button => button.addEventListener('click', () => {
            aiDraftRows.splice(Number(button.dataset.aiRemove), 1);
            renderAiPreview();
        }));
    }

    function updateAiDraftField(event) {
        const input = event.currentTarget;
        const row = aiDraftRows[Number(input.dataset.aiRow)];
        if (!row) return;
        const field = input.dataset.aiField;
        row[field] = field === 'quantity' || field === 'estimated_unit_price' ? Number(input.value) || 0 : input.value;
        if (field === 'quantity' || field === 'estimated_unit_price') {
            const totalCell = document.querySelector(`[data-ai-total="${input.dataset.aiRow}"]`);
            if (totalCell) totalCell.textContent = window.Formatters.formatRupiah((Number(row.quantity) || 0) * (Number(row.estimated_unit_price) || 0));
        }
        const total = aiDraftRows.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_unit_price) || 0), 0);
        document.getElementById('creatorAiPreviewTotal').textContent = window.Formatters.formatRupiah(total);
    }

    function addAiDraftRow() {
        const lists = getDatabaseLists();
        const selected = window.SmartBaraCore.getSelectedDepartments();
        aiDraftRows.push({
            id: crypto.randomUUID(), ai_budget_id: currentAiBudgetId, department: selected.length === 1 ? selected[0] : lists.departments[0] || '',
            account_name: '', project_name: '', item_name: '', specification: '', catatan: '', quantity: 1, unit: 'unit',
            estimated_unit_price: 0, priority: 'Normal', needed_by: '', status: 'Draft'
        });
        renderAiPreview();
    }

    async function importAiDraft() {
        const validRows = aiDraftRows.filter(row => row.department && row.item_name.trim() && Number(row.quantity) > 0);
        if (!validRows.length) {
            document.getElementById('creatorAiImportStatus').textContent = 'Isi departemen, nama kebutuhan, dan jumlah pada preview.';
            return;
        }
        if (!window.SmartBaraCore.canWriteCloud()) {
            document.getElementById('creatorAiImportStatus').textContent = 'Masuk dengan akun yang memiliki akses tulis untuk mengimpor ke database.';
            return;
        }

        const statusEl = document.getElementById('creatorAiImportStatus');
        const period = window.SmartBaraCore.getActivePeriod();
        const user = window.SmartBaraCore.getUser();
        const existingById = new Map(items.map(item => [String(item.id), item]));

        // Status final hanya boleh diubah Superadmin.
        if (!window.SmartBaraCore.canApproveAllDepartments()) {
            const forbidden = validRows.find(row => FINAL_STATUSES.includes(row.status) && existingById.get(String(row.id))?.status !== row.status);
            if (forbidden) {
                statusEl.textContent = `Status "${forbidden.status}" hanya dapat diberikan Superadmin. Ubah baris "${forbidden.item_name}" ke Draft/Diajukan.`;
                return;
            }
        }

        if (!currentAiBudgetId) currentAiBudgetId = createAiBudgetId();
        updateAiBudgetIdDisplay();
        const imported = validRows.map(row => {
            const existing = existingById.get(String(row.id));
            return {
                ...row,
                id: row.id || crypto.randomUUID(),
                ai_budget_id: currentAiBudgetId,
                period_name: period,
                department: String(row.department).trim(),
                account_name: String(row.account_name || '').trim(),
                project_name: String(row.project_name || '').trim(),
                item_name: String(row.item_name).trim(),
                specification: String(row.specification || '').trim(),
                catatan: String(row.catatan || '').trim(),
                quantity: Number(row.quantity) || 1,
                unit: String(row.unit || 'unit').trim() || 'unit',
                estimated_unit_price: Number(row.estimated_unit_price) || 0,
                priority: PRIORITIES.includes(row.priority) ? row.priority : 'Normal',
                needed_by: row.needed_by || null,
                created_by: row.created_by || user?.id || null,
                status: STATUSES.includes(row.status) ? row.status : 'Draft',
                // Baseline versi dipakai untuk deteksi konflik, bukan dikirim apa adanya.
                updated_at: existing?.updated_at
            };
        });
        const updatedCount = imported.filter(row => existingById.has(String(row.id))).length;
        const addedCount = imported.length - updatedCount;

        const importButton = document.getElementById('creatorAiImportButton');
        if (importButton) importButton.disabled = true;
        try {
            if (storageMode === 'table' && updatedCount && window.SmartBaraCore.canWriteCloud()) {
                statusEl.textContent = 'Memeriksa perubahan dari pengguna lain...';
                const conflicts = await findRemoteConflicts(imported.filter(row => existingById.has(String(row.id))));
                if (conflicts.length) {
                    statusEl.textContent = `${conflicts.length} baris sudah diubah pengguna lain sejak dimuat. Muat ulang ID ini sebelum menyimpan agar tidak menimpa perubahan mereka.`;
                    return;
                }
            }
            const result = await commitRows(imported, { title: 'Menyimpan Budget AI', label: 'Budget Creator AI' });
            const summary = describeCommitResult(result);
            if (result.failed.length) {
                statusEl.textContent = `Sebagian gagal disimpan — ${summary}. Baris gagal tetap di preview; perbaiki lalu simpan lagi.`;
                const failedIds = new Set(result.failed.map(row => String(row.id)));
                aiDraftRows = aiDraftRows.filter(row => failedIds.has(String(row.id)));
                renderAiPreview();
                return;
            }
            setStatus(`Budget AI ${getAiBudgetDisplayId(currentAiBudgetId)}: ${updatedCount} diperbarui, ${addedCount} ditambahkan. ${summary}.`);
            closeAiDialog();
        } catch(error) {
            console.error('Import AI budget error:', error);
            statusEl.textContent = `Penyimpanan gagal: ${error.message}`;
        } finally {
            if (importButton) importButton.disabled = aiDraftRows.length === 0;
        }
    }

    function canApproveBudgetRequests() {
        return window.SmartBaraCore.canApproveAllDepartments();
    }

    async function approveBudgetItem(id) {
        if (!canApproveBudgetRequests()) {
            setStatus('Hanya akun Superadmin yang dapat menyetujui kebutuhan. Semua Superadmin dapat approve semua departemen.', true);
            return;
        }
        const item = items.find(it => it.id === id);
        if (!item) return;
        const period = window.SmartBaraCore.getActivePeriod();
        const nextItem = {
            ...item,
            status: 'Disetujui',
            approved_by: window.SmartBaraCore.getUser()?.email || 'superadmin',
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const nextItems = items.map(it => it.id === id ? nextItem : it);
        items = nextItems;
        persistLocal(period, nextItems);
        renderTable();

        try {
            if (storageMode === 'settings') {
                await window.SmartBaraCore.syncVersionedRow('smartbara_settings', period, { key: `budget_creator_planning_${period}` }, { value: nextItems }, 'budgetCreatorFallback', 'approval settings');
            } else {
                const { id: itemId, period_name: rowPeriod, ...values } = nextItem;
                await window.SmartBaraCore.syncVersionedRow('smartbara_budget_creator_planning', period, { id: itemId, period_name: rowPeriod || period }, values, `budgetCreator:${itemId}`, 'Budget Creator approval');
            }
            setStatus(`Kebutuhan ${nextItem.item_name} berhasil disetujui oleh ${nextItem.approved_by}.`);
        } catch (error) {
            console.warn('Budget approval sync error:', error);
            setStatus(`Disetujui lokal, sinkronisasi cloud gagal: ${error.message}`, true);
        }
    }

    function getAccountGroupKey(item) {
        const departmentKey = String(item.department || '').trim().toUpperCase();
        const accountKey = String(item.account_name || 'Akun tanpa nama').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
        return JSON.stringify([departmentKey, accountKey]);
    }

    function getFilteredItems() {
        const search = (document.getElementById('creatorSearch')?.value || '').toLowerCase().trim();
        const dept = document.getElementById('creatorDeptFilter')?.value || '';
        const status = document.getElementById('creatorStatusFilter')?.value || '';
        const selectedDepts = new Set(window.SmartBaraCore.getSelectedDepartments().map(value => String(value).toUpperCase()));
        const filterByGlobalDept = !window.SmartBaraCore.isCombinedDepartments();
        const exactBatchIds = new Set(items.filter(item => {
            const batchId = String(item.ai_budget_id || '');
            return batchId.toLowerCase() === search || getAiBudgetDisplayId(batchId).toLowerCase() === search;
        }).map(item => String(item.ai_budget_id || '')));
        if (search && exactBatchIds.size) return items.filter(item => exactBatchIds.has(String(item.ai_budget_id || '')));

        return items.filter(item => {
            if (filterByGlobalDept && !selectedDepts.has(String(item.department || '').toUpperCase())) return false;
            if (dept && item.department !== dept) return false;
            if (status && item.status !== status) return false;
            if (!search) return true;
            return [item.item_name, item.account_name, item.project_name, item.specification, item.catatan, item.department, item.ai_budget_id]
                .some(v => String(v || '').toLowerCase().includes(search));
        });
    }

    function syncDepartmentFilterOptions() {
        const deptFilter = document.getElementById('creatorDeptFilter');
        if (!deptFilter) return;
        const selectedDepts = new Set(window.SmartBaraCore.getSelectedDepartments().map(value => String(value).toUpperCase()));
        const filterByGlobalDept = !window.SmartBaraCore.isCombinedDepartments();
        const depts = [...new Set(items.map(item => item.department).filter(Boolean))]
            .filter(dept => !filterByGlobalDept || selectedDepts.has(String(dept).toUpperCase()))
            .sort();
        const currentValue = deptFilter.value;
        while (deptFilter.children.length > 1) deptFilter.lastElementChild.remove();
        depts.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept;
            option.textContent = dept;
            deptFilter.appendChild(option);
        });
        deptFilter.value = depts.includes(currentValue) ? currentValue : '';
    }

    function renderTable() {
        const tbody = document.getElementById('creatorTableBody');
        const countEl = document.getElementById('creatorStatCount');
        const totalEl = document.getElementById('creatorStatTotal');
        const highEl = document.getElementById('creatorStatHigh');
        const pendingEl = document.getElementById('creatorStatPending');
        syncDepartmentFilterOptions();

        const filtered = getFilteredItems();
        const totalRp = filtered.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimated_unit_price) || 0), 0);
        const highCount = filtered.filter(it => it.priority === 'Tinggi').length;
        const pendingCount = filtered.filter(it => it.status === 'Diajukan').length;

        if (countEl) countEl.textContent = filtered.length.toLocaleString('id-ID');
        if (totalEl) totalEl.textContent = window.Formatters.formatRupiah(totalRp);
        if (highEl) highEl.textContent = highCount.toLocaleString('id-ID');
        if (pendingEl) pendingEl.textContent = pendingCount.toLocaleString('id-ID');

        if (!tbody) return;

        if (!filtered.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-12 text-slate-500 font-medium">
                        Belum ada kebutuhan perencanaan yang sesuai. Klik <strong>+ Tambah Kebutuhan</strong> atau <strong>Import Excel</strong>.
                    </td>
                </tr>
            `;
            return;
        }

        const groups = new Map();
        filtered.forEach((item, index) => {
            const key = getAccountGroupKey(item);
            const group = groups.get(key) || { key, department: item.department || '-', account: item.account_name || 'Akun tanpa nama', rows: [] };
            group.rows.push({ item, index });
            groups.set(key, group);
        });

        const canApprove = canApproveBudgetRequests();
        const displayRows = [];
        let groupNumber = 0;
        groups.forEach(group => {
            const currentGroupNumber = ++groupNumber;
            displayRows.push({ type: 'account', group, groupNumber: currentGroupNumber });
            if (expandedAccountGroups.has(group.key)) {
                group.rows.forEach((row, projectIndex) => displayRows.push({ type: 'item', ...row, groupNumber: currentGroupNumber, projectIndex }));
            }
        });

        tbody.innerHTML = displayRows.map(entry => {
            if (entry.type === 'account') {
                const { group, groupNumber: number } = entry;
                const isExpanded = expandedAccountGroups.has(group.key);
                const projectCount = new Set(group.rows.map(({ item }) => String(item.project_name || '').trim()).filter(Boolean)).size;
                const batchCount = new Set(group.rows.map(({ item }) => String(item.ai_budget_id || '').trim()).filter(Boolean)).size;
                const groupTotal = group.rows.reduce((sum, { item }) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_unit_price) || 0), 0);
                const highCount = group.rows.filter(({ item }) => item.priority === 'Tinggi').length;
                const statuses = [...new Set(group.rows.map(({ item }) => item.status).filter(Boolean))];
                const groupStatus = statuses.length === 1 ? statuses[0] : 'Beragam';
                const statusBadge = groupStatus === 'Disetujui' ? 'badge-emerald' : groupStatus === 'Ditolak' ? 'badge-rose' : groupStatus === 'Diajukan' ? 'badge-amber' : 'badge-teal';
                return `
                    <tr class="border-b border-teal-400/15 bg-slate-800/80 font-bold">
                        <td class="bg-slate-800/80 px-2 py-2 text-center text-xs text-teal-300">${number}</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-xs text-slate-300">${window.Formatters.escapeHtml(group.department)}</td>
                        <td class="bg-slate-800/80 px-2 py-2">
                            <button type="button" data-creator-group-toggle data-group-key="${window.Formatters.escapeHtml(group.key)}" aria-expanded="${isExpanded}" class="flex items-center gap-2 text-left text-white hover:text-teal-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400">
                                <span class="text-teal-300" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
                                <span>${window.Formatters.escapeHtml(group.account)}</span>
                            </button>
                        </td>
                        <td class="bg-slate-800/80 px-2 py-2 text-xs text-slate-400">${projectCount} proyek · ${group.rows.length} kebutuhan</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-xs text-slate-400">${batchCount ? `${batchCount} ID AI` : 'Manual'}</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-xs text-slate-400">${group.rows.length} item</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-right">
                            <button type="button" data-creator-group-delete data-group-key="${window.Formatters.escapeHtml(group.key)}" class="whitespace-nowrap text-[10px] font-bold text-rose-300 hover:text-rose-200" title="Hapus seluruh kebutuhan dalam grup ini" aria-label="Hapus semua kebutuhan ${window.Formatters.escapeHtml(group.account)} di ${window.Formatters.escapeHtml(group.department)}">Hapus semua</button>
                        </td>
                        <td class="bg-slate-800/80"></td>
                        <td class="bg-slate-800/80"></td>
                        <td class="bg-slate-800/80 px-2 py-2 text-right text-xs text-slate-400">${group.rows.length} baris</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-right text-xs text-slate-400">—</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-right text-xs font-black tabular-nums text-teal-300">${window.Formatters.formatRupiah(groupTotal)}</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-center text-[10px] text-slate-300">${highCount ? `${highCount} prioritas tinggi` : 'Normal'}</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-center"><span class="badge ${statusBadge}">${window.Formatters.escapeHtml(groupStatus)}</span></td>
                        <td class="bg-slate-800/80"></td>
                    </tr>
                `;
            }

            const item = entry.item;
            const subtotal = (Number(item.quantity) || 0) * (Number(item.estimated_unit_price) || 0);
            const prioBadge = item.priority === 'Tinggi' ? 'badge-rose' : item.priority === 'Rendah' ? 'badge-indigo' : 'badge-amber';
            const statusBadge = item.status === 'Disetujui' ? 'badge-emerald' : item.status === 'Ditolak' ? 'badge-rose' : item.status === 'Diajukan' ? 'badge-amber' : 'badge-teal';

            return `
                <tr class="hover:bg-white/[0.03]">
                    <td class="text-center text-xs font-bold text-slate-500">${entry.groupNumber}.${entry.projectIndex + 1}</td>
                    <td class="font-bold text-white">${window.Formatters.escapeHtml(item.department)}</td>
                    <td class="text-slate-500">↳</td>
                    <td class="text-slate-300">${window.Formatters.escapeHtml(item.project_name || '-')}</td>
                    <td class="whitespace-nowrap">${item.ai_budget_id ? `<button type="button" class="font-mono text-[10px] text-sky-300 underline hover:text-sky-200" data-ai-budget-id="${window.Formatters.escapeHtml(item.ai_budget_id)}" title="Kode ${getAiBudgetDisplayId(item.ai_budget_id)} · ID internal ${window.Formatters.escapeHtml(item.ai_budget_id)}">${getAiBudgetDisplayId(item.ai_budget_id)}</button>` : '<span class="text-slate-600">-</span>'}</td>
                    <td class="font-bold text-teal-300">${window.Formatters.escapeHtml(item.item_name)}</td>
                    <td class="text-slate-400 max-w-xs truncate" title="${window.Formatters.escapeHtml(item.specification || '')}">${window.Formatters.escapeHtml(item.specification || '-')}</td>
                    <td class="text-slate-400 max-w-xs truncate" title="${window.Formatters.escapeHtml(item.catatan || '')}">${window.Formatters.escapeHtml(item.catatan || '-')}</td>
                    <td class="text-slate-400 whitespace-nowrap">${window.Formatters.escapeHtml(item.needed_by || '-')}</td>
                    <td class="text-right font-semibold text-white">${window.Formatters.formatNumber(item.quantity)} <span class="text-slate-400 font-normal text-[11px]">${window.Formatters.escapeHtml(item.unit)}</span></td>
                    <td class="text-right text-slate-300">${window.Formatters.formatRupiah(item.estimated_unit_price)}</td>
                    <td class="text-right font-extrabold text-teal-400">${window.Formatters.formatRupiah(subtotal)}</td>
                    <td class="text-center"><span class="badge ${prioBadge}">${window.Formatters.escapeHtml(item.priority)}</span></td>
                    <td class="text-center"><span class="badge ${statusBadge}">${window.Formatters.escapeHtml(item.status)}</span></td>
                    <td class="text-right whitespace-nowrap">
                        <button type="button" data-creator-action="edit" data-item-id="${window.Formatters.escapeHtml(item.id)}" class="text-teal-400 hover:text-teal-300 font-bold text-xs mr-2">Edit</button>
                        ${item.status === 'Diajukan' && canApprove ? `<button type="button" data-creator-action="approve" data-item-id="${window.Formatters.escapeHtml(item.id)}" class="text-emerald-400 hover:text-emerald-300 font-bold text-xs mr-2">Approve</button>` : ''}
                        <button type="button" data-creator-action="delete" data-item-id="${window.Formatters.escapeHtml(item.id)}" class="text-rose-400 hover:text-rose-300 font-bold text-xs">Hapus</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function loadAiBudgetById() {
        const input = document.getElementById('creatorAiBudgetSearchId');
        const status = document.getElementById('creatorAiImportStatus');
        const budgetId = String(input?.value || '').trim().toUpperCase();
        if (!budgetId) {
            if (status) status.textContent = 'Masukkan ID Budget AI yang ingin dimuat.';
            return;
        }

        const period = window.SmartBaraCore.getActivePeriod();
        const isShortId = /^[A-Z0-9]{6}$/.test(budgetId);
        const matchesId = item => {
            const itemId = String(item.ai_budget_id || '');
            return itemId.toUpperCase() === budgetId || (isShortId && getAiBudgetDisplayId(itemId) === budgetId);
        };
        let matching = items.filter(matchesId);
        const client = window.SmartBaraCore.getClient();
        if (client) {
            try {
                let query = client.from('smartbara_budget_creator_planning').select('*').eq('period_name', period);
                if (!isShortId) query = query.eq('ai_budget_id', budgetId);
                const { data, error } = await query.order('created_at', { ascending: true });
                if (error) throw error;
                const remoteMatches = (data || []).filter(matchesId);
                if (remoteMatches.length) matching = remoteMatches;
            } catch(error) {
                if (!matching.length) {
                    if (status) status.textContent = `Gagal memuat ID ${budgetId}: ${error.message}`;
                    return;
                }
            }
        }

        if (!matching.length) {
            if (status) status.textContent = `Budget AI dengan ID ${budgetId} tidak ditemukan pada periode ${period}.`;
            return;
        }

        if (new Set(matching.map(item => String(item.ai_budget_id || ''))).size > 1) {
            if (status) status.textContent = `Kode ${budgetId} cocok dengan beberapa batch. Gunakan ID internal lengkap agar tidak salah edit.`;
            return;
        }

        const loadedIds = new Set(matching.map(item => String(item.id)));
        items = [...matching, ...items.filter(item => !loadedIds.has(String(item.id)))];
        try {
            persistLocal(period, items);
        } catch(e) {}
        matching.forEach(item => {
            if (item.updated_at) window.SmartBaraCore.setCloudVersion(period, `budgetCreator:${item.id}`, item.updated_at);
        });

        currentAiBudgetId = String(matching[0].ai_budget_id || budgetId);
        isEditingExistingAiBatch = true;
        aiDraftRows = matching.map(item => ({
            ...item,
            ai_budget_id: currentAiBudgetId,
            account_name: String(item.account_name || ''),
            project_name: String(item.project_name || ''),
            item_name: String(item.item_name || ''),
            specification: String(item.specification || ''),
            catatan: String(item.catatan || ''),
            quantity: Number(item.quantity) || 1,
            estimated_unit_price: Number(item.estimated_unit_price) || 0,
            needed_by: String(item.needed_by || '').slice(0, 10),
            status: String(item.status || 'Draft')
        }));
        updateAiBudgetIdDisplay();
        renderAiPreview();
        renderTable();
        if (status) status.textContent = `${matching.length} baris ID ${getAiBudgetDisplayId(currentAiBudgetId)} dimuat. Perubahan akan memperbarui baris yang ada.`;
    }

    function openAiBudget(budgetId) {
        const id = String(budgetId || '').trim();
        const matching = items.filter(item => {
            const itemId = String(item.ai_budget_id || '');
            return itemId.toLowerCase() === id.toLowerCase() || getAiBudgetDisplayId(itemId).toLowerCase() === id.toLowerCase();
        });
        if (!id || !matching.length) {
            setStatus(`Budget AI dengan ID ${id || '(kosong)'} tidak ditemukan.`, true);
            return;
        }
        if (new Set(matching.map(item => String(item.ai_budget_id || ''))).size > 1) {
            setStatus(`Kode ${getAiBudgetDisplayId(id)} cocok dengan beberapa batch. Gunakan pencarian ID lengkap.`, true);
            return;
        }
        document.getElementById('creatorSearch').value = id;
        renderTable();
        document.getElementById('creatorTableBody')?.closest('.glass-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setStatus(`${matching.length} baris untuk ID ${getAiBudgetDisplayId(id)}; gunakan tombol Edit untuk memperbarui.`);
    }

    async function copyAiBudgetId() {
        if (!currentAiBudgetId) return;
        const displayId = getAiBudgetDisplayId(currentAiBudgetId);
        try {
            await navigator.clipboard.writeText(displayId);
            setStatus(`ID Budget AI ${displayId} disalin.`);
        } catch(error) {
            setStatus(`ID Budget AI: ${displayId}`);
        }
    }

    // Modal Form for Add / Edit
    function openForm(id = '') {
        const item = items.find(it => it.id === id);
        const modal = document.getElementById('creatorFormModal');
        if (!modal) return;

        document.getElementById('formCreatorId').value = item?.id || '';
        document.getElementById('formCreatorTitle').textContent = item ? 'Edit Kebutuhan Pembelian' : 'Tambah Kebutuhan Pembelian';
        
        // Populate lists
        const lists = getDatabaseLists();
        const deptSelect = document.getElementById('formCreatorDept');
        deptSelect.innerHTML = lists.departments.map(d => `<option value="${d}">${d}</option>`).join('');
        deptSelect.value = item?.department || lists.departments[0] || 'HR';

        document.getElementById('formCreatorAccount').value = item?.account_name || '';
        document.getElementById('formCreatorProject').value = item?.project_name || '';
        document.getElementById('formCreatorItem').value = item?.item_name || '';
        document.getElementById('formCreatorSpec').value = item?.specification || '';
        document.getElementById('formCreatorQty').value = item?.quantity ?? 1;
        document.getElementById('formCreatorUnit').value = item?.unit || 'unit';
        document.getElementById('formCreatorPrice').value = item?.estimated_unit_price ?? 0;
        document.getElementById('formCreatorPriority').value = item?.priority || 'Normal';
        document.getElementById('formCreatorDate').value = item?.needed_by || '';
        document.getElementById('formCreatorNote').value = item?.catatan || '';
        document.getElementById('formCreatorStatus').value = item?.status || 'Draft';

        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeForm() {
        const modal = document.getElementById('creatorFormModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    async function saveForm(e) {
        e.preventDefault();
        if (!window.SmartBaraCore.canWriteData()) {
            setStatus('Level akses Viewer hanya dapat membaca kebutuhan.', true);
            return;
        }
        const id = document.getElementById('formCreatorId').value || crypto.randomUUID();
        const period = window.SmartBaraCore.getActivePeriod();

        const requestedStatus = document.getElementById('formCreatorStatus').value;
        const isFinalApprovalState = ['Disetujui', 'Ditolak'].includes(requestedStatus);
        if (isFinalApprovalState && !window.SmartBaraCore.canApproveAllDepartments()) {
            setStatus('Hanya akun Superadmin yang dapat mengubah status menjadi Disetujui atau Ditolak. Semua Superadmin dapat approve semua departemen.', true);
            return;
        }

        const payload = {
            id,
            period_name: period,
            department: document.getElementById('formCreatorDept').value,
            account_name: document.getElementById('formCreatorAccount').value.trim(),
            project_name: document.getElementById('formCreatorProject').value.trim(),
            item_name: document.getElementById('formCreatorItem').value.trim(),
            specification: document.getElementById('formCreatorSpec').value.trim(),
            catatan: document.getElementById('formCreatorNote').value.trim(),
            quantity: window.Formatters.parseNumber(document.getElementById('formCreatorQty').value, 1),
            unit: document.getElementById('formCreatorUnit').value.trim() || 'unit',
            estimated_unit_price: window.Formatters.parseNumber(document.getElementById('formCreatorPrice').value, 0),
            priority: document.getElementById('formCreatorPriority').value,
            needed_by: document.getElementById('formCreatorDate').value || null,
            status: requestedStatus,
            approved_by: requestedStatus === 'Disetujui' ? (window.SmartBaraCore.getUser()?.email || 'superadmin') : undefined,
            approved_at: requestedStatus === 'Disetujui' ? new Date().toISOString() : undefined,
            updated_at: new Date().toISOString()
        };

        const isEdit = items.some(it => it.id === id);
        const nextItems = isEdit ? items.map(it => it.id === id ? { ...it, ...payload } : it) : [payload, ...items];
        items = nextItems;
        persistLocal(period, nextItems);
        renderTable();
        closeForm();

        // Concurrency safe sync to cloud
        if (window.SmartBaraCore.canWriteCloud()) {
            try {
                if (storageMode === 'settings') {
                    await window.SmartBaraCore.syncVersionedRow('smartbara_settings', period, { key: `budget_creator_planning_${period}` }, { value: nextItems }, 'budgetCreatorFallback', 'planning settings');
                } else {
                    const { id: itemId, period_name: rowPeriod, ...values } = payload;
                    await window.SmartBaraCore.syncVersionedRow('smartbara_budget_creator_planning', period, { id: itemId, period_name: period }, values, `budgetCreator:${itemId}`, 'Budget Creator');
                }
                window.SmartBaraCore.showSyncStatus('Kebutuhan berhasil disimpan ke cloud', 'success');
            } catch(err) {
                console.warn('Sync cloud error:', err);
                window.SmartBaraCore.showSyncStatus('Disimpan secara lokal (cloud belum tersinkron)', 'info');
            }
        }
    }

    async function deleteAccountGroup(groupKey) {
        if (!window.SmartBaraCore.canDeleteData()) {
            setStatus('Level akses akun ini tidak dapat menghapus kebutuhan.', true);
            return;
        }

        const originalItems = items;
        const groupItems = originalItems.filter(item => getAccountGroupKey(item) === groupKey);
        if (!groupItems.length) return;

        const department = groupItems[0].department || '-';
        const account = groupItems[0].account_name || 'Akun tanpa nama';
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Hapus seluruh grup kebutuhan?',
            message: `Hapus ${groupItems.length} kebutuhan untuk akun "${account}" di departemen ${department}? Semua item dalam grup ini akan dihapus. Aksi ini tidak bisa dibatalkan.`,
            confirmText: `Hapus ${groupItems.length} item`,
            cancelText: 'Batal',
            danger: true
        });
        if (!confirmed) return;

        const period = window.SmartBaraCore.getActivePeriod();
        const nextItems = originalItems.filter(item => getAccountGroupKey(item) !== groupKey);
        items = nextItems;
        persistLocal(period, nextItems);
        renderTable();

        if (!window.SmartBaraCore.canWriteCloud()) {
            setStatus(`${groupItems.length} kebutuhan dihapus dari tampilan lokal; cloud belum tersambung.`, true);
            return;
        }

        if (storageMode === 'settings') {
            try {
                await window.SmartBaraCore.syncVersionedRow('smartbara_settings', period, { key: `budget_creator_planning_${period}` }, { value: nextItems }, 'budgetCreatorFallback', 'Budget Creator');
                window.SmartBaraCore.showSyncStatus(`${groupItems.length} kebutuhan berhasil dihapus dari cloud`, 'success');
            } catch (error) {
                if (error.queuedForSync) {
                    window.SmartBaraCore.showSyncStatus(`${groupItems.length} penghapusan menunggu sinkronisasi cloud`, 'info');
                    return;
                }
                items = originalItems;
                persistLocal(period, originalItems);
                renderTable();
                setStatus(`Penghapusan dibatalkan karena konflik cloud: ${error.message}`, true);
            }
            return;
        }

        const failedItems = [];
        const client = window.SmartBaraCore.getClient();
        const taskId = window.SmartBaraLayout.beginLoading('Menghapus kebutuhan', `Menghapus ${groupItems.length} baris...`);
        bulkOperationInProgress = true;
        try {
            // Satu query cek konflik untuk seluruh grup, lalu hapus per 200 id sekaligus.
            let conflictIds = new Set();
            try {
                conflictIds = new Set(await findRemoteConflicts(groupItems));
            } catch(error) {
                if (!isRetryableError(error)) throw error;
            }
            groupItems.filter(item => conflictIds.has(String(item.id))).forEach(item => failedItems.push(item));
            const deletable = groupItems.filter(item => !conflictIds.has(String(item.id)));
            for (let offset = 0; offset < deletable.length; offset += 200) {
                const chunk = deletable.slice(offset, offset + 200);
                const { error } = await client.from(TABLE_NAME).delete().eq('period_name', period).in('id', chunk.map(item => item.id));
                if (error) {
                    if (!isRetryableError(error)) {
                        failedItems.push(...deletable.slice(offset));
                        break;
                    }
                    // Jaringan putus: serahkan ke antrean sinkronisasi per baris.
                    const results = await Promise.allSettled(chunk.map(item => window.SmartBaraCore.deleteVersionedRow(
                        TABLE_NAME, period, { id: item.id, period_name: period }, `budgetCreator:${item.id}`, 'Budget Creator'
                    )));
                    results.forEach((result, index) => {
                        if (result.status === 'rejected' && !result.reason?.queuedForSync) failedItems.push(chunk[index]);
                    });
                }
                window.SmartBaraLayout.updateLoading(taskId, '', `${Math.min(offset + 200, deletable.length)} / ${deletable.length} baris diproses...`, ((offset + chunk.length) / deletable.length) * 100);
            }
        } catch(error) {
            console.warn('Bulk delete error:', error);
            groupItems.forEach(item => { if (!failedItems.includes(item)) failedItems.push(item); });
        } finally {
            bulkOperationInProgress = false;
            window.SmartBaraLayout.endLoading(taskId, !failedItems.length);
        }

        if (failedItems.length) {
            const failedIds = new Set(failedItems.map(item => String(item.id)));
            items = originalItems.filter(item => getAccountGroupKey(item) !== groupKey || failedIds.has(String(item.id)));
            persistLocal(period, items);
            renderTable();
            setStatus(`${groupItems.length - failedItems.length} item terhapus; ${failedItems.length} item gagal karena konflik cloud dan tetap ditampilkan.`, true);
            return;
        }

        window.SmartBaraCore.showSyncStatus(`${groupItems.length} kebutuhan berhasil dihapus dari cloud`, 'success');
    }

    async function deleteItem(id) {
        if (!window.SmartBaraCore.canDeleteData()) {
            setStatus('Level akses akun ini tidak dapat menghapus kebutuhan.', true);
            return;
        }
        const item = items.find(it => it.id === id);
        if (!item) return;
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi hapus kebutuhan',
            message: `Hapus kebutuhan "${item.item_name}"? Aksi ini tidak bisa dibatalkan.`,
            confirmText: 'Hapus',
            cancelText: 'Batal',
            danger: true
        });
        if (!confirmed) return;

        const period = window.SmartBaraCore.getActivePeriod();
        const nextItems = items.filter(it => it.id !== id);
        items = nextItems;
        persistLocal(period, nextItems);
        renderTable();

        if (window.SmartBaraCore.canWriteCloud()) {
            try {
                if (storageMode === 'settings') {
                    await window.SmartBaraCore.syncVersionedRow('smartbara_settings', period, { key: `budget_creator_planning_${period}` }, { value: nextItems }, 'budgetCreatorFallback', 'planning settings');
                } else {
                    await window.SmartBaraCore.deleteVersionedRow('smartbara_budget_creator_planning', period, { id, period_name: period }, `budgetCreator:${id}`, 'Budget Creator');
                }
                window.SmartBaraCore.showSyncStatus('Kebutuhan berhasil dihapus dari cloud', 'success');
            } catch(err) {
                console.warn('Cloud delete warning:', err);
            }
        }
    }

    // Master list extractor for Excel validation combobox
    function getDatabaseLists() {
        const deptSet = new Set(items.map(it => it.department));
        ['HR', 'GA', 'IT', 'FINANCE', 'LOGISTIK', 'OPERASIONAL', 'PRODUKSI', 'SHE', 'LEGAL', 'MARKETING'].forEach(d => deptSet.add(d));

        const accountSet = new Set(referenceAccountOptions);
        const projectSet = new Set(referenceProjectOptions);

        return {
            departments: [...deptSet].filter(Boolean).sort(),
            accounts: [...accountSet].filter(Boolean).sort(),
            projects: [...projectSet].filter(Boolean).sort(),
            priorities: ['Tinggi', 'Normal', 'Rendah'],
            statuses: ['Draft', 'Diajukan', 'Disetujui', 'Ditolak'],
            units: ['unit', 'pcs', 'paket', 'set', 'bulan', 'orang', 'kegiatan', 'box', 'rim', 'lot', 'meter', 'kg', 'liter']
        };
    }

    // ==========================================================================
    // FORMAT WORKBOOK "RINGKASAN BUDGET" — dipakai import, export, dan template
    // ==========================================================================
    const ACCOUNT_TABLE = 'smartbara_budget';
    const PROJECT_TABLE = 'smartbara_budget_site';
    const ASSET_THRESHOLD = 5000000;   // Rp per barang
    const ASSET_YEARS = 5;
    const DEPRECIATION_MAP = {
        'Biaya Peralatan Kerja': { name: 'Depresiasi Biaya Peralatan Kerja', glNo: '6000,18,03' },
        'Biaya Perlengkapan Kantor': { name: 'Depresiasi Perlengkapan Kantor', glNo: '6000,18,04' }
    };
    const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
    const COA_PREFIX = 'budget_creator_planning_coa__';
    const IMPORT_COMPARE_FIELDS = ['department', 'account_name', 'project_name', 'item_name', 'specification', 'catatan', 'quantity', 'unit', 'estimated_unit_price', 'priority', 'needed_by', 'status'];

    const pad2 = n => String(n).padStart(2, '0');
    const emptyMonths = () => Array(12).fill(0);
    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const lineTotal = row => (Number(row.quantity) || 0) * (Number(row.estimated_unit_price) || 0);
    const lc = value => String(value ?? '').trim().toLowerCase();
    const sumOf = list => list.reduce((a, b) => a + (Number(b) || 0), 0);

    function monthIndexOf(neededBy) {
        const m = /^\d{4}-(\d{2})/.exec(String(neededBy || ''));
        const n = m ? Number(m[1]) : 0;
        return n >= 1 && n <= 12 ? n - 1 : -1;
    }

    function isAssetRow(row) {
        return Boolean(DEPRECIATION_MAP[row.account_name]) && (Number(row.estimated_unit_price) || 0) >= ASSET_THRESHOLD;
    }

    function guessYear(rows, fallbackPeriod) {
        const years = new Map();
        rows.forEach(row => {
            const year = String(row.needed_by || '').slice(0, 4);
            if (/^\d{4}$/.test(year)) years.set(year, (years.get(year) || 0) + 1);
        });
        const top = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        return top || String(fallbackPeriod || '').match(/\d{4}/)?.[0] || String(new Date().getFullYear());
    }

    function guessImportPeriodName(rows) {
        return `GMI-BUDGET ${guessYear(rows)}`;
    }

    // ---- Membaca workbook ---------------------------------------------------
    function sheetRows(workbook, nameFragment) {
        const name = workbook.SheetNames.find(n => lc(n).includes(nameFragment));
        return name ? XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }) : null;
    }

    // Sheet pembanding & referensi: dibaca hanya untuk verifikasi preview dan Master COA.
    function parseReferenceSheets(workbook) {
        const checks = { monthly: null, dept: null, project: null };
        const monthly = sheetRows(workbook, 'ringkasan bulanan');
        if (monthly) {
            const byMonth = Array.from({ length: 12 }, () => ({ items: 0, dep: 0 }));
            monthly.forEach(row => {
                const idx = MONTH_SHORT.findIndex(m => lc(row[0]).startsWith(m.toLowerCase()) || (m === 'Ags' && lc(row[0]).startsWith('agu')));
                if (idx >= 0) byMonth[idx] = { items: Number(row[1]) || 0, dep: Number(row[2]) || 0 };
            });
            checks.monthly = byMonth;
        }
        const totals = (fragment) => {
            const rows = sheetRows(workbook, fragment);
            if (!rows) return null;
            const map = new Map();
            rows.slice(1).forEach(row => {
                const name = String(row[0] ?? '').trim();
                if (!name || lc(name).includes('grand total')) return;
                map.set(name.toUpperCase(), Number(row[1]) || 0);
            });
            return map;
        };
        checks.dept = totals('per departemen');
        checks.project = totals('per proyek');

        let coa = null;
        const coaRows = sheetRows(workbook, 'master coa');
        if (coaRows && coaRows.length > 1) {
            coa = coaRows.slice(1)
                .map(r => ({ no: String(r[0] ?? '').trim(), nama: String(r[1] ?? '').trim(), tipe: String(r[2] ?? '').trim(), kategori: String(r[3] ?? '').trim(), aktif: String(r[4] ?? '').trim(), sumber: String(r[5] ?? '').trim() }))
                .filter(r => r.nama);
        }
        return { checks, coa };
    }

    // ---- Budget turunan (akun & proyek per departemen) dihitung dari item ------
    function computeDerived(rows) {
        const accounts = new Map();
        const projects = new Map();
        const assetBase = new Map(); // akun sumber -> Map(dept -> nilai asset)
        const itemMonthly = emptyMonths();
        const warnings = { withoutMonth: 0, withoutAccount: 0, withoutProject: 0 };
        const add = (map, name, dept, field, idx, amount) => {
            const key = `${dept.toUpperCase()}|${name.toLowerCase()}`;
            if (!map.has(key)) map.set(key, { departemen: dept, [field]: name, budget: emptyMonths() });
            map.get(key).budget[idx] += amount;
        };

        rows.forEach(row => {
            const monthIdx = monthIndexOf(row.needed_by);
            if (monthIdx < 0) warnings.withoutMonth++;
            const idx = Math.max(monthIdx, 0);
            const amount = lineTotal(row);
            const dept = String(row.department || '').trim();
            const account = String(row.account_name || '').trim();
            const project = String(row.project_name || '').trim();
            itemMonthly[idx] += amount;
            if (account) add(accounts, account, dept, 'nama_akun', idx, amount); else warnings.withoutAccount++;
            if (project) add(projects, project, dept, 'nama_proyek_up', idx, amount); else warnings.withoutProject++;
            if (account && isAssetRow(row)) {
                if (!assetBase.has(account)) assetBase.set(account, new Map());
                assetBase.get(account).set(dept, (assetBase.get(account).get(dept) || 0) + amount);
            }
        });

        // Depresiasi otomatis: ROUND(total asset / (umur*12)) per bulan, rata 12 bulan (sama dengan file).
        const depMonthly = emptyMonths();
        assetBase.forEach((byDept, account) => {
            const divisor = ASSET_YEARS * 12;
            const monthly = Math.round(sumOf([...byDept.values()]) / divisor);
            const shares = [...byDept.entries()].map(([dept, amt]) => ({ dept, amt, share: Math.round(amt / divisor) }));
            const diff = monthly - sumOf(shares.map(s => s.share));
            if (diff) [...shares].sort((a, b) => b.amt - a.amt)[0].share += diff;
            shares.forEach(({ dept, share }) => {
                if (!share) return;
                for (let m = 0; m < 12; m++) add(accounts, DEPRECIATION_MAP[account].name, dept, 'nama_akun', m, share);
            });
            for (let m = 0; m < 12; m++) depMonthly[m] += monthly;
        });

        const finish = map => [...map.values()].map(r => ({ ...r, budget: r.budget.map(round2) }));
        return { accounts: finish(accounts), projects: finish(projects), itemMonthly: itemMonthly.map(round2), depMonthly, warnings };
    }

    // ---- Verifikasi hasil hitung vs sheet rekap di file ---------------------------
    function verifyAgainstFile(derived, rows, checks) {
        const results = [];
        const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1.5;
        const skip = label => results.push({ label, ok: null, detail: 'sheet tidak ada di file' });

        if (checks?.monthly) {
            const badItems = derived.itemMonthly.map((v, i) => [i, v]).filter(([i, v]) => !near(v, checks.monthly[i].items));
            const badDep = derived.depMonthly.map((v, i) => [i, v]).filter(([i, v]) => !near(v, checks.monthly[i].dep));
            const names = list => list.map(([i]) => MONTH_SHORT[i]).join(', ');
            results.push({ label: 'Ringkasan Bulanan · kebutuhan', ok: !badItems.length, detail: badItems.length ? `selisih di ${names(badItems)}` : '12 bulan cocok' });
            results.push({ label: 'Ringkasan Bulanan · depresiasi', ok: !badDep.length, detail: badDep.length ? `selisih di ${names(badDep)}` : '12 bulan cocok' });
        } else skip('Ringkasan Bulanan');

        const compare = (label, fileMap, field) => {
            if (!fileMap) { skip(label); return; }
            const mine = new Map();
            rows.forEach(row => {
                const key = String(row[field] || '').trim().toUpperCase();
                if (key) mine.set(key, (mine.get(key) || 0) + lineTotal(row));
            });
            const names = new Set([...fileMap.keys(), ...mine.keys()]);
            const bad = [...names].filter(n => !near(mine.get(n) || 0, fileMap.get(n) || 0));
            results.push({ label, ok: !bad.length, detail: bad.length ? `selisih: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ` (+${bad.length - 3})` : ''}` : `${fileMap.size} baris cocok` });
        };
        compare('Per Departemen', checks?.dept, 'department');
        compare('Per Proyek', checks?.project, 'project_name');
        return results;
    }

    // ---- Rencana perubahan -------------------------------------------------------
    const naturalKey = r => [r.department, r.account_name, r.project_name, r.item_name, String(r.needed_by || '').slice(0, 10), Number(r.quantity) || 0, Number(r.estimated_unit_price) || 0].map(lc).join('|');

    function sameImportValue(a, b, field) {
        if (['quantity', 'estimated_unit_price'].includes(field)) return Number(a) === Number(b);
        return String(a ?? '') === String(b ?? '');
    }

    // Baris file dicocokkan dengan baris lama lewat ID Budget (ai_budget_id); tanpa ID, lewat kombinasi isi baris.
    function buildImportPlan(fileRows, existing, mode, targetPeriod) {
        const byBudgetId = new Map();
        const byNatural = new Map();
        existing.forEach(row => {
            const key = String(row.ai_budget_id || '').trim();
            if (key) {
                if (!byBudgetId.has(key)) byBudgetId.set(key, []);
                byBudgetId.get(key).push(row);
            } else {
                const nk = naturalKey(row);
                if (!byNatural.has(nk)) byNatural.set(nk, []);
                byNatural.get(nk).push(row);
            }
        });
        const usedIds = new Set();
        const now = new Date().toISOString();
        const toWrite = [];
        const stats = { created: 0, updated: 0, unchanged: 0, removed: 0 };

        fileRows.forEach(row => {
            let match = null;
            if (row.ai_budget_id) {
                const candidates = (byBudgetId.get(row.ai_budget_id) || []).filter(c => !usedIds.has(c.id));
                if (candidates.length === 1) match = candidates[0];
                else if (candidates.length > 1) match = candidates.find(c => lc(c.item_name) === lc(row.item_name)) || null;
            } else {
                match = (byNatural.get(naturalKey(row)) || []).find(c => !usedIds.has(c.id)) || null;
            }

            if (match) {
                usedIds.add(match.id);
                const changed = IMPORT_COMPARE_FIELDS.some(field => !sameImportValue(match[field], row[field], field));
                if (!changed) { stats.unchanged++; return; }
                stats.updated++;
                toWrite.push({ ...row, id: match.id, period_name: targetPeriod, created_by: match.created_by ?? row.created_by ?? null, created_at: match.created_at || now, updated_at: now });
            } else {
                stats.created++;
                toWrite.push({ ...row, id: crypto.randomUUID(), period_name: targetPeriod, created_at: now, updated_at: now });
            }
        });

        const keepIds = new Set([...usedIds, ...toWrite.map(r => r.id)]);
        const toRemove = mode === 'replace' ? existing.filter(row => !keepIds.has(row.id)) : [];
        stats.removed = toRemove.length;
        return { stats, toWrite, toRemove };
    }

    // Budget akun / proyek: identitas baris = departemen + nama (sama dengan halaman Budget).
    function buildTablePlan(derivedRows, existing, mode, targetPeriod, nameField) {
        const identity = (dept, name) => `${String(dept || '').trim().toUpperCase()}|${lc(name)}`;
        const byIdentity = new Map();
        existing.forEach(row => {
            const key = identity(row.departemen ?? row.dept, row[nameField] ?? row.nama);
            if (!byIdentity.has(key)) byIdentity.set(key, row);
        });
        const now = new Date().toISOString();
        const toWrite = [];
        const stats = { created: 0, updated: 0, unchanged: 0, removed: 0 };
        const keepIds = new Set();

        derivedRows.forEach(row => {
            const match = byIdentity.get(identity(row.departemen, row[nameField]));
            const base = { period_name: targetPeriod, departemen: row.departemen, [nameField]: row[nameField], budget: row.budget };
            if (match) {
                keepIds.add(match.id);
                const old = Array.isArray(match.budget) ? match.budget : [];
                const same = row.budget.every((v, i) => round2(old[i]) === round2(v)) && old.length === row.budget.length;
                if (same) { stats.unchanged++; return; }
                stats.updated++;
                toWrite.push({ ...base, id: match.id, created_at: match.created_at || now, updated_at: now });
            } else {
                stats.created++;
                toWrite.push({ ...base, id: crypto.randomUUID(), created_at: now, updated_at: now });
            }
        });
        const toRemove = mode === 'replace' ? existing.filter(row => !keepIds.has(row.id)) : [];
        stats.removed = toRemove.length;
        return { stats, toWrite, toRemove };
    }

    // ---- Workbook laporan (9 sheet, format sama dengan Ringkasan_Budget) -------------
    function buildReportWorkbook(rows, period, coaRows) {
        const derived = computeDerived(rows);
        const year = guessYear(rows, period);
        const coaByName = new Map();
        (coaRows || []).forEach(c => {
            const key = lc(c.nama);
            const current = coaByName.get(key);
            if (!current || (lc(current.aktif) !== 'ya' && lc(c.aktif) === 'ya')) coaByName.set(key, c);
        });
        const coaOf = name => coaByName.get(lc(name)) || {};

        // Agregat per akun (semua departemen)
        const accAgg = new Map();
        derived.accounts.forEach(a => {
            if (!accAgg.has(a.nama_akun)) accAgg.set(a.nama_akun, { name: a.nama_akun, months: emptyMonths(), count: 0 });
            a.budget.forEach((v, i) => { accAgg.get(a.nama_akun).months[i] += v; });
        });
        rows.forEach(r => { if (r.account_name) accAgg.get(r.account_name).count++; });
        const accList = [...accAgg.values()].map(a => ({ ...a, total: sumOf(a.months), coa: coaOf(a.name) })).sort((a, b) => b.total - a.total);
        const grandTotal = sumOf(accList.map(a => a.total));

        const ordered = [...rows].sort((a, b) => String(a.department).localeCompare(String(b.department)) || String(a.needed_by || '').localeCompare(String(b.needed_by || '')));
        const monthOf = r => { const i = monthIndexOf(r.needed_by); return pad2((i < 0 ? 0 : i) + 1); };
        const identitas = r => DEPRECIATION_MAP[r.account_name] ? (isAssetRow(r) ? 'Asset' : 'Non Asset') : '-';

        // 1. Rekap Kebutuhan Item (sumber untuk import)
        const s1 = [['ID Budget', 'Departemen', 'Bulan', 'No. Akun', 'Nomor Sumber', 'Nama Akun', 'Tipe Akun', 'Identitas Asset', 'Nama Proyek UP', 'Nama Pelanggan/Pemasok', 'Kebutuhan / Nama Barang', 'Spesifikasi / Alasan', 'Jumlah', 'Satuan', 'Estimasi Harga Satuan (Rp)', 'Prioritas', 'Tanggal Dibutuhkan (YYYY-MM-DD)', 'Status', 'Catatan Analisa', 'Total Harga (Rp)']];
        ordered.forEach(r => s1.push([r.ai_budget_id || '', r.department, monthOf(r), coaOf(r.account_name).no || '', '', r.account_name || '', coaOf(r.account_name).tipe || '', identitas(r), r.project_name || '', '-', r.item_name, r.specification || '', Number(r.quantity) || 0, r.unit || '', Number(r.estimated_unit_price) || 0, r.priority || 'Normal', r.needed_by ? String(r.needed_by).slice(0, 10) : '', r.status || 'Draft', r.catatan || '', lineTotal(r)]));

        // 2. Resume Bulanan per Akun
        const s2 = [['RESUME KEBUTUHAN BULANAN (01–12) PER NAMA AKUN'], ['Departemen: Semua   |   Proyek: Semua'], [],
            ['No. Akun', 'Nama Akun', 'Tipe Akun', 'Kategori', ...MONTH_SHORT.map((m, i) => `${pad2(i + 1)} - ${m}`), 'Total/Tahun (Rp)', 'Jumlah Item']];
        accList.forEach(a => s2.push([a.coa.no || '', a.name, a.coa.tipe || '', a.coa.kategori || '', ...a.months.map(round2), round2(a.total), a.count || 'otomatis']));
        s2.push(['', 'GRAND TOTAL', '', '', ...MONTH_SHORT.map((_, i) => round2(sumOf(accList.map(a => a.months[i])))), round2(grandTotal), '']);

        // 3. Rincian Item & Akun
        const s3 = [['RINCIAN DETAIL BUDGET ' + year + ' PER NAMA AKUN'], ['Departemen: Semua   |   Proyek: Semua'], [],
            ['ID Budget', 'No', 'No. Akun', 'Nomor Sumber', 'Nama Akun', 'Tipe Akun', 'Identitas Asset', 'Departemen', 'Proyek', 'Nama Pelanggan/Pemasok', 'Kebutuhan / Nama Item', 'Spesifikasi / Keterangan', 'Bulan', 'Qty', 'Satuan', 'Harga Satuan (Rp)', 'Total Item (Rp)', 'Subtotal Akun (Rp)', 'Grand Total (Rp)']];
        accList.forEach((a, n) => {
            const own = ordered.filter(r => r.account_name === a.name);
            if (!own.length) return;
            s3.push(['', n + 1, a.coa.no || '', '', `${a.name}${a.coa.kategori ? ` (${a.coa.kategori})` : ''}`, a.coa.tipe || '', '', '', '', '', `${own.length} baris rincian item`]);
            own.forEach((r, i) => s3.push([r.ai_budget_id || '', i + 1, a.coa.no || '', '', r.account_name, a.coa.tipe || '', identitas(r), r.department, r.project_name || '', '-', r.item_name, r.specification || '', monthOf(r), Number(r.quantity) || 0, r.unit || '', Number(r.estimated_unit_price) || 0, lineTotal(r)]));
            s3.push(['', '', '', '', `Subtotal ${a.name}`, '', '', '', '', '', '', '', '', '', '', '', '', round2(sumOf(own.map(lineTotal)))]);
        });
        s3.push(['', '', '', '', 'GRAND TOTAL ITEM', '', '', '', '', '', '', '', '', '', '', '', '', '', round2(sumOf(rows.map(lineTotal)))]);

        // 4. Detail per Akun
        const s4 = [['No. Akun', 'Nama Akun', 'Tipe Akun', 'Kategori', ...MONTH_SHORT, 'Total/Tahun (Rp)', 'Grand Total (Rp)']];
        accList.forEach(a => s4.push([a.coa.no || '', a.name, a.coa.tipe || '', a.coa.kategori || '', ...a.months.map(round2), round2(a.total)]));
        s4.push(['', 'GRAND TOTAL (Lihat Kolom R)', '', '', ...Array(12).fill(''), '', round2(grandTotal)]);

        // 5. Ringkasan Bulanan
        const s5 = [['Bulan ' + year, 'Kebutuhan Item & Jasa (Rp)', 'Depresiasi Asset Otomatis (Rp)', 'Total Bulanan (Rp)', 'Grand Total Tahunan (Rp)']];
        MONTH_SHORT.forEach((m, i) => s5.push([`${m} ${year}`, derived.itemMonthly[i], derived.depMonthly[i], round2(derived.itemMonthly[i] + derived.depMonthly[i])]));
        s5.push(['GRAND TOTAL', '', '', '', round2(sumOf(derived.itemMonthly) + sumOf(derived.depMonthly))]);

        // 6 & 7. Per Departemen / Per Proyek
        const groupTotals = field => {
            const map = new Map();
            rows.forEach(r => {
                const key = String(r[field] || '').trim();
                if (key) map.set(key, (map.get(key) || 0) + lineTotal(r));
            });
            return [...map.entries()].sort((a, b) => b[1] - a[1]);
        };
        const s6 = [['Departemen', 'Total Kebutuhan (Rp)', 'Grand Total (Rp)'], ...groupTotals('department').map(([k, v]) => [k, round2(v)]), ['GRAND TOTAL', '', round2(sumOf(rows.map(lineTotal)))]];
        const s7 = [['Proyek', 'Total Kebutuhan (Rp)', 'Grand Total (Rp)'], ...groupTotals('project_name').map(([k, v]) => [k, round2(v)]), ['GRAND TOTAL', '', round2(sumOf(rows.filter(r => r.project_name).map(lineTotal)))]];

        // 8. Asset & Depresiasi
        const s8 = [['PERHITUNGAN IDENTITAS ASSET (>= Rp 5.000.000 / BARANG) & DEPRESIASI OTOMATIS'], [],
            ['Batas Asset (Rp/Barang)', ASSET_THRESHOLD, '', 'Umur Depresiasi (Tahun)', ASSET_YEARS], [],
            ['Akun Depresiasi (Ringkasan)', 'No. Akun GL', 'Sumber Asset', 'Total Nilai Asset (Rp)', 'Total Non-Asset (Rp)', 'Item Asset', 'Depresiasi / Tahun (Rp)', 'Depresiasi / Bulan (Rp)']];
        let totalAsset = 0, totalNon = 0, totalYear = 0, totalMonth = 0;
        Object.entries(DEPRECIATION_MAP).forEach(([source, dep]) => {
            const own = rows.filter(r => r.account_name === source);
            const assetRows = own.filter(isAssetRow);
            const asset = sumOf(assetRows.map(lineTotal));
            const non = sumOf(own.filter(r => !isAssetRow(r)).map(lineTotal));
            const monthly = Math.round(asset / (ASSET_YEARS * 12));
            totalAsset += asset; totalNon += non; totalMonth += monthly; totalYear += monthly * 12;
            s8.push([dep.name, dep.glNo, source, round2(asset), round2(non), assetRows.length, monthly * 12, monthly]);
        });
        s8.push(['TOTAL DEPRESIASI OTOMATIS', '', '', round2(totalAsset), round2(totalNon), '', totalYear, totalMonth], []);
        s8.push(['ID Budget', 'Departemen', 'Proyek', 'Nomor Sumber', 'Nama Akun', 'Kebutuhan / Nama Barang', 'Nama Pemasok', 'Bulan', 'Qty Total', 'Satuan', 'Harga Satuan (Rp)', 'Total Tahunan (Rp)', 'Identitas Asset']);
        ordered.filter(r => DEPRECIATION_MAP[r.account_name]).forEach(r => s8.push([r.ai_budget_id || '', r.department, r.project_name || '', '', r.account_name, r.item_name, '-', monthOf(r), Number(r.quantity) || 0, r.unit || '', Number(r.estimated_unit_price) || 0, lineTotal(r), identitas(r)]));

        // 9. Master COA GL
        const s9 = [['No. Akun', 'Nama Akun', 'Tipe Akun', 'Kategori', 'Aktif di Kuesioner', 'Sumber'], ...(coaRows || []).map(c => [c.no, c.nama, c.tipe, c.kategori, c.aktif, c.sumber])];

        const workbook = XLSX.utils.book_new();
        const add = (name, aoa, widths) => {
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            if (widths) ws['!cols'] = widths.map(wch => ({ wch }));
            XLSX.utils.book_append_sheet(workbook, ws, name);
        };
        add('Rekap Kebutuhan Item', s1, [14, 16, 7, 16, 14, 28, 14, 14, 24, 18, 34, 34, 8, 8, 16, 10, 16, 11, 30, 16]);
        add('Resume Bulanan per Akun', s2, [16, 34, 14, 22, ...Array(12).fill(14), 18, 12]);
        add('Rincian Item & Akun', s3, [14, 5, 16, 12, 34, 14, 12, 16, 22, 16, 34, 30, 7, 7, 8, 14, 16, 18, 18]);
        add('Detail per Akun', s4, [16, 34, 14, 22, ...Array(12).fill(13), 18, 18]);
        add('Ringkasan Bulanan', s5, [14, 26, 28, 20, 24]);
        add('Per Departemen', s6, [22, 22, 20]);
        add('Per Proyek', s7, [26, 22, 20]);
        add('Asset & Depresiasi', s8, [32, 14, 26, 24, 22, 28, 24, 24, 14]);
        add('Master COA GL', s9, [16, 34, 24, 22, 18, 16]);
        return workbook;
    }

    // ==========================================================================
    // DATA DARI / KE DATABASE
    // ==========================================================================

    const coaKey = period => `${COA_PREFIX}${period}`;
    const cacheKeyFor = (table, period) => table === PROJECT_TABLE ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;
    const TABLE_LABELS = { planning: 'Creator Planning', account: 'Budget Akun', project: 'Budget Proyek' };

    async function loadStoredCoa(period) {
        try {
            const client = window.SmartBaraCore.getClient();
            if (client) {
                const { data } = await client.from('smartbara_settings').select('value').eq('key', coaKey(period)).maybeSingle();
                if (Array.isArray(data?.value?.rows)) return data.value.rows;
            }
            const cached = JSON.parse(localStorage.getItem(coaKey(period)) || 'null');
            if (Array.isArray(cached?.rows)) return cached.rows;
        } catch (e) { /* COA opsional */ }
        return [];
    }

    async function saveCoa(period, rows, fileName) {
        const value = { rows, saved_at: new Date().toISOString(), source: fileName };
        try { localStorage.setItem(coaKey(period), JSON.stringify(value)); } catch (e) { /* cache opsional */ }
        const client = window.SmartBaraCore.getClient();
        const { error } = await client.from('smartbara_settings').upsert({ key: coaKey(period), value, updated_at: value.saved_at }, { onConflict: 'key' });
        if (error) throw error;
    }

    function triggerDownload(blobParts, fileName, type) {
        const blob = new Blob(blobParts, { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---- Template ---------------------------------------------------------------
    async function downloadTemplate() {
        setStatus('Menyiapkan template (format Rekap Kebutuhan Item)...');
        try {
            await window.ensureLibrary('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Smart BARA';
            const period = window.SmartBaraCore.getActivePeriod();
            const lists = getDatabaseLists();
            const coa = await loadStoredCoa(period);
            const LAST_ROW = 501;

            const sheet = workbook.addWorksheet('Rekap Kebutuhan Item', { views: [{ state: 'frozen', ySplit: 1, showGridLines: true }] });
            const columns = [
                ['ID Budget', 15], ['Departemen', 18], ['Bulan', 8], ['No. Akun', 16], ['Nomor Sumber', 14], ['Nama Akun', 30], ['Tipe Akun', 14],
                ['Identitas Asset', 14], ['Nama Proyek UP', 26], ['Nama Pelanggan/Pemasok', 20], ['Kebutuhan / Nama Barang', 34], ['Spesifikasi / Alasan', 34],
                ['Jumlah', 10], ['Satuan', 10], ['Estimasi Harga Satuan (Rp)', 18], ['Prioritas', 11], ['Tanggal Dibutuhkan (YYYY-MM-DD)', 18],
                ['Status', 12], ['Catatan Analisa', 32], ['Total Harga (Rp)', 18]
            ];
            sheet.columns = columns.map(([header, width]) => ({ header, width }));
            const headerRow = sheet.getRow(1);
            headerRow.height = 32;
            headerRow.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

            const list = (column, count) => ({ type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Referensi!$${column}$2:$${column}$${Math.max(count, 1) + 1}`] });
            for (let r = 2; r <= LAST_ROW; r++) {
                const row = sheet.getRow(r);
                row.getCell(13).numFmt = '#,##0.##';
                row.getCell(15).numFmt = '#,##0';
                row.getCell(17).numFmt = 'yyyy-mm-dd';
                row.getCell(20).numFmt = '#,##0';
                row.getCell(20).value = { formula: `M${r}*O${r}` };
                row.getCell(2).dataValidation = list('A', lists.departments.length);
                row.getCell(6).dataValidation = list('B', lists.accounts.length);
                row.getCell(9).dataValidation = list('C', lists.projects.length);
                row.getCell(14).dataValidation = list('F', lists.units.length);
                row.getCell(16).dataValidation = list('D', lists.priorities.length);
                row.getCell(18).dataValidation = list('E', lists.statuses.length);
            }
            sheet.autoFilter = { from: 'A1', to: `T${LAST_ROW}` };

            const refSheet = workbook.addWorksheet('Referensi');
            refSheet.columns = [
                { header: 'Departemen', width: 22 }, { header: 'Nama Akun', width: 34 }, { header: 'Nama Proyek UP', width: 34 },
                { header: 'Prioritas', width: 16 }, { header: 'Status', width: 16 }, { header: 'Satuan', width: 16 }
            ];
            const maxRef = Math.max(lists.departments.length, lists.accounts.length, lists.projects.length, lists.priorities.length, lists.statuses.length, lists.units.length);
            for (let i = 0; i < maxRef; i++) {
                refSheet.addRow([lists.departments[i] || '', lists.accounts[i] || '', lists.projects[i] || '', lists.priorities[i] || '', lists.statuses[i] || '', lists.units[i] || '']);
            }
            refSheet.getRow(1).font = { bold: true };

            if (coa.length) {
                const coaSheet = workbook.addWorksheet('Master COA GL');
                coaSheet.columns = [{ header: 'No. Akun', width: 16 }, { header: 'Nama Akun', width: 34 }, { header: 'Tipe Akun', width: 24 }, { header: 'Kategori', width: 22 }, { header: 'Aktif di Kuesioner', width: 18 }, { header: 'Sumber', width: 16 }];
                coa.forEach(c => coaSheet.addRow([c.no, c.nama, c.tipe, c.kategori, c.aktif, c.sumber]));
                coaSheet.getRow(1).font = { bold: true };
            }

            const guide = workbook.addWorksheet('Petunjuk');
            guide.getColumn(1).width = 110;
            [
                'PETUNJUK PENGISIAN — Smart BARA Budget Creator',
                `Periode saat template dibuat: ${period}`,
                '',
                '1. Isi data di sheet "Rekap Kebutuhan Item". Satu baris = satu kebutuhan. Kolom wajib: Departemen, Kebutuhan / Nama Barang, Jumlah, Estimasi Harga Satuan.',
                '2. ID Budget: kosongkan untuk baris baru. Isi dengan ID yang sama (mis. BG27-00001) bila ingin memperbarui baris yang sudah ada saat upload ulang.',
                '3. Tanggal Dibutuhkan menentukan bulan anggaran. Jika kosong, kolom Bulan (01–12) dipakai.',
                '4. No. Akun, Tipe Akun, Identitas Asset, dan Total Harga dihitung sistem / opsional; tidak perlu diisi manual.',
                '5. Asset otomatis: akun Biaya Peralatan Kerja / Perlengkapan Kantor dengan harga satuan >= Rp 5.000.000 dihitung asset dan didepresiasi 5 tahun.',
                '6. Upload file ini di Budget Creator > Import Excel. Budget Akun dan Budget Proyek per departemen dihitung otomatis dari baris ini.',
                '7. File hasil Export Excel memakai format yang sama dan bisa diupload kembali.'
            ].forEach(line => guide.addRow([line]));
            guide.getRow(1).font = { bold: true, size: 13 };

            const buffer = await workbook.xlsx.writeBuffer();
            triggerDownload([buffer], `Template_Budget_Creator_${String(period).replace(/[^a-z0-9_-]+/gi, '_')}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            setStatus(`Template berhasil diunduh (${lists.departments.length} Dept, ${lists.accounts.length} Akun, ${lists.projects.length} Proyek).`);
        } catch (err) {
            console.error('Download template error:', err);
            setStatus(`Download template gagal: ${err.message}`, true);
        }
    }

    // ---- Export -------------------------------------------------------------------
    async function exportExcel() {
        const rows = [...items];
        if (!rows.length) {
            setStatus('Tidak ada data Budget Creator untuk diekspor.', true);
            return;
        }
        const period = window.SmartBaraCore.getActivePeriod();
        const taskId = window.SmartBaraLayout.beginLoading('Mengekspor Budget Creator', `Menyusun 9 sheet dari ${rows.length.toLocaleString('id-ID')} baris...`);
        let exportSucceeded = false;
        try {
            await window.ensureLibrary('xlsx');
            const coa = await loadStoredCoa(period);
            const workbook = buildReportWorkbook(rows, period, coa);
            const now = new Date();
            const fileName = `Ringkasan_Budget_${String(period).replace(/[^a-z0-9_-]+/gi, '_')}_${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}.xlsx`;
            XLSX.writeFile(workbook, fileName, { compression: true });
            setStatus(`Export Excel berhasil: ${rows.length.toLocaleString('id-ID')} baris, 9 sheet (${fileName}).`);
            exportSucceeded = true;
        } catch (error) {
            console.error('Export Budget Creator error:', error);
            setStatus(`Export Excel gagal: ${error.message}`, true);
        } finally {
            window.SmartBaraLayout.endLoading(taskId, exportSucceeded);
        }
    }

    async function fetchExistingPlanningRows(period) {
        const client = window.SmartBaraCore.getClient();
        if (!client) return Array.isArray(items) ? [...items] : [];
        if (storageMode === 'settings') {
            const { data } = await client.from('smartbara_settings').select('value').eq('key', `budget_creator_planning_${period}`).maybeSingle();
            return Array.isArray(data?.value) ? data.value : [];
        }
        const { data, error } = await window.SmartBaraCore.fetchPeriodRows(TABLE_NAME, period, { orderBy: 'created_at', ascending: false });
        if (error) throw error;
        return data || [];
    }

    async function fetchTableRows(table, period) {
        if (!window.SmartBaraCore.getClient()) return [];
        const { data, error } = await window.SmartBaraCore.fetchPeriodRows(table, period);
        if (error) throw error;
        return data || [];
    }


    // ==========================================================================
    // IMPORT: MODE (periode baru | upsert | ganti semua) di atas dialog tinjau
    // ==========================================================================
    function getImportMode() {
        return document.querySelector('input[name="creatorImportMode"]:checked')?.value || 'new';
    }

    function initImportModes() {
        const core = window.SmartBaraCore;
        const cloud = core.canWriteCloud();
        const section = document.getElementById('creatorImportModes');
        if (section) section.classList.toggle('hidden', !cloud);
        if (!cloud) return;
        const canCreatePeriod = core.canManageSettings();
        const allowed = { new: canCreatePeriod, upsert: true, replace: core.canDeleteData() };
        Object.entries(allowed).forEach(([mode, ok]) => {
            const radio = document.querySelector(`input[name="creatorImportMode"][value="${mode}"]`);
            if (!radio) return;
            radio.disabled = !ok;
            radio.closest('label')?.classList.toggle('opacity-40', !ok);
        });
        document.querySelector(`input[name="creatorImportMode"][value="${canCreatePeriod ? 'new' : 'upsert'}"]`).checked = true;
        document.getElementById('creatorImportPeriodName').value = guessImportPeriodName(pendingImport.entries.map(e => e.data));
        document.getElementById('creatorImportStatus').textContent = '';
    }

    function updateImportConfirmButton(count) {
        const button = document.getElementById('creatorImportConfirmButton');
        if (!button) return;
        const fmt = value => value.toLocaleString('id-ID');
        if (!window.SmartBaraCore.canWriteCloud()) {
            button.disabled = !count;
            button.textContent = count ? `Simpan ${fmt(count)} baris (lokal)` : 'Tidak ada baris valid';
            return;
        }
        const mode = getImportMode();
        const ready = mode === 'new' || Boolean(importPlanCache && importPlanCache.mode === mode);
        const label = mode === 'new' ? 'Buat Periode & Import' : mode === 'upsert' ? 'Upsert ke Periode' : 'Ganti Seluruh Periode';
        button.disabled = !count || !ready || importBusy;
        button.textContent = count ? `${label} (${fmt(count)} baris)` : 'Tidak ada baris valid';
        button.classList.toggle('bg-rose-600', mode === 'replace');
    }

    async function captureState(period) {
        const [planning, account, project] = await Promise.all([
            fetchExistingPlanningRows(period), fetchTableRows(ACCOUNT_TABLE, period), fetchTableRows(PROJECT_TABLE, period)
        ]);
        return { planning, account, project };
    }

    function buildAllPlans(state, mode, period, rows, derived) {
        return {
            planning: buildImportPlan(rows, state.planning, mode, period),
            account: buildTablePlan(derived.accounts, state.account, mode, period, 'nama_akun'),
            project: buildTablePlan(derived.projects, state.project, mode, period, 'nama_proyek_up')
        };
    }

    function renderImportPlan(plans, state, mode, period, ctx) {
        const esc = window.Formatters.escapeHtml;
        const n = value => value.toLocaleString('id-ID');
        const tableRows = Object.keys(TABLE_LABELS).map(key => {
            const s = plans[key].stats;
            return `<tr class="border-t border-white/10">
                <td class="py-1.5 pr-2 text-slate-200">${TABLE_LABELS[key]}</td>
                <td class="py-1.5 text-right text-slate-400">${n(state[key].length)}</td>
                <td class="py-1.5 text-right font-bold text-emerald-300">${n(s.created)}</td>
                <td class="py-1.5 text-right font-bold text-sky-300">${n(s.updated)}</td>
                <td class="py-1.5 text-right text-slate-300">${n(s.unchanged)}</td>
                <td class="py-1.5 text-right font-bold ${s.removed ? 'text-rose-300' : 'text-slate-300'}">${n(s.removed)}</td>
            </tr>`;
        }).join('');

        const { checkResults, derived, coaEffective, rows } = ctx;
        const checksHtml = checkResults.map(c => `<li class="${c.ok === false ? 'text-rose-300' : c.ok ? 'text-emerald-300' : 'text-slate-400'}">${c.ok === false ? '✖' : c.ok ? '✔' : '–'} ${esc(c.label)}: ${esc(c.detail)}</li>`).join('');
        const warnings = [];
        const skipped = pendingImport.entries.length - rows.length;
        if (skipped) warnings.push(`${skipped} baris error dilewati${mode === 'replace' ? ' — pada mode Ganti semua, data lama yang cocok dengan baris itu ikut terhapus' : ''}.`);
        if (derived.warnings.withoutMonth) warnings.push(`${derived.warnings.withoutMonth} baris tanpa tanggal/bulan dihitung ke Januari.`);
        if (derived.warnings.withoutAccount) warnings.push(`${derived.warnings.withoutAccount} baris tanpa nama akun tidak masuk Budget Akun.`);
        if (derived.warnings.withoutProject) warnings.push(`${derived.warnings.withoutProject} baris tanpa proyek tidak masuk Budget Proyek.`);
        if (coaEffective?.length) {
            const known = new Set(coaEffective.map(c => lc(c.nama)));
            const unknown = [...new Set(rows.map(r => r.account_name).filter(a => a && !known.has(lc(a))))];
            if (unknown.length) warnings.push(`${unknown.length} nama akun tidak ada di Master COA: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}`);
        }
        const depTotal = sumOf(derived.depMonthly);
        const hasExisting = hasAnyRows(state);
        return `
            <p class="m-0 mb-2 text-xs text-slate-300">${mode === 'new'
                ? `Periode <strong>${esc(period)}</strong> dibuat kosong, lalu diisi dari file. Data periode lain tidak disentuh.`
                : `Periode <strong>${esc(period)}</strong> saat ini sudah berisi data.`}</p>
            <table class="w-full text-xs">
                <thead><tr class="text-left text-slate-400"><th class="pb-1 font-semibold">Tabel</th><th class="pb-1 text-right font-semibold">Sekarang</th><th class="pb-1 text-right font-semibold">Baru</th><th class="pb-1 text-right font-semibold">Diperbarui</th><th class="pb-1 text-right font-semibold">Sama</th><th class="pb-1 text-right font-semibold">Dihapus</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
            <p class="mb-0 mt-2 text-[11px] text-slate-400">Budget Akun &amp; Budget Proyek dihitung dari item per departemen${depTotal ? `, termasuk depresiasi asset Rp ${Math.round(depTotal / 12).toLocaleString('id-ID')}/bulan` : ''}.</p>
            <p class="mb-1 mt-3 text-xs font-bold text-slate-300">Cocokkan dengan sheet rekap di file</p>
            <ul class="m-0 list-none space-y-0.5 p-0 text-xs">${checksHtml}</ul>
            ${warnings.length ? `<ul class="mb-0 mt-3 list-disc space-y-0.5 pl-4 text-xs text-amber-300">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
            ${hasExisting ? '<p class="mb-0 mt-3 text-xs text-amber-300">Sebelum database diubah, data lama periode ini otomatis dibackup: snapshot di database (5 terbaru dipertahankan) dan file unduhan.</p>' : ''}
            ${mode === 'replace' ? '<p class="mb-0 mt-2 text-xs text-rose-300">Baris di database yang tidak ada di file akan dihapus dari ketiga tabel.</p>' : mode === 'upsert' ? '<p class="mb-0 mt-2 text-xs text-slate-400">Baris di database yang tidak ada di file dibiarkan.</p>' : ''}`;
    }

    async function refreshImportPlan() {
        if (!pendingImport || !window.SmartBaraCore.canWriteCloud()) return;
        const mode = getImportMode();
        const planEl = document.getElementById('creatorImportPlan');
        const activePeriod = window.SmartBaraCore.getActivePeriod();
        document.getElementById('creatorImportNewPeriodWrap').classList.toggle('hidden', mode !== 'new');
        document.getElementById('creatorImportTargetWrap').classList.toggle('hidden', mode === 'new');
        document.getElementById('creatorImportTargetPeriod').textContent = activePeriod;
        importPlanCache = null;
        const rows = getImportSelection().map(entry => entry.data);
        updateImportConfirmButton(rows.length);
        if (!rows.length) { planEl.innerHTML = ''; return; }

        const derived = computeDerived(rows);
        const checkResults = verifyAgainstFile(derived, rows, pendingImport.checks || {});
        const coaEffective = pendingImport.coa || await loadStoredCoa(activePeriod);
        const ctx = { rows, derived, checkResults, coaEffective };

        if (mode === 'new') {
            const state = { planning: [], account: [], project: [] };
            const typed = document.getElementById('creatorImportPeriodName').value.trim() || 'periode baru';
            planEl.innerHTML = renderImportPlan(buildAllPlans(state, 'new', typed, rows, derived), state, 'new', typed, ctx);
            updateImportConfirmButton(rows.length);
            return;
        }

        planEl.innerHTML = '<p class="m-0 text-xs text-slate-400">Menghitung perbandingan dengan data di database...</p>';
        try {
            const state = await captureState(activePeriod);
            if (getImportMode() !== mode || !pendingImport) return;
            const plans = buildAllPlans(state, mode, activePeriod, rows, derived);
            importPlanCache = { mode, period: activePeriod, state, plans, ctx };
            planEl.innerHTML = renderImportPlan(plans, state, mode, activePeriod, ctx);
            updateImportConfirmButton(rows.length);
        } catch (err) {
            planEl.innerHTML = `<p class="m-0 text-xs text-rose-300">Gagal membaca data periode: ${window.Formatters.escapeHtml(err.message)}</p>`;
        }
    }

    // Hapus baris planning yang tidak ada lagi di file (mode Ganti semua / pulihkan).
    async function removePlanningRows(period, removeRows) {
        if (!removeRows.length) return;
        const core = window.SmartBaraCore;
        const ids = new Set(removeRows.map(r => String(r.id)));
        if (storageMode === 'settings') {
            items = items.filter(item => !ids.has(String(item.id)));
            persistLocal(period);
            await core.syncVersionedRow('smartbara_settings', period, { key: getCacheKey(period) }, { value: items }, 'budgetCreatorFallback', 'Import Budget Creator');
        } else {
            const client = core.getClient();
            const list = [...ids];
            for (let offset = 0; offset < list.length; offset += 100) {
                const { error } = await client.from(TABLE_NAME).delete().eq('period_name', period).in('id', list.slice(offset, offset + 100));
                if (error) throw error;
            }
            items = items.filter(item => !ids.has(String(item.id)));
            persistLocal(period);
        }
        renderTable();
    }

    async function confirmImport() {
        if (!pendingImport || bulkOperationInProgress || importBusy) return;
        const core = window.SmartBaraCore;
        const selection = getImportSelection();
        const rows = selection.map(entry => entry.data);
        if (!rows.length) return;

        // Tanpa koneksi cloud: perilaku lama (simpan lokal, lewati duplikat).
        if (!core.canWriteCloud()) {
            const fresh = selection.filter(entry => !entry.duplicateOfExisting).map(entry => entry.data);
            const skipped = pendingImport.entries.length - fresh.length;
            closeImportReview();
            const result = await commitRows(fresh, { title: 'Mengimpor Excel Budget Creator', label: 'Budget Creator Import' });
            setStatus(`Import: ${describeCommitResult(result)}${skipped ? ` · ${skipped.toLocaleString('id-ID')} dilewati (error/duplikat)` : ''}.`, Boolean(result.failed.length));
            return;
        }

        const mode = getImportMode();
        const statusEl = document.getElementById('creatorImportStatus');
        const say = (msg, isError = false) => {
            statusEl.textContent = msg;
            statusEl.className = `min-w-0 flex-1 break-words text-xs font-semibold ${isError ? 'text-rose-400' : 'text-slate-400'}`;
        };
        if (mode === 'new' && !core.canManageSettings()) { say('Hanya superadmin yang dapat membuat periode baru.', true); return; }
        if (mode === 'replace' && !core.canDeleteData()) { say('Mode ganti semua hanya untuk superadmin/spv.', true); return; }

        let period = core.getActivePeriod();
        let state = { planning: [], account: [], project: [] };
        let plans;
        let ctx;
        let newPeriodName = '';

        if (mode === 'new') {
            newPeriodName = document.getElementById('creatorImportPeriodName').value.trim().replace(/\s+/g, ' ');
            if (!/^[\w -]{2,40}$/.test(newPeriodName) || !/\d{4}/.test(newPeriodName)) {
                say('Nama periode 2–40 karakter (huruf, angka, spasi, strip) dan harus memuat tahun, mis. GMI-BUDGET 2027.', true);
                return;
            }
            if ((core.getAvailablePeriods() || []).some(name => String(name).toLowerCase() === newPeriodName.toLowerCase())) {
                say(`Periode "${newPeriodName}" sudah ada. Pilih nama lain, atau gunakan mode Upsert / Ganti semua pada periode itu.`, true);
                return;
            }
            const derived = computeDerived(rows);
            ctx = { rows, derived };
        } else {
            if (!importPlanCache || importPlanCache.mode !== mode || importPlanCache.period !== period) { say('Rencana import belum siap. Tunggu perhitungan selesai.', true); return; }
            ({ state, plans, ctx } = importPlanCache);
            if (mode === 'replace') {
                const removed = Object.keys(TABLE_LABELS).map(k => `${TABLE_LABELS[k]}: ${plans[k].stats.removed} dihapus, ${plans[k].stats.created} baru, ${plans[k].stats.updated} diperbarui`).join('\n• ');
                if (!confirm(`GANTI SELURUH PERIODE "${period}"?\n\n• ${removed}\n\nData lama dibackup lebih dulu (database + file).`)) return;
            }
        }

        importBusy = true;
        updateImportConfirmButton(rows.length);
        const taskId = window.SmartBaraLayout.beginLoading('Import Excel', 'Menyiapkan import...');
        let succeeded = false;
        try {
            // 1) Backup data lama (wajib; gagal = batal sebelum database disentuh)
            if (mode !== 'new' && hasAnyRows(state)) {
                say('Menyimpan backup data lama (database + file)...');
                const backup = await backupBeforeChange(state, period, mode === 'replace' ? 'ganti-semua' : 'upsert');
                say(backup.fileName ? `Backup tersimpan di database dan diunduh: ${backup.fileName}` : 'Backup tersimpan di database (unduhan file gagal).');
            }

            // 2) Buat periode baru bila perlu
            if (mode === 'new') {
                say(`Membuat periode ${newPeriodName}...`);
                period = await core.addPeriod(newPeriodName);
                items = [];   // buang sisa data periode sebelumnya sebelum menyimpan
                plans = buildAllPlans(state, 'new', period, ctx.rows, ctx.derived);
            }

            // 3) Planning (pakai penyimpanan massal bawaan: per chunk, retry, antrean)
            say(`Menyimpan ${plans.planning.toWrite.length.toLocaleString('id-ID')} baris Creator Planning...`);
            const result = await commitRows(plans.planning.toWrite, { title: 'Mengimpor Excel Budget Creator', label: 'Budget Creator Import' });
            if (result.failed.length || result.queued.length) throw new Error(describeCommitResult(result));
            await removePlanningRows(period, plans.planning.toRemove);

            // 4) Budget akun, budget proyek, lalu Master COA
            say(`Menyimpan Budget Akun (${plans.account.toWrite.length}) dan Budget Proyek (${plans.project.toWrite.length})...`);
            await writeTablePlan(ACCOUNT_TABLE, period, plans.account, 'Import Budget Akun');
            cacheBudgetRows(ACCOUNT_TABLE, period, mergeAfterPlan(state.account, plans.account));
            await writeTablePlan(PROJECT_TABLE, period, plans.project, 'Import Budget Proyek');
            cacheBudgetRows(PROJECT_TABLE, period, mergeAfterPlan(state.project, plans.project));

            let coaNote = '';
            if (pendingImport.coa?.length) {
                try { await saveCoa(period, pendingImport.coa, pendingImport.fileName); coaNote = ` Master COA ${pendingImport.coa.length} akun disimpan.`; }
                catch (err) { coaNote = ` (Master COA gagal disimpan: ${err.message})`; }
            }
            succeeded = true;

            const part = key => `${plans[key].stats.created} baru/${plans[key].stats.updated} diperbarui/${plans[key].stats.removed} dihapus`;
            const msg = `Import selesai ke periode ${period} — Planning ${part('planning')}; Budget Akun ${part('account')}; Budget Proyek ${part('project')}.${coaNote}`;
            importBusy = false;
            closeImportReview();
            setStatus(msg);
            await loadData(true);
            loadReferenceOptions();
        } catch (err) {
            console.error('Import Excel error:', err);
            say(`Import gagal: ${err.message}${mode !== 'new' && hasAnyRows(state) ? ' Data lama aman di backup (database dan file unduhan); sebagian tabel mungkin sudah terisi — gunakan Pulihkan Backup bila perlu.' : ''}`, true);
        } finally {
            importBusy = false;
            window.SmartBaraLayout.endLoading(taskId, succeeded);
            if (pendingImport) updateImportConfirmButton(rows.length);
        }
    }

    // ---- Backup -----------------------------------------------------------------------
    const BACKUP_PREFIX = 'budget_creator_planning_backup__';   // harus berawalan budget_creator_planning_ (RLS spv/tim)
    const BACKUP_KEEP = 5;

    const hasAnyRows = state => Boolean(state.planning.length || state.account.length || state.project.length);

    function downloadPlanningBackup(state, period, modeLabel) {
        const now = new Date();
        const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
        const fileName = `Backup_BudgetCreator_${String(period).replace(/[^a-z0-9_-]+/gi, '_')}_sebelum-${modeLabel}_${stamp}.xlsx`;
        const header = ['Departemen', 'Nama Akun', 'Nama Proyek UP', 'Kebutuhan / Nama Barang', 'Spesifikasi / Alasan', 'Catatan Analisa', 'Tanggal Dibutuhkan', 'Jumlah', 'Satuan', 'Harga Satuan (Rp)', 'Prioritas', 'Status', 'ID Budget AI', 'ID Internal', 'Dibuat', 'Diubah'];
        const data = state.planning.map(r => [
            r.department || '', r.account_name || '', r.project_name || '', r.item_name || '', r.specification || '', r.catatan || '',
            r.needed_by ? String(r.needed_by).slice(0, 10) : '', Number(r.quantity) || 0, r.unit || '', Number(r.estimated_unit_price) || 0,
            r.priority || 'Normal', r.status || 'Draft', r.ai_budget_id || '', r.id || '', r.created_at || '', r.updated_at || ''
        ]);
        const budgetSheet = (rows, nameField) => [['Departemen', 'Nama', ...MONTH_SHORT], ...rows.map(r => [r.departemen ?? r.dept ?? '', r[nameField] ?? r.nama ?? '', ...MONTH_SHORT.map((_, i) => Number((r.budget || [])[i]) || 0)])];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...data]), 'Backup Planning');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(budgetSheet(state.account, 'nama_akun')), 'Budget Akun');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(budgetSheet(state.project, 'nama_proyek_up')), 'Budget Proyek');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
            ['Backup otomatis sebelum import Excel'], ['Periode', period], ['Mode import', modeLabel], ['Waktu backup', now.toLocaleString('id-ID')],
            ['Baris planning', state.planning.length], ['Baris budget akun', state.account.length], ['Baris budget proyek', state.project.length]
        ]), 'Info Backup');
        XLSX.writeFile(wb, fileName, { compression: true });
        return fileName;
    }

    function snapshotStamp(date = new Date()) {
        return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
    }

    function parseSnapshotKey(key, period) {
        const head = `${BACKUP_PREFIX}${period}__`;
        if (!String(key).startsWith(head)) return null;
        const [stamp, count] = String(key).slice(head.length).split('__');
        const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(stamp || '');
        if (!m) return null;
        return { key, stamp, count: Number(count) || 0, date: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) };
    }

    async function listSnapshots(period) {
        const client = window.SmartBaraCore.getClient();
        if (!client) return [];
        const { data, error } = await client.from('smartbara_settings').select('key').like('key', `${BACKUP_PREFIX}%`);
        if (error) throw error;
        return (data || []).map(r => parseSnapshotKey(r.key, period)).filter(Boolean).sort((a, b) => b.stamp.localeCompare(a.stamp));
    }

    async function saveSnapshot(state, period, modeLabel) {
        const client = window.SmartBaraCore.getClient();
        if (!client) throw new Error('Cloud belum siap untuk menyimpan snapshot backup.');
        const key = `${BACKUP_PREFIX}${period}__${snapshotStamp()}__${state.planning.length}`;
        const now = new Date().toISOString();
        const { error } = await client.from('smartbara_settings').insert({
            key,
            value: { period, mode: modeLabel, saved_at: now, count: state.planning.length, rows: state.planning, budget_rows: state.account, site_rows: state.project },
            updated_at: now
        });
        if (error) throw new Error(`Snapshot backup gagal disimpan: ${error.message}`);
        try {   // sisakan BACKUP_KEEP terbaru; gagal hapus tidak membatalkan import
            const old = (await listSnapshots(period)).slice(BACKUP_KEEP);
            if (old.length) await client.from('smartbara_settings').delete().in('key', old.map(o => o.key));
        } catch (err) {
            console.warn('Pembersihan snapshot lama gagal:', err);
        }
        return key;
    }

    // Snapshot di database wajib berhasil; file unduhan menyusul (gagal = hanya peringatan).
    async function backupBeforeChange(state, period, modeLabel) {
        const snapshotKey = await saveSnapshot(state, period, modeLabel);
        let fileName = '';
        try { fileName = downloadPlanningBackup(state, period, modeLabel); }
        catch (err) { console.warn('Unduh file backup gagal:', err); }
        return { snapshotKey, fileName };
    }

    // ---- Menulis ke database ------------------------------------------------------------
    async function writeTablePlan(table, period, plan, label) {
        const core = window.SmartBaraCore;
        if (plan.toWrite.length) {
            await core.syncCloudUpsert(table, plan.toWrite, 'id', `import:${table}:${period}:${Date.now()}`, label, { queueOnFailure: false });
        }
        if (plan.toRemove.length) {
            const client = core.getClient();
            for (let offset = 0; offset < plan.toRemove.length; offset += 100) {
                const ids = plan.toRemove.slice(offset, offset + 100).map(r => r.id);
                const { error } = await client.from(table).delete().eq('period_name', period).in('id', ids);
                if (error) throw error;
            }
        }
    }

    function mergeAfterPlan(existing, plan) {
        const removed = new Set(plan.toRemove.map(r => r.id));
        const written = new Set(plan.toWrite.map(r => r.id));
        return [...plan.toWrite, ...existing.filter(r => !written.has(r.id) && !removed.has(r.id))];
    }

    function cacheBudgetRows(table, period, rows) {
        const normalized = rows.map(r => ({
            id: r.id, period_name: period, nama: r.nama_akun ?? r.nama_proyek_up ?? r.nama ?? '', dept: r.departemen ?? r.dept ?? 'UMUM',
            budget: Array.isArray(r.budget) ? r.budget : emptyMonths(), created_at: r.created_at, updated_at: r.updated_at
        }));
        try { localStorage.setItem(cacheKeyFor(table, period), JSON.stringify(normalized)); } catch (e) { /* cache opsional */ }
    }

    // ---- Pulihkan backup -------------------------------------------------------------------
    async function openBackupDialog() {
        const modal = document.getElementById('creatorBackupModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
        document.getElementById('creatorBackupStatus').textContent = '';
        await renderBackupList();
    }

    function closeBackupDialog() {
        if (importBusy) return;
        const modal = document.getElementById('creatorBackupModal');
        modal.classList.add('opacity-0');
        setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); }, 200);
    }

    async function renderBackupList() {
        const period = window.SmartBaraCore.getActivePeriod();
        const listEl = document.getElementById('creatorBackupList');
        const esc = window.Formatters.escapeHtml;
        document.getElementById('creatorBackupPeriod').textContent = period;
        listEl.innerHTML = '<p class="m-0 text-xs text-slate-400">Memuat daftar backup...</p>';
        try {
            const snaps = await listSnapshots(period);
            if (!snaps.length) {
                listEl.innerHTML = '<p class="m-0 text-xs text-slate-400">Belum ada backup untuk periode ini. Backup dibuat otomatis sebelum import mode Upsert atau Ganti semua.</p>';
                return;
            }
            const canRestore = window.SmartBaraCore.canDeleteData();
            listEl.innerHTML = snaps.map(s => `
                <div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-3">
                    <div class="text-sm text-slate-200">${esc(s.date.toLocaleString('id-ID'))}<br><span class="text-xs text-slate-400">${s.count.toLocaleString('id-ID')} baris planning</span></div>
                    <button type="button" class="btn btn-secondary text-xs" ${canRestore ? '' : 'disabled title="Hanya superadmin/spv"'} data-restore-key="${esc(s.key)}">Pulihkan</button>
                </div>`).join('');
            listEl.querySelectorAll('[data-restore-key]').forEach(btn => btn.addEventListener('click', () => restoreSnapshot(btn.dataset.restoreKey)));
        } catch (err) {
            listEl.innerHTML = `<p class="m-0 text-xs text-rose-300">Gagal memuat backup: ${esc(err.message)}</p>`;
        }
    }

    async function restoreSnapshot(key) {
        const core = window.SmartBaraCore;
        const statusEl = document.getElementById('creatorBackupStatus');
        const say = (msg, isError = false) => {
            statusEl.textContent = msg;
            statusEl.className = `min-w-0 flex-1 break-words text-xs font-semibold ${isError ? 'text-rose-400' : 'text-slate-400'}`;
        };
        if (importBusy || bulkOperationInProgress) return;
        if (!core.canDeleteData() || !core.canWriteCloud()) { say('Pemulihan hanya untuk superadmin/spv dengan koneksi cloud.', true); return; }
        const period = core.getActivePeriod();
        const meta = parseSnapshotKey(key, period);
        if (!meta) { say('Backup tidak cocok dengan periode aktif.', true); return; }
        if (!confirm(`PULIHKAN periode "${period}" ke backup ${meta.date.toLocaleString('id-ID')} (${meta.count} baris planning)?\n\nIsi periode saat ini akan diganti. Kondisi saat ini dibackup lebih dulu.`)) return;

        importBusy = true;
        const taskId = window.SmartBaraLayout.beginLoading('Pulihkan backup', 'Membaca backup...');
        let succeeded = false;
        try {
            const { data, error } = await core.getClient().from('smartbara_settings').select('value').eq('key', key).maybeSingle();
            if (error) throw error;
            const snapshot = data?.value;
            if (!Array.isArray(snapshot?.rows)) throw new Error('Isi backup tidak ditemukan atau rusak.');

            say('Membackup kondisi saat ini...');
            const current = await captureState(period);
            if (hasAnyRows(current)) await backupBeforeChange(current, period, 'pulihkan');

            const now = new Date().toISOString();
            const restorePlan = (rows, existing) => {
                const toWrite = rows.map(r => ({ ...r, period_name: period, created_at: r.created_at || now, updated_at: now }));
                const keep = new Set(toWrite.map(r => r.id));
                return { toWrite, toRemove: existing.filter(r => !keep.has(r.id)) };
            };

            say(`Memulihkan ${snapshot.rows.length.toLocaleString('id-ID')} baris planning...`);
            const planningPlan = restorePlan(snapshot.rows, current.planning);
            const result = await commitRows(planningPlan.toWrite, { title: 'Memulihkan backup Budget Creator', label: 'Pulihkan backup' });
            if (result.failed.length || result.queued.length) throw new Error(describeCommitResult(result));
            await removePlanningRows(period, planningPlan.toRemove);

            const tableSets = [[ACCOUNT_TABLE, snapshot.budget_rows, current.account], [PROJECT_TABLE, snapshot.site_rows, current.project]];
            for (const [table, rows, existing] of tableSets) {
                if (!Array.isArray(rows)) continue;   // backup lama tanpa data budget
                const plan = restorePlan(rows, existing);
                await writeTablePlan(table, period, plan, 'Pulihkan backup');
                cacheBudgetRows(table, period, mergeAfterPlan(existing, plan));
            }
            succeeded = true;
            say(`Pemulihan selesai: ${snapshot.rows.length} baris planning dipulihkan.`);
            await renderBackupList();
            await loadData(true);
            loadReferenceOptions();
        } catch (err) {
            console.error('Restore backup error:', err);
            say(`Pemulihan gagal: ${err.message}`, true);
        } finally {
            importBusy = false;
            window.SmartBaraLayout.endLoading(taskId, succeeded);
        }
    }


    function pickSheetName(workbook) {
        const candidates = workbook.SheetNames.filter(name => !/referensi/i.test(name));
        return candidates.find(name => /rekap kebutuhan/i.test(name))
            || candidates.find(name => /template|plan|budget|kebutuhan/i.test(name)) || candidates[0] || workbook.SheetNames[0];
    }

    function detectHeaderRow(json) {
        for (let r = 0; r < Math.min(20, json.length); r++) {
            const cells = (json[r] || []).map(c => String(c || '').toLowerCase());
            const hasItem = cells.some(c => c.includes('kebutuhan') || c.includes('barang') || c.includes('item'));
            const hasContext = cells.some(c => /departemen|dept|akun|account|proyek|project/.test(c));
            if (hasItem && hasContext) return r;
        }
        return 0;
    }

    /** Petakan kolom: cocok persis dulu, baru "mengandung"; satu kolom tidak dipakai dua field. */
    function mapImportColumns(headerCells) {
        const header = headerCells.map(v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' '));
        const used = new Set();
        const pick = names => {
            for (const exact of [true, false]) {
                for (const name of names) {
                    const index = header.findIndex((cell, i) => !used.has(i) && cell && (exact ? cell === name : cell.includes(name)));
                    if (index >= 0) {
                        used.add(index);
                        return index;
                    }
                }
            }
            return -1;
        };
        // Urutan penting: field dengan nama spesifik dipetakan sebelum yang generik
        // (mis. "Harga Satuan" harus diambil sebelum "Satuan").
        const col = {};
        col.unitPrice = pick(['estimasi harga satuan (rp)', 'estimasi harga satuan', 'harga satuan (rp)', 'harga satuan', 'unit price']);
        col.total = pick(['estimasi total (rp)', 'estimasi total']);
        col.aiBudgetId = pick(['id budget ai', 'ai budget id', 'id budget']);
        col.department = pick(['departemen', 'department', 'dept']);
        col.account = pick(['nama akun', 'akun', 'account']);
        col.project = pick(['nama proyek up', 'nama proyek', 'proyek up', 'proyek', 'project']);
        col.item = pick(['kebutuhan / nama barang', 'kebutuhan / barang', 'nama barang', 'kebutuhan', 'barang', 'item']);
        col.specification = pick(['spesifikasi / alasan', 'spesifikasi', 'alasan', 'keterangan']);
        col.catatan = pick(['catatan analisa', 'catatan']);
        col.neededBy = pick(['tanggal dibutuhkan (yyyy-mm-dd)', 'tanggal dibutuhkan', 'tgl dibutuhkan', 'dibutuhkan', 'needed by']);
        col.quantity = pick(['jumlah (qty)', 'jumlah', 'qty', 'quantity']);
        col.unit = pick(['satuan', 'unit']);
        col.priority = pick(['prioritas', 'priority']);
        col.status = pick(['status']);
        col.month = header.findIndex((cell, i) => !used.has(i) && cell === 'bulan');
        return col;
    }

    function matchCanonical(value, options) {
        const key = normalizeKey(value);
        if (!key) return '';
        return options.find(option => normalizeKey(option) === key) || '';
    }

    function parseImportSheet(json) {
        const headerIdx = detectHeaderRow(json);
        const col = mapImportColumns(json[headerIdx] || []);
        if (col.item < 0) throw new Error('Kolom "Kebutuhan / Nama Barang" tidak ditemukan. Gunakan sheet Template Planning dari template Budget Creator.');

        const period = window.SmartBaraCore.getActivePeriod();
        const user = window.SmartBaraCore.getUser();
        const lists = getDatabaseLists();
        const selectedDepts = window.SmartBaraCore.getSelectedDepartments();
        const fallbackDept = selectedDepts.length === 1 ? selectedDepts[0] : '';
        const canApprove = window.SmartBaraCore.canApproveAllDepartments();
        const existingFingerprints = new Set(items.map(getRowFingerprint));
        const fileFingerprints = new Map();
        const getCell = (row, idx) => idx >= 0 ? row[idx] : undefined;
        const text = (row, idx) => String(getCell(row, idx) ?? '').trim();
        const isBlank = value => String(value ?? '').trim() === '';
        const now = new Date().toISOString();
        const entries = [];

        for (let i = headerIdx + 1; i < json.length; i++) {
            const row = json[i];
            if (!Array.isArray(row) || row.every(isBlank)) continue;
            const firstCell = String(row[0] ?? '').trim().toLowerCase();
            if (firstCell === 'total' || firstCell.startsWith('petunjuk')) continue;
            const itemName = text(row, col.item);
            if (!itemName) continue;

            const rowNumber = i + 1;
            const errors = [];
            const warnings = [];

            let department = text(row, col.department);
            if (!department && fallbackDept) {
                department = fallbackDept;
                warnings.push(`Departemen kosong, diisi ${fallbackDept} (filter departemen aktif).`);
            }
            if (!department) errors.push('Departemen wajib diisi.');
            else {
                const canonical = matchCanonical(department, lists.departments);
                if (canonical) department = canonical;
                else warnings.push(`Departemen "${department}" belum ada di daftar.`);
            }

            let accountName = text(row, col.account);
            if (accountName && lists.accounts.length) {
                const canonical = matchCanonical(accountName, lists.accounts);
                if (canonical) accountName = canonical;
                else warnings.push(`Akun "${accountName}" tidak ada di Budget Plan periode ini.`);
            }
            let projectName = text(row, col.project);
            if (projectName && lists.projects.length) {
                const canonical = matchCanonical(projectName, lists.projects);
                if (canonical) projectName = canonical;
                else warnings.push(`Proyek "${projectName}" tidak ada di referensi.`);
            }

            const rawQty = getCell(row, col.quantity);
            const quantity = window.Formatters.parseNumber(rawQty, isBlank(rawQty) ? 1 : NaN);
            if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Jumlah tidak valid ("${String(rawQty ?? '')}").`);

            const rawPrice = getCell(row, col.unitPrice);
            const price = window.Formatters.parseNumber(rawPrice, isBlank(rawPrice) ? 0 : NaN);
            if (!Number.isFinite(price) || price < 0) errors.push(`Harga satuan tidak valid ("${String(rawPrice ?? '')}").`);
            else if (price === 0) warnings.push('Harga satuan 0.');

            const rawDate = getCell(row, col.neededBy);
            const neededBy = window.Formatters.normalizeDate(rawDate);
            if (!isBlank(rawDate) && !neededBy) warnings.push(`Tanggal "${String(rawDate)}" tidak terbaca, dikosongkan.`);
            const monthOnly = !neededBy && isBlank(rawDate) ? Number(text(row, col.month)) : 0;

            const rawPriority = text(row, col.priority);
            const priority = PRIORITIES.find(p => p.toLowerCase() === rawPriority.toLowerCase()) || 'Normal';
            if (rawPriority && priority.toLowerCase() !== rawPriority.toLowerCase()) warnings.push(`Prioritas "${rawPriority}" tidak dikenal, dipakai Normal.`);

            const rawStatus = text(row, col.status);
            let status = STATUSES.find(s => s.toLowerCase() === rawStatus.toLowerCase()) || 'Draft';
            if (rawStatus && status.toLowerCase() !== rawStatus.toLowerCase()) warnings.push(`Status "${rawStatus}" tidak dikenal, dipakai Draft.`);
            if (FINAL_STATUSES.includes(status) && !canApprove) {
                warnings.push(`Status ${status} butuh Superadmin, diubah menjadi Diajukan.`);
                status = 'Diajukan';
            }

            const data = {
                id: crypto.randomUUID(),
                period_name: period,
                department,
                account_name: accountName,
                project_name: projectName,
                item_name: itemName,
                specification: text(row, col.specification),
                catatan: text(row, col.catatan),
                ai_budget_id: text(row, col.aiBudgetId) || null,
                quantity: Number.isFinite(quantity) ? quantity : 0,
                unit: text(row, col.unit) || 'unit',
                estimated_unit_price: Number.isFinite(price) ? price : 0,
                priority,
                needed_by: neededBy,
                status,
                created_by: user?.id || null,
                created_at: now,
                updated_at: now
            };

            if (monthOnly >= 1 && monthOnly <= 12) data._month = monthOnly;
            const fingerprint = getRowFingerprint(data);
            const duplicateOfExisting = existingFingerprints.has(fingerprint);
            if (fileFingerprints.has(fingerprint)) warnings.push(`Sama persis dengan baris ${fileFingerprints.get(fingerprint)} di file ini.`);
            else fileFingerprints.set(fingerprint, rowNumber);

            entries.push({ rowNumber, data, errors, warnings, duplicateOfExisting });
        }
        // Baris yang hanya punya kolom Bulan: tanggal 1 pada tahun yang dominan di file.
        const monthYear = guessYear(entries.map(entry => entry.data), period);
        entries.forEach(entry => {
            if (entry.data._month) entry.data.needed_by = `${monthYear}-${pad2(entry.data._month)}-01`;
            delete entry.data._month;
        });
        return entries;
    }

    async function importExcel(event) {
        const input = event?.target;
        const file = input?.files?.[0];
        if (input) input.value = '';
        if (!window.SmartBaraCore.canWriteData()) {
            setStatus('Level akses Viewer hanya dapat membaca kebutuhan.', true);
            return;
        }
        if (!file) return;
        if (bulkOperationInProgress) {
            setStatus('Masih ada proses upload berjalan. Tunggu hingga selesai.', true);
            return;
        }
        try { await window.ensureLibrary('xlsx'); }
        catch(e) {
            setStatus('Library Excel gagal dimuat. Periksa internet.', true);
            return;
        }

        const taskId = window.SmartBaraLayout.beginLoading('Membaca file Excel', file.name);
        try {
            // Tanpa cellDates: tanggal tetap serial Excel sehingga tidak bergeser karena zona waktu (WIB).
            const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
            const sheetName = pickSheetName(workbook);
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
            if (json.length < 2) throw new Error('File Excel kosong atau tidak valid.');
            const entries = parseImportSheet(json);
            if (!entries.length) throw new Error('Tidak ada baris kebutuhan yang terbaca di file.');
            if (entries.length > MAX_IMPORT_ROWS) throw new Error(`File berisi ${entries.length.toLocaleString('id-ID')} baris; maksimal ${MAX_IMPORT_ROWS.toLocaleString('id-ID')} per upload. Pecah file menjadi beberapa bagian.`);
            pendingImport = { fileName: file.name, sheetName, entries, ...parseReferenceSheets(workbook) };
            openImportReview();
            setStatus(`${entries.length.toLocaleString('id-ID')} baris terbaca dari ${file.name}. Tinjau sebelum disimpan.`);
        } catch(error) {
            console.error('Import error:', error);
            setStatus(`Import gagal: ${error.message}`, true);
        } finally {
            window.SmartBaraLayout.endLoading(taskId, true);
        }
    }

    function getImportSelection() {
        if (!pendingImport) return [];
        return pendingImport.entries.filter(entry => !entry.errors.length);
    }

    function openImportReview() {
        const modal = document.getElementById('creatorImportModal');
        if (!modal) return;
        const filter = document.getElementById('creatorImportIssueFilter');
        if (filter) filter.value = 'issues';
        initImportModes();
        renderImportReview();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
        refreshImportPlan();
    }

    function closeImportReview() {
        if (importBusy) return;
        importPlanCache = null;
        const modal = document.getElementById('creatorImportModal');
        if (modal) {
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 200);
        }
        pendingImport = null;
    }

    function renderImportReview() {
        if (!pendingImport) return;
        const { entries, fileName, sheetName } = pendingImport;
        const selection = getImportSelection();
        const errorCount = entries.filter(entry => entry.errors.length).length;
        const warningCount = entries.filter(entry => !entry.errors.length && entry.warnings.length).length;
        const duplicateCount = entries.filter(entry => entry.duplicateOfExisting).length;
        const total = selection.reduce((sum, entry) => sum + getRowTotal(entry.data), 0);
        const fmt = value => value.toLocaleString('id-ID');
        const escape = window.Formatters.escapeHtml;

        document.getElementById('creatorImportFileName').textContent = `${fileName} · sheet "${sheetName}"`;
        document.getElementById('creatorImportSummary').innerHTML = [
            ['Baris terbaca', fmt(entries.length), 'text-white'],
            ['Akan disimpan', fmt(selection.length), 'text-emerald-300'],
            ['Error (dilewati)', fmt(errorCount), errorCount ? 'text-rose-300' : 'text-slate-400'],
            ['Perlu dicek', fmt(warningCount), warningCount ? 'text-amber-300' : 'text-slate-400'],
            ['Duplikat database', fmt(duplicateCount), duplicateCount ? 'text-amber-300' : 'text-slate-400'],
            ['Estimasi total', window.Formatters.formatRupiah(total), 'text-teal-300']
        ].map(([label, value, color]) => `
            <div class="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2">
                <p class="m-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">${label}</p>
                <p class="m-0 mt-0.5 text-base font-black tabular-nums ${color}">${value}</p>
            </div>
        `).join('');

        const filter = document.getElementById('creatorImportIssueFilter')?.value || 'issues';
        const visible = entries.filter(entry => filter === 'all'
            || (filter === 'errors' && entry.errors.length)
            || (filter === 'issues' && (entry.errors.length || entry.warnings.length)));
        const limit = 500;
        const selectedRows = new Set(selection.map(entry => entry.rowNumber));
        const body = document.getElementById('creatorImportReviewBody');
        body.innerHTML = visible.length ? visible.slice(0, limit).map(entry => {
            const included = selectedRows.has(entry.rowNumber);
            const badge = entry.errors.length
                ? '<span class="badge badge-rose">Error</span>'
                : !included ? '<span class="badge badge-indigo">Dilewati</span>'
                : entry.warnings.length ? '<span class="badge badge-amber">Cek</span>' : '<span class="badge badge-emerald">OK</span>';
            const messages = [
                ...entry.errors.map(msg => `<li class="text-rose-300">${escape(msg)}</li>`),
                ...entry.warnings.map(msg => `<li class="text-amber-200">${escape(msg)}</li>`)
            ];
            return `
                <tr class="${included ? '' : 'opacity-60'}">
                    <td class="text-center text-xs text-slate-400 tabular-nums">${entry.rowNumber}</td>
                    <td class="text-center">${badge}</td>
                    <td class="text-xs">${escape(entry.data.department || '-')}</td>
                    <td class="text-xs max-w-[180px] truncate" title="${escape(entry.data.account_name)}">${escape(entry.data.account_name || '-')}</td>
                    <td class="text-xs max-w-[160px] truncate" title="${escape(entry.data.project_name)}">${escape(entry.data.project_name || '-')}</td>
                    <td class="text-xs font-bold text-teal-200 max-w-[200px] truncate" title="${escape(entry.data.item_name)}">${escape(entry.data.item_name)}</td>
                    <td class="text-xs text-slate-400 whitespace-nowrap">${escape(entry.data.needed_by || '-')}</td>
                    <td class="text-right text-xs tabular-nums">${window.Formatters.formatRupiah(getRowTotal(entry.data))}</td>
                    <td class="text-[11px]">${messages.length ? `<ul class="m-0 list-disc space-y-0.5 pl-4">${messages.join('')}</ul>` : '<span class="text-slate-500">-</span>'}</td>
                </tr>
            `;
        }).join('') + (visible.length > limit ? `<tr><td colspan="9" class="py-3 text-center text-xs text-slate-500">+${fmt(visible.length - limit)} baris lain tidak ditampilkan.</td></tr>` : '')
            : `<tr><td colspan="9" class="py-10 text-center text-xs text-slate-500">${filter === 'all' ? 'Tidak ada baris.' : 'Tidak ada masalah - semua baris valid.'}</td></tr>`;

        updateImportConfirmButton(selection.length);
    }

    function setStatus(msg, isError = false) {
        const el = document.getElementById('creatorStatusText');
        if (el) {
            el.textContent = msg;
            el.className = `text-xs font-semibold ${isError ? 'text-rose-400' : 'text-slate-400'}`;
        }
    }

    return {
        init,
        renderTable,
        openForm,
        closeForm,
        openAiDialog,
        closeAiDialog,
        recommendManualBudget,
        openAiBudget,
        loadAiBudgetById,
        copyAiBudgetId,
        previewAiDraft,
        sendAiMessage,
        renderAiPreview,
        addAiDraftRow,
        importAiDraft,
        saveForm,
        deleteAccountGroup,
        deleteItem,
        downloadTemplate,
        exportExcel,
        importExcel,
        closeImportReview,
        confirmImport,
        refreshImportPlan,
        openBackupDialog,
        closeBackupDialog,
        scheduleRender
    };
})();

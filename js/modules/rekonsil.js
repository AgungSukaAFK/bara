// ==============================================================================
// SMART BARA 7.10 HZ - REKONSIL BANK & SISTEM MODULE
// ==============================================================================

window.RekonsilModule = (function() {
    let deptData = {};
    let metaData = {};
    let historyLogs = [];
    let transactionOverrides = {};
    let transactionFilter = 'all';
    let transactionLimit = 200;
    let transactionRowsCache = null;
    let transactionSearchTimer = null;
    let historyFilterType = 'all';
    let historyFilterDept = 'all';
    let historyTimestampField = 'created_at';
    let historyUserField = 'user_email';
    let historyDisplayLimit = 100;
    let fullTableView = false;
    let budgetAccountOptions = [];
    let budgetProjectOptions = [];

    function getOverrideStorageKey(period) {
        return `smartbara_reconcile_overrides_${period}`;
    }

    function getCloudOverridePrefix(period) {
        return `smartbara_reconcile_override_${period}_`;
    }

    function getCloudOverrideKey(period, transactionId) {
        return `${getCloudOverridePrefix(period)}${transactionId}`;
    }

    function readLocalOverrides(period) {
        try {
            const value = JSON.parse(localStorage.getItem(getOverrideStorageKey(period)) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch(e) {
            return {};
        }
    }

    function applyTransactionOverrides(groupedRows) {
        return Object.fromEntries(Object.entries(groupedRows).map(([department, rows]) => [
            department,
            withStableIds(rows, department).map(row => ({ ...row, ...(transactionOverrides[row.id] || {}) }))
        ]));
    }

    function saveLocalOverrides(period) {
        localStorage.setItem(getOverrideStorageKey(period), JSON.stringify(transactionOverrides));
    }

    async function init() {
        renderTable();
        window.addEventListener('smartbara:period_change', async () => {
            await Promise.all([loadData(), loadBudgetOptions()]);
        });
        window.addEventListener('smartbara:dept_filter_change', () => loadData(true));
        window.addEventListener('smartbara:store_loaded', event => {
            if (event.detail?.period === window.SmartBaraCore.getActivePeriod()) {
                loadData(true).then(loadBudgetOptions);
            }
        });
        window.SmartBaraCore.onRealtimeChange(payload => {
            if (payload.table === 'smartbara_store') {
                window.SmartBaraCore.loadPeriodStore(window.SmartBaraCore.getActivePeriod(), true, { showOverlay: false });
            } else if (payload.table === 'smartbara_budget' || payload.table === 'smartbara_budget_site') {
                loadBudgetOptions();
            } else if (payload.table === 'smartbara_meta' || payload.table === 'smartbara_history' || payload.table === 'smartbara_settings') {
                loadData(true);
            }
        });
        await populatePeriodOptions();
        await Promise.all([loadData(), loadBudgetOptions()]);
        renderTransactions();
    }

    async function loadData(silent = false) {
        const period = window.SmartBaraCore.getActivePeriod();
        const client = window.SmartBaraCore.getClient();

        const groupedRows = {};
        window.SmartBaraCore.getAllTransactions().forEach(row => {
            const department = String(row.dept || row._department || 'UMUM').toUpperCase();
            if (!groupedRows[department]) groupedRows[department] = [];
            groupedRows[department].push(row);
        });
        transactionOverrides = readLocalOverrides(period);
        deptData = applyTransactionOverrides(groupedRows);
        transactionRowsCache = null;
        try {
            metaData = JSON.parse(localStorage.getItem(`smartbara_meta_${period}`) || '{}');
        } catch(e) {
            metaData = {};
        }
        renderTable();
        renderTransactions();

        if (!silent) setStatus('Memuat data transaksi dan rekonsiliasi...');

        if (!client) {
            setStatus('Mode offline (koneksi database belum aktif)');
            return;
        }

        try {
            const [metaRes, overrideRes, historyLogsResult] = await Promise.all([
                client.from('smartbara_meta').select('*').eq('period_name', period),
                client.from('smartbara_settings').select('key, value, updated_at').like('key', `${getCloudOverridePrefix(period)}%`),
                loadHistoryLogs(client, period)
            ]);
            if (metaRes.error) throw metaRes.error;
            if (!overrideRes.error && Array.isArray(overrideRes.data)) {
                transactionOverrides = { ...transactionOverrides };
                overrideRes.data.forEach(item => {
                    const transactionId = String(item.value?.transaction_id || item.key.slice(getCloudOverridePrefix(period).length));
                    if (item.value?.override && typeof item.value.override === 'object') {
                        transactionOverrides[transactionId] = item.value.override;
                        window.SmartBaraCore.setCloudVersion(period, `reconcileOverride:${transactionId}`, item.updated_at);
                    }
                });
                saveLocalOverrides(period);
                deptData = applyTransactionOverrides(groupedRows);
                transactionRowsCache = null;
            }
            const selectedDepts = new Set(window.SmartBaraCore.getSelectedDepartments().map(dept => String(dept).toUpperCase()));
            (metaRes.data || []).filter(meta => selectedDepts.has(String(meta.meta_key || '').toUpperCase())).forEach(m => {
                metaData[m.meta_key] = m;
                window.SmartBaraCore.setCloudVersion(period, `meta:${m.meta_key}`, m.updated_at);
            });

            historyLogs = historyLogsResult;
            historyDisplayLimit = 100;
            transactionRowsCache = null;
            renderTable();
            renderTransactions();
            renderHistory();
            setStatus('Data rekonsiliasi tersinkronisasi.');
        } catch(err) {
            console.warn('Load rekonsil error:', err);
            setStatus(`Gagal memuat: ${err.message}`, true);
        }
    }

    function isRekonsilHistoryLog(log) {
        const action = String(log?.action || '').toUpperCase();
        const recordId = String(log?.record_id || '').toLowerCase();
        const rekonsilMarkers = [
            'UPDATE_REKONSIL',
            'UPDATE_REKONSIL_TRANSACTION',
            'IMPORT_REKONSIL_CHANGE',
            'IMPORT_REKONSIL'
        ];
        return rekonsilMarkers.some(marker => action.includes(marker)) || recordId.includes('rekonsil');
    }

    async function loadHistoryLogs(client, period) {
        historyTimestampField = 'created_at';
        let result = await client.from('smartbara_history').select('*').eq('period_name', period).order(historyTimestampField, { ascending: false }).limit(5000);
        if (result.error) {
            historyTimestampField = 'changed_at';
            result = await client.from('smartbara_history').select('*').eq('period_name', period).order(historyTimestampField, { ascending: false }).limit(5000);
        }
        if (result.error) {
            console.warn('Load history log warning:', result.error.message);
            return [];
        }
        let logs = (result.data || []).filter(log => isRekonsilHistoryLog(log));

        const selectedDepartments = window.SmartBaraCore.getSelectedDepartments().map(dept => String(dept || '').toUpperCase());
        if (selectedDepartments.length === 1 && selectedDepartments[0] === 'GA') {
            logs = logs.filter(log => getHistoryLogDept(log) === 'GA');
        }

        historyUserField = logs.some(log => Object.prototype.hasOwnProperty.call(log, 'changed_by')) || historyTimestampField === 'changed_at'
            ? 'changed_by'
            : 'user_email';
        return logs;
    }

    function withStableIds(rows, department) {
        const occurrences = new Map();
        return rows.map(row => {
            const identity = [department, row.nama_akun || row.akun, row.proyek, row.no_sumber, row.keterangan]
                .map(value => String(value || '').trim().toLowerCase()).join('|');
            const occurrence = (occurrences.get(identity) || 0) + 1;
            occurrences.set(identity, occurrence);
            return { ...row, id: window.SmartBaraCore.createTransactionId(row, department, occurrence) };
        });
    }

    function normalizeFieldName(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function getTransactionField(row, names) {
        const entries = Object.entries(row || {});
        for (const name of names) {
            const entry = entries.find(([key]) => normalizeFieldName(key) === normalizeFieldName(name));
            if (entry) return entry[1];
        }
        return undefined;
    }

    function toNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function getFinanceValue(row, includeAdjustment = true) {
        const debit = getTransactionField(row, ['debit', 'debet']);
        const credit = getTransactionField(row, ['kredit', 'credit']);
        const finance = getTransactionField(row, ['finance']);
        const base = debit !== undefined || credit !== undefined
            ? toNumber(debit) - toNumber(credit)
            : toNumber(finance);
        return base + (includeAdjustment ? toNumber(row.adj_finance) : 0);
    }

    function getReconcileValue(row, includeAdjustment = true) {
        const base = toNumber(getTransactionField(row, ['rekonsil', 'nilai rekonsil', 'reconcile']));
        return base + (includeAdjustment ? toNumber(row.adj_rekonsil) : 0);
    }

    function needsReconciliation(row) {
        const values = [
            getTransactionField(row, ['debit', 'debet']),
            getTransactionField(row, ['kredit', 'credit']),
            getTransactionField(row, ['finance']),
            row.adj_finance,
            getReconcileValue(row)
        ];
        return values.some(value => Math.abs(toNumber(value)) > 0.01);
    }

    function hasTransactionChanges(row) {
        return Math.abs(toNumber(row.adj_finance)) > 0.001 || Math.abs(toNumber(row.adj_rekonsil)) > 0.001 ||
            Boolean(String(row.catatan_manual || '').trim() || row.nama_akun_manual || row.proyek_manual);
    }

    async function populatePeriodOptions() {
        const select = document.getElementById('rekonsilSourcePeriod');
        if (!select) return;
        const activePeriod = window.SmartBaraCore.getActivePeriod();
        const periods = await window.SmartBaraCore.loadAvailablePeriods();
        const sources = (periods || []).filter(period => period !== activePeriod);
        select.innerHTML = sources.length
            ? sources.map(period => `<option value="${window.Formatters.escapeHtml(period)}">Dari ${window.Formatters.escapeHtml(period)}</option>`).join('')
            : '<option value="">Tidak ada periode sumber</option>';
    }

    function getHistoryLabel(log) {
        const action = String(log?.action || '').toUpperCase();
        const tableName = String(log?.table_name || '').toLowerCase();
        if (action.includes('UPDATE_REKONSIL_TRANSACTION') || action.includes('IMPORT_REKONSIL')) return 'Rekonsil';
        if (action.includes('NAMA_AKUN_MANUAL') || action.includes('AKUN')) return 'Akun Manual';
        if (action.includes('PROYEK_MANUAL') || action.includes('PROYEK') || tableName.includes('proyek')) return 'Proyek Manual';
        if (action.includes('CATATAN')) return 'Catatan';
        if (action.includes('REKONSIL')) return 'Rekonsil';
        if (tableName.includes('store')) return 'Departemen';
        return 'Umum';
    }

    function getHistoryLogDept(log) {
        const recordId = String(log?.record_id || '');
        const tableName = String(log?.table_name || '').toLowerCase();
        const knownDepartments = ['GA', 'IT', 'LEGAL', 'HR', 'FINANCE', 'HSE', 'LOGISTIK', 'OPERASIONAL', 'PRODUKSI', 'SHE', 'TAMBANG', 'SHIPPING', 'UMUM'];
        const explicitPrefix = /^([A-Z]+)(?=[:|/\\_-])/i.exec(recordId)?.[1]?.toUpperCase() || '';
        if (knownDepartments.includes(explicitPrefix)) {
            return explicitPrefix;
        }
        if (knownDepartments.includes(recordId.trim().toUpperCase())) return recordId.trim().toUpperCase();
        if (tableName.includes('proyek')) return 'ALL';
        return 'ALL';
    }

    function setHistoryFilter(type, dept = historyFilterDept) {
        historyFilterType = type || 'all';
        historyFilterDept = dept || 'all';
        renderHistory();
    }

    function populateHistoryFilters() {
        const deptFilter = document.getElementById('rekonsilHistoryDeptFilter');
        if (!deptFilter) return;

        const activeDepartments = window.SmartBaraCore.getSelectedDepartments().map(dept => String(dept || '').toUpperCase());
        const deptList = [...new Set((activeDepartments.length ? activeDepartments : Object.keys(deptData).map(dept => String(dept || '').toUpperCase())).filter(Boolean))].sort();

        if (deptList.length === 1 && deptList[0] !== 'ALL') {
            historyFilterDept = deptList[0];
        } else if (!deptList.includes(historyFilterDept)) {
            historyFilterDept = 'all';
        }

        const current = deptList.includes(historyFilterDept) ? historyFilterDept : 'all';
        deptFilter.innerHTML = ['<option value="all">Semua dept</option>']
            .concat(deptList.map(dept => `<option value="${dept}" ${current === dept ? 'selected' : ''}>${dept}</option>`))
            .join('');
        historyFilterDept = current;
    }

    function getTransactionTableData() {
        if (transactionRowsCache) return transactionRowsCache;

        const rows = Object.entries(deptData).flatMap(([dept, items]) => withStableIds(items, dept)
            .map(row => ({ ...row, dept: row.dept || dept })));
        const getMonth = row => {
            const date = window.SmartBaraFormatters.normalizeDate(getTransactionField(row, ['tanggal', 'tgl', 'date']));
            return date ? date.slice(5, 7) : '';
        };
        const getSearchText = row => [
            row.id,
            row.dept,
            getTransactionField(row, ['tanggal', 'tgl', 'date']),
            getTransactionField(row, ['no sumber', 'no_sumber', 'no']),
            getTransactionField(row, ['keterangan', 'deskripsi', 'uraian']),
            getTransactionField(row, ['nama_akun_manual', 'nama akun up', 'nama akun', 'nama akun induk', 'nama_akun', 'akun']),
            getTransactionField(row, ['proyek_manual', 'nama proyek up', 'nama proyek', 'proyek']),
            row.catatan,
            row.catatan_manual
        ].map(value => String(value || '').toLocaleLowerCase('id-ID')).join(' ');
        const cachedRows = rows.map(row => ({ ...row, _searchText: getSearchText(row), _month: getMonth(row) }));
        const activeDepartments = new Set(Object.keys(deptData).map(dept => dept.toUpperCase()));
        const activeMeta = Object.entries(metaData)
            .filter(([dept]) => activeDepartments.has(String(dept).toUpperCase()))
            .map(([, meta]) => meta);
        const financeTotal = rows.reduce((sum, row) => sum + getFinanceValue(row), 0)
            + activeMeta.reduce((sum, meta) => sum + toNumber(meta.adj_sistem), 0);
        const reconcileTotal = rows.reduce((sum, row) => sum + getReconcileValue(row), 0)
            + activeMeta.reduce((sum, meta) => sum + toNumber(meta.adj_bank), 0);
        const reconciliationRows = rows.filter(needsReconciliation);
        const reconciledCount = reconciliationRows.filter(row => Math.abs(getReconcileValue(row)) > 0.01).length;
        const changedCount = new Set(rows.filter(hasTransactionChanges).map(row => row.id)).size;
        const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
        setText('rekonsilStatFinance', window.Formatters.formatRupiah(financeTotal));
        setText('rekonsilStatReconcile', window.Formatters.formatRupiah(reconcileTotal));
        setText('rekonsilStatMatched', `${reconciledCount.toLocaleString('id-ID')} / ${reconciliationRows.length.toLocaleString('id-ID')}`);
        setText('rekonsilStatChanged', changedCount.toLocaleString('id-ID'));

        transactionRowsCache = { rows: cachedRows };
        return transactionRowsCache;
    }

    function readBudgetOptionCache(key) {
        try {
            const rows = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch(e) {
            return [];
        }
    }

    // Mengirim cache budget ke cloud tanpa menghapus apa pun: baris yang hanya ada di cloud
    // (mis. ditambahkan pengguna lain) tetap utuh, dan kegagalan tidak mengosongkan periode.
    async function syncBudgetCacheToCloud(client, tableName, cacheKey, period, label) {
        const nameColumn = tableName === 'smartbara_budget_site' ? 'nama_proyek_up' : 'nama_akun';
        const months = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
        const identityOf = (name, dept) => `${String(dept || '').trim().toUpperCase()}:${String(name || '').trim().toLocaleLowerCase('id-ID')}`;

        // Cache ditulis beberapa modul, ada yang memakai nama/dept dan ada yang memakai kolom cloud.
        const cachedRows = readBudgetOptionCache(cacheKey).map(row => ({
            id: String(row.id || ''),
            nama: String(row[nameColumn] || row.nama || row.nama_proyek || '').trim(),
            dept: String(row.departemen || row.dept || 'UMUM').trim(),
            budget: Array.isArray(row.budget) ? row.budget : months.map(month => Number(row[`budget_${month}`]) || 0)
        })).filter(row => row.nama);
        if (!cachedRows.length) return 0;

        const { data, error } = await client.from(tableName).select(`id,${nameColumn},departemen`).eq('period_name', period);
        if (error) throw error;
        const cloudRows = data || [];
        const cloudIds = new Set(cloudRows.map(row => String(row.id)));
        const cachedIds = new Set(cachedRows.map(row => row.id));

        // Baris cache dengan id asing dipasangkan ke baris cloud yang sama agar tidak menjadi duplikat.
        const unclaimedIds = new Map();
        cloudRows.filter(row => !cachedIds.has(String(row.id))).forEach(row => {
            const identity = identityOf(row[nameColumn], row.departemen);
            unclaimedIds.set(identity, [...(unclaimedIds.get(identity) || []), String(row.id)]);
        });

        const updatedAt = new Date().toISOString();
        const payload = new Map();
        cachedRows.forEach(row => {
            const id = cloudIds.has(row.id)
                ? row.id
                : unclaimedIds.get(identityOf(row.nama, row.dept))?.shift() || crypto.randomUUID();
            payload.set(id, { id, period_name: period, nama: row.nama, dept: row.dept, budget: row.budget, updated_at: updatedAt });
        });

        const rows = [...payload.values()];
        await window.SmartBaraCore.syncCloudUpsert(tableName, rows, 'id', `${tableName}-cache:${period}`, label, { queueOnFailure: false });
        return rows.length;
    }

    function normalizeBudgetOptions(rows) {
        const values = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const value = String(getTransactionField(row, ['nama', 'nama_akun', 'account_name', 'nama_proyek_up', 'nama_proyek', 'project_name']) || '').trim();
            const key = normalizeFieldName(value);
            if (value && key && !values.has(key)) values.set(key, value);
        });
        return [...values.values()].sort((a, b) => a.localeCompare(b, 'id'));
    }

    async function loadBudgetOptions() {
        const period = window.SmartBaraCore.getActivePeriod();
        const accountKey = `smartbara_budget_v2_${period}`;
        const projectKey = `smartbara_budget_site_v2_${period}`;
        let accountRows = readBudgetOptionCache(accountKey);
        let projectRows = readBudgetOptionCache(projectKey);
        const client = window.SmartBaraCore.getClient();

        if (client) {
            const [accountResult, projectResult] = await Promise.all([
                client.from('smartbara_budget').select('nama_akun').eq('period_name', period),
                client.from('smartbara_budget_site').select('nama_proyek_up').eq('period_name', period)
            ]);
            if (!accountResult.error && accountResult.data?.length) {
                accountRows = accountResult.data;
                localStorage.setItem(accountKey, JSON.stringify(accountRows));
            }
            if (!projectResult.error && projectResult.data?.length) {
                projectRows = projectResult.data;
                localStorage.setItem(projectKey, JSON.stringify(projectRows));
            }
        }

        budgetAccountOptions = normalizeBudgetOptions(accountRows);
        const transactionProjectRows = Object.values(deptData).flat().map(row => ({
            nama: getTransactionField(row, ['proyek_manual', 'nama proyek up', 'nama proyek', 'proyek'])
        }));
        budgetProjectOptions = normalizeBudgetOptions([...projectRows, ...transactionProjectRows]);
        if (document.getElementById('rekonsilTransactionTableBody')) renderTransactions();
    }

    function filterTransactionRows(rows) {
        const query = (document.getElementById('rekonsilTransactionSearch')?.value || '').trim().toLocaleLowerCase('id-ID');
        const month = document.getElementById('rekonsilTransactionMonthFilter')?.value || '';
        return rows.filter(row => {
            if (transactionFilter === 'unreconciled' && (!needsReconciliation(row) || Math.abs(getReconcileValue(row)) > 0.01)) return false;
            if (transactionFilter === 'changed' && !hasTransactionChanges(row)) return false;
            if (month && row._month !== month) return false;
            return !query || row._searchText.includes(query);
        });
    }

    function scheduleTransactionSearch() {
        window.clearTimeout(transactionSearchTimer);
        transactionLimit = 200;
        transactionSearchTimer = window.setTimeout(() => {
            transactionSearchTimer = null;
            renderTransactions();
        }, 180);
    }

    function setTransactionMonthFilter() {
        transactionLimit = 200;
        renderTransactions();
    }

    function toggleFullTableView() {
        fullTableView = !fullTableView;
        const wrap = document.getElementById('rekonsilTransactionTableWrap');
        const button = document.getElementById('rekonsilFullViewToggle');
        if (wrap) {
            wrap.classList.toggle('max-h-[55vh]', !fullTableView);
            wrap.classList.toggle('max-h-none', fullTableView);
        }
        if (button) {
            button.textContent = fullTableView ? 'Normal View' : 'Full View';
            button.classList.toggle('btn-primary', fullTableView);
            button.classList.toggle('btn-secondary', !fullTableView);
            button.setAttribute('aria-pressed', String(fullTableView));
        }
    }

    function renderBudgetOptionSelect(id, field, label, currentValue, options) {
        const current = String(currentValue || '').trim();
        const values = [...options];
        const matchingValue = values.find(value => normalizeFieldName(value) === normalizeFieldName(current));
        if (current && !matchingValue) values.unshift(current);
        const selected = matchingValue || current;
        const optionMarkup = values.map(value => {
            const safe = window.Formatters.escapeHtml(value);
            return `<option value="${safe}" ${value === selected ? 'selected' : ''}>${safe}</option>`;
        }).join('');
        return `<select onchange="RekonsilModule.updateTransactionText('${window.Formatters.escapeHtml(id)}', '${field}', this.value)" class="form-select w-40 py-1 text-xs" aria-label="${label}">
            <option value="" ${selected ? '' : 'selected'}>Pilih ${label.toLowerCase()}...</option>
            ${optionMarkup}
        </select>`;
    }

    function renderTransactions() {
        const tbody = document.getElementById('rekonsilTransactionTableBody');
        if (!tbody) return;
        const { rows } = getTransactionTableData();
        const filtered = filterTransactionRows(rows);
        const visible = filtered.slice(0, transactionLimit);
        const countEl = document.getElementById('rekonsilTransactionCount');
        if (countEl) countEl.textContent = `${filtered.length.toLocaleString('id-ID')} transaksi${filtered.length > visible.length ? ` · menampilkan ${visible.length.toLocaleString('id-ID')}` : ''}`;
        const escape = value => window.Formatters.escapeHtml(value ?? '');
        tbody.innerHTML = visible.map(row => {
            const debit = toNumber(getTransactionField(row, ['debit', 'debet']));
            const credit = toNumber(getTransactionField(row, ['kredit', 'credit']));
            const finance = getFinanceValue(row);
            const reconcile = getReconcileValue(row);
            const variance = finance - reconcile;
            const defaultAccount = getTransactionField(row, ['_calcAkun', '_akunOverride', 'nama akun up', 'nama akun induk', 'nama akun', 'nama_akun', 'akun']) || '';
            const defaultProject = getTransactionField(row, ['_calcProyek', '_proyekOverride', 'nama proyek up', 'nama proyek', 'proyek', 'project']) || '';
            const currentAccount = getTransactionField(row, ['nama_akun_manual']) || defaultAccount;
            const currentProject = getTransactionField(row, ['proyek_manual']) || defaultProject;
            return `<tr class="hover:bg-white/[0.03]">
                <td class="font-mono text-[10px] text-teal-300 whitespace-nowrap">${escape(row.id)}</td>
                <td class="text-slate-400">${escape(row.dept)}</td>
                <td class="text-slate-400 whitespace-nowrap">${escape(getTransactionField(row, ['tanggal', 'tgl']) || '-')}</td>
                <td class="text-slate-400 whitespace-nowrap">${escape(getTransactionField(row, ['no sumber', 'no_sumber', 'no']) || '-')}</td>
                <td class="text-slate-400 min-w-48">${escape(getTransactionField(row, ['keterangan', 'deskripsi', 'uraian']) || '-')}</td>
                <td>
                    ${renderBudgetOptionSelect(row.id, 'nama_akun_manual', 'Nama akun manual', currentAccount, budgetAccountOptions)}
                    <p class="mt-1 text-[10px] text-slate-400">Default: ${escape(defaultAccount || '-')}</p>
                </td>
                <td>
                    ${renderBudgetOptionSelect(row.id, 'proyek_manual', 'Nama proyek manual', currentProject, budgetProjectOptions)}
                    <p class="mt-1 text-[10px] text-slate-400">Default: ${escape(defaultProject || '-')}</p>
                </td>
                <td class="text-right">${window.Formatters.formatRupiah(debit)}</td>
                <td class="text-right">${window.Formatters.formatRupiah(credit)}</td>
                <td class="text-right">${window.Formatters.formatRupiah(finance)}</td>
                <td><input type="number" step="1" value="${reconcile}" onchange="RekonsilModule.updateTransactionReconcile('${escape(row.id)}', this.value)" class="form-input w-28 py-1 text-right text-xs text-teal-300 font-bold" aria-label="Nilai rekonsil manual"></td>
                <td class="text-right ${Math.abs(variance) > 0.01 ? 'text-amber-300' : 'text-emerald-300'}">${window.Formatters.formatRupiah(variance)}</td>
                <td><input type="text" value="${escape(row.catatan_manual || '')}" onchange="RekonsilModule.updateTransactionNote('${escape(row.id)}', this.value)" placeholder="Catatan manual..." class="form-input w-32 py-1 text-xs" aria-label="Catatan manual"></td>
                <td>
                    <button type="button" onclick="RekonsilModule.applyManualRowChange('${escape(row.id)}')" class="btn btn-secondary text-[10px] px-2 py-1 whitespace-nowrap">Tambah perubahan manual</button>
                    <span class="mt-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold ${hasTransactionChanges(row) ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}">
                        ${hasTransactionChanges(row) ? 'Sudah diubah' : 'Belum' }
                    </span>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="14" class="py-8 text-center text-slate-500">Tidak ada transaksi yang cocok.</td></tr>';
        const loadMore = document.getElementById('rekonsilLoadMoreButton');
        if (loadMore) loadMore.classList.toggle('hidden', visible.length >= filtered.length);
        ['all', 'unreconciled', 'changed'].forEach(filter => {
            const id = filter === 'all' ? 'rekonsilFilterAll' : filter === 'unreconciled' ? 'rekonsilFilterUnreconciled' : 'rekonsilFilterChanged';
            const button = document.getElementById(id);
            if (button) {
                button.classList.toggle('btn-primary', transactionFilter === filter);
                button.classList.toggle('btn-secondary', transactionFilter !== filter);
            }
        });
    }

    async function applyManualRowChange(id) {
        if (!window.SmartBaraCore.canWriteData()) return setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
        const located = Object.entries(deptData).map(([dept, rows]) => ({ dept, row: rows.find(item => item.id === id) })).find(item => item.row);
        if (!located) return;
        const accountValue = String(getTransactionField(located.row, ['nama_akun_manual', 'nama akun up', 'nama akun', 'nama_akun', 'akun']) || '').trim();
        const projectValue = String(getTransactionField(located.row, ['proyek_manual', 'nama proyek up', 'proyek', 'nama proyek']) || '').trim();
        const noteValue = String(located.row.catatan_manual || '').trim() || 'Perubahan manual ditambahkan';
        let changed = false;

        if (accountValue) {
            const current = String(located.row.nama_akun_manual || '');
            if (current !== accountValue) {
                located.row.nama_akun_manual = accountValue;
                await saveTransactionChange(located.dept, located.row, 'nama_akun_manual', current, accountValue);
                changed = true;
            }
        }

        if (projectValue) {
            const current = String(located.row.proyek_manual || '');
            if (current !== projectValue) {
                located.row.proyek_manual = projectValue;
                await saveTransactionChange(located.dept, located.row, 'proyek_manual', current, projectValue);
                changed = true;
            }
        }

        if (noteValue && String(located.row.catatan_manual || '') !== noteValue) {
            const oldNote = String(located.row.catatan_manual || '');
            located.row.catatan_manual = noteValue;
            await saveTransactionChange(located.dept, located.row, 'catatan_manual', oldNote, noteValue);
            changed = true;
        }

        if (!changed) {
            setStatus('Tidak ada perubahan manual baru yang perlu ditambahkan.', true);
        }
        renderTable();
        renderTransactions();
    }

    async function updateTransactionReconcile(id, value) {
        if (!window.SmartBaraCore.canWriteData()) return setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
        const located = Object.entries(deptData).map(([dept, rows]) => ({ dept, row: rows.find(item => item.id === id) })).find(item => item.row);
        if (!located) return;
        const oldValue = toNumber(located.row.adj_rekonsil);
        const newValue = toNumber(value) - getReconcileValue(located.row, false);
        if (Math.abs(oldValue - newValue) < 0.001) return;
        located.row.adj_rekonsil = newValue;
        await saveTransactionChange(located.dept, located.row, 'adj_rekonsil', oldValue, newValue);
    }

    async function updateTransactionNote(id, value) {
        if (!window.SmartBaraCore.canWriteData()) return setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
        const located = Object.entries(deptData).map(([dept, rows]) => ({ dept, row: rows.find(item => item.id === id) })).find(item => item.row);
        if (!located) return;
        const oldValue = String(located.row.catatan_manual || '');
        const newValue = String(value || '').trim();
        if (oldValue === newValue) return;
        located.row.catatan_manual = newValue;
        await saveTransactionChange(located.dept, located.row, 'catatan_manual', oldValue, newValue);
    }

    async function updateTransactionText(id, field, value) {
        if (!window.SmartBaraCore.canWriteData()) return setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
        if (!['nama_akun_manual', 'proyek_manual'].includes(field)) return;
        const located = Object.entries(deptData).map(([dept, rows]) => ({ dept, row: rows.find(item => item.id === id) })).find(item => item.row);
        if (!located) return;
        const oldValue = String(located.row[field] || '');
        const newValue = String(value || '').trim();
        if (oldValue === newValue) return;
        located.row[field] = newValue;
        await saveTransactionChange(located.dept, located.row, field, oldValue, newValue);
    }

    async function exportToExcel() {
        try {
            await window.SmartBaraConfig.ensureLibrary('sheetjs');
            const rows = filterTransactionRows(getTransactionTableData().rows).map(row => ({
                'ID Transaksi': row.id,
                Departemen: row.dept || dept,
                Tanggal: getTransactionField(row, ['tanggal', 'tgl']) || '',
                'No Sumber': getTransactionField(row, ['no sumber', 'no_sumber', 'no']) || '',
                Keterangan: getTransactionField(row, ['keterangan', 'deskripsi', 'uraian']) || '',
                'Nama Akun': getTransactionField(row, ['nama_akun_manual', 'nama akun up', 'nama akun', 'nama_akun', 'akun']) || '',
                'Nama Proyek': getTransactionField(row, ['proyek_manual', 'nama proyek up', 'nama proyek', 'proyek']) || '',
                Debit: toNumber(getTransactionField(row, ['debit', 'debet'])),
                Kredit: toNumber(getTransactionField(row, ['kredit', 'credit'])),
                Finance: getFinanceValue(row),
                'Rekonsil Manual': getReconcileValue(row),
                Selisih: getFinanceValue(row) - getReconcileValue(row),
                'Catatan Manual': row.catatan_manual || ''
            }));
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Rekonsil Anggaran');
            XLSX.writeFile(workbook, `Rekonsil_Anggaran_${window.SmartBaraCore.getActivePeriod()}.xlsx`);
            setStatus(`${rows.length.toLocaleString('id-ID')} transaksi diekspor.`);
        } catch(error) {
            setStatus(`Gagal export: ${error.message}`, true);
        }
    }

    async function importChanges(event) {
        if (!window.SmartBaraCore.canWriteData()) {
            setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
            if (event?.target) event.target.value = '';
            return;
        }
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            await window.SmartBaraConfig.ensureLibrary('sheetjs');
            const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const imports = XLSX.utils.sheet_to_json(sheet, { defval: '' }).slice(0, 1000);
            const rowById = new Map(Object.entries(deptData).flatMap(([dept, rows]) => withStableIds(rows, dept).map(row => [row.id, { dept, row }])));
            const changedIds = new Set();
            const auditRows = [];
            let matched = 0;
            for (const imported of imports) {
                const id = getTransactionField(imported, ['id transaksi', 'id', 'transaction id']);
                const located = rowById.get(String(id || '').trim());
                if (!located) continue;
                const changes = [];
                const account = getTransactionField(imported, ['nama akun', 'nama_akun_manual']);
                const project = getTransactionField(imported, ['nama proyek', 'proyek_manual']);
                const reconcile = getTransactionField(imported, ['rekonsil manual', 'rekonsil']);
                const note = getTransactionField(imported, ['catatan manual', 'catatan']);
                if (account !== undefined && String(account).trim() !== String(located.row.nama_akun_manual || '')) {
                    changes.push(['nama_akun_manual', String(located.row.nama_akun_manual || ''), String(account).trim()]);
                }
                if (project !== undefined && String(project).trim() !== String(located.row.proyek_manual || '')) {
                    changes.push(['proyek_manual', String(located.row.proyek_manual || ''), String(project).trim()]);
                }
                if (reconcile !== undefined && reconcile !== '') {
                    const nextAdjustment = window.Formatters.parseNumber(reconcile, 0) - getReconcileValue(located.row, false);
                    if (Math.abs(toNumber(located.row.adj_rekonsil) - nextAdjustment) > 0.001) changes.push(['adj_rekonsil', toNumber(located.row.adj_rekonsil), nextAdjustment]);
                }
                if (note !== undefined && String(note).trim() !== String(located.row.catatan_manual || '')) {
                    changes.push(['catatan_manual', String(located.row.catatan_manual || ''), String(note).trim()]);
                }
                if (!changes.length) continue;
                changes.forEach(([field, oldValue, newValue]) => {
                    located.row[field] = newValue;
                    transactionOverrides[located.row.id] = { ...(transactionOverrides[located.row.id] || {}), [field]: newValue };
                    auditRows.push({
                        period_name: window.SmartBaraCore.getActivePeriod(),
                        action: 'IMPORT_REKONSIL_CHANGE',
                        table_name: 'smartbara_settings',
                        record_id: `${located.dept}:${located.row.id}`,
                        old_value: { [field]: oldValue },
                        new_value: { [field]: newValue },
                        user_email: window.SmartBaraCore.getUser()?.email || 'admin'
                    });
                });
                changedIds.add(located.row.id);
                matched++;
            }
            const period = window.SmartBaraCore.getActivePeriod();
            saveLocalOverrides(period);
            for (const id of changedIds) await saveOverrideToCloud(period, id);
            const client = window.SmartBaraCore.getClient();
            if (auditRows.length && client && window.SmartBaraCore.canWriteCloud()) {
                await saveHistoryToCloud(client, auditRows);
            }
            historyLogs = [...auditRows.map(row => ({ ...row, created_at: new Date().toISOString() })), ...historyLogs];
            transactionRowsCache = null;
            renderHistory();
            renderTable();
            renderTransactions();
            setStatus(`${matched.toLocaleString('id-ID')} transaksi perubahan diimpor.`);
        } catch(error) {
            setStatus(`Gagal import: ${error.message}`, true);
        } finally {
            event.target.value = '';
        }
    }

    async function saveTransactionChange(dept, row, field, oldValue, newValue) {
        const period = window.SmartBaraCore.getActivePeriod();
        transactionOverrides[row.id] = { ...(transactionOverrides[row.id] || {}), [field]: newValue };
        transactionRowsCache = null;
        saveLocalOverrides(period);
        try {
            await saveOverrideToCloud(period, row.id, dept);
            const client = window.SmartBaraCore.getClient();
            if (client && window.SmartBaraCore.canWriteCloud()) {
                const historyEntry = withHistoryTimestamp({
                    period_name: period,
                    action: 'UPDATE_REKONSIL_TRANSACTION',
                    table_name: 'smartbara_settings',
                    record_id: `${dept}:${row.id}`,
                    old_value: { [field]: oldValue },
                    new_value: { [field]: newValue },
                    user_email: window.SmartBaraCore.getUser()?.email || 'admin'
                });
                await saveHistoryToCloud(client, historyEntry);
                historyLogs.unshift(historyEntry);
            } else {
                historyLogs.unshift(withHistoryTimestamp({
                    period_name: period,
                    action: 'UPDATE_REKONSIL_TRANSACTION',
                    table_name: 'smartbara_settings',
                    record_id: `${dept}:${row.id}`,
                    old_value: { [field]: oldValue },
                    new_value: { [field]: newValue },
                    user_email: window.SmartBaraCore.getUser()?.email || 'admin'
                }));
            }
            renderHistory();
            setStatus(window.SmartBaraCore.canWriteCloud() ? 'Perubahan transaksi tersimpan dan disinkronkan.' : 'Perubahan transaksi tersimpan lokal.');
        } catch(error) {
            console.error('Save transaction reconciliation error:', error);
            setStatus(`Tersimpan lokal; sinkronisasi gagal: ${error.message}`, true);
        }
        renderTable();
        renderTransactions();
    }

    async function saveOverrideToCloud(period, transactionId, department) {
        const client = window.SmartBaraCore.getClient();
        if (!client || !window.SmartBaraCore.canWriteCloud()) return null;
        const key = getCloudOverrideKey(period, transactionId);
        return window.SmartBaraCore.syncVersionedRow(
            'smartbara_settings',
            period,
            { key },
            { value: { transaction_id: transactionId, department: department || '', override: transactionOverrides[transactionId] || {} } },
            `reconcileOverride:${transactionId}`,
            `Rekonsil ${transactionId}`
        );
    }

    function withHistoryTimestamp(records, timestampField = historyTimestampField, userField = historyUserField) {
        const values = Array.isArray(records) ? records : [records];
        const timestamp = new Date().toISOString();
        const rows = values.map(record => {
            const { user_email, changed_by, created_at, changed_at, ...historyRecord } = record;
            return {
                ...historyRecord,
                id: historyRecord.id || crypto.randomUUID(),
                [userField]: user_email || changed_by || window.SmartBaraCore.getUser()?.email || 'admin',
                [timestampField]: timestamp
            };
        });
        return Array.isArray(records) ? rows : rows[0];
    }

    function isMissingHistoryColumn(error) {
        return error?.code === '42703' || /column .* does not exist|could not find the .* column|schema cache/i.test(error?.message || '');
    }

    async function saveHistoryToCloud(client, records) {
        const candidates = [...new Set([
            `${historyTimestampField}:${historyUserField}`,
            'changed_at:changed_by',
            'created_at:user_email'
        ])];
        let lastError = null;

        for (const candidate of candidates) {
            const [timestampField, userField] = candidate.split(':');
            try {
                const formatted = withHistoryTimestamp(records, timestampField, userField);
                const rows = Array.isArray(formatted) ? formatted : [formatted];
                const queueKey = `reconcile-history:${rows.map(row => row.id).join(':')}`;
                await window.SmartBaraCore.syncCloudUpsert('smartbara_history', rows, 'id', queueKey, 'Riwayat Rekonsil');
                historyTimestampField = timestampField;
                historyUserField = userField;
                return;
            } catch (error) {
                lastError = error;
                if (!isMissingHistoryColumn(error) || error.queuedForSync) throw error;
            }
        }

        throw lastError || new Error('Tidak ada pasangan kolom timestamp riwayat yang didukung oleh tabel cloud.');
    }

    function setTransactionFilter(filter) {
        transactionFilter = filter;
        transactionLimit = 200;
        renderTransactions();
    }

    function loadMoreTransactions() {
        transactionLimit += 200;
        renderTransactions();
    }

    async function pullChangesFromPeriod() {
        if (!window.SmartBaraCore.canWriteData()) return setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
        const sourcePeriod = document.getElementById('rekonsilSourcePeriod')?.value;
        const targetPeriod = window.SmartBaraCore.getActivePeriod();
        if (!sourcePeriod) {
            await window.SmartBaraLayout.alertDialog({ title: 'Periode sumber tidak tersedia', message: 'Tidak ada periode sumber yang dapat ditarik.', confirmText: 'OK' });
            return;
        }
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi tarik perubahan',
            message: `Tarik koreksi dan catatan dari ${sourcePeriod} ke ${targetPeriod}? Hanya transaksi dengan ID yang cocok yang akan berubah.`,
            confirmText: 'Tarik',
            cancelText: 'Batal'
        });
        if (!confirmed) return;

        const client = window.SmartBaraCore.getClient();
        if (!client) {
            await window.SmartBaraLayout.alertDialog({ title: 'Koneksi database dibutuhkan', message: 'Tarik perubahan periode memerlukan koneksi database.', confirmText: 'OK' });
            return;
        }
        const loadingTask = window.SmartBaraLayout.beginLoading('Mencocokkan rekonsil', `Mencari transaksi dan catatan dari ${sourcePeriod}...`);
        let pullSucceeded = false;
        setStatus(`Mencocokkan transaksi ${sourcePeriod}...`);
        try {
            const [metaRes, overrideRes] = await Promise.all([
                client.from('smartbara_meta').select('*').eq('period_name', sourcePeriod),
                client.from('smartbara_settings').select('key, value').like('key', `${getCloudOverridePrefix(sourcePeriod)}%`)
            ]);
            if (metaRes.error) throw metaRes.error;
            if (overrideRes.error) throw overrideRes.error;
            const sourceOverrides = new Map((overrideRes.data || []).map(item => [
                String(item.value?.transaction_id || item.key.slice(getCloudOverridePrefix(sourcePeriod).length)),
                { department: item.value?.department || '', ...(item.value?.override || {}) }
            ]));
            const legacyById = new Map();
            if (!sourceOverrides.size) {
                const storeRes = await client.from('smartbara_store').select('*').eq('period_name', sourcePeriod);
                if (storeRes.error) throw storeRes.error;
                (storeRes.data || []).forEach(store => {
                    const dept = String(store.dept_name || store.department || 'UMUM').toUpperCase();
                    const rows = Array.isArray(store.row_data) ? store.row_data : Array.isArray(store.rows_data) ? store.rows_data : [];
                    withStableIds(rows, dept).forEach(row => legacyById.set(row.id, row));
                });
            }

            let matchedCount = 0;
            const carriedIds = new Set();
            Object.keys(deptData).forEach(dept => {
                const normalizedDept = dept.toUpperCase();
                deptData[dept] = withStableIds(deptData[dept] || [], normalizedDept).map(row => {
                    const sourceOverride = sourceOverrides.get(row.id);
                    const previous = legacyById.get(row.id);
                    if (!sourceOverride && !previous) return row;
                    matchedCount++;
                    const carried = { ...(sourceOverride || {}) };
                    delete carried.department;
                    ['adj_finance', 'adj_rekonsil', 'nama_akun_manual', 'proyek_manual', 'catatan_manual'].forEach(field => {
                        if (!previous || carried[field] !== undefined || previous[field] === undefined || previous[field] === '') return;
                        if (field.startsWith('adj_') ? Math.abs(toNumber(previous[field])) < 0.001 : !String(previous[field]).trim()) return;
                        carried[field] = previous[field];
                    });
                    if (!Object.keys(carried).length) return row;
                    carriedIds.add(row.id);
                    transactionOverrides[row.id] = { ...(transactionOverrides[row.id] || {}), ...carried };
                    return { ...row, ...transactionOverrides[row.id] };
                });
            });

            saveLocalOverrides(targetPeriod);
            transactionRowsCache = null;
            const carriedIdList = [...carriedIds];
            for (let index = 0; index < carriedIdList.length; index += 20) {
                await Promise.all(carriedIdList.slice(index, index + 20).map(id => saveOverrideToCloud(targetPeriod, id)));
            }

            const sourceMetaByDept = new Map((metaRes.data || []).map(meta => [String(meta.meta_key || '').toUpperCase(), meta]));
            let metaCount = 0;
            for (const dept of Object.keys(deptData)) {
                const sourceMeta = sourceMetaByDept.get(dept.toUpperCase());
                if (!sourceMeta) continue;
                metaData[dept] = { ...sourceMeta, period_name: targetPeriod, meta_key: dept };
                metaCount++;
                if (window.SmartBaraCore.canWriteCloud()) {
                    await window.SmartBaraCore.syncVersionedRow('smartbara_meta', targetPeriod,
                        { period_name: targetPeriod, meta_key: dept },
                        { adj_sistem: Number(sourceMeta.adj_sistem || 0), adj_bank: Number(sourceMeta.adj_bank || 0), catatan: sourceMeta.catatan || '' },
                        `meta:${dept}`, `Rekonsil ${dept}`);
                }
            }
            localStorage.setItem(`smartbara_meta_${targetPeriod}`, JSON.stringify(metaData));
            renderTable();
            renderTransactions();
            setStatus(`${matchedCount} transaksi cocok, ${carriedIds.size} koreksi transaksi dan ${metaCount} catatan departemen ditarik dari ${sourcePeriod}.`);
            pullSucceeded = true;
        } catch (error) {
            console.error('Pull reconciliation changes error:', error);
            setStatus(`Gagal menarik perubahan: ${error.message}`, true);
        } finally {
            window.SmartBaraLayout.endLoading(loadingTask, pullSucceeded);
        }
    }

    async function syncToCloudManual() {
        const period = window.SmartBaraCore.getActivePeriod();

        // Verifikasi kode akses
        const kode = prompt('Masukkan kode verifikasi sinkronisasi cloud:');
        if (kode !== 'HARIZALGANTENG') {
            setStatus('Kode verifikasi salah. Sinkronisasi dibatalkan.', true);
            return;
        }

        if (!window.SmartBaraCore.canWriteCloud()) {
            setStatus('Login dengan akun yang memiliki akses tulis ke cloud diperlukan.', true);
            return;
        }

        const client = window.SmartBaraCore.getClient();
        if (!client) {
            setStatus('Koneksi Supabase tidak tersedia.', true);
            return;
        }

        const loadingTask = window.SmartBaraLayout?.beginLoading('Sinkronisasi Seluruh Data ke Cloud', 'Mengupload semua data periode ' + period + '...');
        let success = false;
        let syncedCount = 0;
        const errors = [];

        try {
            // 1. Flush antrean pending cloud write yang masih menunggu
            await window.SmartBaraCore.flushPendingCloudWrites();

            // 2. Sinkronisasi data transaksi / department store (tabel smartbara_store)
            const depts = Object.keys(deptData || {});
            for (const dept of depts) {
                const rows = Array.isArray(deptData[dept]) ? deptData[dept] : [];
                if (!rows.length) continue;
                try {
                    await window.SmartBaraCore.saveDepartmentStore(period, dept, rows);
                    syncedCount += rows.length;
                } catch (err) {
                    errors.push(`Store ${dept}: ${err.message}`);
                }
            }

            // 3. Sinkronisasi override rekonsil per transaksi (tabel smartbara_settings)
            const overrides = readLocalOverrides(period);
            for (const [txId, override] of Object.entries(overrides || {})) {
                try {
                    await saveOverrideToCloud(period, txId, '');
                    syncedCount++;
                } catch (err) {
                    errors.push(`Override ${txId}: ${err.message}`);
                }
            }

            // 4. Sinkronisasi meta adjustment per departemen (tabel smartbara_meta)
            for (const [dept, meta] of Object.entries(metaData || {})) {
                const values = {
                    adj_sistem: Number(meta.adj_sistem || 0),
                    adj_bank: Number(meta.adj_bank || 0),
                    catatan: meta.catatan || ''
                };
                try {
                    await window.SmartBaraCore.syncVersionedRow('smartbara_meta', period, { period_name: period, meta_key: dept }, values, `meta:${dept}`, `Rekonsil ${dept}`);
                    syncedCount++;
                } catch (err) {
                    errors.push(`Meta ${dept}: ${err.message}`);
                }
            }

            // 5. Sinkronisasi budget akun (tabel smartbara_budget) dari cache localStorage
            try {
                syncedCount += await syncBudgetCacheToCloud(client, 'smartbara_budget', `smartbara_budget_v2_${period}`, period, 'Budget akun');
            } catch (err) {
                errors.push(`Budget: ${err.message}`);
            }

            // 6. Sinkronisasi budget proyek/site (tabel smartbara_budget_site) dari cache localStorage
            try {
                syncedCount += await syncBudgetCacheToCloud(client, 'smartbara_budget_site', `smartbara_budget_site_v2_${period}`, period, 'Budget proyek');
            } catch (err) {
                errors.push(`Budget Site: ${err.message}`);
            }

            // 7. Muat ulang data dari cloud untuk memastikan tampilan konsisten dengan yang baru diupload
            await window.SmartBaraCore.loadPeriodStore(period, true, { showOverlay: false });

            renderTable();
            renderTransactions();

            success = true;
            const msgErr = errors.length ? ` (${errors.length} gagal)` : '';
            setStatus(`Sinkronisasi selesai: ${syncedCount} item seluruh data periode ${period} terupload ke Supabase.${msgErr}`);
            window.SmartBaraCore.showSyncStatus(`Semua data periode ${period} tersinkronkan ke cloud (${syncedCount} item).${msgErr}`, errors.length ? 'error' : 'success');
            if (errors.length) console.error('Sinkronisasi sebagian gagal:', errors);
        } catch (err) {
            console.error('Manual sync error:', err);
            setStatus(`Gagal sinkronisasi: ${err.message}`, true);
            window.SmartBaraCore.showSyncStatus(`Gagal sinkronisasi ke cloud: ${err.message}`, 'error');
        } finally {
            window.SmartBaraLayout?.endLoading(loadingTask, success);
        }
    }

    // ============================================================================
    // BACKUP / RESTORE FILE MANAGEMENT (Unduh & Unggah seluruh data periode)
    // ============================================================================

    async function downloadBackupPeriod() {
        const period = window.SmartBaraCore.getActivePeriod();

        if (!window.SmartBaraCore.canWriteCloud()) {
            setStatus('Login dengan akun yang memiliki akses tulis ke cloud diperlukan.', true);
            return;
        }

        const client = window.SmartBaraCore.getClient();
        if (!client) {
            setStatus('Koneksi Supabase tidak tersedia.', true);
            return;
        }

        const loadingTask = window.SmartBaraLayout?.beginLoading('Unduh Backup', 'Mengumpulkan semua data periode ' + period + '...');
        let success = false;

        try {
            const backup = {
                exportedAt: new Date().toISOString(),
                exportedBy: window.SmartBaraCore.getUser()?.email || 'admin',
                period: period,
                app: 'Smart BARA 7.10 HZ',
                version: window.SMART_BARA_CONFIG?.APP_VERSION || '7.10 HZ',
                tables: {}
            };

            const tables = [
                'smartbara_store',
                'smartbara_meta',
                'smartbara_budget',
                'smartbara_budget_site',
                'smartbara_history'
            ];

            for (const tableName of tables) {
                try {
                    const { data, error } = await client
                        .from(tableName)
                        .select('*')
                        .eq('period_name', period);
                    if (error) throw error;
                    backup.tables[tableName] = Array.isArray(data) ? data : [];
                } catch (err) {
                    backup.tables[tableName] = [];
                    console.warn(`Backup table ${tableName} skipped:`, err.message);
                }
            }

            // Ambil juga settings yang terkait periode ini (rekonsil overrides, dll.)
            try {
                const { data, error } = await client
                    .from('smartbara_settings')
                    .select('*')
                    .like('key', `%${period}%`);
                if (!error && Array.isArray(data)) backup.tables.smartbara_settings = data;
            } catch (err) {
                console.warn('Backup settings skipped:', err.message);
            }

            const jsonBlob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(jsonBlob);
            const a = document.createElement('a');
            const safePeriod = String(period).replace(/[^a-z0-9\-_]/gi, '_');
            a.href = url;
            a.download = `SmartBARA_Backup_${safePeriod}_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            success = true;
            setStatus(`Backup periode ${period} berhasil diunduh.`);
            window.SmartBaraCore.showSyncStatus(`Backup file ${a.download} telah diunduh.`, 'success');
        } catch (err) {
            console.error('Download backup error:', err);
            setStatus(`Gagal unduh backup: ${err.message}`, true);
            window.SmartBaraCore.showSyncStatus(`Gagal unduh backup: ${err.message}`, 'error');
        } finally {
            window.SmartBaraLayout?.endLoading(loadingTask, success);
        }
    }

    async function uploadBackupPeriod(fileInput) {
        const period = window.SmartBaraCore.getActivePeriod();

        // Verifikasi kode akses
        const kode = prompt('Masukkan kode verifikasi unggah backup:');
        if (kode !== 'HARIZALGANTENG') {
            setStatus('Kode verifikasi salah. Unggah backup dibatalkan.', true);
            if (fileInput) fileInput.value = '';
            return;
        }

        // Pemulihan mengganti isi periode, jadi juga butuh izin hapus (level Tim hanya bisa menulis).
        if (!window.SmartBaraCore.canWriteCloud() || !window.SmartBaraCore.canDeleteData()) {
            setStatus('Pemulihan backup membutuhkan akun dengan akses hapus (Superadmin atau SPV).', true);
            if (fileInput) fileInput.value = '';
            return;
        }

        const client = window.SmartBaraCore.getClient();
        if (!client) {
            setStatus('Koneksi Supabase tidak tersedia.', true);
            if (fileInput) fileInput.value = '';
            return;
        }

        const file = fileInput?.files?.[0];
        if (!file) return;

        const loadingTask = window.SmartBaraLayout?.beginLoading('Pulihkan Backup', 'Membaca dan mengunggah file backup...');
        let success = false;

        try {
            const text = await file.text();
            const backup = JSON.parse(text);

            if (!backup || !backup.tables || typeof backup.tables !== 'object') {
                throw new Error('File backup tidak valid (struktur tabel tidak ditemukan).');
            }

            // Konfirmasi periode cocok (peringatan saja, tidak mencegah)
            const backupPeriod = backup.period || '';
            if (backupPeriod && backupPeriod !== period) {
                const konfirmasi = confirm(`File backup adalah untuk periode "${backupPeriod}", sementara periode aktif sekarang adalah "${period}". Lanjutkan memulihkan ke periode aktif?`);
                if (!konfirmasi) {
                    setStatus('Pemulihan dibatalkan oleh pengguna.', true);
                    if (fileInput) fileInput.value = '';
                    return;
                }
            }

            let restoredCount = 0;
            const errors = [];

            const deleteRows = async (tableName, column, values) => {
                for (let offset = 0; offset < values.length; offset += 200) {
                    const { error } = await client.from(tableName).delete().in(column, values.slice(offset, offset + 200));
                    if (error) throw error;
                }
            };

            // Data backup ditulis dulu, baru baris lama yang tidak terpakai dihapus,
            // sehingga kegagalan di tengah jalan tidak menghilangkan data periode ini.
            const restoreTable = async (tableName, rows, conflictColumns = '') => {
                if (!Array.isArray(rows) || !rows.length) return 0;
                const { data: oldRows, error: oldRowsError } = await client.from(tableName).select('id').eq('period_name', period);
                if (oldRowsError) throw oldRowsError;

                const writtenIds = new Set();
                for (let offset = 0; offset < rows.length; offset += 200) {
                    const batch = rows.slice(offset, offset + 200).map(row => {
                        const clean = { ...row, period_name: period };
                        delete clean.id; // biarkan Supabase generate ulang
                        return clean;
                    });
                    const write = conflictColumns
                        ? client.from(tableName).upsert(batch, { onConflict: conflictColumns })
                        : client.from(tableName).insert(batch);
                    const { data, error } = await write.select('id');
                    if (error) {
                        // Tabel tanpa kunci unik: buang batch yang sudah masuk agar tidak dobel dengan data lama.
                        if (!conflictColumns) await deleteRows(tableName, 'id', [...writtenIds]);
                        throw error;
                    }
                    (data || []).forEach(row => writtenIds.add(row.id));
                }
                await deleteRows(tableName, 'id', (oldRows || []).map(row => row.id).filter(id => !writtenIds.has(id)));
                return writtenIds.size;
            };

            // 1. smartbara_store
            restoredCount += await restoreTable('smartbara_store', backup.tables.smartbara_store, 'period_name,dept_name');

            // 2. smartbara_meta
            restoredCount += await restoreTable('smartbara_meta', backup.tables.smartbara_meta, 'period_name,meta_key');

            // 3. smartbara_budget
            restoredCount += await restoreTable('smartbara_budget', backup.tables.smartbara_budget);

            // 4. smartbara_budget_site
            restoredCount += await restoreTable('smartbara_budget_site', backup.tables.smartbara_site || backup.tables.smartbara_budget_site);

            // 5. smartbara_settings (rekonsil overrides) - key memuat nama periode
            if (Array.isArray(backup.tables.smartbara_settings) && backup.tables.smartbara_settings.length) {
                const sourcePeriod = backupPeriod || period;
                const { data: oldSettings, error: oldSettingsError } = await client.from('smartbara_settings').select('key').like('key', `%${period}%`);
                if (oldSettingsError) throw oldSettingsError;

                const writtenKeys = new Set();
                for (let offset = 0; offset < backup.tables.smartbara_settings.length; offset += 200) {
                    const batch = backup.tables.smartbara_settings.slice(offset, offset + 200).map(row => {
                        const clean = {
                            ...row,
                            key: row.key.replace(sourcePeriod, period),
                            value: window.SmartBaraCore.rewritePeriodInValue(row.value, sourcePeriod, period)
                        };
                        delete clean.id;
                        return clean;
                    });
                    const { error } = await client.from('smartbara_settings').upsert(batch, { onConflict: 'key' });
                    if (error) throw error;
                    batch.forEach(row => writtenKeys.add(row.key));
                }
                await deleteRows('smartbara_settings', 'key', (oldSettings || []).map(row => row.key).filter(key => !writtenKeys.has(key)));
                restoredCount += writtenKeys.size;
            }

            // 6. smartbara_history (audit, opsional) - tambah saja, tidak hapus
            if (Array.isArray(backup.tables.smartbara_history) && backup.tables.smartbara_history.length) {
                let count = 0;
                for (let offset = 0; offset < backup.tables.smartbara_history.length; offset += 200) {
                    const batch = backup.tables.smartbara_history.slice(offset, offset + 200).map(row => {
                        const clean = { ...row };
                        delete clean.id;
                        return clean;
                    });
                    const { error } = await client.from('smartbara_history').insert(batch);
                    if (error) throw error;
                    count += batch.length;
                }
                restoredCount += count;
            }

            // Muat ulang data periode dari cloud
            await window.SmartBaraCore.loadPeriodStore(period, true, { showOverlay: false });

            if (typeof renderTable === 'function') renderTable();
            if (typeof renderTransactions === 'function') renderTransactions();

            success = true;
            setStatus(`Pemulihan backup selesai: ${restoredCount} baris data dipulihkan ke periode ${period}.`);
            window.SmartBaraCore.showSyncStatus(`Backup pulih ${restoredCount} baris ke Supabase.`, 'success');
            if (fileInput) fileInput.value = '';
        } catch (err) {
            console.error('Upload backup error:', err);
            setStatus(`Gagal pemulihan backup: ${err.message}`, true);
            window.SmartBaraCore.showSyncStatus(`Gagal pemulihan backup: ${err.message}`, 'error');
            if (fileInput) fileInput.value = '';
        } finally {
            window.SmartBaraLayout?.endLoading(loadingTask, success);
        }
    }

    function renderTable() {
        const tbody = document.getElementById('rekonsilTableBody');
        const selectedDepts = window.SmartBaraCore.getSelectedDepartments();
        const fallbackDepts = window.SmartBaraCore.isCombinedDepartments()
            ? ['HR', 'GA', 'IT', 'FINANCE', 'LOGISTIK', 'OPERASIONAL', 'PRODUKSI', 'SHE']
            : selectedDepts;
        const depts = Object.keys(deptData).length ? Object.keys(deptData).sort() : fallbackDepts;

        const rowsHtml = depts.map(dept => {
            const rows = deptData[dept] || [];
            const meta = metaData[dept] || {};
            const adjSistem = Number(meta.adj_sistem || 0);
            const adjReconcile = Number(meta.adj_bank || 0);
            const catatan = meta.catatan || '';
            const financeRaw = rows.reduce((sum, row) => sum + getFinanceValue(row, false), 0);
            const reconcileRaw = rows.reduce((sum, row) => sum + getReconcileValue(row), 0);
            const financeTotal = financeRaw + adjSistem;
            const reconcileTotal = reconcileRaw + adjReconcile;
            const selisih = financeTotal - reconcileTotal;

            const statusBadge = Math.abs(selisih) === 0 ? 'badge-emerald' : 'badge-rose';
            const statusText = Math.abs(selisih) === 0 ? 'Match' : 'Selisih';

            return `
                <tr class="hover:bg-white/[0.03]">
                    <td class="font-extrabold text-white">${window.Formatters.escapeHtml(dept)}</td>
                    <td class="text-right text-slate-300 font-semibold">${window.Formatters.formatRupiah(financeRaw)}</td>
                    <td class="text-right">
                        <input type="number" step="1000" value="${adjSistem}" onchange="RekonsilModule.updateAdjustment('${dept}', 'adj_sistem', this.value)" class="form-input text-right w-32 py-1 text-xs text-teal-300 font-bold bg-slate-900/80">
                    </td>
                    <td class="text-right font-extrabold text-white">${window.Formatters.formatRupiah(financeTotal)}</td>
                    <td class="text-right font-semibold text-emerald-300">${window.Formatters.formatRupiah(reconcileRaw)}</td>
                    <td class="text-right">
                        <input type="number" step="1000" value="${adjReconcile}" onchange="RekonsilModule.updateAdjustment('${dept}', 'adj_bank', this.value)" class="form-input text-right w-32 py-1 text-xs text-emerald-300 font-bold bg-slate-900/80">
                    </td>
                    <td class="text-right font-black ${Math.abs(selisih) > 0 ? 'text-rose-400' : 'text-emerald-400'}">
                        ${window.Formatters.formatRupiah(selisih)}
                    </td>
                    <td class="text-center"><span class="badge ${statusBadge}">${statusText}</span></td>
                    <td>
                        <input type="text" value="${window.Formatters.escapeHtml(catatan)}" onchange="RekonsilModule.updateAdjustment('${dept}', 'catatan', this.value)" placeholder="Catatan selisih..." class="form-input w-full py-1 text-xs">
                    </td>
                </tr>
            `;
        }).join('');

        if (tbody) tbody.innerHTML = rowsHtml;
    }

    async function updateAdjustment(dept, field, value) {
        if (!window.SmartBaraCore.canWriteData()) return setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
        const period = window.SmartBaraCore.getActivePeriod();
        if (!metaData[dept]) {
            metaData[dept] = { period_name: period, meta_key: dept, adj_sistem: 0, adj_bank: 0, catatan: '' };
        }

        const oldVal = metaData[dept][field];
        metaData[dept][field] = field === 'catatan' ? String(value || '').trim() : Number(value || 0);
        localStorage.setItem(`smartbara_meta_${period}`, JSON.stringify(metaData));

        transactionRowsCache = null;
        renderTable();
        renderTransactions();

        if (window.SmartBaraCore.canWriteCloud()) {
            try {
                const values = {
                    adj_sistem: metaData[dept].adj_sistem,
                    adj_bank: metaData[dept].adj_bank,
                    catatan: metaData[dept].catatan
                };
                await window.SmartBaraCore.syncVersionedRow('smartbara_meta', period, { period_name: period, meta_key: dept }, values, `meta:${dept}`, `Rekonsil ${dept}`);
                window.SmartBaraCore.showSyncStatus(`Penyesuaian ${dept} tersimpan ke cloud`, 'success');

                // Log audit history
                const client = window.SmartBaraCore.getClient();
                if (client) {
                    const historyEntry = withHistoryTimestamp({
                        period_name: period,
                        action: 'UPDATE_REKONSIL',
                        table_name: 'smartbara_meta',
                        record_id: dept,
                        old_value: { [field]: oldVal },
                        new_value: { [field]: metaData[dept][field] },
                        user_email: window.SmartBaraCore.getUser()?.email || 'admin'
                    });
                    await saveHistoryToCloud(client, historyEntry);
                    historyLogs.unshift(historyEntry);
                    renderHistory();
                }
            } catch(err) {
                console.error('Update rekonsil error:', err);
                window.SmartBaraCore.showSyncStatus(`Gagal simpan: ${err.message}`, 'error');
            }
        }
    }

    function parseHistoryValue(value) {
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch(e) {
            return value;
        }
    }

    function getHistoryTransactionRow(log) {
        const recordId = String(log?.record_id || '');
        const separator = recordId.indexOf(':');
        if (separator <= 0) return null;
        const department = recordId.slice(0, separator).toUpperCase();
        const transactionId = recordId.slice(separator + 1);
        return (deptData[department] || []).find(item => String(item.id || '') === transactionId) || null;
    }

    function getHistoryDetail(log, transactionRow = getHistoryTransactionRow(log)) {
        const oldValue = parseHistoryValue(log.old_value);
        const newValue = parseHistoryValue(log.new_value);
        if (!newValue || typeof newValue !== 'object' || Array.isArray(newValue)) return '';
        const fieldLabels = {
            adj_finance: 'Penyesuaian Finance',
            adj_rekonsil: 'Penyesuaian Rekonsil',
            nama_akun_manual: 'Akun Manual',
            proyek_manual: 'Proyek Manual',
            catatan_manual: 'Catatan Manual',
            adj_sistem: 'Penyesuaian Sistem',
            adj_bank: 'Penyesuaian Bank',
            catatan: 'Catatan Departemen'
        };
        const formatValue = (value, field) => {
            if (value === undefined || value === null || String(value).trim() === '') return '(kosong)';
            if (field.startsWith('adj_')) return window.Formatters.formatRupiah(parseNumber(value));
            return String(value);
        };
        return Object.keys(newValue).map(field => {
            const label = fieldLabels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
            let previousValue = oldValue?.[field];
            if ((field === 'proyek_manual' || field === 'nama_akun_manual') && String(previousValue ?? '').trim() === '') {
                const sourceFields = field === 'proyek_manual'
                    ? ['_calcProyek', '_proyekOverride', 'nama proyek up', 'nama proyek', 'proyek', 'project']
                    : ['_calcAkun', '_akunOverride', 'nama akun up', 'nama akun induk', 'nama akun', 'nama_akun', 'akun'];
                previousValue = getTransactionField(transactionRow, sourceFields) ?? previousValue;
            }
            const oldText = formatValue(previousValue, field);
            const newText = formatValue(newValue[field], field);
            return `${label}: ${oldText} → ${newText}`;
        }).join(' | ');
    }

    function getHistoryTransactionDetail(log, row = getHistoryTransactionRow(log)) {
        const recordId = String(log?.record_id || '');
        const separator = recordId.indexOf(':');
        if (separator <= 0) return '';
        const department = recordId.slice(0, separator).toUpperCase();
        const transactionId = recordId.slice(separator + 1);
        if (!row) return `ID transaksi: ${transactionId}`;

        const date = window.SmartBaraFormatters.normalizeDate(getTransactionField(row, ['tanggal', 'tgl', 'date'])) || '';
        const source = String(getTransactionField(row, ['no sumber', 'no_sumber', 'no bukti', 'referensi']) || '').trim();
        const account = String(getTransactionField(row, ['nama_akun_manual', 'nama akun up', 'nama akun induk', 'nama akun', 'nama_akun', 'akun']) || '').trim();
        const project = String(getTransactionField(row, ['proyek_manual', 'nama proyek up', 'nama proyek', 'proyek']) || '').trim();
        const description = String(getTransactionField(row, ['keterangan', 'deskripsi', 'uraian', 'rincian']) || '').trim();
        const details = [
            date && `Tanggal ${date}`,
            source && `No. sumber ${source}`,
            account && `Akun ${account}`,
            project && `Proyek ${project}`,
            description && `Keterangan ${description}`
        ].filter(Boolean);
        return details.length ? details.join(' · ') : `ID transaksi: ${transactionId}`;
    }

    function getHistoryRestoreTarget(log) {
        const action = String(log?.action || '').toUpperCase();
        const tableName = String(log?.table_name || '').toLowerCase();
        const oldValues = parseHistoryValue(log?.old_value);
        const newValues = parseHistoryValue(log?.new_value);
        if (!oldValues || typeof oldValues !== 'object' || Array.isArray(oldValues) || !newValues || typeof newValues !== 'object' || Array.isArray(newValues)) return null;

        const transactionFields = ['adj_finance', 'adj_rekonsil', 'nama_akun_manual', 'proyek_manual', 'catatan_manual'];
        const metaFields = ['adj_sistem', 'adj_bank', 'catatan'];
        if (action.includes('REKONSIL_TRANSACTION') || action.includes('IMPORT_REKONSIL_CHANGE')) {
            const separator = String(log.record_id || '').indexOf(':');
            if (separator <= 0) return null;
            const department = String(log.record_id).slice(0, separator).toUpperCase();
            const transactionId = String(log.record_id).slice(separator + 1);
            const fields = Object.keys(newValues).filter(field => transactionFields.includes(field) && getHistoryLogDept(log) === department);
            return fields.length ? { type: 'transaction', department, transactionId, fields, oldValues, newValues } : null;
        }
        if (action.includes('UPDATE_REKONSIL') && tableName.includes('meta')) {
            const department = String(log.record_id || '').trim().toUpperCase();
            const fields = Object.keys(newValues).filter(field => metaFields.includes(field) && getHistoryLogDept(log) === department);
            return fields.length ? { type: 'meta', department, fields, oldValues, newValues } : null;
        }
        return null;
    }

    function historyValuesMatch(current, expected, field) {
        if (field.startsWith('adj_')) return Math.abs(toNumber(current) - toNumber(expected)) < 0.001;
        return String(current ?? '') === String(expected ?? '');
    }

    async function restoreHistoryChange(historyIndex) {
        if (!window.SmartBaraCore.canWriteData()) return setStatus('Level akses Viewer hanya dapat membaca rekonsiliasi.', true);
        const log = historyLogs[Number(historyIndex)];
        const target = getHistoryRestoreTarget(log);
        if (!target) return setStatus('Riwayat ini tidak memiliki perubahan rekonsil yang dapat dipulihkan.', true);
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Kembalikan riwayat',
            message: 'Kembalikan nilai sebelum perubahan ini? Pemulihan hanya berlaku untuk item riwayat yang dipilih.',
            confirmText: 'Pulihkan',
            cancelText: 'Batal'
        });
        if (!confirmed) return;

        const period = window.SmartBaraCore.getActivePeriod();
        let currentValues = {};
        let restoredValues = {};
        let transactionRow = null;

        if (target.type === 'transaction') {
            transactionRow = (deptData[target.department] || []).find(row => row.id === target.transactionId);
            if (!transactionRow) return setStatus('Transaksi riwayat tidak ditemukan pada data periode aktif.', true);
            target.fields.forEach((field) => {
                const currentValue = transactionRow[field] ?? (field.startsWith('adj_') ? 0 : '');
                const expectedValue = target.newValues[field];
                currentValues[field] = expectedValue;
                const match = historyValuesMatch(currentValue, expectedValue, field);
                if (!match) return;
                const previousValue = Object.prototype.hasOwnProperty.call(target.oldValues, field)
                    ? target.oldValues[field]
                    : (field.startsWith('adj_') ? 0 : '');
                restoredValues[field] = previousValue;
            });
        } else {
            const meta = metaData[target.department] || {};
            target.fields.forEach((field) => {
                const currentValue = meta[field] ?? (field.startsWith('adj_') ? 0 : '');
                const expectedValue = target.newValues[field];
                currentValues[field] = expectedValue;
                if (!historyValuesMatch(currentValue, expectedValue, field)) return;
                restoredValues[field] = Object.prototype.hasOwnProperty.call(target.oldValues, field)
                    ? target.oldValues[field]
                    : (field.startsWith('adj_') ? 0 : '');
            });
        }

        if (Object.keys(restoredValues).length !== target.fields.length) {
            return setStatus('Pemulihan dibatalkan: nilai transaksi sudah berubah setelah riwayat ini dibuat.', true);
        }

        const auditEntry = withHistoryTimestamp({
            period_name: period,
            action: target.type === 'meta' ? 'UPDATE_REKONSIL' : 'UPDATE_REKONSIL_TRANSACTION',
            table_name: target.type === 'meta' ? 'smartbara_meta' : 'smartbara_settings',
            record_id: target.type === 'meta' ? target.department : `${target.department}:${target.transactionId}`,
            old_value: currentValues,
            new_value: restoredValues,
            user_email: window.SmartBaraCore.getUser()?.email || 'admin'
        });
        let syncError = null;

        if (target.type === 'transaction') {
            const nextOverride = { ...(transactionOverrides[target.transactionId] || {}) };
            target.fields.forEach((field) => {
                const value = restoredValues[field];
                const isDefault = field.startsWith('adj_')
                    ? Math.abs(toNumber(value)) < 0.001
                    : !String(value ?? '').trim();
                if (isDefault) {
                    delete nextOverride[field];
                    delete transactionRow[field];
                } else {
                    nextOverride[field] = value;
                    transactionRow[field] = value;
                }
            });
            if (Object.keys(nextOverride).length) transactionOverrides[target.transactionId] = nextOverride;
            else delete transactionOverrides[target.transactionId];
            transactionRowsCache = null;
            saveLocalOverrides(period);
            try {
                await saveOverrideToCloud(period, target.transactionId, target.department);
            } catch (error) {
                syncError = error;
            }
        } else {
            metaData[target.department] = { ...metaData[target.department], period_name: period, meta_key: target.department };
            target.fields.forEach(field => { metaData[target.department][field] = restoredValues[field]; });
            localStorage.setItem(`smartbara_meta_${period}`, JSON.stringify(metaData));
            transactionRowsCache = null;
            try {
                const values = {
                    adj_sistem: Number(metaData[target.department].adj_sistem || 0),
                    adj_bank: Number(metaData[target.department].adj_bank || 0),
                    catatan: metaData[target.department].catatan || ''
                };
                await window.SmartBaraCore.syncVersionedRow('smartbara_meta', period, { period_name: period, meta_key: target.department }, values, `meta:${target.department}`, `Rekonsil ${target.department}`);
            } catch (error) {
                syncError = error;
            }
        }

        const client = window.SmartBaraCore.getClient();
        if (client && window.SmartBaraCore.canWriteCloud()) {
            try {
                await saveHistoryToCloud(client, auditEntry);
            } catch (error) {
                syncError = syncError || error;
            }
        }
        historyLogs.unshift(auditEntry);
        renderTable();
        renderTransactions();
        renderHistory();
        setStatus(syncError ? `Data dipulihkan lokal; sinkronisasi gagal: ${syncError.message}` : 'Data rekonsil berhasil dikembalikan dari riwayat.');
    }

    function loadMoreHistory() {
        historyDisplayLimit += 100;
        renderHistory();
    }

    function renderHistory() {
        const container = document.getElementById('rekonsilHistoryList');
        if (!container) return;
        const count = document.getElementById('rekonsilHistoryCount');
        const loadMore = document.getElementById('rekonsilHistoryLoadMore');
        populateHistoryFilters();
        const filteredLogs = historyLogs.filter(log => {
            const typeMatch = historyFilterType === 'all' || getHistoryLabel(log) === historyFilterType;
            const deptMatch = historyFilterDept === 'all' || getHistoryLogDept(log) === historyFilterDept;
            return typeMatch && deptMatch;
        });
        if (count) count.textContent = `${filteredLogs.length.toLocaleString('id-ID')} riwayat`;
        if (loadMore) {
            loadMore.classList.toggle('hidden', filteredLogs.length <= historyDisplayLimit);
            loadMore.textContent = `Muat ${Math.min(100, filteredLogs.length - historyDisplayLimit).toLocaleString('id-ID')} riwayat berikutnya`;
        }

        if (!filteredLogs.length) {
            const activeDept = historyFilterDept === 'all' ? (window.SmartBaraCore.getSelectedDepartments().join(', ') || 'semua departemen') : historyFilterDept;
            container.innerHTML = `<div class="rounded-lg border border-dashed border-white/10 bg-slate-900/40 p-3 text-xs text-slate-400 text-center">
                Belum ada audit cloud yang tersimpan untuk ${window.Formatters.escapeHtml(activeDept)} pada periode ini.<br>
                Koreksi aktif tetap tersimpan terpisah; perubahan baru akan tercatat di sini setelah disimpan.
            </div>`;
            return;
        }

        container.innerHTML = filteredLogs.slice(0, historyDisplayLimit).map(log => {
            const timestamp = log.created_at || log.changed_at;
            const parsedTime = timestamp ? new Date(timestamp) : null;
            const timeStr = parsedTime && !Number.isNaN(parsedTime.getTime())
                ? parsedTime.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                : '-';
            const transactionRow = getHistoryTransactionRow(log);
            const detail = getHistoryDetail(log, transactionRow);
            const transactionDetail = getHistoryTransactionDetail(log, transactionRow);
            const deptLabel = getHistoryLogDept(log) || 'GA';
            const displayRecordId = deptLabel === 'GA' ? 'GA' : (log.record_id || '').split(':')[0] || 'ALL';
            const logIndex = historyLogs.indexOf(log);
            const canRestore = Boolean(getHistoryRestoreTarget(log)) && window.SmartBaraCore.canWriteData();
            return `
                <div class="p-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs">
                    <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                        <span class="font-bold text-teal-300">[${window.Formatters.escapeHtml(displayRecordId)}]</span>
                        <span class="text-slate-300 ml-1">${window.Formatters.escapeHtml(getHistoryLabel(log))}</span>
                        <span class="text-slate-500 text-[10px] block">Oleh: ${window.Formatters.escapeHtml(log.user_email || log.changed_by || 'User')}</span>
                        </div>
                        <span class="shrink-0 text-[10px] text-slate-400 font-mono">${timeStr}</span>
                    </div>
                    ${transactionDetail ? `<span class="mt-1 block break-words text-[10px] leading-4 text-slate-300">Data: ${window.Formatters.escapeHtml(transactionDetail)}</span>` : ''}
                    ${detail ? `<span class="mt-1 block break-words text-[10px] text-slate-400">${window.Formatters.escapeHtml(detail)}</span>` : ''}
                    <div class="mt-2 flex justify-end">
                        <button type="button" class="btn btn-secondary px-2 py-1 text-[10px]" ${canRestore ? `onclick="RekonsilModule.restoreHistoryChange(${logIndex})" title="Kembalikan nilai sebelum perubahan ini"` : 'disabled title="Perubahan ini tidak dapat dipulihkan dari layar ini"'}>Kembalikan</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function setStatus(msg, isError = false) {
        const el = document.getElementById('rekonsilStatusText');
        if (el) {
            el.textContent = msg;
            el.className = `text-xs font-semibold ${isError ? 'text-rose-400' : 'text-slate-400'}`;
        } else {
            // Fallback untuk halaman lain (misal dashboard) yang tidak punya elemen #rekonsilStatusText
            if (isError) {
                console.error(msg);
                alert(msg);
            } else {
                console.log(msg);
            }
        }
    }

    return { init, updateAdjustment, renderTransactions, scheduleTransactionSearch, setTransactionFilter, setTransactionMonthFilter, setHistoryFilter, toggleFullTableView, restoreHistoryChange, loadMoreTransactions, loadMoreHistory, updateTransactionReconcile, updateTransactionNote, updateTransactionText, exportToExcel, importChanges, pullChangesFromPeriod, syncToCloudManual, downloadBackupPeriod, uploadBackupPeriod };
})();

// ==============================================================================
// SMART BARA 7.10 HZ - LAPORAN & POV REPORTING MODULE
// ==============================================================================

window.LaporanModule = (function() {
    let deptData = {};
    let viewMode = 'akun'; // 'akun', 'proyek', or 'matriks'
    let accountBudgets = [];
    let projectBudgets = [];
    let reportGroups = new Map();
    let visibleReportGroups = [];
    let activeDetailGroup = null;
    let activeDetailTransactions = [];
    let activeTransactionIndex = -1;

    async function init(mode = 'akun') {
        viewMode = mode;
        window.addEventListener('smartbara:period_change', () => loadData());
        window.addEventListener('smartbara:dept_filter_change', () => loadData(true));
        window.SmartBaraCore.onRealtimeChange(payload => {
            if (payload.table === 'smartbara_store') loadData(true);
        });
        await loadData();
    }

    async function loadData(silent = false) {
        const period = window.SmartBaraCore.getActivePeriod();
        const client = window.SmartBaraCore.getClient();

        if (!silent) setStatus('Memuat data laporan...');
        accountBudgets = readBudgetCache(`smartbara_budget_v2_${period}`);
        projectBudgets = readBudgetCache(`smartbara_budget_site_v2_${period}`);
        renderFromCoreCache();

        if (!client) {
            setStatus('Laporan dimuat dari cache lokal.');
            return;
        }

        try {
            const [storeRes, accountBudgetRes, projectBudgetRes] = await Promise.all([
                client.from('smartbara_store').select('*').eq('period_name', period),
                window.SmartBaraCore.fetchPeriodRows('smartbara_budget', period),
                window.SmartBaraCore.fetchPeriodRows('smartbara_budget_site', period)
            ]);
            if (storeRes.error) throw storeRes.error;
            const allDeptData = {};
            (storeRes.data || []).forEach(item => {
                const deptName = item.dept_name || item.department || 'UMUM';
                const rows = Array.isArray(item.row_data)
                    ? item.row_data
                    : Array.isArray(item.rows_data)
                        ? item.rows_data
                        : Array.isArray(item.dept_data)
                            ? item.dept_data
                            : [];
                allDeptData[deptName] = rows.filter(transaction => isTransactionInActivePeriod(transaction, period));
            });
            const selectedDepartments = new Set(window.SmartBaraCore.getSelectedDepartments());
            const normalizedSelection = new Set([...selectedDepartments].map(dept => String(dept).toUpperCase()));
            // Mode Gabungan memakai hasil cloud apa adanya; daftar dept di core bisa berasal dari cache lama.
            deptData = window.SmartBaraCore.isCombinedDepartments()
                ? allDeptData
                : Object.fromEntries(Object.entries(allDeptData).filter(([dept]) => normalizedSelection.has(String(dept).toUpperCase())));
            if (!accountBudgetRes.error && Array.isArray(accountBudgetRes.data) && (accountBudgetRes.data.length || !accountBudgets.length)) accountBudgets = accountBudgetRes.data;
            if (!projectBudgetRes.error && Array.isArray(projectBudgetRes.data) && (projectBudgetRes.data.length || !projectBudgets.length)) projectBudgets = projectBudgetRes.data;
            localStorage.setItem(`smartbara_budget_v2_${period}`, JSON.stringify(accountBudgets));
            localStorage.setItem(`smartbara_budget_site_v2_${period}`, JSON.stringify(projectBudgets));

            if (viewMode === 'matriks') renderMatriks();
            else renderHierarchical();

            setStatus('Laporan berhasil dimuat.');
        } catch(err) {
            console.warn('Load report error:', err);
            renderFromCoreCache();
            setStatus('Laporan dimuat dari cache lokal.');
        }
    }

    function readBudgetCache(key) {
        try {
            const cached = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(cached) ? cached : [];
        } catch(e) {
            return [];
        }
    }

    function renderFromCoreCache() {
        const cachedDeptData = {};
        window.SmartBaraCore.getAllTransactions().forEach(transaction => {
            if (!isTransactionInActivePeriod(transaction, window.SmartBaraCore.getActivePeriod())) return;
            const dept = String(transaction.dept || transaction._department || 'UMUM').toUpperCase();
            if (!cachedDeptData[dept]) cachedDeptData[dept] = [];
            cachedDeptData[dept].push(transaction);
        });
        deptData = cachedDeptData;
        if (viewMode === 'matriks') renderMatriks();
        else renderHierarchical();
    }

    function normalizeName(value) {
        return String(value || '').trim().toLowerCase();
    }

    function isTransactionInActivePeriod(transaction, period) {
        const periodYear = Number(String(period || '').match(/\d{4}/)?.[0]);
        const normalizedDate = window.SmartBaraFormatters.normalizeDate(transactionDate(transaction));
        const transactionYear = normalizedDate ? Number(normalizedDate.slice(0, 4)) : 0;
        return !periodYear || !transactionYear || transactionYear === periodYear;
    }

    function getTransactionField(transaction, names) {
        const entries = Object.entries(transaction || {});
        for (const name of names) {
            const normalizedName = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
            const entry = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName);
            if (entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '') return entry[1];
        }
        return undefined;
    }

    function transactionNumber(transaction, names) {
        const value = getTransactionField(transaction, names);
        return value === undefined ? 0 : window.Formatters.parseNumber(value, 0);
    }

    function transactionAccount(transaction) {
        return String(getTransactionField(transaction, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'nama akun up', 'nama akun induk', 'nama akun', 'akun']) || 'Lain-lain').trim();
    }

    function transactionProject(transaction) {
        return String(getTransactionField(transaction, ['proyek_manual', '_calcProyek', '_proyekOverride', 'nama proyek up', 'nama proyek', 'proyek']) || 'Kantor Pusat').trim();
    }

    function transactionId(transaction) {
        return String(transaction.id || transaction._uid || transaction.transaction_id || '').trim();
    }

    function transactionReference(transaction) {
        return String(getTransactionField(transaction, ['no_sumber', 'no sumber', 'sumber', 'voucher', 'referensi']) || '').trim();
    }

    function transactionDate(transaction) {
        return String(getTransactionField(transaction, ['tanggal', 'date']) || '').trim();
    }

    function transactionNote(transaction) {
        return String(getTransactionField(transaction, ['catatan', 'note', 'keterangan', 'deskripsi']) || '').trim();
    }

    function transactionActual(transaction) {
        const debitValue = getTransactionField(transaction, ['debit', 'debet']);
        const creditValue = getTransactionField(transaction, ['kredit', 'credit']);
        const hasDebitCredit = debitValue !== undefined || creditValue !== undefined;
        if (hasDebitCredit) {
            return transactionNumber(transaction, ['debit', 'debet']) - transactionNumber(transaction, ['kredit', 'credit']);
        }
        const nominalValue = getTransactionField(transaction, ['nominal']);
        const nominal = nominalValue === undefined ? NaN : window.Formatters.parseNumber(nominalValue, NaN);
        if (Number.isFinite(nominal)) return nominal;
        return transactionNumber(transaction, ['finance']) + transactionNumber(transaction, ['adj_finance']);
    }

    function transactionReconcile(transaction) {
        const reconcileValue = getTransactionField(transaction, ['rekonsil', 'nilai rekonsil', 'nilai rekonsiliasi', 'reconcile']);
        const reconcile = reconcileValue === undefined
            ? transactionNumber(transaction, ['finance']) || transactionActual(transaction)
            : transactionNumber(transaction, ['rekonsil', 'nilai rekonsil', 'nilai rekonsiliasi', 'reconcile']);
        return reconcile + transactionNumber(transaction, ['adj_rekonsil']);
    }

    function budgetName(row) {
        return String(row.nama || row.nama_akun || row.nama_proyek || row.account_name || row.project_name || '').trim();
    }

    function budgetDepartment(row) {
        return String(row.dept || row.departemen || row.department || 'UMUM').trim().toUpperCase();
    }

    function annualBudget(row) {
        if (Array.isArray(row.budget)) return row.budget.reduce((sum, value) => sum + (Number(value) || 0), 0);
        const monthKeys = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'].map(month => `budget_${month}`);
        if (monthKeys.some(key => row[key] !== undefined && row[key] !== null)) {
            return monthKeys.reduce((sum, key) => sum + (Number(row[key]) || 0), 0);
        }
        return Number(row.total_tahun ?? row.total ?? row.total_budget) || 0;
    }

    function formatPercent(delta, budget) {
        return budget ? `${((delta / budget) * 100).toFixed(1)}%` : '—';
    }

    function syncDepartmentFilterOptions() {
        const select = document.getElementById('laporanDeptFilter');
        if (!select) return;
        const currentValue = select.value;
        const isCombined = window.SmartBaraCore.isCombinedDepartments();
        const allowedDepartments = new Set(window.SmartBaraCore.getSelectedDepartments().map(dept => String(dept).toUpperCase()));
        const budgetDepartments = [...accountBudgets, ...projectBudgets].map(budgetDepartment)
            .filter(dept => isCombined || allowedDepartments.has(dept));
        const departments = [...new Set([...Object.keys(deptData).map(dept => String(dept).toUpperCase()), ...budgetDepartments])].sort();
        select.innerHTML = '<option value="">Semua Dept Terpilih</option>' + departments
            .map(dept => `<option value="${window.Formatters.escapeHtml(dept)}">${window.Formatters.escapeHtml(dept)}</option>`)
            .join('');
        if (departments.includes(currentValue)) select.value = currentValue;
    }

    function makeReportGroup(groups, name) {
        const id = normalizeName(name);
        if (!groups.has(id)) {
            groups.set(id, { id, name, actual: 0, reconcile: 0, budget: 0, departments: new Set(), transactions: [], subs: new Map() });
        }
        return groups.get(id);
    }

    function renderHierarchical() {
        const tbody = document.getElementById('laporanTableBody');
        const countEl = document.getElementById('laporanStatCount');
        const totalEl = document.getElementById('laporanStatTotal');
        syncDepartmentFilterOptions();
        const search = (document.getElementById('laporanSearch')?.value || '').trim().toLowerCase();
        const departmentFilter = (document.getElementById('laporanDeptFilter')?.value || '').toUpperCase();
        const isAkunMode = viewMode === 'akun';
        const groups = new Map();

        Object.entries(deptData).forEach(([deptName, rows]) => {
            const dept = String(deptName).toUpperCase();
            if (departmentFilter && dept !== departmentFilter) return;
            (rows || []).forEach(transaction => {
                const account = transactionAccount(transaction);
                const project = transactionProject(transaction);
                const groupName = isAkunMode ? account : project;
                const subName = isAkunMode ? project : account;
                const actual = transactionActual(transaction);
                const reconcile = transactionReconcile(transaction);
                const group = makeReportGroup(groups, groupName);
                group.departments.add(dept);
                group.actual += actual;
                group.reconcile += reconcile;
                group.transactions.push({ ...transaction, dept, _reportAccount: account, _reportProject: project, _reportActual: actual, _reportReconcile: reconcile });

                const subId = normalizeName(subName);
                if (!group.subs.has(subId)) group.subs.set(subId, { name: subName, actual: 0, reconcile: 0, budget: 0, departments: new Set() });
                const sub = group.subs.get(subId);
                sub.actual += actual;
                sub.reconcile += reconcile;
                sub.departments.add(dept);
            });
        });

        const primaryBudgets = isAkunMode ? accountBudgets : projectBudgets;
        const secondaryBudgets = isAkunMode ? projectBudgets : accountBudgets;
        const allowedDepartments = new Set(window.SmartBaraCore.getSelectedDepartments().map(dept => String(dept).toUpperCase()));
        primaryBudgets.forEach(row => {
            const dept = budgetDepartment(row);
            if (departmentFilter && dept !== departmentFilter) return;
            if (!window.SmartBaraCore.isCombinedDepartments() && !allowedDepartments.has(dept)) return;
            const groupName = budgetName(row) || 'Lain-lain';
            const group = makeReportGroup(groups, groupName);
            group.departments.add(dept);
            group.budget += annualBudget(row);
        });

        const secondaryBudgetMap = new Map();
        secondaryBudgets.forEach(row => {
            const dept = budgetDepartment(row);
            if (departmentFilter && dept !== departmentFilter) return;
            if (!window.SmartBaraCore.isCombinedDepartments() && !allowedDepartments.has(dept)) return;
            secondaryBudgetMap.set(`${dept}|${normalizeName(budgetName(row))}`, annualBudget(row));
        });
        groups.forEach(group => group.subs.forEach(sub => {
            sub.departments.forEach(dept => {
                sub.budget += secondaryBudgetMap.get(`${dept}|${normalizeName(sub.name)}`) || 0;
            });
        }));

        const filtered = [...groups.values()]
            .filter(group => !search || `${group.name} ${[...group.departments].join(' ')}`.toLowerCase().includes(search))
            .sort((a, b) => a.name.localeCompare(b.name));
        reportGroups = new Map(filtered.map(group => [group.id, group]));
        visibleReportGroups = filtered;
        const grandTotal = filtered.reduce((sum, group) => sum + group.actual, 0);
        if (countEl) countEl.textContent = filtered.length.toLocaleString('id-ID');
        if (totalEl) totalEl.textContent = window.Formatters.formatRupiah(grandTotal);
        if (!tbody) return;
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="py-10 text-center text-slate-500">Tidak ada akun/proyek sesuai filter.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(group => {
            const actualDelta = group.budget - group.actual;
            const reconcileDelta = group.budget - group.reconcile;
            const departments = [...group.departments].sort().join(', ');
            return `<tr class="cursor-pointer border-b border-white/10 bg-slate-900/50 font-semibold transition hover:bg-teal-500/10 focus:bg-teal-500/10" tabindex="0" role="button" data-report-group="${encodeURIComponent(group.id)}" aria-label="Buka detail ${window.Formatters.escapeHtml(group.name)}">
                <td class="py-3 text-white"><span class="mr-2 text-teal-400">↗</span>${window.Formatters.escapeHtml(group.name)}</td>
                <td class="text-slate-400 text-xs">${window.Formatters.escapeHtml(departments || '-')}</td>
                <td class="text-right tabular-nums text-slate-200">${window.Formatters.formatRupiah(group.budget)}</td>
                <td class="text-right tabular-nums text-white">${window.Formatters.formatRupiah(group.actual)}</td>
                <td class="text-right tabular-nums ${actualDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}">${window.Formatters.formatRupiah(actualDelta)}</td>
                <td class="text-right tabular-nums text-slate-300">${formatPercent(actualDelta, group.budget)}</td>
                <td class="text-right tabular-nums text-sky-300">${window.Formatters.formatRupiah(group.reconcile)}</td>
                <td class="text-right tabular-nums ${reconcileDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}">${window.Formatters.formatRupiah(reconcileDelta)}</td>
                <td class="text-right tabular-nums text-slate-300">${formatPercent(reconcileDelta, group.budget)}</td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('[data-report-group]').forEach(row => {
            const open = () => openGroupDetail(decodeURIComponent(row.dataset.reportGroup));
            row.addEventListener('click', open);
            row.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });
        });
    }

    function ensureDetailModals() {
        if (document.getElementById('reportGroupDetailModal')) return;
        const groupModal = document.createElement('div');
        groupModal.id = 'reportGroupDetailModal';
        groupModal.className = 'modal-overlay report-detail-overlay fixed inset-0 z-[9400] hidden flex items-center justify-center p-4 opacity-0 transition-all duration-200';
        groupModal.innerHTML = `
            <section class="glass-panel report-detail-panel report-detail-panel-wide flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-white/20 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="reportGroupDetailTitle">
                <header class="flex items-center justify-between gap-4 border-b border-white/10 bg-slate-950/60 px-5 py-4">
                    <div class="min-w-0"><p class="m-0 text-[10px] font-black uppercase text-teal-300">Rincian budget dan aktual</p><h3 id="reportGroupDetailTitle" class="m-0 mt-1 truncate text-lg font-black text-white"></h3></div>
                    <button type="button" onclick="LaporanModule.closeGroupDetail()" class="text-xl text-slate-400 hover:text-white" aria-label="Tutup detail">×</button>
                </header>
                <div id="reportGroupDetailSummary" class="grid grid-cols-2 gap-2 border-b border-white/10 p-4 md:grid-cols-4"></div>
                <div class="flex flex-wrap items-center gap-2 border-b border-white/10 p-4">
                    <input id="reportDetailSearch" type="search" oninput="LaporanModule.renderGroupDetailTransactions()" class="form-input min-w-[180px] flex-1" placeholder="Cari ID, akun, referensi, catatan...">
                    <select id="reportDetailDeptFilter" onchange="LaporanModule.renderGroupDetailTransactions()" class="form-select w-44"><option value="">Semua departemen</option></select>
                    <span id="reportDetailCount" class="text-xs text-slate-400"></span>
                </div>
                <div id="reportDetailTableWrap" class="flex-1 overflow-auto">
                    <table class="app-table min-w-[1100px]">
                        <thead class="sticky top-0 z-10 bg-slate-900"><tr><th>ID / Referensi</th><th>Tanggal</th><th>Dept</th><th>Akun</th><th>Proyek</th><th class="text-right">Debit</th><th class="text-right">Kredit</th><th class="text-right">Realisasi</th><th class="text-right">Rekonsil</th><th>Catatan</th></tr></thead>
                        <tbody id="reportDetailTableBody" class="divide-y divide-white/5"></tbody>
                    </table>
                </div>
            </section>`;
        groupModal.addEventListener('click', event => {
            if (event.target === groupModal) closeGroupDetail();
        });
        document.body.appendChild(groupModal);

        const transactionModal = document.createElement('div');
        transactionModal.id = 'reportTransactionDetailModal';
        transactionModal.className = 'modal-overlay report-detail-overlay fixed inset-0 z-[9500] hidden flex items-center justify-center p-4 opacity-0 transition-all duration-200';
        transactionModal.innerHTML = `
            <section class="glass-panel report-detail-panel report-detail-panel-compact flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-sky-400/30 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="reportTransactionDetailTitle">
                <header class="flex items-center justify-between gap-4 border-b border-white/10 bg-slate-950/60 px-5 py-4">
                    <div class="min-w-0"><p class="m-0 text-[10px] font-black uppercase text-sky-300">Jejak transaksi</p><h3 id="reportTransactionDetailTitle" class="m-0 mt-1 truncate text-base font-black text-white"></h3></div>
                    <button type="button" onclick="LaporanModule.closeTransactionDetail()" class="text-xl text-slate-400 hover:text-white" aria-label="Tutup detail transaksi">×</button>
                </header>
                <div id="reportTransactionDetailBody" class="grid grid-cols-1 gap-2 overflow-auto p-5 sm:grid-cols-2"></div>
                <div class="border-t border-white/10 p-5">
                    <div class="mb-3 flex items-center justify-between gap-3"><h4 class="m-0 text-xs font-black uppercase text-slate-300">Transaksi terkait</h4><input id="reportRelatedSearch" type="search" oninput="LaporanModule.renderRelatedTransactions()" class="form-input w-56 text-xs" placeholder="Cari terkait..."></div>
                    <div id="reportRelatedTransactions" class="max-h-48 space-y-1 overflow-y-auto"></div>
                </div>
            </section>`;
        transactionModal.addEventListener('click', event => {
            if (event.target === transactionModal) closeTransactionDetail();
        });
        document.body.appendChild(transactionModal);
    }

    function openGroupDetail(groupId) {
        const group = reportGroups.get(groupId);
        if (!group) return;
        ensureDetailModals();
        activeDetailGroup = group;
        const modal = document.getElementById('reportGroupDetailModal');
        document.getElementById('reportGroupDetailTitle').textContent = group.name;
        const actualDelta = group.budget - group.actual;
        const reconcileDelta = group.budget - group.reconcile;
        const summary = [
            ['Budget', group.budget, 'text-white'], ['Aktual Debit - Kredit', group.actual, 'text-teal-300'],
            ['Selisih ke Aktual', actualDelta, actualDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'],
            ['% ke Aktual', formatPercent(actualDelta, group.budget), 'text-slate-200'],
            ['Nilai Rekonsil', group.reconcile, 'text-sky-300'], ['Selisih ke Rekonsil', reconcileDelta, reconcileDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'],
            ['% ke Rekonsil', formatPercent(reconcileDelta, group.budget), 'text-slate-200'], ['Transaksi', group.transactions.length, 'text-slate-200']
        ];
        document.getElementById('reportGroupDetailSummary').innerHTML = summary.map(([label, value, color]) => `
            <div class="border-l border-white/10 pl-3"><p class="m-0 text-[9px] font-bold uppercase text-slate-500">${label}</p><p class="m-0 mt-1 text-sm font-black tabular-nums ${color}">${typeof value === 'number' ? window.Formatters.formatRupiah(value) : window.Formatters.escapeHtml(value)}</p></div>
        `).join('');
        const deptSelect = document.getElementById('reportDetailDeptFilter');
        const previousDept = deptSelect.value;
        const depts = [...new Set(group.transactions.map(transaction => transaction.dept).filter(Boolean))].sort();
        deptSelect.innerHTML = '<option value="">Semua departemen</option>' + depts.map(dept => `<option value="${window.Formatters.escapeHtml(dept)}">${window.Formatters.escapeHtml(dept)}</option>`).join('');
        if (depts.includes(previousDept)) deptSelect.value = previousDept;
        document.getElementById('reportDetailSearch').value = '';
        renderGroupDetailTransactions();
        modal.classList.remove('hidden');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
    }

    function renderGroupDetailTransactions() {
        if (!activeDetailGroup) return;
        const search = (document.getElementById('reportDetailSearch')?.value || '').trim().toLowerCase();
        const dept = document.getElementById('reportDetailDeptFilter')?.value || '';
        const matching = activeDetailGroup.transactions.map((transaction, index) => ({ transaction, index })).filter(({ transaction }) => {
            const matchesDept = !dept || transaction.dept === dept;
            const matchesSearch = !search || [transactionId(transaction), transactionReference(transaction), transactionDate(transaction), transaction.dept, transaction._reportAccount, transaction._reportProject, transaction.keterangan, transaction.Keterangan, transactionNote(transaction)]
                .some(value => String(value || '').toLowerCase().includes(search));
            return matchesDept && matchesSearch;
        });
        document.getElementById('reportDetailCount').textContent = `${matching.length.toLocaleString('id-ID')} transaksi`;
        const tbody = document.getElementById('reportDetailTableBody');
        if (!matching.length) {
            tbody.innerHTML = '<tr><td colspan="10" class="py-8 text-center text-slate-500">Tidak ada transaksi yang cocok.</td></tr>';
            return;
        }
        tbody.innerHTML = matching.map(({ transaction, index }) => `
            <tr class="cursor-pointer hover:bg-sky-500/10" tabindex="0" role="button" data-transaction-index="${index}">
                <td class="font-mono text-[10px] text-sky-300">${window.Formatters.escapeHtml(transactionId(transaction) || transactionReference(transaction) || '-')}</td>
                <td class="whitespace-nowrap text-slate-400">${window.Formatters.escapeHtml(transactionDate(transaction) || '-')}</td>
                <td>${window.Formatters.escapeHtml(transaction.dept || '-')}</td>
                <td>${window.Formatters.escapeHtml(transaction._reportAccount || '-')}</td>
                <td>${window.Formatters.escapeHtml(transaction._reportProject || '-')}</td>
                <td class="text-right tabular-nums">${window.Formatters.formatRupiah(Number(transaction.debit ?? transaction.Debit) || 0)}</td>
                <td class="text-right tabular-nums">${window.Formatters.formatRupiah(Number(transaction.kredit ?? transaction.Kredit) || 0)}</td>
                <td class="text-right tabular-nums font-bold text-teal-300">${window.Formatters.formatRupiah(transaction._reportActual)}</td>
                <td class="text-right tabular-nums text-sky-300">${window.Formatters.formatRupiah(transaction._reportReconcile)}</td>
                <td class="max-w-[220px] truncate text-slate-400">${window.Formatters.escapeHtml(transactionNote(transaction))}</td>
            </tr>
        `).join('');
        tbody.querySelectorAll('[data-transaction-index]').forEach(row => {
            const open = () => openTransactionDetail(Number(row.dataset.transactionIndex));
            row.addEventListener('click', open);
            row.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });
        });
    }

    function openTransactionDetail(index) {
        if (!activeDetailGroup || !activeDetailGroup.transactions[index]) return;
        ensureDetailModals();
        activeTransactionIndex = index;
        const transaction = activeDetailGroup.transactions[index];
        const fields = [
            ['ID Transaksi System', transactionId(transaction)], ['No. Sumber', transactionReference(transaction)], ['Tanggal', transactionDate(transaction)],
            ['Departemen', transaction.dept], ['Akun', transaction._reportAccount], ['Proyek UP', transaction._reportProject],
            ['Keterangan', transaction.keterangan || transaction.Keterangan], ['Catatan', transactionNote(transaction)],
            ['Debit', Number(transaction.debit ?? transaction.Debit) || 0], ['Kredit', Number(transaction.kredit ?? transaction.Kredit) || 0],
            ['Aktual (Debit - Kredit)', transaction._reportActual], ['Nilai Finance', Number(transaction.finance || 0) + Number(transaction.adj_finance || 0)],
            ['Nilai Rekonsil', transaction._reportReconcile], ['Selisih Aktual - Rekonsil', transaction._reportActual - transaction._reportReconcile]
        ];
        document.getElementById('reportTransactionDetailTitle').textContent = transactionReference(transaction) || transactionId(transaction) || 'Detail transaksi';
        document.getElementById('reportTransactionDetailBody').innerHTML = fields.map(([label, value]) => `
            <div class="border-b border-white/5 py-2"><p class="m-0 text-[9px] font-bold uppercase text-slate-500">${label}</p><p class="m-0 mt-0.5 break-words text-xs font-semibold text-slate-200">${typeof value === 'number' ? window.Formatters.formatRupiah(value) : window.Formatters.escapeHtml(value || '-')}</p></div>
        `).join('');
        document.getElementById('reportRelatedSearch').value = '';
        renderRelatedTransactions();
        const modal = document.getElementById('reportTransactionDetailModal');
        modal.classList.remove('hidden');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
    }

    function renderRelatedTransactions() {
        if (!activeDetailGroup || activeTransactionIndex < 0) return;
        const current = activeDetailGroup.transactions[activeTransactionIndex];
        const query = (document.getElementById('reportRelatedSearch')?.value || '').trim().toLowerCase();
        const source = transactionReference(current).toLowerCase();
        const related = activeDetailGroup.transactions.map((transaction, index) => ({ transaction, index })).filter(({ transaction, index }) => {
            if (index === activeTransactionIndex) return false;
            const sameReference = source && transactionReference(transaction).toLowerCase() === source;
            const sameAccountProject = normalizeName(transaction._reportAccount) === normalizeName(current._reportAccount) && normalizeName(transaction._reportProject) === normalizeName(current._reportProject);
            const matchesSearch = !query || [transactionId(transaction), transactionReference(transaction), transactionDate(transaction), transaction.dept, transaction.keterangan, transaction.Keterangan, transactionNote(transaction)]
                .some(value => String(value || '').toLowerCase().includes(query));
            return (sameReference || sameAccountProject) && matchesSearch;
        }).slice(0, 100);
        const container = document.getElementById('reportRelatedTransactions');
        container.innerHTML = related.length ? related.map(({ transaction, index }) => `
            <button type="button" data-related-index="${index}" class="flex w-full items-center justify-between gap-3 border-b border-white/5 px-2 py-2 text-left hover:bg-white/5">
                <span class="min-w-0"><span class="block truncate text-xs font-bold text-sky-300">${window.Formatters.escapeHtml(transactionReference(transaction) || transactionId(transaction) || 'Transaksi terkait')}</span><span class="block truncate text-[10px] text-slate-400">${window.Formatters.escapeHtml(transactionDate(transaction) || '-')} · ${window.Formatters.escapeHtml(transaction.dept || '-')} · ${window.Formatters.escapeHtml(transaction.keterangan || transaction.Keterangan || '')}</span></span>
                <span class="whitespace-nowrap text-xs font-bold text-slate-200">${window.Formatters.formatRupiah(transaction._reportActual)}</span>
            </button>
        `).join('') : '<p class="m-0 py-3 text-xs text-slate-500">Tidak ada transaksi terkait lain untuk referensi ini.</p>';
        container.querySelectorAll('[data-related-index]').forEach(button => button.addEventListener('click', () => openTransactionDetail(Number(button.dataset.relatedIndex))));
    }

    function closeTransactionDetail() {
        const modal = document.getElementById('reportTransactionDetailModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    function closeGroupDetail() {
        closeTransactionDetail();
        const modal = document.getElementById('reportGroupDetailModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
        activeDetailGroup = null;
        activeTransactionIndex = -1;
    }

    function exportSummaryRows() {
        return visibleReportGroups.map(group => ({
            name: group.name,
            departments: [...group.departments].sort().join(', '),
            budget: group.budget,
            actual: group.actual,
            actualDelta: group.budget - group.actual,
            actualPercent: formatPercent(group.budget - group.actual, group.budget),
            reconcile: group.reconcile,
            reconcileDelta: group.budget - group.reconcile,
            reconcilePercent: formatPercent(group.budget - group.reconcile, group.budget),
            transactions: group.transactions
        }));
    }

    function reportTitle() {
        return viewMode === 'akun' ? 'POV Akun Induk' : 'POV Proyek UP';
    }

    async function exportToExcel() {
        await window.SmartBaraLayout.withLoading('Mengekspor Excel', 'Menyusun ringkasan varians dan rincian transaksi...', async () => {
            try {
                await window.SmartBaraConfig.ensureLibrary('exceljs');
                if (!window.ExcelJS) throw new Error('Library Excel belum tersedia.');
                const workbook = new ExcelJS.Workbook();
                workbook.creator = 'Smart BARA';
                workbook.created = new Date();
                const summary = workbook.addWorksheet('Ringkasan');
                summary.columns = [
                    { header: viewMode === 'akun' ? 'Akun Induk' : 'Proyek UP', key: 'name', width: 34 },
                    { header: 'Departemen', key: 'departments', width: 22 },
                    { header: 'Budget Tahunan', key: 'budget', width: 20 },
                    { header: 'Realisasi Debit - Kredit', key: 'actual', width: 24 },
                    { header: 'Selisih Budget - Realisasi', key: 'actualDelta', width: 25 },
                    { header: '% Selisih Realisasi', key: 'actualPercent', width: 18 },
                    { header: 'Nilai Rekonsil', key: 'reconcile', width: 20 },
                    { header: 'Selisih Budget - Rekonsil', key: 'reconcileDelta', width: 25 },
                    { header: '% Selisih Rekonsil', key: 'reconcilePercent', width: 18 }
                ];
                summary.insertRow(1, [`${reportTitle()} · Periode ${window.SmartBaraCore.getActivePeriod()}`]);
                summary.mergeCells(1, 1, 1, summary.columns.length);
                summary.getRow(1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
                summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
                summary.getRow(1).height = 28;
                summary.getRow(2).values = summary.columns.map(column => column.header);
                const summaryRows = exportSummaryRows();
                summaryRows.forEach(row => summary.addRow(row));
                summary.views = [{ state: 'frozen', ySplit: 2 }];
                summary.autoFilter = { from: 'A2', to: `${String.fromCharCode(64 + summary.columns.length)}${summary.rowCount}` };
                summary.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                summary.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
                summaryRows.forEach((_, index) => {
                    const row = summary.getRow(index + 3);
                    [3, 4, 5, 7, 8].forEach(column => { row.getCell(column).numFmt = '#,##0;[Red]-#,##0'; });
                });

                const details = workbook.addWorksheet('Rincian Transaksi');
                details.columns = [
                    { header: 'Akun / Proyek', key: 'group', width: 30 }, { header: 'ID Transaksi', key: 'id', width: 28 },
                    { header: 'Tanggal', key: 'date', width: 16 }, { header: 'Departemen', key: 'dept', width: 18 },
                    { header: 'Akun', key: 'account', width: 30 }, { header: 'Proyek UP', key: 'project', width: 28 },
                    { header: 'No. Sumber', key: 'source', width: 22 }, { header: 'Debit', key: 'debit', width: 18 },
                    { header: 'Kredit', key: 'credit', width: 18 }, { header: 'Aktual (D-K)', key: 'actual', width: 20 },
                    { header: 'Finance Final', key: 'finance', width: 20 }, { header: 'Rekonsil Final', key: 'reconcile', width: 20 },
                    { header: 'Catatan', key: 'note', width: 42 }
                ];
                details.addRows(exportSummaryRows().flatMap(group => group.transactions.map(transaction => ({
                    group: group.name,
                    id: transactionId(transaction),
                    date: transactionDate(transaction),
                    dept: transaction.dept || '',
                    account: transaction._reportAccount || '',
                    project: transaction._reportProject || '',
                    source: transactionReference(transaction),
                    debit: Number(transaction.debit ?? transaction.Debit) || 0,
                    credit: Number(transaction.kredit ?? transaction.Kredit) || 0,
                    actual: transaction._reportActual,
                    finance: (Number(transaction.finance) || 0) + (Number(transaction.adj_finance) || 0),
                    reconcile: transaction._reportReconcile,
                    note: transactionNote(transaction)
                }))));
                details.views = [{ state: 'frozen', ySplit: 1 }];
                if (details.rowCount > 1) details.autoFilter = { from: 'A1', to: `M${details.rowCount}` };
                [summary, details].forEach(sheet => {
                    sheet.getRow(sheet === summary ? 2 : 1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    sheet.getRow(sheet === summary ? 2 : 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
                });
                details.eachRow((row, rowNumber) => {
                    if (rowNumber > 1) [8, 9, 10, 11, 12].forEach(column => { row.getCell(column).numFmt = '#,##0;[Red]-#,##0'; });
                });
                const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `SmartBARA_${viewMode === 'akun' ? 'POV_Akun' : 'POV_Proyek'}_${window.SmartBaraCore.getActivePeriod()}.xlsx`;
                anchor.click();
                URL.revokeObjectURL(url);
            } catch(error) {
                console.error('Export POV Excel error:', error);
                alert(`Gagal mengekspor Excel: ${error.message}`);
            }
        });
    }

    async function exportToPpt() {
        await window.SmartBaraLayout.withLoading('Menyusun PowerPoint', 'Membuat ringkasan dan halaman data...', async () => {
            try {
                await window.SmartBaraConfig.ensureLibrary('pptx');
                const PptxConstructor = window.PptxGenJS || window.pptxgen;
                if (!PptxConstructor) throw new Error('Library PowerPoint belum tersedia.');
                const pptx = new PptxConstructor();
                pptx.layout = 'LAYOUT_WIDE';
                pptx.author = 'Smart BARA';
                pptx.subject = `${reportTitle()} ${window.SmartBaraCore.getActivePeriod()}`;
                pptx.title = reportTitle();
                pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'id-ID' };
                const rows = exportSummaryRows();
                const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0);
                const totalActual = rows.reduce((sum, row) => sum + row.actual, 0);
                const totalReconcile = rows.reduce((sum, row) => sum + row.reconcile, 0);
                const titleSlide = pptx.addSlide();
                titleSlide.background = { color: '0B1220' };
                titleSlide.addText('SMART BARA · RINGKASAN KINERJA', { x: 0.65, y: 0.7, w: 8, h: 0.3, fontFace: 'Aptos', fontSize: 11, bold: true, color: '5EEAD4', breakLine: false });
                titleSlide.addText(reportTitle(), { x: 0.65, y: 1.35, w: 11.8, h: 0.65, fontFace: 'Aptos Display', fontSize: 28, bold: true, color: 'FFFFFF', breakLine: false });
                titleSlide.addText(`Periode ${window.SmartBaraCore.getActivePeriod()} · ${new Date().toLocaleDateString('id-ID')}`, { x: 0.65, y: 2.08, w: 11.8, h: 0.3, fontFace: 'Aptos', fontSize: 12, color: '94A3B8', breakLine: false });
                titleSlide.addText([
                    { text: `Budget tahunan  ${window.Formatters.formatRupiah(totalBudget)}\n`, options: { breakLine: true, color: 'FFFFFF' } },
                    { text: `Realisasi debit - kredit  ${window.Formatters.formatRupiah(totalActual)}\n`, options: { breakLine: true, color: '5EEAD4' } },
                    { text: `Nilai rekonsil  ${window.Formatters.formatRupiah(totalReconcile)}`, options: { color: '7DD3FC' } }
                ], { x: 0.65, y: 3.05, w: 7.2, h: 2.05, fontFace: 'Aptos', fontSize: 20, breakLine: false, paraSpaceAfterPt: 12, valign: 'mid' });

                const headers = [viewMode === 'akun' ? 'Akun' : 'Proyek', 'Dept', 'Budget', 'Aktual D-K', 'Selisih Aktual', '%', 'Rekonsil', 'Selisih Rekonsil', '%'];
                const chunkSize = 11;
                for (let start = 0; start < rows.length; start += chunkSize) {
                    const pageRows = rows.slice(start, start + chunkSize);
                    const slide = pptx.addSlide();
                    slide.background = { color: 'F8FAFC' };
                    slide.addText(`${reportTitle()} · Rincian ${start + 1}-${start + pageRows.length}`, { x: 0.45, y: 0.35, w: 12.2, h: 0.4, fontFace: 'Aptos Display', fontSize: 18, bold: true, color: '0F172A', breakLine: false });
                    slide.addTable([headers, ...pageRows.map(row => [row.name, row.departments, window.Formatters.formatRupiah(row.budget), window.Formatters.formatRupiah(row.actual), window.Formatters.formatRupiah(row.actualDelta), row.actualPercent, window.Formatters.formatRupiah(row.reconcile), window.Formatters.formatRupiah(row.reconcileDelta), row.reconcilePercent])], {
                        x: 0.45, y: 1.05, w: 12.35, h: 5.85, fontFace: 'Aptos', fontSize: 8, color: '1E293B',
                        border: { type: 'solid', color: 'CBD5E1', pt: 0.6 },
                        fill: 'FFFFFF', margin: 0.06, rowH: 0.38, autoFit: false,
                        bold: false, valign: 'mid'
                    });
                    slide.addText(`Smart BARA · ${window.SmartBaraCore.getActivePeriod()}`, { x: 0.45, y: 7.08, w: 12.35, h: 0.18, fontFace: 'Aptos', fontSize: 8, color: '64748B', align: 'right', breakLine: false });
                }
                await pptx.writeFile({ fileName: `SmartBARA_${viewMode === 'akun' ? 'POV_Akun' : 'POV_Proyek'}_${window.SmartBaraCore.getActivePeriod()}.pptx` });
            } catch(error) {
                console.error('Export POV PPT error:', error);
                alert(`Gagal mengekspor PowerPoint: ${error.message}`);
            }
        });
    }

    function renderMatriks() {
        const thead = document.getElementById('matriksTableHead');
        const tbody = document.getElementById('matriksTableBody');
        const depts = Object.keys(deptData).sort();

        if (!depts.length) {
            if (tbody) tbody.innerHTML = `<tr><td class="p-8 text-center text-slate-500">Belum ada departemen yang diupload.</td></tr>`;
            return;
        }

        // Gather all unique accounts
        const allAccounts = new Set();
        depts.forEach(d => {
            (deptData[d] || []).forEach(r => {
                const acc = String(getTransactionField(r, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'nama akun up', 'nama akun induk', 'nama akun', 'akun']) || '').trim();
                if (acc) allAccounts.add(acc);
            });
        });

        const sortedAccs = [...allAccounts].sort();

        // Render Head
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th class="sticky left-0 bg-slate-900 z-20">Nama Akun</th>
                    ${depts.map(d => `<th class="text-right">${window.Formatters.escapeHtml(d)}</th>`).join('')}
                    <th class="text-right font-black text-teal-300">Total Akun</th>
                </tr>
            `;
        }

        // Render Body
        if (tbody) {
            tbody.innerHTML = sortedAccs.map(acc => {
                let rowSum = 0;
                const cols = depts.map(d => {
                    let dSum = 0;
                    (deptData[d] || []).forEach(r => {
                        const rAcc = String(getTransactionField(r, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'nama akun up', 'nama akun induk', 'nama akun', 'akun']) || '').trim();
                        if (rAcc === acc) dSum += transactionReconcile(r);
                    });
                    rowSum += dSum;
                    return `<td class="text-right font-mono ${dSum > 0 ? 'text-slate-200' : 'text-slate-600'}">${window.Formatters.formatRupiah(dSum)}</td>`;
                }).join('');

                return `
                    <tr class="hover:bg-white/[0.03]">
                        <td class="sticky left-0 bg-slate-950 font-bold text-white whitespace-nowrap">${window.Formatters.escapeHtml(acc)}</td>
                        ${cols}
                        <td class="text-right font-black text-teal-400 font-mono">${window.Formatters.formatRupiah(rowSum)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    function setStatus(msg, isError = false) {
        const el = document.getElementById('laporanStatusText');
        if (el) {
            el.textContent = msg;
            el.className = `text-xs font-semibold ${isError ? 'text-rose-400' : 'text-slate-400'}`;
        }
    }

    return {
        init,
        renderHierarchical,
        renderMatriks,
        openGroupDetail,
        closeGroupDetail,
        renderGroupDetailTransactions,
        openTransactionDetail,
        closeTransactionDetail,
        renderRelatedTransactions,
        exportToExcel,
        exportToPpt
    };
})();

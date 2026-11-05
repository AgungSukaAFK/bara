// ==============================================================================
// SMART BARA 7.10 HZ - BUDGET PLAN (AKUN) & BUDGET SITE (PROYEK) MODULE
// ==============================================================================

window.BudgetModule = (function() {
    let budgetType = 'account'; // 'account' or 'site'
    let items = [];
    const promptedCachePeriods = new Set();
    const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];

    function normalizeBudgetItem(item) {
        const budget = Array.isArray(item.budget)
            ? item.budget
            : MONTH_KEYS.map(month => Number(item[`budget_${month}`]) || 0);
        return {
            ...item,
            nama: item.nama || item.nama_akun || item.nama_proyek || item.account_name || item.project_name || '',
            dept: item.dept || item.departemen || item.department || 'UMUM',
            budget
        };
    }

    async function init(type = 'account') {
        budgetType = type;
        renderTable();
        window.addEventListener('smartbara:period_change', async () => {
            await loadData();
            await populateCopyPeriods();
        });
        window.addEventListener('smartbara:dept_filter_change', () => renderTable());
        window.SmartBaraCore.onRealtimeChange(payload => {
            const tableTarget = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
            if (payload.table === tableTarget) loadData(true);
        });
        await loadData();
        await populateCopyPeriods();
    }

    async function loadData(silent = false) {
        const period = window.SmartBaraCore.getActivePeriod();
        const client = window.SmartBaraCore.getClient();
        const storageKey = budgetType === 'site' ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;
        const tableName = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';

        // Load local cache first
        try {
            const cached = JSON.parse(localStorage.getItem(storageKey) || '[]');
            if (Array.isArray(cached) && cached.length) {
                items = cached.map(normalizeBudgetItem);
                renderTable();
            }
        } catch(e) {}

        if (!silent) setStatus('Memuat data anggaran...');

        if (!client) {
            setStatus(`${items.length} item hanya ada di cache komputer ini; cloud belum terhubung.`, true);
            return;
        }

        try {
            const { data, error } = await client
                .from(tableName)
                .select('*')
                .eq('period_name', period);

            if (error) throw error;
            const cloudItems = (data || []).map(normalizeBudgetItem);
            const cachedItems = JSON.parse(localStorage.getItem(storageKey) || '[]').map(normalizeBudgetItem);
            const cloudIds = new Set(cloudItems.map(item => String(item.id || '')));
            const cloudIdentities = new Set(cloudItems.map(item => `${String(item.dept || '').trim().toUpperCase()}:${String(item.nama || '').trim().toLocaleLowerCase('id-ID')}`));
            const localOnlyItems = cachedItems.filter(item => {
                const identity = `${String(item.dept || '').trim().toUpperCase()}:${String(item.nama || '').trim().toLocaleLowerCase('id-ID')}`;
                return !cloudIds.has(String(item.id || '')) && !cloudIdentities.has(identity);
            });

            if (localOnlyItems.length && window.SmartBaraCore.canApproveAllDepartments() && !promptedCachePeriods.has(period)) {
                promptedCachePeriods.add(period);
                const shouldRestoreCache = await window.SmartBaraLayout.confirmDialog({
                    title: 'Budget lokal belum ada di cloud',
                    message: `Ditemukan ${localOnlyItems.length} baris di cache komputer ini yang belum ada di cloud. Sinkronkan sekarang agar tersedia di komputer lain? Cache lama mungkin berisi baris yang sebelumnya sengaja dihapus.`,
                    confirmText: 'Sinkronkan ke cloud',
                    cancelText: 'Tinjau nanti',
                    danger: false
                });

                if (shouldRestoreCache && window.SmartBaraCore.canApproveAllDepartments()) {
                    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                    const restoreRows = localOnlyItems.map(item => ({
                        id: uuidPattern.test(String(item.id || '')) ? item.id : crypto.randomUUID(),
                        period_name: period,
                        nama: item.nama,
                        dept: item.dept,
                        budget: MONTH_KEYS.map((month, index) => Number(item.budget?.[index]) || 0)
                    }));
                    try {
                        await window.SmartBaraCore.syncCloudUpsert(tableName, restoreRows, 'id', `budget-cache:${period}`, 'Pemulihan cache budget');
                        items = [...cloudItems, ...restoreRows.map(normalizeBudgetItem)];
                        localStorage.setItem(storageKey, JSON.stringify(items));
                        setStatus(`${restoreRows.length} budget lokal berhasil disinkronkan ke cloud.`);
                    } catch (error) {
                        items = [...cloudItems, ...localOnlyItems];
                        if (error.queuedForSync) {
                            const restoredByIdentity = new Map(restoreRows.map(row => [`${row.dept}:${row.nama.toLocaleLowerCase('id-ID')}`, normalizeBudgetItem(row)]));
                            items = [...cloudItems, ...restoredByIdentity.values()];
                            localStorage.setItem(storageKey, JSON.stringify(items));
                            setStatus(`${restoreRows.length} budget lokal menunggu sinkronisasi cloud.`, true);
                        } else {
                            setStatus(`Budget lokal belum tersinkron: ${error.message}`, true);
                        }
                    }
                    renderTable();
                    return;
                }
            }

            items = [...cloudItems, ...localOnlyItems];
            if (!localOnlyItems.length) localStorage.setItem(storageKey, JSON.stringify(items));
            else setStatus(`${localOnlyItems.length} budget hanya ada di cache komputer ini; belum tersinkron cloud.`, true);
            renderTable();
            if (!localOnlyItems.length) setStatus(`${items.length} item anggaran siap dari cloud.`);
        } catch(err) {
            console.warn('Load budget error:', err);
            renderTable();
            setStatus(`${items.length} item hanya ada di cache komputer ini; gagal membaca cloud: ${err.message}`, true);
        }
    }

    async function populateCopyPeriods() {
        const select = document.getElementById('budgetCopySourcePeriod');
        if (!select) return;
        const activePeriod = window.SmartBaraCore.getActivePeriod();
        const periods = await window.SmartBaraCore.loadAvailablePeriods();
        const sources = (periods || []).filter(period => period !== activePeriod);
        select.innerHTML = sources.length
            ? sources.map(period => `<option value="${window.Formatters.escapeHtml(period)}">Dari ${window.Formatters.escapeHtml(period)}</option>`).join('')
            : '<option value="">Tidak ada periode sumber</option>';
    }

    async function copyFromPeriod() {
        if (!window.SmartBaraCore.canWriteData()) {
            setStatus('Level akses Viewer hanya dapat membaca anggaran.', true);
            return;
        }
        const sourcePeriod = document.getElementById('budgetCopySourcePeriod')?.value;
        if (!sourcePeriod) {
            await window.SmartBaraLayout.alertDialog({ title: 'Periode sumber tidak tersedia', message: 'Tidak ada periode sumber yang dapat ditarik.', confirmText: 'OK' });
            return;
        }
        const loadingTask = window.SmartBaraLayout.beginLoading('Menarik budget', `Membaca dan menyiapkan data periode ${sourcePeriod}...`);
        let copySucceeded = false;
        try {
        const targetPeriod = window.SmartBaraCore.getActivePeriod();
        const tableName = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
        const storagePrefix = budgetType === 'site' ? 'smartbara_budget_site_v2_' : 'smartbara_budget_v2_';
        let sourceRows = [];

        try {
            const client = window.SmartBaraCore.getClient();
            if (client) {
                const { data, error } = await client.from(tableName).select('*').eq('period_name', sourcePeriod);
                if (error) throw error;
                sourceRows = (data || []).map(normalizeBudgetItem);
            }
            if (!sourceRows.length) {
                sourceRows = JSON.parse(localStorage.getItem(`${storagePrefix}${sourcePeriod}`) || '[]').map(normalizeBudgetItem);
            }
        } catch (error) {
            await window.SmartBaraLayout.alertDialog({ title: 'Gagal membaca periode', message: `Gagal membaca periode ${sourcePeriod}: ${error.message}`, confirmText: 'OK' });
            return;
        }

        if (!sourceRows.length) {
            await window.SmartBaraLayout.alertDialog({ title: 'Budget tidak ditemukan', message: `Tidak ada budget pada periode ${sourcePeriod}.`, confirmText: 'OK' });
            return;
        }
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi penarikan budget',
            message: `Tarik ${sourceRows.length} baris budget dari ${sourcePeriod} ke ${targetPeriod}? Baris dengan akun dan departemen yang sama akan diperbarui.`,
            confirmText: 'Tarik',
            cancelText: 'Batal'
        });
        if (!confirmed) return;

        const nextItems = [...items];
        const touched = [];
        sourceRows.forEach(source => {
            const existingIndex = nextItems.findIndex(item =>
                String(item.nama || '').trim().toLowerCase() === String(source.nama || '').trim().toLowerCase() &&
                String(item.dept || '').trim().toLowerCase() === String(source.dept || '').trim().toLowerCase()
            );
            const id = existingIndex >= 0 ? nextItems[existingIndex].id : crypto.randomUUID();
            const row = { ...source, id, period_name: targetPeriod, updated_at: new Date().toISOString() };
            if (existingIndex >= 0) nextItems[existingIndex] = row;
            else nextItems.push(row);
            touched.push(row);
        });

        items = nextItems;
        localStorage.setItem(`${storagePrefix}${targetPeriod}`, JSON.stringify(items));
        renderTable();
        if (window.SmartBaraCore.canWriteCloud()) {
            try {
                for (const row of touched) {
                    const { id, period_name, updated_at, ...values } = row;
                    await window.SmartBaraCore.syncVersionedRow(tableName, targetPeriod, { id, period_name }, values, `budget:${id}`, 'Budget Plan');
                }
                setStatus(`${touched.length} baris ditarik dari ${sourcePeriod} dan disinkronkan.`);
            } catch (error) {
                setStatus(`Tersimpan lokal; sinkronisasi gagal: ${error.message}`, true);
            }
        } else {
            setStatus(`${touched.length} baris ditarik dari ${sourcePeriod} (lokal).`);
        }
        copySucceeded = true;
        } finally {
            window.SmartBaraLayout.endLoading(loadingTask, copySucceeded);
        }
    }

    function renderTable() {
        const tbody = document.getElementById('budgetTableBody');
        const countEl = document.getElementById('budgetStatCount');
        const totalEl = document.getElementById('budgetStatTotal');
        const search = (document.getElementById('budgetSearch')?.value || '').toLowerCase().trim();
        const deptFilter = document.getElementById('budgetDeptFilter')?.value || '';
        const selectedDepts = new Set(window.SmartBaraCore.getSelectedDepartments().map(dept => String(dept).toUpperCase()));
        const filterByGlobalDept = !window.SmartBaraCore.isCombinedDepartments();

        const filtered = items.filter(it => {
            if (filterByGlobalDept && !selectedDepts.has(String(it.dept || '').toUpperCase())) return false;
            if (deptFilter && it.dept !== deptFilter) return false;
            if (!search) return true;
            return [it.nama, it.dept].some(v => String(v || '').toLowerCase().includes(search));
        });

        let grandTotal = 0;
        const monthTotals = new Array(12).fill(0);

        filtered.forEach(it => {
            const bArr = Array.isArray(it.budget) ? it.budget : [];
            for (let m = 0; m < 12; m++) {
                const val = Number(bArr[m] || 0);
                monthTotals[m] += val;
                grandTotal += val;
            }
        });

        if (countEl) countEl.textContent = filtered.length.toLocaleString('id-ID');
        if (totalEl) totalEl.textContent = window.Formatters.formatRupiah(grandTotal);

        if (!tbody) return;

        if (!filtered.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-12 text-slate-500 font-medium">
                        Belum ada anggaran ${budgetType === 'site' ? 'Proyek Site' : 'Akun'}. Klik <strong>+ Tambah Anggaran</strong>.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map((item, idx) => {
            const bArr = Array.isArray(item.budget) ? item.budget : [];
            const rowTotal = bArr.reduce((s, v) => s + Number(v || 0), 0);
            const monthsHtml = bArr.slice(0, 12).map(v => `<td class="text-right text-slate-300 font-mono">${window.Formatters.formatNumber(v || 0)}</td>`).join('');

            return `
                <tr class="hover:bg-white/[0.03]">
                    <td class="font-extrabold text-white whitespace-nowrap">${window.Formatters.escapeHtml(item.nama)}</td>
                    <td class="text-slate-400 font-semibold">${window.Formatters.escapeHtml(item.dept)}</td>
                    ${monthsHtml}
                    <td class="text-right font-black text-teal-400">${window.Formatters.formatRupiah(rowTotal)}</td>
                    <td class="text-right whitespace-nowrap">
                        <button type="button" onclick="BudgetModule.openForm('${item.id}')" class="text-teal-400 hover:text-teal-300 font-bold text-xs mr-2">Edit</button>
                        <button type="button" onclick="BudgetModule.deleteItem('${item.id}')" class="text-rose-400 hover:text-rose-300 font-bold text-xs">Hapus</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function openForm(id = '') {
        const item = items.find(it => it.id === id);
        const modal = document.getElementById('budgetFormModal');
        if (!modal) return;

        document.getElementById('formBudgetId').value = item?.id || '';
        document.getElementById('formBudgetName').value = item?.nama || '';
        document.getElementById('formBudgetDept').value = item?.dept || 'HR';

        const bArr = Array.isArray(item?.budget) ? item.budget : [];
        for (let i = 1; i <= 12; i++) {
            document.getElementById(`formBudgetMonth${i}`).value = bArr[i - 1] ?? 0;
        }

        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeForm() {
        const modal = document.getElementById('budgetFormModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    async function saveForm(e) {
        e.preventDefault();
        if (!window.SmartBaraCore.canWriteData()) {
            window.SmartBaraCore.showSyncStatus('Level akses Viewer hanya dapat membaca anggaran.', 'error');
            return;
        }
        const id = document.getElementById('formBudgetId').value || crypto.randomUUID();
        const nama = document.getElementById('formBudgetName').value.trim();
        const dept = document.getElementById('formBudgetDept').value;
        const period = window.SmartBaraCore.getActivePeriod();
        const tableName = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
        const storageKey = budgetType === 'site' ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;

        const budget = [];
        for (let i = 1; i <= 12; i++) {
            budget.push(window.Formatters.parseNumber(document.getElementById(`formBudgetMonth${i}`).value, 0));
        }

        const payload = { id, period_name: period, nama, dept, budget, updated_at: new Date().toISOString() };
        const isEdit = items.some(it => it.id === id);
        const nextItems = isEdit ? items.map(it => it.id === id ? { ...it, ...payload } : it) : [payload, ...items];
        items = nextItems;
        localStorage.setItem(storageKey, JSON.stringify(nextItems));
        renderTable();
        closeForm();

        if (window.SmartBaraCore.canWriteCloud()) {
            try {
                const { id: rowId, period_name: p, ...values } = payload;
                await window.SmartBaraCore.syncVersionedRow(tableName, period, { id: rowId, period_name: period }, values, `budget:${rowId}`, 'Budget Plan');
                window.SmartBaraCore.showSyncStatus('Anggaran berhasil disimpan ke cloud', 'success');
            } catch(err) {
                console.warn('Sync budget error:', err);
                window.SmartBaraCore.showSyncStatus('Tersimpan lokal', 'info');
            }
        }
    }

    async function deleteItem(id) {
        if (!window.SmartBaraCore.canDeleteData()) {
            window.SmartBaraCore.showSyncStatus('Level akses akun ini tidak dapat menghapus anggaran.', 'error');
            return;
        }
        const item = items.find(it => it.id === id);
        if (!item) return;
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi hapus anggaran',
            message: `Hapus anggaran "${item.nama}"?`,
            confirmText: 'Hapus',
            cancelText: 'Batal',
            danger: true
        });
        if (!confirmed) return;

        const period = window.SmartBaraCore.getActivePeriod();
        const tableName = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
        const storageKey = budgetType === 'site' ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;

        const nextItems = items.filter(it => it.id !== id);
        items = nextItems;
        localStorage.setItem(storageKey, JSON.stringify(nextItems));
        renderTable();

        try {
            await window.SmartBaraCore.deleteVersionedRow(tableName, period, { id, period_name: period }, `budget:${id}`, 'Budget');
            window.SmartBaraCore.showSyncStatus('Anggaran dihapus dari cloud', 'success');
        } catch(err) {
            console.warn('Delete budget error:', err);
            if (!err.queuedForSync) {
                items = [...items, item];
                localStorage.setItem(storageKey, JSON.stringify(items));
                renderTable();
                window.SmartBaraCore.showSyncStatus(`Budget belum terhapus di cloud: ${err.message}`, 'error');
            }
        }
    }

    function setStatus(msg, isError = false) {
        const el = document.getElementById('budgetStatusText');
        if (el) {
            el.textContent = msg;
            el.className = `text-xs font-semibold ${isError ? 'text-rose-400' : 'text-slate-400'}`;
        }
    }

    async function deleteAll() {
        if (!window.SmartBaraCore.canDeleteData()) {
            window.SmartBaraCore.showSyncStatus('Level akses akun ini tidak dapat menghapus anggaran.', 'error');
            return;
        }
        if (!items.length) {
            await window.SmartBaraLayout.alertDialog({ title: 'Tidak ada data', message: 'Tidak ada budget untuk dihapus pada periode ini.', confirmText: 'OK' });
            return;
        }
        const period = window.SmartBaraCore.getActivePeriod();
        const tableName = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
        const storageKey = budgetType === 'site' ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Hapus semua budget',
            message: `Hapus semua ${items.length} baris budget pada periode ${period}? Tindakan ini tidak dapat dibatalkan.`,
            confirmText: 'Hapus Semua',
            cancelText: 'Batal',
            danger: true
        });
        if (!confirmed) return;

        const rowsToDelete = [...items];
        const deletedIds = new Set();
        let queuedCount = 0;
        const errors = [];
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        for (const item of rowsToDelete) {
            if (!uuidPattern.test(String(item.id || ''))) {
                deletedIds.add(item.id);
                continue;
            }
            try {
                await window.SmartBaraCore.deleteVersionedRow(tableName, period, { id: item.id, period_name: period }, `budget:${item.id}`, 'Budget');
                deletedIds.add(item.id);
            } catch (error) {
                if (error.queuedForSync) {
                    deletedIds.add(item.id);
                    queuedCount++;
                } else {
                    errors.push(error.message || String(error));
                }
            }
        }

        items = rowsToDelete.filter(item => !deletedIds.has(item.id));
        localStorage.setItem(storageKey, JSON.stringify(items));
        renderTable();
        if (errors.length) {
            window.SmartBaraCore.showSyncStatus(`${errors.length} budget gagal dihapus dari cloud: ${errors[0]}`, 'error');
        } else if (queuedCount) {
            window.SmartBaraCore.showSyncStatus(`${deletedIds.size} budget dihapus; ${queuedCount} menunggu sinkronisasi cloud.`, 'info');
        } else {
            window.SmartBaraCore.showSyncStatus('Semua budget berhasil dihapus dari cloud.', 'success');
        }
    }

    // ============================================================================
    // DOWNLOAD & UPLOAD TEMPLATE BUDGET (Excel)
    // ============================================================================

    async function downloadBudgetTemplate() {
        const period = window.SmartBaraCore.getActivePeriod();
        const label = budgetType === 'site' ? 'Budget Proyek' : 'Budget Akun';
        const tableName = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
        const storageKey = budgetType === 'site' ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;

        try {
            await window.SmartBaraConfig.ensureLibrary('sheetjs');

            // Ambil data dari items jika ada, jika tidak dari localStorage atau Supabase
            let rows = [];
            if (items && items.length) {
                rows = items.map(item => {
                    const bArr = Array.isArray(item.budget) ? item.budget : [];
                    const row = {
                        'Departemen': item.dept || '',
                        'Nama Akun / Proyek': item.nama || '',
                    };
                    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
                    for (let i = 0; i < 12; i++) {
                        row[monthNames[i]] = Number(bArr[i] || 0);
                    }
                    row['Total'] = bArr.reduce((s, v) => s + Number(v || 0), 0);
                    return row;
                });
            } else {
                // Coba dari localStorage
                try {
                    const cached = JSON.parse(localStorage.getItem(storageKey) || '[]');
                    if (Array.isArray(cached) && cached.length) {
                        rows = cached.map(item => {
                            const bArr = Array.isArray(item.budget) ? item.budget : [];
                            const row = {
                                'Departemen': item.dept || '',
                                'Nama Akun / Proyek': item.nama || '',
                            };
                            const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
                            for (let i = 0; i < 12; i++) {
                                row[monthNames[i]] = Number(bArr[i] || 0);
                            }
                            row['Total'] = bArr.reduce((s, v) => s + Number(v || 0), 0);
                            return row;
                        });
                    }
                } catch (e) {}

                // Coba dari Supabase jika localStorage kosong
                if (!rows.length) {
                    const client = window.SmartBaraCore.getClient();
                    if (client) {
                        const { data, error } = await client.from(tableName).select('*').eq('period_name', period);
                        if (!error && Array.isArray(data) && data.length) {
                            rows = data.map(item => {
                                const bArr = Array.isArray(item.budget) ? item.budget : [];
                                const row = {
                                    'Departemen': item.dept || '',
                                    'Nama Akun / Proyek': item.nama || '',
                                };
                                const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
                                for (let i = 0; i < 12; i++) {
                                    row[monthNames[i]] = Number(bArr[i] || 0);
                                }
                                row['Total'] = bArr.reduce((s, v) => s + Number(v || 0), 0);
                                return row;
                            });
                        }
                    }
                }
            }

            // Jika masih kosong, buat template kosong dengan header saja
            if (!rows.length) {
                rows = [{
                    'Departemen': '',
                    'Nama Akun / Proyek': '',
                    'Januari': 0, 'Februari': 0, 'Maret': 0, 'April': 0, 'Mei': 0, 'Juni': 0,
                    'Juli': 0, 'Agustus': 0, 'September': 0, 'Oktober': 0, 'November': 0, 'Desember': 0,
                    'Total': 0
                }];
            }

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Template Budget');
            XLSX.writeFile(workbook, `Template_Budget_${label}_${window.SMART_BARA_CONFIG?.APP_VERSION || '7.10'}_${period}.xlsx`);
            window.SmartBaraCore.showSyncStatus(`Template budget ${label} periode ${period} berhasil diunduh (${rows.length} baris).`, 'success');
        } catch (err) {
            console.error('Download budget template error:', err);
            window.SmartBaraCore.showSyncStatus(`Gagal unduh template: ${err.message}`, 'error');
        }
    }

    async function uploadBudgetTemplate(fileInput) {
        const period = window.SmartBaraCore.getActivePeriod();
        const tableName = budgetType === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
        const storageKey = budgetType === 'site' ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;

        if (!window.SmartBaraCore.canWriteData()) {
            setStatus('Level akses Viewer hanya dapat membaca anggaran.', true);
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

        const kode = prompt('Masukkan kode verifikasi unggah budget:');
        if (kode !== 'HARIZALGANTENG') {
            setStatus('Kode verifikasi salah. Unggah budget dibatalkan.', true);
            if (fileInput) fileInput.value = '';
            return;
        }

        const loadingTask = window.SmartBaraLayout?.beginLoading('Unggah Budget', 'Membaca file template budget...');
        let success = false;

        try {
            await window.SmartBaraConfig.ensureLibrary('sheetjs');
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (!json.length) {
                throw new Error('File template kosong.');
            }

            const monthNames = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
            const imported = [];

            for (let i = 0; i < json.length; i++) {
                const row = json[i];
                const nama = String(row['Nama Akun / Proyek'] || row['nama'] || row['Nama'] || '').trim();
                const dept = String(row['Departemen'] || row['dept'] || row['Department'] || 'UMUM').trim().toUpperCase();
                if (!nama) continue;

                const budget = [];
                for (let m = 0; m < 12; m++) {
                    const monthKey = monthNames[m];
                    const colVal = row[monthKey.charAt(0).toUpperCase() + monthKey.slice(1)] ||
                                   row[monthKey] ||
                                   row[`B${m + 1}`] ||
                                   row[`bulan_${m + 1}`] ||
                                   0;
                    budget.push(Number(colVal || 0));
                }

                const id = crypto.randomUUID();
                imported.push({
                    id,
                    period_name: period,
                    nama,
                    dept,
                    budget,
                    updated_at: new Date().toISOString()
                });
            }

            if (!imported.length) {
                throw new Error('Tidak ada data budget valid yang dapat diimpor.');
            }

            // Simpan ke localStorage
            const existing = JSON.parse(localStorage.getItem(storageKey) || '[]');
            const nextItems = [...existing, ...imported];
            localStorage.setItem(storageKey, JSON.stringify(nextItems));
            items = nextItems.map(normalizeBudgetItem);
            renderTable();

            // Simpan ke Supabase (delete lama, insert baru)
            await client.from(tableName).delete().eq('period_name', period);
            for (let offset = 0; offset < imported.length; offset += 200) {
                const batch = imported.slice(offset, offset + 200).map(it => {
                    const clean = { ...it };
                    delete clean.id;
                    return clean;
                });
                const { error } = await client.from(tableName).insert(batch);
                if (error) throw error;
            }

            success = true;
            setStatus(`${imported.length} baris budget berhasil diunggah ke periode ${period}.`);
            window.SmartBaraCore.showSyncStatus(`Budget template ${imported.length} baris tersimpan ke cloud.`, 'success');
            if (fileInput) fileInput.value = '';
        } catch (err) {
            console.error('Upload budget template error:', err);
            setStatus(`Gagal unggah budget: ${err.message}`, true);
            window.SmartBaraCore.showSyncStatus(`Gagal unggah budget: ${err.message}`, 'error');
            if (fileInput) fileInput.value = '';
        } finally {
            window.SmartBaraLayout?.endLoading(loadingTask, success);
        }
    }

    return { init, renderTable, openForm, closeForm, saveForm, deleteItem, deleteAll, copyFromPeriod, downloadBudgetTemplate, uploadBudgetTemplate };
})();

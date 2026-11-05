// ==============================================================================
// SMART BARA 7.10 HZ - MONTHLY REPORT MODULE
// Monthly Financial Consolidation, Cash Flow Breakdown & Interactive Visuals
// ==============================================================================

window.MonthlyModule = (function() {
    let allTransactions = [];
    let activePeriod = '2026';
    let selectedMonth = ''; // '' = all months, '1'..'12'
    let expandedAkuns = new Set();
    let monthlyChart = null;
    let monthlyStatusPrefix = 'Tersinkron';
    let accountBudgets = [];
    let projectBudgets = [];
    const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];

    const MONTH_NAMES = [
        'Semua Bulan', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    function getTransactionField(transaction, names) {
        const entries = Object.entries(transaction || {});
        for (const name of names) {
            const normalizedName = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
            const entry = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName);
            if (entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '') return entry[1];
        }
        return undefined;
    }

    function getTransactionNumber(transaction, names) {
        const value = getTransactionField(transaction, names);
        return value === undefined ? 0 : SmartBaraFormatters.parseNumber(value, 0);
    }

    async function init() {
        activePeriod = SmartBaraCore.getActivePeriod();
        window.addEventListener('smartbara:period_change', event => {
            activePeriod = event.detail?.period || SmartBaraCore.getActivePeriod();
            loadData();
        });
        window.addEventListener('smartbara:dept_filter_change', () => loadData());
        SmartBaraCore.onRealtimeChange(payload => {
            if (['smartbara_store', 'smartbara_budget', 'smartbara_budget_site'].includes(payload.table)) loadData();
        });
        await loadData();
        bindEvents();
    }

    async function loadData() {
        const statusEl = document.getElementById('monthlyStatus');
        activePeriod = SmartBaraCore.getActivePeriod();
        monthlyStatusPrefix = 'Memuat data';
        if (statusEl) statusEl.textContent = 'Mengkonsolidasi laporan bulanan...';

        try {
            allTransactions = SmartBaraCore.getAllTransactions().map(item => {
                const normalizedDate = SmartBaraFormatters.normalizeDate(getTransactionField(item, ['tanggal', 'date']));
                const monthMatch = normalizedDate?.match(/^\d{4}-(\d{2})-\d{2}$/);
                const debit = getTransactionNumber(item, ['debit', 'debet']);
                const kredit = getTransactionNumber(item, ['kredit', 'credit']);
                const financeValue = getTransactionField(item, ['finance']);
                const reconcileValue = getTransactionField(item, ['rekonsil', 'nilai rekonsil', 'nilai rekonsiliasi', 'reconcile']);
                const finance = financeValue !== undefined ? SmartBaraFormatters.parseNumber(financeValue, 0) : debit - kredit;
                const rekonsil = reconcileValue !== undefined ? SmartBaraFormatters.parseNumber(reconcileValue, 0) : finance;
                return {
                    ...item,
                    nama_akun: String(getTransactionField(item, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'nama akun up', 'nama akun induk', 'nama akun', 'akun']) || 'Lain-lain'),
                    proyek: String(getTransactionField(item, ['proyek_manual', '_calcProyek', '_proyekOverride', 'nama proyek up', 'nama proyek', 'proyek']) || 'Operasional Umum'),
                    dept: String(getTransactionField(item, ['dept', '_department', 'nama dept', 'departemen']) || 'UMUM'),
                    tanggal: normalizedDate || '',
                    monthNum: monthMatch ? Number(monthMatch[1]) : 0,
                    debit,
                    kredit,
                    finance,
                    adj_finance: getTransactionNumber(item, ['adj_finance']),
                    rekonsil,
                    adj_rekonsil: getTransactionNumber(item, ['adj_rekonsil']),
                    selisih: finance + getTransactionNumber(item, ['adj_finance']) - rekonsil - getTransactionNumber(item, ['adj_rekonsil']),
                    keterangan: String(getTransactionField(item, ['keterangan', 'deskripsi', 'uraian']) || ''),
                    catatan: String(getTransactionField(item, ['catatan', 'note']) || '')
                };
            }).filter(item => {
                const activeYear = Number(String(activePeriod).match(/\d{4}/)?.[0]);
                const transactionYear = Number(item.tanggal.slice(0, 4));
                return !activeYear || !transactionYear || transactionYear === activeYear;
            });

            await loadBudgetData(activePeriod);

            renderTable();
            await renderChart();

            monthlyStatusPrefix = 'Tersinkron';
            updateMonthlyStatus();
        } catch(err) {
            console.error('Monthly report load error:', err);
            monthlyStatusPrefix = 'Gagal memuat dari cloud';
            updateMonthlyStatus();
        }
    }

    async function loadBudgetData(period) {
        const accountKey = `smartbara_budget_v2_${period}`;
        const projectKey = `smartbara_budget_site_v2_${period}`;
        accountBudgets = readBudgetCache(accountKey);
        projectBudgets = readBudgetCache(projectKey);
        const client = SmartBaraCore.getClient();
        if (!client) return;

        try {
            const [accountResult, projectResult] = await Promise.all([
                client.from('smartbara_budget').select('*').eq('period_name', period),
                client.from('smartbara_budget_site').select('*').eq('period_name', period)
            ]);
            if (accountResult.error) throw accountResult.error;
            if (projectResult.error) throw projectResult.error;
            accountBudgets = Array.isArray(accountResult.data) ? accountResult.data : [];
            projectBudgets = Array.isArray(projectResult.data) ? projectResult.data : [];
            localStorage.setItem(accountKey, JSON.stringify(accountBudgets));
            localStorage.setItem(projectKey, JSON.stringify(projectBudgets));
        } catch (error) {
            console.warn('Monthly budget cloud load failed; using local cache:', error);
        }
    }

    function readBudgetCache(key) {
        try {
            const rows = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch (error) {
            return [];
        }
    }

    function getBudgetRowsForSelectedDepartments(rows) {
        if (SmartBaraCore.isCombinedDepartments()) return rows;
        const selectedDepartments = new Set(
            SmartBaraCore.getSelectedDepartments().map(department => String(department || '').trim().toUpperCase())
        );
        return rows.filter(row => {
            const department = String(getTransactionField(row, ['dept', 'departemen', 'department', 'dept_name']) || 'UMUM')
                .trim()
                .toUpperCase();
            return selectedDepartments.has(department);
        });
    }

    function getBudgetTotal(rows, name, month = selectedMonth) {
        const normalizedName = String(name || '').trim().toLocaleLowerCase('id-ID');
        if (!normalizedName) return 0;
        return getBudgetRowsForSelectedDepartments(rows).reduce((total, row) => {
            const rowName = String(getTransactionField(row, ['nama', 'nama_akun', 'nama_proyek_up', 'nama_proyek', 'account_name', 'project_name']) || '')
                .trim()
                .toLocaleLowerCase('id-ID');
            if (rowName !== normalizedName) return total;
            const values = Array.isArray(row.budget)
                ? row.budget
                : MONTH_KEYS.map(monthKey => row[`budget_${monthKey}`]);
            const budget = month
                ? SmartBaraFormatters.parseNumber(values[Number(month) - 1], 0)
                : values.reduce((sum, value) => sum + SmartBaraFormatters.parseNumber(value, 0), 0);
            return total + budget;
        }, 0);
    }

    function getFilteredTransactions() {
        const monthVal = document.getElementById('monthlyMonthSelect')?.value || '';
        selectedMonth = monthVal;
        const search = (document.getElementById('monthlySearch')?.value || '').toLowerCase();

        return allTransactions.filter(t => {
            const matchesMonth = !selectedMonth || String(t.monthNum) === selectedMonth;
            const matchesSearch = !search ||
                (t.nama_akun && t.nama_akun.toLowerCase().includes(search)) ||
                (t.proyek && t.proyek.toLowerCase().includes(search)) ||
                (t.dept && t.dept.toLowerCase().includes(search)) ||
                (t.keterangan && t.keterangan.toLowerCase().includes(search));

            return matchesMonth && matchesSearch;
        });
    }

    function updateMonthlyStatus() {
        const statusEl = document.getElementById('monthlyStatus');
        if (!statusEl) return;
        const filtered = getFilteredTransactions();
        const accountCount = new Set(filtered.map(transaction => transaction.nama_akun || 'Lain-lain')).size;
        const scope = selectedMonth ? MONTH_NAMES[Number(selectedMonth)] : 'semua bulan';
        statusEl.textContent = `${monthlyStatusPrefix} · ${filtered.length.toLocaleString('id-ID')} transaksi ${scope} · ${accountCount.toLocaleString('id-ID')} akun`;
    }

    function renderKPIs() {
        const filtered = getFilteredTransactions();

        let totalDebit = 0;
        let totalKredit = 0;
        let totalFinance = 0;
        let totalRekonsil = 0;
        let totalSelisih = 0;

        filtered.forEach(t => {
            totalDebit += t.debit;
            totalKredit += t.kredit;
            totalFinance += (t.finance + t.adj_finance);
            totalRekonsil += (t.rekonsil + t.adj_rekonsil);
            totalSelisih += t.selisih;
        });

        setElText('monthlyKpiDebit', SmartBaraFormatters.formatRupiah(totalDebit));
        setElText('monthlyKpiKredit', SmartBaraFormatters.formatRupiah(totalKredit));
        setElText('monthlyKpiFinance', SmartBaraFormatters.formatRupiah(totalFinance));
        setElText('monthlyKpiRekonsil', SmartBaraFormatters.formatRupiah(totalRekonsil));
        setElText('monthlyKpiSelisih', SmartBaraFormatters.formatRupiah(totalSelisih));
    }

    function setElText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function renderTable() {
        const tbody = document.getElementById('monthlyTableBody');
        if (!tbody) return;

        renderKPIs();
        const filtered = getFilteredTransactions();
        updateMonthlyStatus();

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="12" class="p-8 text-center text-slate-500">
                        Tidak ada transaksi untuk periode dan filter yang dipilih.
                    </td>
                </tr>
            `;
            return;
        }

        // Group hierarchical by Akun -> Proyek
        const tree = {};
        filtered.forEach(t => {
            const akun = t.nama_akun || t.akun || 'Lain-lain';
            const proyek = t.proyek || 'Operasional Umum';

            if (!tree[akun]) {
                tree[akun] = {
                    nama_akun: akun,
                    debit: 0, kredit: 0,
                    finance: 0, adj_finance: 0,
                    rekonsil: 0, adj_rekonsil: 0,
                    selisih: 0,
                    proyeks: {}
                };
            }

            const aNode = tree[akun];
            aNode.debit += t.debit;
            aNode.kredit += t.kredit;
            aNode.finance += t.finance;
            aNode.adj_finance += t.adj_finance;
            aNode.rekonsil += t.rekonsil;
            aNode.adj_rekonsil += t.adj_rekonsil;
            aNode.selisih += t.selisih;

            if (!aNode.proyeks[proyek]) {
                aNode.proyeks[proyek] = {
                    nama_proyek: proyek,
                    debit: 0, kredit: 0,
                    finance: 0, adj_finance: 0,
                    rekonsil: 0, adj_rekonsil: 0,
                    selisih: 0,
                    items: []
                };
            }

            const pNode = aNode.proyeks[proyek];
            pNode.debit += t.debit;
            pNode.kredit += t.kredit;
            pNode.finance += t.finance;
            pNode.adj_finance += t.adj_finance;
            pNode.rekonsil += t.rekonsil;
            pNode.adj_rekonsil += t.adj_rekonsil;
            pNode.selisih += t.selisih;
            pNode.items.push(t);
        });

        const html = [];
        Object.keys(tree).sort().forEach(akunKey => {
            const aNode = tree[akunKey];
            const isExpanded = expandedAkuns.has(akunKey);
            const pCount = Object.keys(aNode.proyeks).length;

            html.push(`
                <tr class="bg-slate-900/80 hover:bg-slate-800/80 cursor-pointer border-b border-white/10 font-bold transition" onclick="MonthlyModule.toggleExpand('${akunKey}')">
                    <td class="font-black text-teal-300 py-3 flex items-center gap-2">
                        <span>${isExpanded ? '▼' : '▶'}</span>
                        <span>${SmartBaraFormatters.escapeHtml(aNode.nama_akun)}</span>
                        <span class="badge badge-teal text-[10px] ml-2">${pCount} Proyek</span>
                    </td>
                    <td class="text-slate-400 text-xs">-</td>
                    <td class="text-slate-400 text-xs">-</td>
                    <td class="text-right tabular-nums text-amber-300">${SmartBaraFormatters.formatRupiah(getBudgetTotal(accountBudgets, aNode.nama_akun))}</td>
                    <td class="text-right tabular-nums text-slate-300">${SmartBaraFormatters.formatRupiah(aNode.debit)}</td>
                    <td class="text-right tabular-nums text-slate-300">${SmartBaraFormatters.formatRupiah(aNode.kredit)}</td>
                    <td class="text-right tabular-nums text-blue-400 bg-blue-950/20">${SmartBaraFormatters.formatRupiah(aNode.finance)}</td>
                    <td class="text-right tabular-nums text-blue-300">${SmartBaraFormatters.formatRupiah(aNode.adj_finance)}</td>
                    <td class="text-right tabular-nums text-purple-400 bg-purple-950/20">${SmartBaraFormatters.formatRupiah(aNode.rekonsil)}</td>
                    <td class="text-right tabular-nums text-purple-300">${SmartBaraFormatters.formatRupiah(aNode.adj_rekonsil)}</td>
                    <td class="text-right tabular-nums font-black text-rose-400 bg-rose-950/20">${SmartBaraFormatters.formatRupiah(aNode.selisih)}</td>
                    <td class="text-xs text-slate-400">-</td>
                </tr>
            `);

            if (isExpanded) {
                Object.keys(aNode.proyeks).sort().forEach(proyekKey => {
                    const pNode = aNode.proyeks[proyekKey];
                    html.push(`
                        <tr class="bg-slate-950/40 hover:bg-slate-900/40 border-b border-white/5 transition text-xs">
                            <td class="pl-8 text-white font-semibold flex items-center gap-2">
                                <span class="text-slate-500">↳</span>
                                <span>${SmartBaraFormatters.escapeHtml(pNode.nama_proyek)}</span>
                                <span class="text-[10px] text-slate-500">(${pNode.items.length} tx)</span>
                            </td>
                            <td class="text-slate-400">${SmartBaraFormatters.escapeHtml(pNode.items[0]?.dept || '-')}</td>
                            <td class="text-slate-400 font-mono text-[10px]">${pNode.items.length} transaksi</td>
                            <td class="text-right tabular-nums text-amber-300">${SmartBaraFormatters.formatRupiah(getBudgetTotal(projectBudgets, pNode.nama_proyek))}</td>
                            <td class="text-right tabular-nums text-slate-300">${SmartBaraFormatters.formatRupiah(pNode.debit)}</td>
                            <td class="text-right tabular-nums text-slate-300">${SmartBaraFormatters.formatRupiah(pNode.kredit)}</td>
                            <td class="text-right tabular-nums text-blue-400">${SmartBaraFormatters.formatRupiah(pNode.finance)}</td>
                            <td class="text-right tabular-nums text-blue-300">${SmartBaraFormatters.formatRupiah(pNode.adj_finance)}</td>
                            <td class="text-right tabular-nums text-purple-400">${SmartBaraFormatters.formatRupiah(pNode.rekonsil)}</td>
                            <td class="text-right tabular-nums text-purple-300">${SmartBaraFormatters.formatRupiah(pNode.adj_rekonsil)}</td>
                            <td class="text-right tabular-nums font-bold text-rose-400">${SmartBaraFormatters.formatRupiah(pNode.selisih)}</td>
                            <td class="text-xs text-slate-400 truncate max-w-xs">${SmartBaraFormatters.escapeHtml(pNode.items[0]?.catatan || '-')}</td>
                        </tr>
                    `);
                });
            }
        });

        tbody.innerHTML = html.join('');
    }

    function toggleExpand(akun) {
        if (expandedAkuns.has(akun)) {
            expandedAkuns.delete(akun);
        } else {
            expandedAkuns.add(akun);
        }
        renderTable();
    }

    async function renderChart() {
        await SmartBaraConfig.ensureLibrary('chartjs');
        if (typeof Chart === 'undefined') return;

        const canvas = document.getElementById('monthlyChartCanvas');
        if (!canvas) return;

        // Group finance and reconcile by 12 months
        const finMonthly = new Array(12).fill(0);
        const recMonthly = new Array(12).fill(0);
        const accountBudgetMonthly = new Array(12).fill(0);
        const projectBudgetMonthly = new Array(12).fill(0);

        allTransactions.forEach(t => {
            if (t.monthNum < 1 || t.monthNum > 12) return;
            const mIdx = t.monthNum - 1;
            finMonthly[mIdx] += (t.finance + t.adj_finance);
            recMonthly[mIdx] += (t.rekonsil + t.adj_rekonsil);
        });

        [
            [getBudgetRowsForSelectedDepartments(accountBudgets), accountBudgetMonthly],
            [getBudgetRowsForSelectedDepartments(projectBudgets), projectBudgetMonthly]
        ].forEach(([rows, monthlyTotals]) => {
            rows.forEach(row => {
                const values = Array.isArray(row.budget)
                    ? row.budget
                    : MONTH_KEYS.map(monthKey => row[`budget_${monthKey}`]);
                values.slice(0, 12).forEach((value, index) => {
                    monthlyTotals[index] += SmartBaraFormatters.parseNumber(value, 0);
                });
            });
        });

        const ctx = canvas.getContext('2d');
        if (monthlyChart) monthlyChart.destroy();

        monthlyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
                datasets: [
                    {
                        label: 'Nilai Finance',
                        data: finMonthly,
                        backgroundColor: 'rgba(59, 130, 246, 0.7)',
                        borderColor: '#3B82F6',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Nilai Rekonsil',
                        data: recMonthly,
                        backgroundColor: 'rgba(168, 85, 247, 0.7)',
                        borderColor: '#A855F7',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Budget Akun',
                        data: accountBudgetMonthly,
                        backgroundColor: 'rgba(245, 158, 11, 0.7)',
                        borderColor: '#F59E0B',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Budget Proyek',
                        data: projectBudgetMonthly,
                        backgroundColor: 'rgba(20, 184, 166, 0.7)',
                        borderColor: '#14B8A6',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (_event, elements) => {
                    if (!elements.length) return;
                    const monthSelect = document.getElementById('monthlyMonthSelect');
                    if (!monthSelect) return;
                    monthSelect.value = String(elements[0].index + 1);
                    renderTable();
                },
                plugins: {
                    legend: {
                        labels: { color: '#94A3B8', font: { family: 'Plus Jakarta Sans', weight: 'bold' } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${SmartBaraFormatters.formatRupiah(ctx.raw || 0)}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94A3B8' }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#94A3B8',
                            callback: (v) => SmartBaraFormatters.formatRupiah(v)
                        }
                    }
                }
            }
        });
    }

    async function exportToExcel() {
        await SmartBaraConfig.ensureLibrary('exceljs');
        if (typeof ExcelJS === 'undefined') {
            alert('Modul ExcelJS sedang dimuat, coba sesaat lagi.');
            return;
        }

        const filtered = getFilteredTransactions();
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(`Monthly Report ${activePeriod}`);

        sheet.mergeCells('A1:J1');
        sheet.getCell('A1').value = `LAPORAN REKONSIL BULANAN (${activePeriod}) - ${selectedMonth ? MONTH_NAMES[parseInt(selectedMonth)] : 'Semua Bulan'}`;
        sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
        sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
        sheet.getRow(1).height = 30;

        const headers = ['Bulan', 'Nama Akun', 'Departemen', 'Proyek UP', 'Debit', 'Kredit', 'Finance Final', 'Rekonsil Final', 'Selisih', 'Catatan'];
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        headerRow.height = 24;

        filtered.forEach(t => {
            const mName = (t.monthNum >= 1 && t.monthNum <= 12) ? MONTH_NAMES[t.monthNum] : '-';
            const r = sheet.addRow([
                mName,
                t.nama_akun || t.akun || '',
                t.dept || '',
                t.proyek || '',
                t.debit || 0,
                t.kredit || 0,
                (t.finance + t.adj_finance) || 0,
                (t.rekonsil + t.adj_rekonsil) || 0,
                t.selisih || 0,
                t.catatan || ''
            ]);
            for (let c = 5; c <= 9; c++) {
                r.getCell(c).numFmt = '#,##0';
            }
        });

        sheet.columns = [
            { width: 14 }, { width: 30 }, { width: 18 }, { width: 22 },
            { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 30 }
        ];

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SmartBARA_Monthly_Report_${activePeriod}_${selectedMonth || 'All'}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function bindEvents() {
        window.addEventListener('smartbara:period_change', (e) => {
            activePeriod = e.detail?.period || SmartBaraCore.getActivePeriod();
            loadData();
        });
    }

    return {
        init,
        renderTable,
        toggleExpand,
        exportToExcel
    };
})();

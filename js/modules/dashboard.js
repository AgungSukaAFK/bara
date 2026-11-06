// ==============================================================================
// SMART BARA 7.10 HZ - DASHBOARD UTAMA MODULE
// ==============================================================================

window.DashboardModule = (function() {
    let latestTopLists = { budget: [], finance: [], reconcile: [], variance: [] };
    let futureBudgetBaselineSource = 'budget';
    let presentationMonthlyChart = null;
    let presentationAnalysisSequence = 0;
    let dashboardMetricsPromise = null;
    let dashboardMetricsRefreshRequested = false;
    const presentationSlideOrder = [
        'briefing', 'kpi-overview', 'monthly-trend', 'budget-finance', 'pareto',
        'reconcile-top', 'budget-analysis', 'smart-asset', 'conclusion', 'thank-you'
    ];

    function parseCurrencyText(value) {
        if (value === null || value === undefined) return 0;
        const digits = String(value).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
        return Number(digits || 0);
    }

    function getElapsedMonthsForPeriod(periodText = '') {
        const text = String(periodText || '').toLowerCase();
        const monthNames = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
        for (let i = 0; i < monthNames.length; i++) {
            if (text.includes(monthNames[i])) return i + 1;
        }
        return 12;
    }

    function bindMetricClicks() {
        const cards = document.querySelectorAll('.metric-card, .dashboard-overview-card');
        cards.forEach(card => {
            card.addEventListener('click', (event) => {
                if (event.target.closest('button')) return;
                event.preventDefault();
                showMetricDetail(card.dataset.metric);
            });
        });
        const closeBtn = document.getElementById('dashboardMetricClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                const modal = document.getElementById('dashboardMetricModal');
                if (modal) modal.classList.add('hidden');
            });
        }
        const modal = document.getElementById('dashboardMetricModal');
        if (modal) {
            modal.addEventListener('click', (event) => {
                if (event.target === modal) modal.classList.add('hidden');
            });
        }

        const presentationBtn = document.getElementById('dashboardPresentasiLiveBtn');
        if (presentationBtn) {
            presentationBtn.addEventListener('click', (event) => DashboardModule.openPresentationDeck(event));
        }

        const exportBtn = document.getElementById('dashboardExportPptBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => DashboardModule.exportPresentationDeck());
        }

        const presentationModal = document.getElementById('dashboardPresentationModal');
        if (presentationModal) {
            presentationModal.addEventListener('click', (event) => {
                if (event.target === presentationModal) presentationModal.classList.add('hidden');
            });
        }

        const presentationClose = document.getElementById('dashboardPresentationClose');
        if (presentationClose) {
            presentationClose.addEventListener('click', () => {
                const modal = document.getElementById('dashboardPresentationModal');
                if (document.fullscreenElement === modal) document.exitFullscreen?.();
                modal?.classList.remove('presentation-fullscreen');
                if (modal) modal.classList.add('hidden');
            });
        }

        const presentationFullscreen = document.getElementById('dashboardPresentationFullscreen');
        const updatePresentationFullscreen = (isFullscreen) => {
            if (!presentationModal || !presentationFullscreen) return;
            presentationModal.classList.toggle('presentation-fullscreen', isFullscreen);
            presentationFullscreen.textContent = isFullscreen ? '⤡' : '⛶';
            presentationFullscreen.setAttribute('aria-label', isFullscreen ? 'Keluar dari layar penuh' : 'Masuk layar penuh');
            presentationFullscreen.title = isFullscreen ? 'Keluar dari layar penuh' : 'Masuk layar penuh';
            presentationMonthlyChart?.resize();
        };
        if (presentationFullscreen && presentationModal) {
            presentationFullscreen.addEventListener('click', async () => {
                try {
                    if (document.fullscreenElement === presentationModal) {
                        await document.exitFullscreen();
                    } else if (presentationModal.requestFullscreen) {
                        await presentationModal.requestFullscreen();
                    } else {
                        updatePresentationFullscreen(!presentationModal.classList.contains('presentation-fullscreen'));
                    }
                } catch (error) {
                    console.warn('Fullscreen presentation unavailable:', error);
                }
            });
            document.addEventListener('fullscreenchange', () => {
                updatePresentationFullscreen(document.fullscreenElement === presentationModal);
            });
        }
    }

    function formatPercent(value) {
        if (!Number.isFinite(Number(value))) return '0%';
        const num = Number(value);
        return `${Math.abs(num).toFixed(1)}%`;
    }

    function safeParseNumber(value) {
        if (value === null || value === undefined || value === '') return 0;
        const cleaned = String(value).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
        const numeric = Number(cleaned || 0);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    async function fetchAssetSummary() {
        const assetUrls = [
            'smart-asset-project/data.json',
            '/smart-asset-project/data.json',
            '/smart-asset/data.json',
            'smart-asset-project/db.json',
            '/smart-asset-project/db.json'
        ];

        for (const assetUrl of assetUrls) {
            try {
                const response = await fetch(assetUrl, { cache: 'no-store' });
                if (!response.ok) continue;
                const payload = await response.json();
                const entries = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data) ? payload.data : [];
                if (!entries.length) continue;
                const categoryMap = new Map();
                const assetRows = entries.map((item, index) => {
                    const type = String(item.tipe || item.type || 'Aset').trim() || 'Aset';
                    const value = safeParseNumber(item.harga ?? item.price ?? item.total ?? item.nilai ?? 0);
                    const category = categoryMap.get(type) || { type, count: 0, value: 0 };
                    category.count += 1;
                    category.value += value;
                    categoryMap.set(type, category);
                    return {
                        name: String(item.nama || item.name || item.asset_name || `Aset ${index + 1}`),
                        type,
                        value
                    };
                });
                const total = assetRows.reduce((sum, item) => sum + item.value, 0);
                const categories = [...categoryMap.values()]
                    .map(category => ({ ...category, pct: total > 0 ? (category.value / total) * 100 : 0 }))
                    .sort((left, right) => right.value - left.value);
                const topAssets = [...assetRows].sort((left, right) => right.value - left.value).slice(0, 5);
                return {
                    total,
                    count: entries.length,
                    averageValue: entries.length ? total / entries.length : 0,
                    types: categories.slice(0, 4).map(category => category.type),
                    categories,
                    topAssets,
                    latest: entries[0]?.nama || 'Smart Asset'
                };
            } catch (error) {
                continue;
            }
        }

        return { total: 0, count: 0, averageValue: 0, types: ['Aset'], categories: [], topAssets: [], latest: 'Smart Asset' };
    }

    async function buildPresentationContext() {
        await loadDashboardMetrics(true);
        const activePeriod = window.SmartBaraCore.getActivePeriod();
        const selectedDepartments = window.SmartBaraCore.getSelectedDepartments();
        const currentUser = window.SmartBaraCore.getUser();
        const userMetadata = currentUser?.user_metadata || {};
        const presenterName = userMetadata.full_name || userMetadata.fullName || userMetadata.name || userMetadata.display_name || String(currentUser?.email || '').split('@')[0] || 'Pengguna';
        const budgetPlan = safeParseNumber(document.getElementById('dashBudgetTotal')?.textContent || '0');
        const financeTotal = safeParseNumber(document.getElementById('dashFinanceTotal')?.textContent || '0');
        const reconcileTotal = safeParseNumber(document.getElementById('dashReconcileTotal')?.textContent || '0');
        const futureBudget = safeParseNumber(document.getElementById('dashFutureBudgetTotal')?.textContent || '0');
        const creatorTotal = safeParseNumber(document.getElementById('dashCreatorTotal')?.textContent || '0');
        const varianceTotal = safeParseNumber(document.getElementById('dashSelisihTotal')?.textContent || '0');
        const approvalStatus = document.getElementById('dashApprovalStatus')?.textContent || 'Belum disetujui';
        const approvalBadge = document.getElementById('dashApprovalBadge')?.textContent || 'Pending';
        const healthScore = Number(document.getElementById('dashHealthScore')?.textContent || 0);
        const activeDepts = Number(document.getElementById('dashActiveDepts')?.textContent || 0);
        const transactionCount = Number((document.getElementById('dashTransactionsCount')?.textContent || '0').replace(/[^0-9]/g, '')) || 0;
        const dataQuality = document.getElementById('dashDataQuality')?.textContent || 'Belum ada data';
        const planGrowth = budgetPlan ? ((futureBudget - budgetPlan) / budgetPlan) * 100 : 0;
        const hasGaDepartment = selectedDepartments.some(department => String(department || '').trim().toUpperCase() === 'GA');
        const assetSummary = await fetchAssetSummary();

        return {
            activePeriod,
            selectedDepartments,
            hasGaDepartment,
            scopeLabel: selectedDepartments.length > 1 || selectedDepartments.includes('ALL') ? 'Semua Departemen' : selectedDepartments.join(', '),
            presenterName,
            budgetPlan,
            financeTotal,
            reconcileTotal,
            futureBudget,
            creatorTotal,
            varianceTotal,
            planGrowth,
            approvalStatus,
            approvalBadge,
            assetSummary,
            healthScore,
            activeDepts,
            transactionCount,
            dataQuality,
            generatedAt: new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })
        };
    }

    function buildMonthlyTrendSeries(context) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const base = Math.max(context.budgetPlan / 12, 1);
        const growthFactor = Math.max(1, 1 + (Math.max(context.planGrowth, 0) / 100));
        return monthNames.map((month, index) => {
            const seasonal = [0.72, 0.88, 0.96, 1.02, 1.08, 1.12, 1.16, 1.18, 1.14, 1.2, 1.1, 1.28][index];
            const value = Math.max(0, (base * seasonal * (0.82 + (index / 12))) * growthFactor);
            return { month, value };
        });
    }

    function buildMonthlyFinanceVsReconcileSeries(context) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const monthly = monthNames.map(month => ({ month, finance: 0, reconcile: 0 }));
        const activeYear = Number(String(context.activePeriod || '').match(/\d{4}/)?.[0]) || 0;
        const getField = (transaction, names) => {
            const entries = Object.entries(transaction || {});
            for (const name of names) {
                const normalizedName = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
                const entry = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName);
                if (entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '') return entry[1];
            }
            return undefined;
        };
        const getNumber = (transaction, names) => {
            const value = getField(transaction, names);
            return value === undefined ? 0 : window.SmartBaraFormatters.parseNumber(value, 0);
        };

        (window.SmartBaraCore.getAllTransactions() || []).forEach((transaction) => {
            const date = window.SmartBaraFormatters.normalizeDate(getField(transaction, ['tanggal', 'date']));
            const dateMatch = date?.match(/^(\d{4})-(\d{2})-\d{2}$/);
            const transactionYear = dateMatch ? Number(dateMatch[1]) : 0;
            if (activeYear && transactionYear && transactionYear !== activeYear) return;
            const monthIndex = dateMatch ? Number(dateMatch[2]) - 1 : -1;
            if (monthIndex < 0 || monthIndex > 11) return;

            const debit = getNumber(transaction, ['debit', 'debet']);
            const credit = getNumber(transaction, ['kredit', 'credit']);
            const financeValue = getField(transaction, ['finance']);
            const reconcileValue = getField(transaction, ['rekonsil', 'nilai rekonsil', 'nilai rekonsiliasi', 'reconcile']);
            const finance = financeValue !== undefined ? window.SmartBaraFormatters.parseNumber(financeValue, 0) : debit - credit;
            const reconcile = reconcileValue !== undefined ? window.SmartBaraFormatters.parseNumber(reconcileValue, 0) : finance;
            monthly[monthIndex].finance += finance + getNumber(transaction, ['adj_finance']);
            monthly[monthIndex].reconcile += reconcile + getNumber(transaction, ['adj_rekonsil']);
        });

        return monthly;
    }

    function buildMonthlyBudgetPlanSeries(context) {
        const monthKeys = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
        let rows = Array.isArray(window.__smartbaraBudgetRows) ? window.__smartbaraBudgetRows : [];
        if (!rows.length) {
            try {
                rows = JSON.parse(localStorage.getItem(`smartbara_budget_v2_${context.activePeriod}`) || '[]');
            } catch (error) {
                rows = [];
            }
        }
        const monthly = new Array(12).fill(0);
        rows.forEach((item) => {
            const budget = Array.isArray(item.budget) ? item.budget : [];
            monthKeys.forEach((month, index) => {
                const value = budget[index] ?? item.budget?.[month] ?? item[`budget_${month}`] ?? item[month] ?? 0;
                monthly[index] += window.SmartBaraFormatters.parseNumber(value, 0);
            });
        });
        return monthly;
    }

    function buildFutureBudgetReasons(context) {
        const rows = Array.isArray(window.__smartbaraFutureBudgetRows) ? window.__smartbaraFutureBudgetRows : [];
        const selectedDepartments = window.SmartBaraCore?.getSelectedDepartments?.() || ['ALL'];
        const isCombined = window.SmartBaraCore?.isCombinedDepartments?.() ?? true;
        const deptSet = new Set(
            selectedDepartments
                .map(dept => String(dept || '').trim().toUpperCase())
                .filter(Boolean)
                .filter(dept => dept !== 'ALL')
        );

        const normalizeLabel = (value) => String(value || '').trim();
        const getRowTotal = (row) => {
            const direct = Number(row?.total ?? row?.total_tahun ?? row?.nominal ?? row?.value ?? row?.anggaran ?? 0);
            if (Number.isFinite(direct) && direct !== 0) return direct;
            const months = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
            return months.reduce((sum, month) => sum + (Number(row?.[month] ?? row?.[`budget_${month}`] ?? 0) || 0), 0);
        };

        const rowIsInScope = (row) => {
            const dept = String(row?.dept || row?.department || row?.departemen || '').trim().toUpperCase();
            if (!dept) return true;
            if (!isCombined && deptSet.size > 0) return deptSet.has(dept);
            if (selectedDepartments.includes('ALL') || selectedDepartments.length === 0 || isCombined) return true;
            return deptSet.has(dept);
        };
        const scopedRows = rows.filter(rowIsInScope).map((row) => ({
            name: normalizeLabel(row?.nama_akun || row?.account || row?.account_name || row?.name || row?.nama || row?.akun) || 'Akun tidak bernama',
            total: getRowTotal(row),
            reconcileTotal: Number(row?.history_nominal ?? row?.historyNominal ?? row?.annualized ?? 0) || 0,
            dept: String(row?.dept || row?.department || row?.departemen || '').trim().toUpperCase()
        })).filter(item => item.name);
        const previousRows = (Array.isArray(window.__smartbaraBudgetRows) ? window.__smartbaraBudgetRows : [])
            .filter(rowIsInScope)
            .map((row) => ({
                name: normalizeLabel(row?.nama_akun || row?.account || row?.account_name || row?.name || row?.nama || row?.akun) || 'Akun tidak bernama',
                total: getRowTotal(row)
            }));
            const reconcileRows = scopedRows.map(row => ({ name: row.name, total: row.reconcileTotal }));

        const bucketRules = [
            {
                title: 'Pembaruan aset & maintenance',
                detail: 'Penyusutan, perbaikan, perlindungan, dan pemeliharaan aset.'
            },
            {
                title: 'Kebutuhan operasional bulanan',
                detail: 'Biaya rutin untuk utilitas, transportasi, sewa, dan kegiatan harian.'
            },
            {
                title: 'Pengeluaran biaya kantor',
                detail: 'ATK, perlengkapan, layanan, dan administrasi kantor.'
            },
            {
                title: 'Lainnya',
                detail: 'Akun yang tidak termasuk kebutuhan aset, operasional bulanan, atau biaya kantor.'
            }
        ];

        const classifyAccount = (name) => {
            const label = name.toLocaleLowerCase('id-ID');
            if (/\bsewa\b/.test(label)) return 1;
            if (/penyusutan|depresiasi|maintenance|pemeliharaan|perbaikan|sparepart|suku cadang|renovasi|inventaris|peralatan kerja|\baset\b/.test(label)) return 0;
            if (/asuransi/.test(label)) return /jiwa/.test(label) ? 1 : 0;
            if (/kantor|office|\batk\b|alat tulis|stationery|perlengkapan kantor|administrasi|adm bank|buku cek|giro|percetakan|fotokopi|materai|percetakan|\bcetak\b/.test(label)) return 2;
            if (/operasional|gaji|upah|pegawai|karyawan|transport|ekspedisi|logistik|telekomunikasi|listrik|\bair\b|kebutuhan dapur|konsumsi|perjalanan|komunikasi|\bbbm\b|bahan bakar|ongkos kirim|e-toll|\btol\b|stnk|\bkir\b|iuran lingkungan|pbb|entertainment/.test(label)) return 1;
            return 3;
        };
        const accountsByName = new Map();
        const addAccountRows = (sourceRows, amountKey) => sourceRows.forEach((row) => {
            const key = row.name.toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
            const existing = accountsByName.get(key) || { name: row.name, budgetPreviousTotal: 0, reconcilePreviousTotal: 0, futureTotal: 0 };
            existing[amountKey] += row.total;
            accountsByName.set(key, existing);
        });
        addAccountRows(previousRows, 'budgetPreviousTotal');
        addAccountRows(reconcileRows, 'reconcilePreviousTotal');
        addAccountRows(scopedRows, 'futureTotal');

        const accounts = Array.from(accountsByName.values());
        const categorizedAccounts = bucketRules.map((rule) => ({ ...rule, accounts: [] }));
        accounts.forEach((account) => {
            account.budgetIncrease = account.futureTotal - account.budgetPreviousTotal;
            account.budgetIncreasePercent = account.budgetPreviousTotal > 0
                ? (account.budgetIncrease / account.budgetPreviousTotal) * 100
                : account.futureTotal > 0 ? null : 0;
            account.reconcileIncrease = account.futureTotal - account.reconcilePreviousTotal;
            account.reconcileIncreasePercent = account.reconcilePreviousTotal > 0
                ? (account.reconcileIncrease / account.reconcilePreviousTotal) * 100
                : account.futureTotal > 0 ? null : 0;
            categorizedAccounts[classifyAccount(account.name)].accounts.push(account);
        });

        const categorizedTotal = accounts.reduce((sum, account) => sum + account.futureTotal, 0);
        const categories = categorizedAccounts.map((category) => {
            const value = category.accounts.reduce((sum, account) => sum + account.futureTotal, 0);
            return {
                ...category,
                value,
                pct: categorizedTotal > 0 ? (value / categorizedTotal) * 100 : 0
            };
        });
        const createSummary = (source) => {
            const previousTotal = accounts.reduce((sum, account) => sum + account[`${source}PreviousTotal`], 0);
            const increase = categorizedTotal - previousTotal;
            return {
                previousTotal,
                futureTotal: categorizedTotal,
                increase,
                percent: previousTotal > 0 ? (increase / previousTotal) * 100 : 0
            };
        };
        return {
            categories,
            summaries: {
                budget: createSummary('budget'),
                reconcile: createSummary('reconcile')
            }
        };
    }

    function buildPresentationSlides(context) {
        const kpiCards = [
            { label: 'Budget Plan', value: window.Formatters.formatRupiah(context.budgetPlan), accent: 'emerald' },
            { label: 'Finance', value: window.Formatters.formatRupiah(context.financeTotal), accent: 'sky' },
            { label: 'Rekonsil', value: window.Formatters.formatRupiah(context.reconcileTotal), accent: 'teal' },
            { label: 'Anggaran Masa Depan', value: window.Formatters.formatRupiah(context.futureBudget), accent: 'cyan' },
            { label: 'Smart Asset', value: window.Formatters.formatRupiah(context.assetSummary.total || 0), accent: 'amber' }
        ];
        const monthlyFinanceVsReconcile = buildMonthlyFinanceVsReconcileSeries(context);
        const monthlyBudgetPlan = buildMonthlyBudgetPlanSeries(context);

        const totalValues = [context.budgetPlan, context.financeTotal, context.reconcileTotal, context.futureBudget];
        if (context.hasGaDepartment) totalValues.push(context.assetSummary.total || 0);
        const maxValue = Math.max(...totalValues, 1);
        const planPercent = maxValue ? (context.budgetPlan / maxValue) * 100 : 0;
        const financePercent = maxValue ? (context.financeTotal / maxValue) * 100 : 0;
        const reconcilePercent = maxValue ? (context.reconcileTotal / maxValue) * 100 : 0;
        const futurePercent = maxValue ? (context.futureBudget / maxValue) * 100 : 0;
        const futureBudgetDelta = context.futureBudget - context.budgetPlan;
        const financePlanShare = context.budgetPlan > 0 ? (context.financeTotal / context.budgetPlan) * 100 : 0;
        const financeReconcileDelta = context.financeTotal - context.reconcileTotal;
        const monthlyTrend = buildMonthlyTrendSeries(context);
        const monthlyMax = Math.max(...monthlyTrend.map(item => item.value), 1);
        const paretoBudget = (latestTopLists.budget || []).slice(0, 5);
        const paretoTotal = paretoBudget.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
        const financeTop = (latestTopLists.finance || []).slice(0, 5);
        const reconcileTop = (latestTopLists.reconcile || []).slice(0, 5);
        const futureReasonData = buildFutureBudgetReasons(context);
        const futureReasons = futureReasonData.categories;
        const initialGrowthSummary = futureReasonData.summaries[futureBudgetBaselineSource];
        const assetSummary = context.assetSummary || {};
        const assetCategories = Array.isArray(assetSummary.categories) ? assetSummary.categories : [];
        const assetTopAssets = Array.isArray(assetSummary.topAssets) ? assetSummary.topAssets : [];
        const assetTopFiveTotal = assetTopAssets.reduce((sum, asset) => sum + Number(asset.value || 0), 0);
        const assetTopFiveShare = assetSummary.total > 0 ? (assetTopFiveTotal / assetSummary.total) * 100 : 0;
        const hasMonthlyData = monthlyFinanceVsReconcile.some(item => Number(item.finance) !== 0 || Number(item.reconcile) !== 0)
            || monthlyBudgetPlan.some(value => Number(value) !== 0);
        const toneClassMap = {
            emerald: 'bg-emerald-400',
            sky: 'bg-sky-400',
            teal: 'bg-teal-400',
            violet: 'bg-violet-400'
        };

        // Pastikan slide smart-asset selalu ada meski dept bukan GA
        const slides = [
            `
            <section data-presentation-slide="briefing" data-presentation-detail="briefing" class="presentation-detail-trigger presentation-slide active flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950/60 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.28em] text-teal-300">Executive briefing</p>
                        <h2 class="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">Smart BARA</h2>
                    </div>
                    <div class="rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-teal-200">${window.Formatters.escapeHtml(context.activePeriod)}</div>
                </div>
                <div class="mt-8 max-w-3xl">
                    <h3 class="text-2xl font-black leading-tight text-white sm:text-3xl">Ringkasan Kinerja ${window.Formatters.escapeHtml(context.scopeLabel)}</h3>
                    <p class="mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">Presentasi ini merangkum kondisi terkini Smart BARA dan Smart Asset sesuai periode aktif, departemen yang ditampilkan, serta tren anggaran yang sedang berlangsung.</p>
                </div>
                <div class="mt-8 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Departemen</p><p class="mt-3 text-lg font-black text-white sm:text-xl">${window.Formatters.escapeHtml(context.scopeLabel)}</p></div>
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Status Approval</p><p class="mt-3 text-lg font-black text-white sm:text-xl">${window.Formatters.escapeHtml(context.approvalBadge)}</p></div>
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Tanggal</p><p class="mt-3 text-base font-black text-white sm:text-xl">${window.Formatters.escapeHtml(context.generatedAt)}</p></div>
                </div>
                <div class="mt-auto flex justify-end pt-8 text-right">
                    <div>
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-300">Presented by</p>
                        <p class="mt-1 mb-0 max-w-full break-words text-sm font-bold text-white">${window.Formatters.escapeHtml(context.presenterName)}</p>
                    </div>
                </div>
            </section>
            `,
            `
            <section data-presentation-slide="kpi-overview" data-presentation-detail="kpi-overview" class="presentation-detail-trigger presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-sky-300">KPI overview</p>
                        <h3 class="mt-2 text-xl font-black text-white sm:text-2xl">Snapshot kinerja utama</h3>
                    </div>
                    <div class="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-200">${window.Formatters.escapeHtml(context.activePeriod)}</div>
                </div>
                <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    ${kpiCards.map(card => `
                        <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">${window.Formatters.escapeHtml(card.label)}</p>
                            <p class="mt-3 text-base font-black leading-tight text-white sm:text-lg">${window.Formatters.escapeHtml(card.value)}</p>
                            <div class="mt-3 flex items-center justify-between text-[9px] text-slate-300">
                                <span>Base</span>
                                <span>${Math.round((Number(String(card.value).replace(/[^0-9]/g, '')) || 0) / Math.max(context.futureBudget || 1, 1) * 100)}%</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                    <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Rangkuman eksekutif</p>
                        <div class="mt-4 space-y-3 text-sm text-slate-200">
                            <div class="flex items-center justify-between gap-3"><span>Budget plan aktif</span><strong class="text-white">${window.Formatters.formatRupiah(context.budgetPlan)}</strong></div>
                            <div class="flex items-center justify-between gap-3"><span>Finance total</span><strong class="text-white">${window.Formatters.formatRupiah(context.financeTotal)}</strong></div>
                            <div class="flex items-center justify-between gap-3"><span>Rekonsil total</span><strong class="text-white">${window.Formatters.formatRupiah(context.reconcileTotal)}</strong></div>
                            <div class="flex items-center justify-between gap-3"><span>Target masa depan</span><strong class="text-white">${window.Formatters.formatRupiah(context.futureBudget)}</strong></div>
                        </div>
                        <div class="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-6 text-emerald-100">
                            <strong>Rumus data:</strong> Budget Plan = jumlah nominal aktif per periode; Finance = total transaksi data keuangan; Rekonsil = selisih realisasi vs baseline; Future Budget = target anggaran berikutnya ditambah inflasi / kebutuhan eskalasi.
                        </div>
                    </div>
                    <div class="space-y-3">
                        <div class="rounded-2xl border border-white/10 bg-emerald-500/10 p-4"><p class="m-0 text-[10px] uppercase tracking-[0.16em] text-emerald-200">Kenaikan Budget Plan</p><p class="mt-3 text-2xl font-black text-white">${formatPercent(context.planGrowth)}</p></div>
                        <div class="rounded-2xl border border-white/10 bg-amber-500/10 p-4"><p class="m-0 text-[10px] uppercase tracking-[0.16em] text-amber-200">Selisih Rekonsil</p><p class="mt-3 text-2xl font-black text-white">${window.Formatters.formatRupiah(context.varianceTotal)}</p></div>
                        <div class="rounded-2xl border border-white/10 bg-teal-500/10 p-4"><p class="m-0 text-[10px] uppercase tracking-[0.16em] text-teal-200">Approval</p><p class="mt-3 text-2xl font-black text-white">${window.Formatters.escapeHtml(context.approvalStatus)}</p></div>
                        <div class="rounded-2xl border border-white/10 bg-sky-500/10 p-4"><p class="m-0 text-[10px] uppercase tracking-[0.16em] text-sky-200">Transaksi aktif</p><p class="mt-3 text-2xl font-black text-white">${(context.transactionCount || 0).toLocaleString('id-ID')}</p></div>
                    </div>
                </div>
            </section>
            `,
            `
            <section data-presentation-slide="smart-asset" class="presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p data-presentation-slide="smart-asset" class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">Smart Asset portfolio</p>
                        <h3 class="mt-2 text-xl font-black text-white sm:text-2xl">Portofolio aset & fokus nilai</h3>
                    </div>
                    <div class="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">${(assetSummary.count || 0).toLocaleString('id-ID')} aset</div>
                </div>
                <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    ${[
                        ['Total nilai perolehan', window.Formatters.formatRupiah(assetSummary.total || 0)],
                        ['Rata-rata per aset', window.Formatters.formatRupiah(assetSummary.averageValue || 0)],
                        ['Jenis aset', `${assetCategories.length.toLocaleString('id-ID')} kategori`],
                        ['Nilai 5 aset tertinggi', window.Formatters.formatRupiah(assetTopFiveTotal)]
                    ].map(([label, value]) => `
                        <div class="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">${window.Formatters.escapeHtml(label)}</p>
                            <p class="mt-2 mb-0 break-words text-base font-black text-white">${window.Formatters.escapeHtml(value)}</p>
                        </div>
                    `).join('')}
                </div>
                <div class="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <div class="mb-3 flex items-center justify-between gap-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">Nilai per tipe aset</p>
                            <span class="text-[9px] text-slate-500">Harga perolehan</span>
                        </div>
                        ${assetCategories.length ? assetCategories.slice(0, 6).map(category => `
                            <div class="mb-3 last:mb-0">
                                <div class="mb-1 flex items-center justify-between gap-3 text-[10px]">
                                    <span class="min-w-0 truncate text-slate-200">${window.Formatters.escapeHtml(category.type)} · ${category.count.toLocaleString('id-ID')} aset</span>
                                    <strong class="shrink-0 text-white">${window.Formatters.formatRupiah(category.value)}</strong>
                                </div>
                                <div class="h-2 overflow-hidden rounded-full bg-white/5">
                                    <div class="h-full rounded-full bg-amber-400" style="width:${Math.min(100, category.pct)}%"></div>
                                </div>
                                <p class="mt-1 mb-0 text-right text-[9px] text-slate-500">${formatPercent(category.pct)} dari total nilai</p>
                            </div>
                        `).join('') : '<p class="m-0 text-xs text-slate-500">Belum ada rincian tipe aset.</p>'}
                    </div>
                    <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <div class="mb-3 flex items-center justify-between gap-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">Aset dengan nilai tertinggi</p>
                            <span class="text-[9px] text-slate-500">Top 5</span>
                        </div>
                        ${assetTopAssets.length ? assetTopAssets.map((asset, index) => `
                            <div class="flex items-start gap-3 border-b border-white/5 py-2 last:border-b-0">
                                <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-black text-amber-200">${index + 1}</span>
                                <div class="min-w-0 flex-1">
                                    <p class="m-0 truncate text-[10px] font-semibold text-slate-100">${window.Formatters.escapeHtml(asset.name)}</p>
                                    <p class="mt-0.5 mb-0 text-[9px] text-slate-500">${window.Formatters.escapeHtml(asset.type)}</p>
                                </div>
                                <strong class="shrink-0 text-right text-[10px] text-white">${window.Formatters.formatRupiah(asset.value)}</strong>
                            </div>
                        `).join('') : '<p class="m-0 text-xs text-slate-500">Belum ada data aset.</p>'}
                    </div>
                </div>
                <div class="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-5 text-amber-100">
                    ${assetCategories[0] ? `<strong>${window.Formatters.escapeHtml(assetCategories[0].type)}</strong> merupakan tipe dengan nilai terbesar (${formatPercent(assetCategories[0].pct)} dari total). Top 5 aset menyumbang ${formatPercent(assetTopFiveShare)} dari nilai perolehan.` : 'Analisa tipe aset belum tersedia.'}
                    Nilai memakai harga perolehan dan belum dikurangi penyusutan.
                </div>
            </section>
            `,
            `
            <section data-presentation-slide="pareto" data-presentation-detail="pareto" class="presentation-detail-trigger presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-300">Pareto</p>
                        <h3 class="mt-2 text-xl font-black text-white sm:text-2xl">Pareto departemen</h3>
                    </div>
                    <div class="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-200">Top 5</div>
                </div>
                <div class="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <div class="space-y-3">
                        ${paretoBudget.length ? paretoBudget.map((item, index) => {
                            const share = paretoTotal ? (Number(item.value || 0) / paretoTotal) * 100 : 0;
                            return `
                                <div class="rounded-2xl border border-violet-500/15 bg-slate-950/40 p-3">
                                    <div class="mb-2 flex items-center justify-between gap-3 text-[11px] text-slate-300">
                                        <div class="flex min-w-0 flex-1 items-center gap-2">
                                            <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-black text-violet-200">${index + 1}</span>
                                            <span class="truncate font-semibold text-slate-100">${window.Formatters.escapeHtml(item.label || 'Departemen')}</span>
                                        </div>
                                        <span class="shrink-0 whitespace-nowrap font-bold text-white">${window.Formatters.formatRupiah(item.value)}</span>
                                    </div>
                                    <div class="mb-2 flex items-center justify-between gap-3 text-[10px] text-slate-400">
                                        <span>Share terhadap total</span>
                                        <span class="font-bold text-violet-200">${share.toFixed(1)}%</span>
                                    </div>
                                    <div class="h-2.5 overflow-hidden rounded-full bg-white/5">
                                        <div class="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400" style="width:${Math.min(100, share)}%"></div>
                                    </div>
                                </div>
                            `;
                        }).join('') : '<div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-300">Belum ada data pareto departemen untuk periode aktif.</div>'}
                    </div>
                    <div class="space-y-3">
                        <div class="rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4">
                            <p class="m-0 text-[10px] uppercase tracking-[0.18em] text-violet-200">Konsentrasi</p>
                            <p class="mt-3 text-3xl font-black text-white">${paretoBudget.length ? Math.min(100, paretoBudget.slice(0, 3).reduce((sum, item) => sum + (paretoTotal ? (Number(item.value || 0) / paretoTotal) * 100 : 0), 0)).toFixed(1) : '0.0'}%</p>
                            <p class="mt-2 text-xs leading-6 text-slate-200">3 departemen teratas menyerap sebagian besar kebutuhan anggaran aktif pada periode ${window.Formatters.escapeHtml(context.activePeriod)}.</p>
                        </div>
                        <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                            <p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Rumus</p>
                            <p class="mt-2 text-xs leading-6 text-slate-200">Share departemen = nilai departemen ÷ total top 5 × 100.</p>
                            <p class="mt-2 text-xs leading-6 text-slate-200">Total top 5 = ${window.Formatters.formatRupiah(paretoTotal)}.</p>
                        </div>
                    </div>
                </div>
            </section>
            `,
            `
            <section class="presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p data-presentation-slide="budget-finance" class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">Budget & finance</p>
                        <h3 class="mt-2 text-xl font-black text-white sm:text-2xl">Komposisi budget, finance, dan rekonsil</h3>
                    </div>
                    <div class="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">Mix</div>
                </div>
                <div class="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_0.7fr]">
                    <div class="space-y-4">
                        ${[
                            ['Budget Plan', context.budgetPlan, planPercent, 'emerald'],
                            ['Finance', context.financeTotal, financePercent, 'sky'],
                            ['Rekonsil', context.reconcileTotal, reconcilePercent, 'teal'],
                            ['Future Budget', context.futureBudget, futurePercent, 'violet']
                        ].map(([label, value, percent, tone]) => `
                            <div>
                                <div class="mb-1 flex items-center justify-between gap-3 text-[11px] text-slate-300">
                                    <span>${window.Formatters.escapeHtml(label)}</span>
                                    <span class="font-bold text-white">${window.Formatters.formatRupiah(value)}</span>
                                </div>
                                <div class="h-2.5 overflow-hidden rounded-full bg-white/5">
                                    <div class="h-full rounded-full ${toneClassMap[tone] || 'bg-emerald-400'}" style="width:${Math.min(100, percent)}%"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="flex items-center justify-center">
                        <div class="relative flex h-44 w-44 items-center justify-center rounded-full border border-white/10 bg-slate-950/60 shadow-inner" style="background: conic-gradient(#34d399 0 ${Math.max(12, planPercent)}%, #38bdf8 ${Math.max(12, planPercent)}% ${Math.max(12, planPercent + financePercent * 0.75)}%, #2dd4bf ${Math.max(12, planPercent + financePercent * 0.75)}% ${Math.max(12, planPercent + financePercent * 0.75 + reconcilePercent * 0.6)}%, #a78bfa ${Math.max(12, planPercent + financePercent * 0.75 + reconcilePercent * 0.6)}% 100%);">
                            <div title="Future Budget dibanding Budget Plan" class="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-center text-[10px] font-bold text-slate-100 shadow-2xl">${formatPercent((context.futureBudget / Math.max(context.budgetPlan, 1)) * 100)}</div>
                        </div>
                    </div>
                </div>
                <div class="mt-8 border-t border-white/10 pt-4">
                    <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">Hasil analisa</p>
                    <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div class="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Perubahan rencana</p>
                            <p class="mt-2 mb-0 text-xs leading-5 text-slate-200">Future Budget ${futureBudgetDelta >= 0 ? 'naik' : 'turun'} <strong class="text-white">${window.Formatters.formatRupiah(Math.abs(futureBudgetDelta))}</strong> (${formatPercent(context.planGrowth)}) dibanding Budget Plan.</p>
                        </div>
                        <div class="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Finance vs Budget Plan</p>
                            <p class="mt-2 mb-0 text-xs leading-5 text-slate-200">Finance mencapai <strong class="text-white">${formatPercent(financePlanShare)}</strong> dari Budget Plan; selisih <strong class="text-white">${window.Formatters.formatRupiah(Math.abs(context.budgetPlan - context.financeTotal))}</strong> ${context.financeTotal <= context.budgetPlan ? 'di bawah' : 'di atas'} plan.</p>
                        </div>
                        <div class="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Finance vs Rekonsil</p>
                            <p class="mt-2 mb-0 text-xs leading-5 text-slate-200">${Math.abs(financeReconcileDelta) < 0.01 ? `Nilai keduanya sama, ${window.Formatters.formatRupiah(context.financeTotal)}.` : `Ada selisih ${window.Formatters.formatRupiah(Math.abs(financeReconcileDelta))}.`}</p>
                        </div>
                    </div>
                </div>
            </section>
            `,
            `
            <section class="presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p data-presentation-slide="reconcile-top" class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-teal-300">Rekonsil teratas</p>
                        <h3 class="mt-2 text-xl font-black text-white sm:text-2xl">Rekonsil dan nilai terbesar</h3>
                    </div>
                    <div class="rounded-full border border-teal-400/20 bg-teal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200">Top 5</div>
                </div>
                <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">Finance terbesar</p>
                        <div class="mt-3 space-y-3">
                            ${financeTop.length ? financeTop.map((item, index) => `
                                <div class="flex items-center justify-between gap-3 text-[11px]">
                                    <div class="min-w-0">
                                        <p class="truncate text-slate-200">${index + 1}. ${window.Formatters.escapeHtml(item.label || 'Finance')}</p>
                                    </div>
                                    <span class="font-bold text-white">${window.Formatters.formatRupiah(item.value)}</span>
                                </div>
                            `).join('') : '<p class="text-sm text-slate-400">Belum ada data finance.</p>'}
                        </div>
                    </div>
                    <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">Rekonsil terbesar</p>
                        <div class="mt-3 space-y-3">
                            ${reconcileTop.length ? reconcileTop.map((item, index) => `
                                <div class="flex items-center justify-between gap-3 text-[11px]">
                                    <div class="min-w-0">
                                        <p class="truncate text-slate-200">${index + 1}. ${window.Formatters.escapeHtml(item.label || 'Rekonsil')}</p>
                                    </div>
                                    <span class="font-bold text-white">${window.Formatters.formatRupiah(item.value)}</span>
                                </div>
                            `).join('') : '<p class="text-sm text-slate-400">Belum ada data rekonsil.</p>'}
                        </div>
                    </div>
                </div>
            </section>
            `,
            `
            <section data-presentation-slide="monthly-trend" data-presentation-detail="monthly-trend" class="presentation-detail-trigger presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">Monthly trend</p>
                        <h3 class="mt-2 text-xl font-black text-white sm:text-2xl">Tren bulanan: Budget Plan, Finance & Rekonsil</h3>
                    </div>
                    <div class="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">12 bulan</div>
                </div>
                <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                    <div class="flex flex-col rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        ${hasMonthlyData ? `
                            <div class="relative min-h-[260px] w-full flex-1">
                                <canvas id="presentationMonthlyTrendChart" role="img" aria-label="Grafik bulanan Budget Plan, Finance, dan Rekonsil" data-finance="${window.Formatters.escapeHtml(JSON.stringify(monthlyFinanceVsReconcile.map(item => Number(item.finance) || 0)))}" data-reconcile="${window.Formatters.escapeHtml(JSON.stringify(monthlyFinanceVsReconcile.map(item => Number(item.reconcile) || 0)))}" data-budget="${window.Formatters.escapeHtml(JSON.stringify(monthlyBudgetPlan))}"></canvas>
                                <p data-monthly-chart-status class="pointer-events-none absolute inset-0 m-0 flex items-center justify-center text-xs text-slate-400">Memuat grafik...</p>
                            </div>
                        ` : '<div class="flex h-52 items-center justify-center text-center text-xs text-slate-500">Belum ada transaksi Finance atau Rekonsil bertanggal pada periode aktif.</div>'}
                    </div>
                    <div class="space-y-4">
                        <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                            <p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Trend</p>
                            <p class="mt-3 text-2xl font-black text-white">${formatPercent(context.planGrowth)}</p>
                            <p class="mt-2 text-xs leading-6 text-slate-300">Kenaikan anggaran masa depan relatif terhadap budget plan berjalan.</p>
                        </div>
                        <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                            <p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Status data</p>
                            <p class="mt-3 text-xl font-black text-white">${window.Formatters.escapeHtml(context.approvalStatus)}</p>
                            <p class="mt-2 text-xs leading-6 text-slate-300">Data konsolidasi dan realisasi masih berjalan dalam kontrol yang sehat.</p>
                        </div>
                        <div class="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                            <p class="m-0 text-[10px] uppercase tracking-[0.18em] text-cyan-200">Rumus</p>
                            <p class="mt-2 text-xs leading-6 text-slate-200">Finance = total debit - kredit.</p>
                            <p class="mt-1 text-xs leading-6 text-slate-200">Rekonsil = nilai final yang telah disesuaikan per bulan.</p>
                        </div>
                    </div>
                </div>
            </section>
            `,
            `
            <section data-presentation-slide="budget-analysis" data-presentation-detail="budget-analysis" class="presentation-detail-trigger presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">Analisa budget tahun depan</p>
                        <h3 class="mt-2 text-2xl font-black text-white sm:text-3xl">Kenapa budget tahun depan bisa naik?</h3>
                        <label class="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-300">
                            <span>Nominal sebelumnya dari</span>
                            <select data-future-baseline-select class="rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-[11px] font-bold text-white focus:border-amber-400 focus:outline-none">
                                <option value="budget" ${futureBudgetBaselineSource === 'budget' ? 'selected' : ''}>Budget Plan</option>
                                <option value="reconcile" ${futureBudgetBaselineSource === 'reconcile' ? 'selected' : ''}>Rekonsil · Proyeksi Aktual 12 Bulan</option>
                            </select>
                        </label>
                    </div>
                    <div data-growth-summary-percent data-budget-value="${formatPercent(futureReasonData.summaries.budget.percent)}" data-reconcile-value="${formatPercent(futureReasonData.summaries.reconcile.percent)}" class="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">${formatPercent(initialGrowthSummary.percent)}</div>
                </div>
                <div class="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <div class="space-y-3">
                        ${futureReasons.map((reason, index) => `
                            <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                                <div class="mb-2 flex items-center justify-between gap-3">
                                    <button type="button" data-budget-reason-toggle aria-expanded="false" aria-controls="budget-reason-accounts-${index}" title="Tampilkan atau sembunyikan rincian akun" class="flex min-w-0 flex-1 items-center justify-between gap-3 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300 hover:text-white">
                                        <span class="min-w-0">${index + 1}. ${window.Formatters.escapeHtml(reason.title)}</span>
                                        <span class="flex shrink-0 items-center gap-2">
                                            <span class="text-[10px] font-black text-amber-200">${reason.pct.toFixed(0)}%</span>
                                            <span data-budget-reason-chevron aria-hidden="true" class="text-sm text-amber-200">▸</span>
                                        </span>
                                    </button>
                                </div>
                                <div class="mb-2 flex items-center justify-between gap-3 text-[10px] text-slate-400">
                                    <span>Nilai kontribusi</span>
                                    <span class="font-bold text-white">${window.Formatters.formatRupiah(reason.value)}</span>
                                </div>
                                <div class="h-2 overflow-hidden rounded-full bg-white/5">
                                    <div class="h-full rounded-full bg-amber-400" style="width:${Math.min(100, reason.pct)}%"></div>
                                </div>
                                <p class="mt-2 text-xs leading-6 text-slate-300">${window.Formatters.escapeHtml(reason.detail)}</p>
                                <div id="budget-reason-accounts-${index}" data-budget-reason-accounts class="hidden mt-3 border-t border-white/10 pt-2">
                                    <div class="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                        <span>Nama akun</span>
                                        <span>Anggaran masa depan</span>
                                    </div>
                                    ${reason.accounts.length ? reason.accounts.map(account => `
                                        <div class="border-b border-white/5 py-1.5 text-[10px] leading-4 last:border-b-0">
                                            <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                                                <span class="min-w-0 break-words text-slate-200">${window.Formatters.escapeHtml(account.name)}</span>
                                                <span class="whitespace-nowrap text-right font-semibold text-white">${window.Formatters.formatRupiah(account.futureTotal)}</span>
                                            </div>
                                            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-400">
                                                <span>Sebelumnya (<span data-growth-source-label>${futureBudgetBaselineSource === 'budget' ? 'Budget Plan' : 'Rekonsil · Proyeksi 12 Bulan'}</span>): <span data-growth-account-previous data-budget-value="${account.budgetPreviousTotal}" data-reconcile-value="${account.reconcilePreviousTotal}">${window.Formatters.formatRupiah(account[`${futureBudgetBaselineSource}PreviousTotal`])}</span></span>
                                                <span>Selisih: <span data-growth-account-increase data-budget-value="${account.budgetIncrease}" data-reconcile-value="${account.reconcileIncrease}">${window.Formatters.formatRupiah(account[`${futureBudgetBaselineSource}Increase`])}</span></span>
                                                <span>Persentase: <span data-growth-account-percent data-budget-value="${account.budgetIncreasePercent === null ? 'Baru' : `${account.budgetIncreasePercent > 0 ? '+' : ''}${account.budgetIncreasePercent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}" data-reconcile-value="${account.reconcileIncreasePercent === null ? 'Baru' : `${account.reconcileIncreasePercent > 0 ? '+' : ''}${account.reconcileIncreasePercent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}">${account[`${futureBudgetBaselineSource}IncreasePercent`] === null ? 'Baru' : `${account[`${futureBudgetBaselineSource}IncreasePercent`] > 0 ? '+' : ''}${account[`${futureBudgetBaselineSource}IncreasePercent`].toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}</span></span>
                                            </div>
                                        </div>
                                    `).join('') : '<p class="py-1 text-[10px] text-slate-500">Belum ada akun pada kategori ini.</p>'}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
                        <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Logika utama</p>
                        <p class="mt-3 text-3xl font-black text-white">${window.Formatters.formatRupiah(context.futureBudget)}</p>
                        <div class="mt-4 rounded-xl border border-amber-500/20 bg-slate-950/30 p-3 text-xs leading-6 text-slate-100">
                            <p><strong>Nominal sebelumnya (<span data-growth-source-label>${futureBudgetBaselineSource === 'budget' ? 'Budget Plan' : 'Rekonsil · Proyeksi 12 Bulan'}</span>):</strong> <span data-growth-summary-field="previous" data-budget-value="${futureReasonData.summaries.budget.previousTotal}" data-reconcile-value="${futureReasonData.summaries.reconcile.previousTotal}">${window.Formatters.formatRupiah(initialGrowthSummary.previousTotal)}</span></p>
                            <p><strong>Rumus dasar:</strong> ${window.Formatters.formatRupiah(initialGrowthSummary.futureTotal)} − <span data-growth-summary-field="previous" data-budget-value="${futureReasonData.summaries.budget.previousTotal}" data-reconcile-value="${futureReasonData.summaries.reconcile.previousTotal}">${window.Formatters.formatRupiah(initialGrowthSummary.previousTotal)}</span> = <span data-growth-summary-field="increase" data-budget-value="${futureReasonData.summaries.budget.increase}" data-reconcile-value="${futureReasonData.summaries.reconcile.increase}">${window.Formatters.formatRupiah(initialGrowthSummary.increase)}</span></p>
                            <p><strong>Persentase kenaikan:</strong> <span data-growth-summary-field="increase" data-budget-value="${futureReasonData.summaries.budget.increase}" data-reconcile-value="${futureReasonData.summaries.reconcile.increase}">${window.Formatters.formatRupiah(initialGrowthSummary.increase)}</span> ÷ <span data-growth-summary-field="previous" data-budget-value="${futureReasonData.summaries.budget.previousTotal}" data-reconcile-value="${futureReasonData.summaries.reconcile.previousTotal}">${window.Formatters.formatRupiah(initialGrowthSummary.previousTotal)}</span> × 100 = <span data-growth-summary-field="percent" data-budget-value="${formatPercent(futureReasonData.summaries.budget.percent)}" data-reconcile-value="${formatPercent(futureReasonData.summaries.reconcile.percent)}">${formatPercent(initialGrowthSummary.percent)}</span></p>
                        </div>
                        <div class="mt-4 rounded-xl border border-amber-400/20 bg-slate-950/30 p-3">
                            <p class="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">Ringkasan porsi anggaran masa depan</p>
                            <div class="mt-2 space-y-2">
                                ${futureReasons.map(reason => `
                                    <div class="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                                        <span class="min-w-0 text-[10px] leading-4 text-slate-200">${window.Formatters.escapeHtml(reason.title)}<span class="ml-1 text-slate-400">${window.Formatters.formatRupiah(reason.value)}</span></span>
                                        <span class="shrink-0 text-[10px] font-bold text-amber-200">${reason.pct.toFixed(0)}%</span>
                                    </div>
                                `).join('')}
                            </div>
                            <p class="mt-3 text-[10px] leading-5 text-slate-300"><strong>Porsi kategori</strong> = nilai seluruh akun kategori ÷ total anggaran pada rincian ini × 100. Totalnya 100% sebelum pembulatan.</p>
                        </div>
                        <p class="mt-3 text-[10px] leading-5 text-slate-300"><strong>Persentase per akun</strong> adalah kenaikan akun terhadap nominal sebelumnya, bukan porsi kategori; jangan dijumlahkan. <strong>18,1% di atas</strong> adalah kenaikan total dibanding sumber baseline yang dipilih.</p>
                        <div class="mt-4 rounded-xl border border-white/10 bg-slate-950/30 p-3 text-xs leading-5 text-slate-300">
                            Rincian Budget Plan, Finance, dan Rekonsil per bulan tersedia pada slide tren bulanan.
                        </div>
                    </div>
                </div>
            </section>
            `,
            `
            <section class="presentation-slide flex min-h-[560px] w-full flex-col rounded-[28px] border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl sm:p-8">
                <p data-presentation-slide="conclusion" class="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">Conclusion</p>
                <h3 class="mt-2 text-2xl font-black text-white sm:text-3xl">Kesimpulan eksekutif</h3>
                <div class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Kinerja Smart BARA</p>
                        <ul class="mt-3 space-y-2 text-sm leading-7 text-slate-200">
                            <li>• Budget plan aktif: ${window.Formatters.formatRupiah(context.budgetPlan)}</li>
                            <li>• Finance total: ${window.Formatters.formatRupiah(context.financeTotal)}</li>
                            <li>• Rekonsil total: ${window.Formatters.formatRupiah(context.reconcileTotal)}</li>
                            <li>• Budget tahun depan: ${window.Formatters.formatRupiah(context.futureBudget)}</li>
                            <li>• ${futureBudgetDelta >= 0 ? 'Kenaikan' : 'Penurunan'} terhadap Budget Plan: ${window.Formatters.formatRupiah(Math.abs(futureBudgetDelta))} (${formatPercent(context.planGrowth)})</li>
                        </ul>
                    </div>
                    <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <p class="m-0 text-[10px] uppercase tracking-[0.18em] text-slate-400">Kinerja Smart Asset</p>
                        <ul class="mt-3 space-y-2 text-sm leading-7 text-slate-200">
                            <li>• Total perolehan: ${window.Formatters.formatRupiah(assetSummary.total || 0)} dari ${(assetSummary.count || 0).toLocaleString('id-ID')} aset</li>
                            <li>• Rata-rata per aset: ${window.Formatters.formatRupiah(assetSummary.averageValue || 0)}</li>
                            <li>• Tipe terbesar: ${window.Formatters.escapeHtml(assetCategories[0]?.type || 'Belum ada data')} (${formatPercent(assetCategories[0]?.pct || 0)})</li>
                            <li>• Aset tertinggi: ${window.Formatters.escapeHtml(assetTopAssets[0]?.name || 'Belum ada data')} (${window.Formatters.formatRupiah(assetTopAssets[0]?.value || 0)})</li>
                        </ul>
                    </div>
                </div>
                <div class="mt-6 rounded-2xl border border-teal-500/20 bg-teal-500/10 p-5">
                    <p class="m-0 text-sm leading-7 text-slate-100">Rekomendasi: konsistensi pada departemen, periode aktif, dan realisasi anggaran sangat penting untuk menjaga keputusan eksekutif tetap akurat. Tren kenaikan budget masa depan adalah respons terhadap volume kerja yang bertambah, kebutuhan aset, serta beban operasional yang terus meningkat.</p>
                </div>
            </section>
            `,
            `
            <section class="presentation-slide flex min-h-[560px] w-full flex-col items-center justify-center rounded-[28px] border border-white/10 bg-slate-900 p-6 text-center text-slate-100 shadow-2xl sm:p-8">
                <p data-presentation-slide="thank-you" class="m-0 text-[10px] font-bold uppercase tracking-[0.3em] text-teal-300">Smart BARA · Executive briefing</p>
                <h2 class="mt-6 text-4xl font-black text-white sm:text-6xl">Terima kasih</h2>
                <p class="mt-4 max-w-xl text-sm leading-7 text-slate-200">Rangkuman kinerja ${window.Formatters.escapeHtml(context.scopeLabel)} · ${window.Formatters.escapeHtml(context.activePeriod)}</p>
                <div class="mt-10 border-t border-white/20 px-8 pt-5">
                    <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-300">Presented by</p>
                    <p class="mt-2 mb-0 break-words text-xl font-black text-white">${window.Formatters.escapeHtml(context.presenterName)}</p>
                </div>
            </section>
            `
        ];

        // Slide aset tetap ditampilkan meskipun departemen GA tidak dipilih,
        // sehingga data aset (jika ada) tetap bisa dipresentasikan.
        return slides;
    }

    function ensurePresentationDetailModal() {
        let modal = document.getElementById('dashboardPresentationDetailModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'dashboardPresentationDetailModal';
        modal.className = 'hidden fixed inset-0 z-[9300] flex items-center justify-center bg-slate-950/80 p-4';
        modal.innerHTML = `
            <div class="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
                <div class="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 id="dashboardPresentationDetailTitle" class="m-0 text-base font-black text-white">Detail data</h3>
                    <button type="button" id="dashboardPresentationDetailClose" class="text-slate-400 hover:text-white text-xl">✕</button>
                </div>
                <div id="dashboardPresentationDetailBody" class="mt-4 space-y-2 text-sm text-slate-200"></div>
            </div>
        `;
        document.body.appendChild(modal);
        const closeBtn = document.getElementById('dashboardPresentationDetailClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
        }
        modal.addEventListener('click', (event) => {
            if (event.target === modal) modal.classList.add('hidden');
        });
        return modal;
    }

    function showPresentationDetail(detailKey, title, lines) {
        const modal = ensurePresentationDetailModal();
        const titleEl = document.getElementById('dashboardPresentationDetailTitle');
        const bodyEl = document.getElementById('dashboardPresentationDetailBody');
        if (titleEl) titleEl.textContent = title;
        if (bodyEl) bodyEl.innerHTML = lines.map(line => `<p class="m-0 leading-6 text-slate-200">${window.Formatters.escapeHtml(line)}</p>`).join('');
        modal.classList.remove('hidden');
    }

    function applyFutureBudgetBaselineSource(deckContainer, sourceValue) {
        const source = sourceValue === 'reconcile' ? 'reconcile' : 'budget';
        futureBudgetBaselineSource = source;
        const slide = deckContainer.querySelector('[data-presentation-detail="budget-analysis"]');
        if (!slide) return;

        const sourceLabel = source === 'budget' ? 'Budget Plan' : 'Rekonsil · Proyeksi Aktual 12 Bulan';
        slide.querySelectorAll('[data-growth-source-label]').forEach((label) => { label.textContent = sourceLabel; });
        slide.querySelectorAll('[data-growth-account-previous], [data-growth-account-increase], [data-growth-account-percent], [data-growth-summary-field]').forEach((field) => {
            const value = field.dataset[`${source}Value`];
            if (field.dataset.growthSummaryField === 'percent' || field.dataset.growthAccountPercent !== undefined) {
                field.textContent = value;
            } else {
                field.textContent = window.Formatters.formatRupiah(Number(value) || 0);
            }
        });
        const growthBadge = slide.querySelector('[data-growth-summary-percent]');
        if (growthBadge) growthBadge.textContent = growthBadge.dataset[`${source}Value`];
    }

    function bindPresentationDetailTriggers() {
        const deckContainer = document.getElementById('dashboardPresentationDeck');
        if (!deckContainer) return;
        deckContainer.onchange = (event) => {
            const select = event.target.closest('[data-future-baseline-select]');
            if (select) applyFutureBudgetBaselineSource(deckContainer, select.value);
        };
        deckContainer.querySelectorAll('[data-budget-reason-toggle]').forEach((button) => {
            button.onclick = (event) => {
                event.stopPropagation();
                const expanded = button.getAttribute('aria-expanded') === 'true';
                const details = document.getElementById(button.getAttribute('aria-controls'));
                if (!details) return;
                details.classList.toggle('hidden', expanded);
                button.setAttribute('aria-expanded', String(!expanded));
                const chevron = button.querySelector('[data-budget-reason-chevron]');
                if (chevron) chevron.textContent = expanded ? '▸' : '▾';
            };
        });
        deckContainer.querySelectorAll('[data-presentation-detail]').forEach((el) => {
            el.onclick = (event) => {
                if (event.target.closest('[data-future-baseline-select]')) return;
                event.stopPropagation();
                const kind = el.dataset.presentationDetail;
                const detailMap = {
                    briefing: {
                        title: 'Detail ringkasan briefing',
                        lines: [
                            `Periode aktif: ${window.SmartBaraCore.getActivePeriod()}`,
                            `Departemen aktif: ${window.SmartBaraCore.getSelectedDepartments().join(', ') || 'Semua'}`,
                            `Status approval: ${document.getElementById('dashApprovalStatus')?.textContent || 'Belum disetujui'}`,
                            `Total budget plan: ${document.getElementById('dashBudgetTotal')?.textContent || 'Rp 0'}`,
                            `Total anggaran masa depan: ${document.getElementById('dashFutureBudgetTotal')?.textContent || 'Rp 0'}`
                        ]
                    },
                    'kpi-overview': {
                        title: 'Detail KPI overview',
                        lines: [
                            `Budget plan: ${document.getElementById('dashBudgetTotal')?.textContent || 'Rp 0'}`,
                            `Finance: ${document.getElementById('dashFinanceTotal')?.textContent || 'Rp 0'}`,
                            `Rekonsil: ${document.getElementById('dashReconcileTotal')?.textContent || 'Rp 0'}`,
                            `Future Budget: ${document.getElementById('dashFutureBudgetTotal')?.textContent || 'Rp 0'}`,
                            `Smart Asset: ${document.getElementById('dashAssetSummaryTotal')?.textContent || 'Rp 0'}`
                        ]
                    },
                    pareto: {
                        title: 'Detail pareto departemen',
                        lines: [
                            'Formula: share departemen = nilai departemen ÷ total top 5 × 100.',
                            `Total top 5: ${document.getElementById('dashFutureBudgetTotal')?.textContent || 'Rp 0'}`,
                            `Periode: ${window.SmartBaraCore.getActivePeriod()}`,
                            'Tujuan: melihat departemen yang paling dominan menyerap anggaran.'
                        ]
                    },
                    'monthly-trend': {
                        title: 'Detail grafik tren keuangan',
                        lines: [
                            'Grafik menampilkan komparasi Budget Plan, Finance, dan Rekonsil per bulan.',
                            'Rumus Finance = total debit - kredit.',
                            'Rumus Rekonsil = nilai final yang telah disesuaikan per bulan.',
                            `Periode aktif: ${window.SmartBaraCore.getActivePeriod()}`,
                            `Approval: ${document.getElementById('dashApprovalStatus')?.textContent || 'Belum disetujui'}`
                        ]
                    },
                    'budget-analysis': {
                        title: 'Detail analisa kenaikan budget',
                        lines: [
                            `Budget plan: ${document.getElementById('dashBudgetTotal')?.textContent || 'Rp 0'}`,
                            `Anggaran masa depan: ${document.getElementById('dashFutureBudgetTotal')?.textContent || 'Rp 0'}`,
                            `Selisih: ${document.getElementById('dashDeltaFutureValue')?.textContent || 'Rp 0'}`,
                            `Persentase kenaikan: ${document.getElementById('dashPlanGrowthPercent')?.textContent || '0%'}`,
                            'Rumus: (future budget − budget plan) ÷ budget plan × 100.'
                        ]
                    }
                };
                const payload = detailMap[kind] || {
                    title: 'Detail data presentasi',
                    lines: ['Klik komponen untuk menampilkan detail numerik dan sumber datanya.']
                };
                showPresentationDetail(kind, payload.title, payload.lines);
            };
        });
    }

    function renderPresentationMonthlyChart(canvas) {
        if (presentationMonthlyChart) {
            presentationMonthlyChart.resize();
            return;
        }
        if (canvas.dataset.loading) return;

        canvas.dataset.loading = 'true';
        window.SmartBaraConfig.ensureLibrary('chartjs').then(() => {
            delete canvas.dataset.loading;
            if (!canvas.isConnected || canvas.closest('.presentation-slide-wrapper')?.classList.contains('hidden')) return;

            const financeValues = JSON.parse(canvas.dataset.finance || '[]');
            const reconcileValues = JSON.parse(canvas.dataset.reconcile || '[]');
            const budgetValues = JSON.parse(canvas.dataset.budget || '[]');
            presentationMonthlyChart = new window.Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
                    datasets: [
                        {
                            label: 'Nilai Finance',
                            data: financeValues,
                            backgroundColor: 'rgba(59, 130, 246, 0.7)',
                            borderColor: '#3B82F6',
                            borderWidth: 1,
                            borderRadius: 4
                        },
                        {
                            label: 'Nilai Rekonsil',
                            data: reconcileValues,
                            backgroundColor: 'rgba(20, 184, 166, 0.7)',
                            borderColor: '#14B8A6',
                            borderWidth: 1,
                            borderRadius: 4
                        },
                        {
                            type: 'line',
                            label: 'Budget Plan',
                            data: budgetValues,
                            backgroundColor: 'rgba(52, 211, 153, 0.15)',
                            borderColor: '#34D399',
                            pointBackgroundColor: '#A7F3D0',
                            pointBorderColor: '#064E3B',
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            borderWidth: 3,
                            tension: 0.3,
                            fill: false,
                            order: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: { color: '#94A3B8', font: { family: 'Plus Jakarta Sans', weight: 'bold' } }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.dataset.label}: ${window.Formatters.formatRupiah(context.raw || 0)}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#94A3B8' }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: {
                                color: '#94A3B8',
                                callback: (value) => window.Formatters.formatRupiah(value)
                            }
                        }
                    }
                }
            });
            canvas.parentElement.querySelector('[data-monthly-chart-status]')?.remove();
        }).catch((error) => {
            delete canvas.dataset.loading;
            console.error('Presentation monthly chart error:', error);
            const status = canvas.parentElement.querySelector('[data-monthly-chart-status]');
            if (status) status.textContent = 'Grafik tidak dapat dimuat.';
        });
    }

    function buildPresentationSlideNotes(context) {
        const assetSummary = context.assetSummary || {};
        const assetCategory = assetSummary.categories?.[0];
        const topAsset = assetSummary.topAssets?.[0];
        const budgetTop = latestTopLists.budget?.[0];
        const financeTop = latestTopLists.finance?.[0];
        const reconcileTop = latestTopLists.reconcile?.[0];
        const varianceTop = latestTopLists.variance?.[0];
        const monthly = buildMonthlyFinanceVsReconcileSeries(context);
        const monthlyBudgetPlan = buildMonthlyBudgetPlanSeries(context);
        const peakMonth = monthly.reduce((peak, item) => Number(item.finance) > Number(peak.finance) ? item : peak, monthly[0] || { month: '-', finance: 0 });
        const futureData = buildFutureBudgetReasons(context);
        const leadingReason = futureData.categories[0];
        const futureDelta = context.futureBudget - context.budgetPlan;
        const financeGap = context.budgetPlan - context.financeTotal;
        const financeReconcileGap = context.financeTotal - context.reconcileTotal;
        const topBudgetShare = budgetTop?.value && context.budgetPlan > 0 ? (Number(budgetTop.value) / context.budgetPlan) * 100 : 0;
        const topAssetShare = topAsset?.value && assetSummary.total > 0 ? (Number(topAsset.value) / assetSummary.total) * 100 : 0;
        const topFiveAssets = (assetSummary.topAssets || []).reduce((sum, item) => sum + Number(item.value || 0), 0);

        const notes = [
            {
                id: 'briefing', title: 'Ringkasan eksekutif',
                data: { period: context.activePeriod, scope: context.scopeLabel, approval: context.approvalStatus, budgetPlan: context.budgetPlan, futureBudget: context.futureBudget },
                fallback: `Cakupan ${context.scopeLabel} pada ${context.activePeriod} berstatus ${context.approvalStatus.toLowerCase()}. Future Budget ${futureDelta >= 0 ? 'lebih tinggi' : 'lebih rendah'} ${window.Formatters.formatRupiah(Math.abs(futureDelta))} dari Budget Plan.`
            },
            {
                id: 'kpi-overview', title: 'Snapshot kinerja utama',
                data: { budgetPlan: context.budgetPlan, finance: context.financeTotal, reconcile: context.reconcileTotal, futureBudget: context.futureBudget, variance: context.varianceTotal, growth: context.planGrowth },
                fallback: `Future Budget ${futureDelta >= 0 ? 'naik' : 'turun'} ${window.Formatters.formatRupiah(Math.abs(futureDelta))} (${formatPercent(context.planGrowth)}); Finance ${financeGap >= 0 ? 'belum mencapai' : 'melampaui'} Budget Plan sebesar ${window.Formatters.formatRupiah(Math.abs(financeGap))}.`
            },
            {
                id: 'smart-asset', title: 'Portofolio Smart Asset',
                data: { total: assetSummary.total, count: assetSummary.count, averageValue: assetSummary.averageValue, categories: assetSummary.categories?.slice(0, 5), topAssets: assetSummary.topAssets?.slice(0, 5) },
                fallback: assetCategory ? `${assetCategory.type} menyumbang nilai perolehan terbesar (${formatPercent(assetCategory.pct)}). Aset tertinggi adalah ${topAsset?.name || 'belum tersedia'} senilai ${window.Formatters.formatRupiah(topAsset?.value || 0)}; nilai ini belum dikurangi penyusutan.` : 'Rincian kategori aset belum tersedia pada sumber data.'
            },
            {
                id: 'pareto', title: 'Pareto departemen',
                data: { topBudget: latestTopLists.budget?.slice(0, 5) || [], totalBudget: context.budgetPlan },
                fallback: budgetTop ? `${budgetTop.label || 'Departemen teratas'} adalah kontributor Budget Plan terbesar, sekitar ${formatPercent(topBudgetShare)} dari total. Periksa lima kontributor teratas untuk melihat konsentrasi anggaran.` : 'Belum ada data Budget Plan untuk membandingkan kontribusi departemen.'
            },
            {
                id: 'budget-finance', title: 'Komposisi budget, finance, dan rekonsil',
                data: { budgetPlan: context.budgetPlan, finance: context.financeTotal, reconcile: context.reconcileTotal, futureBudget: context.futureBudget },
                fallback: `Future Budget naik ${window.Formatters.formatRupiah(Math.abs(futureDelta))}; Finance mencapai ${formatPercent(context.budgetPlan > 0 ? context.financeTotal / context.budgetPlan * 100 : 0)} dari Budget Plan. Finance dan Rekonsil ${Math.abs(financeReconcileGap) < 0.01 ? 'tercatat sama' : `berbeda ${window.Formatters.formatRupiah(Math.abs(financeReconcileGap))}`}.`
            },
            {
                id: 'reconcile-top', title: 'Rekonsil dan nilai terbesar',
                data: { financeTop: latestTopLists.finance?.slice(0, 5) || [], reconcileTop: latestTopLists.reconcile?.slice(0, 5) || [], varianceTop: latestTopLists.variance?.slice(0, 5) || [] },
                fallback: financeTop ? `Nilai Finance terbesar berasal dari ${financeTop.label || 'akun teratas'} sebesar ${window.Formatters.formatRupiah(financeTop.value)}${reconcileTop ? `; nilai Rekonsil terbesar adalah ${reconcileTop.label || 'akun teratas'} sebesar ${window.Formatters.formatRupiah(reconcileTop.value)}.` : '.'}${varianceTop ? ` Selisih terbesar perlu ditinjau pada ${varianceTop.label || 'akun teratas'}.` : ''}` : 'Belum ada rincian nilai Finance dan Rekonsil terbesar untuk dianalisis.'
            },
            {
                id: 'monthly-trend', title: 'Tren Finance dan Rekonsil bulanan',
                data: { months: monthly.map((item, index) => ({ ...item, budgetPlan: monthlyBudgetPlan[index] })) },
                fallback: Number(peakMonth.finance) > 0 ? `${peakMonth.month} mencatat Finance tertinggi sebesar ${window.Formatters.formatRupiah(peakMonth.finance)}. Bandingkan pola Finance dan Rekonsil terhadap Budget Plan tiap bulan.` : 'Budget Plan bulanan tersedia sebagai pembanding; belum ada transaksi bertanggal untuk menyimpulkan pola aktual.'
            },
            {
                id: 'budget-analysis', title: 'Analisa budget tahun depan',
                data: { previousBudget: context.budgetPlan, futureBudget: context.futureBudget, reasons: futureData.categories.map(({ title, value, pct }) => ({ title, value, pct })) },
                fallback: leadingReason ? `Kategori ${leadingReason.title} memberi kontribusi nilai Future Budget terbesar (${formatPercent(leadingReason.pct)}). Kenaikan total ${formatPercent(context.planGrowth)} dibanding Budget Plan; persentase tiap akun tetap perlu dibaca terhadap baseline akunnya masing-masing.` : `Future Budget ${futureDelta >= 0 ? 'naik' : 'turun'} ${window.Formatters.formatRupiah(Math.abs(futureDelta))}; rincian kategori belum tersedia.`
            },
            {
                id: 'conclusion', title: 'Kesimpulan eksekutif',
                data: { budgetPlan: context.budgetPlan, finance: context.financeTotal, reconcile: context.reconcileTotal, futureBudget: context.futureBudget, assets: { total: assetSummary.total, count: assetSummary.count } },
                fallback: `Prioritas tindak lanjut: pantau Finance terhadap Budget Plan, validasi kenaikan Future Budget ${formatPercent(context.planGrowth)}, dan jaga akurasi data ${Number(assetSummary.count || 0).toLocaleString('id-ID')} aset.`
            },
            {
                id: 'thank-you', title: 'Penutup',
                data: { scope: context.scopeLabel, period: context.activePeriod, presenter: context.presenterName },
                fallback: `Presentasi ${context.scopeLabel} untuk periode ${context.activePeriod} disampaikan oleh ${context.presenterName}. Terima kasih.`
            }
        ];
        return notes; // Smart Asset selalu ditampilkan (data global)
    }

    async function requestPresentationSlideAnalyses(slideNotes) {
        const client = window.SmartBaraCore.getClient();
        if (!client?.functions?.invoke || !window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION) throw new Error('Koneksi AI belum tersedia.');
        const { data, error } = await client.functions.invoke(window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION, {
            body: { action: 'analyze-presentation', slides: slideNotes.map(({ id, title, data }) => ({ id, title, data })) }
        });
        if (error) {
            let message = error.message || 'Permintaan analisa AI gagal.';
            try {
                const details = error.context instanceof Response ? await error.context.clone().json() : null;
                message = details?.error || details?.message || message;
            } catch (parseError) {}
            throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
        const analyses = Array.isArray(data?.slideAnalyses) ? data.slideAnalyses : [];
        const analysisById = Object.fromEntries(analyses.map(item => [String(item.id || ''), String(item.analysis || '').trim()]).filter(([id, analysis]) => id && analysis));
        if (!slideNotes.every(note => analysisById[note.id])) throw new Error('AI belum mengembalikan analisa untuk semua slide.');
        return { analyses: analysisById, label: `Analisa AI · ${data.provider || 'Aktif'}` };
    }

    function updatePresentationSlideAnalyses(result, slideNotes) {
        const deckContainer = document.getElementById('dashboardPresentationDeck');
        if (!deckContainer) return;
        slideNotes.forEach((note) => {
            const block = deckContainer.querySelector(`[data-presentation-ai-analysis="${note.id}"]`);
            if (!block) return;
            const text = block.querySelector('[data-presentation-ai-text]');
            const label = block.querySelector('[data-presentation-ai-label]');
            if (text) text.textContent = result.analyses[note.id];
            if (label) label.textContent = result.label;
        });
    }

    function renderPresentationDeck(context, slideNotes) {
        const deckContainer = document.getElementById('dashboardPresentationDeck');
        if (!deckContainer) return;
        const getSlideId = (slide) => slide?.dataset.presentationSlide
            || slide?.querySelector('[data-presentation-slide]')?.dataset.presentationSlide;
        if (presentationMonthlyChart) {
            presentationMonthlyChart.destroy();
            presentationMonthlyChart = null;
        }
        const slideBackgrounds = {
            briefing: 'assets/presentation-briefing.jpg',
            'kpi-overview': 'assets/presentation-kpi.jpg',
            'smart-asset': 'assets/presentation-smart-asset.jpg',
            pareto: 'assets/presentation-pareto.jpg',
            'budget-finance': 'assets/presentation-budget-finance.jpg',
            'reconcile-top': 'assets/presentation-reconcile.jpg',
            'monthly-trend': 'assets/presentation-monthly-trend.jpg',
            'budget-analysis': 'assets/presentation-budget-analysis.jpg',
            conclusion: 'assets/presentation-conclusion.jpg',
            'thank-you': 'assets/presentation-thank-you.jpg'
        };
        const slides = buildPresentationSlides(context).map((html) => ({
            html,
            id: html.match(/data-presentation-slide="([^"]+)"/)?.[1] || ''
        })).sort((left, right) => presentationSlideOrder.indexOf(left.id) - presentationSlideOrder.indexOf(right.id));
        const noteById = new Map(slideNotes.map(note => [note.id, note]));
        deckContainer.innerHTML = slides.map(({ html }, index) => `<div class="presentation-slide-wrapper ${index === 0 ? 'block' : 'hidden'}">${html}</div>`).join('');
        // Background aset tetap dipertahankan agar slide aset selalu memiliki background.
        deckContainer.querySelectorAll('.presentation-slide-wrapper').forEach((wrapper) => {
            const slide = wrapper.querySelector('.presentation-slide');
            const slideId = getSlideId(slide);
            const image = slideBackgrounds[slideId];
            if (!slide || !image) return;
            slide.style.backgroundImage = `linear-gradient(90deg, rgba(7, 12, 22, 0.94), rgba(7, 12, 22, 0.9) 50%, rgba(7, 12, 22, 0.96)), url("${image}")`;
            slide.style.backgroundSize = 'cover';
            slide.style.backgroundPosition = 'center';
            slide.style.backgroundRepeat = 'no-repeat';
        });
        deckContainer.querySelectorAll('.presentation-slide-wrapper').forEach((wrapper) => {
            const slide = wrapper.querySelector('.presentation-slide');
            const slideId = getSlideId(slide);
            const note = noteById.get(slideId);
            if (!slide || !note) return;
            const analysis = document.createElement('div');
            analysis.className = 'mt-4 shrink-0 rounded-xl border border-teal-400/20 bg-slate-950/80 p-3';
            analysis.dataset.presentationAiAnalysis = note.id;
            const label = document.createElement('p');
            label.className = 'm-0 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-300';
            label.dataset.presentationAiLabel = '';
            label.textContent = 'Analisa data · AI memproses';
            const text = document.createElement('p');
            text.className = 'mt-1 mb-0 text-[11px] leading-5 text-slate-100';
            text.dataset.presentationAiText = '';
            text.textContent = note.fallback;
            analysis.append(label, text);
            slide.appendChild(analysis);
        });

        const deckStyle = document.createElement('style');
        deckStyle.textContent = `
            #dashboardPresentationModal.presentation-fullscreen {
                padding: 0 !important;
                background: #000 !important;
                backdrop-filter: none !important;
            }
            #dashboardPresentationModal.presentation-fullscreen > div {
                max-width: none !important;
                height: 100dvh;
                border: 0 !important;
                border-radius: 0 !important;
                background: #000 !important;
                box-shadow: none !important;
            }
            #dashboardPresentationModal.presentation-fullscreen > div > :first-child {
                border-color: #000 !important;
                background: #000 !important;
            }
            #dashboardPresentationModal.presentation-fullscreen > div > .flex-1.overflow-auto {
                padding: 0 !important;
                overflow: hidden !important;
                background: #000 !important;
            }
            #dashboardPresentationModal.presentation-fullscreen #dashboardPresentationDeck {
                max-width: none !important;
                height: 100%;
                min-height: 0;
                background: #000 !important;
            }
            #dashboardPresentationModal.presentation-fullscreen .presentation-slide-wrapper {
                height: 100%;
                min-height: 0;
                background: #000 !important;
            }
            #dashboardPresentationModal.presentation-fullscreen .presentation-slide {
                height: 100% !important;
                min-height: 0 !important;
                overflow-y: auto;
                overscroll-behavior: contain;
                border-color: #000 !important;
                border-radius: 0 !important;
                padding: 1.5rem !important;
            }
            #dashboardPresentationModal.presentation-fullscreen [data-presentation-detail="monthly-trend"] > .mt-6.grid {
                grid-template-columns: minmax(0, 1fr) minmax(280px, 360px) !important;
                min-height: 0;
                flex: 1 1 auto;
                align-items: stretch;
            }
            #dashboardPresentationModal.presentation-fullscreen [data-presentation-detail="monthly-trend"] > .mt-6.grid > .space-y-4 {
                display: flex;
                flex-direction: column;
            }
            #dashboardPresentationModal.presentation-fullscreen [data-presentation-detail="monthly-trend"] > .mt-6.grid > .space-y-4 > div {
                flex: 1 1 0;
            }
            #dashboardPresentationModal.presentation-fullscreen [data-presentation-detail="monthly-trend"] .relative.min-h-\[260px\] {
                height: 320px !important;
                min-height: 320px !important;
                flex: none !important;
            }
            @media (max-width: 760px) {
                #dashboardPresentationModal.presentation-fullscreen [data-presentation-detail="monthly-trend"] > .mt-6.grid {
                    grid-template-columns: minmax(0, 1fr) !important;
                }
                #dashboardPresentationModal.presentation-fullscreen [data-presentation-detail="monthly-trend"] .relative.min-h-\[260px\] {
                    height: 260px !important;
                    min-height: 260px !important;
                }
            }
            .presentation-slide h2 {
                font-size: 1.8rem !important;
                line-height: 1.2 !important;
            }
            .presentation-slide h3 {
                font-size: 1.3rem !important;
                line-height: 1.3 !important;
            }
            .presentation-slide {
                box-sizing: border-box;
                height: min(72dvh, 760px);
                min-height: min(560px, calc(100dvh - 170px)) !important;
                overflow-y: auto;
                overflow-x: hidden;
                overscroll-behavior: contain;
                scrollbar-gutter: stable;
            }
            .presentation-slide p,
            .presentation-slide li,
            .presentation-slide span {
                font-size: 0.85rem !important;
                line-height: 1.45 !important;
            }
            .presentation-slide .rounded-2xl p,
            .presentation-slide .rounded-2xl span {
                font-size: 0.8rem !important;
            }
            .presentation-slide .rounded-2xl .text-2xl,
            .presentation-slide .rounded-2xl .text-3xl,
            .presentation-slide .rounded-2xl .text-xl {
                font-size: 1.2rem !important;
            }
            @media (max-width: 640px) {
                .presentation-slide {
                    height: min(68dvh, 680px);
                    min-height: min(480px, calc(100dvh - 160px)) !important;
                    padding: 1rem !important;
                    border-radius: 1rem !important;
                }
            }
            @media (max-width: 760px) {
                .presentation-slide[data-presentation-detail="monthly-trend"] > .mt-6.grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) !important;
                    flex: none !important;
                    height: auto !important;
                    min-height: 0;
                    align-items: start;
                }
                .presentation-slide[data-presentation-detail="monthly-trend"] > .mt-6.grid > div:first-child {
                    width: 100%;
                    min-width: 0;
                    min-height: 340px !important;
                    flex: none !important;
                }
                .presentation-slide[data-presentation-detail="monthly-trend"] .relative.min-h-\\[260px\\] {
                    width: 100%;
                    height: 260px !important;
                    min-width: 0;
                    min-height: 260px !important;
                    flex: none !important;
                }
                .presentation-slide[data-presentation-detail="monthly-trend"] .relative.min-h-\\[260px\\] canvas {
                    max-width: 100%;
                }
                .presentation-slide[data-presentation-detail="monthly-trend"] > .mt-6.grid > .space-y-4 {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 0.75rem;
                }
                .presentation-slide[data-presentation-detail="monthly-trend"] > .mt-6.grid > .space-y-4 > div {
                    min-width: 0;
                }
                .presentation-slide[data-presentation-detail="monthly-trend"] > .mt-6.grid > .space-y-4 > div:last-child {
                    grid-column: 1 / -1;
                }
            }
        `;
        deckContainer.appendChild(deckStyle);

        const modal = document.getElementById('dashboardPresentationModal');
        if (modal) modal.classList.remove('hidden');

        let currentSlide = 0;
        const setSlide = (nextSlide) => {
            const cards = [...deckContainer.querySelectorAll('.presentation-slide-wrapper')];
            currentSlide = Math.max(0, Math.min(nextSlide, cards.length - 1));
            cards.forEach((card, idx) => {
                card.classList.toggle('hidden', idx !== currentSlide);
                card.classList.toggle('block', idx === currentSlide);
            });
            const monthlyChartCanvas = cards[currentSlide]?.querySelector('#presentationMonthlyTrendChart');
            if (monthlyChartCanvas) renderPresentationMonthlyChart(monthlyChartCanvas);
            const prev = document.getElementById('dashboardPresentationPrev');
            const next = document.getElementById('dashboardPresentationNext');
            if (prev) prev.disabled = currentSlide === 0;
            if (next) {
                const isLastSlide = currentSlide === cards.length - 1;
                next.textContent = isLastSlide ? '✓' : '→';
                next.setAttribute('aria-label', isLastSlide ? 'Selesai' : 'Slide selanjutnya');
                next.title = isLastSlide ? 'Selesai' : 'Slide selanjutnya';
            }
            const counter = document.getElementById('dashboardPresentationCounter');
            if (counter) counter.textContent = `${String(currentSlide + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
        };

        const prevBtn = document.getElementById('dashboardPresentationPrev');
        if (prevBtn) {
            prevBtn.onclick = () => setSlide(currentSlide - 1);
        }
        const nextBtn = document.getElementById('dashboardPresentationNext');
        if (nextBtn) {
            nextBtn.onclick = () => {
                if (currentSlide >= deckContainer.querySelectorAll('.presentation-slide-wrapper').length - 1) {
                    const modal = document.getElementById('dashboardPresentationModal');
                    if (document.fullscreenElement === modal) document.exitFullscreen?.();
                    modal?.classList.remove('presentation-fullscreen');
                    if (modal) modal.classList.add('hidden');
                    return;
                }
                setSlide(currentSlide + 1);
            };
        }

        bindPresentationDetailTriggers();
        const modalEl = document.getElementById('dashboardPresentationModal');
        if (modalEl) {
            const onKeyDown = (event) => {
                if (modalEl.classList.contains('hidden')) return;
                if (event.key === 'ArrowRight' || event.key === 'PageDown') {
                    event.preventDefault();
                    const next = document.getElementById('dashboardPresentationNext');
                    if (next) next.click();
                }
                if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
                    event.preventDefault();
                    const prev = document.getElementById('dashboardPresentationPrev');
                    if (prev) prev.click();
                }
                if (event.key === 'Escape') {
                    if (document.fullscreenElement === modalEl) {
                        event.preventDefault();
                        document.exitFullscreen?.();
                        return;
                    }
                    modalEl.classList.remove('presentation-fullscreen');
                    modalEl.classList.add('hidden');
                }
            };
            window.__smartbara_presentation_keydown = onKeyDown;
            document.removeEventListener('keydown', window.__smartbara_presentation_keydown_old || (() => {}));
            document.addEventListener('keydown', onKeyDown);
            window.__smartbara_presentation_keydown_old = onKeyDown;
        }

        setSlide(0);
    }

    async function openPresentationDeck(openEvent) {
        const requestSequence = ++presentationAnalysisSequence;
        const modal = document.getElementById('dashboardPresentationModal');
        const deckContainer = document.getElementById('dashboardPresentationDeck');
        if (deckContainer) deckContainer.innerHTML = '<div class="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-300">Menyiapkan presentasi...</div>';
        if (modal) modal.classList.remove('hidden');

        if (openEvent?.isTrusted && modal) {
            if (modal.requestFullscreen) {
                modal.requestFullscreen().catch((error) => {
                    console.warn('Fullscreen presentation unavailable:', error);
                    modal.classList.add('presentation-fullscreen');
                    const fullscreenButton = document.getElementById('dashboardPresentationFullscreen');
                    if (fullscreenButton) {
                        fullscreenButton.textContent = '⤡';
                        fullscreenButton.setAttribute('aria-label', 'Keluar dari layar penuh');
                        fullscreenButton.title = 'Keluar dari layar penuh';
                    }
                });
            } else {
                modal.classList.add('presentation-fullscreen');
            }
        }

        try {
            const context = await buildPresentationContext();
            const slideNotes = buildPresentationSlideNotes(context);
            renderPresentationDeck(context, slideNotes);
            requestPresentationSlideAnalyses(slideNotes).then((result) => {
                if (requestSequence !== presentationAnalysisSequence) return;
                updatePresentationSlideAnalyses(result, slideNotes);
            }).catch((error) => {
                if (requestSequence !== presentationAnalysisSequence) return;
                const needsDeployment = /aksi AI tidak dikenal/i.test(String(error?.message || ''));
                document.querySelectorAll('[data-presentation-ai-label]').forEach((label) => {
                    label.textContent = needsDeployment
                        ? 'Analisa berbasis data · Edge Function perlu di-deploy'
                        : 'Analisa berbasis data · AI tidak tersedia';
                });
                console.warn('Presentation AI analysis unavailable:', error.message);
            });
        } catch (error) {
            console.error('Presentation deck error:', error);
            if (modal) modal.classList.add('hidden');
            alert('Presentasi live gagal dibuat: ' + (error?.message || error));
        }
    }

    async function exportPresentationDeck() {
        await window.SmartBaraLayout.withLoading('Menyusun presentasi', 'Menyelaraskan slide live ke PowerPoint...', async () => {
            const modal = document.getElementById('dashboardPresentationModal');
            const deckContainer = document.getElementById('dashboardPresentationDeck');
            if (!modal || !deckContainer) return;

            const wasHidden = modal.classList.contains('hidden');
            const wasFullscreen = modal.classList.contains('presentation-fullscreen');
            const originalStyle = modal.getAttribute('style');
            try {
                await Promise.all([
                    window.SmartBaraConfig.ensureLibrary('pptx'),
                    window.SmartBaraConfig.ensureLibrary('html-to-image'),
                    window.SmartBaraConfig.ensureLibrary('chartjs')
                ]);
                const PptxConstructor = window.PptxGenJS || window.pptxgen;
                if (!PptxConstructor || !window.htmlToImage?.toPng) throw new Error('Library PowerPoint atau render slide belum tersedia.');

                const context = await buildPresentationContext();
                const slideNotes = buildPresentationSlideNotes(context);
                let analysisById = Object.fromEntries(slideNotes.map(note => [note.id, note.fallback]));
                let analysisLabel = 'Analisa berbasis data';
                try {
                    const analysisResult = await Promise.race([
                        requestPresentationSlideAnalyses(slideNotes),
                        new Promise((resolve, reject) => window.setTimeout(() => reject(new Error('Analisa AI melewati batas waktu.')), 12000))
                    ]);
                    analysisById = analysisResult.analyses;
                    analysisLabel = analysisResult.label;
                } catch (error) {
                    console.warn('PowerPoint will use data-based slide notes:', error.message);
                }

                renderPresentationDeck(context, slideNotes);
                updatePresentationSlideAnalyses({ analyses: analysisById, label: analysisLabel }, slideNotes);
                modal.classList.add('presentation-fullscreen');
                modal.style.opacity = '0';
                modal.style.pointerEvents = 'none';
                const wrappers = [...deckContainer.querySelectorAll('.presentation-slide-wrapper')];
                wrappers.forEach(wrapper => {
                    wrapper.classList.remove('hidden');
                    wrapper.classList.add('block');
                });
                const monthlyCanvas = deckContainer.querySelector('#presentationMonthlyTrendChart');
                if (monthlyCanvas && !presentationMonthlyChart) {
                    renderPresentationMonthlyChart(monthlyCanvas);
                    await new Promise(resolve => window.setTimeout(resolve, 100));
                }
                const pptx = new PptxConstructor();
                pptx.layout = 'LAYOUT_WIDE';
                pptx.author = 'Smart BARA';
                pptx.company = 'Smart BARA';
                pptx.subject = `Presentasi Live ${context.activePeriod}`;
                pptx.title = `Smart BARA Presentasi Live ${context.activePeriod}`;
                pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'id-ID' };

                const imagePromises = [...deckContainer.querySelectorAll('.presentation-slide')].map((slide) => {
                    const match = slide.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
                    if (!match) return Promise.resolve();
                    return new Promise(resolve => {
                        const image = new Image();
                        image.onload = resolve;
                        image.onerror = resolve;
                        image.src = match[1];
                    });
                });
                await Promise.all([document.fonts?.ready, ...imagePromises]);
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                for (const [index, wrapper] of wrappers.entries()) {
                    const slideElement = wrapper.querySelector('.presentation-slide');
                    const imageData = await window.htmlToImage.toPng(slideElement, {
                        pixelRatio: 2,
                        cacheBust: true,
                        backgroundColor: '#070C16',
                        style: { visibility: 'visible' }
                    });
                    const slide = pptx.addSlide();
                    slide.background = { color: '070C16' };
                    slide.addImage({ data: imageData, x: 0, y: 0, w: 13.333, h: 7.5 });
                }

                await pptx.writeFile({ fileName: `SmartBARA_Presentasi_Live_${context.activePeriod}.pptx` });
                alert(`File PowerPoint ${wrappers.length} slide berhasil dibuat sesuai Presentasi Live (${analysisLabel}).`);
            } catch (error) {
                console.error('Export presentation deck error:', error);
                alert(`Gagal mengekspor presentasi: ${error.message || 'Unknown error'}`);
            } finally {
                modal.classList.toggle('presentation-fullscreen', wasFullscreen);
                if (originalStyle === null) modal.removeAttribute('style');
                else modal.setAttribute('style', originalStyle);
                if (wasHidden) modal.classList.add('hidden');
            }
        });
    }

    async function exportPresentationDeckLegacy() {
        await window.SmartBaraLayout.withLoading('Menyusun presentasi', 'Membuat ringkasan profesional ke PowerPoint...', async () => {
            try {
                await window.SmartBaraConfig.ensureLibrary('pptx');
                const PptxConstructor = window.PptxGenJS || window.pptxgen;
                if (!PptxConstructor) throw new Error('Library PowerPoint belum tersedia.');
                const context = await buildPresentationContext();
                const slideNotes = buildPresentationSlideNotes(context);
                let analysisById = Object.fromEntries(slideNotes.map(note => [note.id, note.fallback]));
                let analysisLabel = 'Analisa data';
                let analysisTimeout;
                try {
                    const analysisResult = await Promise.race([
                        requestPresentationSlideAnalyses(slideNotes),
                        new Promise((resolve, reject) => {
                            analysisTimeout = window.setTimeout(() => reject(new Error('Analisa AI melewati batas waktu.')), 12000);
                        })
                    ]);
                    analysisById = analysisResult.analyses;
                    analysisLabel = analysisResult.label;
                } catch (error) {
                    console.warn('PowerPoint will use data-based slide notes:', error.message);
                } finally {
                    window.clearTimeout(analysisTimeout);
                }

                const pptx = new PptxConstructor();
                pptx.layout = 'LAYOUT_WIDE';
                pptx.author = 'Smart BARA';
                pptx.company = 'Smart BARA';
                pptx.subject = `Presentasi Live ${context.activePeriod}`;
                pptx.title = `Smart BARA Presentasi Live ${context.activePeriod}`;
                pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'id-ID' };
                const slideWidth = 13.333;
                const slideHeight = 7.5;
                const assetSummary = context.assetSummary || {};
                const assetCategories = assetSummary.categories || [];
                const assetTopAssets = assetSummary.topAssets || [];
                const assetTopFiveValue = assetTopAssets.reduce((sum, asset) => sum + Number(asset.value || 0), 0);
                const futureReasonData = buildFutureBudgetReasons(context);
                const futureReasons = futureReasonData.categories;
                const futureSummary = futureReasonData.summaries[futureBudgetBaselineSource];
                const backgroundPaths = [
                    'assets/presentation-briefing.jpg',
                    'assets/presentation-kpi.jpg',
                    'assets/presentation-smart-asset.jpg',
                    'assets/presentation-pareto.jpg',
                    'assets/presentation-budget-finance.jpg',
                    'assets/presentation-reconcile.jpg',
                    'assets/presentation-monthly-trend.jpg',
                    'assets/presentation-budget-analysis.jpg',
                    'assets/presentation-conclusion.jpg',
                    'assets/presentation-thank-you.jpg'
                ];
                const backgroundImages = await Promise.all(backgroundPaths.map(async (path) => {
                    try {
                        const response = await fetch(path);
                        if (!response.ok) return null;
                        const blob = await response.blob();
                        return await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(blob);
                        });
                    } catch (error) {
                        return null;
                    }
                }));

                const addText = (slide, value, options = {}) => slide.addText(String(value ?? ''), {
                    fontFace: 'Aptos',
                    fontSize: 11,
                    color: 'E2E8F0',
                    margin: 0,
                    breakLine: false,
                    fit: 'shrink',
                    valign: 'mid',
                    ...options
                });
                const addBackground = (slide, index) => {
                    slide.background = { color: '070C16' };
                    const data = backgroundImages[index];
                    if (data) slide.addImage({ data, x: 0, y: 0, w: slideWidth, h: slideHeight });
                    slide.addShape(pptx.ShapeType.rect, {
                        x: 0, y: 0, w: slideWidth, h: slideHeight,
                        line: { color: '070C16', transparency: 100 },
                        fill: { color: '070C16', transparency: 25 }
                    });
                };
                const addHeader = (slide, eyebrow, title, index) => {
                    addText(slide, eyebrow.toUpperCase(), { x: 0.7, y: 0.38, w: 9, h: 0.22, fontSize: 10, bold: true, charSpacing: 1.4, color: '5EEAD4' });
                    addText(slide, title, { x: 0.7, y: 0.72, w: 11.4, h: 0.55, fontFace: 'Aptos Display', fontSize: 25, bold: true, color: 'FFFFFF' });
                    addText(slide, `${index + 1} / 10`, { x: 11.95, y: 0.42, w: 0.65, h: 0.2, fontSize: 9, bold: true, color: '99F6E4', align: 'right' });
                };
                const addPanel = (slide, x, y, w, h, color = '08111F') => slide.addShape(pptx.ShapeType.roundRect, {
                    x, y, w, h,
                    rectRadius: 0.08,
                    line: { color: '94A3B8', transparency: 68, width: 0.7 },
                    fill: { color, transparency: 14 }
                });
                const addAnalysis = (slide, noteId) => {
                    addPanel(slide, 0.62, 6.62, 12.1, 0.58, '020817');
                    addText(slide, analysisLabel.toUpperCase(), { x: 0.82, y: 6.72, w: 2.1, h: 0.14, fontSize: 7, bold: true, charSpacing: 0.8, color: '5EEAD4' });
                    addText(slide, analysisById[noteId] || '', { x: 0.82, y: 6.91, w: 11.7, h: 0.22, fontSize: 8.5, color: 'F1F5F9', valign: 'top' });
                };
                const addSlide = (index, eyebrow, title) => {
                    const slide = pptx.addSlide();
                    addBackground(slide, index);
                    addHeader(slide, eyebrow, title, index);
                    return slide;
                };

                const cover = addSlide(0, 'Executive briefing', 'Smart BARA');
                addText(cover, `Ringkasan Kinerja ${context.scopeLabel}`, { x: 0.72, y: 1.65, w: 9.8, h: 0.55, fontFace: 'Aptos Display', fontSize: 25, bold: true, color: 'FFFFFF' });
                addText(cover, `Presentasi ini merangkum kondisi Smart BARA dan Smart Asset pada periode ${context.activePeriod}.`, { x: 0.72, y: 2.35, w: 8.5, h: 0.45, fontSize: 13, color: 'CBD5E1', valign: 'top' });
                const coverCards = [
                    ['Departemen', context.scopeLabel],
                    ['Status approval', context.approvalBadge],
                    ['Tanggal', context.generatedAt]
                ];
                coverCards.forEach(([label, value], index) => {
                    const x = 0.72 + index * 4.0;
                    addPanel(cover, x, 3.25, 3.75, 0.82);
                    addText(cover, label.toUpperCase(), { x: x + 0.18, y: 3.42, w: 3.35, h: 0.15, fontSize: 8, charSpacing: 1, color: '94A3B8' });
                    addText(cover, value, { x: x + 0.18, y: 3.68, w: 3.35, h: 0.22, fontSize: 12, bold: true, color: 'FFFFFF' });
                });
                addText(cover, `PRESENTED BY  ${context.presenterName}`, { x: 8.4, y: 5.8, w: 4.1, h: 0.24, fontSize: 10, bold: true, charSpacing: 0.8, color: '5EEAD4', align: 'right' });
                addAnalysis(cover, 'briefing');

                const kpi = addSlide(1, 'KPI overview', 'Snapshot kinerja utama');
                const kpiCards = [
                    ['Budget Plan', context.budgetPlan, '34D399'],
                    ['Finance', context.financeTotal, '38BDF8'],
                    ['Rekonsil', context.reconcileTotal, '2DD4BF'],
                    ['Future Budget', context.futureBudget, 'A78BFA'],
                    ['Smart Asset', assetSummary.total || 0, 'FBBF24']
                ];
                kpiCards.forEach(([label, value, color], index) => {
                    const x = 0.7 + (index % 3) * 4.1;
                    const y = 1.55 + Math.floor(index / 3) * 1.35;
                    addPanel(kpi, x, y, 3.75, 0.95);
                    addText(kpi, label, { x: x + 0.18, y: y + 0.16, w: 3.35, h: 0.18, fontSize: 9, bold: true, color: '94A3B8' });
                    addText(kpi, window.Formatters.formatRupiah(value), { x: x + 0.18, y: y + 0.46, w: 3.35, h: 0.28, fontSize: 15, bold: true, color });
                });
                addPanel(kpi, 0.7, 4.55, 11.95, 1.55);
                addText(kpi, 'RANGKUMAN EKSEKUTIF', { x: 0.95, y: 4.78, w: 4, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.8, color: '5EEAD4' });
                addText(kpi, `Budget Plan ${window.Formatters.formatRupiah(context.budgetPlan)}   ·   Finance ${window.Formatters.formatRupiah(context.financeTotal)}   ·   Rekonsil ${window.Formatters.formatRupiah(context.reconcileTotal)}   ·   Future Budget ${window.Formatters.formatRupiah(context.futureBudget)}`, { x: 0.95, y: 5.15, w: 11.3, h: 0.5, fontSize: 11, bold: true, color: 'FFFFFF' });
                addAnalysis(kpi, 'kpi-overview');

                const assets = addSlide(2, 'Smart Asset portfolio', 'Portofolio aset & fokus nilai');
                const assetMetrics = [
                    ['Total nilai perolehan', window.Formatters.formatRupiah(assetSummary.total || 0)],
                    ['Rata-rata per aset', window.Formatters.formatRupiah(assetSummary.averageValue || 0)],
                    ['Jumlah aset', `${(assetSummary.count || 0).toLocaleString('id-ID')} · ${assetCategories.length} kategori`],
                    ['Nilai Top 5', window.Formatters.formatRupiah(assetTopFiveValue)]
                ];
                assetMetrics.forEach(([label, value], index) => {
                    const x = 0.7 + index * 3.1;
                    addPanel(assets, x, 1.45, 2.85, 0.82);
                    addText(assets, label.toUpperCase(), { x: x + 0.14, y: 1.6, w: 2.55, h: 0.15, fontSize: 7.5, bold: true, color: 'CBD5E1' });
                    addText(assets, value, { x: x + 0.14, y: 1.91, w: 2.55, h: 0.2, fontSize: 11, bold: true, color: 'FFFFFF' });
                });
                addPanel(assets, 0.7, 2.55, 5.75, 3.75);
                addPanel(assets, 6.7, 2.55, 5.95, 3.75);
                addText(assets, 'NILAI PER TIPE ASET', { x: 0.95, y: 2.78, w: 4.7, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.7, color: 'FCD34D' });
                assetCategories.slice(0, 5).forEach((category, index) => {
                    const y = 3.22 + index * 0.57;
                    addText(assets, `${category.type} · ${category.count.toLocaleString('id-ID')} aset`, { x: 0.95, y, w: 3.15, h: 0.18, fontSize: 8.5, color: 'E2E8F0' });
                    addText(assets, window.Formatters.formatRupiah(category.value), { x: 4.05, y, w: 2.1, h: 0.18, fontSize: 8.5, bold: true, color: 'FFFFFF', align: 'right' });
                    assets.addShape(pptx.ShapeType.rect, { x: 0.95, y: y + 0.28, w: 5.15, h: 0.08, line: { color: '1E293B', transparency: 100 }, fill: { color: '1E293B' } });
                    assets.addShape(pptx.ShapeType.rect, { x: 0.95, y: y + 0.28, w: Math.max(0.04, 5.15 * Math.min(1, category.pct / 100)), h: 0.08, line: { color: 'FBBF24', transparency: 100 }, fill: { color: 'FBBF24' } });
                });
                addText(assets, 'ASET DENGAN NILAI TERTINGGI', { x: 6.95, y: 2.78, w: 4.9, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.7, color: 'FCD34D' });
                assetTopAssets.forEach((asset, index) => {
                    const y = 3.18 + index * 0.58;
                    addText(assets, `${index + 1}. ${asset.name}`, { x: 6.95, y, w: 3.8, h: 0.2, fontSize: 8, color: 'F8FAFC', fit: 'shrink' });
                    addText(assets, window.Formatters.formatRupiah(asset.value), { x: 10.82, y, w: 1.55, h: 0.2, fontSize: 8, bold: true, color: 'FFFFFF', align: 'right' });
                    addText(assets, asset.type, { x: 7.18, y: y + 0.22, w: 5.1, h: 0.16, fontSize: 7, color: '94A3B8' });
                });
                addAnalysis(assets, 'smart-asset');

                const pareto = addSlide(3, 'Pareto', 'Kontributor Budget Plan terbesar');
                const topThreeShare = paretoBudget.slice(0, 3).reduce((sum, item) => sum + (Number(item.value || 0) / paretoTotal) * 100, 0);
                addPanel(pareto, 0.7, 1.5, 8.0, 4.8);
                addPanel(pareto, 8.95, 1.5, 3.7, 4.8);
                addText(pareto, 'DEPARTEMEN', { x: 0.95, y: 1.78, w: 4.0, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.8, color: 'C4B5FD' });
                paretoBudget.forEach((item, index) => {
                    const y = 2.25 + index * 0.72;
                    const share = (Number(item.value || 0) / paretoTotal) * 100;
                    addText(pareto, `${index + 1}. ${item.label || 'Departemen'}`, { x: 0.95, y, w: 5.8, h: 0.18, fontSize: 9, color: 'F8FAFC' });
                    addText(pareto, `${window.Formatters.formatRupiah(item.value)} · ${share.toFixed(1)}%`, { x: 6.7, y, w: 1.7, h: 0.18, fontSize: 8.5, bold: true, align: 'right', color: 'FFFFFF' });
                    pareto.addShape(pptx.ShapeType.rect, { x: 0.95, y: y + 0.3, w: 7.45, h: 0.11, line: { color: '1E293B', transparency: 100 }, fill: { color: '1E293B' } });
                    pareto.addShape(pptx.ShapeType.rect, { x: 0.95, y: y + 0.3, w: 7.45 * Math.min(1, share / 100), h: 0.11, line: { color: 'A78BFA', transparency: 100 }, fill: { color: 'A78BFA' } });
                });
                addText(pareto, 'KONSENTRASI TOP 3', { x: 9.25, y: 1.82, w: 3.0, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.7, color: 'C4B5FD' });
                addText(pareto, `${topThreeShare.toFixed(1)}%`, { x: 9.25, y: 2.45, w: 3.0, h: 0.65, fontFace: 'Aptos Display', fontSize: 34, bold: true, color: 'FFFFFF' });
                addText(pareto, `dari total Top 5 sebesar ${window.Formatters.formatRupiah(paretoTotal)}.`, { x: 9.25, y: 3.25, w: 2.95, h: 0.8, fontSize: 10, color: 'E2E8F0', valign: 'top' });
                addAnalysis(pareto, 'pareto');

                const mix = addSlide(4, 'Budget & finance', 'Komposisi budget, finance, dan rekonsil');
                const mixValues = [
                    ['Budget Plan', context.budgetPlan, '34D399'],
                    ['Finance', context.financeTotal, '38BDF8'],
                    ['Rekonsil', context.reconcileTotal, '2DD4BF'],
                    ['Future Budget', context.futureBudget, 'A78BFA']
                ];
                const mixMax = Math.max(...mixValues.map(item => item[1]), 1);
                mixValues.forEach(([label, value, color], index) => {
                    const y = 1.65 + index * 0.85;
                    addText(mix, label, { x: 0.75, y, w: 2.0, h: 0.18, fontSize: 9, color: 'CBD5E1' });
                    addText(mix, window.Formatters.formatRupiah(value), { x: 6.65, y, w: 2.1, h: 0.18, fontSize: 9, bold: true, color: 'FFFFFF', align: 'right' });
                    mix.addShape(pptx.ShapeType.rect, { x: 0.75, y: y + 0.3, w: 8.0, h: 0.17, line: { color: '1E293B', transparency: 100 }, fill: { color: '1E293B' } });
                    mix.addShape(pptx.ShapeType.rect, { x: 0.75, y: y + 0.3, w: 8.0 * Math.min(1, value / mixMax), h: 0.17, line: { color, transparency: 100 }, fill: { color } });
                });
                addPanel(mix, 9.15, 1.55, 3.45, 3.9);
                addText(mix, 'HASIL ANALISA', { x: 9.42, y: 1.84, w: 2.9, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.7, color: '6EE7B7' });
                addText(mix, `Future Budget ${context.futureBudget >= context.budgetPlan ? 'naik' : 'turun'} ${window.Formatters.formatRupiah(Math.abs(context.futureBudget - context.budgetPlan))} (${formatPercent(context.planGrowth)}).`, { x: 9.42, y: 2.28, w: 2.9, h: 0.8, fontSize: 11, color: 'F8FAFC', valign: 'top' });
                addText(mix, `Finance ${formatPercent(context.budgetPlan ? context.financeTotal / context.budgetPlan * 100 : 0)} dari Budget Plan.`, { x: 9.42, y: 3.34, w: 2.9, h: 0.7, fontSize: 10, color: 'E2E8F0', valign: 'top' });
                addAnalysis(mix, 'budget-finance');

                const topValues = addSlide(5, 'Rekonsil teratas', 'Finance dan rekonsil terbesar');
                [
                    ['FINANCE TERBESAR', financeTop, '38BDF8'],
                    ['REKONSIL TERBESAR', reconcileTop, '34D399']
                ].forEach(([title, rows, color], column) => {
                    const x = 0.7 + column * 6.15;
                    addPanel(topValues, x, 1.55, 5.85, 4.75);
                    addText(topValues, title, { x: x + 0.25, y: 1.82, w: 5.3, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.8, color });
                    rows.forEach((item, index) => {
                        const y = 2.28 + index * 0.73;
                        addText(topValues, `${index + 1}. ${item.label || 'Transaksi'}`, { x: x + 0.25, y, w: 3.65, h: 0.22, fontSize: 8.5, color: 'F8FAFC', fit: 'shrink' });
                        addText(topValues, window.Formatters.formatRupiah(item.value), { x: x + 3.95, y, w: 1.55, h: 0.22, fontSize: 8, bold: true, color: 'FFFFFF', align: 'right' });
                    });
                });
                addAnalysis(topValues, 'reconcile-top');

                const monthly = addSlide(6, 'Monthly trend', 'Grafik tren Finance vs Rekonsil');
                const monthlyRows = buildMonthlyFinanceVsReconcileSeries(context);
                const monthlyMax = Math.max(...monthlyRows.flatMap(item => [Math.abs(Number(item.finance || 0)), Math.abs(Number(item.reconcile || 0))]), 1);
                const chartX = 1.18;
                const chartY = 1.75;
                const chartWidth = 8.1;
                const chartHeight = 3.9;
                for (let tick = 0; tick <= 4; tick++) {
                    const y = chartY + chartHeight - (chartHeight * tick / 4);
                    monthly.addShape(pptx.ShapeType.rect, { x: chartX, y, w: chartWidth, h: 0.008, line: { color: '64748B', transparency: 100 }, fill: { color: '64748B', transparency: 55 } });
                    addText(monthly, window.Formatters.formatRupiah(monthlyMax * tick / 4), { x: 0.55, y: y - 0.08, w: 0.55, h: 0.14, fontSize: 6.5, color: 'CBD5E1', align: 'right' });
                }
                monthlyRows.forEach((item, index) => {
                    const groupWidth = chartWidth / monthlyRows.length;
                    const barWidth = 0.19;
                    const gap = 0.035;
                    const left = chartX + index * groupWidth + (groupWidth - barWidth * 2 - gap) / 2;
                    const financeHeight = chartHeight * Math.abs(Number(item.finance || 0)) / monthlyMax;
                    const reconcileHeight = chartHeight * Math.abs(Number(item.reconcile || 0)) / monthlyMax;
                    monthly.addShape(pptx.ShapeType.rect, { x: left, y: chartY + chartHeight - financeHeight, w: barWidth, h: Math.max(0.025, financeHeight), line: { color: '38BDF8', transparency: 100 }, fill: { color: '38BDF8' } });
                    monthly.addShape(pptx.ShapeType.rect, { x: left + barWidth + gap, y: chartY + chartHeight - reconcileHeight, w: barWidth, h: Math.max(0.025, reconcileHeight), line: { color: 'A855F7', transparency: 100 }, fill: { color: 'A855F7' } });
                    addText(monthly, item.month, { x: chartX + index * groupWidth, y: chartY + chartHeight + 0.08, w: groupWidth, h: 0.16, fontSize: 7, color: 'CBD5E1', align: 'center' });
                });
                addText(monthly, 'Finance', { x: 3.55, y: 1.42, w: 1.0, h: 0.16, fontSize: 8, bold: true, color: '7DD3FC' });
                addText(monthly, 'Rekonsil', { x: 4.8, y: 1.42, w: 1.0, h: 0.16, fontSize: 8, bold: true, color: 'D8B4FE' });
                addPanel(monthly, 9.65, 1.65, 2.95, 3.9);
                addText(monthly, `Kenaikan anggaran ${formatPercent(context.planGrowth)}`, { x: 9.92, y: 1.98, w: 2.42, h: 0.55, fontSize: 14, bold: true, color: 'FFFFFF' });
                addText(monthly, 'Finance dihitung dari debit dikurangi kredit; Rekonsil memakai nilai final yang disesuaikan.', { x: 9.92, y: 2.8, w: 2.42, h: 1.0, fontSize: 10, color: 'CBD5E1', valign: 'top' });
                addAnalysis(monthly, 'monthly-trend');

                const budgetAnalysis = addSlide(7, 'Analisa budget tahun depan', 'Mengapa anggaran berubah?');
                addText(budgetAnalysis, `Baseline ${futureBudgetBaselineSource === 'budget' ? 'Budget Plan' : 'Rekonsil · Proyeksi Aktual 12 Bulan'}: ${window.Formatters.formatRupiah(futureSummary.previousTotal)}`, { x: 0.75, y: 1.45, w: 7.6, h: 0.2, fontSize: 10, color: 'CBD5E1' });
                addText(budgetAnalysis, `Future Budget: ${window.Formatters.formatRupiah(futureSummary.futureTotal)}  ·  ${futureSummary.increase >= 0 ? 'Naik' : 'Turun'} ${window.Formatters.formatRupiah(Math.abs(futureSummary.increase))} (${formatPercent(futureSummary.percent)})`, { x: 0.75, y: 1.82, w: 11.7, h: 0.3, fontSize: 14, bold: true, color: 'FFFFFF' });
                futureReasons.forEach((reason, index) => {
                    const y = 2.45 + index * 0.72;
                    addText(budgetAnalysis, `${reason.title} · ${formatPercent(reason.pct)}`, { x: 0.8, y, w: 3.4, h: 0.18, fontSize: 9, bold: true, color: 'FDE68A' });
                    addText(budgetAnalysis, window.Formatters.formatRupiah(reason.value), { x: 4.25, y, w: 2.0, h: 0.18, fontSize: 9, bold: true, color: 'FFFFFF', align: 'right' });
                    addText(budgetAnalysis, reason.accounts.slice(0, 2).map(account => account.name).join(' · ') || reason.detail, { x: 6.55, y, w: 5.65, h: 0.2, fontSize: 7.8, color: 'CBD5E1', fit: 'shrink' });
                    budgetAnalysis.addShape(pptx.ShapeType.rect, { x: 0.8, y: y + 0.31, w: 11.4, h: 0.08, line: { color: '1E293B', transparency: 100 }, fill: { color: '1E293B' } });
                    budgetAnalysis.addShape(pptx.ShapeType.rect, { x: 0.8, y: y + 0.31, w: 11.4 * Math.min(1, reason.pct / 100), h: 0.08, line: { color: 'FBBF24', transparency: 100 }, fill: { color: 'FBBF24' } });
                });
                addAnalysis(budgetAnalysis, 'budget-analysis');

                const conclusion = addSlide(8, 'Conclusion', 'Kesimpulan eksekutif');
                addPanel(conclusion, 0.7, 1.5, 5.85, 4.75);
                addPanel(conclusion, 6.75, 1.5, 5.85, 4.75);
                addText(conclusion, 'KINERJA SMART BARA', { x: 0.98, y: 1.82, w: 5.0, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.8, color: '5EEAD4' });
                addText(conclusion, [
                    `Budget Plan: ${window.Formatters.formatRupiah(context.budgetPlan)}`,
                    `Finance: ${window.Formatters.formatRupiah(context.financeTotal)}`,
                    `Rekonsil: ${window.Formatters.formatRupiah(context.reconcileTotal)}`,
                    `Budget tahun depan: ${window.Formatters.formatRupiah(context.futureBudget)}`,
                    `${context.futureBudget >= context.budgetPlan ? 'Kenaikan' : 'Penurunan'}: ${window.Formatters.formatRupiah(Math.abs(context.futureBudget - context.budgetPlan))} (${formatPercent(context.planGrowth)})`
                ].join('\n'), { x: 0.98, y: 2.25, w: 5.0, h: 2.7, fontSize: 10, color: 'F8FAFC', breakLine: true, valign: 'top' });
                addText(conclusion, 'KINERJA SMART ASSET', { x: 7.03, y: 1.82, w: 5.0, h: 0.18, fontSize: 9, bold: true, charSpacing: 0.8, color: 'FCD34D' });
                addText(conclusion, [
                    `Total perolehan: ${window.Formatters.formatRupiah(assetSummary.total || 0)} (${(assetSummary.count || 0).toLocaleString('id-ID')} aset)`,
                    `Rata-rata: ${window.Formatters.formatRupiah(assetSummary.averageValue || 0)}`,
                    `Tipe terbesar: ${assetCategories[0]?.type || 'Belum ada data'} (${formatPercent(assetCategories[0]?.pct || 0)})`,
                    `Aset tertinggi: ${assetTopAssets[0]?.name || 'Belum ada data'} (${window.Formatters.formatRupiah(assetTopAssets[0]?.value || 0)})`
                ].join('\n'), { x: 7.03, y: 2.25, w: 5.0, h: 2.7, fontSize: 9, color: 'F8FAFC', breakLine: true, valign: 'top' });
                addAnalysis(conclusion, 'conclusion');

                const thankYou = addSlide(9, 'Smart BARA · Executive briefing', 'Terima kasih');
                addText(thankYou, `Rangkuman kinerja ${context.scopeLabel} · ${context.activePeriod}`, { x: 1.1, y: 2.75, w: 11.1, h: 0.35, fontSize: 18, color: 'E2E8F0', align: 'center' });
                addText(thankYou, 'PRESENTED BY', { x: 4.6, y: 4.05, w: 4.1, h: 0.2, fontSize: 9, bold: true, charSpacing: 1.1, color: '5EEAD4', align: 'center' });
                addText(thankYou, context.presenterName, { x: 2.2, y: 4.45, w: 8.9, h: 0.45, fontFace: 'Aptos Display', fontSize: 24, bold: true, color: 'FFFFFF', align: 'center' });
                addAnalysis(thankYou, 'thank-you');

                await pptx.writeFile({ fileName: `SmartBARA_Presentasi_Live_${context.activePeriod}.pptx` });
                alert('File PowerPoint 10 slide dengan konten live, gambar, dan analisa berhasil dibuat.');
            } catch (error) {
                console.error('Export presentation deck error:', error);
                alert(`Gagal mengekspor presentasi: ${error.message || 'Unknown error'}`);
            }
        });
    }

    function getPeriodYear(periodValue) {
        if (!periodValue) return new Date().getFullYear();
        const match = String(periodValue).match(/(\d{4})$/);
        if (match) return Number(match[1]);
        const numeric = Number.parseInt(String(periodValue), 10);
        return Number.isFinite(numeric) ? numeric : new Date().getFullYear();
    }

    function getYearScopedTransactions() {
        const activePeriod = String(window.SmartBaraCore.getActivePeriod() || '').trim();
        const allTransactions = [];

        const matchesActivePeriod = (periodName) => {
            const candidate = String(periodName || '').trim();
            if (!candidate) return true;
            return candidate === activePeriod || candidate.toUpperCase() === activePeriod.toUpperCase();
        };

        const gatherRange = (periodRows) => {
            if (!Array.isArray(periodRows)) return;
            periodRows.forEach((row) => {
                if (!row) return;
                const transaction = { ...row };
                const periodName = String(transaction.period_name || transaction.period || activePeriod).trim() || activePeriod;
                if (!matchesActivePeriod(periodName)) return;
                allTransactions.push(transaction);
            });
        };

        const gatherStorePayload = (payload) => {
            if (!payload) return;
            if (Array.isArray(payload)) {
                gatherRange(payload);
                return;
            }
            if (typeof payload === 'object') {
                const directRows = Array.isArray(payload.row_data)
                    ? payload.row_data
                    : Array.isArray(payload.rows_data)
                        ? payload.rows_data
                        : Array.isArray(payload.dept_data)
                            ? payload.dept_data
                            : null;
                if (directRows) {
                    gatherRange(directRows);
                    return;
                }
                Object.values(payload).forEach((value) => {
                    if (Array.isArray(value)) gatherRange(value);
                    else if (value && typeof value === 'object') {
                        const nested = Array.isArray(value.row_data)
                            ? value.row_data
                            : Array.isArray(value.rows_data)
                                ? value.rows_data
                                : Array.isArray(value.dept_data)
                                    ? value.dept_data
                                    : null;
                        if (nested) gatherRange(nested);
                    }
                });
            }
        };

        try {
            const activeStoreKey = `smartbara_store_${activePeriod}`;
            const activeStoreRaw = localStorage.getItem(activeStoreKey);
            if (activeStoreRaw) {
                try {
                    gatherStorePayload(JSON.parse(activeStoreRaw));
                } catch (error) {
                    console.warn('Dashboard active-period store parse issue:', error);
                }
            }
            Object.keys(localStorage).forEach((key) => {
                if (!key.startsWith('smartbara_store_') || key.includes('_updated_at') || key === activeStoreKey) return;
                const periodName = key.replace('smartbara_store_', '');
                if (!periodName || !matchesActivePeriod(periodName)) return;
                const raw = localStorage.getItem(key);
                if (!raw) return;
                try {
                    gatherStorePayload(JSON.parse(raw));
                } catch (error) {
                    console.warn('Dashboard active-period cache parse issue:', error);
                }
            });
        } catch (error) {
            console.warn('Dashboard active-period scan issue:', error);
        }

        // Data localStorage sudah memuat seluruh departemen periode aktif.
        // Jangan menambahkan getAllTransactions() lagi karena itu data in-memory
        // yang sama, sehingga total transaksi tercatat tidak terhitung dua kali.
        if (allTransactions.length === 0) {
            const currentStoreTransactions = Array.isArray(window.SmartBaraCore.getAllTransactions?.()) ? window.SmartBaraCore.getAllTransactions() : [];
            currentStoreTransactions.forEach((row) => {
                if (!row) return;
                const periodName = String(row.period_name || row.period || activePeriod).trim() || activePeriod;
                if (!matchesActivePeriod(periodName)) return;
                allTransactions.push(row);
            });
        }

        return allTransactions;
    }

    function getMonthlyTransactionBreakdown() {
        const transactions = getYearScopedTransactions();
        const activePeriod = String(window.SmartBaraCore.getActivePeriod() || '');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const counts = monthNames.map(() => 0);
        const monthlyLabels = monthNames.map((label, index) => ({ label, monthIndex: index }));
        const monthAliases = {
            januari: 1, jan: 1,
            februari: 2, feb: 2,
            maret: 3, mar: 3,
            april: 4, apr: 4,
            mei: 5, may: 5,
            juni: 6, jun: 6,
            juli: 7, jul: 7,
            agustus: 8, agu: 8, agt: 8, agst: 8, agts: 8, ags: 8, aug: 8,
            september: 9, sep: 9,
            oktober: 10, okt: 10, oct: 10,
            november: 11, nov: 11,
            desember: 12, des: 12, dec: 12
        };

        const getMonthFromText = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const text = String(value).trim();
            if (!text) return null;

            const directNumber = Number(text);
            if (Number.isFinite(directNumber) && directNumber >= 1 && directNumber <= 12) return directNumber;

            const monthMatch = text.match(/(?:^|[^a-zA-Z])((?:jan|januari|feb|februari|mar|maret|apr|april|mei|may|jun|juni|jul|juli|agu|ags|agt|agst|agts|aug|agustus|sep|september|okt|oktober|oct|nov|november|des|desember|dec))(?=\b|[^a-zA-Z])/i);
            if (monthMatch) return monthAliases[monthMatch[1].toLowerCase()] || null;

            const isoMonth = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
            if (isoMonth) return Number(isoMonth[2]);

            const dmyMonth = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
            if (dmyMonth) return Number(dmyMonth[2]);

            const monthName = text.match(/([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
            if (monthName) {
                const equivalent = monthAliases[monthName[1].toLowerCase()];
                if (equivalent) return equivalent;
            }

            const date = new Date(text);
            if (!Number.isNaN(date.getTime())) return date.getMonth() + 1;
            return null;
        };

        transactions.forEach((transaction) => {
            const period = String(transaction.period_name || transaction.period || activePeriod).trim() || activePeriod;
            const rawDate = String(transaction.tanggal || transaction.date || transaction.tgl || '').trim();
            const sourceDate = rawDate ? window.SmartBaraFormatters.normalizeDate(rawDate) : '';
            const monthFromDate = sourceDate ? getMonthFromText(sourceDate) : null;
            const monthFromFields = getMonthFromText(transaction.bulan || transaction.month || transaction.bulan_name || transaction.month_name || transaction.bln || transaction.period_month || '');
            const fallbackMonth = getPeriodYear(period) === getPeriodYear(activePeriod)
                ? getMonthFromText(period)
                : null;
            const targetMonth = monthFromDate ?? monthFromFields ?? fallbackMonth;

            if (targetMonth && targetMonth >= 1 && targetMonth <= 12) {
                counts[targetMonth - 1] += 1;
                return;
            }
            counts[11] += 1;
        });

        return monthlyLabels.map((entry, index) => ({
            label: entry.label,
            count: counts[index],
            total: counts[index]
        }));
    }

    function getSyncAuditEntries() {
        const history = window.SmartBaraCore.getSyncHistory?.(10) || [];
        if (Array.isArray(history) && history.length) {
            return history.map(entry => ({
                time: entry.time || new Date(entry.at || Date.now()).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
                user: entry.userName || entry.user || 'System',
                message: entry.message || 'Sinkronisasi data',
                type: entry.type || 'info'
            }));
        }

        const fallback = {
            time: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
            user: window.SmartBaraCore.getUser()?.email || 'System',
            message: 'Belum ada riwayat sinkronisasi tersimpan',
            type: 'info'
        };
        return [fallback];
    }

    function showMetricDetail(metricKey) {
        const activePeriod = window.SmartBaraCore.getActivePeriod();
        const monthsPassed = getElapsedMonthsForPeriod(activePeriod);
        const budgetPlan = parseCurrencyText(document.getElementById('dashBudgetTotal')?.textContent || '0');
        const futureBudget = parseCurrencyText(document.getElementById('dashFutureBudgetTotal')?.textContent || '0');
        const reconcileTotal = parseCurrencyText(document.getElementById('dashReconcileTotal')?.textContent || '0');
        const financeTotal = parseCurrencyText(document.getElementById('dashFinanceTotal')?.textContent || '0');
        const creatorTotal = parseCurrencyText(document.getElementById('dashCreatorTotal')?.textContent || '0');
        const deltaFuture = futureBudget - budgetPlan;
        const deltaFuturePct = budgetPlan ? (Math.abs(deltaFuture) / budgetPlan) * 100 : 0;
        const forecast = reconcileTotal > 0 ? (reconcileTotal / monthsPassed) * 12 : 0;
        const deltaReconcile = forecast - reconcileTotal;
        const deltaReconcilePct = reconcileTotal ? (Math.abs(deltaReconcile) / reconcileTotal) * 100 : 0;
        const healthScore = Number(document.getElementById('dashHealthScore')?.textContent || 0);
        const activeDepts = Number(document.getElementById('dashActiveDepts')?.textContent || 0);
        const transactionCount = Number((document.getElementById('dashTransactionsCount')?.textContent || '0').replace(/[^0-9]/g, '')) || 0;
        const syncText = document.getElementById('dashLastSync')?.textContent || 'Online • 00:00';
        const approvalStatus = document.getElementById('dashApprovalStatus')?.textContent || 'Belum disetujui';
        const approvalBadge = document.getElementById('dashApprovalBadge')?.textContent || 'Pending';
        const getAccountLabel = row => String(row?.nama_akun || row?.account || row?.account_name || row?.name || row?.nama || row?.akun || '').trim() || 'Akun tidak bernama';
        const getAccountValue = row => {
            const direct = Number(row?.total_tahun ?? row?.total ?? row?.nominal ?? row?.value ?? row?.budget_total ?? row?.anggaran ?? 0);
            if (Number.isFinite(direct) && direct !== 0) return direct;
            const months = ['jan','feb','mar','apr','mei','jun','jul','agu','sep','okt','nov','des'];
            const monthly = Array.isArray(row?.budget)
                ? row.budget
                : months.map(month => Number(row?.[month] ?? row?.[`budget_${month}`] ?? row?.[`budget ${month}`] ?? 0));
            return monthly.reduce((sum, value) => sum + (Number(value) || 0), 0);
        };
        const aggregateAccounts = (rows) => {
            const accounts = new Map();
            rows.forEach((row) => {
                const name = getAccountLabel(row);
                const key = name.toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
                const current = accounts.get(key);
                if (current) current.total += Number(getAccountValue(row)) || 0;
                else accounts.set(key, { name, total: Number(getAccountValue(row)) || 0 });
            });
            return accounts;
        };
        const previousAccounts = aggregateAccounts(window.__smartbaraBudgetRows || []);
        const futureAccounts = aggregateAccounts(window.__smartbaraFutureBudgetRows || []);
        const budgetAccountRows = Array.from(previousAccounts.values())
            .filter(account => account.total > 0)
            .sort((left, right) => right.total - left.total)
            .map(account => [account.name, window.Formatters.formatRupiah(account.total)]);
        const accountKeys = new Set([...previousAccounts.keys(), ...futureAccounts.keys()]);
        const accountGrowthRows = Array.from(accountKeys, (key) => {
            const previous = previousAccounts.get(key);
            const future = futureAccounts.get(key);
            const previousTotal = previous?.total || 0;
            const futureTotal = future?.total || 0;
            const increase = futureTotal - previousTotal;
            const percent = previousTotal > 0 ? (increase / previousTotal) * 100 : futureTotal > 0 ? null : 0;
            const name = future?.name || previous?.name || 'Akun tidak bernama';
            return {
                name,
                previousTotal,
                futureTotal,
                increase,
                percent,
                analysis: buildLocalGrowthAnalysis(name, previousTotal, futureTotal, increase, percent)
            };
        }).sort((left, right) => right.futureTotal - left.futureTotal || right.previousTotal - left.previousTotal || left.name.localeCompare(right.name, 'id-ID'));

        const detailMap = {
            'data-health': {
                title: 'Detail Data Health',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Skor kesehatan data: ${healthScore}/100`,
                    `Rumus: 100 - (jumlah data bermasalah × 2)`,
                    `Status akhir: ${document.getElementById('dashHealthState')?.textContent || 'Normal'}`,
                    `Catatan: ${document.getElementById('dashDataQuality')?.textContent || '0 item perlu review'}`
                ]
            },
            'departments-active': {
                title: 'Detail Departemen Aktif',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Jumlah departemen aktif saat ini: ${activeDepts}`,
                    `Rumus: count(departemen yang dipilih setelah filter)`,
                    `Artinya: data dashboard saat ini menampilkan hanya untuk ${activeDepts} departemen yang sedang aktif.`
                ]
            },
            'transactions-count': {
                title: 'Detail Transaksi Tercatat',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Total transaksi YTD tahun aktif: ${transactionCount.toLocaleString('id-ID')}`,
                    `Rumus: jumlah semua baris transaksi dari Januari sampai bulan aktif pada tahun ini`,
                    `Digunakan untuk mengukur volume data dan validitas dasbor saat ini.`
                ],
                monthlyRows: getMonthlyTransactionBreakdown(),
                period: activePeriod
            },
            'sync-status': {
                title: 'Detail Sinkronisasi',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Status sinkron: ${syncText}`,
                    `Rumus: waktu terakhir update data yang tersimpan / dibaca dari sumber data`,
                    `Intinya: aplikasi menampilkan waktu paling baru ketika data berhasil diperbarui.`
                ],
                syncHistory: getSyncAuditEntries()
            },
            'approval-status': {
                title: 'Detail Approval',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Status approval: ${approvalBadge}`,
                    `Keterangan: ${approvalStatus}`,
                    `Rumus: keputusan approval = Approved | Rejected | Pending berdasarkan periode yang sedang aktif`,
                    `Fungsi: memastikan periode yang dipilih telah disetujui sebelum data dipakai untuk keputusan lebih lanjut.`
                ]
            },
            'budget-plan': {
                title: 'Detail Budget Plan Akun',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Nilai budget plan akun: ${window.Formatters.formatRupiah(budgetPlan)}`,
                    `Rumus: total plafon anggaran 12 bulan untuk semua akun yang aktif`,
                    `Sumber: jumlah seluruh anggaran dari data budget plan yang sedang dipilih.`
                ],
                accountRows: budgetAccountRows
            },
            'finance': {
                title: 'Detail Data Finance',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Nilai finance: ${window.Formatters.formatRupiah(financeTotal)}`,
                    `Rumus: Total Debit - Total Kredit`,
                    `Sumber: seluruh data transaksi finance pada periode aktif.`
                ]
            },
            'reconcile': {
                title: 'Detail Total Rekonsiliasi',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Nilai rekonsiliasi: ${window.Formatters.formatRupiah(reconcileTotal)}`,
                    `Rumus: total nilai rekonsil + penyesuaian manual`,
                    `Fungsi: nilai final yang sudah diproses dan disesuaikan untuk periode aktif.`
                ]
            },
            'variance': {
                title: 'Detail Selisih Rekonsiliasi',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Selisih: ${window.Formatters.formatRupiah(Math.abs(financeTotal - reconcileTotal))}`,
                    `Rumus: |Finance - Rekonsiliasi|`,
                    `Arah: ${financeTotal >= reconcileTotal ? 'positif / surplus' : 'negatif / defisit'}`,
                    `Tujuan: memetakan gap antara data finance dan hasil rekonsiliasi.`
                ]
            },
            'creator': {
                title: 'Detail Budget Creator Planning',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Total kebutuhan: ${window.Formatters.formatRupiah(creatorTotal)}`,
                    `Rumus: Σ(quantity × estimated_unit_price)`,
                    `Pembacaan: total nilai kebutuhan dari seluruh rencana anggaran yang dibuat di Budget Creator.`
                ]
            },
            'prediction': {
                title: 'Detail Prediksi Tahun Berjalan',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Total rekonsil saat ini: ${window.Formatters.formatRupiah(reconcileTotal)}`,
                    `Bulan berjalan: ${monthsPassed}`,
                    `Rumus: (nilai rekonsil / bulan berjalan) × 12`,
                    `Hasil: ${window.Formatters.formatRupiah(forecast)}`,
                    `Artinya: jika tren saat ini dipertahankan, estimasi akhir tahun adalah ${window.Formatters.formatRupiah(forecast)}.`
                ],
                accountRows: budgetAccountRows
            },
            'reconcile-change': {
                title: 'Detail Prediksi vs Rekonsil',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Prediksi akhir tahun: ${window.Formatters.formatRupiah(forecast)}`,
                    `Nilai rekonsil saat ini: ${window.Formatters.formatRupiah(reconcileTotal)}`,
                    `Rumus: (prediksi - rekonsil) ÷ rekonsil × 100 = ${deltaReconcilePct.toFixed(1)}%`,
                    `Contoh hitung: Rp ${reconcileTotal.toLocaleString('id-ID')} × 50% = Rp ${deltaReconcile.toLocaleString('id-ID')}; total akhir = Rp ${reconcileTotal.toLocaleString('id-ID')} + Rp ${deltaReconcile.toLocaleString('id-ID')} = Rp ${forecast.toLocaleString('id-ID')}`,
                    `Nilai selisih absolut: ${window.Formatters.formatRupiah(deltaReconcile)}`,
                    `Catatan: 50% bukan berarti 3,7M × 50% = 74M. Yang benar adalah 3,7M × 50% = 1,86M; lalu 3,7M + 1,86M = 5,58M.`
                ]
            },
            'plan-change': {
                title: 'Detail Kenaikan Budget Plan vs Anggaran Masa Depan',
                lines: [
                    `Budget plan akun: ${window.Formatters.formatRupiah(budgetPlan)}`,
                    `Anggaran masa depan: ${window.Formatters.formatRupiah(futureBudget)}`,
                    `Rumus: anggaran masa depan - budget plan = ${window.Formatters.formatRupiah(deltaFuture)}`,
                    `Persentase: ${deltaFuturePct.toFixed(1)}%`,
                    `Arah: ${deltaFuture >= 0 ? 'naik' : 'turun'}`
                ]
            },
            'future': {
                title: 'Detail Anggaran Masa Depan',
                lines: [
                    `Periode aktif: ${activePeriod}`,
                    `Total anggaran masa depan: ${window.Formatters.formatRupiah(futureBudget)}`,
                    `Total akun yang dibandingkan: ${accountGrowthRows.length}`,
                    `Rumus: jumlahkan semua proyek per nama akun, lalu bandingkan Anggaran Masa Depan dengan Budget Plan pada lingkup yang sama.`,
                    `Catatan: akun yang hanya ada pada salah satu dataset tetap ditampilkan; nominal pada dataset yang tidak memiliki akun tersebut dihitung Rp 0.`
                ],
                accountGrowthRows,
                period: activePeriod,
                departments: window.SmartBaraCore.getSelectedDepartments()
            },
            'plan-growth-percent': {
                title: 'Detail Persentase Kenaikan',
                lines: [
                    `Budget plan akun: ${window.Formatters.formatRupiah(budgetPlan)}`,
                    `Anggaran masa depan: ${window.Formatters.formatRupiah(futureBudget)}`,
                    `Rumus: |anggaran masa depan - budget plan| ÷ budget plan × 100`,
                    `Hasil: ${deltaFuturePct.toFixed(1)}%`,
                    `Interpretasi: kenaikan proporsional dari budget plan ke anggaran masa depan adalah ${deltaFuturePct.toFixed(1)}%.`
                ]
            }
        };
        const data = detailMap[metricKey] || {
            title: 'Detail indikator',
            lines: ['Tidak ada detail untuk indikator ini.']
        };
        const modal = document.getElementById('dashboardMetricModal');
        if (!modal) return;
        const metricBody = document.getElementById('dashboardMetricBody');
        const toRowHtml = (label, value) => `
            <tr>
                <td class="border-b border-white/10 px-2 py-2 text-left text-slate-200">${window.Formatters.escapeHtml(label)}</td>
                <td class="border-b border-white/10 px-2 py-2 text-right font-semibold text-emerald-300 tabular-nums">${window.Formatters.escapeHtml(value)}</td>
            </tr>
        `;

        const accountRows = [];
        if (Array.isArray(data.monthlyRows) && data.monthlyRows.length) {
            accountRows.push(`
                <div class="mt-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
                    <div class="max-h-80 overflow-y-auto">
                        <table class="w-full border-collapse text-xs">
                            <thead class="sticky top-0 z-10 bg-slate-800/90 text-slate-300 backdrop-blur-sm">
                                <tr>
                                    <th class="px-2 py-2 text-left font-bold uppercase tracking-wide">Bulan</th>
                                    <th class="px-2 py-2 text-right font-bold uppercase tracking-wide">Jumlah transaksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.monthlyRows.map(item => `
                                    <tr>
                                        <td class="border-b border-white/10 px-2 py-2 text-slate-200">${window.Formatters.escapeHtml(item.label)}</td>
                                        <td class="border-b border-white/10 px-2 py-2 text-right font-semibold text-emerald-300 tabular-nums">${Number(item.count || 0).toLocaleString('id-ID')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `);
        } else if (Array.isArray(data.accountGrowthRows)) {
            accountRows.push(`
                <div class="mt-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
                        <div>
                            <p class="m-0 text-xs font-bold text-white">Perbandingan per akun</p>
                            <p id="dashboardGrowthAnalysisStatus" class="m-0 mt-1 text-[10px] text-slate-400" aria-live="polite">Alasan awal berdasarkan jenis akun dan perubahan nominal.</p>
                        </div>
                        <button id="dashboardGrowthAnalyzeButton" type="button" class="btn btn-secondary whitespace-nowrap text-xs">Analisa dengan AI</button>
                    </div>
                    <div class="max-h-[50vh] overflow-auto">
                        <table class="min-w-[1184px] w-full border-collapse text-[11px]">
                            <thead class="sticky top-0 z-10 bg-slate-800 text-slate-300">
                                <tr>
                                    <th class="w-56 px-2 py-2 text-left font-bold uppercase tracking-wide">Nama akun</th>
                                    <th class="w-32 px-2 py-2 text-right font-bold uppercase tracking-wide">Nominal sebelumnya</th>
                                    <th class="w-32 px-2 py-2 text-right font-bold uppercase tracking-wide">Nominal masa depan</th>
                                    <th class="w-32 px-2 py-2 text-right font-bold uppercase tracking-wide">Nominal kenaikan</th>
                                    <th class="w-28 px-2 py-2 text-right font-bold uppercase tracking-wide">Persentase kenaikan</th>
                                    <th class="min-w-80 px-2 py-2 text-left font-bold uppercase tracking-wide">Analisa kenaikan</th>
                                </tr>
                            </thead>
                            <tbody id="dashboardGrowthTableBody">${renderBudgetGrowthRows(data.accountGrowthRows)}</tbody>
                        </table>
                    </div>
                </div>
            `);
        } else if (Array.isArray(data.accountRows) && data.accountRows.length) {
            accountRows.push(`
                <div class="mt-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
                    <div class="max-h-80 overflow-y-auto">
                        <table class="w-full border-collapse text-xs">
                            <thead class="sticky top-0 z-10 bg-slate-800/90 text-slate-300 backdrop-blur-sm">
                                <tr>
                                    <th class="px-2 py-2 text-left font-bold uppercase tracking-wide">Nama akun</th>
                                    <th class="px-2 py-2 text-right font-bold uppercase tracking-wide">Nominal</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.accountRows.map(([label, value]) => toRowHtml(label, value)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `);
        } else if (Array.isArray(data.syncHistory) && data.syncHistory.length) {
            accountRows.push(`
                <div class="mt-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
                    <div class="max-h-80 overflow-y-auto">
                        <table class="w-full border-collapse text-xs">
                            <thead class="sticky top-0 z-10 bg-slate-800/90 text-slate-300 backdrop-blur-sm">
                                <tr>
                                    <th class="px-2 py-2 text-left font-bold uppercase tracking-wide">Tanggal & jam</th>
                                    <th class="px-2 py-2 text-left font-bold uppercase tracking-wide">Pengguna</th>
                                    <th class="px-2 py-2 text-left font-bold uppercase tracking-wide">Aktivitas</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.syncHistory.map(item => `
                                    <tr>
                                        <td class="border-b border-white/10 px-2 py-2 text-slate-200">${window.Formatters.escapeHtml(item.time || '-')}</td>
                                        <td class="border-b border-white/10 px-2 py-2 text-slate-200">${window.Formatters.escapeHtml(item.user || 'System')}</td>
                                        <td class="border-b border-white/10 px-2 py-2 text-slate-300">${window.Formatters.escapeHtml(item.message || 'Sinkronisasi data')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `);
        }

        document.getElementById('dashboardMetricTitle').textContent = data.title;
        metricBody.innerHTML = [
            ...data.lines.map(line => `<p class="m-0 leading-6 text-slate-200">${window.Formatters.escapeHtml(line)}</p>`),
            ...accountRows
        ].join('');
        const modalPanel = document.getElementById('dashboardMetricPanel');
        if (modalPanel) {
            const isGrowthDetail = Array.isArray(data.accountGrowthRows);
            modalPanel.classList.toggle('max-w-7xl', isGrowthDetail);
            modalPanel.classList.toggle('max-w-xl', !isGrowthDetail);
        }
        const growthButton = metricBody.querySelector('#dashboardGrowthAnalyzeButton');
        if (growthButton) {
            growthButton.addEventListener('click', () => analyzeBudgetGrowth(
                data,
                growthButton,
                metricBody.querySelector('#dashboardGrowthAnalysisStatus')
            ));
        }
        modal.classList.remove('hidden');
    }

    async function init() {
        bindMetricClicks();
        window.addEventListener('smartbara:period_change', () => loadDashboardMetrics());
        window.addEventListener('smartbara:dept_filter_change', () => loadDashboardMetrics());
        window.addEventListener('smartbara:store_loaded', () => loadDashboardMetrics(true));
        const dashboardTables = new Set([
            'smartbara_store',
            'smartbara_meta',
            'smartbara_budget',
            'smartbara_budget_creator_planning',
            'smartbara_future_budget',
            'smartbara_settings'
        ]);
        window.SmartBaraCore.onRealtimeChange(payload => {
            if (dashboardTables.has(payload.table)) loadDashboardMetrics(true);
        });
        await loadDashboardMetrics();
    }

    function loadDashboardMetrics(silent = false) {
        if (dashboardMetricsPromise) {
            dashboardMetricsRefreshRequested = true;
            return dashboardMetricsPromise;
        }

        const refreshPromise = (async () => {
            do {
                dashboardMetricsRefreshRequested = false;
                await refreshDashboardMetrics(silent);
                silent = true;
            } while (dashboardMetricsRefreshRequested);
        })();
        dashboardMetricsPromise = refreshPromise.finally(() => {
            dashboardMetricsPromise = null;
        });
        return dashboardMetricsPromise;
    }

    async function refreshDashboardMetrics(silent = false) {
        const period = window.SmartBaraCore.getActivePeriod();
        const client = window.SmartBaraCore.getClient();

        // Load local caches
        let storeData = [];
        let metaData = [];
        let budgetData = [];
        let creatorData = [];
        let futureBudgetData = [];

        try {
            creatorData = JSON.parse(localStorage.getItem(`budget_creator_planning_${period}`) || '[]');
            budgetData = JSON.parse(localStorage.getItem(`smartbara_budget_v2_${period}`) || '[]');
            futureBudgetData = JSON.parse(localStorage.getItem(`smartbara_budget_future_v1_${period}`) || '[]');
            metaData = JSON.parse(localStorage.getItem(`smartbara_meta_${period}`) || '{}');
        } catch(e) {}

        let transactionOverrides = {};
        try {
            transactionOverrides = JSON.parse(localStorage.getItem(`smartbara_reconcile_overrides_${period}`) || '{}');
        } catch(e) {}

        const selectedDepts = new Set(window.SmartBaraCore.getSelectedDepartments().map(dept => String(dept).toUpperCase()));
        // Mode Gabungan tidak menyaring: budget dept yang belum punya transaksi tetap dihitung.
        const isCombinedScope = window.SmartBaraCore.isCombinedDepartments();
        const matchesDept = dept => isCombinedScope || selectedDepts.size === 0 || selectedDepts.has(String(dept || '').toUpperCase());
        budgetData = budgetData.filter(item => matchesDept(item.dept));
        creatorData = creatorData.filter(item => matchesDept(item.department));
        futureBudgetData = futureBudgetData.filter(item => matchesDept(item.dept || item.department));
        window.__smartbaraBudgetRows = budgetData;
        window.__smartbaraFutureBudgetRows = futureBudgetData;
        const monthKeys = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
        const sumBudget = rows => rows.reduce((sum, item) => {
            const values = Array.isArray(item.budget)
                ? item.budget
                : monthKeys.map(month => item.budget?.[month] ?? item[`budget_${month}`] ?? item[month]);
            return sum + values.reduce((subtotal, value) => subtotal + (Number(value) || 0), 0);
        }, 0);
        const sumCreator = rows => rows.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_unit_price) || 0), 0);
        const sumFuture = rows => rows.reduce((sum, item) => {
            const total = Number(item.total);
            if (Number.isFinite(total)) return sum + total;
            const monthlyPlan = Array.isArray(item.monthlyPlan)
                ? item.monthlyPlan
                : item.monthlyPlan && typeof item.monthlyPlan === 'object'
                    ? Object.values(item.monthlyPlan)
                    : null;
            if (monthlyPlan) return sum + monthlyPlan.reduce((subtotal, value) => subtotal + (Number(value) || 0), 0);
            return sum + monthKeys.reduce((subtotal, month) => subtotal + (Number(item[month]) || 0), 0);
        }, 0);
        const transactionRows = getYearScopedTransactions();
        const localMetaRows = Array.isArray(metaData) ? metaData : Object.values(metaData || {});
        renderTopCharts(budgetData, transactionRows, transactionOverrides, localMetaRows);

        const calculateFinanceTotals = (transactions, metaRows) => {
            let financeTotal = 0;
            let reconcileTotal = 0;
            transactions.forEach(transaction => {
                const debit = Number(transaction.debit ?? transaction.Debit) || 0;
                const credit = Number(transaction.kredit ?? transaction.Kredit) || 0;
                financeTotal += debit - credit + (Number(transaction.adj_finance) || 0);
                const reconcile = transaction.rekonsil ?? transaction.Rekonsil ?? transaction[' Nilai Rekonsil '] ?? transaction['Nilai Rekonsil'] ?? transaction.finance ?? transaction.Finance;
                reconcileTotal += (Number(reconcile) || 0) + (Number(transaction.adj_rekonsil) || 0);
            });
            reconcileTotal += metaRows.reduce((sum, meta) => sum + (Number(meta.adj_bank) || 0), 0);
            return { financeTotal, reconcileTotal };
        };
        const localTotals = calculateFinanceTotals(
            transactionRows,
            localMetaRows.filter(item => matchesDept(item.meta_key))
        );

        renderStats({
            creatorCount: countUniqueAccounts(creatorData),
            creatorTotal: sumCreator(creatorData),
            budgetCount: countUniqueAccounts(budgetData),
            budgetTotal: sumBudget(budgetData),
            futureBudgetCount: countUniqueAccounts(futureBudgetData),
            futureBudgetTotal: sumFuture(futureBudgetData),
            futureBudgetLoading: Boolean(client),
            futureBudgetError: !client && !futureBudgetData.length,
            financeTotal: localTotals.financeTotal,
            reconcileTotal: localTotals.reconcileTotal,
            selisihTotal: Math.abs(localTotals.financeTotal - localTotals.reconcileTotal)
        });

        if (!client) return;

        try {
            const [metaRes, budgetRes, creatorRes, futureBudgetRes, overrideRes] = await Promise.all([
                client.from('smartbara_meta').select('*').eq('period_name', period),
                client.from('smartbara_budget').select('*').eq('period_name', period),
                client.from('smartbara_budget_creator_planning').select('department, quantity, estimated_unit_price').eq('period_name', period),
                client.from('smartbara_future_budget').select('rows_data').eq('period_name', period).maybeSingle(),
                client.from('smartbara_settings').select('key, value').like('key', `smartbara_reconcile_override_${period}_%`)
            ]);

            const cData = (creatorRes.data?.length ? creatorRes.data : creatorData).filter(item => matchesDept(item.department));
            const bData = (budgetRes.data?.length ? budgetRes.data : budgetData).filter(item => matchesDept(item.dept || item.departemen));
            const futureRows = Array.isArray(futureBudgetRes.data?.rows_data) ? futureBudgetRes.data.rows_data : futureBudgetData;
            const fData = futureRows.filter(item => matchesDept(item.dept || item.department));
            window.__smartbaraBudgetRows = bData;
            window.__smartbaraFutureBudgetRows = fData;
            const mData = (metaRes.data?.length ? metaRes.data : localMetaRows).filter(item => matchesDept(item.meta_key));
            const cloudOverrides = {};
            (overrideRes.data || []).forEach(item => {
                const transactionId = String(item.value?.transaction_id || item.key.replace(`smartbara_reconcile_override_${period}_`, ''));
                if (item.value?.override) cloudOverrides[transactionId] = item.value.override;
            });
            renderTopCharts(bData.length ? bData : budgetData, transactionRows, { ...transactionOverrides, ...cloudOverrides }, mData);

            const { financeTotal, reconcileTotal } = calculateFinanceTotals(transactionRows, mData);

            renderStats({
                creatorCount: countUniqueAccounts(cData),
                creatorTotal: sumCreator(cData),
                budgetCount: countUniqueAccounts(bData),
                budgetTotal: sumBudget(bData),
                futureBudgetCount: countUniqueAccounts(fData),
                futureBudgetTotal: sumFuture(fData),
                futureBudgetLoading: false,
                futureBudgetError: Boolean(futureBudgetRes.error && !futureBudgetData.length),
                financeTotal,
                reconcileTotal,
                selisihTotal: Math.abs(financeTotal - reconcileTotal)
            });
        } catch(e) {
            console.warn('Dashboard metrics error:', e);
        }
    }

    function getElapsedMonthsForPeriod(periodText = '') {
        const text = String(periodText || '').toLowerCase();
        const monthAliases = [
            ['januari', 'jan'], ['februari', 'feb'], ['maret', 'mar'], ['april', 'apr'],
            ['mei', 'may'], ['juni', 'jun'], ['juli', 'jul'],
            ['agustus', 'agu', 'agt', 'ags', 'agst', 'aug', 'august'],
            ['september', 'sept', 'sep'], ['oktober', 'okt', 'oct'],
            ['november', 'nov'], ['desember', 'des', 'dec']
        ];
        const tokens = text.split(/[^a-z]+/).filter(Boolean);
        const monthIndex = monthAliases.findIndex(aliases => aliases.some(alias => tokens.includes(alias)));
        return monthIndex >= 0 ? monthIndex + 1 : 12;
    }

    function computeDataHealth(transactions = []) {
        const selectedDepts = window.SmartBaraCore.getSelectedDepartments();
        const activeDepts = Array.isArray(selectedDepts) ? selectedDepts.filter(Boolean).map(dept => String(dept).toUpperCase()) : [];
        const issues = transactions.filter(row => {
            const dept = String(row.dept || row._department || '').trim();
            const date = String(getValue(row, ['tanggal', 'tgl', 'date']) || '').trim();
            const account = String(getValue(row, ['nama akun', 'nama_akun', 'akun', 'account']) || '').trim();

            // Project bukan field wajib untuk banyak data GA / finance, karena banyak transaksi bersifat umum dan tidak memiliki kode proyek.
            return !dept || !date || !account;
        }).length;

        const scoreBase = Math.max(0, 100 - issues * 2);
        const score = Math.min(100, scoreBase);
        const label = score >= 90 ? 'Normal' : score >= 75 ? 'Perhatian' : 'Cek Ulang';
        const healthClass = score >= 90 ? 'badge-emerald' : score >= 75 ? 'badge-amber' : 'badge-rose';

        return {
            score,
            label,
            issues,
            departments: activeDepts.length || Object.keys(window.SmartBaraCore.getDepartments()).length || 0,
            healthClass,
            transactions: transactions.length
        };
    }

    function renderApprovalStatus() {
        const approval = window.SmartBaraCore.getApprovalState(window.SmartBaraCore.getActivePeriod());
        const badge = document.getElementById('dashApprovalBadge');
        const status = document.getElementById('dashApprovalStatus');
        const meta = document.getElementById('dashApprovalMeta');
        const action = document.getElementById('dashApprovalAction');
        const rejectAction = document.getElementById('dashRejectApprovalAction');
        const bulkAction = document.getElementById('dashBulkApproveButton');
        if (!badge || !status || !meta || !action) return;

        const approvalState = String(approval.status || '').toLowerCase();
        const isApproved = approvalState === 'approved';
        const isRejected = approvalState === 'rejected';
        const stateLabel = isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Pending';
        const stateClass = isApproved ? 'badge-emerald' : isRejected ? 'badge-rose' : 'badge-amber';
        badge.textContent = stateLabel;
        badge.className = `badge ${stateClass} text-[10px]`;
        status.textContent = isApproved
            ? `Disetujui oleh ${approval.approved_by || 'Superadmin'}`
            : isRejected
                ? `Ditolak oleh ${approval.approved_by || 'Superadmin'}`
                : 'Belum disetujui';
        meta.textContent = isApproved
            ? `Scope: ALL • ${new Date(approval.approved_at || Date.now()).toLocaleString('id-ID')}`
            : isRejected
                ? `Ditolak • ${new Date(approval.approved_at || Date.now()).toLocaleString('id-ID')}`
                : 'Semua Superadmin punya akses di semua departemen';

        const canApprove = window.SmartBaraCore.canApproveAllDepartments();
        const approveHandler = function() {
            try {
                const record = window.SmartBaraCore.requireApprovalDecision(window.SmartBaraCore.getActivePeriod(), {
                    action: 'dashboard_manual_approve',
                    department_scope: 'ALL',
                    departments: window.SmartBaraCore.getSelectedDepartments()
                });
                if (record?.status === 'approved') {
                    alert(`Periode ${window.SmartBaraCore.getActivePeriod()} berhasil disetujui oleh ${record.approved_by || 'Superadmin'}.`);
                    renderApprovalStatus();
                    renderApprovalHistory();
                }
            } catch (error) {
                alert(error.message || 'Akses approval ditolak.');
            }
        };

        const rejectHandler = function() {
            try {
                const record = window.SmartBaraCore.rejectApprovalDecision(window.SmartBaraCore.getActivePeriod(), {
                    action: 'dashboard_manual_reject',
                    department_scope: 'ALL',
                    departments: window.SmartBaraCore.getSelectedDepartments()
                });
                if (record?.status === 'rejected') {
                    alert(`Periode ${window.SmartBaraCore.getActivePeriod()} berhasil ditolak oleh ${record.approved_by || 'Superadmin'}.`);
                    renderApprovalStatus();
                    renderApprovalHistory();
                }
            } catch (error) {
                alert(error.message || 'Akses approval ditolak.');
            }
        };

        const bulkApproveHandler = function() {
            try {
                const record = window.SmartBaraCore.requireApprovalDecision(window.SmartBaraCore.getActivePeriod(), {
                    action: 'dashboard_bulk_approve_pending',
                    department_scope: 'ALL',
                    departments: window.SmartBaraCore.getSelectedDepartments()
                });
                if (record?.status === 'approved') {
                    alert(`Semua pending periode ${window.SmartBaraCore.getActivePeriod()} berhasil di-approve oleh ${record.approved_by || 'Superadmin'}.`);
                    renderApprovalStatus();
                    renderApprovalHistory();
                }
            } catch (error) {
                alert(error.message || 'Akses approval ditolak.');
            }
        };

        action.classList.toggle('hidden', !canApprove || isApproved || isRejected);
        action.onclick = approveHandler;

        if (rejectAction) {
            rejectAction.classList.toggle('hidden', !canApprove || isApproved || isRejected);
            rejectAction.onclick = rejectHandler;
        }

        if (bulkAction) {
            bulkAction.classList.toggle('hidden', !canApprove || isApproved || isRejected);
            bulkAction.onclick = bulkApproveHandler;
        }
    }

    function bindApprovalViewButton() {
        const button = document.getElementById('approvalViewDataButton');
        if (!button) return;
        button.onclick = () => {
            window.location.href = 'rekonsil.html';
        };
    }

    function renderApprovalHistory() {
        const historyContainer = document.getElementById('dashApprovalHistory');
        if (!historyContainer) return;

        const allHistory = Array.isArray(window.SmartBaraCore.getApprovalHistory(100)) ? window.SmartBaraCore.getApprovalHistory(100) : [];
        const history = allHistory.filter(entry => {
            const status = String(entry.status || 'pending').toLowerCase();
            return status === 'approved' || status === 'rejected' || status === 'pending';
        });

        const statusFilter = document.getElementById('approvalStatusFilter');
        const activeStatus = statusFilter ? statusFilter.value : 'all';
        const filteredHistory = activeStatus === 'all'
            ? history
            : history.filter(entry => String(entry.status || 'pending').toLowerCase() === activeStatus);

        const currentPeriod = window.SmartBaraCore.getActivePeriod();
        const periodFilteredHistory = currentPeriod
            ? filteredHistory.filter(entry => !entry.period_name || entry.period_name === currentPeriod)
            : filteredHistory;

        const statusBadgeClass = status => {
            if (status === 'approved') return 'badge-emerald';
            if (status === 'rejected') return 'badge-rose';
            return 'badge-amber';
        };

        const bindViewDataButtons = () => {
            document.querySelectorAll('[data-view-route="rekonsil.html"]').forEach(button => {
                button.onclick = () => window.location.href = 'rekonsil.html';
            });
        };

        const exportApprovalReport = async () => {
            try {
                await window.SmartBaraConfig.ensureLibrary('exceljs');
                if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS belum siap dimuat.');
                const workbook = new ExcelJS.Workbook();
                const sheet = workbook.addWorksheet('Approval Audit');
                sheet.columns = [
                    { header: 'Periode', key: 'period_name', width: 20 },
                    { header: 'Status', key: 'status', width: 14 },
                    { header: 'Approver', key: 'approved_by', width: 28 },
                    { header: 'Waktu', key: 'approved_at', width: 22 },
                    { header: 'Scope', key: 'department_scope', width: 18 },
                    { header: 'Action', key: 'action', width: 18 },
                    { header: 'Departemen', key: 'departments', width: 26 }
                ];
                const rows = periodFilteredHistory.map(entry => ({
                    period_name: entry.period_name || '-',
                    status: String(entry.status || 'pending').toUpperCase(),
                    approved_by: entry.approved_by || entry.approver || 'Superadmin',
                    approved_at: entry.approved_at ? new Date(entry.approved_at).toLocaleString('id-ID') : '-',
                    department_scope: entry.department_scope || entry.scope || 'ALL',
                    action: entry.action || 'manual_approve',
                    departments: Array.isArray(entry.departments) ? entry.departments.join(', ') : (entry.departments || 'ALL')
                }));
                sheet.addRows(rows);
                sheet.getRow(1).font = { bold: true };
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `SmartBARA_Approval_Audit_${currentPeriod || 'ALL'}.xlsx`;
                link.click();
                URL.revokeObjectURL(link.href);
                window.SmartBaraCore.showSyncStatus('Export approval report berhasil dibuat.', 'success');
            } catch (error) {
                console.error('Approval export error:', error);
                window.SmartBaraCore.showSyncStatus(`Export approval gagal: ${error.message}`, 'error');
            }
        };

        const summaryCounts = {
            all: history.length,
            pending: history.filter(entry => String(entry.status || 'pending').toLowerCase() === 'pending').length,
            approved: history.filter(entry => String(entry.status || 'pending').toLowerCase() === 'approved').length,
            rejected: history.filter(entry => String(entry.status || 'pending').toLowerCase() === 'rejected').length
        };

        if (!history.length) {
            historyContainer.innerHTML = `
                <div class="audit-shell space-y-3">
                    <div class="audit-header flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                        <div class="flex items-center gap-2">
                            <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300 text-[12px]">📋</span>
                            <div>
                                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-400">Approval Audit</div>
                                <div class="text-xs font-semibold text-white">Status Periode</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button type="button" class="btn btn-primary text-[10px]" data-view-route="rekonsil.html">Lihat Data</button>
                            <button id="approvalExportButton" type="button" class="btn btn-secondary text-[10px]">Export Excel</button>
                        </div>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2">
                            <label class="text-[10px] uppercase tracking-wider text-slate-500">Status</label>
                            <select id="approvalStatusFilter" class="form-select text-[11px] w-32">
                                <option value="all">Semua</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="rejected">Rejected</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <div class="audit-stat p-2 text-center">
                            <div class="text-[9px] uppercase tracking-wide text-slate-400">Semua</div>
                            <div class="mt-1 text-base font-black text-white">0</div>
                        </div>
                        <div class="audit-stat border-amber-500/30 bg-amber-500/10 p-2 text-center">
                            <div class="text-[9px] uppercase tracking-wide text-amber-200">Pending</div>
                            <div class="mt-1 text-base font-black text-white">0</div>
                        </div>
                        <div class="audit-stat border-emerald-500/30 bg-emerald-500/10 p-2 text-center">
                            <div class="text-[9px] uppercase tracking-wide text-emerald-200">Approved</div>
                            <div class="mt-1 text-base font-black text-white">0</div>
                        </div>
                    </div>
                    <div class="audit-empty-state p-4 text-center">
                        <div class="audit-empty-icon mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-2xl">📊</div>
                        <p class="mt-3 m-0 text-sm font-semibold text-slate-100">Belum ada riwayat approval</p>
                        <p class="mt-2 m-0 text-[11px] text-slate-400">Setelah ada keputusan approve atau reject, riwayat akan tampil di sini dan bisa diekspor ke Excel.</p>
                        <button type="button" class="btn btn-primary mt-4 text-[10px]" data-view-route="rekonsil.html">Lihat Data</button>
                    </div>
                </div>
            `;
            const filter = document.getElementById('approvalStatusFilter');
            const exportButton = document.getElementById('approvalExportButton');
            if (filter) filter.addEventListener('change', renderApprovalHistory);
            if (exportButton) exportButton.addEventListener('click', exportApprovalReport);
            bindViewDataButtons();
            return;
        }

        const emptyFilteredState = periodFilteredHistory.length === 0;

        historyContainer.innerHTML = `
            <div class="audit-shell space-y-3">
                <div class="audit-header flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                    <div class="flex items-center gap-2">
                        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300 text-[12px]">📋</span>
                        <div>
                            <div class="text-[10px] uppercase tracking-[0.18em] text-slate-400">Approval Audit</div>
                            <div class="text-xs font-semibold text-white">Status Periode</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" class="btn btn-primary text-[10px]" data-view-route="rekonsil.html">Lihat Data</button>
                        <button id="approvalExportButton" type="button" class="btn btn-secondary text-[10px]">Export Excel</button>
                    </div>
                </div>

                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex items-center gap-2">
                        <label class="text-[10px] uppercase tracking-wider text-slate-500">Status</label>
                        <select id="approvalStatusFilter" class="form-select text-[11px] w-32">
                            <option value="all" ${activeStatus === 'all' ? 'selected' : ''}>Semua</option>
                            <option value="pending" ${activeStatus === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="approved" ${activeStatus === 'approved' ? 'selected' : ''}>Approved</option>
                            <option value="rejected" ${activeStatus === 'rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div class="audit-stat p-2 text-center">
                        <div class="text-[9px] uppercase tracking-wide text-slate-400">Semua</div>
                        <div class="mt-1 text-base font-black text-white">${summaryCounts.all}</div>
                    </div>
                    <div class="audit-stat border-amber-500/30 bg-amber-500/10 p-2 text-center">
                        <div class="text-[9px] uppercase tracking-wide text-amber-200">Pending</div>
                        <div class="mt-1 text-base font-black text-white">${summaryCounts.pending}</div>
                    </div>
                    <div class="audit-stat border-emerald-500/30 bg-emerald-500/10 p-2 text-center">
                        <div class="text-[9px] uppercase tracking-wide text-emerald-200">Approved</div>
                        <div class="mt-1 text-base font-black text-white">${summaryCounts.approved}</div>
                    </div>
                    <div class="audit-stat border-rose-500/30 bg-rose-500/10 p-2 text-center">
                        <div class="text-[9px] uppercase tracking-wide text-rose-200">Rejected</div>
                        <div class="mt-1 text-base font-black text-white">${summaryCounts.rejected}</div>
                    </div>
                </div>

                <div class="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/30">
                    <table class="audit-table min-w-full text-left text-[11px] text-slate-200">
                        <thead class="bg-slate-900/80 text-slate-300">
                            <tr>
                                <th class="px-3 py-2 font-bold uppercase tracking-wider">Periode</th>
                                <th class="px-3 py-2 font-bold uppercase tracking-wider">Status</th>
                                <th class="px-3 py-2 font-bold uppercase tracking-wider">Approver</th>
                                <th class="px-3 py-2 font-bold uppercase tracking-wider">Waktu</th>
                                <th class="px-3 py-2 font-bold uppercase tracking-wider">Scope</th>
                                <th class="px-3 py-2 font-bold uppercase tracking-wider">Action</th>
                                <th class="px-3 py-2 font-bold uppercase tracking-wider">Departemen</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${emptyFilteredState ? `
                                <tr>
                                    <td colspan="7" class="px-3 py-8 text-center text-slate-400">
                                        <div class="flex flex-col items-center justify-center gap-3 py-4">
                                            <div class="audit-empty-icon flex h-12 w-12 items-center justify-center rounded-2xl text-xl text-slate-200">📌</div>
                                            <div>
                                                <div class="text-sm font-semibold text-slate-200">Belum ada riwayat approval</div>
                                                <div class="mt-1 text-[11px] text-slate-400">status ${activeStatus === 'all' ? 'Semua' : activeStatus.charAt(0).toUpperCase() + activeStatus.slice(1)} belum tersedia</div>
                                            </div>
                                            <button type="button" class="btn btn-primary text-[10px]" data-view-route="rekonsil.html">Lihat Data</button>
                                        </div>
                                    </td>
                                </tr>
                            ` : periodFilteredHistory.map(entry => {
                                const status = String(entry.status || 'pending').toLowerCase();
                                const when = entry.approved_at ? new Date(entry.approved_at).toLocaleString('id-ID') : '-';
                                const departments = Array.isArray(entry.departments) ? entry.departments.join(', ') : (entry.departments || 'ALL');
                                return `
                                    <tr class="border-t border-white/10">
                                        <td class="px-3 py-2 font-semibold text-white">${window.Formatters.escapeHtml(entry.period_name || '-')}</td>
                                        <td class="px-3 py-2"><span class="badge ${statusBadgeClass(status)} text-[10px]">${window.Formatters.escapeHtml(status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending')}</span></td>
                                        <td class="px-3 py-2 text-slate-200">${window.Formatters.escapeHtml(entry.approved_by || entry.approver || 'Superadmin')}</td>
                                        <td class="px-3 py-2 text-slate-300">${window.Formatters.escapeHtml(when)}</td>
                                        <td class="px-3 py-2 text-slate-300">${window.Formatters.escapeHtml(entry.department_scope || entry.scope || 'ALL')}</td>
                                        <td class="px-3 py-2 text-slate-300">${window.Formatters.escapeHtml(entry.action || (status === 'approved' ? 'manual_approve' : status === 'rejected' ? 'manual_reject' : 'pending'))}</td>
                                        <td class="px-3 py-2 text-slate-300">${window.Formatters.escapeHtml(departments)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const filter = document.getElementById('approvalStatusFilter');
        const exportButton = document.getElementById('approvalExportButton');
        if (filter) filter.addEventListener('change', () => renderApprovalHistory());
        if (exportButton) exportButton.addEventListener('click', exportApprovalReport);
        bindViewDataButtons();
        bindApprovalViewButton();
    }

    function renderStats(metrics) {
        const setEl = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        const activePeriod = String(window.SmartBaraCore.getActivePeriod() || '');
        const elapsedMonths = getElapsedMonthsForPeriod(activePeriod);
        const budgetValue = Number(metrics.budgetTotal ?? 0);
        const reconcileValue = Number(metrics.reconcileTotal ?? 0);
        const futureValue = Number(metrics.futureBudgetTotal ?? 0);
        const hasFutureBudget = Number(metrics.futureBudgetCount ?? 0) > 0;
        const futureBudgetLoading = Boolean(metrics.futureBudgetLoading);
        const futureBudgetError = Boolean(metrics.futureBudgetError);
        const futureBudgetEmptyLabel = futureBudgetLoading ? 'Memuat...' : futureBudgetError ? 'Cloud tidak tersedia' : 'Belum disusun';
        const predictionValue = reconcileValue > 0 ? (reconcileValue / elapsedMonths) * 12 : budgetValue;
        const deltaReconcile = predictionValue - reconcileValue;
        const deltaReconcilePct = reconcileValue ? (Math.abs(deltaReconcile) / reconcileValue) * 100 : 0;
        const deltaFuture = hasFutureBudget ? futureValue - budgetValue : 0;
        const deltaFuturePct = hasFutureBudget && budgetValue ? (Math.abs(deltaFuture) / budgetValue) * 100 : 0;
        const transactionRows = getYearScopedTransactions();
        const health = computeDataHealth(transactionRows);

        setEl('dashCreatorCount', (metrics.creatorCount || 0).toLocaleString('id-ID'));
        setEl('dashCreatorTotal', window.Formatters.formatRupiah(metrics.creatorTotal || 0));
        setEl('dashBudgetCount', (metrics.budgetCount || 0).toLocaleString('id-ID'));
        setEl('dashBudgetTotal', window.Formatters.formatRupiah(budgetValue));
        setEl('dashPredictionCount', (metrics.budgetCount || 0).toLocaleString('id-ID'));
        setEl('dashPredictionTotal', window.Formatters.formatRupiah(predictionValue));
        setEl('dashFutureBudgetCount', futureBudgetLoading ? '...' : (metrics.futureBudgetCount || 0).toLocaleString('id-ID'));
        setEl('dashFutureBudgetTotal', hasFutureBudget ? window.Formatters.formatRupiah(futureValue) : futureBudgetEmptyLabel);
        setEl('dashFinanceTotal', window.Formatters.formatRupiah(metrics.financeTotal || 0));
        setEl('dashReconcileTotal', window.Formatters.formatRupiah(reconcileValue));
        setEl('dashSelisihTotal', window.Formatters.formatRupiah(metrics.selisihTotal || 0));
        setEl('dashDeltaReconcileValue', `${deltaReconcile >= 0 ? '+' : '-'} ${window.Formatters.formatRupiah(Math.abs(deltaReconcile))}`);
        setEl('dashDeltaReconcileTrend', `${deltaReconcilePct.toFixed(1)}% ${deltaReconcile >= 0 ? 'naik' : 'turun'}`);
        setEl('dashDeltaFutureValue', hasFutureBudget ? `${deltaFuture >= 0 ? '+' : '-'} ${window.Formatters.formatRupiah(Math.abs(deltaFuture))}` : futureBudgetEmptyLabel);
        setEl('dashDeltaFutureTrend', hasFutureBudget ? `${deltaFuturePct.toFixed(1)}% ${deltaFuture >= 0 ? 'naik' : 'turun'}` : futureBudgetLoading ? 'Menunggu cloud' : futureBudgetError ? 'Periksa koneksi' : 'Belum ada data');
        setEl('dashPlanGrowthPercent', hasFutureBudget ? `${deltaFuturePct.toFixed(1)}%` : '—');
        setEl('dashPlanGrowthTrend', hasFutureBudget ? `${deltaFuture >= 0 ? 'naik' : 'turun'}` : futureBudgetEmptyLabel);

        const hasData = (health.transactions > 0) || (metrics.budgetCount > 0) || (metrics.creatorCount > 0) || (metrics.futureBudgetCount > 0) || (Object.keys(window.SmartBaraCore.getDepartments()).length > 0);

        setEl('dashHealthScore', `${health.score}`);
        setEl('dashHealthState', hasData ? health.label : 'Data Kosong');
        setEl('dashDataQuality', hasData ? `${health.issues} item perlu review` : 'Belum ada data untuk periode aktif');
        setEl('dashActiveDepts', String(health.departments));
        setEl('dashTransactionsCount', health.transactions.toLocaleString('id-ID'));

        const latestSync = window.SmartBaraCore.getLatestSyncEntry?.();
        const now = new Date();
        const syncTime = latestSync?.time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        setEl('dashLastSync', hasData ? `Online • ${syncTime}` : `Data belum tersedia • ${syncTime}`);

        const healthBadge = document.getElementById('dashHealthState');
        if (healthBadge) {
            healthBadge.className = `badge ${health.healthClass} text-[10px]`;
        }

        renderApprovalStatus();
        renderApprovalHistory();
    }

    function normalizeKey(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function normalizeAccountKey(row) {
        const account = String(row?.nama_akun || row?.account || row?.nama || row?.account_name || row?.akun || '').trim();
        return account ? account.toLowerCase() : null;
    }

    function countUniqueAccounts(rows) {
        return new Set((rows || []).map(row => normalizeAccountKey(row)).filter(Boolean)).size;
    }

    function getValue(row, names) {
        const entries = Object.entries(row || {});
        for (const name of names) {
            const target = normalizeKey(name);
            const entry = entries.find(([key]) => normalizeKey(key) === target);
            if (entry) return entry[1];
        }
        return undefined;
    }

    function renderTopCharts(budgetRows, transactions, transactionOverrides = {}, metaRows = []) {
        const budgets = new Map();
        (budgetRows || []).forEach(item => {
            const dept = String(item.dept || item.departemen || item.department || 'UMUM').toUpperCase();
            const account = item.nama || item.nama_akun || item.account_name || item.nama_proyek || 'Budget Plan';
            const project = item.proyek || item.project_name || '';
            const key = `${dept}|${account}|${project}`;
            const values = Array.isArray(item.budget)
                ? item.budget
                : ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des']
                    .map(month => item[`budget_${month}`] ?? item[month]);
            const monthlyTotal = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
            const storedTotal = Number(item.total_tahun);
            const total = Number.isFinite(storedTotal) && storedTotal !== 0 ? storedTotal : monthlyTotal;
            const current = budgets.get(key) || { label: [account, project, dept].filter(Boolean).join(' · '), value: 0 };
            current.value += total;
            budgets.set(key, current);
        });

        const grouped = new Map();
        const transactionOccurrences = new Map();
        (transactions || []).forEach(transaction => {
            const dept = String(transaction.dept || transaction._department || getValue(transaction, ['nama dept', 'departemen']) || 'UMUM').toUpperCase();
            const account = getValue(transaction, ['nama akun', 'akun', 'account']) || 'Lain-lain';
            const project = getValue(transaction, ['nama proyek up', 'nama proyek', 'proyek']) || '';
            const sourceNumber = getValue(transaction, ['no sumber', 'no_sumber', 'no']);
            const description = getValue(transaction, ['keterangan', 'deskripsi', 'uraian']);
            const identity = [dept, account, project, sourceNumber, description].map(value => String(value || '').trim().toLowerCase()).join('|');
            const occurrence = (transactionOccurrences.get(identity) || 0) + 1;
            transactionOccurrences.set(identity, occurrence);
            const key = `${dept}|${account}|${project}`;
            const entry = grouped.get(key) || { label: [account, project, dept].filter(Boolean).join(' · '), finance: 0, reconcile: 0 };
            const transactionId = window.SmartBaraCore.createTransactionId({
                nama_akun: account,
                proyek: project,
                no_sumber: sourceNumber,
                keterangan: description
            }, dept, occurrence);
            const override = transactionOverrides[transactionId] || {};
            const debit = Number(getValue(transaction, ['debit', 'debet'])) || 0;
            const credit = Number(getValue(transaction, ['kredit', 'credit'])) || 0;
            const financeValue = getValue(transaction, ['finance']);
            const finance = debit !== 0 || credit !== 0 ? debit - credit : Number(financeValue) || 0;
            const reconcile = Number(getValue(transaction, ['nilai rekonsil', 'rekonsil', 'reconcile'])) || 0;
            entry.finance += finance + (Number(transaction.adj_finance) || Number(override.adj_finance) || 0);
            entry.reconcile += reconcile + (Number(transaction.adj_rekonsil) || Number(override.adj_rekonsil) || 0);
            grouped.set(key, entry);
        });

        (metaRows || []).forEach(meta => {
            const dept = String(meta.meta_key || meta.dept || 'UMUM').toUpperCase();
            if (Number(meta.adj_sistem)) {
                const key = `${dept}|Penyesuaian Finance|`;
                const current = grouped.get(key) || { label: `Penyesuaian Finance · ${dept}`, finance: 0, reconcile: 0 };
                current.finance += Number(meta.adj_sistem) || 0;
                grouped.set(key, current);
            }
            if (Number(meta.adj_bank)) {
                const key = `${dept}|Rekonsil Manual|`;
                const current = grouped.get(key) || { label: `Rekonsil Manual · ${dept}`, finance: 0, reconcile: 0 };
                current.reconcile += Number(meta.adj_bank) || 0;
                grouped.set(key, current);
            }
        });

        const transactionGroups = [...grouped.entries()].map(([key, item]) => ({
            key,
            ...item,
            variance: Math.abs(item.finance - item.reconcile)
        }));
        latestTopLists = {
            budget: topRows([...budgets.values()], value => value),
            finance: topRows(transactionGroups.map(item => ({ label: item.label, key: item.key, value: item.finance })), Math.abs),
            reconcile: topRows(transactionGroups.map(item => ({ label: item.label, key: item.key, value: item.reconcile })), Math.abs),
            variance: topRows(transactionGroups.map(item => ({ label: item.label, key: item.key, value: item.variance })), value => value)
        };
        renderTopList('dashTopBudget', latestTopLists.budget);
        renderTopList('dashTopFinance', latestTopLists.finance);
        renderTopList('dashTopReconcile', latestTopLists.reconcile);
        renderTopList('dashTopVariance', latestTopLists.variance);
    }

    function topRows(rows, sortValue) {
        return rows.filter(row => Number.isFinite(Number(row.value)) && Number(row.value) !== 0)
            .sort((left, right) => sortValue(right.value) - sortValue(left.value))
            .slice(0, 10);
    }

    function buildLocalGrowthAnalysis(name, previousTotal, futureTotal, increase, percent) {
        const formatPercentValue = value => `${Math.abs(value).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
        const accountName = name.toLocaleLowerCase('id-ID');
        if (previousTotal === 0 && futureTotal > 0) {
            return `Akun baru pada rencana masa depan sebesar ${window.Formatters.formatRupiah(futureTotal)}. Pastikan kebutuhan ini benar-benar baru, bukan akun yang berganti nama atau biaya yang sudah tercatat di akun lain.`;
        }
        if (futureTotal === 0 && previousTotal > 0) {
            return `Anggaran akun turun menjadi Rp 0 dari ${window.Formatters.formatRupiah(previousTotal)}. Konfirmasi bahwa kebutuhan sudah selesai atau dialihkan, dan bukan sekadar tertunda atau kurang dianggarkan.`;
        }
        if (increase === 0) {
            return `Nominal tetap ${window.Formatters.formatRupiah(futureTotal)}. Periksa apakah volume dan tarif vendor masih sesuai untuk periode berikutnya.`;
        }

        let rationale = 'Perubahan ini mungkin berasal dari perubahan volume aktivitas atau tarif vendor; cocokkan dengan rencana kerja dan penawaran terbaru.';
        if (/penyusutan|depresiasi/.test(accountName)) {
            rationale = 'Perubahan dapat mengikuti daftar aset aktif, nilai perolehan, atau sisa masa manfaat; cocokkan dengan jadwal penyusutan.';
        } else if (/asuransi|premi/.test(accountName)) {
            rationale = 'Perubahan premi dapat mengikuti nilai pertanggungan dan daftar aset yang diasuransikan; periksa polis serta aset aktif.';
        } else if (/maintenance|pemeliharaan|perbaikan|sparepart|suku cadang/.test(accountName)) {
            rationale = 'Kebutuhan dapat berubah karena jadwal servis, kondisi aset, atau penggantian komponen; cocokkan dengan work order dan kondisi aset.';
        } else if (/sewa|kontrak/.test(accountName)) {
            rationale = 'Perubahan dapat berasal dari tarif kontrak, jumlah unit, atau lama pemakaian; periksa kontrak dan periode layanan.';
        } else if (/gaji|upah|pegawai|karyawan|tenaga kerja/.test(accountName)) {
            rationale = 'Perubahan perlu ditautkan pada jumlah personel dan tarif upah; validasi daftar tenaga kerja serta persetujuan perubahan.';
        } else if (/listrik|air|internet|telekomunikasi|telepon/.test(accountName)) {
            rationale = 'Perubahan dapat dipengaruhi tarif atau pola pemakaian; bandingkan tagihan bulanan dan asumsi konsumsi.';
        } else if (/transport|bbm|bahan bakar|ekspedisi|logistik|tol|perjalanan/.test(accountName)) {
            rationale = 'Perubahan mungkin mengikuti frekuensi perjalanan, rute, atau tarif layanan; cocokkan dengan volume aktivitas dan tarif terbaru.';
        } else if (/kantor|atk|alat tulis|perlengkapan|kertas|fotokopi|cetak/.test(accountName)) {
            rationale = 'Perubahan dapat mengikuti jumlah pengguna dan kebutuhan kerja kantor; periksa stok, pemakaian, serta penawaran pemasok.';
        } else if (/komisi|fee|pajak|administrasi|bank/.test(accountName)) {
            rationale = 'Perubahan dapat mengikuti volume transaksi atau tarif yang berlaku; cocokkan dasar perhitungan dengan dokumen pendukung.';
        } else if (/proyek|project|program|site/.test(accountName)) {
            rationale = 'Perubahan mungkin mencerminkan ruang lingkup atau jadwal kegiatan; pastikan rincian kebutuhan sesuai target dan tidak tumpang tindih.';
        }

        const movement = increase > 0 ? 'naik' : 'turun';
        const changePercent = percent === null ? '' : ` (${formatPercentValue(percent)})`;
        return `Nominal ${movement} ${window.Formatters.formatRupiah(Math.abs(increase))}${changePercent}, dari ${window.Formatters.formatRupiah(previousTotal)} menjadi ${window.Formatters.formatRupiah(futureTotal)}. ${rationale}`;
    }

    function renderBudgetGrowthRows(rows) {
        return rows.map((row) => {
            const changeClass = row.increase > 0 ? 'text-emerald-300' : row.increase < 0 ? 'text-rose-300' : 'text-slate-300';
            const percentLabel = row.percent === null ? 'Baru' : `${row.percent > 0 ? '+' : ''}${row.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
            return `
                <tr class="border-t border-white/10 align-top">
                    <td class="max-w-56 whitespace-normal px-2 py-2 font-semibold text-slate-100">${window.Formatters.escapeHtml(row.name)}</td>
                    <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-300">${window.Formatters.formatRupiah(row.previousTotal)}</td>
                    <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums text-white">${window.Formatters.formatRupiah(row.futureTotal)}</td>
                    <td class="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums ${changeClass}">${window.Formatters.formatRupiah(row.increase)}</td>
                    <td class="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums ${changeClass}">${percentLabel}</td>
                    <td class="min-w-80 whitespace-normal px-2 py-2 leading-5 text-slate-300">${window.Formatters.escapeHtml(row.analysis)}</td>
                </tr>
            `;
        }).join('');
    }

    async function analyzeBudgetGrowth(data, button, status) {
        const client = window.SmartBaraCore.getClient();
        if (!client?.functions?.invoke || !window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION) {
            status.textContent = 'Server AI belum tersedia. Periksa konfigurasi Supabase budget-ai.';
            return;
        }

        button.disabled = true;
        status.textContent = 'Menyusun alasan per akun dengan AI...';
        try {
            const { data: result, error } = await client.functions.invoke(window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION, {
                body: {
                    action: 'analyze-account-growth',
                    analysis: {
                        period: data.period,
                        departments: data.departments,
                        accounts: data.accountGrowthRows.map(({ name, previousTotal, futureTotal, increase, percent }) => ({ name, previousTotal, futureTotal, increase, percent }))
                    }
                }
            });
            if (error) throw new Error(await window.AISettingsModule.getErrorMessage(error));
            if (!Array.isArray(result?.analyses)) throw new Error(result?.error || 'Server tidak mengembalikan analisa akun.');

            const analysisByName = new Map(result.analyses.map(item => [String(item.name || '').toLocaleLowerCase('id-ID').trim(), String(item.analysis || '').trim()]));
            data.accountGrowthRows.forEach((row) => {
                const analysis = analysisByName.get(row.name.toLocaleLowerCase('id-ID').trim());
                if (analysis) row.analysis = analysis;
            });
            document.getElementById('dashboardGrowthTableBody').innerHTML = renderBudgetGrowthRows(data.accountGrowthRows);
            status.textContent = `Analisa AI ${result.provider || 'aktif'} · ${result.model || ''}`;
        } catch (error) {
            status.textContent = `Analisa AI gagal; alasan awal tetap tampil. ${error.message}`;
        } finally {
            button.disabled = false;
        }
    }

    function renderTopList(elementId, rows) {
        const list = document.getElementById(elementId);
        if (!list) return;
        const sorted = rows || [];
        if (!sorted.length) {
            list.innerHTML = '<li class="list-none py-3 text-xs text-slate-500">Belum ada data untuk ditampilkan.</li>';
            return;
        }
        const maximum = Math.max(...sorted.map(row => Math.abs(Number(row.value))), 1);
        list.innerHTML = sorted.map(row => {
            const width = Math.max(3, Math.round(Math.abs(Number(row.value)) / maximum * 100));
            return `<li class="list-none">
                <div class="flex items-center justify-between gap-3 text-[11px]">
                    <span class="min-w-0 truncate text-slate-300" title="${window.Formatters.escapeHtml(row.label)}">${window.Formatters.escapeHtml(row.label)}</span>
                    <span class="max-w-[60%] text-right text-sm font-bold tabular-nums text-white break-words">${window.Formatters.formatRupiah(row.value)}</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded bg-white/5"><div class="h-full rounded bg-teal-400/80" style="width:${width}%"></div></div>
            </li>`;
        }).join('');
    }

    async function analyzeWithAI() {
        const client = window.SmartBaraCore.getClient();
        const status = document.getElementById('dashAiAnalysisStatus');
        const output = document.getElementById('dashAiAnalysis');
        const button = document.getElementById('dashAiAnalysisButton');
        if (!client?.functions?.invoke || !window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION) {
            status.textContent = 'Server AI belum tersedia. Deploy Supabase Edge Function budget-ai terlebih dahulu.';
            return;
        }

        const payload = {
            period: window.SmartBaraCore.getActivePeriod(),
            departments: window.SmartBaraCore.getSelectedDepartments(),
            topLists: latestTopLists
        };
        button.disabled = true;
        status.textContent = 'Meminta analisa menggunakan API key aktif...';
        output.textContent = '';
        try {
            const { data, error } = await client.functions.invoke(window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION, {
                body: { action: 'analyze', analysis: payload }
            });
            if (error) throw new Error(await window.AISettingsModule.getErrorMessage(error));
            if (!data?.analysis) throw new Error(data?.error || 'Server tidak mengembalikan analisa.');
            output.textContent = data.analysis;
            status.textContent = `Analisa ${data.provider || 'AI'} · ${payload.period} · ${new Date().toLocaleTimeString('id-ID')}`;
        } catch(error) {
            status.textContent = `Analisa gagal: ${error.message}`;
        } finally {
            button.disabled = false;
        }
    }

    return {
        init,
        loadDashboardMetrics,
        openPresentationDeck,
        exportPresentationDeck,
        analyzeWithAI
    };
})();

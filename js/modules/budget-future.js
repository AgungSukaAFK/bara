// ==============================================================================
// SMART BARA 7.10 HZ - ANGGERAN MASA DEPAN (BUDGET FUTURE) MODULE
// Rolling 12-Month Projections, Multi-Year Forecast & Concurrency Control
// ==============================================================================

window.BudgetFutureModule = (function() {
    let rowsData = [];
    const expandedAccountGroups = new Set();
    let defaultRate = 5.0;
    let baselineData = {
        totalExisting: 0,
        totalReconcile: 0,
        totalReconcileForecast: 0,
        existingByDept: {},
        reconcileByDept: {},
        reconcileForecastByDept: {},
        transactionCount: 0,
        undatedTransactionCount: 0,
        reconcileMonths: [],
        reconcileRowIndex: new Map(),
        elapsedMonths: 12,
        deptCount: 0
    };
    let activePeriod = '2026';
    let isSaving = false;
    let savePending = false;
    let isUpdatingGrowthRange = false;
    let realtimeBound = false;
    let growthRangeConfig = { enabled: true, maxIncrease: 20, maxDecrease: 20 };

    const GROWTH_RANGE_SETTING_KEY = 'smartbara_future_growth_range_global';
    const DEFAULT_GROWTH_RANGE_CONFIG = { enabled: true, maxIncrease: 20, maxDecrease: 20 };

    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
    const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const PERIOD_MONTH_ALIASES = [
        ['januari', 'jan'], ['februari', 'feb'], ['maret', 'mar'], ['april', 'apr'],
        ['mei', 'may'], ['juni', 'jun'], ['juli', 'jul'], ['agustus', 'agu', 'agt', 'aug'],
        ['september', 'sep'], ['oktober', 'okt', 'oct'], ['november', 'nov'], ['desember', 'des', 'dec']
    ];

    async function init() {
        activePeriod = SmartBaraCore.getActivePeriod();
        updatePeriodTitles();
        bindEvents();
        window.addEventListener('smartbara:store_loaded', event => {
            if (event.detail?.period !== activePeriod) return;
            populateFilterOptions();
            refreshBaselines();
            if (rowsData.length) renderSyncStatus();
        });
        window.addEventListener('smartbara:store_updated', event => {
            if (event.detail?.period === activePeriod) refreshBaselines();
        });
        if (!realtimeBound) {
            SmartBaraCore.onRealtimeChange(payload => {
                const record = payload.new || payload.old || {};
                if (payload.table === 'smartbara_future_budget' && record.period_name === activePeriod) loadData();
                if (payload.table === 'smartbara_settings' && record.key === GROWTH_RANGE_SETTING_KEY) {
                    loadGrowthRangeConfig().then(loadData);
                }
            });
            realtimeBound = true;
        }
        await loadGrowthRangeConfig();
        await loadData();
        if (!rowsData.length) await refreshFromActual(false);
    }

    function normalizeGrowthRangeConfig(value) {
        const source = value && typeof value === 'object' ? value : {};
        const maxIncrease = Number(source.maxIncrease);
        const maxDecrease = Number(source.maxDecrease);
        return {
            enabled: source.enabled !== false,
            maxIncrease: Number.isFinite(maxIncrease) ? Math.min(1000, Math.max(0, maxIncrease)) : DEFAULT_GROWTH_RANGE_CONFIG.maxIncrease,
            maxDecrease: Number.isFinite(maxDecrease) ? Math.min(100, Math.max(0, maxDecrease)) : DEFAULT_GROWTH_RANGE_CONFIG.maxDecrease
        };
    }

    async function loadGrowthRangeConfig() {
        try {
            const cached = JSON.parse(localStorage.getItem(GROWTH_RANGE_SETTING_KEY) || 'null');
            if (cached) growthRangeConfig = normalizeGrowthRangeConfig(cached);
        } catch(e) {}

        try {
            const { data, error } = await SmartBaraCore.supabase
                .from('smartbara_settings')
                .select('value')
                .eq('key', GROWTH_RANGE_SETTING_KEY)
                .maybeSingle();
            if (error) throw error;
            if (data?.value) {
                growthRangeConfig = normalizeGrowthRangeConfig(data.value);
                localStorage.setItem(GROWTH_RANGE_SETTING_KEY, JSON.stringify(growthRangeConfig));
            }
        } catch(error) {
            console.warn('Global growth range setting could not be loaded:', error);
        }
        renderGrowthRangeControls();
    }

    function renderGrowthRangeControls() {
        const enabledInput = document.getElementById('futureBudgetRangeEnabled');
        const increaseInput = document.getElementById('futureBudgetMaxIncrease');
        const decreaseInput = document.getElementById('futureBudgetMaxDecrease');
        if (!isUpdatingGrowthRange) {
            if (enabledInput) enabledInput.checked = growthRangeConfig.enabled;
            if (increaseInput) increaseInput.value = growthRangeConfig.maxIncrease;
            if (decreaseInput) decreaseInput.value = growthRangeConfig.maxDecrease;
        }

        const canManage = SmartBaraCore.canManageSettings();
        [enabledInput, increaseInput, decreaseInput].filter(Boolean).forEach(input => { input.disabled = !canManage || isUpdatingGrowthRange; });
        const status = document.getElementById('futureBudgetRangeStatus');
        if (status) {
            status.textContent = isUpdatingGrowthRange
                ? 'Menyimpan pengaturan dan menerapkan ke seluruh baris...'
                : canManage
                ? (growthRangeConfig.enabled ? 'Aktif untuk seluruh baris dan departemen' : 'Nonaktif; proyeksi tidak dibatasi')
                : 'Pengaturan global hanya dapat diubah Superadmin';
        }
    }

    function setGrowthRangeTotal(row, targetTotal, sourceMonths, roundingDirection) {
        const sourceTotal = sourceMonths.reduce((sum, amount) => sum + amount, 0);
        const target = roundingDirection === 'floor'
            ? Math.floor((targetTotal + 0.000000001) * 100) / 100
            : roundingDirection === 'ceil'
                ? Math.ceil((targetTotal - 0.000000001) * 100) / 100
                : Math.round(targetTotal * 100) / 100;
        const monthlyPlan = sourceTotal > 0
            ? sourceMonths.map(amount => Math.round(amount * target / sourceTotal * 100) / 100)
            : MONTHS.map(() => Math.round(target / 12 * 100) / 100);
        monthlyPlan[11] = Math.round((monthlyPlan[11] + target - monthlyPlan.reduce((sum, amount) => sum + amount, 0)) * 100) / 100;
        MONTHS.forEach((month, index) => { row[month] = monthlyPlan[index]; });
        row.total = target;
    }

    function restoreGrowthRangeOriginal(row) {
        const original = row.growthRangeOriginal;
        if (!original || !Array.isArray(original.months)) return false;
        MONTHS.forEach((month, index) => { row[month] = Number(original.months[index]) || 0; });
        row.total = MONTHS.reduce((sum, month) => sum + (Number(row[month]) || 0), 0);
        if (original.rate !== undefined) row.rate = original.rate;
        delete row.growthRangeOriginal;
        return true;
    }

    function restoreGrowthRangeRows(rows) {
        return (rows || []).reduce((count, row) => count + (restoreGrowthRangeOriginal(row) ? 1 : 0), 0);
    }

    function applyGrowthRangeToRows(rows) {
        if (!growthRangeConfig.enabled) return 0;
        let changedCount = 0;
        (rows || []).forEach((row) => {
            const history = Number(row.history_nominal) || Number(row.manual_growth_base) || 0;
            const hasOriginal = Array.isArray(row.growthRangeOriginal?.months) && row.growthRangeOriginal.months.length > 0;
            const currentMonths = MONTHS.map(month => Number(row[month]) || 0);
            const sourceMonths = hasOriginal ? row.growthRangeOriginal.months.map(amount => Number(amount) || 0) : currentMonths;
            const sourceTotal = sourceMonths.reduce((sum, amount) => sum + amount, 0);
            if (history <= 0) {
                if (restoreGrowthRangeOriginal(row)) changedCount++;
                return;
            }

            const proposedRate = ((sourceTotal / history) - 1) * 100;
            const limitedRate = Math.min(growthRangeConfig.maxIncrease, Math.max(-growthRangeConfig.maxDecrease, proposedRate));
            if (Math.abs(proposedRate - limitedRate) < 0.0001) {
                if (restoreGrowthRangeOriginal(row)) changedCount++;
                return;
            }

            if (!hasOriginal) row.growthRangeOriginal = { months: currentMonths, rate: row.rate };
            const roundingDirection = proposedRate > growthRangeConfig.maxIncrease ? 'floor' : 'ceil';
            setGrowthRangeTotal(row, history * (1 + limitedRate / 100), sourceMonths, roundingDirection);
            row.rate = limitedRate;
            changedCount++;
        });
        return changedCount;
    }

    function getRowGrowthAnalysis(row) {
        const baseline = Number(row.history_nominal) || Number(row.manual_growth_base) || 0;
        if (baseline <= 0) return 'Basis history belum tersedia. Isi nominal history sebelum kenaikan dapat dianalisa.';

        const total = Number(row.total) || 0;
        const increase = total - baseline;
        if (Math.abs(increase) < 0.01) return 'Rencana tetap pada baseline. Pastikan kebutuhan dan tarif periode berikutnya belum berubah.';

        const percentage = (increase / baseline) * 100;
        const formattedPercent = `${percentage > 0 ? '+' : ''}${percentage.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
        if (increase < 0) {
            return `Rencana turun ${SmartBaraFormatters.formatRupiah(Math.abs(increase))} (${formattedPercent}). Pastikan kebutuhan memang berkurang atau kontrak selesai, bukan tertunda atau kurang dianggarkan.`;
        }

        const accountName = String(row.nama_akun || '').toLocaleLowerCase('id-ID');
        let rationale = 'Kemungkinan dipengaruhi perubahan volume kegiatan atau tarif; cocokkan dengan rencana kerja dan penawaran terbaru.';
        if (/penyusutan|depresiasi/.test(accountName)) rationale = 'Periksa daftar aset, nilai perolehan, dan masa manfaat yang menjadi dasar penyusutan.';
        else if (/maintenance|pemeliharaan|perbaikan|sparepart/.test(accountName)) rationale = 'Cocokkan dengan jadwal servis, kondisi aset, dan kebutuhan suku cadang.';
        else if (/asuransi/.test(accountName)) rationale = 'Periksa perubahan premi, nilai pertanggungan, dan daftar aset atau peserta aktif.';
        else if (/sewa|kontrak/.test(accountName)) rationale = 'Validasi tarif, jumlah unit, dan durasi pada kontrak terbaru.';
        else if (/kantor|office|atk|alat tulis|perlengkapan/.test(accountName)) rationale = 'Bandingkan kebutuhan dengan jumlah pengguna, stok, dan penawaran pemasok.';
        else if (/listrik|air|internet|telekomunikasi/.test(accountName)) rationale = 'Periksa tren konsumsi dan tarif layanan pada tagihan periode terakhir.';
        else if (/transport|bbm|ekspedisi|logistik|tol|perjalanan/.test(accountName)) rationale = 'Cocokkan frekuensi perjalanan, rute, volume layanan, dan tarif terbaru.';
        else if (/gaji|upah|pegawai|karyawan/.test(accountName)) rationale = 'Validasi jumlah personel, tarif upah, dan persetujuan perubahan tenaga kerja.';

        return `Rencana naik ${SmartBaraFormatters.formatRupiah(increase)} (${formattedPercent}). ${rationale}`;
    }

    async function updateRowGrowthRate(rowId, rawRate) {
        if (!SmartBaraCore.canWriteData()) return;
        const row = rowsData.find(item => item.id === rowId);
        if (!row) return;
        const parsedRate = Number(rawRate);
        if (!Number.isFinite(parsedRate)) return;

        const requestedRate = Math.min(1000, Math.max(-100, parsedRate));
        const rate = growthRangeConfig.enabled
            ? Math.min(growthRangeConfig.maxIncrease, Math.max(-growthRangeConfig.maxDecrease, requestedRate))
            : requestedRate;
        const baseline = Number(row.history_nominal) || Number(row.manual_growth_base) || 0;
        if (baseline <= 0 && Number(row.total) > 0) row.manual_growth_base = Number(row.total);
        const effectiveBaseline = Number(row.history_nominal) || Number(row.manual_growth_base) || 0;

        delete row.growthRangeOriginal;
        if (effectiveBaseline > 0) {
            const sourceMonths = MONTHS.map(month => Number(row[month]) || 0);
            if (growthRangeConfig.enabled && Math.abs(requestedRate - rate) > 0.0001) {
                const uncappedRow = { ...row };
                setGrowthRangeTotal(uncappedRow, effectiveBaseline * (1 + requestedRate / 100), sourceMonths, 'nearest');
                row.growthRangeOriginal = { months: MONTHS.map(month => uncappedRow[month]), rate: requestedRate };
                setGrowthRangeTotal(row, effectiveBaseline * (1 + rate / 100), sourceMonths, requestedRate > rate ? 'floor' : 'ceil');
            } else {
                setGrowthRangeTotal(row, effectiveBaseline * (1 + rate / 100), sourceMonths, 'nearest');
            }
        }
        row.rate = rate;
        row.growthMethod = 'manual';
        renderKPIs();
        renderTable();
        await saveToCloud();
    }

    async function updateGrowthRangeSettings() {
        if (!SmartBaraCore.canManageSettings() || isUpdatingGrowthRange) return;
        const enabled = document.getElementById('futureBudgetRangeEnabled')?.checked !== false;
        const maxIncrease = Number(document.getElementById('futureBudgetMaxIncrease')?.value);
        const maxDecrease = Number(document.getElementById('futureBudgetMaxDecrease')?.value);
        if (!Number.isFinite(maxIncrease) || maxIncrease < 0 || maxIncrease > 1000 || !Number.isFinite(maxDecrease) || maxDecrease < 0 || maxDecrease > 100) {
            window.SmartBaraLayout.notify({ title: 'Batas tidak valid', message: 'Batas kenaikan harus 0–1000% dan penurunan 0–100%.', type: 'error' });
            renderGrowthRangeControls();
            return;
        }

        const nextConfig = { enabled, maxIncrease, maxDecrease };
        isUpdatingGrowthRange = true;
        renderGrowthRangeControls();
        try {
            await SmartBaraCore.syncVersionedRow(
                'smartbara_settings',
                'global',
                { key: GROWTH_RANGE_SETTING_KEY },
                { value: nextConfig },
                `setting:${GROWTH_RANGE_SETTING_KEY}`,
                'Batas kenaikan budget'
            );
            growthRangeConfig = nextConfig;
            localStorage.setItem(GROWTH_RANGE_SETTING_KEY, JSON.stringify(growthRangeConfig));

            const changedCount = growthRangeConfig.enabled
                ? applyGrowthRangeToRows(rowsData)
                : restoreGrowthRangeRows(rowsData);
            renderGrowthRangeControls();
            renderKPIs();
            renderTable();
            await saveToCloud();
            const message = growthRangeConfig.enabled
                ? `Batas global aktif: +${maxIncrease}% / -${maxDecrease}%. ${changedCount} baris disesuaikan.`
                : `Batas global dimatikan. ${changedCount} baris dipulihkan ke proyeksi sebelumnya.`;
            window.SmartBaraLayout.notify({ title: 'Pengaturan tersimpan', message, type: 'success' });
        } catch(error) {
            console.error('Global growth range save error:', error);
            if (error.queuedForSync) {
                growthRangeConfig = nextConfig;
                localStorage.setItem(GROWTH_RANGE_SETTING_KEY, JSON.stringify(growthRangeConfig));
                const changedCount = growthRangeConfig.enabled
                    ? applyGrowthRangeToRows(rowsData)
                    : restoreGrowthRangeRows(rowsData);
                renderGrowthRangeControls();
                renderKPIs();
                renderTable();
                await saveToCloud();
                window.SmartBaraLayout.notify({ title: 'Menunggu sinkronisasi cloud', message: `Pengaturan diterapkan lokal; ${changedCount} baris menunggu koneksi cloud.`, type: 'info' });
                return;
            }
            renderGrowthRangeControls();
            window.SmartBaraLayout.notify({ title: 'Gagal menyimpan batas global', message: error.message || 'Pengaturan belum tersimpan.', type: 'error' });
        } finally {
            isUpdatingGrowthRange = false;
            renderGrowthRangeControls();
        }
    }

    function getPeriodYear(periodValue) {
        if (!periodValue) return new Date().getFullYear();
        const match = String(periodValue).match(/(\d{4})$/);
        if (match) return Number(match[1]);
        const numeric = Number.parseInt(String(periodValue), 10);
        return Number.isFinite(numeric) ? numeric : new Date().getFullYear();
    }

    function getTransactionField(transaction, names) {
        const entries = Object.entries(transaction || {});
        for (const name of names) {
            const normalizedName = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
            const entry = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName);
            if (entry) return entry[1];
        }
        return undefined;
    }

    function updatePeriodTitles() {
        const titleEl = document.getElementById('futureBudgetYearTitle');
        if (titleEl) {
            const currentYear = getPeriodYear(activePeriod);
            const nextYear = currentYear + 1;
            titleEl.textContent = `(${activePeriod} ➔ ${nextYear})`;
        }
    }

    function normalizeFutureBudgetRows(rows) {
        return (Array.isArray(rows) ? rows : []).map((row, index) => {
            const monthlyPlan = Array.isArray(row.monthlyPlan)
                ? row.monthlyPlan
                : MONTHS.map(month => Number(row[month]) || 0);
            const monthlyHistory = Array.isArray(row.monthlyHistory)
                ? row.monthlyHistory
                : Array.isArray(row.monthlyBaseline)
                    ? row.monthlyBaseline
                    : [];
            const historyTotal = monthlyHistory.reduce((sum, amount) => sum + (Number(amount) || 0), 0);
            const rowPlan = MONTHS.map((month, monthIndex) => Number(row[month] ?? monthlyPlan[monthIndex]) || 0);
            const planTotal = rowPlan.reduce((sum, amount) => sum + amount, 0);
            const growthRate = row.rate ?? row.annualGrowthRate ?? defaultRate;

            return {
                ...row,
                id: row.id || `FB_${activePeriod}_${index}`,
                nama_akun: row.nama_akun || row.account || row.nama || '',
                proyek: row.proyek || row.project || '',
                dept: row.dept || row.department || 'UMUM',
                history_nominal: Number(row.history_nominal ?? row.historyNominal ?? historyTotal) || 0,
                actual_nominal: row.actual_nominal === undefined || row.actual_nominal === null ? null : Number(row.actual_nominal) || 0,
                transaction_count: Number(row.transaction_count) || 0,
                undated_transactions: Number(row.undated_transactions) || 0,
                months_recorded: Number(row.months_recorded) || 0,
                months_elapsed: Number(row.months_elapsed) || 0,
                rate: Number.isFinite(Number(growthRate)) ? Number(growthRate) : defaultRate,
                ...Object.fromEntries(MONTHS.map((month, monthIndex) => [month, rowPlan[monthIndex]])),
                total: planTotal
            };
        });
    }

    function getPeriodElapsedMonths(periodValue, transactions, sourceYear) {
        const periodWords = ` ${String(periodValue || '').toLowerCase().replace(/[^a-z]/g, ' ')} `;
        for (let monthIndex = 0; monthIndex < PERIOD_MONTH_ALIASES.length; monthIndex++) {
            if (PERIOD_MONTH_ALIASES[monthIndex].some(alias => periodWords.includes(` ${alias} `))) return monthIndex + 1;
        }

        let latestObservedMonth = 0;
        (transactions || []).forEach(transaction => {
            const date = window.SmartBaraFormatters.normalizeDate(getTransactionField(transaction, ['tanggal', 'tgl']));
            if (!date || Number(date.slice(0, 4)) !== sourceYear) return;
            latestObservedMonth = Math.max(latestObservedMonth, Number(date.slice(5, 7)) || 0);
        });
        return latestObservedMonth || 12;
    }

    function groupTransactionsByDepartment(transactions) {
        const byDept = new Map();
        (transactions || []).forEach(transaction => {
            const dept = String(transaction.dept || transaction._department || 'UMUM');
            const key = dept.toUpperCase();
            if (!byDept.has(key)) byDept.set(key, { dept_name: dept, row_data: [] });
            byDept.get(key).row_data.push(transaction);
        });
        return [...byDept.values()];
    }

    function flattenStoreRows(storeRows) {
        return (storeRows || []).flatMap(store => {
            const rows = Array.isArray(store.row_data)
                ? store.row_data
                : Array.isArray(store.rows_data)
                    ? store.rows_data
                    : Array.isArray(store.dept_data)
                        ? store.dept_data
                        : [];
            return rows.map(transaction => ({ ...transaction, dept: transaction.dept || transaction._department || store.dept_name || store.department || 'UMUM' }));
        });
    }

    function aggregateReconcileForecast(storeRows, sourceYear, elapsedMonths) {
        const aggregated = new Map();
        (storeRows || []).forEach(store => {
            const dept = store.dept_name || store.department || 'UMUM';
            const transactions = Array.isArray(store.row_data)
                ? store.row_data
                : Array.isArray(store.rows_data)
                    ? store.rows_data
                    : Array.isArray(store.dept_data)
                        ? store.dept_data
                        : [];
            transactions.forEach(transaction => {
                const date = window.SmartBaraFormatters.normalizeDate(getTransactionField(transaction, ['tanggal', 'tgl']));
                const transactionYear = date ? Number(date.slice(0, 4)) : 0;
                if (transactionYear && transactionYear !== sourceYear) return;
                    const account = getTransactionField(transaction, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'nama akun up', 'nama akun', 'nama akun induk', 'akun']) || 'Lain-lain';
                    const project = getTransactionField(transaction, ['proyek_manual', '_calcProyek', '_proyekOverride', 'nama proyek up', 'proyek']) || 'Operasional Rutin';
                    const key = JSON.stringify([dept, account, project]);
                const entry = aggregated.get(key) || {
                    id: `FB_${Math.random().toString(36).slice(2, 11)}`,
                    dept,
                    nama_akun: account,
                    proyek: project,
                    actual_nominal: 0,
                    months: new Set(),
                    monthly_actual: new Array(12).fill(0),
                        transaction_count: 0,
                        undated_transactions: 0
                };
                const reconcile = Number(getTransactionField(transaction, ['nilai rekonsil', 'rekonsil', 'reconcile'])) || 0;
                const financeValue = getTransactionField(transaction, ['finance']);
                const finance = financeValue !== undefined && financeValue !== ''
                    ? Number(financeValue) || 0
                    : (Number(getTransactionField(transaction, ['debit', 'debet'])) || 0) - (Number(getTransactionField(transaction, ['kredit', 'credit'])) || 0);
                const nominal = reconcile !== 0 ? reconcile : finance;
                const actualValue = nominal + (Number(transaction.adj_rekonsil) || 0);
                entry.actual_nominal += actualValue;
                entry.transaction_count++;
                if (date) {
                    const monthIndex = Number(date.slice(5, 7)) - 1;
                    if (monthIndex >= 0 && monthIndex < 12) {
                        entry.months.add(monthIndex + 1);
                        entry.monthly_actual[monthIndex] += actualValue;
                    }
                }
                else entry.undated_transactions++;
                aggregated.set(key, entry);
            });
        });

        return [...aggregated.values()].map(entry => {
            const monthly_average = elapsedMonths ? entry.actual_nominal / elapsedMonths : 0;
            const annualized = monthly_average * 12;
            return {
                ...entry,
                months_recorded: entry.months.size,
                recorded_months: [...entry.months].sort((a, b) => a - b),
                monthly_actual: entry.monthly_actual,
                months_elapsed: elapsedMonths,
                monthly_average,
                annualized
            };
        });
    }

    function setReconcileBaseline(forecastRows, elapsedMonths) {
        baselineData.reconcileByDept = {};
        baselineData.reconcileForecastByDept = {};
        baselineData.reconcileRowIndex = new Map(forecastRows.map(item => [getReconcileDimensionKey(item), item]));
        const months = new Set();
        baselineData.transactionCount = 0;
        baselineData.undatedTransactionCount = 0;
        forecastRows.forEach(item => {
            const dept = String(item.dept || 'UMUM').toUpperCase();
            baselineData.reconcileByDept[dept] = (baselineData.reconcileByDept[dept] || 0) + item.actual_nominal;
            baselineData.reconcileForecastByDept[dept] = (baselineData.reconcileForecastByDept[dept] || 0) + item.annualized;
            baselineData.transactionCount += item.transaction_count;
            baselineData.undatedTransactionCount += item.undated_transactions;
            item.recorded_months.forEach(month => months.add(month));
        });
        baselineData.totalReconcile = Object.values(baselineData.reconcileByDept).reduce((sum, value) => sum + value, 0);
        baselineData.totalReconcileForecast = Object.values(baselineData.reconcileForecastByDept).reduce((sum, value) => sum + value, 0);
        baselineData.reconcileMonths = [...months].sort((a, b) => a - b).map(month => MONTH_LABELS[month - 1]);
        baselineData.elapsedMonths = elapsedMonths;
    }

    function buildMonthlyHistoryProfile(item) {
        const monthlyActual = Array.isArray(item.monthly_actual) ? item.monthly_actual : [];
        const recordedMonths = new Set((item.recorded_months || []).map(Number));
        if (!monthlyActual.length || !recordedMonths.size) {
            const annualBaseline = Number(item.annualized) || Number(item.history_nominal) || 0;
            const monthlyFallback = Number(item.monthly_average) || annualBaseline / 12;
            const profile = MONTHS.map(() => monthlyFallback);
            const target = Number(item.annualized) || profile.reduce((sum, value) => sum + value, 0);
            const total = profile.reduce((sum, value) => sum + value, 0);
            if (total !== 0 && target !== 0) profile.forEach((value, index) => { profile[index] = value * target / total; });
            profile[profile.length - 1] += target - profile.reduce((sum, value) => sum + value, 0);
            return profile;
        }
        const average = Number(item.monthly_average)
            || (Number(item.actual_nominal) && Number(item.months_elapsed)
                ? Number(item.actual_nominal) / Number(item.months_elapsed)
                : 0);
        const profile = MONTHS.map((_, index) => recordedMonths.has(index + 1)
            ? Number(monthlyActual[index]) || 0
            : average);
        const total = profile.reduce((sum, value) => sum + value, 0);
        const target = Number(item.annualized) || total;
        if (total !== 0 && target !== 0) profile.forEach((value, index) => { profile[index] = value * target / total; });
        let adjustmentIndex = MONTHS.length - 1;
        for (let index = MONTHS.length - 1; index >= 0; index--) {
            if (!recordedMonths.has(index + 1)) {
                adjustmentIndex = index;
                break;
            }
        }
        profile[adjustmentIndex] += target - profile.reduce((sum, value) => sum + value, 0);
        return profile;
    }

    function getReconcileDimensionKey(row) {
        return JSON.stringify([row.dept, row.nama_akun, row.proyek].map(value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')));
    }

    function getCurrentReconcileRow(row) {
        return baselineData.reconcileRowIndex.get(getReconcileDimensionKey(row));
    }

    function getSeasonalSourceMonths(row, fallbackMonths) {
        const actual = getCurrentReconcileRow(row);
        return actual && actual.recorded_months?.length
            ? buildMonthlyHistoryProfile(actual)
            : fallbackMonths;
    }

    function applySeasonalDistributionToRows(rows) {
        let changedCount = 0;
        (rows || []).forEach(row => {
            const actual = getCurrentReconcileRow(row);
            if (!actual || !actual.recorded_months?.length) return;

            const sourceMonths = buildMonthlyHistoryProfile(actual);
            const currentMonths = MONTHS.map(month => Number(row[month]) || 0);
            const currentTotal = currentMonths.reduce((sum, amount) => sum + amount, 0);
            const adjusted = {};
            setGrowthRangeTotal(adjusted, currentTotal, sourceMonths, 'nearest');
            const nextMonths = MONTHS.map(month => adjusted[month]);
            if (nextMonths.some((amount, index) => Math.abs(amount - currentMonths[index]) >= 0.01)) {
                MONTHS.forEach((month, index) => { row[month] = nextMonths[index]; });
                row.total = adjusted.total;
                changedCount++;
            }

            if (Array.isArray(row.growthRangeOriginal?.months)) {
                const originalMonths = row.growthRangeOriginal.months.map(amount => Number(amount) || 0);
                const originalTotal = originalMonths.reduce((sum, amount) => sum + amount, 0);
                const adjustedOriginal = {};
                setGrowthRangeTotal(adjustedOriginal, originalTotal, sourceMonths, 'nearest');
                row.growthRangeOriginal.months = MONTHS.map(month => adjustedOriginal[month]);
            }
        });
        return changedCount;
    }

    async function loadData() {
        const statusEl = document.getElementById('futureBudgetStatus');
        if (statusEl) statusEl.textContent = 'Memuat rencana masa depan...';

        try {
            // 1. Load Future Budget row from Supabase
            const { data, error } = await SmartBaraCore.supabase
                .from('smartbara_future_budget')
                .select('*')
                .eq('period_name', activePeriod)
                .maybeSingle();

            // Reset agar periode baru/kosong tidak membawa baris dari periode lain.
            rowsData = [];
            if (!error && data) {
                rowsData = normalizeFutureBudgetRows(data.rows_data);
                if (typeof data.default_rate === 'number') defaultRate = data.default_rate;
            } else {
                // Fallback to local storage if offline or not yet initialized
                const cached = localStorage.getItem(`smartbara_budget_future_v1_${activePeriod}`);
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        rowsData = normalizeFutureBudgetRows(parsed);
                    } catch(e) { rowsData = []; }
                }
            }

            // Set rate input
            const rateInput = document.getElementById('futureBudgetDefaultRate');
            if (rateInput) rateInput.value = defaultRate;

            const rangeChanges = growthRangeConfig.enabled
                ? applyGrowthRangeToRows(rowsData)
                : restoreGrowthRangeRows(rowsData);
            if (rangeChanges > 0) await saveToCloud();

            // 2. Fetch baseline comparison (Budget Existing & Reconcile store)
            await loadBaselines();
            if (applySeasonalDistributionToRows(rowsData) > 0) await saveToCloud();

            // 3. Render Views
            renderKPIs();
            renderTable();
            populateFilterOptions();

            renderSyncStatus();
        } catch(err) {
            console.error('Error loading future budget:', err);
            if (statusEl) statusEl.textContent = 'Gagal memuat dari cloud, menggunakan data lokal';
        }
    }

    async function loadBaselines() {
        try {
            const activePeriodKey = String(activePeriod || '').trim();
            const localBudgetKey = `smartbara_budget_v2_${activePeriodKey}`;
            let budgetRows = [];

            try {
                const cached = JSON.parse(localStorage.getItem(localBudgetKey) || '[]');
                if (Array.isArray(cached)) budgetRows = cached;
            } catch (error) {}

            if (SmartBaraCore.supabase) {
                try {
                    const { data: cloudBudgetRows, error: budgetError } = await SmartBaraCore.fetchPeriodRows('smartbara_budget', activePeriodKey);
                    if (budgetError) throw budgetError;
                    budgetRows = Array.isArray(cloudBudgetRows) ? cloudBudgetRows : [];
                    localStorage.setItem(localBudgetKey, JSON.stringify(budgetRows));
                } catch (budgetError) {
                    console.warn('Forecast memakai cache budget lokal setelah query cloud gagal:', budgetError);
                }
            }

            baselineData.existingByDept = {};
            (budgetRows || []).forEach(row => {
                const dept = String(row.dept || row.departemen || row.department || 'UMUM').toUpperCase();
                const monthlyTotal = Array.isArray(row.budget)
                    ? row.budget.reduce((sum, value) => sum + (Number(value) || 0), 0)
                    : MONTHS.reduce((sum, month) => sum + (Number(row[`budget_${month}`]) || 0), 0);
                const total = Number(row.total_tahun) || monthlyTotal;
                baselineData.existingByDept[dept] = (baselineData.existingByDept[dept] || 0) + total;
            });
            baselineData.totalExisting = Object.values(baselineData.existingByDept).reduce((sum, value) => sum + value, 0);

            const transactions = SmartBaraCore.getAllTransactions();
            const sourceYear = getPeriodYear(activePeriod);
            const elapsedMonths = getPeriodElapsedMonths(activePeriod, transactions, sourceYear);
            const forecastRows = aggregateReconcileForecast(groupTransactionsByDepartment(transactions), sourceYear, elapsedMonths);
            setReconcileBaseline(forecastRows, elapsedMonths);
            baselineData.deptCount = new Set(transactions.map(transaction => String(transaction.dept || transaction._department || 'UMUM').toUpperCase())).size;
            renderKPIs();
            renderTable();
        } catch(e) {
            console.warn('Baseline calculation warning:', e);
        }
    }

    function refreshBaselines() {
        loadBaselines();
    }

    function getGlobalDepartmentSet() {
        if (SmartBaraCore.isCombinedDepartments()) return null;
        return new Set(SmartBaraCore.getSelectedDepartments().map(dept => String(dept).toUpperCase()));
    }

    function getEffectiveDepartmentSet() {
        const pageFilter = document.getElementById('futureBudgetDeptFilter')?.value;
        const filteredValue = String(pageFilter || '').trim();
        if (filteredValue) {
            return new Set([filteredValue.toUpperCase()]);
        }
        return getGlobalDepartmentSet();
    }

    function renderSyncStatus() {
        const statusEl = document.getElementById('futureBudgetStatus');
        if (!statusEl) return;
        const plannedDepts = new Set(rowsData.map(row => String(row.dept || '').toUpperCase()));
        const missingDepts = SmartBaraCore.getDepartments().filter(dept => !plannedDepts.has(String(dept).toUpperCase()));
        const status = `Tersinkron (${rowsData.length} baris rencana)`;
        statusEl.textContent = missingDepts.length
            ? `${status} · ${missingDepts.join(', ')} belum ada di rencana, klik Refresh Aktual untuk menambahkan`
            : status;
    }

    function getDepartmentScopedRows() {
        const allowedDepts = getEffectiveDepartmentSet();
        if (!allowedDepts) return rowsData;
        return rowsData.filter(row => allowedDepts.has(String(row.dept || '').toUpperCase()));
    }

    function renderKPIs() {
        const currentYear = getPeriodYear(activePeriod);
        const nextYear = currentYear + 1;
        const selectedDepts = getEffectiveDepartmentSet();
        const filterByDept = !!selectedDepts && selectedDepts.size > 0;
        const visibleRows = getDepartmentScopedRows();
        const totalPlan = visibleRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
        const totalExisting = filterByDept
            ? [...selectedDepts].reduce((sum, dept) => sum + (Number(baselineData.existingByDept[dept]) || 0), 0)
            : baselineData.totalExisting;
        const totalReconcile = filterByDept
            ? [...selectedDepts].reduce((sum, dept) => sum + (Number(baselineData.reconcileByDept[dept]) || 0), 0)
            : baselineData.totalReconcile;
        const totalReconcileForecast = filterByDept
            ? [...selectedDepts].reduce((sum, dept) => sum + (Number(baselineData.reconcileForecastByDept[dept]) || 0), 0)
            : baselineData.totalReconcileForecast;

        // Update DOM elements
        setElText('futureBudgetTotalExisting', SmartBaraFormatters.formatRupiah(totalExisting));
        setElText('futureBudgetTotalReconcile', SmartBaraFormatters.formatRupiah(totalReconcile));
        setElText('futureBudgetTotalPlan', SmartBaraFormatters.formatRupiah(totalPlan));
        
        // Prediksi s/d Akhir Tahun
        const predUsage = totalReconcileForecast > 0 ? totalReconcileForecast : totalPlan;
        setElText('futureBudgetPredictionUsage', SmartBaraFormatters.formatRupiah(predUsage));

        // Prediksi Budget Tahun Depan (dengan rate)
        const predNextYear = predUsage * (1 + (defaultRate / 100));
        setElText('futureBudgetPredictionBudget', SmartBaraFormatters.formatRupiah(predNextYear));
        setElText('futureBudgetPredictionGrowth', `Kenaikan: +${defaultRate.toFixed(1)}% (${nextYear})`);

        // Pertumbuhan vs Rekonsil Excel
        if (totalReconcileForecast > 0) {
            const growthRec = ((totalPlan - totalReconcileForecast) / totalReconcileForecast) * 100;
            const sign = growthRec >= 0 ? '+' : '';
            setElText('futureBudgetGrowthSummary', `${sign}${growthRec.toFixed(1)}%`);
            setElText('futureBudgetGrowthBaseline', `Proyeksi aktual: ${SmartBaraFormatters.formatRupiah(totalReconcileForecast)}`);
        } else {
            setElText('futureBudgetGrowthSummary', '—');
            setElText('futureBudgetGrowthBaseline', 'Belum ada proyeksi aktual');
        }

        // Pertumbuhan vs Budget Existing
        if (totalExisting > 0) {
            const growthExist = ((totalPlan - totalExisting) / totalExisting) * 100;
            const sign = growthExist >= 0 ? '+' : '';
            setElText('futureBudgetExistingGrowthSummary', `${sign}${growthExist.toFixed(1)}%`);
            setElText('futureBudgetExistingGrowthDetail', `Budget Existing: ${SmartBaraFormatters.formatRupiah(totalExisting)}`);
        } else {
            setElText('futureBudgetExistingGrowthSummary', '—');
            setElText('futureBudgetExistingGrowthDetail', 'Budget Existing: Rp 0');
        }

        // Rata-rata Kenaikan / Akun
        const uniqueVisibleAccounts = new Set(visibleRows.map(row => normalizeFutureAccountKey(row)).filter(Boolean));
        if (visibleRows.length > 0) {
            const avgRate = visibleRows.reduce((sum, row) => sum + Number(row.rate ?? defaultRate), 0) / visibleRows.length;
            setElText('futureBudgetAccountAverageGrowth', `${avgRate >= 0 ? '+' : ''}${avgRate.toFixed(1)}%`);
            setElText('futureBudgetAccountAverageCount', `${uniqueVisibleAccounts.size} akun unik`);
        } else {
            setElText('futureBudgetAccountAverageGrowth', '—');
            setElText('futureBudgetAccountAverageCount', '0 akun unik');
        }

        // Active departments count
        const uniqueDepts = new Set(visibleRows.map(row => row.dept).filter(Boolean));
        setElText('futureBudgetActiveDepartmentCount', filterByDept ? uniqueDepts.size : (uniqueDepts.size || baselineData.deptCount || 0));
    }

    function normalizeFutureAccountKey(row) {
        const account = String(row?.nama_akun || row?.account || row?.nama || '').trim();
        return account ? account.toLowerCase() : null;
    }

    function setElText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function populateFilterOptions() {
        const deptFilter = document.getElementById('futureBudgetDeptFilter');
        if (!deptFilter) return;

        // Opsi mengikuti filter global saja. Filter halaman tidak boleh ikut menyaring,
        // kalau tidak dropdown menyusut menjadi satu dept yang sedang dipilih.
        const globalDepts = getGlobalDepartmentSet();
        const depts = [...new Set([...rowsData.map(row => row.dept), ...SmartBaraCore.getDepartments()]
            .map(dept => String(dept || '').trim().toUpperCase())
            .filter(dept => dept && (!globalDepts || globalDepts.has(dept))))].sort();
        const currentVal = deptFilter.value;
        deptFilter.innerHTML = '<option value="">Semua Departemen</option>' + 
            depts.map(d => `<option value="${SmartBaraFormatters.escapeHtml(d)}" ${d === currentVal ? 'selected' : ''}>${SmartBaraFormatters.escapeHtml(d)}</option>`).join('');
    }

    function getFilteredFutureRows() {
        const searchTerm = (document.getElementById('futureBudgetSearch')?.value || '').trim().toLowerCase();
        return getDepartmentScopedRows().filter(row => !searchTerm ||
            (row.nama_akun && row.nama_akun.toLowerCase().includes(searchTerm)) ||
            (row.dept && row.dept.toLowerCase().includes(searchTerm)) ||
            (row.proyek && row.proyek.toLowerCase().includes(searchTerm)));
    }

    function detailButton(key, rowId, content, className = '', displayIndex = '') {
        const rowAttribute = rowId ? ` data-row-id="${SmartBaraFormatters.escapeHtml(rowId)}"` : '';
        const indexAttribute = displayIndex ? ` data-display-index="${displayIndex}"` : '';
        return `<button type="button" data-future-detail="${SmartBaraFormatters.escapeHtml(key)}"${rowAttribute}${indexAttribute} class="${className} underline decoration-dotted underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400" title="Klik untuk melihat rumus dan sumber">${content}</button>`;
    }

    function renderTable() {
        const tbody = document.getElementById('futureBudgetTableBody');
        const tfoot = document.getElementById('futureBudgetTableFoot');
        if (!tbody) return;

        const filtered = getFilteredFutureRows();
        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="22" class="p-8 text-center text-slate-500">
                        Tidak ada baris anggaran masa depan yang sesuai dengan kriteria.
                    </td>
                </tr>
            `;
            if (tfoot) tfoot.innerHTML = '';
            return;
        }

        const totalRencanaSum = filtered.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
        const monthTotals = MONTHS.map(month => filtered.reduce((sum, row) => sum + (Number(row[month]) || 0), 0));
        const accountGroups = new Map();
        filtered.forEach((row, index) => {
            const key = (normalizeFutureAccountKey(row) || 'akun-tidak-bernama').replace(/\s+/g, ' ');
            const group = accountGroups.get(key) || { key, name: String(row.nama_akun || '-').trim(), rows: [] };
            group.rows.push({ row, index });
            accountGroups.set(key, group);
        });
        const displayRows = [];
        let groupIndex = 0;
        accountGroups.forEach((group) => {
            const currentGroupIndex = groupIndex++;
            displayRows.push({ type: 'account', group, groupIndex: currentGroupIndex });
            if (expandedAccountGroups.has(group.key)) {
                group.rows.forEach((item, projectIndex) => displayRows.push({ type: 'project', ...item, groupIndex: currentGroupIndex, projectIndex }));
            }
        });

        tbody.innerHTML = displayRows.map((entry) => {
            if (entry.type === 'account') {
                const { group, groupIndex } = entry;
                const isExpanded = expandedAccountGroups.has(group.key);
                const departments = [...new Set(group.rows.map(item => String(item.row.dept || '').trim()).filter(Boolean))];
                const groupTotal = group.rows.reduce((sum, item) => sum + (Number(item.row.total) || 0), 0);
                const sourceAvailable = baselineData.transactionCount > 0;
                const groupActual = group.rows.reduce((sum, item) => {
                    const current = getCurrentReconcileRow(item.row);
                    return sum + (Number(current?.actual_nominal ?? (sourceAvailable ? 0 : item.row.actual_nominal)) || 0);
                }, 0);
                const groupHistory = group.rows.reduce((sum, item) => {
                    const row = item.row;
                    const current = getCurrentReconcileRow(row);
                    return sum + (Number(row.history_nominal) || Number(row.manual_growth_base) || Number(current?.annualized) || 0);
                }, 0);
                const groupRate = group.rows.reduce((sum, item) => sum + (Number(item.row.rate ?? defaultRate) || 0), 0) / Math.max(group.rows.length, 1);
                const groupRateClass = groupRate >= 0 ? 'text-emerald-300' : 'text-amber-300';
                const groupMonthCols = MONTHS.map(month => {
                    const monthTotal = group.rows.reduce((sum, item) => sum + (Number(item.row[month]) || 0), 0);
                    return `<td class="bg-slate-800/80 px-2 py-2 text-right text-xs font-bold tabular-nums text-slate-200">${SmartBaraFormatters.formatRupiah(monthTotal)}</td>`;
                }).join('');
                const groupAnalysis = `${getRowGrowthAnalysis({ nama_akun: group.name, history_nominal: groupHistory, total: groupTotal })} Asumsi rata-rata baris: ${groupRate >= 0 ? '+' : ''}${groupRate.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%.`;
                return `
                    <tr class="border-b border-teal-400/15 bg-slate-800/80 font-bold">
                        <td class="bg-slate-800/80 px-2 py-2 text-center text-xs text-teal-300">${groupIndex + 1}</td>
                        <td class="bg-slate-800/80 px-2 py-2">
                            <button type="button" data-future-group-toggle data-group-key="${SmartBaraFormatters.escapeHtml(group.key)}" aria-expanded="${isExpanded}" class="flex items-center gap-2 text-left text-white hover:text-teal-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400">
                                <span class="text-teal-300" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
                                <span>${SmartBaraFormatters.escapeHtml(group.name)}</span>
                            </button>
                            <span class="ml-6 text-[9px] font-medium text-slate-400">${group.rows.length} proyek</span>
                        </td>
                        <td class="bg-slate-800/80 px-2 py-2 text-xs text-slate-300">${SmartBaraFormatters.escapeHtml(departments.join(', ') || '-')}</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-xs text-slate-400">${group.rows.length} proyek</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-right text-xs tabular-nums text-slate-200">${SmartBaraFormatters.formatRupiah(groupActual)}</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-right text-xs tabular-nums text-slate-200">${SmartBaraFormatters.formatRupiah(groupHistory)}</td>
                        <td class="bg-slate-800/80 px-2 py-2 text-center text-xs tabular-nums ${groupRateClass}">${groupRate >= 0 ? '+' : ''}${groupRate.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</td>
                        ${groupMonthCols}
                        <td class="bg-slate-800/80 px-2 py-2 text-right text-xs tabular-nums text-emerald-300">${SmartBaraFormatters.formatRupiah(groupTotal)}</td>
                        <td class="max-w-[420px] whitespace-normal bg-slate-800/80 px-2 py-2 text-[10px] leading-4 text-slate-300">${SmartBaraFormatters.escapeHtml(groupAnalysis)}</td>
                        <td class="bg-slate-800/80"></td>
                    </tr>
                `;
            }

            const row = entry.row;
            const idx = entry.index;
            const rowTotal = Number(row.total) || 0;
            const currentActual = getCurrentReconcileRow(row);
            const sourceAvailable = baselineData.transactionCount > 0;
            const actualNominal = currentActual?.actual_nominal ?? (sourceAvailable ? 0 : row.actual_nominal);
            const annualizedActual = Array.isArray(row.monthly_actual)
                ? (Number(row.history_nominal) || 0)
                : currentActual?.annualized ?? (sourceAvailable ? 0 : row.history_nominal);
            const transactionCount = currentActual?.transaction_count ?? (sourceAvailable ? 0 : row.transaction_count);
            const monthsRecorded = currentActual?.months_recorded ?? (sourceAvailable ? 0 : row.months_recorded);
            const undatedTransactions = currentActual?.undated_transactions ?? (sourceAvailable ? 0 : row.undated_transactions);
            const elapsedMonths = row.months_elapsed || baselineData.elapsedMonths;
            const actualCoverage = `${monthsRecorded || 0}/${elapsedMonths} bulan · ${transactionCount || 0} transaksi`;
            const monthCols = MONTHS.map((month) => {
                const value = Number(row[month]) || 0;
                return `<td class="text-right tabular-nums text-slate-300">${detailButton(`month:${month}`, row.id, value > 0 ? SmartBaraFormatters.formatRupiah(value) : '-', 'w-full text-right', idx + 1)}</td>`;
            }).join('');
            const rate = Number(row.rate ?? defaultRate);
            const minRate = growthRangeConfig.enabled ? -growthRangeConfig.maxDecrease : -100;
            const maxRate = growthRangeConfig.enabled ? growthRangeConfig.maxIncrease : 1000;
            const rateInput = `<input type="number" data-future-growth-rate data-row-id="${SmartBaraFormatters.escapeHtml(row.id)}" aria-label="Asumsi kenaikan ${SmartBaraFormatters.escapeHtml(row.nama_akun || '')}" min="${minRate}" max="${maxRate}" step="0.1" value="${rate.toFixed(1)}" onchange="BudgetFutureModule.updateRowGrowthRate(this.dataset.rowId, this.value)" ${SmartBaraCore.canWriteData() ? '' : 'disabled'} class="w-16 rounded border border-white/10 bg-slate-950 px-1.5 py-1 text-center text-xs font-bold tabular-nums text-teal-200 focus:border-teal-400 focus:outline-none">`;
            const rateCell = `<div class="flex items-center justify-center gap-1">${rateInput}${detailButton('rate', row.id, 'Rumus', 'text-[9px]')}</div>`;
            const actualContent = actualNominal === null
                ? '<span class="text-slate-500">Belum tersedia</span>'
                : `${SmartBaraFormatters.formatRupiah(actualNominal)}<span class="mt-0.5 block text-[9px] font-normal text-slate-500">${actualCoverage}${undatedTransactions ? ` · ${undatedTransactions} tanpa tanggal` : ''}</span>`;

            return `
                <tr class="hover:bg-white/5 transition border-b border-white/5">
                    <td class="text-center font-bold text-slate-500">${detailButton('number', row.id, `${entry.groupIndex + 1}.${entry.projectIndex + 1}`, 'text-center', idx + 1)}</td>
                    <td class="font-bold text-slate-500">${detailButton('account', row.id, '↳', 'pl-4 text-left text-slate-500')}</td>
                    <td><span class="badge badge-teal">${detailButton('department', row.id, SmartBaraFormatters.escapeHtml(row.dept || '-'), 'text-left')}</span></td>
                    <td class="text-slate-400 text-xs">${detailButton('project', row.id, SmartBaraFormatters.escapeHtml(row.proyek || '-'), 'text-left')}</td>
                    <td class="text-right tabular-nums text-slate-300">${detailButton('actual', row.id, actualContent, 'w-full text-right')}</td>
                    <td class="text-right tabular-nums text-slate-400">${detailButton('history', row.id, SmartBaraFormatters.formatRupiah(annualizedActual || 0), 'w-full text-right')}</td>
                    <td class="text-center">${rateCell}</td>
                    ${monthCols}
                    <td class="text-right font-black text-emerald-400 tabular-nums bg-teal-950/20">${detailButton('total', row.id, SmartBaraFormatters.formatRupiah(rowTotal), 'w-full text-right')}</td>
                    <td class="min-w-[320px] max-w-[420px] whitespace-normal text-xs leading-5 text-slate-400">${SmartBaraFormatters.escapeHtml(getRowGrowthAnalysis(row))}</td>
                    <td class="text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" onclick="BudgetFutureModule.openModal('${SmartBaraFormatters.escapeHtml(row.id)}')" class="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition" title="Edit Baris" aria-label="Edit ${SmartBaraFormatters.escapeHtml(row.nama_akun)}">✏️</button>
                            <button type="button" onclick="BudgetFutureModule.deleteRow('${SmartBaraFormatters.escapeHtml(row.id)}')" class="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition" title="Hapus Baris" aria-label="Hapus ${SmartBaraFormatters.escapeHtml(row.nama_akun)}">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (tfoot) {
            const footerMonthCols = monthTotals.map((value, monthIndex) =>
                `<td class="text-right tabular-nums text-teal-300">${detailButton(`month-total:${MONTHS[monthIndex]}`, '', value > 0 ? SmartBaraFormatters.formatRupiah(value) : '-', 'w-full text-right')}</td>`
            ).join('');
            tfoot.innerHTML = `
                <tr class="bg-slate-900/90 font-black border-t-2 border-teal-500/40 text-xs">
                    <td colspan="7" class="p-3 text-right uppercase tracking-wider text-slate-400">${detailButton('table-total-label', '', 'Total Keseluruhan', 'text-right uppercase tracking-wider')}</td>
                    ${footerMonthCols}
                    <td class="text-right tabular-nums text-emerald-400 text-sm bg-teal-950/40">${detailButton('table-total', '', SmartBaraFormatters.formatRupiah(totalRencanaSum), 'w-full text-right')}</td>
                    <td></td>
                    <td></td>
                </tr>
            `;
        }
    }

    function getCalculationDetail(key, row, displayIndex) {
        const formatCurrency = value => SmartBaraFormatters.formatRupiah(Number(value) || 0);
        const formatCurrencyPrecise = value => new Intl.NumberFormat('id-ID', {
            style: 'currency', currency: 'IDR', minimumFractionDigits: 2, maximumFractionDigits: 6
        }).format(Number(value) || 0);
        const filteredRows = getFilteredFutureRows();
        const scopedRows = getDepartmentScopedRows();
        const totalPlan = scopedRows.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
        const totalPlanByRows = scopedRows.reduce((sum, item) => sum + MONTHS.reduce((rowSum, month) => rowSum + (Number(item[month]) || 0), 0), 0);
        const planByMonth = MONTHS.map((month, index) => ({
            label: MONTH_LABELS[index],
            amount: scopedRows.reduce((sum, item) => sum + (Number(item[month]) || 0), 0)
        }));
        const selectedDepts = new Set(SmartBaraCore.getSelectedDepartments().map(dept => String(dept).toUpperCase()));
        const filterByDept = !SmartBaraCore.isCombinedDepartments();
        const scopedValue = (byDept, total) => filterByDept
            ? [...selectedDepts].reduce((sum, dept) => sum + (Number(byDept[dept]) || 0), 0)
            : total;
        const actualRecorded = scopedValue(baselineData.reconcileByDept, baselineData.totalReconcile);
        const predictedActual = scopedValue(baselineData.reconcileForecastByDept, baselineData.totalReconcileForecast);
        const totalExisting = scopedValue(baselineData.existingByDept, baselineData.totalExisting);
        const expectedEndYear = predictedActual > 0 ? predictedActual : totalPlan;
        const defaultGrowth = (Number(defaultRate) || 0) / 100;
        const elapsedMonths = baselineData.elapsedMonths || 12;
        const averageActualPerMonth = elapsedMonths ? actualRecorded / elapsedMonths : 0;
        const actualMonths = baselineData.reconcileMonths.length ? baselineData.reconcileMonths.join(', ') : 'belum ada tanggal';

        if (key === 'existing') return {
            title: 'Budget Existing', result: formatCurrency(totalExisting),
            formula: 'Σ budget per departemen. Gunakan total_tahun jika terisi; jika tidak, jumlahkan nilai Januari–Desember.',
            source: `smartbara_budget · periode ${activePeriod}`,
            reason: 'Angka ini menjadi pembanding terhadap rencana baru, bukan angka realisasi atau rekonsil.'
        };
        if (key === 'reconcileActual') return {
            title: 'Rekonsil Tercatat', result: formatCurrency(actualRecorded),
            formula: 'Σ (nilai rekonsil; jika kosong atau 0 gunakan finance, atau debit − kredit) + adj_rekonsil.',
            source: `${baselineData.transactionCount.toLocaleString('id-ID')} transaksi pada ${activePeriod}; ${baselineData.undatedTransactionCount.toLocaleString('id-ID')} transaksi tanpa tanggal. Bulan tercatat: ${actualMonths}.`,
            reason: 'Ini jumlah transaksi yang benar-benar tercatat untuk periode aktif, belum dikalikan untuk proyeksi setahun. Transaksi tanpa tanggal tetap dihitung satu kali karena berasal dari store periode aktif.'
        };
        if (key === 'totalPlan' || key === 'table-total') return {
            title: 'Total Rencana Masa Depan', result: formatCurrency(key === 'table-total' ? filteredRows.reduce((sum, item) => sum + (Number(item.total) || 0), 0) : totalPlan),
            formula: key === 'table-total'
                ? `Σ total rencana ${filteredRows.length} baris setelah filter = ${formatCurrency(filteredRows.reduce((sum, item) => sum + (Number(item.total) || 0), 0))}.`
                : `Langkah 1: jumlahkan tiap bulan dari ${scopedRows.length} baris.\n${planByMonth.map(month => `${month.label} ${formatCurrency(month.amount)}`).join(' + ')}\n\nLangkah 2: jumlahkan seluruh alokasi bulanan = ${formatCurrency(totalPlanByRows)}.`,
            source: key === 'table-total' ? `${filteredRows.length} baris pada tabel saat ini setelah pencarian/filter departemen.` : `${scopedRows.length} baris pada cakupan departemen aktif; rincian bulanan mengikuti alokasi pada tabel.`,
            reason: 'Total masa depan adalah jumlah alokasi rencana, bukan total rekonsil aktual atau budget existing. Penjumlahan bulanan dapat ditelusuri langsung dari footer tabel.'
        };
        if (key === 'predictedUsage') return {
            title: 'Prediksi Aktual Akhir Tahun', result: formatCurrency(expectedEndYear),
            formula: predictedActual > 0
                ? `Langkah 1: aktual tercatat ${formatCurrency(actualRecorded)} ÷ ${elapsedMonths} bulan berjalan = ${formatCurrencyPrecise(averageActualPerMonth)} rata-rata per bulan.\n\nLangkah 2: ${formatCurrencyPrecise(averageActualPerMonth)} × 12 bulan = ${formatCurrency(predictedActual)} prediksi akhir tahun.`
                : `Belum ada aktual yang dapat diproyeksikan. Nilai sementara menggunakan total rencana masa depan: ${formatCurrency(totalPlan)}.`,
            source: `Periode ${activePeriod}; bulan berjalan ${elapsedMonths}; ${baselineData.transactionCount.toLocaleString('id-ID')} transaksi; bulan bertanggal ${actualMonths}.`,
            reason: predictedActual > 0
                ? 'Rata-rata dihitung dari seluruh aktual pada cakupan departemen aktif, lalu diproyeksikan ke 12 bulan. Rumus memakai pembagi periode yang sama untuk seluruh akun agar akun dengan transaksi sedikit tidak dikalikan 12 secara berlebihan.'
                : 'Prediksi belum menggunakan annualisasi karena tidak ada aktual. Angka yang ditampilkan hanya fallback dari rencana masa depan.'
        };
        if (key === 'predictedNext') return {
            title: 'Prediksi Anggaran Tahun Depan', result: formatCurrency(expectedEndYear * (1 + defaultGrowth)),
            formula: `${formatCurrency(expectedEndYear)} × (1 + ${Number(defaultRate).toFixed(1)}% ÷ 100).`,
            source: 'Prediksi akhir tahun dan asumsi kenaikan global yang tampil di bagian atas.',
            reason: 'Asumsi global diterapkan setelah proyeksi tahunan aktual dihitung.'
        };
        if (key === 'growthReconcile') return {
            title: 'Rencana vs Proyeksi Aktual Setahun', result: predictedActual > 0 ? `${(((totalPlan - predictedActual) / predictedActual) * 100).toFixed(1)}%` : '—',
            formula: predictedActual > 0 ? `(${formatCurrency(totalPlan)} − ${formatCurrency(predictedActual)}) ÷ ${formatCurrency(predictedActual)} × 100%.` : 'Tidak dapat dihitung karena belum ada proyeksi aktual.',
            source: 'Total rencana dibandingkan dengan aktual yang diproyeksikan untuk 12 bulan.',
            reason: 'Perbandingan dilakukan dengan basis periode yang sama; bukan dengan aktual parsial saja.'
        };
        if (key === 'growthExisting') return {
            title: 'Rencana vs Budget Existing', result: totalExisting > 0 ? `${(((totalPlan - totalExisting) / totalExisting) * 100).toFixed(1)}%` : '—',
            formula: totalExisting > 0 ? `(${formatCurrency(totalPlan)} − ${formatCurrency(totalExisting)}) ÷ ${formatCurrency(totalExisting)} × 100%.` : 'Tidak dapat dihitung karena budget existing bernilai 0.',
            source: 'Total rencana masa depan dan total budget existing pada periode aktif.',
            reason: 'Persentase positif berarti rencana lebih tinggi daripada pagu existing; negatif berarti lebih rendah.'
        };
        if (key === 'accountAvg') {
            const rows = getDepartmentScopedRows();
            const average = rows.length ? rows.reduce((sum, item) => sum + (Number(item.rate) || 0), 0) / rows.length : 0;
            return {
                title: 'Rata-rata Asumsi per Baris', result: rows.length ? `${average >= 0 ? '+' : ''}${average.toFixed(1)}%` : '—',
                formula: rows.length ? 'Σ asumsi kenaikan setiap baris ÷ jumlah baris rencana.' : 'Belum ada baris rencana.',
                source: `${rows.length} baris pada departemen yang dipilih.`,
                reason: 'Rata-rata aritmetika ini memberi bobot sama pada tiap baris; bukan rata-rata tertimbang berdasarkan nominal.'
            };
        }
        if (key === 'table-total-label') return {
            title: 'Total Keseluruhan Tabel', result: `${filteredRows.length} baris`,
            formula: 'Baris yang cocok dengan pencarian dan departemen tabel saat ini.',
            source: 'Filter tabel Anggaran Masa Depan.',
            reason: 'Klik nilai total pada kolom atau bulan untuk melihat jumlah rupiahnya.'
        };
        if (key.startsWith('month-total:')) {
            const month = key.split(':')[1];
            const monthIndex = MONTHS.indexOf(month);
            const amount = filteredRows.reduce((sum, item) => sum + (Number(item[month]) || 0), 0);
            return {
                title: `Total ${MONTH_LABELS[monthIndex] || month}`,
                result: formatCurrency(amount),
                formula: `Σ alokasi ${MONTH_LABELS[monthIndex] || month} pada ${filteredRows.length} baris yang tampil.`,
                source: 'Baris setelah filter pencarian dan departemen tabel.',
                reason: 'Nilai footer menjumlahkan nominal bulan yang sama dari semua baris.'
            };
        }

        if (!row) {
            const columnDetails = {
                number: ['Nomor urut tampilan; tidak memengaruhi nominal.', 'Nomor hanya membantu menemukan baris setelah filter diterapkan.'],
                account: ['Nama akun dari transaksi atau nilai manual; tidak dihitung dengan rumus nominal.', 'Akun menjadi salah satu kunci pemisah aktual dan proyeksi.'],
                department: ['Departemen dari store transaksi atau baris rencana.', 'Departemen dipakai untuk filter dan subtotal.'],
                project: ['Nama proyek manual jika tersedia, lalu nama proyek pada transaksi.', 'Proyek dipisahkan supaya transaksi proyek berbeda tidak tergabung.'],
                actual: ['Σ (rekonsil; jika kosong/0 gunakan finance atau debit − kredit) + adj_rekonsil.', 'Menampilkan total transaksi tercatat; tidak diannualisasi.'],
                history: `${formatCurrency(actualRecorded)} ÷ ${elapsedMonths} bulan berjalan × 12 bulan.`,
                rate: ['Target tahunan = proyeksi aktual 12 bulan × (1 + asumsi ÷ 100).', 'Asumsi diterapkan pada basis tahunan sebelum nominal dibagi ke bulan.'],
                total: ['Total rencana = Σ alokasi Januari–Desember.', 'Total menjumlahkan nominal bulan yang tersimpan pada baris.']
            };
            if (key.startsWith('month:')) {
                const month = key.split(':')[1];
                const monthIndex = MONTHS.indexOf(month);
                return {
                    title: `Kolom ${MONTH_LABELS[monthIndex] || ''}`, result: 'Rincian per baris',
                    formula: 'Alokasi Januari–November = pembulatan target tahunan ÷ 12. Desember = target tahunan − jumlah Januari–November.',
                    source: 'Target tahunan memakai proyeksi aktual 12 bulan dan asumsi kenaikan pada masing-masing baris.',
                    reason: 'Klik nominal pada baris untuk melihat hasil dan nominal spesifik bulan tersebut.'
                };
            }
            const detail = columnDetails[key];
            return {
                title: ({ number: 'Nomor', account: 'Nama Akun', department: 'Departemen', project: 'Proyek UP', actual: 'Rekonsil Aktual', history: 'Proyeksi Aktual 12 Bulan', rate: 'Asumsi', total: 'Total Rencana' })[key] || 'Detail Anggaran',
                result: key === 'actual' ? formatCurrency(actualRecorded) : key === 'history' ? formatCurrency(predictedActual) : 'Rincian per baris',
                formula: Array.isArray(detail) ? detail[0] : detail || 'Pilih nilai pada baris untuk melihat rinciannya.',
                source: `Rencana periode ${activePeriod}; bulan berjalan ${elapsedMonths}.`,
                reason: Array.isArray(detail) ? detail[1] : 'Klik nilai pada baris untuk melihat nominal dan konteksnya.'
            };
        }

        const rowRate = Number(row.rate ?? defaultRate);
        const rowTotal = Number(row.total) || 0;
        const rowElapsed = row.months_elapsed || elapsedMonths;
        const currentActual = getCurrentReconcileRow(row);
        const sourceAvailable = baselineData.transactionCount > 0;
        const detailActual = currentActual?.actual_nominal ?? (sourceAvailable ? 0 : row.actual_nominal);
        const detailForecast = Array.isArray(row.monthly_actual)
            ? (Number(row.history_nominal) || 0)
            : currentActual?.annualized ?? (sourceAvailable ? 0 : row.history_nominal);
        if (key === 'number') return {
            title: 'Nomor Baris', result: String(displayIndex || '—'), formula: 'Nomor urut pada tabel setelah filter diterapkan.',
            source: `Akun ${row.nama_akun || '-'} · ${row.dept || '-'} · ${row.proyek || '-'}.`,
            reason: 'Nomor hanya untuk navigasi dan tidak memengaruhi perhitungan.'
        };
        if (key === 'account' || key === 'department' || key === 'project') {
            const values = { account: row.nama_akun || '-', department: row.dept || '-', project: row.proyek || '-' };
            const titles = { account: 'Nama Akun', department: 'Departemen', project: 'Proyek UP' };
            return {
                title: titles[key], result: values[key], formula: 'Tidak ada rumus nominal; nilai dipakai sebagai dimensi pengelompokan transaksi.',
                source: 'Nama akun/proyek manual jika tersedia, lalu nilai dari transaksi rekonsil.',
                reason: 'Dimensi dipisah agar aktual dan proyeksi tidak tercampur antar akun atau proyek.'
            };
        }
        if (key === 'actual') return {
            title: 'Rekonsil Tercatat pada Baris', result: detailActual === null ? 'Belum tersedia' : formatCurrency(detailActual),
            formula: currentActual || row.actual_nominal !== null ? 'Σ (rekonsil; jika kosong/0 gunakan finance atau debit − kredit) + adj_rekonsil.' : 'Tidak ada transaksi dengan kombinasi departemen, akun, dan proyek ini pada periode aktif = Rp 0.',
            source: currentActual ? `${currentActual.transaction_count.toLocaleString('id-ID')} transaksi; ${currentActual.undated_transactions.toLocaleString('id-ID')} tanpa tanggal; ${currentActual.months_recorded} bulan bertanggal dari ${currentActual.months_elapsed} bulan berjalan.` : sourceAvailable ? `Tidak ditemukan transaksi yang cocok untuk ${row.dept} · ${row.nama_akun} · ${row.proyek}.` : 'Data transaksi aktual belum dimuat.',
            reason: 'Nilai ini adalah aktual tercatat, bukan proyeksi. Kaitan aktual hanya untuk tampilan dan tidak mengubah alokasi rencana tersimpan.'
        };
        if (key === 'history') return {
            title: 'Baseline Historis 12 Bulan', result: formatCurrency(detailForecast),
            formula: currentActual && Array.isArray(row.monthly_actual)
                ? `${formatCurrency(currentActual.actual_nominal)} actual pada ${currentActual.months_recorded} bulan tercatat; ${12 - currentActual.months_recorded} bulan tanpa rekonsil memakai rata-rata periode ${formatCurrency(row.monthly_average || 0)} per bulan. Total baseline: ${formatCurrency(row.history_nominal)}.`
                : currentActual
                    ? `${formatCurrency(currentActual.actual_nominal)} ÷ ${currentActual.months_elapsed} bulan periode × 12 = ${formatCurrency(currentActual.annualized)}.`
                : sourceAvailable ? 'Tidak ada transaksi yang cocok pada periode aktif; baseline historis baris ini = Rp 0.' : 'Nilai basis proyeksi tersimpan; rincian aktual periode ini belum dimuat.',
            source: currentActual ? `${currentActual.transaction_count.toLocaleString('id-ID')} transaksi pada ${row.dept} · ${row.nama_akun} · ${row.proyek}.` : `Periode ${activePeriod}; kombinasi departemen-akun-proyek baris ini.`,
            reason: 'Bulan yang memiliki actual mempertahankan nominal historisnya. Hanya bulan tanpa rekonsil yang diisi memakai rata-rata bulan tercatat.'
        };
        if (key === 'rate') return {
            title: 'Asumsi Kenaikan', result: `${rowRate >= 0 ? '+' : ''}${rowRate.toFixed(1)}%`,
            formula: Array.isArray(row.monthly_actual)
                ? 'Target tiap bulan = actual bulan tersebut; bulan tanpa rekonsil memakai rata-rata bulanan periode, lalu dikalikan (1 + asumsi baris ÷ 100).'
                : 'Target tahunan = Proyeksi aktual setahun × (1 + asumsi kenaikan ÷ 100).',
            source: 'Asumsi baris; dapat berbeda dari asumsi global.',
            reason: Array.isArray(row.monthly_actual)
                ? 'Asumsi mengubah nilai tiap bulan secara proporsional dan mempertahankan pola aktual bulanan.'
                : 'Asumsi baris menentukan target total sebelum alokasi bulanan.'
        };
        if (key === 'total') return {
            title: 'Total Rencana Baris', result: formatCurrency(rowTotal),
            formula: `Σ ${MONTH_LABELS.map(label => label).join(' + ')} = ${formatCurrency(rowTotal)}.`,
            source: `${row.nama_akun} · ${row.dept} · ${row.proyek}.`,
            reason: 'Total dihitung ulang dari alokasi bulanan tersimpan, sehingga nilai total selalu sesuai dengan tabel.'
        };
        if (key.startsWith('month:')) {
            const month = key.split(':')[1];
            const monthIndex = MONTHS.indexOf(month);
            const value = Number(row[month]) || 0;
            const recorded = (row.recorded_months || []).includes(monthIndex + 1);
            const historyProfile = buildMonthlyHistoryProfile(row);
            const monthlyHistoryValue = Number(historyProfile[monthIndex]) || 0;
            const expected = monthlyHistoryValue * (1 + rowRate / 100);
            return {
                title: `Alokasi ${MONTH_LABELS[monthIndex] || month}`,
                result: formatCurrency(value),
                formula: `${recorded ? 'Actual bulan ini' : 'Rata-rata bulan actual tercatat'} ${formatCurrency(monthlyHistoryValue)} × (1 + ${rowRate.toFixed(1)}% ÷ 100) = ${formatCurrency(expected)}.`,
                source: `${row.nama_akun} · ${row.dept} · ${row.proyek}; ${recorded ? 'pola bulan tercatat' : 'bulan tidak tercatat, diisi rata-rata'}: ${formatCurrency(monthlyHistoryValue)}.`,
                reason: 'Pola actual bulanan dipertahankan. Asumsi diterapkan proporsional pada tiap bulan, bukan membagi total tahunan sama rata.'
            };
        }
        return {
            title: 'Detail Anggaran', result: formatCurrency(rowTotal),
            formula: 'Rincian perhitungan baris anggaran.', source: `${row.nama_akun} · ${row.dept} · ${row.proyek}.`,
            reason: 'Data ini digunakan untuk menyusun rencana anggaran masa depan.'
        };
    }

    function openCalculationDetail(key, rowId, displayIndex) {
        const row = rowId ? rowsData.find(item => item.id === rowId) : null;
        const detail = getCalculationDetail(key, row, displayIndex);
        const modal = document.getElementById('futureBudgetDetailModal');
        if (!modal) return;
        document.getElementById('futureBudgetDetailTitle').textContent = detail.title;
        document.getElementById('futureBudgetDetailResult').textContent = detail.result;
        document.getElementById('futureBudgetDetailFormula').textContent = detail.formula;
        document.getElementById('futureBudgetDetailSource').textContent = detail.source;
        document.getElementById('futureBudgetDetailReason').textContent = detail.reason;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
        document.getElementById('futureBudgetDetailClose')?.focus();
    }

    function closeCalculationDetail() {
        const modal = document.getElementById('futureBudgetDetailModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 200);
    }

    function updateAssumption() {
        if (!SmartBaraCore.canWriteData()) return;
        const rateInput = document.getElementById('futureBudgetDefaultRate');
        if (!rateInput) return;
        defaultRate = parseFloat(rateInput.value) || 0;
        renderKPIs();
    }

    async function applyDefaultRateToAll(targetRate) {
        if (!SmartBaraCore.canWriteData()) return;
        const rate = (typeof targetRate === 'number') ? targetRate : defaultRate;
        const affectedRows = getDepartmentScopedRows();
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi penerapan rate',
            message: `Terapkan kenaikan ${rate}% ke seluruh ${affectedRows.length} baris rencana anggaran yang sedang dipilih?`,
            confirmText: 'Terapkan',
            cancelText: 'Batal'
        });
        if (!confirmed) return;

        affectedRows.forEach(row => {
            delete row.growthRangeOriginal;
            row.rate = rate;
            const history = Number(row.history_nominal) || Number(row.manual_growth_base) || 0;
            if (history > 0) {
                const projectedTotal = history * (1 + (rate / 100));
                const sourceMonths = MONTHS.map(month => Number(row[month]) || 0);
                setGrowthRangeTotal(row, projectedTotal, sourceMonths, 'nearest');
            }
        });
        applyGrowthRangeToRows(rowsData);

        renderKPIs();
        renderTable();
        await saveToCloud();
    }

    async function refreshFromActual(showConfirmation = true) {
        if (!SmartBaraCore.canWriteData()) return;
        if (showConfirmation) {
            const confirmed = await window.SmartBaraLayout.confirmDialog({
                title: 'Refresh data aktual',
                message: 'Refresh Aktual akan mengganti seluruh baris rencana tersimpan dengan hasil terbaru per departemen, akun, dan proyek berdasarkan transaksi periode aktif. Lanjutkan?',
                confirmText: 'Lanjutkan',
                cancelText: 'Batal'
            });
            if (!confirmed) return;
        }

        const statusEl = document.getElementById('futureBudgetStatus');
        if (statusEl) statusEl.textContent = 'Menghitung ulang dari data rekonsil aktual...';
        const loadingTask = window.SmartBaraLayout.beginLoading('Menyusun forecast', `Mengolah data rekonsil periode ${activePeriod}...`);
        let refreshSucceeded = false;

        try {
            let storeRows = [];
            if (SmartBaraCore.supabase) {
                try {
                    const { data, error } = await SmartBaraCore.supabase
                        .from('smartbara_store')
                        .select('*')
                        .eq('period_name', activePeriod);
                    if (error) throw error;
                    storeRows = data || [];
                } catch (error) {
                    console.warn('Forecast memakai cache lokal setelah query cloud gagal:', error);
                }
            }
            // Jangan fallback ke data periode lain/global; periode baru harus tetap kosong.
            // (storeRows kosong = periode belum punya data transaksi)

            if (!Array.isArray(storeRows) || storeRows.length === 0) {
                if (showConfirmation) {
                    await window.SmartBaraLayout.alertDialog({
                        title: 'Data belum tersedia',
                        message: 'Tidak ada data store pada periode ini.',
                        confirmText: 'OK'
                    });
                }
                if (statusEl) statusEl.textContent = `Belum ada data rekonsil ${activePeriod} untuk membuat forecast.`;
                return;
            }

            const sourceYear = getPeriodYear(activePeriod);
            const sourceTransactions = flattenStoreRows(storeRows);
            const elapsedMonths = getPeriodElapsedMonths(activePeriod, sourceTransactions, sourceYear);
            const forecastRows = aggregateReconcileForecast(storeRows, sourceYear, elapsedMonths);
            if (!forecastRows.length) {
                if (statusEl) statusEl.textContent = `Tidak ditemukan transaksi bertanggal ${sourceYear}.`;
                return;
            }
            setReconcileBaseline(forecastRows, elapsedMonths);
            rowsData = forecastRows.map(item => {
                const monthlyHistory = buildMonthlyHistoryProfile(item);
                const historyTotal = monthlyHistory.reduce((sum, value) => sum + value, 0);
                const projectedMonths = monthlyHistory;
                const projected = historyTotal;
                const row = {
                    id: item.id,
                    dept: item.dept,
                    nama_akun: item.nama_akun,
                    proyek: item.proyek,
                    history_nominal: historyTotal,
                    actual_nominal: item.actual_nominal,
                    transaction_count: item.transaction_count,
                    undated_transactions: item.undated_transactions,
                    months_recorded: item.months_recorded,
                    recorded_months: item.recorded_months,
                    monthly_actual: item.monthly_actual,
                    monthly_average: item.monthly_average,
                    months_elapsed: item.months_elapsed,
                    rate: 0,
                    total: projected
                };
                MONTHS.forEach((month, index) => {
                    row[month] = projectedMonths[index];
                });
                return row;
            });
            applyGrowthRangeToRows(rowsData);

            renderKPIs();
            renderTable();
            populateFilterOptions();
            await saveToCloud();
            if (statusEl) statusEl.textContent = `Berhasil disegarkan (${rowsData.length} baris)`;
            refreshSucceeded = true;
        } catch(err) {
            console.error('Refresh actual error:', err);
            alert('Gagal merefresh dari aktual: ' + err.message);
        } finally {
            window.SmartBaraLayout.endLoading(loadingTask, refreshSucceeded);
        }
    }

    function openModal(rowId) {
        const modal = document.getElementById('futureBudgetModal');
        if (!modal) return;

        const row = rowsData.find(r => r.id === rowId) || {
            id: '',
            dept: '',
            nama_akun: '',
            proyek: '',
            history_nominal: 0,
            rate: defaultRate,
            jan: 0, feb: 0, mar: 0, apr: 0, mei: 0, jun: 0,
            jul: 0, agu: 0, sep: 0, okt: 0, nov: 0, des: 0
        };

        document.getElementById('fbModalRowId').value = row.id;
        document.getElementById('fbModalDept').value = row.dept || '';
        document.getElementById('fbModalAkun').value = row.nama_akun || '';
        document.getElementById('fbModalProyek').value = row.proyek || '';
        document.getElementById('fbModalHistory').value = row.history_nominal || row.manual_growth_base || 0;
        document.getElementById('fbModalRate').value = row.rate !== undefined ? row.rate : defaultRate;

        MONTHS.forEach(m => {
            const input = document.getElementById(`fbModal_${m}`);
            if (input) {
                input.step = '0.01';
                input.value = row[m] || 0;
            }
        });

        calculateModalTotal();
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeModal() {
        const modal = document.getElementById('futureBudgetModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    function calculateModalTotal() {
        let sum = 0;
        MONTHS.forEach(m => {
            const val = parseFloat(document.getElementById(`fbModal_${m}`)?.value) || 0;
            sum += val;
        });
        const totalEl = document.getElementById('fbModalTotalPreview');
        if (totalEl) totalEl.textContent = SmartBaraFormatters.formatRupiah(sum);
        return sum;
    }

    function applyHistoryCalculationToModal() {
        const history = parseFloat(document.getElementById('fbModalHistory')?.value) || 0;
        const rateInput = document.getElementById('fbModalRate');
        const requestedRate = parseFloat(rateInput?.value) || 0;
        let rate = requestedRate;
        if (growthRangeConfig.enabled) {
            rate = Math.min(growthRangeConfig.maxIncrease, Math.max(-growthRangeConfig.maxDecrease, rate));
            if (rateInput) rateInput.value = rate;
        }
        let projectedTotal = Math.round(history * (1 + (rate / 100)) * 100) / 100;
        if (growthRangeConfig.enabled && history > 0) {
            const minimumTotal = Math.ceil((history * (1 - growthRangeConfig.maxDecrease / 100) - 0.000000001) * 100) / 100;
            const maximumTotal = Math.floor((history * (1 + growthRangeConfig.maxIncrease / 100) + 0.000000001) * 100) / 100;
            if (minimumTotal <= maximumTotal) projectedTotal = Math.min(maximumTotal, Math.max(minimumTotal, projectedTotal));
        }
        const totalCents = Math.max(0, Math.round(projectedTotal * 100));
        const sourceMonths = getSeasonalSourceMonths({
            dept: document.getElementById('fbModalDept')?.value,
            nama_akun: document.getElementById('fbModalAkun')?.value,
            proyek: document.getElementById('fbModalProyek')?.value
        }, MONTHS.map(month => Number(document.getElementById(`fbModal_${month}`)?.value) || 0));
        const adjusted = {};
        setGrowthRangeTotal(adjusted, totalCents / 100, sourceMonths, 'nearest');

        MONTHS.forEach(m => {
            const input = document.getElementById(`fbModal_${m}`);
            if (input) {
                input.step = '0.01';
                input.value = Number(adjusted[m] || 0).toFixed(2);
            }
        });
        calculateModalTotal();
    }

    async function saveModalRow(e) {
        if (e) e.preventDefault();
        if (!SmartBaraCore.canWriteData()) return;

        const id = document.getElementById('fbModalRowId').value;
        const dept = document.getElementById('fbModalDept').value.trim();
        const nama_akun = document.getElementById('fbModalAkun').value.trim();
        const proyek = document.getElementById('fbModalProyek').value.trim();
        const history_nominal = parseFloat(document.getElementById('fbModalHistory').value) || 0;
        const rate = parseFloat(document.getElementById('fbModalRate').value) || 0;

        if (!dept || !nama_akun) {
            alert('Departemen dan Nama Akun wajib diisi.');
            return;
        }

        const newRow = {
            id: id || ('FB_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4)),
            dept,
            nama_akun,
            proyek,
            history_nominal,
            rate,
            total: 0
        };

        MONTHS.forEach(m => {
            newRow[m] = parseFloat(document.getElementById(`fbModal_${m}`)?.value) || 0;
            newRow.total += newRow[m];
        });
        applyGrowthRangeToRows([newRow]);

        if (id) {
            const index = rowsData.findIndex(r => r.id === id);
            if (index !== -1) rowsData[index] = newRow;
        } else {
            rowsData.push(newRow);
        }

        closeModal();
        renderKPIs();
        renderTable();
        populateFilterOptions();
        await saveToCloud();
    }

    async function deleteRow(id) {
        if (!SmartBaraCore.canDeleteData()) return;
        const row = rowsData.find(r => r.id === id);
        if (!row) return;

        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi hapus baris',
            message: `Hapus baris anggaran "${row.nama_akun}" (${row.dept})?`,
            confirmText: 'Hapus',
            cancelText: 'Batal',
            danger: true
        });
        if (!confirmed) return;

        rowsData = rowsData.filter(r => r.id !== id);
        renderKPIs();
        renderTable();
        populateFilterOptions();
        await saveToCloud();
    }

    // Modal Pindah Transaksi Akun
    function openMoveModal() {
        const modal = document.getElementById('futureBudgetMoveModal');
        if (!modal) return;

        // Populate accounts
        const akuns = [...new Set(rowsData.map(r => r.nama_akun).filter(Boolean))].sort();
        const srcSelect = document.getElementById('fbMoveSourceAkun');
        const tgtSelect = document.getElementById('fbMoveTargetAkun');

        if (srcSelect && tgtSelect) {
            const opts = akuns.map(a => `<option value="${SmartBaraFormatters.escapeHtml(a)}">${SmartBaraFormatters.escapeHtml(a)}</option>`).join('');
            srcSelect.innerHTML = '<option value="">Pilih Akun Sumber...</option>' + opts;
            tgtSelect.innerHTML = '<option value="">Pilih Akun Tujuan...</option>' + opts;
        }

        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeMoveModal() {
        const modal = document.getElementById('futureBudgetMoveModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    async function executeMove(e) {
        if (e) e.preventDefault();
        if (!SmartBaraCore.canWriteData()) return;

        const srcAkun = document.getElementById('fbMoveSourceAkun')?.value;
        const tgtAkun = document.getElementById('fbMoveTargetAkun')?.value;
        const percent = parseFloat(document.getElementById('fbMovePercent')?.value) || 100;

        if (!srcAkun || !tgtAkun) {
            alert('Pilih akun sumber dan akun tujuan.');
            return;
        }
        if (srcAkun === tgtAkun) {
            alert('Akun sumber dan tujuan tidak boleh sama.');
            return;
        }

        const srcRows = rowsData.filter(r => r.nama_akun === srcAkun);
        if (srcRows.length === 0) {
            alert('Tidak ada alokasi pada akun sumber.');
            return;
        }

        const factor = percent / 100;
        srcRows.forEach(src => {
            let tgt = rowsData.find(r => r.nama_akun === tgtAkun && r.dept === src.dept);
            if (!tgt) {
                tgt = {
                    id: 'FB_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
                    dept: src.dept,
                    nama_akun: tgtAkun,
                    proyek: src.proyek,
                    history_nominal: 0,
                    rate: src.rate,
                    total: 0
                };
                MONTHS.forEach(m => tgt[m] = 0);
                rowsData.push(tgt);
            }

            MONTHS.forEach(m => {
                const movedVal = Math.round((src[m] || 0) * factor);
                src[m] -= movedVal;
                tgt[m] += movedVal;
            });

            delete src.growthRangeOriginal;
            delete tgt.growthRangeOriginal;
            src.total = MONTHS.reduce((s, m) => s + (src[m] || 0), 0);
            tgt.total = MONTHS.reduce((s, m) => s + (tgt[m] || 0), 0);
        });

        closeMoveModal();
        renderKPIs();
        renderTable();
        await saveToCloud();
        alert(`Berhasil memindahkan ${percent}% anggaran dari "${srcAkun}" ke "${tgtAkun}".`);
    }

    async function saveToCloud() {
        if (!SmartBaraCore.canWriteData()) return;
        const rangeChanges = growthRangeConfig.enabled
            ? applyGrowthRangeToRows(rowsData)
            : restoreGrowthRangeRows(rowsData);
        if (rangeChanges > 0) {
            renderKPIs();
            renderTable();
        }
        if (isSaving) {
            savePending = true;
            return;
        }
        isSaving = true;
        const statusEl = document.getElementById('futureBudgetStatus');
        if (statusEl) statusEl.textContent = 'Menyimpan ke cloud...';

        try {
            do {
                savePending = false;
                const period = activePeriod;
                const rowsSnapshot = JSON.parse(JSON.stringify(rowsData));
                localStorage.setItem(`smartbara_budget_future_v1_${period}`, JSON.stringify(rowsSnapshot));

                await SmartBaraCore.syncVersionedRow(
                    'smartbara_future_budget',
                    period,
                    { period_name: period },
                    {
                        rows_data: rowsSnapshot,
                        default_rate: defaultRate,
                        config_data: { lastUpdatedBy: SmartBaraCore.currentUser?.email || 'Anonymous' }
                    },
                    'rows_data'
                );
            } while (savePending);

            if (statusEl) statusEl.textContent = 'Tersimpan ke cloud';
        } catch(err) {
            console.error('Save to cloud error:', err);
            savePending = false;
            if (statusEl) statusEl.textContent = 'Peringatan: Gagal sync cloud (data tersimpan di lokal)';
        } finally {
            isSaving = false;
        }
    }

    function buildPivotExportRows() {
        const departmentGroups = new Map();
        const normalizeLinkKey = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
        const scopedRows = getDepartmentScopedRows();
        scopedRows.forEach((row) => {
            const name = String(row.dept || 'UMUM').trim() || 'UMUM';
            const key = name.toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
            const group = departmentGroups.get(key) || { name, rows: [] };
            group.rows.push(row);
            departmentGroups.set(key, group);
        });

        const rows = [];
        Array.from(departmentGroups.entries()).sort(([left], [right]) => left.localeCompare(right, 'id')).forEach(([, group]) => {
            const groupTotal = group.rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
            const groupActual = group.rows.reduce((sum, row) => sum + (Number(getCurrentReconcileRow(row)?.actual_nominal ?? row.actual_nominal ?? 0) || 0), 0);
            const groupHistory = group.rows.reduce((sum, row) => sum + (Number(getCurrentReconcileRow(row)?.annualized ?? row.history_nominal ?? 0) || 0), 0);
            const groupRate = group.rows.reduce((sum, row) => sum + (Number(row.rate ?? defaultRate) || 0), 0) / Math.max(group.rows.length, 1);
            rows.push({
                type: 'department',
                account: 'TOTAL DEPARTEMEN',
                dept: group.name,
                proyek: '',
                actual_nominal: groupActual,
                history_nominal: groupHistory,
                rate: groupRate,
                monthValues: MONTHS.map(month => group.rows.reduce((sum, row) => sum + (Number(row[month]) || 0), 0)),
                total: groupTotal,
                note: `Subtotal departemen ${group.name}`
            });
            [...group.rows]
                .sort((left, right) =>
                    normalizeLinkKey(left.nama_akun).localeCompare(normalizeLinkKey(right.nama_akun), 'id') ||
                    normalizeLinkKey(left.proyek).localeCompare(normalizeLinkKey(right.proyek), 'id')
                )
                .forEach((row) => {
                const actual = Number(getCurrentReconcileRow(row)?.actual_nominal ?? row.actual_nominal ?? 0) || 0;
                const history = Number(getCurrentReconcileRow(row)?.annualized ?? row.history_nominal ?? 0) || 0;
                rows.push({
                    type: 'project',
                    account: row.nama_akun || 'Akun Tidak Diketahui',
                    dept: row.dept || '',
                    proyek: row.proyek || '-',
                    actual_nominal: actual,
                    history_nominal: history,
                    rate: Number(row.rate ?? defaultRate) || 0,
                    monthValues: MONTHS.map(month => Number(row[month]) || 0),
                    total: Number(row.total) || 0,
                    note: getRowGrowthAnalysis(row)
                });
                });
        });
        return rows;
    }

    function buildTransactionHistoryRows() {
        const txRows = [];
        const scopedDeptSet = getEffectiveDepartmentSet();
        const transactions = SmartBaraCore.getAllTransactions();
        const activeYear = getPeriodYear(activePeriod);
        transactions.forEach((transaction) => {
            const period = String(transaction.period_name || transaction.period || '').trim() || activePeriod;
            const dept = String(transaction.dept || transaction.department || 'UMUM').trim();
            const transactionYear = getPeriodYear(period);
            if (period && transactionYear !== activeYear) return;
            if (scopedDeptSet && !scopedDeptSet.has(String(dept).toUpperCase())) return;
            const account = String(getTransactionField(transaction, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'nama akun up', 'nama akun', 'nama akun induk', 'akun']) || transaction.nama_akun || 'Lain-lain').trim();
            const project = String(getTransactionField(transaction, ['proyek_manual', '_calcProyek', '_proyekOverride', 'nama proyek up', 'proyek', 'project']) || transaction.proyek || '-').trim();
            const date = window.SmartBaraFormatters.normalizeDate(getTransactionField(transaction, ['tanggal', 'tgl', 'date'])) || '';
            const noSumber = String(getTransactionField(transaction, ['no_sumber', 'no sumber', 'voucher', 'referensi', 'sumber']) || '').trim();
            const debit = Number(getTransactionField(transaction, ['debit', 'debet'])) || 0;
            const credit = Number(getTransactionField(transaction, ['kredit', 'credit'])) || 0;
            const finance = Number(getTransactionField(transaction, ['finance'])) || (debit - credit);
            const reconcile = Number(getTransactionField(transaction, ['nilai rekonsil', 'rekonsil', 'reconcile'])) || 0;
            const nominal = reconcile !== 0 ? reconcile : finance;
            const keterangan = String(getTransactionField(transaction, ['keterangan', 'deskripsi', 'uraian', 'catatan', 'note', 'memo', 'rincian']) || '').trim();
            txRows.push({
                period,
                dept,
                account,
                project,
                tanggal: date,
                no_sumber: noSumber,
                finance,
                reconcile,
                debit,
                credit,
                nominal,
                keterangan
            });
        });
        return txRows;
    }

    async function exportToExcel() {
        await SmartBaraConfig.ensureLibrary('exceljs');
        if (typeof ExcelJS === 'undefined') {
            alert('Modul ExcelJS sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Smart BARA';
        workbook.subject = `Anggaran Masa Depan ${activePeriod}`;
        workbook.title = `Anggaran Masa Depan ${activePeriod}`;
        const pivotSheet = workbook.addWorksheet(`Pivot ${activePeriod}`);
        pivotSheet.properties.tabColor = { argb: 'FF0D9488' };
        pivotSheet.views = [{ state: 'frozen', ySplit: 2 }];
        pivotSheet.mergeCells('A1:T1');
        pivotSheet.getCell('A1').value = `SMART BARA - RENCANA ANGGARAN MASA DEPAN (${activePeriod})`;
        pivotSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        pivotSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
        pivotSheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
        pivotSheet.getRow(1).height = 30;

        const headers = ['Nama Akun', 'Departemen', 'Proyek UP', 'Rekonsil Aktual', 'Proyeksi Aktual 12 Bulan', 'Asumsi %', ...MONTH_LABELS, 'Analisa Kenaikan', 'Total Rencana'];
        const headerRow = pivotSheet.addRow(headers);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 24;

        const historySheet = workbook.addWorksheet(`History ${activePeriod}`);
        historySheet.properties.tabColor = { argb: 'FF2563EB' };
        historySheet.views = [{ state: 'frozen', ySplit: 2 }];
        historySheet.mergeCells('A1:L1');
        historySheet.getCell('A1').value = `SMART BARA - HISTORI TRANSAKSI ${activePeriod}`;
        historySheet.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        historySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        historySheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
        historySheet.getRow(1).height = 28;

        const historyHeaders = ['Periode', 'Departemen', 'Nama Akun', 'Proyek UP', 'Tanggal', 'No Sumber', 'Keterangan', 'Nilai Finance', 'Nilai Rekonsil', 'Debit', 'Kredit', 'Nominal'];
        const historyHeaderRow = historySheet.addRow(historyHeaders);
        historyHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        historyHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        historyHeaderRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        historyHeaderRow.height = 30;

        const normalizeLinkKey = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/\\s+/g, ' ');
        const historyRows = buildTransactionHistoryRows().sort((left, right) =>
            normalizeLinkKey(left.account).localeCompare(normalizeLinkKey(right.account), 'id') ||
            normalizeLinkKey(left.dept).localeCompare(normalizeLinkKey(right.dept), 'id') ||
            normalizeLinkKey(left.project).localeCompare(normalizeLinkKey(right.project), 'id') ||
            String(left.tanggal || '').localeCompare(String(right.tanggal || ''))
        );
        const historyFirstRowByProject = new Map();
        historyRows.forEach((item, index) => {
            const rowNumber = index + 3;
            const projectKey = JSON.stringify([item.dept, item.account, item.project].map(normalizeLinkKey));
            if (!historyFirstRowByProject.has(projectKey)) historyFirstRowByProject.set(projectKey, rowNumber);
            const row = historySheet.addRow([
                item.period,
                item.dept,
                item.account,
                item.project,
                item.tanggal || '',
                item.no_sumber || '',
                item.keterangan || '',
                Number(item.finance) || 0,
                Number(item.reconcile) || 0,
                Number(item.debit) || 0,
                Number(item.credit) || 0,
                Number(item.nominal) || 0
            ]);
            if (index % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            [8, 9, 10, 11, 12].forEach(cellIndex => { row.getCell(cellIndex).numFmt = '"Rp "#,##0'; });
            [8, 9, 10, 11, 12].forEach(cellIndex => { row.getCell(cellIndex).alignment = { horizontal: 'right' }; });
        });
        historySheet.columns = [
            { width: 18 }, { width: 16 }, { width: 32 }, { width: 28 }, { width: 14 }, { width: 20 },
            { width: 42 }, { width: 20 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 20 }
        ];
        if (historyRows.length) {
            const transactionTotalRow = historySheet.addRow([
                'TOTAL TRANSAKSI', '', '', '', '', '', `${historyRows.length} transaksi`,
                historyRows.reduce((sum, item) => sum + (Number(item.finance) || 0), 0),
                historyRows.reduce((sum, item) => sum + (Number(item.reconcile) || 0), 0),
                historyRows.reduce((sum, item) => sum + (Number(item.debit) || 0), 0),
                historyRows.reduce((sum, item) => sum + (Number(item.credit) || 0), 0),
                historyRows.reduce((sum, item) => sum + (Number(item.nominal) || 0), 0)
            ]);
            transactionTotalRow.height = 24;
            transactionTotalRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            transactionTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
            [8, 9, 10, 11, 12].forEach(cellIndex => {
                transactionTotalRow.getCell(cellIndex).numFmt = '"Rp "#,##0';
                transactionTotalRow.getCell(cellIndex).alignment = { horizontal: 'right', vertical: 'middle' };
            });
            historySheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: historyRows.length + 2, column: 12 } };
        }

        const exportRows = buildPivotExportRows();
        exportRows.forEach((row) => {
            const values = [
                row.account,
                row.dept,
                row.proyek,
                Number(row.actual_nominal) || 0,
                Number(row.history_nominal) || 0,
                Number(row.rate || 0) / 100,
                ...row.monthValues.map(value => Number(value) || 0),
                row.note || '',
                Number(row.total) || 0
            ];
            const dataRow = pivotSheet.addRow(values);
            if (row.type === 'department') {
                dataRow.font = { bold: true, color: { argb: 'FFB7F0FF' } };
                dataRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102A3D' } };
            }
            const moneyCols = [4, 5, ...MONTHS.map((_, index) => index + 7), 20];
            moneyCols.forEach((colIndex) => {
                const cell = dataRow.getCell(colIndex);
                cell.numFmt = '"Rp "#,##0';
            });
            dataRow.getCell(6).numFmt = '0.0%';
            const projectKey = JSON.stringify([row.dept, row.account, row.proyek].map(normalizeLinkKey));
            const historyRow = row.type === 'project' ? historyFirstRowByProject.get(projectKey) : null;
            if (historyRow) {
                const accountCell = dataRow.getCell(1);
                accountCell.value = {
                    text: row.account,
                    hyperlink: `#'History ${activePeriod}'!A${historyRow}`
                };
                accountCell.font = { ...(accountCell.font || {}), underline: true, color: { argb: 'FF0F766E' } };
            }
            dataRow.getCell(1).alignment = { vertical: 'middle' };
            dataRow.getCell(19).alignment = { vertical: 'top', wrapText: true };
            if (row.type === 'department') dataRow.height = 22;
        });

        pivotSheet.columns = [
            { width: 32 }, { width: 16 }, { width: 24 }, { width: 18 }, { width: 22 }, { width: 12 },
            ...MONTH_LABELS.map(() => ({ width: 14 })), { width: 54 }, { width: 20 }
        ];

        const detailRows = exportRows.filter(row => row.type === 'project');
        const totalRow = pivotSheet.addRow([
            'TOTAL KESELURUHAN', '', '',
            detailRows.reduce((sum, row) => sum + (Number(row.actual_nominal) || 0), 0),
            detailRows.reduce((sum, row) => sum + (Number(row.history_nominal) || 0), 0),
            '',
            ...MONTHS.map(month => detailRows.reduce((sum, row) => sum + (Number(row.monthValues[MONTHS.indexOf(month)]) || 0), 0)),
            'Total seluruh akun dan proyek',
            detailRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0)
        ]);
        totalRow.height = 26;
        totalRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        totalRow.border = { top: { style: 'medium', color: { argb: 'FF5EEAD4' } } };
        [4, 5, ...MONTHS.map((_, index) => index + 7), 20].forEach(column => {
            totalRow.getCell(column).numFmt = '"Rp "#,##0';
            totalRow.getCell(column).alignment = { horizontal: 'right', vertical: 'middle' };
        });
        totalRow.getCell(19).alignment = { vertical: 'middle', wrapText: true };
        if (exportRows.length) pivotSheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: exportRows.length + 1, column: 20 } };

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SmartBARA_Anggaran_Masa_Depan_${activePeriod}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function bindEvents() {
        document.addEventListener('click', event => {
            const groupToggle = event.target.closest('[data-future-group-toggle]');
            if (groupToggle) {
                const key = groupToggle.dataset.groupKey;
                if (expandedAccountGroups.has(key)) expandedAccountGroups.delete(key);
                else expandedAccountGroups.add(key);
                renderTable();
                return;
            }
            const trigger = event.target.closest('[data-future-detail], [data-future-kpi]');
            if (!trigger) return;
            openCalculationDetail(trigger.dataset.futureDetail || trigger.dataset.futureKpi, trigger.dataset.rowId, trigger.dataset.displayIndex);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeCalculationDetail();
                return;
            }
            const trigger = event.target.closest('[data-future-kpi]');
            if (trigger && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                openCalculationDetail(trigger.dataset.futureKpi);
            }
        });
        ['futureBudgetRangeEnabled', 'futureBudgetMaxIncrease', 'futureBudgetMaxDecrease'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', updateGrowthRangeSettings);
        });
        document.getElementById('futureBudgetDeptFilter')?.addEventListener('change', () => {
            renderKPIs();
            renderTable();
        });
        window.addEventListener('smartbara:period_change', (e) => {
            activePeriod = e.detail?.period || SmartBaraCore.getActivePeriod();
            updatePeriodTitles();
            loadData().then(() => rowsData.length ? null : refreshFromActual(false));
        });
        window.addEventListener('smartbara:dept_filter_change', () => {
            populateFilterOptions();
            renderKPIs();
            renderTable();
            refreshBaselines();
        });
    }

    return {
        init,
        renderTable,
        updateAssumption,
        updateGrowthRangeSettings,
        updateRowGrowthRate,
        applyDefaultRateToAll,
        refreshFromActual,
        openModal,
        closeModal,
        closeCalculationDetail,
        calculateModalTotal,
        applyHistoryCalculationToModal,
        saveModalRow,
        deleteRow,
        openMoveModal,
        closeMoveModal,
        executeMove,
        exportToExcel,
        saveToCloud
    };
})();

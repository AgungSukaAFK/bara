window.AccountAlignmentModule = (function() {
    const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const MONTH_ALIASES = [
        ['januari', 'jan'], ['februari', 'feb'], ['maret', 'mar'], ['april', 'apr'],
        ['mei', 'may'], ['juni', 'jun'], ['juli', 'jul'], ['agustus', 'agu', 'agt', 'ags', 'aug'],
        ['september', 'sept', 'sep'], ['oktober', 'okt', 'oct'], ['november', 'nov'], ['desember', 'des', 'dec']
    ];
    const STOP_WORDS = new Set([
        'dan', 'atau', 'untuk', 'dengan', 'dari', 'pada', 'yang', 'di', 'ke', 'oleh', 'dalam', 'atas', 'serta',
        'biaya', 'beban', 'pembelian', 'pengadaan', 'pembayaran', 'transaksi', 'untuk', 'bulan', 'tahun', 'rp'
    ]);
    const ACCOUNT_SEMANTIC_GROUPS = [
        { names: ['bbm', 'bahan bakar'], terms: ['bbm', 'bensin', 'solar', 'bahan bakar', 'fuel', 'pertalite', 'pertamax', 'dexlite'] },
        { names: ['dapur', 'kebutuhan dapur'], terms: ['dapur', 'kebutuhan dapur', 'belanja dapur', 'bahan makanan', 'bahan pokok', 'kitchen', 'pantry', 'grocery', 'groceries', 'sembako'] },
        { names: ['atk', 'alat tulis'], terms: ['atk', 'alat tulis', 'alat tulis kantor', 'stationery', 'kertas', 'pulpen', 'pena', 'spidol', 'tinta', 'toner', 'map', 'amplop'] },
        { names: ['transportasi'], terms: ['transportasi', 'transport', 'perjalanan', 'taksi', 'taxi', 'grab', 'gojek', 'ojek', 'angkutan', 'antar jemput'] },
        { names: ['penyusutan', 'depresiasi'], terms: ['penyusutan', 'depresiasi', 'depreciation', 'reclass penyusutan'] },
        { names: ['asuransi'], terms: ['asuransi', 'insurance', 'premi polis'] },
        { names: ['pemeliharaan', 'perawatan'], terms: ['pemeliharaan', 'perawatan', 'maintenance', 'service kendaraan', 'servis kendaraan', 'perbaikan'] },
        { names: ['sewa'], terms: ['sewa', 'rental', 'kontrak sewa', 'ruko', 'sewa kendaraan'] },
        { names: ['listrik'], terms: ['listrik', 'token listrik', 'electricity', 'pln'] },
        { names: ['air'], terms: ['air', 'air bersih', 'air minum', 'pdam'] },
        { names: ['telekomunikasi'], terms: ['telekomunikasi', 'internet', 'wifi', 'pulsa', 'telepon', 'data seluler'] },
        { names: ['ongkos kirim', 'ekspedisi'], terms: ['ongkos kirim', 'ekspedisi', 'pengiriman', 'kurir', 'delivery', 'shipping'] },
        { names: ['pajak'], terms: ['pajak', 'pbb', 'pph', 'ppn', 'kir', 'pajak kendaraan'] },
        { names: ['materai'], terms: ['materai', 'meterai', 'bea materai'] },
        { names: ['bank', 'administrasi bank'], terms: ['administrasi bank', 'biaya bank', 'buku cek', 'giro', 'transfer bank', 'admin bank'] }
    ];
    let activePeriod = '';
    let analysis = null;
    let isUpdating = false;
    let updatePending = false;
    let pendingForceReload = false;

    function normalize(value) {
        return String(value || '').toLocaleLowerCase('id-ID').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    }

    function getField(row, names) {
        const entries = Object.entries(row || {});
        for (const name of names) {
            const key = normalize(name);
            const entry = entries.find(([candidate]) => normalize(candidate) === key);
            if (entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '') return entry[1];
        }
        return undefined;
    }

    function parseNumber(value) {
        return value === undefined ? 0 : window.SmartBaraFormatters.parseNumber(value, 0);
    }

    function tokenize(value) {
        return String(value || '').toLocaleLowerCase('id-ID').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/).filter(token => token.length > 1 && !STOP_WORDS.has(token));
    }

    function monthFromPeriod(period) {
        const tokens = String(period || '').toLocaleLowerCase('id-ID').split(/[^a-z]+/).filter(Boolean);
        return MONTH_ALIASES.findIndex(aliases => aliases.some(alias => tokens.includes(alias))) + 1;
    }

    function getTransactionAccount(row) {
        return String(getField(row, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'nama akun up', 'nama akun induk', 'nama akun', 'account name', 'akun']) || '').trim();
    }

    function getTransactionDescription(row) {
        return String(getField(row, ['keterangan', 'deskripsi', 'uraian', 'rincian', 'memo', 'item', 'nama barang', 'catatan', 'note']) || '').trim();
    }

    function getTransactionReconcile(row) {
        const reconcile = getField(row, ['rekonsil', 'nilai rekonsil', 'nilai rekonsiliasi', 'reconcile']);
        const adjustment = parseNumber(getField(row, ['adj_rekonsil']));
        if (reconcile !== undefined) return parseNumber(reconcile) + adjustment;
        const finance = getField(row, ['finance', 'nilai finance']);
        if (finance !== undefined) return parseNumber(finance) + adjustment;
        return parseNumber(getField(row, ['debit', 'debet'])) - parseNumber(getField(row, ['kredit', 'credit'])) + adjustment;
    }

    function getBudgetAccount(row) {
        return String(getField(row, ['nama', 'nama_akun', 'account_name', 'nama akun']) || '').trim();
    }

    function getBudgetDepartment(row) {
        return String(getField(row, ['dept', 'departemen', 'department']) || 'UMUM').trim().toUpperCase();
    }

    function getSelectedDepartmentScope() {
        if (window.SmartBaraCore.isCombinedDepartments()) return null;
        const selected = window.SmartBaraCore.getSelectedDepartments()
            .map(department => String(department || '').trim().toUpperCase())
            .filter(Boolean);
        if (!selected.length || selected.includes('ALL')) return null;
        return new Set(selected);
    }

    function isDepartmentInScope(department, scope) {
        return !scope || scope.has(String(department || 'UMUM').trim().toUpperCase());
    }

    function getAnnualBudget(row) {
        if (Array.isArray(row.budget)) return row.budget.reduce((sum, value) => sum + parseNumber(value), 0);
        const monthKeys = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
        const budgetFields = monthKeys.map(month => row[`budget_${month}`]);
        if (budgetFields.some(value => value !== undefined && value !== null)) return budgetFields.reduce((sum, value) => sum + parseNumber(value), 0);
        return parseNumber(row.total_tahun ?? row.total ?? row.total_budget);
    }

    function transactionMonth(row) {
        const normalized = window.SmartBaraFormatters.normalizeDate(getField(row, ['tanggal', 'date', 'tgl']));
        return normalized ? Number(normalized.slice(5, 7)) || 0 : 0;
    }

    function transactionYear(row) {
        const normalized = window.SmartBaraFormatters.normalizeDate(getField(row, ['tanggal', 'date', 'tgl']));
        return normalized ? Number(normalized.slice(0, 4)) || 0 : 0;
    }

    function getElapsedMonths(period, transactions) {
        const periodMonth = monthFromPeriod(period);
        if (periodMonth) return periodMonth;
        const months = transactions.map(transactionMonth).filter(Boolean);
        return months.length ? Math.max(...months) : 12;
    }

    function getStableTransactionId(row, department, occurrence) {
        return window.SmartBaraCore.createTransactionId(row, department, occurrence);
    }

    function readLocalOverrides(period) {
        try {
            const parsed = JSON.parse(localStorage.getItem(`smartbara_reconcile_overrides_${period}`) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch(e) {
            return {};
        }
    }

    async function loadOverrides(period) {
        const overrides = readLocalOverrides(period);
        const client = window.SmartBaraCore.getClient();
        if (!client) return overrides;
        const prefix = `smartbara_reconcile_override_${period}_`;
        try {
            const { data, error } = await client.from('smartbara_settings').select('key, value').like('key', `${prefix}%`);
            if (error) throw error;
            (data || []).forEach(item => {
                const id = String(item.value?.transaction_id || item.key.slice(prefix.length));
                if (item.value?.override && typeof item.value.override === 'object') overrides[id] = item.value.override;
            });
        } catch(error) {
            console.warn('Account alignment override load warning:', error);
        }
        return overrides;
    }

    async function loadBudgetRows(period) {
        let rows = [];
        try {
            const cached = JSON.parse(localStorage.getItem(`smartbara_budget_v2_${period}`) || '[]');
            if (Array.isArray(cached)) rows = cached;
        } catch(e) {}
        const client = window.SmartBaraCore.getClient();
        if (!client) return rows;
        try {
            const { data, error } = await client.from('smartbara_budget').select('*').eq('period_name', period);
            if (error) throw error;
            if (Array.isArray(data) && data.length) rows = data;
        } catch(error) {
            console.warn('Account alignment budget load warning:', error);
        }
        return rows;
    }

    function getAllStoredTransactions(departmentScope = getSelectedDepartmentScope()) {
        const departmentStore = window.SmartBaraCore.getDepartmentStore();
        const rows = [];
        Object.entries(departmentStore || {}).forEach(([departmentName, departmentRows]) => {
            const occurrences = new Map();
            (Array.isArray(departmentRows) ? departmentRows : []).forEach(row => {
                const department = String(row.dept || row._department || departmentName || 'UMUM').toUpperCase();
                if (!isDepartmentInScope(department, departmentScope)) return;
                const identity = [department, row.nama_akun || row.akun, row.proyek, row.no_sumber, row.keterangan]
                    .map(value => String(value || '').trim().toLocaleLowerCase('id-ID')).join('|');
                const occurrence = (occurrences.get(identity) || 0) + 1;
                occurrences.set(identity, occurrence);
                rows.push({ ...row, dept: department, _alignmentId: getStableTransactionId(row, department, occurrence) });
            });
        });
        if (rows.length) return rows;
        return window.SmartBaraCore.getAllTransactions()
            .filter(row => isDepartmentInScope(row.dept || row._department, departmentScope))
            .map(row => ({ ...row, _alignmentId: String(row.id || '') }));
    }

    function tokenSetSimilarity(leftTokens, rightTokens) {
        if (!leftTokens.size || !rightTokens.size) return 0;
        let overlap = 0;
        leftTokens.forEach(token => { if (rightTokens.has(token)) overlap++; });
        return overlap / Math.max(leftTokens.size, rightTokens.size);
    }

    function descriptionSimilarity(tokens, profile) {
        if (!tokens?.size || !profile?.size) return 0;
        let matches = 0;
        tokens.forEach(token => { if (profile.has(token)) matches++; });
        return matches / tokens.size;
    }

    function normalizePhrase(value) {
        return String(value || '').toLocaleLowerCase('id-ID').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function containsPhrase(text, phrase) {
        const normalizedText = ` ${normalizePhrase(text)} `;
        return normalizedText.includes(` ${normalizePhrase(phrase)} `);
    }

    function prepareBudgetCandidates(budgetAccounts, profiles) {
        const preparedGroups = ACCOUNT_SEMANTIC_GROUPS.map(group => ({
            names: group.names.map(normalizePhrase),
            terms: group.terms.map(normalizePhrase)
        }));
        return budgetAccounts.map(candidate => {
            const normalizedName = ` ${normalizePhrase(candidate.name)} `;
            return {
                candidate,
                nameTokens: new Set(tokenize(candidate.name)),
                profile: profiles.get(candidate.key),
                semanticGroups: preparedGroups.filter(group => group.names.some(name => normalizedName.includes(` ${name} `)))
            };
        });
    }

    function getPreparedSemanticEvidence(preparedCandidate, context, contextTokens) {
        let score = 0;
        let directMatches = 0;
        preparedCandidate.nameTokens.forEach(token => { if (contextTokens.has(token)) directMatches++; });
        if (directMatches) score = Math.min(0.82, 0.58 + (directMatches - 1) * 0.12);
        preparedCandidate.semanticGroups.forEach(group => {
            if (group.terms.some(term => context.includes(` ${term} `))) score = Math.max(score, 0.96);
        });
        return score;
    }

    function recommendBudgetAccount(transaction, preparedCandidates, budgetByKey) {
        const actualName = transaction._alignmentAccount;
        const exact = budgetByKey.get(normalize(actualName));
        const descriptionTokens = tokenize(`${transaction._alignmentDescription} ${actualName}`);
        const descriptionTokenSet = new Set(descriptionTokens);
        const actualNameTokens = new Set(tokenize(actualName));
        const context = ` ${normalizePhrase(transaction._alignmentDescription)} `;
        const contextTokens = new Set(tokenize(transaction._alignmentDescription));
        let best = null;
        let secondScore = 0;
        const scoredCandidates = [];
        preparedCandidates.forEach(preparedCandidate => {
            const candidate = preparedCandidate.candidate;
            const nameScore = tokenSetSimilarity(actualNameTokens, preparedCandidate.nameTokens);
            const historyScore = descriptionSimilarity(descriptionTokenSet, preparedCandidate.profile);
            const semanticScore = getPreparedSemanticEvidence(preparedCandidate, context, contextTokens);
            const score = nameScore * 0.25 + historyScore * 0.3 + semanticScore * 0.45;
            scoredCandidates.push({ candidate, score, nameScore, historyScore, semanticScore });
            if (!best || score > best.score) {
                if (best) secondScore = best.score;
                best = scoredCandidates[scoredCandidates.length - 1];
            } else if (score > secondScore) {
                secondScore = score;
            }
        });
        const explicitCandidates = scoredCandidates.filter(candidate => candidate.semanticScore >= 0.9)
            .sort((left, right) => right.score - left.score);
        const explicitCandidate = explicitCandidates[0];
        const explicitIsUnambiguous = Boolean(explicitCandidate && (
            explicitCandidates.length === 1 || explicitCandidate.score - explicitCandidates[1].score >= 0.045
        ));
        if (exact && explicitIsUnambiguous && explicitCandidate.candidate.key !== exact.key) {
            return {
                ...transaction,
                recommendedKey: explicitCandidate.candidate.key,
                recommendedName: explicitCandidate.candidate.name,
                candidateName: explicitCandidate.candidate.name,
                status: 'Rekomendasi',
                confidence: explicitCandidate.score,
                exact: false
            };
        }
        if (exact) return { ...transaction, recommendedKey: exact.key, recommendedName: exact.name, status: 'Cocok', confidence: 1, exact: true };
        const confident = Boolean(best && best.score >= 0.18 && (best.semanticScore >= 0.5 || best.score - secondScore >= 0.045));
        return {
            ...transaction,
            recommendedKey: confident ? best.candidate.key : '',
            recommendedName: confident ? best.candidate.name : '',
            candidateName: best?.candidate.name || '',
            status: confident ? 'Rekomendasi' : 'Tinjau manual',
            confidence: best?.score || 0,
            exact: false
        };
    }

    function buildAnalysis(transactions, budgetRows, overrides, period) {
        const year = Number(String(period).match(/\d{4}/)?.[0]) || 0;
        const includedTransactions = transactions.filter(row => !year || !transactionYear(row) || transactionYear(row) === year).map(row => {
            const override = overrides[row._alignmentId] || {};
            const effective = { ...row, ...override };
            return {
                ...effective,
                _alignmentId: row._alignmentId,
                _alignmentDepartment: String(effective.dept || effective._department || row.dept || 'UMUM').trim().toUpperCase(),
                _alignmentAccount: getTransactionAccount(effective),
                _alignmentDescription: getTransactionDescription(effective),
                _alignmentAmount: getTransactionReconcile(effective),
                _alignmentMonth: transactionMonth(effective)
            };
        });

        const budgetMap = new Map();
        budgetRows.forEach(row => {
            const name = getBudgetAccount(row);
            const key = normalize(name);
            if (!key) return;
            const account = budgetMap.get(key) || { key, name, departments: new Set(), budget: 0 };
            account.departments.add(getBudgetDepartment(row));
            account.budget += getAnnualBudget(row);
            budgetMap.set(key, account);
        });
        const budgetAccounts = [...budgetMap.values()]
            .map(account => ({ ...account, departments: [...account.departments].sort() }))
            .sort((a, b) => a.name.localeCompare(b.name, 'id'));
        const budgetByKey = new Map(budgetAccounts.map(account => [account.key, account]));
        const profiles = new Map(budgetAccounts.map(account => [account.key, new Map()]));
        includedTransactions.forEach(transaction => {
            const exact = budgetByKey.get(normalize(transaction._alignmentAccount));
            if (!exact) return;
            const profile = profiles.get(exact.key);
            tokenize(transaction._alignmentDescription).forEach(token => {
                profile.set(token, (profile.get(token) || 0) + 1);
            });
        });

        const preparedCandidates = prepareBudgetCandidates(budgetAccounts, profiles);
        const transactionRecommendations = includedTransactions.map(transaction => recommendBudgetAccount(transaction, preparedCandidates, budgetByKey));
        const actualAccountMap = new Map();
        transactionRecommendations.forEach(transaction => {
            const name = transaction._alignmentAccount || '(Nama akun kosong)';
            const key = normalize(name) || '__empty__';
            const account = actualAccountMap.get(key) || {
                key, name, transactions: [], amount: 0, descriptions: new Map(), recommendationMap: new Map(), confidenceTotal: 0,
                exactCount: 0, unresolvedCount: 0
            };
            account.transactions.push(transaction);
            account.amount += transaction._alignmentAmount;
            account.confidenceTotal += transaction.confidence || 0;
            if (transaction.exact) account.exactCount++;
            if (transaction.status === 'Tinjau manual') account.unresolvedCount++;
            if (transaction.recommendedKey) {
                const recommendation = account.recommendationMap.get(transaction.recommendedKey) || {
                    key: transaction.recommendedKey, name: transaction.recommendedName, count: 0, amount: 0, exactCount: 0
                };
                recommendation.count++;
                recommendation.amount += transaction._alignmentAmount;
                if (transaction.exact) recommendation.exactCount++;
                account.recommendationMap.set(transaction.recommendedKey, recommendation);
            }
            if (transaction._alignmentDescription) {
                const descriptionKey = transaction._alignmentDescription.toLocaleLowerCase('id-ID');
                const description = account.descriptions.get(descriptionKey) || { text: transaction._alignmentDescription, count: 0 };
                description.count++;
                account.descriptions.set(descriptionKey, description);
            }
            actualAccountMap.set(key, account);
        });

        const allocationMap = new Map(budgetAccounts.map(account => [account.key, {
            account,
            amount: 0,
            transactionCount: 0,
            exactCount: 0,
            actualNames: new Set(),
            descriptions: new Map()
        }]));
        transactionRecommendations.forEach(transaction => {
            if (!transaction.recommendedKey) return;
            const allocation = allocationMap.get(transaction.recommendedKey);
            if (!allocation) return;
            allocation.amount += transaction._alignmentAmount;
            allocation.transactionCount++;
            if (transaction.exact) allocation.exactCount++;
            if (transaction._alignmentAccount) allocation.actualNames.add(transaction._alignmentAccount);
            if (transaction._alignmentDescription) {
                const current = allocation.descriptions.get(transaction._alignmentDescription) || { text: transaction._alignmentDescription, count: 0 };
                current.count++;
                allocation.descriptions.set(transaction._alignmentDescription, current);
            }
        });

        const mappedActualAccounts = [...actualAccountMap.values()].map(account => {
            const recommendations = [...account.recommendationMap.values()].sort((a, b) => b.count - a.count || Math.abs(b.amount) - Math.abs(a.amount));
            const main = recommendations[0];
            const hasMixedRecommendations = recommendations.length > 1 || account.unresolvedCount > 0;
            const status = account.exactCount === account.transactions.length
                ? 'Cocok'
                : main ? (hasMixedRecommendations ? 'Campuran' : 'Rekomendasi') : 'Tinjau manual';
            return {
                ...account,
                recommendedKey: main?.key || '',
                recommendedName: main?.name || '',
                candidateName: recommendations[1]?.name || '',
                recommendations,
                confidence: account.transactions.length ? account.confidenceTotal / account.transactions.length : 0,
                status,
                exact: account.exactCount === account.transactions.length
            };
        });

        const elapsedMonths = Math.max(1, getElapsedMonths(period, includedTransactions));
        const rate = Math.max(-100, Math.min(500, Number(document.getElementById('alignmentRate')?.value) || 0));
        const budgetRecommendations = [...allocationMap.values()].map(allocation => {
            const projectedActual = allocation.amount / elapsedMonths * 12;
            const recommendedBudget = Math.max(0, projectedActual * (1 + rate / 100));
            const types = [...allocation.descriptions.values()].sort((a, b) => b.count - a.count).slice(0, 3);
            return {
                ...allocation.account,
                actualAmount: allocation.amount,
                projectedActual,
                recommendedBudget,
                transactionCount: allocation.transactionCount,
                exactCount: allocation.exactCount,
                actualNames: [...allocation.actualNames].sort((a, b) => a.localeCompare(b, 'id')),
                types
            };
        });

        const namedTransactions = includedTransactions.filter(row => row._alignmentAccount).length;
        const exactTransactions = transactionRecommendations.filter(transaction => transaction.exact).length;
        const unresolvedTransactions = transactionRecommendations.filter(transaction => transaction.status === 'Tinjau manual').length;
        const recommendationTransactions = transactionRecommendations.filter(transaction => !transaction.exact && transaction.recommendedKey).length;
        const totalAmount = includedTransactions.reduce((sum, row) => sum + row._alignmentAmount, 0);
        return {
            period,
            year,
            elapsedMonths,
            rate,
            transactions: includedTransactions,
            transactionRecommendations,
            budgetAccounts,
            actualAccounts: mappedActualAccounts.sort((a, b) => b.transactions.length - a.transactions.length || a.name.localeCompare(b.name, 'id')),
            budgetRecommendations: budgetRecommendations.sort((a, b) => b.recommendedBudget - a.recommendedBudget || a.name.localeCompare(b.name, 'id')),
            totalTransactions: includedTransactions.length,
            namedTransactions,
            exactTransactions,
            matchPercent: namedTransactions ? exactTransactions / namedTransactions * 100 : 0,
            recommendationTransactions,
            unresolvedTransactions,
            totalAmount
        };
    }

    async function init() {
        activePeriod = window.SmartBaraCore.getActivePeriod();
        document.getElementById('alignmentSearch')?.addEventListener('input', render);
        document.getElementById('alignmentRate')?.addEventListener('input', () => {
            if (analysis) {
                analysis = {
                    ...buildAnalysis(analysis.transactions, analysis._budgetRows, analysis._overrides, activePeriod),
                    departmentLabel: analysis.departmentLabel,
                    _budgetRows: analysis._budgetRows,
                    _overrides: analysis._overrides
                };
                render();
            }
        });
        window.addEventListener('smartbara:period_change', event => {
            activePeriod = event.detail?.period || window.SmartBaraCore.getActivePeriod();
            update(true);
        });
        window.addEventListener('smartbara:store_loaded', event => {
            if (event.detail?.period === activePeriod) update(false);
        });
        window.addEventListener('smartbara:dept_filter_change', () => update(false));
        window.SmartBaraCore.onRealtimeChange(payload => {
            if (['smartbara_store', 'smartbara_budget', 'smartbara_settings'].includes(payload.table)) update(true);
        });
        await update(false);
    }

    async function update(forceReload = false) {
        if (isUpdating) {
            updatePending = true;
            pendingForceReload = pendingForceReload || forceReload;
            return;
        }
        isUpdating = true;
        const button = document.getElementById('alignmentRefreshButton');
        const status = document.getElementById('alignmentStatus');
        if (button) button.disabled = true;
        if (status) status.textContent = `Menganalisa transaksi dan budget ${activePeriod}...`;
        try {
            await window.SmartBaraCore.loadPeriodStore(activePeriod, forceReload, { showOverlay: false });
            const departmentScope = getSelectedDepartmentScope();
            const [transactions, budgetRows, overrides] = await Promise.all([
                Promise.resolve(getAllStoredTransactions(departmentScope)),
                loadBudgetRows(activePeriod),
                loadOverrides(activePeriod)
            ]);
            const scopedBudgetRows = budgetRows.filter(row => isDepartmentInScope(getBudgetDepartment(row), departmentScope));
            const nextAnalysis = buildAnalysis(transactions, scopedBudgetRows, overrides, activePeriod);
            const departmentLabel = departmentScope ? [...departmentScope].sort().join(', ') : 'semua departemen';
            analysis = { ...nextAnalysis, departmentLabel, _budgetRows: scopedBudgetRows, _overrides: overrides };
            render();
            if (status) status.textContent = `${analysis.totalTransactions.toLocaleString('id-ID')} transaksi · ${analysis.budgetAccounts.length} akun budget · ${departmentLabel} · ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
        } catch(error) {
            console.error('Account alignment analysis error:', error);
            if (status) status.textContent = `Analisa gagal dimuat: ${error.message}`;
        } finally {
            isUpdating = false;
            if (button) button.disabled = false;
            if (updatePending) {
                const reload = pendingForceReload;
                updatePending = false;
                pendingForceReload = false;
                await update(reload);
            }
        }
    }

    function escape(value) {
        return window.Formatters.escapeHtml(value ?? '');
    }

    function render() {
        if (!analysis) return;
        const query = String(document.getElementById('alignmentSearch')?.value || '').trim().toLocaleLowerCase('id-ID');
        const setText = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        setText('alignmentTransactionCount', analysis.totalTransactions.toLocaleString('id-ID'));
        setText('alignmentMatchRate', `${analysis.matchPercent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
        setText('alignmentBudgetAccountCount', analysis.budgetAccounts.length.toLocaleString('id-ID'));
        setText('alignmentReviewCount', analysis.unresolvedTransactions.toLocaleString('id-ID'));
        setText('alignmentAnnualActual', window.Formatters.formatRupiah(analysis.totalAmount));
        setText('alignmentPeriodLabel', `${analysis.period} · proyeksi ${analysis.elapsedMonths} bulan berjalan`);

        const recommendationBody = document.getElementById('alignmentBudgetTableBody');
        const actualBody = document.getElementById('alignmentActualTableBody');
        const budgetRows = analysis.budgetRecommendations.filter(row => !query || [row.name, row.departments.join(' '), row.actualNames.join(' '), row.types.map(type => type.text).join(' ')].join(' ').toLocaleLowerCase('id-ID').includes(query));
        const actualRows = analysis.actualAccounts.filter(row => !query || [row.name, row.recommendedName, row.candidateName, row.status, row.recommendations.map(item => item.name).join(' '), row.transactions.map(item => item._alignmentDescription).join(' ')].join(' ').toLocaleLowerCase('id-ID').includes(query));

        if (recommendationBody) recommendationBody.innerHTML = budgetRows.map(row => {
            const types = row.types.length ? row.types.map(type => `<span class="block">${escape(type.text)} <span class="text-slate-500">(${type.count.toLocaleString('id-ID')}x)</span></span>`).join('') : '<span class="text-slate-500">Belum ada transaksi terarah</span>';
            const actualNames = row.actualNames.length ? row.actualNames.map(escape).join(', ') : '—';
            const delta = row.recommendedBudget - row.budget;
            return `<tr>
                <td class="font-semibold text-white">${escape(row.name)}</td>
                <td class="text-xs text-slate-400">${actualNames}</td>
                <td class="text-right tabular-nums">${window.Formatters.formatRupiah(row.budget)}</td>
                <td class="text-right tabular-nums text-teal-200">${window.Formatters.formatRupiah(row.actualAmount)}</td>
                <td class="text-right tabular-nums text-slate-300">${window.Formatters.formatRupiah(row.projectedActual)}</td>
                <td class="text-right tabular-nums font-bold text-amber-300">${window.Formatters.formatRupiah(row.recommendedBudget)}</td>
                <td class="text-right tabular-nums ${delta >= 0 ? 'text-rose-300' : 'text-emerald-300'}">${delta >= 0 ? '+' : ''}${window.Formatters.formatRupiah(delta)}</td>
                <td class="min-w-64 text-[11px] leading-5 text-slate-300">${types}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="8" class="py-8 text-center text-slate-500">Tidak ada akun budget yang sesuai.</td></tr>';

        if (actualBody) actualBody.innerHTML = actualRows.map(row => {
            const confidence = row.exact ? 100 : row.confidence * 100;
            const badge = row.status === 'Cocok' ? 'bg-emerald-500/15 text-emerald-300' : ['Rekomendasi', 'Campuran'].includes(row.status) ? 'bg-amber-500/15 text-amber-200' : 'bg-rose-500/15 text-rose-200';
            const descriptions = [...row.descriptions.values()].sort((a, b) => b.count - a.count).slice(0, 2).map(item => item.text).join(' · ') || 'Keterangan tidak tersedia';
            const recommendations = row.recommendations.slice(0, 3).map(item => `<span class="block">${escape(item.name)} <span class="text-slate-500">(${item.count.toLocaleString('id-ID')} transaksi)</span></span>`).join('') || escape(row.candidateName || 'Belum ada akun budget yang sepadan');
            return `<tr>
                <td class="font-semibold text-white">${escape(row.name)}</td>
                <td class="text-slate-400">${escape([...new Set(row.transactions.map(item => item._alignmentDepartment))].sort().join(', '))}</td>
                <td><span class="rounded px-2 py-1 text-[10px] font-bold ${badge}">${escape(row.status)}</span></td>
                <td class="font-semibold ${row.recommendations.length ? 'text-teal-200' : 'text-rose-200'}">${recommendations}</td>
                <td class="text-right tabular-nums">${row.transactions.length.toLocaleString('id-ID')}</td>
                <td class="text-right tabular-nums">${window.Formatters.formatRupiah(row.amount)}</td>
                <td class="text-right tabular-nums">${confidence.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</td>
                <td class="min-w-72 max-w-[28rem] text-[11px] leading-5 text-slate-400">${escape(descriptions)}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="8" class="py-8 text-center text-slate-500">Tidak ada akun realisasi yang sesuai.</td></tr>';
    }

    function styleWorksheet(sheet, title, subtitle, headers, rows, widths) {
        const lastColumn = headers.length;
        sheet.mergeCells(1, 1, 1, lastColumn);
        const titleCell = sheet.getCell(1, 1);
        titleCell.value = title;
        titleCell.font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
        sheet.getRow(1).height = 30;
        sheet.mergeCells(2, 1, 2, lastColumn);
        const subtitleCell = sheet.getCell(2, 1);
        subtitleCell.value = subtitle;
        subtitleCell.font = { name: 'Aptos', size: 10, italic: true, color: { argb: 'FF475569' } };
        subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        sheet.getRow(2).height = 22;
        const headerRow = sheet.addRow(headers);
        headerRow.height = 26;
        headerRow.eachCell(cell => {
            cell.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF164E63' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = { top: { style: 'thin', color: { argb: 'FF0F172A' } }, bottom: { style: 'thin', color: { argb: 'FF0F172A' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        });
        rows.forEach((values, index) => {
            const row = sheet.addRow(values);
            row.height = 24;
            row.eachCell({ includeEmpty: true }, cell => {
                const fill = index % 2 === 0 ? 'FFF8FAFC' : 'FFEFF6F7';
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
                cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF0F172A' } };
                cell.alignment = { vertical: 'middle', wrapText: true };
                cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
            });
        });
        sheet.columns = widths.map(width => ({ width }));
        sheet.views = [{ state: 'frozen', ySplit: 3 }];
        sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, rows.length + 3), column: lastColumn } };
    }

    async function exportExcel() {
        if (!analysis) return;
        const button = document.getElementById('alignmentExportButton');
        if (button) button.disabled = true;
        try {
            await window.SmartBaraConfig.ensureLibrary('exceljs');
            if (!window.ExcelJS) throw new Error('Library ExcelJS belum tersedia.');
            const workbook = new window.ExcelJS.Workbook();
            workbook.creator = 'Smart BARA';
            workbook.subject = 'Analisa penyelarasan nama akun';
            workbook.created = new Date();
            const subtitle = `Periode ${analysis.period} · Departemen ${analysis.departmentLabel || 'semua departemen'} · Ekspor ${new Date().toLocaleString('id-ID')} · Read-only; tidak mengubah data aplikasi`;

            const summary = workbook.addWorksheet('Ringkasan');
            styleWorksheet(summary, 'ANALISA PENYELARASAN NAMA AKUN', subtitle, ['Indikator', 'Nilai', 'Keterangan'], [
                ['Transaksi dianalisa', analysis.totalTransactions, `Transaksi departemen ${analysis.departmentLabel || 'semua departemen'} pada store periode aktif`],
                ['Kecocokan nama akun tepat', analysis.matchPercent / 100, 'Transaksi bernama yang akun realisasinya sama dengan akun Budget Plan'],
                ['Akun Budget Plan', analysis.budgetAccounts.length, `Nama akun unik dari Budget Plan departemen ${analysis.departmentLabel || 'semua departemen'}`],
                ['Transaksi diarahkan', analysis.recommendationTransactions, 'Akun realisasi yang diarahkan ke kandidat akun budget'],
                ['Transaksi perlu tinjau manual', analysis.unresolvedTransactions, 'Belum cukup bukti nama/pola keterangan untuk rekomendasi otomatis'],
                ['Nilai Rekonsil total', analysis.totalAmount, 'Nilai transaksi aktual yang dianalisa'],
                ['Bulan proyeksi', analysis.elapsedMonths, 'Jumlah bulan berjalan dari nama periode atau tanggal transaksi'],
                ['Asumsi tambahan', analysis.rate / 100, 'Persentase yang diterapkan pada proyeksi 12 bulan'],
                ['Rumus budget rekomendasi', `Nilai Rekonsil teralokasi ÷ ${analysis.elapsedMonths} × 12 × (1 + ${analysis.rate}%)`, 'Alokasi otomatis hanya merupakan analisa; periksa rekomendasi sebelum digunakan']
            ], [32, 24, 92]);
            summary.getCell('B5').numFmt = '0.0%';
            summary.getCell('B11').numFmt = '0.0%';
            summary.getCell('B9').numFmt = '#,##0;[Red]-#,##0';

            const budgetSheet = workbook.addWorksheet('Rekomendasi Budget');
            styleWorksheet(budgetSheet, 'REKOMENDASI NILAI BUDGET PER AKUN', subtitle,
                ['Nama Akun Budget Plan', 'Departemen Budget', 'Nama Akun Realisasi Terarah', 'Budget Tahunan Saat Ini', 'Nilai Rekonsil Terarah', 'Proyeksi Aktual 12 Bulan', 'Rekomendasi Budget', 'Selisih Rekomendasi', 'Jumlah Transaksi', 'Tipe Transaksi Contoh'],
                analysis.budgetRecommendations.map(row => [row.name, row.departments.join(', '), row.actualNames.join(', '), row.budget, row.actualAmount, row.projectedActual, row.recommendedBudget, row.recommendedBudget - row.budget, row.transactionCount, row.types.map(type => `${type.text} (${type.count}x)`).join(' | ')]),
                [34, 24, 44, 22, 22, 22, 22, 22, 18, 68]);
            for (let rowIndex = 4; rowIndex <= budgetSheet.rowCount; rowIndex++) {
                for (let column = 4; column <= 8; column++) budgetSheet.getCell(rowIndex, column).numFmt = '#,##0;[Red]-#,##0';
            }

            const mappingSheet = workbook.addWorksheet('Pemetaan Akun');
            styleWorksheet(mappingSheet, 'PEMETAAN AKUN REALISASI KE BUDGET PLAN', subtitle,
                ['Nama Akun Realisasi', 'Departemen', 'Status Analisa', 'Rekomendasi Akun Budget', 'Kandidat Terdekat', 'Jumlah Transaksi', 'Nilai Rekonsil', 'Keyakinan Rekomendasi', 'Contoh Tipe Transaksi'],
                analysis.actualAccounts.map(row => [row.name, [...new Set(row.transactions.map(item => item._alignmentDepartment))].sort().join(', '), row.status, row.recommendedName, row.candidateName, row.transactions.length, row.amount, row.confidence, [...row.descriptions.values()].sort((a, b) => b.count - a.count).slice(0, 3).map(item => `${item.text} (${item.count}x)`).join(' | ')]),
                [38, 22, 20, 36, 36, 18, 22, 22, 72]);
            for (let rowIndex = 4; rowIndex <= mappingSheet.rowCount; rowIndex++) {
                mappingSheet.getCell(rowIndex, 7).numFmt = '#,##0;[Red]-#,##0';
                mappingSheet.getCell(rowIndex, 8).numFmt = '0.0%';
            }

            const detailSheet = workbook.addWorksheet('Detail Transaksi');
            styleWorksheet(detailSheet, 'DETAIL TRANSAKSI DAN REKOMENDASI AKUN', subtitle,
                ['Tanggal', 'Departemen', 'No. Sumber', 'Nama Akun Realisasi', 'Rekomendasi Akun Budget', 'Status', 'Nama Proyek', 'Keterangan', 'Nilai Rekonsil', 'Confidence'],
                analysis.transactionRecommendations.map(row => {
                    const actualName = row._alignmentAccount || '(Nama akun kosong)';
                    return [window.SmartBaraFormatters.normalizeDate(getField(row, ['tanggal', 'date', 'tgl'])) || '', row._alignmentDepartment, getField(row, ['no sumber', 'no_sumber', 'referensi', 'no bukti']) || '', actualName, row.recommendedName || row.candidateName || '', row.status, getField(row, ['proyek_manual', '_calcProyek', 'nama proyek up', 'nama proyek', 'proyek']) || '', row._alignmentDescription, row._alignmentAmount, row.confidence || 0];
                }),
                [16, 20, 22, 36, 36, 20, 32, 68, 22, 18]);
            for (let rowIndex = 4; rowIndex <= detailSheet.rowCount; rowIndex++) {
                detailSheet.getCell(rowIndex, 9).numFmt = '#,##0;[Red]-#,##0';
                detailSheet.getCell(rowIndex, 10).numFmt = '0.0%';
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `Penyelarasan_Nama_Akun_${String(analysis.period).replace(/[^a-z0-9_-]+/gi, '_')}.xlsx`;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch(error) {
            console.error('Export account alignment error:', error);
            window.SmartBaraLayout.notify({ title: 'Export gagal', message: error.message, type: 'error' });
        } finally {
            if (button) button.disabled = false;
        }
    }

    return { init, update, render, exportExcel };
})();
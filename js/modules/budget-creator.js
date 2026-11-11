// ==============================================================================
// SMART BARA 7.10 HZ - BUDGET CREATOR PLANNING MODULE
// ==============================================================================

window.BudgetCreatorModule = (function() {
    let items = [];
    const expandedAccountGroups = new Set();
    let dimensions = [];
    let storageMode = 'table'; // 'table' or 'settings'
    let aiDraftRows = [];
    let aiChatMessages = [];
    let currentAiBudgetId = '';
    let isEditingExistingAiBatch = false;
    let manualProjectOptions = [];
    let referenceAccountOptions = [];
    let referenceProjectOptions = [];

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
            if (payload.table === 'smartbara_budget_creator_planning' || payload.table === 'smartbara_settings') {
                loadData(true);
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
            const [dimRes, itemRes] = await Promise.all([
                client.rpc('list_smartbara_planning_dimensions', { p_period: period }),
                window.SmartBaraCore.fetchPeriodRows('smartbara_budget_creator_planning', period, { orderBy: 'created_at', ascending: false })
            ]);

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

            dimensions = dimRes.data || [];
            localStorage.setItem(fallbackKey, JSON.stringify(items));
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
            const { data, error } = await client.functions.invoke(window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION, {
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
        if (!functionName || !client?.functions?.invoke) throw new Error('Server AI belum tersedia. Deploy Supabase Edge Function budget-ai terlebih dahulu.');

        const { data, error } = await client.functions.invoke(functionName, {
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

        const period = window.SmartBaraCore.getActivePeriod();
        const user = window.SmartBaraCore.getUser();
        if (!currentAiBudgetId) currentAiBudgetId = createAiBudgetId();
        updateAiBudgetIdDisplay();
        const imported = validRows.map(row => ({
            ...row,
            id: row.id || crypto.randomUUID(),
            ai_budget_id: currentAiBudgetId,
            period_name: period,
            department: row.department.trim(),
            account_name: row.account_name.trim(),
            project_name: row.project_name.trim(),
            item_name: row.item_name.trim(),
            specification: row.specification.trim(),
            catatan: String(row.catatan || '').trim(),
            quantity: Number(row.quantity) || 1,
            estimated_unit_price: Number(row.estimated_unit_price) || 0,
            needed_by: row.needed_by || null,
            created_by: row.created_by || user?.id || null,
            status: row.status || 'Draft',
            updated_at: new Date().toISOString()
        }));
        const existingIds = new Set(items.map(item => String(item.id)));
        const updatedCount = imported.filter(row => existingIds.has(String(row.id))).length;
        const addedCount = imported.length - updatedCount;
        const taskId = window.SmartBaraLayout.beginLoading('Mengimpor budget AI', `Menyimpan ${imported.length} baris ke periode ${period}...`);
        let importSucceeded = false;
        try {
            const importedIds = new Set(imported.map(row => row.id));
            const nextItems = [...imported, ...items.filter(item => !importedIds.has(item.id))];
            items = nextItems;
            localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(nextItems));
            renderTable();
            if (storageMode === 'settings') {
                await window.SmartBaraCore.syncVersionedRow('smartbara_settings', period, { key: `budget_creator_planning_${period}` }, { value: nextItems }, 'budgetCreatorFallback', 'Budget Creator AI');
            } else {
                for (const row of imported) {
                    const { id, period_name: rowPeriod, ...values } = row;
                    await window.SmartBaraCore.syncVersionedRow('smartbara_budget_creator_planning', period, { id, period_name: rowPeriod }, values, `budgetCreator:${id}`, 'Budget Creator AI');
                }
            }
            setStatus(`Budget AI ${getAiBudgetDisplayId(currentAiBudgetId)} tersimpan: ${updatedCount} diperbarui, ${addedCount} ditambahkan.`);
            closeAiDialog();
            importSucceeded = true;
        } catch(error) {
            console.error('Import AI budget error:', error);
            document.getElementById('creatorAiImportStatus').textContent = `Tersimpan di cache lokal, sinkronisasi gagal: ${error.message}`;
        } finally {
            window.SmartBaraLayout.endLoading(taskId, importSucceeded);
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
        localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(nextItems));
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
                        <button type="button" onclick="BudgetCreatorModule.openForm('${item.id}')" class="text-teal-400 hover:text-teal-300 font-bold text-xs mr-2">Edit</button>
                        ${item.status === 'Diajukan' && canApproveBudgetRequests() ? `<button type="button" onclick="BudgetCreatorModule.approveBudgetItem('${item.id}')" class="text-emerald-400 hover:text-emerald-300 font-bold text-xs mr-2">Approve</button>` : ''}
                        <button type="button" onclick="BudgetCreatorModule.deleteItem('${item.id}')" class="text-rose-400 hover:text-rose-300 font-bold text-xs">Hapus</button>
                    </td>
                </tr>
            `;
        }).join('');
        tbody.querySelectorAll('[data-creator-group-toggle]').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.groupKey;
                if (expandedAccountGroups.has(key)) expandedAccountGroups.delete(key);
                else expandedAccountGroups.add(key);
                renderTable();
            });
        });
        tbody.querySelectorAll('[data-creator-group-delete]').forEach(button => {
            button.addEventListener('click', () => deleteAccountGroup(button.dataset.groupKey));
        });
        tbody.querySelectorAll('[data-ai-budget-id]').forEach(button => {
            button.addEventListener('click', () => openAiBudget(button.dataset.aiBudgetId));
        });
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
            localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(items));
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
        localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(nextItems));
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
        localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(nextItems));
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
                localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(originalItems));
                renderTable();
                setStatus(`Penghapusan dibatalkan karena konflik cloud: ${error.message}`, true);
            }
            return;
        }

        const failedItems = [];
        for (let offset = 0; offset < groupItems.length; offset += 5) {
            const batch = groupItems.slice(offset, offset + 5);
            const results = await Promise.allSettled(batch.map(item =>
                window.SmartBaraCore.deleteVersionedRow(
                    'smartbara_budget_creator_planning',
                    period,
                    { id: item.id, period_name: item.period_name || period },
                    `budgetCreator:${item.id}`,
                    'Budget Creator'
                )
            ));
            results.forEach((result, index) => {
                if (result.status === 'rejected' && !result.reason?.queuedForSync) failedItems.push(batch[index]);
            });
        }

        if (failedItems.length) {
            const failedIds = new Set(failedItems.map(item => String(item.id)));
            items = originalItems.filter(item => getAccountGroupKey(item) !== groupKey || failedIds.has(String(item.id)));
            localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(items));
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
        localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(nextItems));
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

    // Standardized Excel Template Generator with Combobox Data Validation
    async function downloadTemplate() {
        setStatus('Menyiapkan template berstandar dengan opsi database...');
        try {
            await window.ensureLibrary('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Smart BARA';
            const period = window.SmartBaraCore.getActivePeriod();
            const lists = getDatabaseLists();

            // 1. Sheet Referensi
            const refSheet = workbook.addWorksheet('Referensi', { state: 'visible' });
            refSheet.views = [{ showGridLines: true }];
            refSheet.columns = [
                { header: 'Departemen', key: 'dept', width: 22 },
                { header: 'Nama Akun', key: 'account', width: 34 },
                { header: 'Nama Proyek UP', key: 'project', width: 34 },
                { header: 'Prioritas', key: 'priority', width: 16 },
                { header: 'Status', key: 'status', width: 16 },
                { header: 'Satuan', key: 'unit', width: 16 }
            ];
            const refHeader = refSheet.getRow(1);
            refHeader.height = 24;
            refHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            refHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            refHeader.alignment = { vertical: 'middle', horizontal: 'center' };

            const maxRefRows = Math.max(
                lists.departments.length, lists.accounts.length, lists.projects.length,
                lists.priorities.length, lists.statuses.length, lists.units.length
            );

            for (let i = 0; i < maxRefRows; i++) {
                refSheet.addRow([
                    lists.departments[i] || '', lists.accounts[i] || '', lists.projects[i] || '',
                    lists.priorities[i] || '', lists.statuses[i] || '', lists.units[i] || ''
                ]);
            }

            // 2. Sheet Template Planning
            const sheet = workbook.addWorksheet('Template Planning', {
                views: [{ state: 'frozen', ySplit: 3, showGridLines: true }]
            });

            sheet.columns = [
                { header: 'Departemen', key: 'dept', width: 20 },
                { header: 'Nama Akun', key: 'account', width: 30 },
                { header: 'Nama Proyek UP', key: 'project', width: 30 },
                { header: 'Kebutuhan / Nama Barang', key: 'item', width: 34 },
                { header: 'Spesifikasi / Alasan', key: 'specification', width: 44 },
                { header: 'Jumlah', key: 'quantity', width: 12 },
                { header: 'Satuan', key: 'unit', width: 14 },
                { header: 'Estimasi Harga Satuan (Rp)', key: 'unitPrice', width: 25 },
                { header: 'Prioritas', key: 'priority', width: 15 },
                { header: 'Tanggal Dibutuhkan', key: 'neededBy', width: 22 },
                { header: 'Status', key: 'status', width: 16 },
                { header: 'Catatan Analisa', key: 'catatan', width: 52 }
            ];

            // Banner Row 1 & 2
            sheet.mergeCells('A1:L1');
            const titleCell = sheet.getCell('A1');
            titleCell.value = 'SMART BARA - TEMPLATE PERENCANAAN BUDGET CREATOR';
            titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
            titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getRow(1).height = 28;

            sheet.mergeCells('A2:L2');
            const subCell = sheet.getCell('A2');
            subCell.value = `Periode: ${period} | Pilih opsi dari combobox/dropdown standarisasi (Departemen, Akun, Proyek UP, Satuan, Prioritas, Status). Bisa juga diketik manual jika ada nama baru.`;
            subCell.font = { italic: true, size: 9, color: { argb: 'FF334155' } };
            subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            sheet.getRow(2).height = 22;

            // Header Row 3
            const headerRow = sheet.getRow(3);
            headerRow.values = [
                'Departemen', 'Nama Akun', 'Nama Proyek UP', 'Kebutuhan / Nama Barang', 'Spesifikasi / Alasan',
                'Jumlah', 'Satuan', 'Estimasi Harga Satuan (Rp)', 'Prioritas', 'Tanggal Dibutuhkan (YYYY-MM-DD)', 'Status', 'Catatan Analisa'
            ];
            headerRow.height = 26;
            headerRow.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

            // Empty Formatted Rows up to row 100
            for (let r = 4; r <= 100; r++) {
                sheet.addRow(['', '', '', '', '', '', '', '', '', '', '', '']);
            }

            const deptCount = lists.departments.length;
            const accCount = lists.accounts.length;
            const projCount = lists.projects.length;

            for (let r = 4; r <= 100; r++) {
                const row = sheet.getRow(r);
                row.height = 22;
                row.getCell(6).numFmt = '#,##0.##';
                row.getCell(8).numFmt = '#,##0';
                row.getCell(10).numFmt = 'yyyy-mm-dd';

                // Data Validations referencing Referensi sheet
                row.getCell(1).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Referensi!$A$2:$A$${deptCount + 1}`] };
                row.getCell(2).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Referensi!$B$2:$B$${accCount + 1}`] };
                row.getCell(3).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Referensi!$C$2:$C$${projCount + 1}`] };
                row.getCell(7).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Referensi!$F$2:$F$${lists.units.length + 1}`] };
                row.getCell(9).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Referensi!$D$2:$D$${lists.priorities.length + 1}`] };
                row.getCell(11).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Referensi!$E$2:$E$${lists.statuses.length + 1}`] };
            }

            sheet.autoFilter = { from: 'A3', to: 'L100' };

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Budget_Creator_Planning_Template_${period}.xlsx`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setStatus(`Template berhasil diunduh (${lists.departments.length} Dept, ${lists.accounts.length} Akun, ${lists.projects.length} Proyek).`);
        } catch(err) {
            console.error('Download template error:', err);
            setStatus(`Download template gagal: ${err.message}`, true);
        }
    }

    async function exportExcel() {
        const rows = getFilteredItems();
        if (!rows.length) {
            setStatus('Tidak ada data Budget Creator untuk diekspor.', true);
            return;
        }

        const period = window.SmartBaraCore.getActivePeriod();
        const taskId = window.SmartBaraLayout.beginLoading('Mengekspor Budget Creator', `Menyiapkan ${rows.length} baris data...`);
        let exportSucceeded = false;
        try {
            await window.ensureLibrary('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Smart BARA';
            workbook.company = 'Smart BARA';
            workbook.subject = `Budget Creator Planning ${period}`;
            workbook.title = `Budget Creator Planning ${period}`;
            workbook.created = new Date();
            workbook.modified = new Date();

            const worksheet = workbook.addWorksheet('Budget Creator', {
                views: [{ state: 'frozen', ySplit: 5, showGridLines: false }],
                properties: { tabColor: { argb: 'FF0D9488' } }
            });
            worksheet.columns = [
                { width: 7 }, { width: 20 }, { width: 30 }, { width: 28 }, { width: 38 },
                { width: 44 }, { width: 52 }, { width: 19 }, { width: 14 }, { width: 13 },
                { width: 22 }, { width: 22 }, { width: 16 }, { width: 18 }, { width: 34 }
            ];

            worksheet.mergeCells('A1:O1');
            const title = worksheet.getCell('A1');
            title.value = 'SMART BARA | BUDGET CREATOR PLANNING';
            title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
            title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            worksheet.getRow(1).height = 32;

            worksheet.mergeCells('A2:O2');
            const subtitle = worksheet.getCell('A2');
            subtitle.value = `Periode ${period} | Diekspor ${new Date().toLocaleString('id-ID')} | ${rows.length.toLocaleString('id-ID')} baris`;
            subtitle.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
            subtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            subtitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            worksheet.getRow(2).height = 23;

            const totalAmount = rows.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_unit_price) || 0), 0);
            const highPriority = rows.filter(item => item.priority === 'Tinggi').length;
            const pending = rows.filter(item => item.status === 'Diajukan').length;
            worksheet.getRow(4).values = ['Jumlah Baris', rows.length, 'Estimasi Total', totalAmount, 'Prioritas Tinggi', highPriority, 'Menunggu Persetujuan', pending];
            worksheet.getRow(4).height = 25;
            worksheet.getRow(4).font = { bold: true, color: { argb: 'FF0F172A' } };
            worksheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            worksheet.getCell('D4').numFmt = '"Rp" #,##0;[Red]("Rp" #,##0)';
            worksheet.getCell('D4').font = { bold: true, color: { argb: 'FF0D9488' } };

            const headers = [
                'No', 'Departemen', 'Nama Akun', 'Nama Proyek UP', 'Kebutuhan / Barang',
                'Spesifikasi / Alasan', 'Catatan Analisa', 'Tanggal Dibutuhkan', 'Jumlah', 'Satuan',
                'Harga Satuan (Rp)', 'Estimasi Total (Rp)', 'Prioritas', 'Status', 'ID Budget AI'
            ];
            worksheet.getRow(5).values = headers;
            const header = worksheet.getRow(5);
            header.height = 32;
            header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
            header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
            header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

            rows.forEach((item, index) => {
                const neededBy = String(item.needed_by || '');
                const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(neededBy) ? new Date(`${neededBy}T00:00:00`) : neededBy || '';
                const quantity = Number(item.quantity) || 0;
                const unitPrice = Number(item.estimated_unit_price) || 0;
                const outputRow = worksheet.addRow([
                    index + 1,
                    item.department || '',
                    item.account_name || '',
                    item.project_name || '',
                    item.item_name || '',
                    item.specification || '',
                    item.catatan || '',
                    parsedDate,
                    quantity,
                    item.unit || '',
                    unitPrice,
                    quantity * unitPrice,
                    item.priority || 'Normal',
                    item.status || 'Draft',
                    item.ai_budget_id || ''
                ]);
                outputRow.height = 22;
                outputRow.alignment = { vertical: 'top', wrapText: true };
                outputRow.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
                outputRow.getCell(8).numFmt = 'dd mmm yyyy';
                outputRow.getCell(9).numFmt = '#,##0.##';
                [11, 12].forEach(column => { outputRow.getCell(column).numFmt = '"Rp" #,##0;[Red]("Rp" #,##0)'; });
                if (index % 2 === 1) outputRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            });

            const lastDataRow = worksheet.rowCount;
            worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
            const footer = worksheet.addRow(['TOTAL', '', '', '', '', '', '', '', '', '', '', totalAmount, '', '', '']);
            footer.height = 25;
            footer.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            footer.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            footer.getCell(12).numFmt = '"Rp" #,##0;[Red]("Rp" #,##0)';
            footer.getCell(12).alignment = { horizontal: 'right' };
            worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5' };
            worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: lastDataRow, column: headers.length } };

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Budget_Creator_Planning_${String(period).replace(/[^a-z0-9_-]+/gi, '_')}.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setStatus(`Export Excel berhasil: ${rows.length.toLocaleString('id-ID')} baris.`);
            exportSucceeded = true;
        } catch(error) {
            console.error('Export Budget Creator error:', error);
            setStatus(`Export Excel gagal: ${error.message}`, true);
        } finally {
            window.SmartBaraLayout.endLoading(taskId, exportSucceeded);
        }
    }

    // Robust Excel Importer
    async function importExcel(event) {
        if (!window.SmartBaraCore.canWriteData()) {
            setStatus('Level akses Viewer hanya dapat membaca kebutuhan.', true);
            if (event?.target) event.target.value = '';
            return;
        }
        const file = event?.target?.files?.[0];
        if (!file) return;
        try { await window.ensureLibrary('xlsx'); }
        catch(e) {
            setStatus('Library Excel gagal dimuat. Periksa internet.', true);
            if (event?.target) event.target.value = '';
            return;
        }

        setStatus('Membaca file Excel...');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
                
                // Select proper sheet
                let targetSheet = workbook.SheetNames[0];
                for (const name of workbook.SheetNames) {
                    const l = name.toLowerCase();
                    if (l.includes('template') || l.includes('plan') || l.includes('budget') || l.includes('kebutuhan')) {
                        targetSheet = name;
                        break;
                    }
                }
                if (targetSheet.toLowerCase().includes('referensi') && workbook.SheetNames.length > 1) {
                    targetSheet = workbook.SheetNames.find(n => !n.toLowerCase().includes('referensi')) || workbook.SheetNames[0];
                }

                const sheet = workbook.Sheets[targetSheet];
                const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                if (json.length < 2) {
                    setStatus('File Excel kosong atau tidak valid.', true);
                    return;
                }

                // Dynamic Header Row Detection
                let headerIdx = -1;
                for (let r = 0; r < Math.min(15, json.length); r++) {
                    const cells = (json[r] || []).map(c => String(c || '').toLowerCase());
                    const hasItem = cells.some(c => c.includes('kebutuhan') || c.includes('barang') || c.includes('item'));
                    const hasContext = cells.some(c => c.includes('departemen') || c.includes('dept') || c.includes('akun') || c.includes('account') || c.includes('proyek') || c.includes('project'));
                    if (hasItem && hasContext) {
                        headerIdx = r;
                        break;
                    }
                }
                if (headerIdx === -1) headerIdx = 0;

                const header = (json[headerIdx] || []).map(v => String(v || '').trim().toLowerCase());
                const indexByName = names => {
                    for (const name of names) {
                        const found = header.findIndex(c => c === name || c.includes(name));
                        if (found >= 0) return found;
                    }
                    return -1;
                };

                const col = {
                    department: indexByName(['departemen', 'department', 'dept']),
                    account: indexByName(['nama akun', 'kode akun', 'akun', 'account']),
                    project: indexByName(['nama proyek up', 'nama proyek', 'proyek up', 'proyek', 'project']),
                    item: indexByName(['kebutuhan / nama barang', 'kebutuhan', 'nama barang', 'barang', 'item']),
                    specification: indexByName(['spesifikasi / alasan', 'spesifikasi', 'alasan', 'keterangan']),
                    catatan: indexByName(['catatan analisa', 'catatan']),
                    aiBudgetId: indexByName(['id budget ai', 'ai budget id']),
                    quantity: indexByName(['jumlah (qty)', 'jumlah', 'quantity', 'qty']),
                    unit: indexByName(['satuan', 'unit']),
                    unitPrice: indexByName(['estimasi harga satuan (rp)', 'estimasi harga satuan', 'harga satuan', 'unit price']),
                    priority: indexByName(['prioritas', 'priority']),
                    neededBy: indexByName(['tanggal dibutuhkan', 'tgl dibutuhkan', 'dibutuhkan', 'needed by']),
                    status: indexByName(['status'])
                };
                if (col.item < 0) {
                    throw new Error('Kolom "Kebutuhan / Nama Barang" tidak ditemukan. Gunakan sheet Template Planning dari template Budget Creator.');
                }

                const getCell = (row, idx) => idx >= 0 ? row[idx] : undefined;
                const period = window.SmartBaraCore.getActivePeriod();
                const imported = [];

                for (let i = headerIdx + 1; i < json.length; i++) {
                    const row = json[i];
                    if (!Array.isArray(row) || row.every(c => String(c ?? '').trim() === '')) continue;
                    const firstCell = String(row[0] ?? '').trim();
                    if (firstCell.toLowerCase().includes('total') || firstCell.toLowerCase().includes('petunjuk')) continue;

                    let department = String(getCell(row, col.department) ?? getCell(row, 0) ?? '').trim();
                    const itemName = String(getCell(row, col.item) ?? '').trim();

                    if (!itemName) continue;
                    if (!department) department = 'HR';

                    imported.push({
                        id: crypto.randomUUID(),
                        period_name: period,
                        department,
                        account_name: String(getCell(row, col.account) ?? '').trim(),
                        project_name: String(getCell(row, col.project) ?? '').trim(),
                        item_name: itemName,
                        specification: String(getCell(row, col.specification) ?? '').trim(),
                        catatan: String(getCell(row, col.catatan) ?? '').trim(),
                        ai_budget_id: String(getCell(row, col.aiBudgetId) ?? '').trim() || null,
                        quantity: window.Formatters.parseNumber(getCell(row, col.quantity), 1),
                        unit: String(getCell(row, col.unit) ?? 'unit').trim() || 'unit',
                        estimated_unit_price: window.Formatters.parseNumber(getCell(row, col.unitPrice), 0),
                        priority: ['Tinggi', 'Normal', 'Rendah'].find(p => p.toLowerCase() === String(getCell(row, col.priority) ?? '').trim().toLowerCase()) || 'Normal',
                        needed_by: window.Formatters.normalizeDate(getCell(row, col.neededBy)),
                        status: ['Draft', 'Diajukan', 'Disetujui', 'Ditolak'].find(s => s.toLowerCase() === String(getCell(row, col.status) ?? '').trim().toLowerCase()) || 'Draft',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }

                if (!imported.length) {
                    setStatus('Tidak ada data kebutuhan valid untuk diimport.', true);
                    return;
                }

                // Immediately update memory and localStorage
                const nextItems = [...imported, ...items];
                items = nextItems;
                localStorage.setItem(`budget_creator_planning_${period}`, JSON.stringify(nextItems));
                renderTable();

                // Concurrency-safe cloud sync if admin
                let cloudMsg = '';
                if (window.SmartBaraCore.canWriteCloud()) {
                    try {
                        if (storageMode === 'settings') {
                            await window.SmartBaraCore.syncVersionedRow('smartbara_settings', period, { key: `budget_creator_planning_${period}` }, { value: nextItems }, 'budgetCreatorFallback', 'planning settings');
                        } else {
                            for (const item of imported) {
                                const { id, period_name: p, ...values } = item;
                                await window.SmartBaraCore.syncVersionedRow('smartbara_budget_creator_planning', period, { id, period_name: period }, values, `budgetCreator:${id}`, 'Budget Creator');
                            }
                        }
                        cloudMsg = ' (tersimpan ke cloud)';
                    } catch(err) {
                        cloudMsg = ' (tersimpan lokal)';
                    }
                }

                setStatus(`Berhasil import ${imported.length} kebutuhan${cloudMsg}.`);
            } catch(err) {
                console.error('Import error:', err);
                setStatus(`Import gagal: ${err.message}`, true);
            } finally {
                if (event?.target) event.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
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
        importExcel
    };
})();

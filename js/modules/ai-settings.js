window.AISettingsModule = (function() {
    const STORAGE_KEY = 'smartbara_budget_ai_settings_v1';
    const DEFAULT_MODELS = {
        claude: 'claude-sonnet-4-5',
        gemini: 'gemini-3.8-flash',
        openrouter: 'nvidia/nemotron-3.5-super-vl:free',
        groq: 'openai/gpt-oss-120b',
        cloudflare: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        cohere: 'command-a-plus-05-2026',
        cerebras: 'gpt-oss-120b',
        sambanova: 'Meta-Llama-3.3-70B-Instruct',
        fireworks: 'accounts/fireworks/models/glm-5p3-flash',
        zai: 'glm-5.3',
        minimax: 'MiniMax-M3.1-Flash'
    };
    let keyRecords = [];
    let isSaving = false;

    function renderApprovalAudit() {
        const container = document.getElementById('approvalAuditSettingsPanel');
        if (!container) return;

        const allHistory = Array.isArray(window.SmartBaraCore?.getApprovalHistory?.(100)) ? window.SmartBaraCore.getApprovalHistory(100) : [];
        const history = allHistory.filter(entry => {
            const status = String(entry.status || 'pending').toLowerCase();
            return status === 'approved' || status === 'rejected' || status === 'pending';
        });

        const currentPeriod = window.SmartBaraCore.getActivePeriod();
        const periodHistory = currentPeriod
            ? history.filter(entry => !entry.period_name || entry.period_name === currentPeriod)
            : history;

        const summary = {
            all: history.length,
            pending: history.filter(entry => String(entry.status || 'pending').toLowerCase() === 'pending').length,
            approved: history.filter(entry => String(entry.status || 'pending').toLowerCase() === 'approved').length,
            rejected: history.filter(entry => String(entry.status || 'pending').toLowerCase() === 'rejected').length
        };

        const rows = periodHistory.length
            ? periodHistory.slice(0, 6).map(entry => {
                const status = String(entry.status || 'pending').toLowerCase();
                const statusLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending';
                const statusBadge = status === 'approved' ? 'badge-emerald' : status === 'rejected' ? 'badge-rose' : 'badge-amber';
                const dept = Array.isArray(entry.departments) ? entry.departments.join(', ') : (entry.departments || 'ALL');
                return `
                    <tr class="border-t border-white/10">
                        <td class="px-3 py-2 text-white font-semibold">${window.Formatters.escapeHtml(entry.period_name || '-')}</td>
                        <td class="px-3 py-2"><span class="badge ${statusBadge} text-[10px]">${window.Formatters.escapeHtml(statusLabel)}</span></td>
                        <td class="px-3 py-2 text-slate-200">${window.Formatters.escapeHtml(entry.approved_by || entry.approver || 'Superadmin')}</td>
                        <td class="px-3 py-2 text-slate-300">${window.Formatters.escapeHtml(entry.approved_at ? new Date(entry.approved_at).toLocaleString('id-ID') : '-')}</td>
                        <td class="px-3 py-2 text-slate-300">${window.Formatters.escapeHtml(dept)}</td>
                    </tr>
                `;
            }).join('')
            : `
                <tr>
                    <td colspan="5" class="px-3 py-8 text-center text-slate-400">
                        <div class="flex flex-col items-center justify-center gap-3">
                            <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-xl text-violet-300">📌</div>
                            <div>
                                <div class="text-sm font-semibold text-slate-200">Belum ada riwayat approval</div>
                                <div class="mt-1 text-[11px] text-slate-400">Setelah ada keputusan approve/reject, riwayat akan tampil di sini.</div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;

        container.innerHTML = `
            <div class="grid grid-cols-2 gap-2 md:grid-cols-4 mb-3">
                <div class="audit-stat p-2 text-center">
                    <div class="text-[9px] uppercase tracking-wide text-slate-400">Semua</div>
                    <div class="mt-1 text-base font-black text-white">${summary.all}</div>
                </div>
                <div class="audit-stat border-amber-500/30 bg-amber-500/10 p-2 text-center">
                    <div class="text-[9px] uppercase tracking-wide text-amber-200">Pending</div>
                    <div class="mt-1 text-base font-black text-white">${summary.pending}</div>
                </div>
                <div class="audit-stat border-emerald-500/30 bg-emerald-500/10 p-2 text-center">
                    <div class="text-[9px] uppercase tracking-wide text-emerald-200">Approved</div>
                    <div class="mt-1 text-base font-black text-white">${summary.approved}</div>
                </div>
                <div class="audit-stat border-rose-500/30 bg-rose-500/10 p-2 text-center">
                    <div class="text-[9px] uppercase tracking-wide text-rose-200">Rejected</div>
                    <div class="mt-1 text-base font-black text-white">${summary.rejected}</div>
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
                            <th class="px-3 py-2 font-bold uppercase tracking-wider">Departemen</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    async function init() {
        const canManage = window.SmartBaraCore.canManageSettings();
        const provider = document.getElementById('aiProvider');
        const model = document.getElementById('aiModel');
        const legacySettings = readLegacySettings();
        provider.value = legacySettings?.provider || 'claude';
        model.value = legacySettings?.model || DEFAULT_MODELS[provider.value];
        updateProviderFields();
        if (legacySettings?.apiKey) {
            document.getElementById('aiKeyLabel').value = 'Key lama dari browser';
            document.getElementById('aiApiKey').value = legacySettings.apiKey;
        }
        renderApprovalAudit();
        window.addEventListener('smartbara:period_change', renderApprovalAudit);
        window.addEventListener('smartbara:dept_filter_change', renderApprovalAudit);
        window.addEventListener('smartbara:store_loaded', renderApprovalAudit);

        [document.getElementById('aiKeyLabel'), provider, model, document.getElementById('aiApiKey'),
            document.getElementById('aiToggleKey'), document.getElementById('aiSaveKey'), document.getElementById('aiReloadKeys'), document.getElementById('aiLoadModels')]
            .filter(Boolean).forEach(control => { control.disabled = !canManage; });
        if (!canManage) {
            setStatus('Hanya Superadmin yang dapat mengelola API key AI.', true);
            return;
        }

        provider.addEventListener('change', () => {
            if (!model.value.trim() || Object.values(DEFAULT_MODELS).includes(model.value.trim())) {
                model.value = DEFAULT_MODELS[provider.value] || '';
            }
            document.getElementById('aiModelOptions').replaceChildren();
            document.getElementById('aiModelStatus').textContent = '';
            updateProviderFields();
            if (document.getElementById('aiApiKey').value.trim()) loadAvailableModels();
        });
        document.getElementById('aiSettingsForm').addEventListener('submit', saveKey);
        document.getElementById('aiToggleKey').addEventListener('click', toggleKeyVisibility);
        document.getElementById('aiLoadModels').addEventListener('click', () => loadAvailableModels());
        document.getElementById('aiApiKey').addEventListener('change', () => {
            if (document.getElementById('aiApiKey').value.trim()) loadAvailableModels();
        });
        document.getElementById('aiReloadKeys').addEventListener('click', loadKeys);
        document.getElementById('aiKeyList').addEventListener('click', handleKeyAction);
        const loaded = await loadKeys();
        if (legacySettings?.apiKey) {
            await loadAvailableModels();
            if (loaded) setStatus('Key lama masih tersimpan di browser. Simpan untuk memindahkannya ke database.');
        }
    }

    function readLegacySettings() {
        try {
            const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (!settings?.apiKey) return null;
            return {
                provider: ['claude', 'gemini', 'openrouter'].includes(settings.provider) ? settings.provider : 'claude',
                model: String(settings.model || DEFAULT_MODELS[settings.provider] || DEFAULT_MODELS.claude),
                apiKey: String(settings.apiKey)
            };
        } catch(e) {
            return null;
        }
    }

    async function invokeAction(payload) {
        const client = window.SmartBaraCore.getClient();
        if (!client?.functions?.invoke) throw new Error('Koneksi Supabase belum tersedia.');
        const { data, error } = await client.functions.invoke(window.SMART_BARA_CONFIG.BUDGET_AI_FUNCTION, { body: payload });
        if (error) throw new Error(await getErrorMessage(error));
        if (data?.error) throw new Error(data.error);
        if (data?.success === false) throw new Error(data.message || 'Permintaan ditolak oleh server.');
        return data;
    }

    async function getErrorMessage(error) {
        let message = error?.message || 'Permintaan ke server gagal.';
        try {
            const response = error.context;
            const details = response instanceof Response ? await response.clone().json() : null;
            message = details?.error || details?.message || message;
        } catch(e) {}
        return message;
    }

    async function loadAvailableModels() {
        const provider = document.getElementById('aiProvider').value;
        const apiKey = document.getElementById('aiApiKey').value.trim();
        const accountId = document.getElementById('aiCloudflareAccountId').value.trim();
        const model = document.getElementById('aiModel');
        const options = document.getElementById('aiModelOptions');
        const status = document.getElementById('aiModelStatus');
        const button = document.getElementById('aiLoadModels');
        if (!apiKey) {
            status.textContent = 'Isi API key terlebih dahulu untuk memuat model yang tersedia.';
            return;
        }

        button.disabled = true;
        status.textContent = 'Memuat katalog model dari provider...';
        try {
            const data = await invokeAction({ action: 'settings-models', provider, apiKey, accountId, currentModel: model.value.trim() });
            const models = Array.isArray(data.models) ? data.models : [];
            options.replaceChildren(...models.map(name => {
                const option = document.createElement('option');
                option.value = name;
                return option;
            }));
            if (data.recommendedModel) model.value = data.recommendedModel;
            status.textContent = models.length
                ? `${models.length} model tersedia; daftar baru saja diperbarui.`
                : 'Provider tidak mengembalikan katalog; model dapat diisi manual.';
            if (!models.length) status.className = 'mt-1 block min-h-4 text-[10px] font-normal text-amber-300';
            else status.className = 'mt-1 block min-h-4 text-[10px] font-normal text-slate-500';
        } catch(error) {
            options.replaceChildren();
            status.textContent = `Katalog model gagal dimuat: ${error.message}`;
            status.className = 'mt-1 block min-h-4 text-[10px] font-normal text-rose-300';
        } finally {
            button.disabled = false;
        }
    }

    async function loadKeys() {
        const list = document.getElementById('aiKeyList');
        if (list) list.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500">Memuat daftar key...</td></tr>';
        try {
            const data = await invokeAction({ action: 'settings-list' });
            keyRecords = Array.isArray(data.keys) ? data.keys : [];
            renderKeys();
            renderSettingsSummary();
            if (!keyRecords.length) setStatus('Belum ada API key aktif. Tambahkan key untuk mulai memakai AI.');
            return true;
        } catch(error) {
            keyRecords = [];
            renderSettingsSummary();
            if (list) list.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-rose-400">${window.Formatters.escapeHtml(error.message)}</td></tr>`;
            setStatus(`Gagal memuat API key: ${error.message}`, true);
            return false;
        }
    }

    function renderSettingsSummary() {
        const providerSummary = document.getElementById('settingsProviderSummary');
        const keyCountSummary = document.getElementById('settingsKeyCountSummary');
        const periodSummary = document.getElementById('settingsPeriodSummary');

        const activeKey = keyRecords.find(key => key.enabled) || keyRecords[0];
        const activeProvider = activeKey?.provider || document.getElementById('aiProvider')?.value || 'Claude';
        const activePeriod = window.SmartBaraCore?.getActivePeriod?.() || '-';

        if (providerSummary) providerSummary.textContent = String(activeProvider).toUpperCase();
        if (keyCountSummary) keyCountSummary.textContent = String(keyRecords.length);
        if (periodSummary) periodSummary.textContent = activePeriod;
    }

    function renderKeys() {
        const list = document.getElementById('aiKeyList');
        if (!list) return;
        if (!keyRecords.length) {
            list.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500">Belum ada key tersimpan.</td></tr>';
            renderSettingsSummary();
            return;
        }
        list.innerHTML = keyRecords.map((key, index) => `
            <tr class="border-b border-white/5 hover:bg-white/[0.03]">
                <td class="py-3 px-4 font-mono text-xs text-slate-300">${index + 1}</td>
                <td class="py-3 px-4">
                    <div class="font-semibold text-white">${escapeHtml(key.label)}</div>
                    <div class="mt-0.5 text-xs uppercase text-teal-300">${escapeHtml(key.provider)}</div>
                </td>
                <td class="py-3 px-4">
                    <div class="text-xs text-slate-200">${escapeHtml(key.model)}</div>
                    <div class="mt-0.5 font-mono text-[11px] text-slate-500">••••${escapeHtml(key.keySuffix || '')}</div>
                </td>
                <td class="py-3 px-4"><span class="badge ${key.enabled ? 'badge-teal' : 'text-slate-400 border-white/10 bg-white/5'}">${key.enabled ? 'Aktif' : 'Nonaktif'}</span></td>
                <td class="py-3 px-4 text-right">
                    <div class="flex flex-wrap justify-end gap-1.5">
                        <button type="button" class="btn btn-secondary px-2 py-1 text-[11px]" data-action="test" data-key-id="${escapeHtml(key.id)}">Uji</button>
                        <button type="button" class="btn btn-secondary px-2 py-1 text-[11px]" data-action="refresh-models" data-key-id="${escapeHtml(key.id)}" title="Perbarui katalog dan sesuaikan model key ini">Perbarui Model</button>
                        <button type="button" class="btn btn-secondary px-2 py-1 text-[11px]" data-action="move-up" data-key-id="${escapeHtml(key.id)}" aria-label="Naikkan prioritas">Naik</button>
                        <button type="button" class="btn btn-secondary px-2 py-1 text-[11px]" data-action="move-down" data-key-id="${escapeHtml(key.id)}" aria-label="Turunkan prioritas">Turun</button>
                        <button type="button" class="btn btn-secondary px-2 py-1 text-[11px]" data-action="toggle" data-key-id="${escapeHtml(key.id)}">${key.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button>
                        <button type="button" class="btn px-2 py-1 text-[11px] text-rose-300" data-action="delete" data-key-id="${escapeHtml(key.id)}">Hapus</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async function saveKey(event) {
        event?.preventDefault();
        if (isSaving) return;
        const key = {
            label: document.getElementById('aiKeyLabel').value.trim(),
            provider: document.getElementById('aiProvider').value,
            model: document.getElementById('aiModel').value.trim(),
            apiKey: document.getElementById('aiApiKey').value.trim(),
            accountId: document.getElementById('aiCloudflareAccountId').value.trim()
        };
        if (!key.label || !key.model || !key.apiKey) {
            setStatus('Nama, model, dan API key wajib diisi.', true);
            return;
        }

        const button = document.getElementById('aiSaveKey');
        isSaving = true;
        button.disabled = true;
        button.textContent = 'Menyimpan...';
        try {
            await invokeAction({ action: 'settings-save', ...key });
            localStorage.removeItem(STORAGE_KEY);
            document.getElementById('aiApiKey').value = '';
            document.getElementById('aiKeyLabel').value = '';
            setStatus('API key tersimpan di database. Browser hanya menyimpan label dan status key.');
            await loadKeys();
        } catch(error) {
            setStatus(`Gagal menyimpan key: ${error.message}`, true);
        } finally {
            isSaving = false;
            button.disabled = false;
            button.textContent = 'Tambah Key';
        }
    }

    async function handleKeyAction(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const key = keyRecords.find(record => record.id === button.dataset.keyId);
        if (!key) return;
        const action = button.dataset.action;
        if (action === 'delete') {
            const confirmed = await window.SmartBaraLayout.confirmDialog({
                title: 'Konfirmasi penghapusan key',
                message: `Hapus API key "${key.label}" dari database?`,
                confirmText: 'Hapus',
                cancelText: 'Batal',
                danger: true
            });
            if (!confirmed) return;
        }

        button.disabled = true;
        try {
            if (action === 'refresh-models') {
                const result = await invokeAction({ action: 'settings-refresh-models', keyId: key.id });
                setStatus(result.updated
                    ? `Model ${key.label} disesuaikan ke ${result.model}.`
                    : `Model ${key.label} masih tersedia: ${result.model}.`);
                await loadKeys();
                return;
            }
            if (action === 'test') {
                setStatus(`Menguji ${key.label}...`);
                const result = await invokeAction({ action: 'test', keyId: key.id });
                setStatus(result.modelUpdated
                    ? `Koneksi ${key.label} berhasil; model otomatis diperbarui ke ${result.model}.`
                    : `Koneksi ${key.label} berhasil.`);
                if (result.modelUpdated) await loadKeys();
                return;
            }
            if (action === 'toggle') {
                await invokeAction({ action: 'settings-toggle', keyId: key.id, enabled: !key.enabled });
            } else if (action === 'move-up' || action === 'move-down') {
                await invokeAction({ action: 'settings-move', keyId: key.id, direction: action === 'move-up' ? 'up' : 'down' });
            } else if (action === 'delete') {
                await invokeAction({ action: 'settings-delete', keyId: key.id });
            }
            setStatus('Daftar API key diperbarui.');
            await loadKeys();
        } catch(error) {
            setStatus(`Aksi key gagal: ${error.message}`, true);
        } finally {
            if (button.isConnected) button.disabled = false;
        }
    }

    function toggleKeyVisibility() {
        if (!window.SmartBaraCore.canManageSettings()) return;
        const input = document.getElementById('aiApiKey');
        const button = document.getElementById('aiToggleKey');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? 'Sembunyikan' : 'Tampilkan';
        button.setAttribute('aria-label', show ? 'Sembunyikan API key' : 'Tampilkan API key');
        button.title = show ? 'Sembunyikan API key' : 'Tampilkan API key';
    }

    function updateProviderFields() {
        const accountField = document.getElementById('aiCloudflareAccountField');
        const accountInput = document.getElementById('aiCloudflareAccountId');
        const needsAccountId = document.getElementById('aiProvider').value === 'cloudflare';
        accountField.classList.toggle('hidden', !needsAccountId);
        accountInput.required = needsAccountId;
        if (!needsAccountId) accountInput.value = '';
    }

    function escapeHtml(value) {
        return window.SmartBaraFormatters.escapeHtml(String(value ?? ''));
    }

    function setStatus(message, isError = false) {
        const status = document.getElementById('aiSettingsStatus');
        status.textContent = message;
        status.className = `text-xs ${isError ? 'text-rose-400' : 'text-slate-400'}`;
    }

    return { init, getErrorMessage };
})();

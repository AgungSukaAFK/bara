// ==============================================================================
// SMART BARA 7.10 HZ - SHARED NAVIGATION, SIDEBAR & APP LAYOUT INJECTOR
// Includes: Upload Modal, Multi-Department Filter, Dynamic Period Manager
// ==============================================================================

window.SmartBaraLayout = (function() {
    let sidebarVisible = false;
    let loadingSequence = 0;
    const loadingTasks = new Map();
    let loadingShowTimer = null;
    let loadingProgressTimer = null;
    const MENU_ITEMS = [
        { id: 'dashboard', label: 'Dashboard Utama', href: 'index.html', icon: '📊' },
        { id: 'rekonsil', label: 'Rekonsil Anggaran', href: 'rekonsil.html', icon: '⚖️' },
        { id: 'pov-akun', label: 'POV Akun Induk', href: 'pov-akun.html', icon: '📑' },
        { id: 'pov-proyek', label: 'POV Proyek UP', href: 'pov-proyek.html', icon: '🏗️' },
        { id: 'matriks-dept', label: 'Matriks POV Dept', href: 'matriks-dept.html', icon: '🏢' },
        { id: 'budget-plan', label: 'Budget Plan Akun', href: 'budget-plan.html', icon: '💰' },
        { id: 'account-alignment', label: 'Penyelarasan Nama Akun', href: 'account-alignment.html', icon: '🔎' },
        { id: 'budget-analysis', label: 'Analisa Kenaikan Budget', href: 'budget-analysis.html', icon: '📈' },
        { id: 'budget-creator', label: 'Budget Creator Planning', href: 'budget-creator.html', icon: '🛒', highlight: true },
        { id: 'budget-future', label: 'Anggaran Masa Depan', href: 'budget-future.html', icon: '📈' },
        { id: 'asset', label: 'Asset Monitoring', href: 'smart-asset-project/index.html', icon: '💎' },
        { id: 'monthly', label: 'Monthly Report', href: 'monthly.html', icon: '📅' },
        { id: 'user-guide', label: 'User Guide', href: 'user-guide.html', icon: '📘' },
        { id: 'users', label: 'Pengguna & Akses', href: 'users.html', icon: '👥', superadminOnly: true },
        { id: 'ai-settings', label: 'Pengaturan AI Budget', href: 'ai-settings.html', icon: '⚙️', superadminOnly: true }
    ];

    async function initLayout(activePageId, options = {}) {
        const transitionPeriod = sessionStorage.getItem('smartbara_period_transition');
        const layoutTask = beginLoading(
            transitionPeriod ? 'Menyiapkan periode' : 'Menyiapkan tampilan',
            transitionPeriod ? `Memuat data periode ${transitionPeriod}...` : 'Menyiapkan menu dan data aplikasi...'
        );
        let layoutSucceeded = false;
        try {
            if (!options.skipPeriodStore && window.SmartBaraCore && typeof window.SmartBaraCore.loadPeriodStore === 'function') {
                try {
                    window.SmartBaraCore.loadPeriodStore(window.SmartBaraCore.getActivePeriod(), false, { showOverlay: false })
                        .catch(e => console.warn('Layout background store load warning:', e));
                } catch (e) {
                    console.warn('Layout loadPeriodStore warning:', e);
                }
            }

            renderSidebar(activePageId);
            renderCollapsedSidebarToggle();
            await renderHeader(activePageId);
            renderAuthModal();
            renderUploadModal();
            renderPeriodModal();
            renderDeptFilterModal();
            bindEvents();
            updateDeptFilterLabel();
            updateLoading(layoutTask, '', '', 92);
            layoutSucceeded = true;
        } finally {
            endLoading(layoutTask, layoutSucceeded);
            if (transitionPeriod) sessionStorage.removeItem('smartbara_period_transition');
        }
    }

    function ensureLoadingOverlay() {
        let overlay = document.getElementById('appLoadingOverlay');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'appLoadingOverlay';
        overlay.className = 'app-loading-overlay';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="app-loading-panel">
                <div class="app-loading-heading">
                    <div class="app-loading-orbit" aria-hidden="true">HZ</div>
                    <div><p id="appLoadingTitle" class="app-loading-title">Memproses...</p><p class="app-loading-brand">Smart BARA · 7.10 HZ</p></div>
                </div>
                <p id="appLoadingDetail" class="app-loading-detail">Menyiapkan data...</p>
                <div class="app-loading-progress"><span id="appLoadingPercent" class="app-loading-percent">6%</span><span id="appLoadingStatus" class="app-loading-status">MEMUAT</span></div>
                <div id="appLoadingTrack" class="app-loading-track" role="progressbar" aria-label="Progres pemuatan" aria-valuemin="0" aria-valuemax="100" aria-valuenow="6"><span id="appLoadingBar"></span></div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function ensureToastHost() {
        let host = document.getElementById('smartbaraToastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'smartbaraToastHost';
            host.className = 'smartbara-toast-host';
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        return host;
    }

    function notify({ title = 'Informasi', message = '', type = 'info', duration = 3200 } = {}) {
        const host = ensureToastHost();
        const icons = { success: '✓', info: 'i', warning: '!', error: '×' };
        const toast = document.createElement('div');
        const escape = value => window.SmartBaraFormatters.escapeHtml(value);
        toast.className = `smartbara-toast smartbara-toast-${type}`;
        toast.innerHTML = `
            <div class="smartbara-toast-icon">${icons[type] || icons.info}</div>
            <div class="smartbara-toast-content"><div class="smartbara-toast-title">${escape(title)}</div><div class="smartbara-toast-message">${escape(message)}</div></div>
            <button type="button" class="smartbara-toast-close" aria-label="Tutup">×</button>
        `;
        const close = () => {
            toast.classList.add('smartbara-toast-hide');
            setTimeout(() => toast.remove(), 220);
        };
        toast.querySelector('.smartbara-toast-close').addEventListener('click', close);
        host.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(close, duration);
    }

    function openThemeDialog({ title = 'Konfirmasi', message = '', confirmText = 'OK', cancelText = 'Batal', type = 'info', danger = false } = {}) {
        return new Promise(resolve => {
            const existing = document.getElementById('smartbaraThemeDialog');
            if (existing) existing.remove();
            const periodManager = document.getElementById('periodManagerModal');
            if (periodManager && !periodManager.classList.contains('hidden')) {
                periodManager.classList.add('opacity-0');
                periodManager.classList.add('hidden');
            }
            const overlay = document.createElement('div');
            overlay.id = 'smartbaraThemeDialog';
            overlay.className = 'smartbara-dialog-backdrop';
            const icons = { success: '✓', info: 'i', warning: '!', error: '×' };
            const icon = icons[type] || icons.info;
            overlay.innerHTML = `
                <div class="smartbara-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="smartbaraDialogTitle">
                    <div class="smartbara-dialog-header">
                        <div class="smartbara-dialog-icon smartbara-dialog-icon-${type} ${danger ? 'danger' : ''}">${icon}</div>
                        <div class="smartbara-dialog-title-wrap">
                            <div id="smartbaraDialogTitle" class="smartbara-dialog-title">${window.SmartBaraFormatters.escapeHtml(title)}</div>
                        </div>
                        <button type="button" class="smartbara-dialog-close" aria-label="Tutup dialog">×</button>
                    </div>
                    <div class="smartbara-dialog-body">${window.SmartBaraFormatters.escapeHtml(message)}</div>
                    <div class="smartbara-dialog-actions">
                        ${cancelText ? `<button type="button" class="btn btn-secondary smartbara-dialog-cancel">${window.SmartBaraFormatters.escapeHtml(cancelText)}</button>` : ''}
                        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} smartbara-dialog-confirm">${window.SmartBaraFormatters.escapeHtml(confirmText)}</button>
                    </div>
                </div>
            `;
            const close = (result) => {
                overlay.remove();
                resolve(result);
            };
            overlay.querySelector('.smartbara-dialog-close')?.addEventListener('click', () => close(false));
            overlay.querySelector('.smartbara-dialog-cancel')?.addEventListener('click', () => close(false));
            overlay.querySelector('.smartbara-dialog-confirm')?.addEventListener('click', () => close(true));
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close(false);
            });
            document.body.appendChild(overlay);
            const confirmButton = overlay.querySelector('.smartbara-dialog-confirm');
            confirmButton?.focus();
        });
    }

    function alertDialog({ title = 'Informasi', message = '', confirmText = 'OK' } = {}) {
        return openThemeDialog({ title, message, confirmText, cancelText: '', type: 'info' });
    }

    function confirmDialog({ title = 'Konfirmasi', message = '', confirmText = 'OK', cancelText = 'Batal', danger = false } = {}) {
        return openThemeDialog({ title, message, confirmText, cancelText, type: danger ? 'error' : 'warning', danger });
    }

    function openThemePrompt({ title = 'Masukkan data', message = '', defaultValue = '', placeholder = '', confirmText = 'OK', cancelText = 'Batal', pattern = null } = {}) {
        return new Promise(resolve => {
            const existing = document.getElementById('smartbaraThemePrompt');
            if (existing) existing.remove();
            const periodManager = document.getElementById('periodManagerModal');
            if (periodManager && !periodManager.classList.contains('hidden')) {
                periodManager.classList.add('opacity-0');
                periodManager.classList.add('hidden');
            }
            const overlay = document.createElement('div');
            overlay.id = 'smartbaraThemePrompt';
            overlay.className = 'smartbara-dialog-backdrop';
            overlay.innerHTML = `
                <div class="smartbara-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="smartbaraPromptTitle" onclick="event.stopPropagation()">
                    <div class="smartbara-dialog-header">
                        <div class="smartbara-dialog-icon smartbara-dialog-icon-info">i</div>
                        <div class="smartbara-dialog-title-wrap">
                            <div id="smartbaraPromptTitle" class="smartbara-dialog-title">${window.SmartBaraFormatters.escapeHtml(title)}</div>
                        </div>
                        <button type="button" class="smartbara-dialog-close" aria-label="Tutup dialog">×</button>
                    </div>
                    <div class="smartbara-dialog-body">
                        <div class="mb-3 text-sm text-slate-300">${window.SmartBaraFormatters.escapeHtml(message)}</div>
                        <input type="text" class="form-input w-full" id="smartbaraPromptInput" value="${window.SmartBaraFormatters.escapeHtml(defaultValue)}" placeholder="${window.SmartBaraFormatters.escapeHtml(placeholder)}" ${pattern ? `pattern="${window.SmartBaraFormatters.escapeHtml(pattern)}"` : ''}>
                    </div>
                    <div class="smartbara-dialog-actions">
                        <button type="button" class="btn btn-secondary smartbara-prompt-cancel">${window.SmartBaraFormatters.escapeHtml(cancelText)}</button>
                        <button type="button" class="btn btn-primary smartbara-prompt-confirm">${window.SmartBaraFormatters.escapeHtml(confirmText)}</button>
                    </div>
                </div>
            `;
            const close = (value) => {
                overlay.remove();
                resolve(value);
            };
            overlay.querySelector('.smartbara-dialog-close')?.addEventListener('click', () => close(null));
            overlay.querySelector('.smartbara-prompt-cancel')?.addEventListener('click', () => close(null));
            const input = overlay.querySelector('#smartbaraPromptInput');
            const confirm = overlay.querySelector('.smartbara-prompt-confirm');
            const submit = () => {
                const value = input.value.trim();
                if (pattern && !new RegExp(pattern).test(value)) {
                    input.focus();
                    input.reportValidity?.();
                    return;
                }
                close(value);
            };
            confirm?.addEventListener('click', submit);
            input?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                }
            });
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close(null);
            });
            document.body.appendChild(overlay);
            requestAnimationFrame(() => input?.focus());
        });
    }

    function renderLoadingProgress(progress, status) {
        const value = Math.max(0, Math.min(100, Math.round(progress)));
        const percent = document.getElementById('appLoadingPercent');
        const label = document.getElementById('appLoadingStatus');
        const track = document.getElementById('appLoadingTrack');
        const bar = document.getElementById('appLoadingBar');
        if (percent) percent.textContent = `${value}%`;
        if (label) label.textContent = status || (value >= 82 ? 'MENYELESAIKAN' : 'MEMUAT');
        if (track) {
            track.setAttribute('aria-valuenow', String(value));
            track.setAttribute('aria-valuetext', `${value}% dimuat`);
        }
        if (bar) bar.style.width = `${value}%`;
    }

    function renderLoadingState() {
        const overlay = ensureLoadingOverlay();
        const activeTask = [...loadingTasks.values()].at(-1);
        if (!activeTask) {
            if (loadingShowTimer) {
                window.clearTimeout(loadingShowTimer);
                loadingShowTimer = null;
            }
            overlay.classList.remove('is-visible');
            overlay.setAttribute('aria-hidden', 'true');
            return;
        }
        document.getElementById('appLoadingTitle').textContent = activeTask.title;
        document.getElementById('appLoadingDetail').textContent = activeTask.detail;
        renderLoadingProgress(activeTask.progress, activeTask.progress >= 82 ? 'MENYELESAIKAN' : 'MEMUAT');
        if (overlay.classList.contains('is-visible')) return;
        if (loadingShowTimer) return;
        loadingShowTimer = window.setTimeout(() => {
            loadingShowTimer = null;
            if (!loadingTasks.size) return;
            overlay.setAttribute('aria-hidden', 'false');
            overlay.classList.add('is-visible');
        }, 140);
    }

    function beginLoading(title = 'Memproses...', detail = 'Menyiapkan data...', maxDuration = 120000) {
        const taskId = ++loadingSequence;
        const timeout = window.setTimeout(() => {
            if (loadingTasks.delete(taskId)) renderLoadingState();
        }, maxDuration);
        loadingTasks.set(taskId, { title, detail, timeout, startedAt: Date.now(), progress: 6, hasReportedProgress: false });
        renderLoadingState();
        if (!loadingProgressTimer) {
            loadingProgressTimer = window.setInterval(() => {
                const activeTask = [...loadingTasks.values()].at(-1);
                if (!activeTask) {
                    window.clearInterval(loadingProgressTimer);
                    loadingProgressTimer = null;
                    return;
                }
                if (!activeTask.hasReportedProgress) {
                    const estimatedProgress = Math.min(94, 6 + Math.floor((Date.now() - activeTask.startedAt) / 220));
                    activeTask.progress = Math.max(activeTask.progress, estimatedProgress);
                }
                renderLoadingProgress(activeTask.progress, activeTask.progress >= 82 ? 'MENYELESAIKAN' : 'MEMUAT');
            }, 120);
        }
        return taskId;
    }

    function updateLoading(taskId, title, detail, progress) {
        const task = loadingTasks.get(taskId);
        if (!task) return;
        if (title) task.title = title;
        if (detail) task.detail = detail;
        if (Number.isFinite(Number(progress))) {
            task.progress = Math.max(task.progress, Math.min(96, Math.max(0, Math.round(Number(progress)))));
            task.hasReportedProgress = true;
        }
        renderLoadingState();
    }

    function endLoading(taskId, succeeded = false) {
        if (!taskId || !loadingTasks.has(taskId)) return;
        const task = loadingTasks.get(taskId);
        if (task?.timeout) window.clearTimeout(task.timeout);
        loadingTasks.delete(taskId);
        if (!loadingTasks.size) {
            window.clearInterval(loadingProgressTimer);
            loadingProgressTimer = null;
        }
        renderLoadingState();
    }

    async function withLoading(title, detail, action) {
        const taskId = beginLoading(title, detail);
        try {
            const result = await action();
            endLoading(taskId, true);
            return result;
        } catch (error) {
            endLoading(taskId);
            throw error;
        }
    }

    // ============= SIDEBAR =============
    function renderCollapsedSidebarToggle() {
        let toggle = document.getElementById('sidebarGhostToggle');
        if (!toggle) {
            toggle = document.createElement('button');
            toggle.id = 'sidebarGhostToggle';
            toggle.type = 'button';
            toggle.setAttribute('aria-label', 'Tampilkan menu');
            toggle.title = 'Tampilkan menu';
            toggle.className = 'sidebar-ghost-toggle';
            toggle.textContent = 'HZ';
            toggle.addEventListener('click', () => setSidebarVisible(true));
            document.body.appendChild(toggle);
        }

        const sidebar = document.getElementById('appSidebar');
        const isMobile = window.innerWidth < 1024;
        const isCollapsed = sidebar ? sidebar.classList.contains('sidebar-collapsed') : !sidebarVisible;
        toggle.style.display = isCollapsed && isMobile ? 'flex' : 'none';
    }

    function renderSidebar(activePageId) {
        const sidebar = document.getElementById('appSidebar');
        if (!sidebar) return;

        const canManageSettings = window.SmartBaraCore?.canManageSettings?.() || false;
        const visibleMenuItems = MENU_ITEMS.filter(item => !item.superadminOnly || canManageSettings);
        const navHtml = visibleMenuItems.map(item => {
            const isActive = item.id === activePageId;
            return `
                <a href="${item.href}" title="${item.label}" class="nav-link ${isActive ? 'active' : ''} ${item.highlight ? 'border border-teal-500/30' : ''}">
                    <span class="nav-icon text-base">${item.icon}</span>
                    <span class="nav-label">${item.label}</span>
                </a>
            `;
        }).join('');

        sidebar.innerHTML = `
            <div class="sidebar-brand p-5 flex items-center justify-between border-b border-white/10">
                <div class="flex items-center gap-3 min-w-0">
                    <button type="button" onclick="SmartBaraLayout.toggleSidebar()" class="sidebar-brand-toggle w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center font-black text-slate-950 text-base shadow-lg shadow-teal-500/20 transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-400" title="Tampilkan atau sembunyikan menu" aria-label="Tampilkan atau sembunyikan menu">
                        HZ
                    </button>
                    <div class="min-w-0">
                        <h1 class="text-sm font-black tracking-tight text-white m-0">SMART BARA</h1>
                        <p class="text-[10px] font-bold text-teal-400 uppercase tracking-widest m-0">V7.10 HZ · Enterprise</p>
                    </div>
                </div>
            </div>
            
            <nav class="flex-1 overflow-y-auto p-3 space-y-1">
                ${navHtml}
            </nav>

            <div class="sidebar-footer p-3 border-t border-white/10 bg-slate-950/40 space-y-2">
                <!-- Upload Button -->
                <button type="button" onclick="SmartBaraLayout.openUploadModal()" 
                    class="sidebar-upload w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 transition text-xs font-bold" title="Upload Excel Multi Dept">
                    <span class="sidebar-upload-icon">📤</span><span class="sidebar-upload-label">Upload Excel Multi Dept</span>
                </button>
                <!-- User Profile Card -->
                <div id="userProfileCard" title="Profil pengguna" class="flex items-center justify-between p-2 rounded-lg bg-white/5 hover:bg-white/10 transition cursor-pointer" onclick="SmartBaraLayout.toggleAuthModal()">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-xs font-bold text-teal-300" id="userAvatarText">
                            G
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-white truncate m-0" id="userNameText">Tamu (Guest)</p>
                            <p class="text-[10px] text-slate-400 truncate m-0" id="userEmailText">Belum login</p>
                            <p class="text-[10px] text-teal-300 truncate m-0" id="userRoleText">Level akses: Baca Saja</p>
                        </div>
                    </div>
                    <span class="text-xs text-slate-400">🔑</span>
                </div>
            </div>
        `;
    }

    // ============= HEADER =============
    async function renderHeader(activePageId) {
        const header = document.getElementById('appHeader');
        if (!header) return;

        const currentMenu = MENU_ITEMS.find(m => m.id === activePageId) || { label: 'Smart BARA' };
        const activePeriod = window.SmartBaraCore.getActivePeriod();
        const defaultPeriod = window.SmartBaraCore.getDefaultPeriod();

        // Load available periods
        let periodOptions = `<option value="${activePeriod}" class="bg-slate-900 text-white">${activePeriod}</option>`;
        try {
            const periods = await window.SmartBaraCore.loadAvailablePeriods();
            if (periods && periods.length > 0) {
                periodOptions = periods.map(p => `
                    <option value="${p}" class="bg-slate-900 text-white font-bold" ${p === activePeriod ? 'selected' : ''}>
                        ${p}${p === defaultPeriod ? ' ★' : ''}
                    </option>
                `).join('');
            }
        } catch(e) {}

        header.innerHTML = `
            <div class="flex items-center gap-4">
                <button type="button" id="sidebarToggle" class="lg:hidden p-2 rounded-lg bg-white/5 text-slate-300 hover:text-white" aria-label="Menu">
                    ☰
                </button>
                <div>
                    <h2 class="text-base lg:text-lg font-black text-white m-0">${currentMenu.label}</h2>
                    <p class="text-[11px] text-slate-400 hidden sm:block m-0">Sistem Konsolidasi & Perencanaan Multi-User Terpadu</p>
                </div>
            </div>

            <div class="flex items-center gap-2">
                <div id="globalSyncPill" class="opacity-0 transition-opacity"></div>

                <!-- Dept Filter Button -->
                <button type="button" onclick="SmartBaraLayout.openDeptFilter()" id="deptFilterBtn"
                    class="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-slate-300 hover:text-white hover:border-teal-500/60 transition" title="Filter & Gabungan Departemen">
                    <span>🏢</span>
                    <span id="deptFilterLabel">Semua Dept</span>
                    <span class="text-slate-500">▾</span>
                </button>

                <!-- Period Selector -->
                <div class="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 shadow-sm">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Periode:</span>
                    <select id="periodSelector" class="bg-transparent text-xs font-extrabold text-teal-300 focus:outline-none cursor-pointer pr-1">
                        ${periodOptions}
                    </select>
                    <button type="button" onclick="SmartBaraLayout.openPeriodManager()" title="Kelola Periode" 
                        class="ml-1 text-slate-400 hover:text-teal-300 transition text-sm">⚙</button>
                </div>

                <!-- Upload shortcut -->
                <button type="button" onclick="SmartBaraLayout.openUploadModal()" title="Upload Laporan Excel"
                    class="p-2 rounded-lg bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-bold transition flex items-center gap-1">
                    📤
                </button>

                <button type="button" onclick="window.location.reload()" title="Muat Ulang Data" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition">
                    🔄
                </button>
            </div>
        `;
    }

    // ============= AUTH MODAL =============
    function renderAuthModal() {
        if (document.getElementById('authModalOverlay')) return;
        const modal = document.createElement('div');
        modal.id = 'authModalOverlay';
        modal.className = 'modal-overlay fixed inset-0 z-[9000] flex items-center justify-center p-4 hidden opacity-0 transition-all duration-200';
        modal.innerHTML = `
            <div class="glass-panel w-full max-w-sm rounded-2xl p-6 border border-white/20 shadow-2xl relative" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-5">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-300 flex items-center justify-center font-black text-sm">🔑</div>
                        <h3 class="text-base font-extrabold text-white m-0" id="authModalTitle">Masuk Akun Admin</h3>
                    </div>
                    <button type="button" onclick="SmartBaraLayout.toggleAuthModal(false)" class="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
                </div>
                <div id="authLoggedInState" class="hidden text-center py-4">
                    <p class="text-sm font-bold text-white mb-1" id="authActiveUserEmail"></p>
                    <p class="text-xs text-teal-400 font-semibold mb-5">Level Akses: Administrator</p>
                    <button type="button" onclick="SmartBaraLayout.handleLogout()" class="btn btn-secondary w-full">Keluar (Logout)</button>
                </div>
                <form id="authLoginForm" onsubmit="SmartBaraLayout.handleLogin(event)" class="space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-300 mb-1">Email</label>
                        <input type="email" id="authEmail" required class="form-input w-full" placeholder="admin@smartbara.com">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-300 mb-1">Password</label>
                        <input type="password" id="authPassword" required class="form-input w-full" placeholder="••••••••">
                    </div>
                    <div id="authErrorMessage" class="hidden text-xs text-rose-400 font-medium"></div>
                    <button type="submit" id="authSubmitBtn" class="btn btn-primary w-full py-2.5">Masuk Sekarang</button>
                    <a href="login.html" class="block text-center text-xs font-bold text-teal-300 hover:text-teal-200">Buka halaman login, daftar, atau reset password</a>
                </form>
            </div>
        `;
        modal.addEventListener('click', () => toggleAuthModal(false));
        document.body.appendChild(modal);
    }

    // ============= UPLOAD MODAL =============
    function renderUploadModal() {
        if (document.getElementById('globalUploadModal')) return;
        const modal = document.createElement('div');
        modal.id = 'globalUploadModal';
        modal.className = 'modal-overlay fixed inset-0 z-[8000] flex items-center justify-center p-4 hidden opacity-0 transition-all duration-200';
        modal.innerHTML = `
            <div class="glass-panel flex max-h-[94vh] w-full max-w-[96vw] flex-col overflow-hidden rounded-2xl border border-white/20 shadow-2xl 2xl:max-w-[1760px]" onclick="event.stopPropagation()">
                <!-- Header -->
                <div class="bg-blue-600/20 border-b border-blue-500/30 px-6 py-4 flex items-center justify-between">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xl">📤</span>
                            <h3 id="uploadModalTitle" class="text-lg font-black text-white m-0">Upload Laporan Excel Multi Departemen</h3>
                        </div>
                        <p class="text-xs text-slate-400 m-0">Periode aktif: <strong id="uploadTargetPeriodText" class="text-teal-300"></strong> · Pilih file, cek preview, lalu terapkan.</p>
                    </div>
                    <button type="button" onclick="SmartBaraUpload.closeModal()" class="text-slate-400 hover:text-white text-xl">✕</button>
                </div>

                <!-- Body -->
                <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                    <!-- File Input Drop Zone -->
                    <div class="border-2 border-dashed border-blue-500/40 hover:border-blue-400/60 rounded-xl p-6 text-center transition cursor-pointer"
                         onclick="document.getElementById('uploadFileInput').click()">
                        <div class="text-4xl mb-2">📁</div>
                        <p class="text-sm font-bold text-white">Klik atau seret file Excel ke sini</p>
                        <p class="text-xs text-slate-400 mt-1">.xlsx atau .xls · Bisa pilih beberapa file</p>
                        <input type="file" id="uploadFileInput" accept=".xlsx,.xls" multiple class="hidden"
                               onchange="SmartBaraUpload.handleFileSelect(event)">
                    </div>

                    <!-- Status Badge -->
                    <div class="flex items-center justify-between">
                        <span id="uploadFileCountBadge" class="badge badge-teal">0 file dipilih</span>
                        <button type="button" onclick="SmartBaraUpload.clearAllFiles()" class="text-xs text-rose-400 hover:text-rose-300 font-bold transition">🗑️ Hapus Semua</button>
                    </div>

                    <fieldset class="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                        <legend class="px-1 text-xs font-bold uppercase tracking-wider text-slate-300">Jenis data</legend>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="cursor-pointer">
                                <input type="radio" name="uploadDataType" value="report" class="peer sr-only" checked onchange="SmartBaraUpload.onDataTypeChange()">
                                <span class="block rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-center text-xs font-bold text-slate-400 peer-checked:border-teal-400/40 peer-checked:bg-teal-500/15 peer-checked:text-teal-200">Upload Laporan</span>
                            </label>
                            <label class="cursor-pointer">
                                <input type="radio" name="uploadDataType" value="budget" class="peer sr-only" onchange="SmartBaraUpload.onDataTypeChange()">
                                <span class="block rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-center text-xs font-bold text-slate-400 peer-checked:border-amber-400/40 peer-checked:bg-amber-500/15 peer-checked:text-amber-200">Upload Budget</span>
                            </label>
                        </div>
                        <div id="uploadBudgetTypeControls" class="mt-3 hidden items-center gap-2">
                            <label for="uploadBudgetKind" class="text-xs font-semibold text-slate-400">Tujuan budget</label>
                            <select id="uploadBudgetKind" onchange="SmartBaraUpload.onBudgetKindChange()" class="form-select w-48 text-xs">
                                <option value="account">Budget Akun</option>
                                <option value="site">Budget Proyek UP</option>
                            </select>
                            <span id="uploadBudgetSourceStatus" class="text-[10px] text-slate-500"></span>
                        </div>
                    </fieldset>

                    <fieldset id="uploadReportModeControls" class="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                        <legend class="px-1 text-xs font-bold uppercase tracking-wider text-slate-300">Cara impor</legend>
                        <div class="flex flex-wrap gap-4">
                            <label class="flex items-center gap-2 text-xs text-teal-200">
                                <input type="radio" name="uploadMode" value="update" checked onchange="SmartBaraUpload.refreshPreview()">
                                Tambahkan ke data yang sudah ada (tanpa menimpa)
                            </label>
                            <label class="flex items-center gap-2 text-xs text-rose-200">
                                <input type="radio" name="uploadMode" value="overwrite" onchange="SmartBaraUpload.refreshPreview()">
                                Timpa seluruh data departemen
                             </label>
                             <label class="flex items-center gap-2 text-xs text-sky-200">
                                 <input type="radio" name="uploadMode" value="add-department" onchange="SmartBaraUpload.refreshPreview()">
                                 Tambahkan laporan departemen baru (jika belum ada)
                            </label>
                        </div>
                        <div id="uploadMonthSelector" class="mt-3 flex items-center gap-2">
                            <label for="uploadTargetMonth" class="text-xs font-semibold text-slate-400">Bulan yang diperbarui</label>
                            <select id="uploadTargetMonth" onchange="this.dataset.userSelected='true'; SmartBaraUpload.refreshPreview()" class="form-select w-44 text-xs">
                                <option value="">Pilih bulan...</option>
                                <option value="01">Januari</option><option value="02">Februari</option><option value="03">Maret</option>
                                <option value="04">April</option><option value="05">Mei</option><option value="06">Juni</option>
                                <option value="07">Juli</option><option value="08">Agustus</option><option value="09">September</option>
                                <option value="10">Oktober</option><option value="11">November</option><option value="12">Desember</option>
                            </select>
                        </div>
                        <p id="uploadModeNotice" class="mt-2 mb-0 text-[11px] text-slate-400"></p>
                    </fieldset>
                    <div id="uploadBudgetModeNotice" class="hidden rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-5 text-amber-100/80"></div>

                    <!-- Empty State -->
                    <div id="uploadEmptyState" class="py-6 text-center text-slate-500 text-sm">
                        Belum ada file yang dipilih. Pilih file Excel laporan tiap departemen.
                    </div>

                    <!-- File List -->
                    <div id="uploadFileListContainer" class="space-y-2"></div>

                    <section id="uploadPreviewPanel" class="hidden overflow-hidden rounded-xl border border-white/10">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-950/50 p-3">
                            <div class="flex items-center gap-3">
                                <h4 id="uploadPreviewTitle" class="m-0 text-xs font-bold uppercase text-slate-300">Preview data impor</h4>
                                <button id="uploadPreviewToggleButton" type="button" onclick="SmartBaraUpload.toggleTablePreview()" class="btn btn-secondary px-2 py-1 text-[10px]" aria-expanded="false">Preview tabel</button>
                            </div>
                            <input id="uploadBudgetPreviewSearch" type="search" placeholder="Cari akun / departemen..." class="form-input text-xs w-44 hidden" oninput="SmartBaraUpload.refreshPreview()">
                            <span id="uploadPreviewSummary" class="text-[11px] text-slate-400"></span>
                        </div>
                        <div id="uploadPreviewTableWrap" class="hidden max-h-[65vh] overflow-auto">
                            <table id="uploadPreviewTable" class="app-table min-w-[1600px] text-xs 2xl:min-w-[1700px]">
                                <thead class="sticky top-0 z-10 bg-slate-900">
                                    <tr id="uploadPreviewTableHead"></tr>
                                </thead>
                                <tbody id="uploadPreviewTableBody"></tbody>
                            </table>
                        </div>
                    </section>

                    <!-- Progress Area -->
                    <div id="uploadProgressArea" class="hidden space-y-2">
                        <div class="flex justify-between text-xs font-bold text-slate-300">
                            <span id="uploadStatusText">Memproses...</span>
                        </div>
                        <div class="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div id="uploadProgressBar" class="h-full bg-gradient-to-r from-blue-500 to-teal-400 rounded-full transition-all duration-300" style="width: 0%"></div>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="px-6 py-4 border-t border-white/10 bg-slate-950/40 flex justify-end gap-3">
                    <button type="button" onclick="SmartBaraUpload.closeModal()" class="btn btn-secondary">Batal</button>
                    <button type="button" id="uploadSubmitButton" onclick="SmartBaraUpload.processUpload()" class="btn btn-primary">
                        ➕ Update & Tambahkan
                    </button>
                </div>
            </div>
        `;
        modal.addEventListener('click', () => SmartBaraUpload.closeModal());
        document.body.appendChild(modal);
    }

    // ============= PERIOD MANAGER MODAL =============
    function renderPeriodModal() {
        if (document.getElementById('periodManagerModal')) return;
        const periodSettingsMarkup = `
            <div id="periodSettingsControls" class="hidden border-t border-white/10 pt-4">
                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Tambah Periode Baru</p>
                <div class="flex items-center gap-2">
                    <input type="text" id="newPeriodInput" placeholder="Contoh: GMI-AGUSTUS 2026" maxlength="40" class="form-input flex-1 text-sm" pattern="^[\\w -]{2,40}$">
                    <label class="flex items-center gap-1.5 text-xs text-slate-300 whitespace-nowrap cursor-pointer">
                        <input type="checkbox" id="newPeriodSetDefault" class="w-3.5 h-3.5 rounded"> Set Default
                    </label>
                    <button type="button" onclick="SmartBaraLayout.addNewPeriod()" class="btn btn-primary text-xs px-4">+ Tambah</button>
                </div>
                <p class="text-[10px] text-slate-500 mt-1">Periode default ditandai ★ dan digunakan saat pertama kali membuka aplikasi.</p>
            </div>
        `;
        const modal = document.createElement('div');
        modal.id = 'periodManagerModal';
        modal.className = 'modal-overlay fixed inset-0 z-[8500] flex items-center justify-center p-4 hidden opacity-0 transition-all duration-200';
        modal.innerHTML = `
            <div class="glass-panel w-full max-w-4xl rounded-2xl border border-white/20 shadow-2xl overflow-hidden" onclick="event.stopPropagation()">
                <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-black text-white m-0">⚙️ Kelola Periode</h3>
                        <p class="text-xs text-slate-400 m-0 mt-0.5">Tambah tahun baru, atur periode default tampilan</p>
                    </div>
                    <button type="button" onclick="SmartBaraLayout.closePeriodManager()" class="text-slate-400 hover:text-white text-xl">✕</button>
                </div>
                <div class="p-6 space-y-5">
                    <!-- Existing Periods List -->
                    <div>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Periode Tersedia</p>
                        <div id="periodListContainer" class="space-y-2 max-h-48 overflow-y-auto">
                            <p class="text-xs text-slate-500">Memuat...</p>
                        </div>
                    </div>
                    ${periodSettingsMarkup}
                </div>
            </div>
        `;
        modal.addEventListener('click', () => closePeriodManager());
        document.body.appendChild(modal);

        const passwordModal = document.createElement('div');
        passwordModal.id = 'periodDeletePasswordModal';
        passwordModal.className = 'modal-overlay fixed inset-0 z-[9100] flex items-center justify-center p-4 hidden opacity-0 transition-all duration-200';
        passwordModal.innerHTML = `
            <form class="glass-panel w-full max-w-md rounded-xl border border-rose-400/30 p-5 shadow-2xl" onsubmit="SmartBaraLayout.confirmDeletePeriod(event)" onclick="event.stopPropagation()">
                <h3 class="m-0 text-lg font-black text-white">Hapus Periode</h3>
                <p id="periodDeletePrompt" class="mt-2 text-sm text-slate-300"></p>
                <label for="periodDeletePassword" class="mt-4 block text-xs font-bold text-slate-300">Password akun aktif</label>
                <input id="periodDeletePassword" type="password" required autocomplete="current-password" class="form-input mt-1.5 w-full" placeholder="Masukkan password">
                <p id="periodDeleteStatus" class="mt-2 min-h-5 text-xs text-rose-300" role="status" aria-live="polite"></p>
                <div class="mt-4 flex justify-end gap-2">
                    <button type="button" onclick="SmartBaraLayout.cancelDeletePeriod()" class="btn btn-secondary text-xs">Batal</button>
                    <button type="submit" id="periodDeleteSubmit" class="btn bg-rose-600 hover:bg-rose-500 text-white text-xs">Hapus Periode</button>
                </div>
            </form>
        `;
        passwordModal.addEventListener('click', () => cancelDeletePeriod());
        document.body.appendChild(passwordModal);
    }

    // ============= DEPT FILTER MODAL =============
    function renderDeptFilterModal() {
        if (document.getElementById('deptFilterModal')) return;
        const modal = document.createElement('div');
        modal.id = 'deptFilterModal';
        modal.className = 'modal-overlay fixed inset-0 z-[8200] flex items-center justify-center p-4 hidden opacity-0 transition-all duration-200';
        modal.innerHTML = `
            <div class="glass-panel w-full max-w-md rounded-2xl border border-white/20 shadow-2xl overflow-hidden" onclick="event.stopPropagation()">
                <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-black text-white m-0">🏢 Filter Departemen</h3>
                        <p class="text-xs text-slate-400 m-0 mt-0.5">Pilih satu atau gabungan beberapa departemen untuk ditampilkan</p>
                    </div>
                    <button type="button" onclick="SmartBaraLayout.closeDeptFilter()" class="text-slate-400 hover:text-white text-xl">✕</button>
                </div>
                <div class="p-6 space-y-4">
                    <!-- ALL Option -->
                    <label class="flex items-center gap-3 p-3 rounded-xl bg-teal-500/10 border border-teal-500/30 cursor-pointer hover:bg-teal-500/20 transition">
                        <input type="checkbox" id="deptFilterAll" onchange="SmartBaraLayout.toggleAllDepts(this)" 
                            class="w-4 h-4 rounded text-teal-500 bg-slate-900 border-slate-700" checked>
                        <span class="font-black text-teal-300 text-sm">✨ Gabungan Semua Departemen</span>
                    </label>
                    <!-- Individual Dept List -->
                    <div id="deptFilterList" class="space-y-2 max-h-60 overflow-y-auto"></div>
                    <!-- Apply -->
                    <div class="border-t border-white/10 pt-4 flex justify-end gap-2">
                        <button type="button" onclick="SmartBaraLayout.closeDeptFilter()" class="btn btn-secondary text-xs">Batal</button>
                        <button type="button" onclick="SmartBaraLayout.applyDeptFilter()" class="btn btn-primary text-xs">Terapkan Filter</button>
                    </div>
                </div>
            </div>
        `;
        modal.addEventListener('click', () => closeDeptFilter());
        document.body.appendChild(modal);
    }

    // ============= PERIOD MANAGER LOGIC =============
    async function openPeriodManager() {
        const modal = document.getElementById('periodManagerModal');
        if (!modal) return;

        // Load and render periods
        const periods = await window.SmartBaraCore.loadAvailablePeriods();
        const defaultPeriod = window.SmartBaraCore.getDefaultPeriod();
        const activePeriod = window.SmartBaraCore.getActivePeriod();
        const canManageSettings = window.SmartBaraCore.canManageSettings();
        document.getElementById('periodSettingsControls')?.classList.toggle('hidden', !canManageSettings);
        const listContainer = document.getElementById('periodListContainer');

        if (listContainer) {
            listContainer.innerHTML = periods.map(p => `
                <div class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-white/5 border border-white/5">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-white text-sm">${window.Formatters.escapeHtml(p)}</span>
                        ${p === defaultPeriod ? '<span class="badge badge-teal text-[10px]">★ Default</span>' : ''}
                        ${p === activePeriod ? '<span class="badge badge-emerald text-[10px]">Aktif</span>' : ''}
                    </div>
                    <div class="flex items-center gap-2">
                        ${canManageSettings ? `<button type="button" data-period-action="default" data-period="${window.Formatters.escapeHtml(p)}"
                            class="text-[10px] text-slate-400 hover:text-teal-300 transition font-bold" 
                            title="Set sebagai Default">★ Default</button>` : ''}
                        <button type="button" data-period-action="switch" data-period="${window.Formatters.escapeHtml(p)}"
                            class="text-[10px] text-blue-400 hover:text-blue-300 transition font-bold">
                            → Aktifkan
                        </button>
                        ${canManageSettings ? `<button type="button" data-period-action="rename" data-period="${window.Formatters.escapeHtml(p)}"
                            class="text-[10px] text-amber-300 hover:text-amber-200 transition font-bold" title="Ubah nama periode">Ubah</button>
                        <button type="button" data-period-action="duplicate" data-period="${window.Formatters.escapeHtml(p)}"
                            class="text-[10px] text-teal-300 hover:text-teal-200 transition font-bold" title="Salin semua data ke periode baru">Duplikasi</button>
                        <button type="button" data-period-action="delete" data-period="${window.Formatters.escapeHtml(p)}" ${p === activePeriod ? 'disabled' : ''}
                            class="text-[10px] font-bold transition ${p === activePeriod ? 'text-slate-600 cursor-not-allowed' : 'text-rose-400 hover:text-rose-300'}"
                            title="${p === activePeriod ? 'Pindah ke periode lain sebelum menghapus' : 'Hapus periode dengan password akun'}">Hapus</button>` : ''}
                    </div>
                </div>
            `).join('') || '<p class="text-xs text-slate-500">Belum ada periode terdaftar.</p>';
            listContainer.querySelectorAll('[data-period-action]').forEach(button => {
                button.addEventListener('click', () => {
                    const periodName = button.dataset.period;
                    if (button.dataset.periodAction === 'default') setAsDefaultPeriod(periodName);
                    if (button.dataset.periodAction === 'switch') switchToPeriod(periodName);
                    if (button.dataset.periodAction === 'rename') renamePeriod(periodName);
                    if (button.dataset.periodAction === 'duplicate') duplicatePeriod(periodName);
                    if (button.dataset.periodAction === 'delete') requestDeletePeriod(periodName);
                });
            });
        }

        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closePeriodManager() {
        const modal = document.getElementById('periodManagerModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    async function addNewPeriod() {
        const input = document.getElementById('newPeriodInput');
        const setDefault = document.getElementById('newPeriodSetDefault')?.checked || false;
        const name = input?.value?.trim();

        if (!name) {
            await window.SmartBaraLayout.alertDialog({ title: 'Nama periode wajib diisi', message: 'Masukkan nama periode (contoh: GMI-AGUSTUS 2026).', confirmText: 'OK' });
            return;
        }
        if (!/^[\w -]{2,40}$/i.test(name)) {
            await window.SmartBaraLayout.alertDialog({ title: 'Nama periode tidak valid', message: 'Nama periode hanya boleh berisi huruf, angka, spasi, tanda hubung, dan garis bawah.', confirmText: 'OK' });
            return;
        }

        try {
            await window.SmartBaraCore.addPeriod(name, setDefault);
            if (input) input.value = '';
            await openPeriodManager(); // Refresh list
            // Refresh period selector in header
            await renderHeader(document.querySelector('.nav-link.active')?.getAttribute('href')?.replace('.html','') || 'dashboard');
            window.SmartBaraCore.showSyncStatus(`Periode ${name} berhasil ditambahkan.`, 'success');
        } catch(err) {
            await window.SmartBaraLayout.alertDialog({ title: 'Gagal menambah periode', message: 'Gagal menambah periode: ' + err.message, confirmText: 'OK' });
        }
    }

    function setAsDefaultPeriod(periodName) {
        window.SmartBaraCore.setDefaultPeriod(periodName);
        openPeriodManager(); // Refresh
    }

    function switchToPeriod(periodName) {
        window.SmartBaraCore.setPeriod(periodName);
        closePeriodManager();
        window.location.reload();
    }

    async function renamePeriod(periodName) {
        const current = String(periodName || '').trim();
        closePeriodManager();
        const nextName = await window.SmartBaraLayout.openThemePrompt({
            title: 'Ubah nama periode',
            message: `Masukkan nama baru untuk periode ${current}.`,
            defaultValue: current,
            placeholder: 'Contoh: GMI-AGUSTUS 2026',
            confirmText: 'Simpan',
            cancelText: 'Batal',
            pattern: '^[\\w -]{1,40}$'
        });
        if (nextName === null) return;
        const cleanName = String(nextName).trim();
        if (!cleanName) {
            await window.SmartBaraLayout.alertDialog({ title: 'Nama periode tidak valid', message: 'Nama periode tidak boleh kosong.', confirmText: 'OK' });
            return;
        }
        if (!/^[\w -]{1,40}$/i.test(cleanName)) {
            await window.SmartBaraLayout.alertDialog({ title: 'Nama periode tidak valid', message: 'Nama periode hanya boleh berisi huruf, angka, spasi, tanda hubung, dan garis bawah.', confirmText: 'OK' });
            return;
        }
        if (cleanName.toLowerCase() === current.toLowerCase()) return;
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi ubah nama periode',
            message: `Ubah nama periode ${current} menjadi ${cleanName}? Semua referensi periode akan diperbarui.`,
            confirmText: 'Ubah',
            cancelText: 'Batal'
        });
        if (!confirmed) return;

        try {
            const renamed = await window.SmartBaraCore.renamePeriod(current, cleanName);
            window.SmartBaraCore.showSyncStatus(`Periode ${current} berhasil diubah menjadi ${renamed}.`, 'success');
            await openPeriodManager();
            await renderHeader(document.querySelector('.nav-link.active')?.getAttribute('href')?.replace('.html', '') || 'dashboard');
        } catch (error) {
            await window.SmartBaraLayout.alertDialog({ title: 'Gagal mengubah periode', message: `Gagal mengubah nama periode: ${error.message}`, confirmText: 'OK' });
        }
    }

    async function duplicatePeriod(sourcePeriod) {
        closePeriodManager();
        const targetPeriod = await window.SmartBaraLayout.openThemePrompt({
            title: 'Duplikasi periode',
            message: `Masukkan nama periode baru untuk menyalin data dari ${sourcePeriod}.`,
            defaultValue: '',
            placeholder: 'Contoh: GMI-SEPTEMBER 2026',
            confirmText: 'Duplikasi',
            cancelText: 'Batal',
            pattern: '^[\\w -]{1,40}$'
        });
        if (targetPeriod === null) return;
        const cleanTargetPeriod = String(targetPeriod).trim();
        if (!cleanTargetPeriod) {
            await window.SmartBaraLayout.alertDialog({ title: 'Nama periode tidak valid', message: 'Nama periode tujuan tidak boleh kosong.', confirmText: 'OK' });
            return;
        }
        if (!/^[\w -]{1,40}$/i.test(cleanTargetPeriod)) {
            await window.SmartBaraLayout.alertDialog({ title: 'Nama periode tidak valid', message: 'Nama periode hanya boleh berisi huruf, angka, spasi, tanda hubung, dan garis bawah.', confirmText: 'OK' });
            return;
        }
        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi duplikasi periode',
            message: `Duplikasi seluruh data periode ${sourcePeriod} ke ${cleanTargetPeriod}? Data sumber tidak akan berubah.`,
            confirmText: 'Duplikasi',
            cancelText: 'Batal'
        });
        if (!confirmed) return;

        try {
            const counts = await window.SmartBaraLayout.withLoading(
                'Menduplikasi periode',
                `Menyalin data dari ${sourcePeriod} ke ${cleanTargetPeriod}...`,
                async () => {
                    return await window.SmartBaraCore.duplicatePeriod(sourcePeriod, cleanTargetPeriod);
                }
            );
            const totalRows = Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
            window.SmartBaraCore.showSyncStatus(`Periode ${cleanTargetPeriod} dibuat; ${totalRows} baris data disalin.`, 'success');
            await openPeriodManager();
        } catch (error) {
            await window.SmartBaraLayout.alertDialog({ title: 'Gagal menduplikasi periode', message: `Gagal menduplikasi periode: ${error.message}`, confirmText: 'OK' });
        }
    }

    function requestDeletePeriod(periodName) {
        const modal = document.getElementById('periodDeletePasswordModal');
        if (!modal) return;
        modal.dataset.period = periodName;
        document.getElementById('periodDeletePrompt').textContent = `Semua data periode ${periodName} akan dihapus permanen. Masukkan password akun aktif untuk melanjutkan.`;
        document.getElementById('periodDeletePassword').value = '';
        document.getElementById('periodDeleteStatus').textContent = '';
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
        document.getElementById('periodDeletePassword').focus();
    }

    function cancelDeletePeriod() {
        const modal = document.getElementById('periodDeletePasswordModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    async function confirmDeletePeriod(event) {
        event.preventDefault();
        const modal = document.getElementById('periodDeletePasswordModal');
        const periodName = modal?.dataset.period;
        const password = document.getElementById('periodDeletePassword').value;
        const button = document.getElementById('periodDeleteSubmit');
        const status = document.getElementById('periodDeleteStatus');
        button.disabled = true;
        status.textContent = 'Memverifikasi akun dan menghapus data periode...';
        try {
            await window.SmartBaraCore.deletePeriod(periodName, password);
            cancelDeletePeriod();
            await openPeriodManager();
            await renderHeader(document.querySelector('.nav-link.active')?.getAttribute('href')?.replace('.html', '') || 'dashboard');
            window.SmartBaraCore.showSyncStatus(`Periode ${periodName} dan seluruh datanya telah dihapus.`, 'success');
        } catch(error) {
            status.textContent = error.message;
            document.getElementById('periodDeletePassword').value = '';
            document.getElementById('periodDeletePassword').focus();
        } finally {
            button.disabled = false;
        }
    }

    // ============= DEPT FILTER LOGIC =============
    function openDeptFilter() {
        const modal = document.getElementById('deptFilterModal');
        if (!modal) return;

        const depts = window.SmartBaraCore.getDepartments();
        const selected = window.SmartBaraCore.getSelectedDepartments();
        const isAll = window.SmartBaraCore.isCombinedDepartments();

        const allCheckbox = document.getElementById('deptFilterAll');
        if (allCheckbox) allCheckbox.checked = isAll;

        const listContainer = document.getElementById('deptFilterList');
        if (listContainer) {
            if (depts.length === 0) {
                listContainer.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Belum ada data departemen untuk periode ini. Upload laporan Excel terlebih dahulu.</p>';
            } else {
                listContainer.innerHTML = depts.map(d => `
                    <label class="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-white/5 cursor-pointer hover:bg-white/10 transition">
                        <input type="checkbox" class="dept-checkbox w-4 h-4 rounded text-teal-500 bg-slate-900 border-slate-700"
                            value="${d}" ${isAll || selected.includes(d) ? 'checked' : ''}
                            onchange="SmartBaraLayout.onDeptCheckChange(this)">
                        <span class="font-semibold text-slate-200 text-xs">${d}</span>
                    </label>
                `).join('');
            }
        }

        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeDeptFilter() {
        const modal = document.getElementById('deptFilterModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    function toggleAllDepts(cb) {
        const checkboxes = document.querySelectorAll('.dept-checkbox');
        checkboxes.forEach(c => c.checked = cb.checked);
    }

    function onDeptCheckChange(cb) {
        const allChecked = document.querySelectorAll('.dept-checkbox:checked').length;
        const allTotal = document.querySelectorAll('.dept-checkbox').length;
        const allCb = document.getElementById('deptFilterAll');
        if (allCb) allCb.checked = (allChecked === allTotal);
    }

    function applyDeptFilter() {
        const allCb = document.getElementById('deptFilterAll');
        let selection;
        if (allCb?.checked) {
            selection = ['ALL'];
        } else {
            const checked = Array.from(document.querySelectorAll('.dept-checkbox:checked')).map(c => c.value);
            selection = checked.length > 0 ? checked : ['ALL'];
        }

        window.SmartBaraCore.setSelectedDepartments(selection);
        closeDeptFilter();

        // Update label in header
        updateDeptFilterLabel();
    }

    function updateDeptFilterLabel() {
        const labelEl = document.getElementById('deptFilterLabel');
        if (!labelEl) return;
        const isCombined = window.SmartBaraCore.isCombinedDepartments();
        const selected = window.SmartBaraCore.getSelectedDepartments();
        if (isCombined) {
            labelEl.textContent = 'Semua Dept';
        } else if (selected.length === 1) {
            labelEl.textContent = selected[0];
        } else {
            labelEl.textContent = `${selected.length} Dept`;
        }
    }

    // ============= UPLOAD MODAL OPENER =============
    function openUploadModal() {
        if (typeof window.SmartBaraUpload !== 'undefined') {
            window.SmartBaraUpload.openModal();
        }
    }

    // ============= AUTH MODAL LOGIC =============
    function toggleAuthModal(show = true) {
        const modal = document.getElementById('authModalOverlay');
        if (!modal) return;
        const user = window.SmartBaraCore.getUser();
        const loginForm = document.getElementById('authLoginForm');
        const loggedInState = document.getElementById('authLoggedInState');
        const title = document.getElementById('authModalTitle');

        if (user) {
            loginForm?.classList.add('hidden');
            loggedInState?.classList.remove('hidden');
            const emailEl = document.getElementById('authActiveUserEmail');
            if (emailEl) emailEl.textContent = user.email;
            if (title) title.textContent = 'Profil Administrator';
        } else {
            loginForm?.classList.remove('hidden');
            loggedInState?.classList.add('hidden');
            if (title) title.textContent = 'Masuk Akun Admin';
        }

        if (show) {
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.remove('opacity-0'), 10);
        } else {
            modal.classList.add('opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 200);
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        const btn = document.getElementById('authSubmitBtn');
        const errMsg = document.getElementById('authErrorMessage');
        
        btn.disabled = true;
        btn.textContent = 'Memverifikasi...';
        errMsg?.classList.add('hidden');

        try {
            await window.SmartBaraCore.login(email, password);
            toggleAuthModal(false);
            window.SmartBaraCore.showSyncStatus('Berhasil masuk sebagai admin', 'success');
        } catch(err) {
            if (errMsg) {
                errMsg.textContent = err.message || 'Login gagal. Periksa email & password.';
                errMsg.classList.remove('hidden');
            }
        } finally {
            btn.disabled = false;
            btn.textContent = 'Masuk Sekarang';
        }
    }

    async function handleLogout() {
        await window.SmartBaraCore.logout();
        toggleAuthModal(false);
        window.SmartBaraCore.showSyncStatus('Sesi admin telah berakhir', 'info');
    }

    // ============= BIND EVENTS =============
    function setSidebarVisible(visible) {
        sidebarVisible = visible;
        const sidebar = document.getElementById('appSidebar');
        const ghostToggle = document.getElementById('sidebarGhostToggle');
        if (!sidebar) return;

        const isDesktop = window.innerWidth >= 1024;
        const collapsed = !visible;
        sidebar.classList.toggle('sidebar-collapsed', collapsed);
        sidebar.classList.toggle('is-open', visible && !isDesktop);
        sidebar.classList.toggle('-translate-x-full', collapsed && !isDesktop);
        sidebar.classList.toggle('lg:translate-x-0', visible && isDesktop);

        document.body.classList.toggle('sidebar-open', visible && !isDesktop);
        document.body.classList.toggle('sidebar-collapsed-ghost', collapsed);

        if (collapsed) {
            sidebar.style.display = 'flex';
            sidebar.style.opacity = isDesktop ? '1' : '0';
            sidebar.style.transform = isDesktop ? 'translateX(0)' : 'translateX(-110%)';
            sidebar.style.pointerEvents = isDesktop ? 'auto' : 'none';
            if (ghostToggle) {
                ghostToggle.style.display = isDesktop ? 'none' : 'flex';
            }
        } else {
            sidebar.style.display = 'flex';
            sidebar.style.opacity = '1';
            sidebar.style.transform = isDesktop ? 'translateX(0)' : 'translateX(0)';
            sidebar.style.pointerEvents = 'auto';
            if (ghostToggle) {
                ghostToggle.style.display = 'none';
            }
        }
    }

    function syncSidebarByViewport() {
        const sidebar = document.getElementById('appSidebar');
        const ghostToggle = document.getElementById('sidebarGhostToggle');
        if (!sidebar) return;

        const isDesktop = window.innerWidth >= 1024;
        sidebar.classList.toggle('sidebar-collapsed', !sidebarVisible);
        sidebar.classList.toggle('is-open', sidebarVisible && !isDesktop);
        sidebar.classList.toggle('-translate-x-full', !sidebarVisible && !isDesktop);
        sidebar.classList.toggle('lg:translate-x-0', sidebarVisible && isDesktop);

        document.body.classList.toggle('sidebar-open', sidebarVisible && !isDesktop);
        document.body.classList.toggle('sidebar-collapsed-ghost', !sidebarVisible);

        if (!sidebarVisible) {
            sidebar.style.display = 'flex';
            sidebar.style.opacity = isDesktop ? '1' : '0';
            sidebar.style.transform = isDesktop ? 'translateX(0)' : 'translateX(-110%)';
            sidebar.style.pointerEvents = isDesktop ? 'auto' : 'none';
            if (ghostToggle) ghostToggle.style.display = isDesktop ? 'none' : 'flex';
        } else {
            sidebar.style.display = 'flex';
            sidebar.style.opacity = '1';
            sidebar.style.transform = isDesktop ? 'translateX(0)' : 'translateX(0)';
            sidebar.style.pointerEvents = 'auto';
            if (ghostToggle) ghostToggle.style.display = 'none';
        }
    }

    function toggleSidebar() {
        setSidebarVisible(!sidebarVisible);
    }

    function updateUserProfileUI(user) {
        const nameEl = document.getElementById('userNameText');
        const emailEl = document.getElementById('userEmailText');
        const roleEl = document.getElementById('userRoleText');
        const avatarEl = document.getElementById('userAvatarText');

        if (!nameEl || !emailEl || !roleEl || !avatarEl) return;
        if (user) {
            const email = String(user.email || '');
            const metadata = user.user_metadata || {};
            const accessLevel = window.SmartBaraCore?.getAccessLevel?.() || 'viewer';
            const accessLabels = { superadmin: 'Superadmin', spv: 'SPV', tim: 'Tim', viewer: 'Viewer' };
            nameEl.textContent = metadata.full_name || metadata.fullName || metadata.name || metadata.display_name || email.split('@')[0] || 'Pengguna';
            emailEl.textContent = email || 'Email tidak tersedia';
            roleEl.textContent = `Level akses: ${accessLabels[accessLevel] || 'Viewer'}`;
            avatarEl.textContent = (nameEl.textContent[0] || email[0] || 'A').toUpperCase();
        } else {
            nameEl.textContent = 'Tamu (Guest)';
            emailEl.textContent = 'Belum login';
            roleEl.textContent = 'Level akses: Baca Saja';
            avatarEl.textContent = 'G';
        }
    }

    function syncAuthStateUI() {
        const user = window.SmartBaraCore && typeof window.SmartBaraCore.getUser === 'function' ? window.SmartBaraCore.getUser() : null;
        updateUserProfileUI(user);
    }

    function bindEvents() {
        // Mobile sidebar toggle
        const toggleBtn = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('appSidebar');
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('click', () => toggleSidebar());
        }

        window.addEventListener('resize', () => syncSidebarByViewport());
        document.addEventListener('click', (event) => {
            const sidebar = document.getElementById('appSidebar');
            const toggleBtn = document.getElementById('sidebarToggle');
            const ghostToggle = document.getElementById('sidebarGhostToggle');
            if (!sidebar || !toggleBtn || window.innerWidth >= 1024) return;
            const wasInsideSidebar = sidebar.contains(event.target);
            const wasOnToggle = toggleBtn.contains(event.target) || (ghostToggle && ghostToggle.contains(event.target));
            if (!wasInsideSidebar && !wasOnToggle && sidebarVisible) {
                setSidebarVisible(false);
            }
        });
        syncSidebarByViewport();
        syncAuthStateUI();

        // Period selector in header
        const periodSelect = document.getElementById('periodSelector');
        if (periodSelect) {
            periodSelect.value = window.SmartBaraCore.getActivePeriod();
            periodSelect.addEventListener('change', async (e) => {
                const nextPeriod = e.target.value;
                const taskId = beginLoading('Mengganti periode', `Menyiapkan data periode ${nextPeriod}...`);
                sessionStorage.setItem('smartbara_period_transition', nextPeriod);
                window.SmartBaraCore.setPeriod(nextPeriod);
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                window.location.reload();
            });
        }

        // Auth state updates sidebar user info
        window.addEventListener('smartbara:auth_change', (e) => {
            const activePageId = MENU_ITEMS.find(item => item.href === window.location.pathname.split('/').pop())?.id || 'dashboard';
            renderSidebar(activePageId);
            updateUserProfileUI(e.detail.user);
        });
        syncAuthStateUI();

        // Store loaded: update dept filter label
        window.addEventListener('smartbara:store_loaded', () => {
            updateDeptFilterLabel();
            // Show dept filter button only if there are departments
            const btn = document.getElementById('deptFilterBtn');
            if (btn && window.SmartBaraCore.getDepartments().length > 0) {
                btn.classList.remove('hidden');
            }
        });
    }

    return {
        init: initLayout,
        beginLoading,
        updateLoading,
        endLoading,
        withLoading,
        notify,
        alertDialog,
        confirmDialog,
        openThemePrompt,
        toggleAuthModal,
        handleLogin,
        handleLogout,
        openUploadModal,
        openPeriodManager,
        closePeriodManager,
        addNewPeriod,
        renamePeriod,
        duplicatePeriod,
        requestDeletePeriod,
        cancelDeletePeriod,
        confirmDeletePeriod,
        setAsDefaultPeriod,
        switchToPeriod,
        openDeptFilter,
        closeDeptFilter,
        toggleAllDepts,
        onDeptCheckChange,
        applyDeptFilter,
        setSidebarVisible,
        syncSidebarByViewport,
        toggleSidebar
    };
})();

window.SmartBaraLayout = window.SmartBaraLayout || (() => {});

const nativeBrowserAlert = window.alert ? window.alert.bind(window) : null;
const nativeBrowserConfirm = window.confirm ? window.confirm.bind(window) : null;
window.alert = function(message, ...args) {
    if (window.SmartBaraLayout && typeof window.SmartBaraLayout.alertDialog === 'function') {
        window.SmartBaraLayout.alertDialog({
            title: 'Informasi',
            message: String(message ?? ''),
            confirmText: 'OK'
        });
        return undefined;
    }
    if (nativeBrowserAlert) return nativeBrowserAlert(message, ...args);
    return undefined;
};
window.confirm = function(message, ...args) {
    if (window.SmartBaraLayout && typeof window.SmartBaraLayout.confirmDialog === 'function') {
        return window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi',
            message: String(message ?? ''),
            confirmText: 'Ya',
            cancelText: 'Batal'
        }).then(result => !!result);
    }
    if (nativeBrowserConfirm) return nativeBrowserConfirm(message, ...args);
    return false;
};

window.toggleSidebar = function() {
    if (window.SmartBaraLayout && typeof window.SmartBaraLayout.toggleSidebar === 'function') {
        window.SmartBaraLayout.toggleSidebar();
    }
};
window.setSidebarVisible = function(visible) {
    if (window.SmartBaraLayout && typeof window.SmartBaraLayout.setSidebarVisible === 'function') {
        window.SmartBaraLayout.setSidebarVisible(visible);
    }
};

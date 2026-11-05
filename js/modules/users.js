// ==============================================================================
// SMART BARA 7.10 HZ - USERS & ACCESS ADMINISTRATION MODULE
// User Management, Role-Based Access Control & Active Sessions Tracking
// ==============================================================================

window.UsersModule = (function() {
    let userRecords = [];
    let isSaving = false;

    async function init() {
        ensureToastHost();
        localStorage.removeItem('smartbara_password_reset_cache');
        await loadData();
        bindEvents();
    }

    function ensureToastHost() {
        let host = document.getElementById('smartbaraToastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'smartbaraToastHost';
            host.className = 'smartbara-toast-host';
            document.body.appendChild(host);
        }
        return host;
    }

    function generateTemporaryPassword() {
        if (!window.crypto?.getRandomValues) {
            throw new Error('Browser tidak mendukung generator password yang aman.');
        }

        const characterSets = [
            'ABCDEFGHJKLMNPQRSTUVWXYZ',
            'abcdefghijkmnopqrstuvwxyz',
            '23456789',
            '!@#$%&*?'
        ];
        const allCharacters = characterSets.join('');
        const randomIndex = (max) => {
            const range = 0x100000000;
            const limit = Math.floor(range / max) * max;
            const value = new Uint32Array(1);
            do {
                window.crypto.getRandomValues(value);
            } while (value[0] >= limit);
            return value[0] % max;
        };
        const characters = characterSets.map(set => set[randomIndex(set.length)]);
        while (characters.length < 18) {
            characters.push(allCharacters[randomIndex(allCharacters.length)]);
        }
        for (let i = characters.length - 1; i > 0; i--) {
            const j = randomIndex(i + 1);
            [characters[i], characters[j]] = [characters[j], characters[i]];
        }
        return characters.join('');
    }

    function showToast({ title = 'Informasi', message = '', type = 'success', duration = 2800 } = {}) {
        const host = ensureToastHost();
        const toast = document.createElement('div');
        const iconMap = {
            success: '✓',
            info: 'i',
            warning: '!',
            error: '×'
        };

        toast.className = `smartbara-toast smartbara-toast-${type}`;
        toast.innerHTML = `
            <div class="smartbara-toast-icon">${iconMap[type] || 'i'}</div>
            <div class="smartbara-toast-content">
                <div class="smartbara-toast-title">${SmartBaraFormatters.escapeHtml(title)}</div>
                <div class="smartbara-toast-message">${SmartBaraFormatters.escapeHtml(message)}</div>
            </div>
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

    function normalizeUserRecord(rawUser) {
        if (!rawUser || !rawUser.email) return null;

        const fullName = rawUser.fullName || rawUser.full_name || rawUser.name || rawUser.user_metadata?.full_name || '';
        const department = rawUser.department || rawUser.dept || rawUser.user_metadata?.department || rawUser.user_metadata?.dept || '';
        const roleName = String(rawUser.app_metadata?.role || rawUser.role || rawUser.user_role || 'viewer').toLowerCase();
        const role = String(rawUser.email).toLowerCase() === 'spv.ga@garudamart.com'
            ? 'superadmin'
            : roleName === 'admin' ? 'superadmin' : roleName === 'editor' ? 'tim' : roleName === 'reader' ? 'viewer' : roleName;

        return {
            id: rawUser.id || rawUser.user_id || rawUser.email,
            email: rawUser.email,
            fullName: fullName || rawUser.email.split('@')[0],
            department,
            position: rawUser.position || rawUser.job_title || '',
            role: ['superadmin', 'spv', 'tim', 'viewer'].includes(role) ? role : 'viewer',
            emailConfirmed: rawUser.emailConfirmed ?? rawUser.email_confirmed ?? true,
            lastSignInAt: rawUser.lastSignInAt || rawUser.last_sign_in_at || rawUser.lastSeenAt || new Date().toISOString(),
            activeSessions: Array.isArray(rawUser.activeSessions) ? rawUser.activeSessions : (Array.isArray(rawUser.sessions) ? rawUser.sessions : [])
        };
    }

    async function invokeAdminUsersAction(payload) {
        const { data, error } = await SmartBaraCore.supabase.functions.invoke('admin-users', {
            body: payload
        });
        if (error) {
            let message = error.message;
            try {
                const response = error.context;
                const details = response instanceof Response ? await response.clone().json() : null;
                message = details?.error || details?.message || message;
            } catch(e) {}
            throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
        if (data?.success === false) throw new Error(data.message || 'Permintaan ditolak oleh server.');
        return data;
    }

    async function loadData() {
        const tbody = document.getElementById('adminUsersTableBody');
        const statusEl = document.getElementById('adminUserStatus');
        if (!SmartBaraCore.canManageSettings()) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400">Halaman pengguna hanya dapat diakses Superadmin.</td></tr>';
            if (statusEl) statusEl.textContent = 'Akses Superadmin diperlukan';
            return false;
        }
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">Memuat data pengguna & sesi...</td></tr>';
        if (statusEl) statusEl.textContent = 'Memuat...';

        try {
            const data = await invokeAdminUsersAction({ action: 'list' });
            if (!data || !Array.isArray(data.users)) {
                throw new Error('Respons server tidak berisi daftar pengguna yang valid.');
            }
            userRecords = data.users.map(normalizeUserRecord).filter(Boolean);

            renderTable();
            if (statusEl) {
                const onlineCount = userRecords.filter(u => u.activeSessions && u.activeSessions.length > 0).length;
                statusEl.textContent = `${userRecords.length} pengguna terdaftar · ${onlineCount} online`;
            }
        } catch(err) {
            console.error('Error loading users:', err);
            userRecords = [];
            if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-rose-400">Gagal memuat pengguna: ${SmartBaraFormatters.escapeHtml(err.message)}</td></tr>`;
            if (statusEl) statusEl.textContent = 'Gagal memuat';
            return false;
        }
        return true;
    }

    function renderTable() {
        const tbody = document.getElementById('adminUsersTableBody');
        if (!tbody) return;

        const query = (document.getElementById('adminUserSearch')?.value || '').toLowerCase();
        const roleFilter = document.getElementById('adminUserRoleFilter')?.value || '';

        const filtered = userRecords.filter(u => {
            const matchesQuery = !query ||
                (u.email && u.email.toLowerCase().includes(query)) ||
                (u.fullName && u.fullName.toLowerCase().includes(query)) ||
                (u.department && u.department.toLowerCase().includes(query)) ||
                (u.position && u.position.toLowerCase().includes(query));

            const matchesRole = !roleFilter || u.role === roleFilter;

            return matchesQuery && matchesRole;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">Tidak ada pengguna yang cocok dengan filter pencarian.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(user => {
            const sessions = Array.isArray(user.activeSessions) ? user.activeSessions : [];
            const isOnline = sessions.length > 0;
            const roleBadge = {
                superadmin: '<span class="badge badge-teal">Superadmin</span>',
                spv: '<span class="badge badge-amber">SPV</span>',
                tim: '<span class="badge text-sky-300 border-sky-500/30 bg-sky-500/10">Tim</span>',
                viewer: '<span class="badge text-slate-400 border-white/10 bg-white/5">Viewer</span>'
            }[user.role] || '<span class="badge text-slate-400 border-white/10 bg-white/5">Viewer</span>';

            const presenceMarkup = isOnline
                ? `<div class="flex items-center gap-1.5 text-emerald-400 font-bold text-xs"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>Online (${sessions.length} sesi)</div><div class="text-[10px] text-slate-400 mt-0.5">${sessions.map(s => s.device_label || 'Browser').join(', ')}</div>`
                : `<div class="flex items-center gap-1.5 text-slate-500 text-xs"><span class="w-2 h-2 rounded-full bg-slate-600"></span>Offline</div><div class="text-[10px] text-slate-400 mt-0.5">Login: ${user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString('id-ID') : 'Belum pernah'}</div>`;

            return `
                <tr class="hover:bg-white/5 transition border-b border-white/5">
                    <td class="py-3 px-4">
                        <div class="font-bold text-white">${SmartBaraFormatters.escapeHtml(user.fullName || 'Tanpa Nama')}</div>
                        <div class="text-xs text-teal-400 font-mono mt-0.5">${SmartBaraFormatters.escapeHtml(user.email)}</div>
                    </td>
                    <td class="py-3 px-4">
                        <div class="text-slate-300 font-medium text-xs">${SmartBaraFormatters.escapeHtml(user.department || '-')}</div>
                        <div class="text-slate-500 text-[11px] mt-0.5">${SmartBaraFormatters.escapeHtml(user.position || '-')}</div>
                    </td>
                    <td class="py-3 px-4">${roleBadge}</td>
                    <td class="py-3 px-4">${presenceMarkup}</td>
                    <td class="py-3 px-4 text-right">
                        <div class="flex items-center justify-end gap-2">
                            <button type="button" onclick="UsersModule.openModal('${user.id}')" class="btn btn-secondary text-xs px-2.5 py-1">
                                ✏️ Edit
                            </button>
                            <button type="button" onclick="UsersModule.sendPasswordReset('${user.id}')" class="btn bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 text-xs px-2.5 py-1" title="Reset password dan tampilkan password baru">
                                🔑 Reset
                            </button>
                            <button type="button" onclick="UsersModule.deleteUser('${user.id}')" class="btn bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs px-2 py-1" title="Hapus Pengguna">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function openModal(userId = '') {
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat mengelola akun.', type: 'warning' });
            return;
        }
        const modal = document.getElementById('adminUserModal');
        if (!modal) return;

        const user = userRecords.find(u => u.id === userId) || {
            id: '',
            email: '',
            fullName: '',
            department: '',
            position: '',
            role: 'viewer'
        };

        document.getElementById('adminUserId').value = user.id;
        document.getElementById('adminUserEmail').value = user.email;
        document.getElementById('adminUserFullName').value = user.fullName;
        document.getElementById('adminUserDepartment').value = user.department;
        document.getElementById('adminUserPosition').value = user.position;
        document.getElementById('adminUserRole').value = user.role;
        renderDepartmentOptions(user.department);

        document.getElementById('adminUserModalTitle').textContent = user.id ? 'Edit Pengguna' : 'Undang Pengguna Baru';
        document.getElementById('adminUserSaveButton').textContent = user.id ? 'Simpan Perubahan' : 'Kirim Link Undangan';

        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeModal() {
        const modal = document.getElementById('adminUserModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    function renderDepartmentOptions(currentDepartment = '') {
        const list = document.getElementById('adminUserDepartmentOptions');
        if (!list) return;
        const departments = new Set(window.SmartBaraCore?.getDepartments?.() || []);
        userRecords.forEach(user => {
            if (user.department) departments.add(user.department);
        });
        if (currentDepartment) departments.add(currentDepartment);
        list.innerHTML = [...departments].sort().map(department =>
            `<option value="${SmartBaraFormatters.escapeHtml(department)}"></option>`
        ).join('');
    }

    async function saveUser(e) {
        if (e) e.preventDefault();
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat mengubah level akses.', type: 'warning' });
            return;
        }
        if (isSaving) return;

        const id = document.getElementById('adminUserId').value;
        const email = document.getElementById('adminUserEmail').value.trim();
        const fullName = document.getElementById('adminUserFullName').value.trim();
        const department = document.getElementById('adminUserDepartment').value.trim();
        const position = document.getElementById('adminUserPosition').value.trim();
        const role = email.toLowerCase() === 'spv.ga@garudamart.com'
            ? 'superadmin'
            : document.getElementById('adminUserRole').value;

        if (!email) {
            showToast({ title: 'Peringatan', message: 'Email wajib diisi.', type: 'warning' });
            return;
        }
        const button = document.getElementById('adminUserSaveButton');
        const buttonText = button.textContent;
        isSaving = true;
        button.disabled = true;
        button.textContent = 'Menyimpan...';
        try {
            await invokeAdminUsersAction({
                action: id ? 'update' : 'create',
                userId: id,
                email,
                fullName,
                department,
                position,
                role
            });
            closeModal();
            const refreshed = await loadData();
            if (refreshed) {
                showToast({
                    title: id ? 'Profil berhasil diperbarui' : 'Undangan terkirim',
                    message: id ? 'Perubahan pengguna berhasil disimpan ke server.' : `Link undangan untuk ${email} berhasil dikirim melalui email.`,
                    type: 'success'
                });
            } else {
                showToast({
                    title: 'Tersimpan, daftar belum diperbarui',
                    message: 'Server menerima perubahan, tetapi daftar pengguna gagal dimuat ulang. Tekan Muat Ulang.',
                    type: 'warning',
                    duration: 5000
                });
            }
        } catch(err) {
            console.error('User save error:', err);
            showToast({
                title: 'Gagal menyimpan',
                message: err.message || 'Perubahan tidak berhasil disimpan ke server.',
                type: 'error',
                duration: 4200
            });
        } finally {
            isSaving = false;
            button.disabled = false;
            button.textContent = id ? buttonText : 'Kirim Link Undangan';
        }
    }

    async function deleteUser(userId) {
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat menghapus akun.', type: 'warning' });
            return;
        }
        const user = userRecords.find(u => u.id === userId);
        if (!user) return;

        if (user.id === SmartBaraCore.getUser()?.id || String(user.email).toLowerCase() === 'spv.ga@garudamart.com') {
            showToast({ title: 'Aksi ditolak', message: 'Akun aktif dan Superadmin default tidak dapat dihapus.', type: 'warning' });
            return;
        }

        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Konfirmasi hapus pengguna',
            message: `Hapus pengguna "${user.fullName || user.email}"?`,
            confirmText: 'Hapus',
            cancelText: 'Batal',
            danger: true
        });
        if (!confirmed) return;

        try {
            await invokeAdminUsersAction({ action: 'delete', userId });
            userRecords = userRecords.filter(u => u.id !== userId);
            renderTable();
            showToast({ title: 'Pengguna dihapus', message: `${user.fullName || user.email} berhasil dihapus.`, type: 'success' });
        } catch(err) {
            console.error('User delete error:', err);
            showToast({ title: 'Gagal menghapus', message: err.message || 'Pengguna tidak berhasil dihapus.', type: 'error' });
        }
    }

    function openPasswordResetModal(userId = '') {
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat mereset password.', type: 'warning' });
            return;
        }
        const user = userRecords.find(u => u.id === userId) || userRecords[0];
        if (!user) return;

        const modal = document.getElementById('adminPasswordResetModal');
        if (!modal) return;

        let password;
        try {
            password = generateTemporaryPassword();
        } catch(err) {
            showToast({ title: 'Tidak dapat membuat password', message: err.message, type: 'error' });
            return;
        }
        document.getElementById('resetPasswordUserId').value = user.id;
        document.getElementById('resetPasswordEmail').value = user.email;
        document.getElementById('resetPasswordValue').value = password;
        document.getElementById('resetPasswordStatus').textContent = `Reset password untuk ${user.fullName || user.email}`;
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    async function sendPasswordReset(userId) {
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat mereset password.', type: 'warning' });
            return;
        }
        const user = userRecords.find(u => u.id === userId);
        if (!user) return;

        try {
            const generatedPassword = generateTemporaryPassword();
            const payload = {
                action: 'reset-password',
                userId: user.id,
                email: user.email,
                password: generatedPassword
            };

            const result = await invokeAdminUsersAction(payload);
            if (!result) {
                throw new Error('Server tidak mengonfirmasi reset password.');
            }

            document.getElementById('resetPasswordUserId').value = user.id;
            document.getElementById('resetPasswordEmail').value = user.email;
            document.getElementById('resetPasswordValue').value = generatedPassword;
            document.getElementById('resetPasswordStatus').textContent = `Reset password untuk ${user.fullName || user.email}`;
            const modal = document.getElementById('adminPasswordResetModal');
            if (modal) {
                modal.classList.remove('hidden');
                setTimeout(() => modal.classList.remove('opacity-0'), 10);
            }

            showToast({
                title: 'Password baru dibuat',
                message: `Password sementara untuk ${user.email} berhasil dibuat. Silakan lihat detail di popup reset password.`,
                type: 'success'
            });
        } catch(err) {
            console.error('Password reset error:', err);
            showToast({ title: 'Reset gagal', message: 'Gagal membuat password sementara: ' + (err.message || err), type: 'error' });
        }
    }

    async function copyResetPassword() {
        const input = document.getElementById('resetPasswordValue');
        if (!input) return;
        try {
            await navigator.clipboard.writeText(input.value);
            showToast({ title: 'Tersalin', message: 'Password sementara berhasil disalin ke clipboard.', type: 'info' });
        } catch (err) {
            input.focus();
            input.select();
            if (document.execCommand('copy')) {
                showToast({ title: 'Tersalin', message: 'Password sementara berhasil disalin.', type: 'info' });
            } else {
                showToast({ title: 'Siap disalin', message: 'Password sudah dipilih. Silakan salin secara manual.', type: 'warning' });
            }
        }
    }

    function closePasswordResetModal() {
        const modal = document.getElementById('adminPasswordResetModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    function bindEvents() {}

    return {
        init,
        loadData,
        renderTable,
        openModal,
        closeModal,
        saveUser,
        deleteUser,
        openPasswordResetModal,
        sendPasswordReset,
        copyResetPassword,
        closePasswordResetModal,
        showToast
    };
})();

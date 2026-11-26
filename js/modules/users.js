// ==============================================================================
// SMART BARA 7.10 HZ - USERS & ACCESS ADMINISTRATION MODULE
// Akun dikelola platform Lourdes (monitoring.lourdes.cloud/pengguna): app ini TIDAK membuat,
// menghapus, atau mereset password akun. Di sini admin Smart BARA hanya mengatur:
//   - akses app (public.app_access, app_id 'smartbara'): admin / editor / viewer
//   - data khusus Smart BARA (smartbara.members): penanda SPV dan departemen default
// Pemetaan level: superadmin = admin, spv = editor + is_spv, tim = editor, viewer = viewer.
// ==============================================================================

window.UsersModule = (function() {
    const APP_ID = window.SMART_BARA_CONFIG.APP_ID || 'smartbara';
    const LEVELS = ['superadmin', 'spv', 'tim', 'viewer'];
    let userRecords = [];
    let isSaving = false;

    const escapeHtml = value => SmartBaraFormatters.escapeHtml(value);

    async function init() {
        ensureToastHost();
        localStorage.removeItem('smartbara_password_reset_cache');
        const link = document.getElementById('platformUsersLink');
        if (link) link.href = window.SMART_BARA_CONFIG.PLATFORM_USERS_URL;
        await loadData();
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

    function showToast({ title = 'Informasi', message = '', type = 'success', duration = 2800 } = {}) {
        const host = ensureToastHost();
        const toast = document.createElement('div');
        const iconMap = { success: '✓', info: 'i', warning: '!', error: '×' };

        toast.className = `smartbara-toast smartbara-toast-${type}`;
        toast.innerHTML = `
            <div class="smartbara-toast-icon">${iconMap[type] || 'i'}</div>
            <div class="smartbara-toast-content">
                <div class="smartbara-toast-title">${escapeHtml(title)}</div>
                <div class="smartbara-toast-message">${escapeHtml(message)}</div>
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

    function client() {
        const supabase = SmartBaraCore.supabase;
        if (!supabase) throw new Error('Koneksi Supabase belum tersedia.');
        return supabase;
    }

    function toLevel(appRole, isSpv) {
        if (appRole === 'admin') return 'superadmin';
        if (appRole === 'editor') return isSpv ? 'spv' : 'tim';
        return 'viewer';
    }

    function toAppRole(level) {
        if (level === 'superadmin') return 'admin';
        if (level === 'spv' || level === 'tim') return 'editor';
        return 'viewer';
    }

    async function loadData() {
        const tbody = document.getElementById('adminUsersTableBody');
        const statusEl = document.getElementById('adminUserStatus');
        if (!SmartBaraCore.canManageSettings()) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400">Halaman pengguna hanya dapat diakses Superadmin.</td></tr>';
            if (statusEl) statusEl.textContent = 'Akses Superadmin diperlukan';
            return false;
        }
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">Memuat data pengguna...</td></tr>';
        if (statusEl) statusEl.textContent = 'Memuat...';

        try {
            const supabase = client();
            const { data: access, error: accessError } = await supabase.schema('public')
                .from('app_access').select('user_id, role, granted_at').eq('app_id', APP_ID);
            if (accessError) throw accessError;

            const ids = (access || []).map(row => row.user_id);
            let profiles = [];
            let members = [];
            if (ids.length) {
                const [profileResult, memberResult] = await Promise.all([
                    supabase.schema('public').from('profiles')
                        .select('id, full_name, email, is_active, department:departments(name), job_title:job_titles(name)')
                        .in('id', ids),
                    supabase.from('members').select('user_id, is_spv, department').in('user_id', ids)
                ]);
                if (profileResult.error) throw profileResult.error;
                if (memberResult.error) throw memberResult.error;
                profiles = profileResult.data || [];
                members = memberResult.data || [];
            }

            const profileById = new Map(profiles.map(p => [p.id, p]));
            const memberById = new Map(members.map(m => [m.user_id, m]));
            userRecords = (access || []).map(row => {
                const profile = profileById.get(row.user_id) || {};
                const member = memberById.get(row.user_id) || {};
                return {
                    id: row.user_id,
                    email: profile.email || '',
                    fullName: profile.full_name || '',
                    isActive: profile.is_active !== false,
                    department: member.department || '',
                    platformDepartment: profile.department?.name || '',
                    position: profile.job_title?.name || '',
                    role: toLevel(row.role, member.is_spv === true),
                    grantedAt: row.granted_at
                };
            }).sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email, 'id'));

            renderTable();
            if (statusEl) statusEl.textContent = `${userRecords.length} pengguna punya akses Smart BARA`;
        } catch(err) {
            console.error('Error loading users:', err);
            userRecords = [];
            if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-rose-400">Gagal memuat pengguna: ${escapeHtml(err.message)}</td></tr>`;
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
                [u.email, u.fullName, u.department, u.platformDepartment, u.position]
                    .some(value => value && value.toLowerCase().includes(query));
            return matchesQuery && (!roleFilter || u.role === roleFilter);
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">Tidak ada pengguna yang cocok dengan filter pencarian.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(user => {
            const roleBadge = {
                superadmin: '<span class="badge badge-teal">Superadmin</span>',
                spv: '<span class="badge badge-amber">SPV</span>',
                tim: '<span class="badge text-sky-300 border-sky-500/30 bg-sky-500/10">Tim</span>',
                viewer: '<span class="badge text-slate-400 border-white/10 bg-white/5">Viewer</span>'
            }[user.role];
            const statusMarkup = user.isActive
                ? '<div class="flex items-center gap-1.5 text-emerald-400 text-xs"><span class="w-2 h-2 rounded-full bg-emerald-400"></span>Akun aktif</div>'
                : '<div class="flex items-center gap-1.5 text-rose-400 text-xs"><span class="w-2 h-2 rounded-full bg-rose-400"></span>Akun dinonaktifkan</div>';
            const grantedMarkup = user.grantedAt
                ? `<div class="text-[10px] text-slate-400 mt-0.5">Akses sejak ${escapeHtml(new Date(user.grantedAt).toLocaleDateString('id-ID'))}</div>`
                : '';

            return `
                <tr class="hover:bg-white/5 transition border-b border-white/5">
                    <td class="py-3 px-4">
                        <div class="font-bold text-white">${escapeHtml(user.fullName || 'Tanpa Nama')}</div>
                        <div class="text-xs text-teal-400 font-mono mt-0.5">${escapeHtml(user.email || user.id)}</div>
                    </td>
                    <td class="py-3 px-4">
                        <div class="text-slate-300 font-medium text-xs">${escapeHtml(user.department || user.platformDepartment || '-')}</div>
                        <div class="text-slate-500 text-[11px] mt-0.5">${escapeHtml(user.position || '-')}</div>
                    </td>
                    <td class="py-3 px-4">${roleBadge}</td>
                    <td class="py-3 px-4">${statusMarkup}${grantedMarkup}</td>
                    <td class="py-3 px-4 text-right">
                        <div class="flex items-center justify-end gap-2">
                            <button type="button" onclick="UsersModule.openModal('${escapeHtml(user.id)}')" class="btn btn-secondary text-xs px-2.5 py-1">✏️ Edit</button>
                            <button type="button" onclick="UsersModule.revokeAccess('${escapeHtml(user.id)}')" class="btn bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs px-2 py-1" title="Cabut akses Smart BARA">Cabut</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function openModal(userId = '') {
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat mengatur akses.', type: 'warning' });
            return;
        }
        const modal = document.getElementById('adminUserModal');
        if (!modal) return;

        const user = userRecords.find(u => u.id === userId) || {
            id: '', email: '', fullName: '', department: '', position: '', role: 'viewer'
        };
        const isNew = !user.id;

        document.getElementById('adminUserId').value = user.id;
        const emailInput = document.getElementById('adminUserEmail');
        emailInput.value = user.email;
        emailInput.readOnly = !isNew;
        document.getElementById('adminUserFullName').value = user.fullName || (isNew ? '' : '-');
        document.getElementById('adminUserDepartment').value = user.department;
        document.getElementById('adminUserPosition').value = user.position || '';
        document.getElementById('adminUserRole').value = user.role;
        renderDepartmentOptions(user.department);

        document.getElementById('adminUserModalTitle').textContent = isNew ? 'Beri Akses Smart BARA' : 'Edit Akses Pengguna';
        document.getElementById('adminUserSaveButton').textContent = isNew ? 'Beri Akses' : 'Simpan Perubahan';

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
        userRecords.forEach(user => { if (user.department) departments.add(user.department); });
        if (currentDepartment) departments.add(currentDepartment);
        list.innerHTML = [...departments].sort().map(department =>
            `<option value="${escapeHtml(department)}"></option>`
        ).join('');
    }

    async function findProfileByEmail(email) {
        const { data, error } = await client().schema('public').from('profiles')
            .select('id, email, full_name, is_active').ilike('email', email).limit(2);
        if (error) throw error;
        const match = (data || []).find(p => String(p.email || '').toLowerCase() === email.toLowerCase());
        if (!match) {
            throw new Error(`Akun ${email} belum ada di Lourdes. Minta platform admin membuatnya di konsol pengguna Lourdes, lalu beri akses di sini.`);
        }
        return match;
    }

    async function saveUser(e) {
        if (e) e.preventDefault();
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat mengubah level akses.', type: 'warning' });
            return;
        }
        if (isSaving) return;

        let userId = document.getElementById('adminUserId').value;
        const isNew = !userId;
        const email = document.getElementById('adminUserEmail').value.trim();
        const department = document.getElementById('adminUserDepartment').value.trim();
        const level = document.getElementById('adminUserRole').value;
        if (!LEVELS.includes(level)) return;
        if (isNew && !email) {
            showToast({ title: 'Peringatan', message: 'Email wajib diisi.', type: 'warning' });
            return;
        }
        if (!isNew && userId === SmartBaraCore.getUser()?.id && level !== 'superadmin') {
            showToast({ title: 'Aksi ditolak', message: 'Anda tidak dapat menurunkan level akses akun sendiri.', type: 'warning' });
            return;
        }

        const button = document.getElementById('adminUserSaveButton');
        const buttonText = button.textContent;
        isSaving = true;
        button.disabled = true;
        button.textContent = 'Menyimpan...';
        try {
            const supabase = client();
            if (isNew) {
                const profile = await findProfileByEmail(email);
                if (userRecords.some(u => u.id === profile.id)) throw new Error(`${email} sudah punya akses Smart BARA.`);
                userId = profile.id;
                const { error } = await supabase.schema('public').from('app_access')
                    .insert({ user_id: userId, app_id: APP_ID, role: toAppRole(level), granted_by: SmartBaraCore.getUser()?.id || null });
                if (error) throw error;
            } else {
                const { error } = await supabase.schema('public').from('app_access')
                    .update({ role: toAppRole(level) }).eq('user_id', userId).eq('app_id', APP_ID);
                if (error) throw error;
            }
            const { error: memberError } = await supabase.from('members')
                .upsert({ user_id: userId, is_spv: level === 'spv', department: department || null }, { onConflict: 'user_id' });
            if (memberError) throw memberError;

            closeModal();
            await loadData();
            showToast({
                title: isNew ? 'Akses diberikan' : 'Akses diperbarui',
                message: isNew ? `${email} sekarang bisa masuk Smart BARA.` : 'Perubahan akses berhasil disimpan.',
                type: 'success'
            });
        } catch(err) {
            console.error('User save error:', err);
            showToast({ title: 'Gagal menyimpan', message: err.message || 'Perubahan tidak berhasil disimpan.', type: 'error', duration: 5200 });
        } finally {
            isSaving = false;
            button.disabled = false;
            button.textContent = buttonText;
        }
    }

    async function revokeAccess(userId) {
        if (!SmartBaraCore.canManageSettings()) {
            showToast({ title: 'Akses ditolak', message: 'Hanya Superadmin yang dapat mencabut akses.', type: 'warning' });
            return;
        }
        const user = userRecords.find(u => u.id === userId);
        if (!user) return;
        if (user.id === SmartBaraCore.getUser()?.id) {
            showToast({ title: 'Aksi ditolak', message: 'Akses akun yang sedang dipakai tidak dapat dicabut.', type: 'warning' });
            return;
        }

        const confirmed = await window.SmartBaraLayout.confirmDialog({
            title: 'Cabut akses Smart BARA',
            message: `Cabut akses Smart BARA untuk "${user.fullName || user.email}"? Akun Lourdes-nya tetap ada dan app lain tidak terpengaruh.`,
            confirmText: 'Cabut Akses',
            cancelText: 'Batal',
            danger: true
        });
        if (!confirmed) return;

        try {
            const supabase = client();
            const { error } = await supabase.schema('public').from('app_access').delete().eq('user_id', userId).eq('app_id', APP_ID);
            if (error) throw error;
            await supabase.from('members').delete().eq('user_id', userId);
            userRecords = userRecords.filter(u => u.id !== userId);
            renderTable();
            showToast({ title: 'Akses dicabut', message: `${user.fullName || user.email} tidak lagi bisa masuk Smart BARA.`, type: 'success' });
        } catch(err) {
            console.error('Revoke access error:', err);
            showToast({ title: 'Gagal mencabut akses', message: err.message || 'Akses tidak berhasil dicabut.', type: 'error' });
        }
    }

    return {
        init,
        loadData,
        renderTable,
        openModal,
        closeModal,
        saveUser,
        revokeAccess,
        showToast
    };
})();

// ==============================================================================
// SMART BARA 7.10 HZ - MULTI-FILE & MULTI-DEPARTMENT EXCEL UPLOAD MODULE
// High-Speed Sheet Extraction, Department Mapping & Supabase Sync
// ==============================================================================

window.SmartBaraUpload = (function() {
    let selectedFiles = []; // [ { file, name, deptName, sheets: [], selectedSheet, workbook } ]
    let isProcessing = false;
    let budgetReferenceRows = [];
    let budgetReferenceError = '';
    let budgetReferenceKey = '';
    let budgetReferenceNeedsCloudMigration = false;
    let previewTableOpen = false;
    let headerMappingFileId = '';

    const REPORT_HEADER_FIELDS = [
        { key: 'date', label: 'Tanggal', required: true, aliases: ['tanggal', 'tgl', 'date'] },
        { key: 'source', label: 'No. Sumber', required: false, aliases: ['no sumber', 'nomor sumber', 'no voucher', 'no bukti', 'referensi', 'reference', 'ref'] },
        { key: 'account', label: 'Nama Akun', required: true, aliases: ['nama akun up', 'nama akun induk', 'nama akun', 'account name', 'akun'] },
        { key: 'project', label: 'Nama Proyek UP', required: false, aliases: ['nama proyek up', 'proyek up', 'nama proyek', 'project name', 'proyek', 'project'] },
        { key: 'description', label: 'Keterangan', required: false, aliases: ['keterangan', 'deskripsi', 'uraian', 'rincian', 'memo'] },
        { key: 'debit', label: 'Debit', required: true, aliases: ['debit', 'debet'] },
        { key: 'credit', label: 'Kredit', required: true, aliases: ['kredit', 'credit'] },
        { key: 'finance', label: 'Finance', required: false, aliases: ['finance', 'nilai finance', 'keuangan', 'sistem'] },
        { key: 'reconcile', label: 'Nilai Rekonsil', required: false, aliases: ['nilai rekonsil', 'nilai rekonsiliasi', 'nilai rekon', 'rekonsil', 'reconcile'] },
        { key: 'note', label: 'Catatan', required: false, aliases: ['catatan', 'note', 'koreksi'] },
        { key: 'month', label: 'Bulan', required: false, aliases: ['bulan', 'month', 'periode bulan', 'bulan transaksi', 'month name'] }
    ];
    const BUDGET_MONTHS = [
        { key: 'jan', label: 'Budget Januari', aliases: ['bgt jan', 'budget jan', 'anggaran jan'] },
        { key: 'feb', label: 'Budget Februari', aliases: ['bgt feb', 'budget feb', 'anggaran feb'] },
        { key: 'mar', label: 'Budget Maret', aliases: ['bgt mar', 'budget mar', 'anggaran mar'] },
        { key: 'apr', label: 'Budget April', aliases: ['bgt apr', 'budget apr', 'anggaran apr'] },
        { key: 'mei', label: 'Budget Mei', aliases: ['bgt mei', 'bgt may', 'budget mei', 'budget may'] },
        { key: 'jun', label: 'Budget Juni', aliases: ['bgt jun', 'budget jun', 'anggaran jun'] },
        { key: 'jul', label: 'Budget Juli', aliases: ['bgt jul', 'budget jul', 'anggaran jul'] },
        { key: 'agu', label: 'Budget Agustus', aliases: ['bgt agu', 'bgt ags', 'bgt agt', 'bgt aug', 'budget agu', 'budget agt', 'budget aug'] },
        { key: 'sep', label: 'Budget September', aliases: ['bgt sep', 'budget sep', 'anggaran sep'] },
        { key: 'okt', label: 'Budget Oktober', aliases: ['bgt okt', 'bgt oct', 'budget okt', 'budget oct'] },
        { key: 'nov', label: 'Budget November', aliases: ['bgt nov', 'budget nov', 'anggaran nov'] },
        { key: 'des', label: 'Budget Desember', aliases: ['bgt des', 'bgt dec', 'budget des', 'budget dec'] }
    ];

    function normalizeHeader(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function getMonthFromText(value) {
        const periodText = String(value || '').trim().toLowerCase();
        const monthAliases = [
            ['januari', 'jan'], ['februari', 'feb'], ['maret', 'mar'], ['april', 'apr'],
            ['mei', 'may'], ['juni', 'jun'], ['juli', 'jul'], ['agustus', 'agu', 'agt', 'agst', 'agts', 'aug'],
            ['september', 'sep'], ['oktober', 'okt', 'oct'], ['november', 'nov'], ['desember', 'des', 'dec']
        ];
        const tokens = periodText.split(/[^a-z]+/).filter(Boolean);
        const index = monthAliases.findIndex(aliases => aliases.some(alias => tokens.includes(alias)));
        return index >= 0 ? String(index + 1).padStart(2, '0') : '';
    }

    function getPeriodMonth(period = SmartBaraCore.getActivePeriod()) {
        return getMonthFromText(period);
    }

    function getUploadTargetMonth(fileName = '') {
        return document.getElementById('uploadTargetMonth')?.value || getMonthFromText(fileName) || getPeriodMonth();
    }

    function getUploadTargetPeriod() {
        const selected = String(document.getElementById('periodSelector')?.value || SmartBaraCore.getActivePeriod() || '').trim();
        return selected || SmartBaraCore.getActivePeriod();
    }

    function getUploadPeriodIssue(selectedMonth = getUploadTargetMonth()) {
        return '';
    }

    function detectTransactionSheet(workbook, preferredMonth = getUploadTargetMonth()) {
        const targetMonth = Number(preferredMonth || getUploadTargetMonth());
        const monthTokens = {
            1: ['JAN', 'JANUARI'], 2: ['FEB', 'FEBRUARI'], 3: ['MAR', 'MARET'], 4: ['APR', 'APRIL'],
            5: ['MEI', 'MAY'], 6: ['JUN', 'JUNI'], 7: ['JUL', 'JULI'], 8: ['AGU', 'AGT', 'AUG', 'AGUSTUS'],
            9: ['SEP', 'SEPTEMBER'], 10: ['OKT', 'OCT', 'OKTOBER'], 11: ['NOV', 'NOVEMBER'], 12: ['DES', 'DEC', 'DESEMBER']
        }[targetMonth] || [];
        let bestSheet = workbook.SheetNames[0] || '';
        let bestScore = -1;

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet?.['!ref']) return;
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false }).slice(0, 12);
            let score = 0;
            rows.forEach(row => {
                const headers = row.map(normalizeHeader).filter(Boolean);
                const has = names => headers.some(header => names.includes(header));
                const hasDate = has(['tanggal', 'date']);
                const hasDebit = has(['debit', 'debet']);
                const hasCredit = has(['kredit', 'credit']);
                if (hasDate) score += 2;
                if (hasDebit) score += 2;
                if (hasCredit) score += 2;
                if (has(['namaakun', 'namaakuninduk', 'akun'])) score += 2;
                if (has(['namaproyekup', 'namaproyek', 'proyek', 'project'])) score += 2;
                if (has(['nosumber', 'nilairekonsil', 'rekonsil'])) score += 1;
                if (hasDate && hasDebit && hasCredit) score += 20;
            });

            const normalizedSheet = normalizeHeader(sheetName).toUpperCase();
            if (targetMonth && (normalizedSheet.endsWith(String(targetMonth).padStart(2, '0')) || monthTokens.some(token => normalizedSheet.includes(token)))) score += 10;
            const currentRange = XLSX.utils.decode_range(sheet['!ref']);
            const rowCount = currentRange.e.r - currentRange.s.r + 1;
            score += Math.min(rowCount / 100000, 0.1);
            if (score > bestScore) {
                bestScore = score;
                bestSheet = sheetName;
            }
        });
        return bestSheet;
    }

    function findBudgetMonth(header) {
        const normalized = normalizeHeader(header);
        const monthAliases = [
            ['jan', 'januari', 'january'], ['feb', 'februari', 'february'], ['mar', 'maret', 'march'],
            ['apr', 'april'], ['mei', 'may'], ['jun', 'juni', 'june'], ['jul', 'juli', 'july'],
            ['agu', 'ags', 'agt', 'agst', 'agts', 'aug', 'agustus', 'august'],
            ['sep', 'sept', 'september'], ['okt', 'oct', 'oktober', 'october'],
            ['nov', 'november'], ['des', 'dec', 'desember', 'december']
        ];
        for (let monthIndex = 0; monthIndex < monthAliases.length; monthIndex++) {
            const matches = monthAliases[monthIndex].some(alias => ['bgt', 'budget', 'anggaran'].some(prefix => {
                const suffix = normalized.slice(`${prefix}${alias}`.length);
                return normalized.startsWith(`${prefix}${alias}`) && (suffix === '' || /^\d{2}(?:\d{2})?$/.test(suffix));
            }));
            if (matches) return monthIndex;
        }
        return -1;
    }

    function getBudgetBlocks(workbook, sheetName) {
        const sheet = workbook?.Sheets?.[sheetName];
        if (!sheet?.['!ref']) return { blocks: [], allHeaders: [] };
        const columnOffset = XLSX.utils.decode_range(sheet['!ref']).s.c;
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });
        const allHeaders = [];
        matrix.forEach((row, rowIndex) => {
            const headers = row.map(value => String(value ?? '').trim());
            const nameColumn = headers.findIndex(value => ['description', 'row labels', 'nama akun up', 'nama akun induk', 'nama akun', 'account name', 'akun', 'nama proyek', 'nama proyek up', 'project name', 'proyek up', 'proyek', 'project'].includes(normalizeHeader(value)));
            const monthColumns = headers.map((header, columnIndex) => ({ columnIndex, monthIndex: findBudgetMonth(header), header }))
                .filter(column => column.monthIndex >= 0);
            if (nameColumn < 0 || !monthColumns.length) return;
            allHeaders.push({ rowIndex, headers, nameColumn, monthColumns, columnOffset });
        });

        const blocks = allHeaders.filter(header => new Set(header.monthColumns.map(column => column.monthIndex)).size > 0)
            .map((header, index, candidates) => {
                const nextHeader = allHeaders.find(candidate => candidate.rowIndex > header.rowIndex);
                const before = matrix.slice(Math.max(0, header.rowIndex - 2), header.rowIndex).flat().map(value => String(value || '').trim()).filter(Boolean).join(' ');
                return {
                    ...header,
                    endRowIndex: nextHeader?.rowIndex ?? matrix.length,
                    candidateIndex: index,
                    revisionLabel: /revisi|revisi budget/i.test(before) ? before : '',
                    isLatest: index === candidates.length - 1
                };
            });
        return { blocks, allHeaders, matrix };
    }

    function detectBudgetSheet(workbook) {
        let bestSheet = '';
        let bestScore = -1;
        (workbook?.SheetNames || []).forEach(sheetName => {
            const { blocks } = getBudgetBlocks(workbook, sheetName);
            if (!blocks.length) return;
            const block = blocks[blocks.length - 1];
            const rows = block.endRowIndex - block.rowIndex;
            const isYearToDateSheet = /^(?:bgt|budget)ytd/.test(normalizeHeader(sheetName));
            const score = (isYearToDateSheet ? 1000 : 0) + block.monthColumns.length * 10 + Math.min(rows / 1000, 1);
            if (score > bestScore) {
                bestScore = score;
                bestSheet = sheetName;
            }
        });
        return bestSheet;
    }

    function getUploadType() {
        return document.querySelector('input[name="uploadDataType"]:checked')?.value || 'report';
    }

    function getBudgetKind() {
        return document.getElementById('uploadBudgetKind')?.value || 'account';
    }

    async function loadBudgetReference(force = false) {
        const period = SmartBaraCore.getActivePeriod();
        const kind = getBudgetKind();
        const tableName = kind === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
        const localKey = kind === 'site' ? `smartbara_budget_site_v2_${period}` : `smartbara_budget_v2_${period}`;
        const cacheKey = `${tableName}:${period}`;
        if (!force && budgetReferenceKey === cacheKey) return budgetReferenceRows;

        budgetReferenceError = '';
        budgetReferenceNeedsCloudMigration = false;
        const status = document.getElementById('uploadBudgetSourceStatus');
        if (status) status.textContent = 'Memuat budget tersimpan...';
        try {
            const client = SmartBaraCore.getClient();
            if (!client) throw new Error('Koneksi cloud tidak tersedia.');
            const { data, error } = await client.from(tableName).select('*').eq('period_name', period);
            if (error) throw error;
            budgetReferenceRows = Array.isArray(data) ? data : [];
            if (!budgetReferenceRows.length) {
                try {
                    const cached = JSON.parse(localStorage.getItem(localKey) || '[]');
                    if (Array.isArray(cached)) {
                        budgetReferenceRows = cached;
                        budgetReferenceNeedsCloudMigration = cached.length > 0;
                    }
                } catch(e) {}
            }
            budgetReferenceKey = cacheKey;
            if (status) status.textContent = `${budgetReferenceRows.length} baris budget tersimpan`;
        } catch(error) {
            budgetReferenceError = error.message || 'Gagal membaca budget tersimpan.';
            budgetReferenceRows = [];
            budgetReferenceKey = '';
            if (status) status.textContent = budgetReferenceError;
        }
        return budgetReferenceRows;
    }

    async function onDataTypeChange() {
        const type = getUploadType();
        const isBudget = type === 'budget';
        document.getElementById('uploadReportModeControls')?.classList.toggle('hidden', isBudget);
        document.getElementById('uploadBudgetTypeControls')?.classList.toggle('hidden', !isBudget);
        document.getElementById('uploadBudgetTypeControls')?.classList.toggle('flex', isBudget);
        const title = document.getElementById('uploadModalTitle');
        if (title) title.textContent = isBudget ? 'Upload Budget Bulanan' : 'Upload Laporan Excel Multi Departemen';
        const notice = document.getElementById('uploadBudgetModeNotice');
        if (notice) {
            notice.classList.toggle('hidden', !isBudget);
            notice.textContent = isBudget
                ? 'Budget mengambil hanya kolom Bgt bulanan pada blok budget yang terdeteksi. Nilai actual/YTD dan subtotal tidak diimpor. Bulan yang tidak ada di file dipertahankan. Baris duplikat/ambigu tidak akan diterapkan otomatis.'
                : '';
        }
        if (selectedFiles.length) {
            selectedFiles.forEach(item => {
                const detected = isBudget ? detectBudgetSheet(item.workbook) : detectTransactionSheet(item.workbook, getUploadTargetMonth(item.name));
                if (detected) item.selectedSheet = detected;
                item.headerMappings[type] = null;
                item.reportHeaderRow = null;
                item.budgetHeaderRow = null;
                item.dataStartRow = undefined;
                item.dataEndRow = undefined;
            });
            renderFileList();
        }
        if (isBudget) await loadBudgetReference(true);
        refreshPreview();
    }

    async function onBudgetKindChange() {
        budgetReferenceKey = '';
        await loadBudgetReference(true);
        refreshPreview();
    }

    function toggleTablePreview() {
        previewTableOpen = !previewTableOpen;
        const wrap = document.getElementById('uploadPreviewTableWrap');
        const button = document.getElementById('uploadPreviewToggleButton');
        wrap?.classList.toggle('hidden', !previewTableOpen);
        if (button) {
            button.textContent = previewTableOpen ? 'Tutup preview' : 'Preview tabel';
            button.setAttribute('aria-expanded', String(previewTableOpen));
        }
    }

    function openModal() {
        const modal = document.getElementById('globalUploadModal');
        if (!modal) return;

        const periodEl = document.getElementById('uploadTargetPeriodText');
        if (periodEl) periodEl.textContent = SmartBaraCore.getActivePeriod();

        selectedFiles = [];
        renderFileList();

        const fileInput = document.getElementById('uploadFileInput');
        if (fileInput) fileInput.value = '';
        const monthInput = document.getElementById('uploadTargetMonth');
        if (monthInput) {
            monthInput.value = getPeriodMonth();
            monthInput.dataset.userSelected = 'false';
        }
        const reportType = document.querySelector('input[name="uploadDataType"][value="report"]');
        if (reportType) reportType.checked = true;
        document.getElementById('uploadReportModeControls')?.classList.remove('hidden');
        document.getElementById('uploadBudgetTypeControls')?.classList.add('hidden');
        const modalTitle = document.getElementById('uploadModalTitle');
        if (modalTitle) modalTitle.textContent = 'Upload Laporan Excel Multi Departemen';
        const budgetNotice = document.getElementById('uploadBudgetModeNotice');
        if (budgetNotice) budgetNotice.classList.add('hidden');
        previewTableOpen = false;
        document.getElementById('uploadPreviewTableWrap')?.classList.add('hidden');
        const previewButton = document.getElementById('uploadPreviewToggleButton');
        if (previewButton) {
            previewButton.textContent = 'Preview tabel';
            previewButton.setAttribute('aria-expanded', 'false');
        }
        const updateMode = document.querySelector('input[name="uploadMode"][value="update"]');
        if (updateMode) updateMode.checked = true;
        refreshPreview();

        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeModal() {
        const modal = document.getElementById('globalUploadModal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    async function handleFileSelect(event) {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        await SmartBaraConfig.ensureLibrary('sheetjs');
        if (typeof XLSX === 'undefined') {
            alert('Library Excel (SheetJS) sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        const progressArea = document.getElementById('uploadProgressArea');
        if (progressArea) progressArea.classList.remove('hidden');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true });
                const sheets = workbook.SheetNames || [];
                const defaultDept = detectDeptFromFileName(file.name);
                const monthInput = document.getElementById('uploadTargetMonth');
                const fileMonth = getMonthFromText(file.name);
                if (monthInput && fileMonth && monthInput.dataset.userSelected !== 'true') monthInput.value = fileMonth;
                const targetMonth = getUploadTargetMonth(file.name);

                selectedFiles.push({
                    id: 'F_' + Math.random().toString(36).substr(2, 9),
                    file: file,
                    name: file.name,
                    size: file.size,
                    deptName: defaultDept,
                    sheets: sheets,
                    selectedSheet: getUploadType() === 'budget'
                        ? detectBudgetSheet(workbook) || detectTransactionSheet(workbook, targetMonth)
                        : detectTransactionSheet(workbook, targetMonth),
                    workbook,
                    headerMappings: {},
                    reportHeaderRow: null,
                    budgetHeaderRow: null
                });
            } catch(err) {
                console.error('Error reading file:', file.name, err);
            }
        }

        if (progressArea) progressArea.classList.add('hidden');
        renderFileList();
        if (getUploadType() === 'budget') await loadBudgetReference(true);
        refreshPreview();
    }

    function detectDeptFromFileName(filename) {
        const clean = filename.replace(/\.(xlsx|xls|csv)$/i, '').replace(/[-_]/g, ' ').toUpperCase();
        const departmentAliases = [
            ['LEGAL', ['LEGAL']], ['HSE', ['HSE']], ['HR', ['HRD', 'SDM', 'HR']],
            ['IT', ['IT']], ['GA', ['GA']], ['TAMBANG', ['TAMBANG', 'MINING']],
            ['HAULING', ['HAULING', 'ANGKUT']], ['PORT', ['PORT', 'PELABUHAN']],
            ['SHIPPING', ['SHIPPING', 'KAPAL']], ['FINANCE', ['FINANCE', 'KEUANGAN']],
            ['LOGISTIK', ['LOGISTIK', 'LOGISTIC']]
        ];
        for (const [department, aliases] of departmentAliases) {
            if (aliases.some(alias => new RegExp(`(^|[^A-Z0-9])${alias}([^A-Z0-9]|$)`).test(clean))) return department;
        }
        if (clean.includes('MINING') || clean.includes('TAMBANG')) return 'TAMBANG';
        if (clean.includes('HAULING') || clean.includes('ANGKUT')) return 'HAULING';
        if (clean.includes('PORT') || clean.includes('PELABUHAN')) return 'PORT';
        if (clean.includes('SHIPPING') || clean.includes('KAPAL')) return 'SHIPPING';
        if (clean.includes('FINANCE') || clean.includes('KEUANGAN')) return 'FINANCE';
        if (clean.includes('LOGISTIK') || clean.includes('LOGISTIC')) return 'LOGISTIK';
        if (clean.includes('HRD') || clean.includes('SDM')) return 'HRD';
        if (clean.includes('LEGAL')) return 'LEGAL';
        return clean.trim() || 'UMUM';
    }

    function renderFileList() {
        const container = document.getElementById('uploadFileListContainer');
        const emptyState = document.getElementById('uploadEmptyState');
        const countBadge = document.getElementById('uploadFileCountBadge');

        if (countBadge) countBadge.textContent = `${selectedFiles.length} file dipilih`;

        if (!container) return;

        if (selectedFiles.length === 0) {
            container.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        container.innerHTML = selectedFiles.map((item, idx) => {
            const mappingIssues = getUploadType() === 'budget' ? [] : getReportMappingIssues(item);
            const needsManualMapping = mappingIssues.length > 0;
            const sheetOptions = item.sheets.map(s => 
                `<option value="${SmartBaraFormatters.escapeHtml(s)}" ${s === item.selectedSheet ? 'selected' : ''}>${SmartBaraFormatters.escapeHtml(s)}</option>`
            ).join('');

            return `
                <div class="p-3.5 rounded-xl bg-white/5 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="text-base">📄</span>
                            <span class="font-bold text-white truncate">${SmartBaraFormatters.escapeHtml(item.name)}</span>
                            <span class="text-[10px] text-slate-400 font-mono">(${Math.round(item.size / 1024)} KB)</span>
                            ${getUploadType() === 'budget' ? '' : `<span class="text-[10px] font-bold ${needsManualMapping ? 'text-amber-300' : 'text-emerald-300'}">${needsManualMapping ? `Perlu pilih: ${SmartBaraFormatters.escapeHtml(mappingIssues.join(', '))}` : 'Header terbaca'}</span>`}
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <div>
                            <span class="text-[10px] text-slate-400 font-bold uppercase block mb-0.5">Departemen:</span>
                            <input type="text" value="${SmartBaraFormatters.escapeHtml(item.deptName)}" onchange="SmartBaraUpload.updateFileDept('${item.id}', this.value)" class="form-input text-xs py-1 px-2 w-36 uppercase font-bold text-teal-300">
                        </div>
                        <div>
                            <span class="text-[10px] text-slate-400 font-bold uppercase block mb-0.5">Pilih Sheet:</span>
                            <select onchange="SmartBaraUpload.updateFileSheet('${item.id}', this.value)" class="form-select text-xs py-1 px-2 w-36">
                                ${sheetOptions}
                            </select>
                        </div>
                        <button type="button" onclick="SmartBaraUpload.openHeaderMapping('${item.id}')" class="${needsManualMapping ? 'btn btn-primary' : 'btn btn-secondary'} mt-3 px-2 py-1 text-[10px] md:mt-0" title="Pilih baris header dan sesuaikan kolom">${needsManualMapping ? 'Pilih kolom' : 'Sesuaikan kolom'}</button>
                        <button type="button" onclick="SmartBaraUpload.removeFile('${item.id}')" class="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 mt-3 md:mt-0" title="Hapus File">
                            ✕
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateFileDept(id, newDept) {
        const item = selectedFiles.find(f => f.id === id);
        if (item) item.deptName = newDept.trim().toUpperCase() || 'UMUM';
        refreshPreview();
    }

    function updateFileSheet(id, sheetName) {
        const item = selectedFiles.find(f => f.id === id);
        if (item) {
            item.selectedSheet = sheetName;
            item.headerMappings = {};
            item.reportHeaderRow = null;
            item.budgetHeaderRow = null;
            item.dataStartRow = undefined;
            item.dataEndRow = undefined;
        }
        refreshPreview();
    }

    function getSheetMatrix(item) {
        const sheet = item?.workbook?.Sheets?.[item.selectedSheet];
        return sheet?.['!ref'] ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false }) : [];
    }

    function getSheetColumnOffset(item) {
        const sheet = item?.workbook?.Sheets?.[item.selectedSheet];
        return sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.c : 0;
    }

    function getHeaderOptions(headerRow, columnOffset = 0) {
        return (headerRow || []).map((value, index) => ({
            index,
            columnLetter: XLSX.utils.encode_col(index + columnOffset),
            label: String(value ?? '').trim() || `Kolom ${XLSX.utils.encode_col(index)}`
        }));
    }

    function getReportHeaderRows(item) {
        const matrix = getSheetMatrix(item);
        const columnOffset = getSheetColumnOffset(item);
        return matrix.slice(0, 40).map((row, rowIndex) => {
            const headers = getHeaderOptions(row, columnOffset);
            const normalized = headers.map(header => normalizeHeader(header.label));
            const has = aliases => normalized.some(value => aliases.some(alias => value === normalizeHeader(alias)));
            let score = 0;
            if (has(['tanggal', 'tgl', 'date'])) score += 3;
            if (has(['debit', 'debet'])) score += 2;
            if (has(['kredit', 'credit'])) score += 2;
            if (has(['nama akun', 'nama akun up', 'akun', 'account name'])) score += 2;
            if (has(['no sumber', 'sumber', 'reference'])) score += 1;
            return { rowIndex, headers, score };
        }).filter(candidate => candidate.headers.some(header => normalizeHeader(header.label)))
            .sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex);
    }

    function getAutoReportMapping(headers) {
        return Object.fromEntries(REPORT_HEADER_FIELDS.map(field => {
            const found = field.aliases
                .map(alias => headers.find(option => normalizeHeader(alias) === normalizeHeader(option.label)))
                .find(Boolean);
            return [field.key, found ? found.index : ''];
        }));
    }

    function getAutoBudgetMapping(block, budgetKind = getBudgetKind()) {
        const headers = block?.headers?.length && typeof block.headers[0] === 'string'
            ? getHeaderOptions(block.headers, Number(block.columnOffset) || 0)
            : block?.headers || [];
        const mapping = { name: '', department: '', months: {} };
        const nameAliases = budgetKind === 'site'
            ? ['nama proyek up', 'proyek up', 'nama proyek', 'project name', 'proyek', 'project']
            : ['description', 'row labels', 'nama akun up', 'nama akun induk', 'nama akun', 'account name', 'akun'];
        const nameColumn = headers.find(header => nameAliases.includes(normalizeHeader(header.label)));
        mapping.name = nameColumn ? nameColumn.index : '';
        const pic = headers.find(header => normalizeHeader(header.label) === 'pic');
        if (pic) mapping.department = pic.index;
        BUDGET_MONTHS.forEach(month => {
            const found = headers.find(option => findBudgetMonth(option.label) === BUDGET_MONTHS.indexOf(month));
            mapping.months[month.key] = found ? found.index : '';
        });
        return mapping;
    }

    function openHeaderMapping(id) {
        const item = selectedFiles.find(file => file.id === id);
        if (!item) return;
        headerMappingFileId = id;
        const type = getUploadType();
        const reportCandidates = getReportHeaderRows(item);
        const budgetData = getBudgetBlocks(item.workbook, item.selectedSheet);
        const matrix = type === 'budget' ? budgetData.matrix : getSheetMatrix(item);
        const candidates = type === 'budget'
            ? budgetData.blocks.map(block => ({ rowIndex: block.rowIndex, headers: getHeaderOptions(block.headers, block.columnOffset), label: `Baris ${block.rowIndex + 1}${block.revisionLabel ? ` · ${block.revisionLabel}` : ''}` }))
            : reportCandidates.map(candidate => ({ rowIndex: candidate.rowIndex, headers: candidate.headers, label: `Baris ${candidate.rowIndex + 1}${candidate.score >= 5 ? ' · deteksi otomatis' : ' · pilih manual'}` }));
        const fallback = candidates.length ? candidates : [{ rowIndex: 0, headers: getHeaderOptions(matrix[0] || [], getSheetColumnOffset(item)), label: 'Baris 1 · fallback' }];
        const rowKey = type === 'budget' ? 'budgetHeaderRow' : 'reportHeaderRow';
        let selectedRow = item[rowKey];
        if (selectedRow === null || selectedRow === undefined || !fallback.some(candidate => candidate.rowIndex === selectedRow)) {
            selectedRow = type === 'budget' ? fallback[fallback.length - 1].rowIndex : fallback[0].rowIndex;
            item[rowKey] = selectedRow;
        }
        const header = fallback.find(candidate => candidate.rowIndex === selectedRow) || fallback[0];
        const schema = type === 'budget'
            ? [{ key: 'name', label: getBudgetKind() === 'site' ? 'Nama Proyek UP' : 'Nama Akun', required: true }, { key: 'department', label: 'Departemen / PIC', required: false }, ...BUDGET_MONTHS.map(month => ({ key: `month:${month.key}`, label: month.label, required: false }))]
            : REPORT_HEADER_FIELDS;
        const mappings = item.headerMappings[type] || (type === 'budget' ? getAutoBudgetMapping({ nameColumn: header.headers.find(option => ['description', 'row labels'].includes(normalizeHeader(option.label)))?.index, headers: header.headers }) : getAutoReportMapping(header.headers));
        item.headerMappings[type] = mappings;
        const autoBounds = getAutoDataRowRange(matrix, selectedRow);
        const currentStart = Number.isFinite(item.dataStartRow) ? Number(item.dataStartRow) : autoBounds.start;
        const currentEnd = Number.isFinite(item.dataEndRow) ? Number(item.dataEndRow) : autoBounds.end;
        const options = `<option value="">— tidak dipetakan —</option>${header.headers.map(option => `<option value="${option.index}">${SmartBaraFormatters.escapeHtml(option.label)} (${option.columnLetter || XLSX.utils.encode_col(option.index)})</option>`).join('')}`;
        const rowsMarkup = `
            <div class="sm:col-span-2 grid gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold text-slate-300">Mulai baris data<input id="uploadDataStartRow" type="number" min="1" max="${Math.max(1, matrix.length)}" value="${Math.max(1, currentStart + 1)}" class="form-input mt-1 w-full text-xs"></label>
                <label class="block text-xs font-semibold text-slate-300">Akhir baris data<input id="uploadDataEndRow" type="number" min="1" max="${Math.max(1, matrix.length)}" value="${Math.max(1, currentEnd)}" class="form-input mt-1 w-full text-xs"></label>
            </div>
            ${schema.map(field => {
                const current = field.key.startsWith('month:') ? mappings.months?.[field.key.slice(6)] : mappings[field.key];
                return `<label class="block text-xs font-semibold text-slate-300">${SmartBaraFormatters.escapeHtml(field.label)}${field.required ? ' <span class="text-rose-300">*</span>' : ''}<select data-header-map-key="${SmartBaraFormatters.escapeHtml(field.key)}" class="form-select mt-1 w-full text-xs">${options}</select></label>`;
            }).join('')}
        `;
        const modal = document.createElement('div');
        modal.id = 'uploadHeaderMappingModal';
        modal.className = 'modal-overlay fixed inset-0 z-[8200] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm';
        modal.innerHTML = `
            <section class="glass-panel w-full max-w-3xl overflow-hidden rounded-xl border border-teal-300/25 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="uploadHeaderMappingTitle">
                <header class="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/60 p-4">
                    <div class="min-w-0"><h3 id="uploadHeaderMappingTitle" class="m-0 text-sm font-black text-white">Pemetaan kolom · ${SmartBaraFormatters.escapeHtml(item.name)}</h3><p class="m-0 mt-1 text-[10px] text-slate-400">Semua kolom pada sheet tersedia di setiap pilihan.</p></div>
                    <button type="button" onclick="SmartBaraUpload.closeHeaderMapping()" class="p-2 text-slate-400 hover:text-white" aria-label="Tutup">✕</button>
                </header>
                <div class="max-h-[65vh] space-y-3 overflow-y-auto p-4">
                    <label class="block text-xs font-semibold text-slate-300">Baris header / blok
                        <select id="uploadHeaderRowSelect" onchange="SmartBaraUpload.changeHeaderMappingBlock('${item.id}', this.value)" class="form-select mt-1 w-full text-xs">${fallback.map(candidate => `<option value="${candidate.rowIndex}" ${candidate.rowIndex === selectedRow ? 'selected' : ''}>${SmartBaraFormatters.escapeHtml(candidate.label)}</option>`).join('')}</select>
                    </label>
                    <div id="uploadHeaderMappingFields" class="grid grid-cols-1 gap-3 sm:grid-cols-2">${rowsMarkup}</div>
                    <p class="m-0 text-[10px] leading-4 text-amber-200/80">Jangan pilih kolom saldo seperti Balance untuk Debit/Kredit. Kolom budget YTD/kumulatif tidak dipakai sebagai bulan.</p>
                </div>
                <footer class="flex justify-end gap-2 border-t border-white/10 bg-slate-950/40 p-4">
                    <button type="button" onclick="SmartBaraUpload.autoDetectHeaderMapping('${item.id}')" class="btn btn-secondary text-xs">Deteksi otomatis</button>
                    <button type="button" onclick="SmartBaraUpload.saveHeaderMapping('${item.id}')" class="btn btn-primary text-xs">Terapkan pemetaan</button>
                </footer>
            </section>`;
        document.getElementById('uploadHeaderMappingModal')?.remove();
        document.body.appendChild(modal);
        const fields = modal.querySelectorAll('[data-header-map-key]');
        fields.forEach(select => {
            const key = select.dataset.headerMapKey;
            const value = key.startsWith('month:') ? mappings.months?.[key.slice(6)] : mappings[key];
            select.value = value === '' || value === undefined ? '' : String(value);
        });
    }

    function changeHeaderMappingBlock(id, value) {
        const item = selectedFiles.find(file => file.id === id);
        if (!item) return;
        const key = getUploadType() === 'budget' ? 'budgetHeaderRow' : 'reportHeaderRow';
        item[key] = Number(value);
        item.headerMappings[getUploadType()] = null;
        openHeaderMapping(id);
    }

    function autoDetectHeaderMapping(id) {
        const item = selectedFiles.find(file => file.id === id);
        if (!item) return;
        const type = getUploadType();
        item.headerMappings[type] = null;
        if (type === 'budget') item.budgetHeaderRow = null;
        else item.reportHeaderRow = null;
        openHeaderMapping(id);
    }

    function saveHeaderMapping(id) {
        const item = selectedFiles.find(file => file.id === id);
        const modal = document.getElementById('uploadHeaderMappingModal');
        if (!item || !modal) return;
        const type = getUploadType();
        const mapping = type === 'budget' ? { months: {} } : {};
        modal.querySelectorAll('[data-header-map-key]').forEach(select => {
            const key = select.dataset.headerMapKey;
            const value = select.value === '' ? '' : Number(select.value);
            if (key.startsWith('month:')) mapping.months[key.slice(6)] = value;
            else mapping[key] = value;
        });
        const matrix = getUploadType() === 'budget' ? getBudgetBlocks(item.workbook, item.selectedSheet).matrix : getSheetMatrix(item);
        const startRow = Number(document.getElementById('uploadDataStartRow')?.value || 1);
        const endRow = Number(document.getElementById('uploadDataEndRow')?.value || 1);
        item.dataStartRow = Number.isFinite(startRow) ? Math.max(0, Math.min(startRow - 1, matrix.length - 1)) : 0;
        item.dataEndRow = Number.isFinite(endRow) ? Math.max(item.dataStartRow + 1, Math.min(endRow, matrix.length)) : matrix.length;
        item.headerMappings[type] = mapping;
        modal.remove();
        refreshPreview();
    }

    function closeHeaderMapping() {
        document.getElementById('uploadHeaderMappingModal')?.remove();
    }

    function removeFile(id) {
        selectedFiles = selectedFiles.filter(f => f.id !== id);
        renderFileList();
        refreshPreview();
    }

    function clearAllFiles() {
        selectedFiles = [];
        renderFileList();
        refreshPreview();
    }

    function getUploadMode() {
        return document.querySelector('input[name="uploadMode"]:checked')?.value || 'update';
    }

    function getUploadField(row, names) {
        const entries = Object.entries(row || {});
        for (const name of names) {
            const key = normalizeHeader(name);
            const entry = entries.find(([candidate]) => normalizeHeader(candidate) === key);
            if (entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '') return entry[1];
        }
        return undefined;
    }

    function getUploadNumber(row, names) {
        const value = getUploadField(row, names);
        return value === undefined ? 0 : SmartBaraFormatters.parseNumber(value, 0);
    }

    function inferDateFromMonthValue(value, fallbackYear = Number(String(SmartBaraCore.getActivePeriod() || '').match(/\d{4}/)?.[0] || new Date().getFullYear())) {
        if (value === null || value === undefined || value === '') return null;
        const str = String(value).trim();
        if (!str) return null;

        const monthMap = {
            januari: 1, jan: 1, january: 1, februari: 2, feb: 2, february: 2,
            maret: 3, mar: 3, march: 3, april: 4, apr: 4, mei: 5, may: 5,
            juni: 6, jun: 6, june: 6, juli: 7, jul: 7, july: 7,
            agustus: 8, agu: 8, agt: 8, agst: 8, agts: 8, august: 8, ags: 8,
            september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10,
            november: 11, nov: 11, desember: 12, des: 12, dec: 12
        };

        const monthName = Object.keys(monthMap).find(name => str.toLowerCase().includes(name));
        const monthNumber = !monthName && str.match(/(?:^|[^0-9])(?:0?)(1[0-2]|[1-9])(?:[^0-9]|$)/i);
        const month = monthName ? monthMap[monthName] : monthNumber ? Number(monthNumber[1]) : null;
        if (!month) return null;

        const yearMatch = str.match(/(19|20)\d{2}/);
        const year = yearMatch ? Number(yearMatch[0]) : fallbackYear;
        return `${year}-${String(month).padStart(2, '0')}-01`;
    }

    function resolveRowDate(row) {
        const directDate = SmartBaraFormatters.normalizeDate(getUploadField(row, ['tanggal', 'date']));
        if (directDate) return directDate;
        const monthValue = getUploadField(row, ['bulan', 'month', 'periode bulan', 'bulan transaksi']);
        return inferDateFromMonthValue(monthValue) || null;
    }

    function getAutoDataRowRange(matrix, headerRowIndex) {
        const rowCount = Array.isArray(matrix) ? matrix.length : 0;
        let startIndex = Math.min(Math.max(headerRowIndex + 1, 0), Math.max(0, rowCount - 1));
        let endIndex = rowCount;

        while (startIndex < rowCount && !matrix[startIndex]?.some(cell => String(cell ?? '').trim() !== '')) {
            startIndex++;
        }

        if (startIndex >= rowCount) {
            startIndex = Math.max(headerRowIndex + 1, 0);
            endIndex = rowCount;
        }

        for (let idx = startIndex; idx < rowCount; idx++) {
            const cells = matrix[idx] || [];
            const hasValue = cells.some(cell => String(cell ?? '').trim() !== '');
            const text = cells.map(cell => String(cell ?? '').trim()).join(' ').toLowerCase();
            if (hasValue && !/(total|grand total|jumlah|subtotal|sum|all)/.test(text)) {
                endIndex = rowCount;
                break;
            }
            if (hasValue && /(total|grand total|jumlah|subtotal|sum|all)/.test(text)) {
                endIndex = idx;
                break;
            }
        }

        for (let idx = rowCount - 1; idx >= startIndex; idx--) {
            const row = matrix[idx] || [];
            const hasValue = row.some(cell => String(cell ?? '').trim() !== '');
            const text = row.map(cell => String(cell ?? '').trim()).join(' ').toLowerCase();
            if (!hasValue || /(total|grand total|jumlah|subtotal|sum|all)/.test(text)) {
                endIndex = idx;
                continue;
            }
            break;
        }

        if (endIndex <= startIndex) endIndex = rowCount;
        return { start: startIndex, end: endIndex };
    }

    function getReportHeaderProfile(item) {
        const matrix = getSheetMatrix(item);
        const candidates = getReportHeaderRows(item);
        const rowIndex = item.reportHeaderRow ?? candidates[0]?.rowIndex ?? 0;
        const headers = getHeaderOptions(matrix[rowIndex] || [], getSheetColumnOffset(item));
        const mapping = item.headerMappings.report || getAutoReportMapping(headers);
        item.headerMappings.report = mapping;
        item.reportHeaderRow = rowIndex;
        const autoBounds = getAutoDataRowRange(matrix, rowIndex);
        const startRow = Number.isFinite(item.dataStartRow) ? Number(item.dataStartRow) : autoBounds.start;
        const endRow = Number.isFinite(item.dataEndRow) ? Number(item.dataEndRow) : autoBounds.end;
        item.dataStartRow = Math.max(0, Math.min(startRow, Math.max(0, matrix.length - 1)));
        item.dataEndRow = Math.max(item.dataStartRow + 1, Math.min(endRow, matrix.length));
        return { matrix, rowIndex, headers, mapping, candidates, dataStartRow: item.dataStartRow, dataEndRow: item.dataEndRow };
    }

    function getReportMappingIssues(item) {
        const profile = getReportHeaderProfile(item);
        return REPORT_HEADER_FIELDS.filter(field => {
            if (!field.required) return false;
            const column = profile.mapping[field.key];
            return column === '' || column === undefined || !profile.headers.some(header => header.index === Number(column));
        }).map(field => field.label);
    }

    function getMappedReportRows(item) {
        const profile = getReportHeaderProfile(item);
        const valueAt = (cells, key) => {
            const column = profile.mapping[key];
            return column === '' || column === undefined ? '' : cells[Number(column)] ?? '';
        };
        const startRow = Number.isFinite(item.dataStartRow) ? Number(item.dataStartRow) : profile.dataStartRow;
        const endRow = Number.isFinite(item.dataEndRow) ? Number(item.dataEndRow) : profile.dataEndRow;
        return profile.matrix.slice(Math.max(0, startRow), Math.max(startRow, Math.min(endRow, profile.matrix.length))).map(cells => ({
            tanggal: valueAt(cells, 'date'),
            bulan: valueAt(cells, 'month'),
            no_sumber: valueAt(cells, 'source'),
            nama_akun: valueAt(cells, 'account'),
            proyek: valueAt(cells, 'project'),
            keterangan: valueAt(cells, 'description'),
            debit: valueAt(cells, 'debit'),
            kredit: valueAt(cells, 'credit'),
            finance: valueAt(cells, 'finance'),
            rekonsil: valueAt(cells, 'reconcile'),
            catatan: valueAt(cells, 'note')
        }));
    }

    function getBudgetSubtotalNames() {
        return new Set(['harga pokok penjualan', 'beban operasional', 'beban lain-lain', 'beban lain', 'grand total', 'total', 'row labels', 'description'].map(normalizeHeader));
    }

    function parseBudgetFile(item) {
        const budgetData = getBudgetBlocks(item.workbook, item.selectedSheet);
        if (!budgetData.blocks.length) return { rows: [], warnings: [`Tidak ditemukan blok Bgt 12 bulan pada sheet ${item.selectedSheet}.`] };
        const headerIndex = item.budgetHeaderRow ?? budgetData.blocks[budgetData.blocks.length - 1].rowIndex;
        const block = budgetData.blocks.find(candidate => candidate.rowIndex === headerIndex) || budgetData.blocks[budgetData.blocks.length - 1];
        item.budgetHeaderRow = block.rowIndex;
        const headers = getHeaderOptions(block.headers, block.columnOffset);
        const mapping = item.headerMappings.budget || getAutoBudgetMapping({ ...block, headerOptions: headers }, getBudgetKind());
        item.headerMappings.budget = mapping;
        const warnings = [];
        const budgetKind = getBudgetKind();
        if (mapping.name === '' || mapping.name === undefined) {
            warnings.push(budgetKind === 'site' ? 'Kolom nama proyek belum dipetakan.' : 'Kolom nama akun belum dipetakan.');
            return { rows: [], warnings, block };
        }
        const unavailableMonths = BUDGET_MONTHS
            .filter(month => mapping.months?.[month.key] === '' || mapping.months?.[month.key] === undefined)
            .map(month => month.label.replace('Budget ', ''));
        if (unavailableMonths.length) {
            warnings.push(`Sheet hanya menyediakan bulan tertentu; ${unavailableMonths.join(', ')} akan dipertahankan untuk akun/proyek existing dan bernilai 0 untuk yang baru.`);
        }

        const matrix = budgetData.matrix;
        const activeYear = Number(String(SmartBaraCore.getActivePeriod()).match(/\d{4}/)?.[0]);
        const normalizedHeaders = headers.map(header => normalizeHeader(header.label));
        const rows = [];
        let skippedSubtotalRows = 0;
        let skippedBlankRows = 0;
        let departmentMismatches = 0;
        const nameColumnIndex = (mapping.name === '' || mapping.name === undefined) ? -1 : Number(mapping.name);
        const autoStartRow = block.rowIndex + 1;
        let autoEndRow = block.endRowIndex;
        // Batasi otomatis sampai baris terakhir yang masih memiliki nama akun/proyek,
        // agar baris kosong, #REF, dan ringkasan di bawahnya tidak ikut terbaca.
        let lastNamedRow = autoStartRow;
        if (nameColumnIndex >= 0) {
            for (let r = autoStartRow; r < block.endRowIndex; r++) {
                const rowCells = Array.isArray(matrix[r]) ? matrix[r] : [];
                const rowName = String(rowCells[nameColumnIndex] ?? '').trim();
                if (!rowName) continue;
                lastNamedRow = r + 1;
            }
        }
        if (nameColumnIndex >= 0 && lastNamedRow > autoStartRow) autoEndRow = lastNamedRow;
        else autoEndRow = block.endRowIndex;
        const hasManualRange = Number.isFinite(item.dataStartRow) || Number.isFinite(item.dataEndRow);
        const rangeLimit = hasManualRange ? matrix.length : autoEndRow;
        const startRow = Number.isFinite(item.dataStartRow)
            ? Math.max(autoStartRow, Math.min(Number(item.dataStartRow), rangeLimit))
            : autoStartRow;
        const endRow = Number.isFinite(item.dataEndRow)
            ? Math.max(startRow, Math.min(Number(item.dataEndRow), rangeLimit))
            : autoEndRow;
        const dataRows = matrix.slice(startRow, endRow);
        for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
            const cells = dataRows[rowIndex];
            let name = String(cells[Number(mapping.name)] ?? '').trim();
            const allCellsEmpty = (Array.isArray(cells) ? cells : []).every(cell => String(cell ?? '').trim() === '');
            if (allCellsEmpty) {
                skippedBlankRows++;
                continue;
            }
            if (!name) {
                skippedBlankRows++;
                continue;
            }
            if (getBudgetSubtotalNames().has(normalizeHeader(name))) {
                skippedSubtotalRows++;
                continue;
            }

            const departmentValue = mapping.department === '' || mapping.department === undefined
                ? ''
                : String(cells[Number(mapping.department)] ?? '').trim().toUpperCase();
            const department = departmentValue || String(item.deptName || 'UMUM').trim().toUpperCase();
            if (departmentValue && item.deptName && departmentValue !== String(item.deptName).toUpperCase()) departmentMismatches++;
            const monthlyValues = {};
            let hasAmount = false;
            const missingMonths = [];
            for (const month of BUDGET_MONTHS) {
                const sourceColumn = mapping.months?.[month.key];
                if (sourceColumn === '' || sourceColumn === undefined) {
                    missingMonths.push(month.label);
                    monthlyValues[month.key] = null;
                    continue;
                }
                const rawValue = cells[Number(sourceColumn)];
                if (rawValue === '' || rawValue === null || rawValue === undefined) {
                    monthlyValues[month.key] = null;
                    continue;
                }
                const parsed = SmartBaraFormatters.parseNumber(rawValue, NaN);
                if (!Number.isFinite(parsed)) {
                    monthlyValues[month.key] = null;
                    warnings.push(`${name}: nilai ${month.label} bukan angka.`);
                    continue;
                }
                monthlyValues[month.key] = parsed;
                hasAmount = true;
            }
            // Baris dengan nama akun tetap dibaca walau semua nilai budget kosong/null;
            // nilai kosong dikonversi menjadi 0 agar akun tidak hilang.
            const yearHeaders = headers
                .filter(header => String(header.label).toLowerCase().includes('bgt'))
                .map(header => String(header.label).match(/(?:-|\s)(\d{2,4})$/)?.[1])
                .filter(Boolean)
                .map(year => year.length === 2 ? 2000 + Number(year) : Number(year));
            if (activeYear && yearHeaders.some(year => year !== activeYear)) warnings.push(`${name}: tahun kolom budget tidak sama dengan periode ${activeYear}.`);
            rows.push({ name, department, monthlyValues, sourceRow: startRow + rowIndex + 1 });
        }

        if (skippedSubtotalRows) warnings.push(`${skippedSubtotalRows} baris subtotal/kategori dikecualikan.`);
        if (skippedBlankRows) warnings.push(`${skippedBlankRows} baris kosong/tanpa nama akun atau proyek dikecualikan.`);
        if (departmentMismatches) warnings.push(`${departmentMismatches} baris memiliki PIC berbeda dari departemen file; periksa pemetaan.`);
        if (!rows.length) warnings.push(`[v3] Tidak ada baris yang terbaca. Blok header baris ${block.rowIndex + 1}, rentang ${startRow + 1}–${endRow} (0-based ${startRow}–${endRow}), kolom nama: ${mapping.name}. Periksa pemetaan kolom dan rentang baris.`);
        return { rows, warnings, block, headers, mapping };
    }

    function getBudgetRowName(row, budgetKind = getBudgetKind()) {
        const fields = budgetKind === 'site'
            ? ['nama_proyek', 'nama proyek up', 'project name', 'proyek']
            : ['nama_akun', 'account name', 'nama', 'description'];
        return String(getUploadField(row, fields) || '').trim();
    }

    function getBudgetRowDepartment(row) {
        return String(getUploadField(row, ['departemen', 'department', 'dept', 'pic']) || 'UMUM').trim().toUpperCase();
    }

    function getExistingBudgetValue(row, monthIndex) {
        if (Array.isArray(row.budget)) return SmartBaraFormatters.parseNumber(row.budget[monthIndex], 0);
        const field = `budget_${BUDGET_MONTHS[monthIndex].key}`;
        return SmartBaraFormatters.parseNumber(row[field], 0);
    }

    function budgetValuesMatch(source, existing) {
        const mappedMonths = BUDGET_MONTHS.map((month, index) => ({
            index,
            sourceValue: source.monthlyValues[month.key]
        })).filter(month => month.sourceValue !== null && month.sourceValue !== undefined);
        return mappedMonths.length > 0 && mappedMonths.every(month =>
            Math.abs(month.sourceValue - getExistingBudgetValue(existing, month.index)) <= 0.01
        );
    }

    function normalizeBudgetIdentityName(value) {
        return String(value || '').trim().toLocaleLowerCase('id-ID').normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    }

    function classifyBudgetPreview(sourceRows) {
        const usedIds = new Set();
        const seenSourceKeys = new Set();
        return sourceRows.map(source => {
            const nameKey = normalizeBudgetIdentityName(source.name);
            const deptKey = normalizeHeader(source.department);
            const sourceKey = `${deptKey}:${nameKey}`;
            const duplicateSource = seenSourceKeys.has(sourceKey);
            seenSourceKeys.add(sourceKey);
            const candidates = budgetReferenceRows.filter(existing =>
                normalizeBudgetIdentityName(getBudgetRowName(existing)) === nameKey &&
                normalizeHeader(getBudgetRowDepartment(existing)) === deptKey
            );
            const available = candidates.filter(existing => !usedIds.has(String(existing.id || '')));
            const exact = available.filter(existing => budgetValuesMatch(source, existing));

            if (exact.length) {
                const existing = exact[0];
                if (existing.id) usedIds.add(String(existing.id));
                return { ...source, status: 'sama', existing, duplicateSource, duplicateExisting: candidates.length > 1, candidateCount: candidates.length };
            }
            if (available.length) {
                const existing = available[0];
                if (existing.id) usedIds.add(String(existing.id));
                return { ...source, status: 'berubah', existing, duplicateSource, duplicateExisting: candidates.length > 1, candidateCount: candidates.length };
            }
            return { ...source, status: 'baru', existing: null, duplicateSource, duplicateExisting: candidates.length > 1, candidateCount: candidates.length };
        });
    }

    function buildBudgetPreviewData() {
        const rows = [];
        const warnings = [];
        const sourceSheets = [];
        selectedFiles.forEach(item => {
            const parsed = parseBudgetFile(item);
            warnings.push(...parsed.warnings.map(message => `${item.name}: ${message}`));
            if (parsed.block) sourceSheets.push(`${item.deptName}/${item.selectedSheet} baris ${parsed.block.rowIndex + 1}`);
            rows.push(...parsed.rows.map(row => ({ ...row, sourceFile: item.name })));
        });
        const classified = classifyBudgetPreview(rows);
        const summary = classified.reduce((totals, row) => {
            totals[row.status]++;
            return totals;
        }, { sama: 0, berubah: 0, baru: 0, ambigu: 0 });
        const blocking = [];
        if (budgetReferenceError) blocking.push(`Gagal membaca budget periode aktif: ${budgetReferenceError}`);
        const duplicateSourceRows = classified.filter(row => row.duplicateSource).length;
        const duplicateExistingRows = classified.filter(row => row.duplicateExisting).length;
        if (duplicateSourceRows) warnings.push(`${duplicateSourceRows} baris memiliki ejaan akun/departemen yang sama di file. Semua baris tetap diproses; periksa jika duplikasi ini tidak disengaja.`);
        if (duplicateExistingRows) warnings.push(`${duplicateExistingRows} baris cocok dengan beberapa data akun/departemen tersimpan. Pembaruan memakai pasangan yang belum dipakai; baris tambahan dimasukkan sebagai data baru.`);
        if (warnings.some(message => /tahun kolom budget tidak sama|PIC berbeda|tidak ditemukan blok/i.test(message))) {
            blocking.push('Ada ketidakcocokan header, tahun, PIC, atau sheet yang perlu diperiksa sebelum menerapkan budget.');
        }
        return { rows: classified, warnings: [...new Set(warnings)], blocking, summary, sourceSheets };
    }

    function renderBudgetPreview() {
        const panel = document.getElementById('uploadPreviewPanel');
        const title = document.getElementById('uploadPreviewTitle');
        const summaryEl = document.getElementById('uploadPreviewSummary');
        const notice = document.getElementById('uploadBudgetModeNotice');
        const body = document.getElementById('uploadPreviewTableBody');
        const head = document.getElementById('uploadPreviewTableHead');
        const button = document.getElementById('uploadSubmitButton');
        if (!panel || !body || !head) return;

        const preview = buildBudgetPreviewData();
        const searchInput = document.getElementById('uploadBudgetPreviewSearch');
        if (searchInput) searchInput.classList.toggle('hidden', getUploadType() !== 'budget');
        const search = String(searchInput?.value || '').trim().toLowerCase();
        const filteredRows = search
            ? preview.rows.filter(row => `${row.name} ${row.department}`.toLowerCase().includes(search))
            : preview.rows;
        const monthLabels = BUDGET_MONTHS.map(month => month.label.replace('Budget ', ''));
        if (title) title.textContent = getBudgetKind() === 'site' ? 'Preview Budget Proyek' : 'Preview Budget Akun';
        head.innerHTML = `<th>Status</th><th>Departemen</th><th>${getBudgetKind() === 'site' ? 'Proyek UP' : 'Nama Akun'}</th>${monthLabels.map(label => `<th class="text-right">${SmartBaraFormatters.escapeHtml(label)}</th>`).join('')}<th>Sheet / Baris</th>`;
        body.innerHTML = filteredRows.slice(0, 1000).map(row => `
            <tr>
                <td>${SmartBaraFormatters.escapeHtml(row.status)}</td>
                <td>${SmartBaraFormatters.escapeHtml(row.department)}</td>
                <td>${SmartBaraFormatters.escapeHtml(row.name)}</td>
                ${BUDGET_MONTHS.map(month => `<td class="text-right tabular-nums">${row.monthlyValues[month.key] === null ? '<span class="text-slate-500">—</span>' : SmartBaraFormatters.formatRupiah(row.monthlyValues[month.key])}</td>`).join('')}
                <td>${SmartBaraFormatters.escapeHtml(`${row.sourceFile} · baris ${row.sourceRow}`)}</td>
            </tr>
        `).join('') || `<tr><td colspan="${monthLabels.length + 4}" class="py-6 text-center text-slate-500">Tidak ditemukan baris budget yang valid.</td></tr>`;

        if (summaryEl) {
            summaryEl.textContent = `${filteredRows.length.toLocaleString('id-ID')} dari ${preview.rows.length.toLocaleString('id-ID')} baris · ${preview.summary.sama} sama · ${preview.summary.berubah} berubah · ${preview.summary.baru} baru · ${preview.summary.ambigu} ambigu`;
        }
        const sourceLabel = preview.sourceSheets.length ? preview.sourceSheets.join(' · ') : 'Tidak ada blok budget 12 bulan yang valid.';
        if (notice) {
            notice.innerHTML = `${SmartBaraFormatters.escapeHtml(sourceLabel)}<br>${preview.blocking.map(message => `⚠ ${SmartBaraFormatters.escapeHtml(message)}`).join('<br>') || preview.warnings.slice(0, 6).map(message => `• ${SmartBaraFormatters.escapeHtml(message)}`).join('<br>') || 'Mapping dan budget tersimpan cocok; preview belum menyimpan perubahan.'}`;
            notice.className = `rounded-lg border p-3 text-[11px] leading-5 ${preview.blocking.length ? 'border-rose-400/30 bg-rose-400/5 text-rose-100' : 'border-amber-400/20 bg-amber-400/5 text-amber-100/80'}`;
        }
        if (button) {
            button.textContent = 'Terapkan Budget';
            button.disabled = Boolean(preview.blocking.length || !preview.rows.length);
            button.title = button.disabled ? 'Periksa peringatan dan mapping terlebih dahulu.' : 'Terapkan perubahan budget setelah konfirmasi.';
        }
        panel.classList.toggle('hidden', selectedFiles.length === 0);
    }

    function getUploadGroups() {
        const mode = getUploadMode();
        const selectedMonth = document.getElementById('uploadTargetMonth')?.value || '';
        const targetPeriod = getUploadTargetPeriod();
        const activeYear = String(targetPeriod).match(/\d{4}/)?.[0] || '';
        const existingDepartments = mode === 'add-department' ? buildDepartmentStoreSnapshot(targetPeriod) : {};
        const groups = new Map();
        let totalRows = 0;
        let excludedWithoutDate = 0;
        let excludedOtherMonth = 0;
        let validationSummary = { total: 0, valid: 0, missingDate: 0, missingAccount: 0, missingProject: 0, mismatchedDept: 0 };

        selectedFiles.forEach(item => {
            const sheet = item.workbook?.Sheets?.[item.selectedSheet];
            if (!sheet) return;
            const rawRows = getMappedReportRows(item);
            if (mode === 'update') {
                excludedWithoutDate += rawRows.filter(row => {
                    if (resolveRowDate(row)) return false;
                    const source = getUploadField(row, ['no sumber', 'nomor sumber', 'no voucher', 'no bukti', 'referensi', 'reference']);
                    return Boolean(source) || getUploadNumber(row, ['debit', 'debet']) !== 0 || getUploadNumber(row, ['kredit', 'credit']) !== 0;
                }).length;
            }
            const parsedRows = parseExcelTransactions(rawRows, item.deptName);
            const acceptedRows = mode === 'update' ? parsedRows.filter(row => {
                const normalizedDate = SmartBaraFormatters.normalizeDate(row.tanggal);
                if (!normalizedDate) return false;
                if (!selectedMonth) return false;
                if (normalizedDate.slice(5, 7) !== selectedMonth || (activeYear && normalizedDate.slice(0, 4) !== activeYear)) {
                    excludedOtherMonth++;
                    return false;
                }
                return true;
            }) : parsedRows;
            const validationRows = mode === 'update' ? rawRows.filter(row => {
                const normalizedDate = resolveRowDate(row);
                return normalizedDate && normalizedDate.slice(5, 7) === selectedMonth && (!activeYear || normalizedDate.slice(0, 4) === activeYear);
            }) : rawRows;

            const dept = String(item.deptName || 'UMUM').trim().toUpperCase();
            if (mode === 'add-department' && existingDepartments && existingDepartments[dept]) return;
            if (acceptedRows.length) {
                const group = groups.get(dept) || [];
                group.push(...acceptedRows);
                groups.set(dept, group);
            }
            totalRows += acceptedRows.length;

            const deptValidation = validateUploadRows(validationRows, item.deptName);
            validationSummary.total += deptValidation.summary.total;
            validationSummary.valid += deptValidation.summary.valid;
            validationSummary.missingDate += deptValidation.summary.missingDate;
            validationSummary.missingAccount += deptValidation.summary.missingAccount;
            validationSummary.missingProject += deptValidation.summary.missingProject;
            validationSummary.mismatchedDept += deptValidation.summary.mismatchedDept;
        });

        return { mode, selectedMonth, groups, totalRows, excludedWithoutDate, excludedOtherMonth, validationSummary };
    }

    function collectBadDataRows() {
        const results = [];
        selectedFiles.forEach(item => {
            const profile = getReportHeaderProfile(item);
            if (!profile || !profile.matrix) return;
            const rows = profile.matrix.slice(profile.rowIndex + 1);
            rows.forEach((cells, offset) => {
                const mappedRow = {
                    tanggal: profile.mapping.date !== undefined && profile.mapping.date !== '' ? (cells[Number(profile.mapping.date)] ?? '') : '',
                    'no sumber': profile.mapping.source !== undefined && profile.mapping.source !== '' ? (cells[Number(profile.mapping.source)] ?? '') : '',
                    'nama akun': profile.mapping.account !== undefined && profile.mapping.account !== '' ? (cells[Number(profile.mapping.account)] ?? '') : '',
                    'proyek': profile.mapping.project !== undefined && profile.mapping.project !== '' ? (cells[Number(profile.mapping.project)] ?? '') : '',
                    keterangan: profile.mapping.description !== undefined && profile.mapping.description !== '' ? (cells[Number(profile.mapping.description)] ?? '') : '',
                    debit: profile.mapping.debit !== undefined && profile.mapping.debit !== '' ? (cells[Number(profile.mapping.debit)] ?? '') : '',
                    kredit: profile.mapping.credit !== undefined && profile.mapping.credit !== '' ? (cells[Number(profile.mapping.credit)] ?? '') : '',
                    finance: profile.mapping.finance !== undefined && profile.mapping.finance !== '' ? (cells[Number(profile.mapping.finance)] ?? '') : '',
                    rekonsil: profile.mapping.reconcile !== undefined && profile.mapping.reconcile !== '' ? (cells[Number(profile.mapping.reconcile)] ?? '') : ''
                };
                const record = getUploadRecord(mappedRow);
                const issues = [];
                if (!record.tanggal) issues.push('tanggal');
                if (!record.namaAkun) issues.push('nama akun');
                if (!record.proyek) issues.push('proyek');
                if (!issues.length) return;
                results.push({
                    file: item.name,
                    sheet: item.selectedSheet,
                    rowNumber: profile.rowIndex + 2 + offset,
                    departemen: String(item.deptName || 'UMUM').trim().toUpperCase(),
                    tanggal: record.tanggal || '-',
                    noSumber: record.noSumber || '-',
                    namaAkun: record.namaAkun || '-',
                    proyek: record.proyek || '-',
                    keterangan: record.keterangan || '-',
                    debit: record.debit || 0,
                    kredit: record.kredit || 0,
                    issues: issues.join(', ')
                });
            });
        });
        return results.slice(0, 250);
    }

    function showBadDataModal() {
        const rows = collectBadDataRows();
        if (!rows.length) {
            alert('Tidak ada bad data yang perlu disesuaikan.');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay fixed inset-0 z-[9300] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-full max-w-5xl overflow-hidden rounded-xl border border-rose-400/30 shadow-2xl" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/70 p-4">
                    <div>
                        <h3 class="m-0 text-base font-black text-white">Bad Data untuk Penyesuaian</h3>
                        <p class="m-0 mt-1 text-[10px] text-slate-400">Baris yang bermasalah: tanggal, akun, atau proyek kosong.</p>
                    </div>
                    <button type="button" onclick="this.closest('.modal-overlay')?.remove()" class="p-2 text-slate-400 hover:text-white" aria-label="Tutup">✕</button>
                </div>
                <div class="max-h-[70vh] overflow-auto p-3">
                    <table class="app-table min-w-[1100px] text-[11px]">
                        <thead class="sticky top-0 z-10 bg-slate-900">
                            <tr>
                                <th>File</th>
                                <th>Sheet</th>
                                <th>Baris</th>
                                <th>Dept</th>
                                <th>Tanggal</th>
                                <th>No Sumber</th>
                                <th>Nama Akun</th>
                                <th>Proyek</th>
                                <th>Keterangan</th>
                                <th>Debit</th>
                                <th>Kredit</th>
                                <th>Issue</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="align-top">
                                    <td>${SmartBaraFormatters.escapeHtml(row.file)}</td>
                                    <td>${SmartBaraFormatters.escapeHtml(row.sheet)}</td>
                                    <td>${row.rowNumber}</td>
                                    <td>${SmartBaraFormatters.escapeHtml(row.departemen)}</td>
                                    <td>${SmartBaraFormatters.escapeHtml(String(row.tanggal))}</td>
                                    <td>${SmartBaraFormatters.escapeHtml(String(row.noSumber))}</td>
                                    <td class="text-amber-200">${SmartBaraFormatters.escapeHtml(String(row.namaAkun))}</td>
                                    <td class="text-amber-200">${SmartBaraFormatters.escapeHtml(String(row.proyek))}</td>
                                    <td>${SmartBaraFormatters.escapeHtml(String(row.keterangan))}</td>
                                    <td class="text-right">${SmartBaraFormatters.formatRupiah(Number(row.debit) || 0)}</td>
                                    <td class="text-right">${SmartBaraFormatters.formatRupiah(Number(row.kredit) || 0)}</td>
                                    <td class="text-rose-200">${SmartBaraFormatters.escapeHtml(row.issues)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        modal.addEventListener('click', () => modal.remove());
        document.body.appendChild(modal);
    }

    function refreshPreview() {
        const monthSelector = document.getElementById('uploadMonthSelector');
        const modeNotice = document.getElementById('uploadModeNotice');
        const previewPanel = document.getElementById('uploadPreviewPanel');
        const previewSummary = document.getElementById('uploadPreviewSummary');
        const previewBody = document.getElementById('uploadPreviewTableBody');
        const previewHead = document.getElementById('uploadPreviewTableHead');
        const submitButton = document.getElementById('uploadSubmitButton');
        if (!previewPanel || !previewBody) return;

        const previewWrap = document.getElementById('uploadPreviewTableWrap');
        const previewToggle = document.getElementById('uploadPreviewToggleButton');
        if (previewWrap) previewWrap.classList.toggle('hidden', !previewTableOpen);
        if (previewToggle) {
            previewToggle.disabled = selectedFiles.length === 0;
            previewToggle.textContent = previewTableOpen ? 'Tutup preview' : 'Preview tabel';
            previewToggle.setAttribute('aria-expanded', String(previewTableOpen));
        }
        if (getUploadType() === 'budget') {
            if (monthSelector) monthSelector.classList.add('hidden');
            if (modeNotice) modeNotice.textContent = '';
            if (previewHead) previewHead.innerHTML = '';
            renderBudgetPreview();
            if (previewWrap) previewWrap.classList.toggle('hidden', !previewTableOpen);
            return;
        }

        const { mode, selectedMonth, groups, totalRows, excludedWithoutDate, excludedOtherMonth, validationSummary } = getUploadGroups();
        const mappingIssues = selectedFiles.flatMap(item => {
            const missing = getReportMappingIssues(item);
            return missing.length ? [`${item.name}: pilih kolom ${missing.join(', ')}.`] : [];
        });
        const hasMissingIdentity = Boolean(validationSummary.missingAccount || validationSummary.missingProject);
        const periodIssue = getUploadPeriodIssue(selectedMonth);
        const overwrite = mode === 'overwrite';
        const updateSummary = overwrite ? null : previewUpdateGroups(groups);
        const selectedDepartments = [...new Set(selectedFiles.map(item => String(item.deptName || 'UMUM').trim().toUpperCase()))];
        const departmentSummary = selectedDepartments.map(dept => `${dept} ${(groups.get(dept) || []).length.toLocaleString('id-ID')}`).join(' · ') || '0 departemen dipilih';
        const validationAlerts = [];
        if (validationSummary.missingDate) validationAlerts.push(`${validationSummary.missingDate} baris tanpa tanggal`);
        if (validationSummary.missingAccount) validationAlerts.push(`${validationSummary.missingAccount} baris tanpa nama akun`);
        if (validationSummary.missingProject) validationAlerts.push(`${validationSummary.missingProject} baris tanpa proyek`);
        if (validationSummary.mismatchedDept) validationAlerts.push(`${validationSummary.mismatchedDept} baris departemen tidak cocok`);
        validationAlerts.push(...mappingIssues);
        if (periodIssue) validationAlerts.push(periodIssue);
        if (mode === 'update' && !selectedMonth) validationAlerts.push('Pilih bulan target sebelum menerapkan.');
        const approvalPolicy = SmartBaraCore.canApproveAllDepartments() ? '' : ' Hanya Superadmin yang dapat menerapkan upload.';

        if (monthSelector) monthSelector.classList.toggle('hidden', overwrite);
        const targetPeriod = getUploadTargetPeriod();
        if (modeNotice) {
            const baseText = overwrite
                ? `Timpa data ${selectedDepartments.length} departemen dengan ${totalRows.toLocaleString('id-ID')} transaksi.`
                : mode === 'add-department'
                    ? selectedMonth
                        ? `Tambah departemen baru ${selectedMonth}/${targetPeriod}: ${totalRows.toLocaleString('id-ID')} transaksi (${updateSummary.added.toLocaleString('id-ID')} baru). ${excludedOtherMonth.toLocaleString('id-ID')} di luar bulan/tahun dan ${excludedWithoutDate.toLocaleString('id-ID')} tanpa tanggal dilewati.`
                        : 'Pilih bulan target untuk melihat transaksi yang akan diimpor.'
                    : selectedMonth
                        ? `Tambahkan ${selectedMonth}/${targetPeriod}: ${totalRows.toLocaleString('id-ID')} transaksi (${updateSummary.added.toLocaleString('id-ID')} baru, ${updateSummary.updated.toLocaleString('id-ID')} berubah, ${updateSummary.unchanged.toLocaleString('id-ID')} sama). ${excludedOtherMonth.toLocaleString('id-ID')} di luar bulan/tahun dan ${excludedWithoutDate.toLocaleString('id-ID')} tanpa tanggal dilewati.`
                        : 'Pilih bulan target untuk melihat transaksi yang akan diimpor.';
            const validationText = validationAlerts.length
                ? ` Perlu diperiksa: ${validationAlerts.join(', ')}.`
                : ' Validasi otomatis lulus.';
            const badDataButton = hasMissingIdentity || validationAlerts.some(item => /tanpa|Perlu diperiksa/.test(item))
                ? ' <button type="button" onclick="SmartBaraUpload.showBadDataModal()" class="ml-1 inline-flex items-center rounded border border-rose-400/30 bg-rose-500/10 px-1.5 py-0.5 font-bold text-rose-200 hover:bg-rose-500/20">Lihat bad data</button>'
                : '';
            modeNotice.innerHTML = `${baseText}${validationText}${approvalPolicy}${badDataButton}`;
            modeNotice.className = `mt-2 mb-0 text-[11px] ${overwrite ? 'text-rose-300' : validationAlerts.length ? 'text-amber-300' : 'text-slate-400'}`;
        }
        if (submitButton) submitButton.textContent = overwrite ? 'Timpa Semua Data' : (mode === 'add-department' ? 'Tambahkan Departemen Baru' : 'Tambahkan ke Data');
        if (submitButton) submitButton.disabled = !totalRows || mappingIssues.length > 0 || Boolean(periodIssue) || hasMissingIdentity || (mode === 'update' && !selectedMonth);
        previewPanel.classList.toggle('hidden', selectedFiles.length === 0);
        if (previewSummary) {
            previewSummary.textContent = overwrite
                ? `${totalRows.toLocaleString('id-ID')} transaksi · ${departmentSummary}`
                : `${totalRows.toLocaleString('id-ID')} transaksi · ${departmentSummary} · ${updateSummary.added.toLocaleString('id-ID')} baru · ${updateSummary.updated.toLocaleString('id-ID')} berubah · ${updateSummary.unchanged.toLocaleString('id-ID')} sama`;
        }

        const rows = [...groups.entries()].flatMap(([dept, deptRows]) => deptRows.map(row => ({ ...row, dept })));
        const visible = rows.slice(0, 1000);
        if (previewHead) previewHead.innerHTML = '<th>Departemen</th><th>Tanggal</th><th>No Sumber</th><th>Akun</th><th>Proyek UP</th><th>Keterangan</th><th class="text-right">Debit</th><th class="text-right">Kredit</th><th class="text-right">Finance</th><th class="text-right">Nilai Rekonsil</th>';
        previewBody.innerHTML = visible.map(row => `
            <tr>
                <td>${SmartBaraFormatters.escapeHtml(row.dept)}</td>
                <td>${SmartBaraFormatters.escapeHtml(row.tanggal || '-')}</td>
                <td>${SmartBaraFormatters.escapeHtml(row.no_sumber || '-')}</td>
                <td>${SmartBaraFormatters.escapeHtml(row.nama_akun || '-')}</td>
                <td>${SmartBaraFormatters.escapeHtml(row.proyek || '-')}</td>
                <td>${SmartBaraFormatters.escapeHtml(row.keterangan || '-')}</td>
                <td class="text-right">${SmartBaraFormatters.formatRupiah(row.debit || 0)}</td>
                <td class="text-right">${SmartBaraFormatters.formatRupiah(row.kredit || 0)}</td>
                <td class="text-right">${SmartBaraFormatters.formatRupiah(row.finance || 0)}</td>
                <td class="text-right">${SmartBaraFormatters.formatRupiah(row.rekonsil || 0)}</td>
            </tr>
        `).join('') || '<tr><td colspan="10" class="py-6 text-center text-slate-500">Tidak ada data untuk mode dan bulan ini.</td></tr>';
        if (rows.length > visible.length && previewSummary) previewSummary.textContent += ` · menampilkan ${visible.length.toLocaleString('id-ID')} pertama`;
    }

    async function processBudgetUpload() {
        const progressArea = document.getElementById('uploadProgressArea');
        const progressBar = document.getElementById('uploadProgressBar');
        const statusText = document.getElementById('uploadStatusText');
        const submitBtn = document.getElementById('uploadSubmitButton');

        if (progressArea) progressArea.classList.remove('hidden');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"></span><span class="ml-2">Memproses budget...</span>';
        }

        try {
            const preview = buildBudgetPreviewData();
            if (preview.blocking.length) throw new Error(preview.blocking.join(' '));
            if (!preview.rows.length) throw new Error('Tidak ada data budget yang valid untuk diterapkan.');

            const targetPeriod = getUploadTargetPeriod();
            const kind = getBudgetKind();
            const tableName = kind === 'site' ? 'smartbara_budget_site' : 'smartbara_budget';
            const localKey = kind === 'site' ? `smartbara_budget_site_v2_${targetPeriod}` : `smartbara_budget_v2_${targetPeriod}`;
            const client = SmartBaraCore.getClient();
            if (!client) throw new Error('Koneksi cloud tidak tersedia.');

            const confirmed = await window.SmartBaraLayout.confirmDialog({
                title: 'Konfirmasi upload budget',
                message: `Terapkan ${preview.rows.length} baris budget (${preview.summary.baru} baru, ${preview.summary.berubah} berubah, ${preview.summary.sama} sama) ke periode ${targetPeriod}?`,
                confirmText: 'Terapkan Budget',
                cancelText: 'Batal',
                danger: false
            });
            if (!confirmed) return;

            if (!SmartBaraCore.canApproveAllDepartments()) {
                throw new Error('Hanya akun Superadmin yang dapat mengapprove perubahan data.');
            }

            if (budgetReferenceNeedsCloudMigration && budgetReferenceRows.length) {
                const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                const migratedRows = budgetReferenceRows.map(existing => {
                    if (!uuidPattern.test(String(existing.id || ''))) existing.id = crypto.randomUUID();
                    return {
                        id: existing.id,
                        period_name: targetPeriod,
                        nama: getBudgetRowName(existing),
                        dept: getBudgetRowDepartment(existing),
                        budget: BUDGET_MONTHS.map((month, index) => getExistingBudgetValue(existing, index)),
                        updated_at: new Date().toISOString()
                    };
                });
                for (const migratedRow of migratedRows) {
                    const { id, period_name: rowPeriod, ...values } = migratedRow;
                    await SmartBaraCore.syncVersionedRow(
                        tableName,
                        targetPeriod,
                        { id, period_name: rowPeriod },
                        values,
                        `budgetCache:${id}`,
                        'Pemulihan cache budget'
                    );
                }
                budgetReferenceNeedsCloudMigration = false;
            }

            const approvalRecord = SmartBaraCore.requireApprovalDecision(targetPeriod, {
                action: 'budget_upload',
                department_scope: 'ALL',
                total_rows: preview.rows.length,
                departments: [...new Set(preview.rows.map(row => row.department))]
            });

            if (statusText) statusText.textContent = 'Menyimpan budget ke database...';
            if (progressBar) progressBar.style.width = '30%';

            let inserted = 0;
            let updated = 0;
            let skipped = 0;
            const cloudErrors = [];
            const cacheRows = [];

            for (let i = 0; i < preview.rows.length; i++) {
                const row = preview.rows[i];
                const pct = Math.round(((i + 1) / preview.rows.length) * 100);
                if (statusText) statusText.textContent = `Memproses budget (${i + 1}/${preview.rows.length}): ${row.name}...`;
                if (progressBar) progressBar.style.width = `${Math.max(30, pct)}%`;
                await new Promise(resolve => requestAnimationFrame(resolve));

                const monthlyBudget = BUDGET_MONTHS.map(month => {
                    const value = row.monthlyValues?.[month.key];
                    if (Number.isFinite(value)) return value;
                    return row.existing ? getExistingBudgetValue(row.existing, BUDGET_MONTHS.indexOf(month)) : 0;
                });

                const rowId = row.status === 'berubah' && row.existing?.id
                    ? row.existing.id
                    : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `BGT-${Date.now()}-${i}`);

                const cloudValues = {
                    nama: row.name,
                    dept: row.department,
                    budget: monthlyBudget,
                    updated_at: new Date().toISOString()
                };

                if (row.status !== 'sama') {
                    cacheRows.push({
                        id: rowId,
                        period_name: targetPeriod,
                        nama: row.name,
                        dept: row.department,
                        budget: monthlyBudget
                    });
                }

                try {
                    if (row.status === 'baru') {
                        await SmartBaraCore.syncVersionedRow(
                            tableName,
                            targetPeriod,
                            { id: rowId, period_name: targetPeriod },
                            cloudValues,
                            `budget:${rowId}`,
                            'Upload budget'
                        );
                        inserted++;
                    } else if (row.status === 'berubah' && row.existing?.id) {
                        await SmartBaraCore.syncVersionedRow(
                            tableName,
                            targetPeriod,
                            { id: row.existing.id, period_name: targetPeriod },
                            cloudValues,
                            `budget:${row.existing.id}`,
                            'Upload budget'
                        );
                        updated++;
                    } else {
                        skipped++;
                    }
                } catch (cloudError) {
                    cloudErrors.push(cloudError.message || String(cloudError));
                    if (row.status === 'baru') inserted++;
                    else if (row.status === 'berubah') updated++;
                    else skipped++;
                }
            }

            if (statusText) statusText.textContent = 'Selesai! Menyinkronkan cache budget...';
            if (progressBar) progressBar.style.width = '90%';

            try {
                const mergedRows = new Map();
                budgetReferenceRows.forEach(row => {
                    const stableKey = String(row.id || `${getBudgetRowDepartment(row)}:${getBudgetRowName(row)}`);
                    mergedRows.set(stableKey, row);
                });
                cacheRows.forEach(row => mergedRows.set(String(row.id), row));
                localStorage.setItem(localKey, JSON.stringify([...mergedRows.values()]));
            } catch (cacheError) {
                console.warn('Gagal menyegarkan cache budget:', cacheError);
            }

            const approvalSummary = approvalRecord && approvalRecord.status === 'approved'
                ? ` | Disetujui oleh ${approvalRecord.approved_by} (${approvalRecord.approved_at})`
                : '';

            closeModal();
            if (cloudErrors.length) {
                alert(`Budget disimpan lokal untuk periode ${targetPeriod}: ${inserted} baru, ${updated} diperbarui, ${skipped} dilewati. Cloud gagal: ${cloudErrors[0]}. Periksa kolom tabel smartbara_budget/smartbara_budget_site (pastikan kolom "budget" JSONB ada) lalu reload schema Supabase.${approvalSummary}`);
            } else {
                alert(`Budget berhasil diterapkan untuk periode ${targetPeriod}: ${inserted} baru, ${updated} diperbarui, ${skipped} dilewati.${approvalSummary}`);
            }
            window.location.reload();
        } catch (err) {
            console.error('Process budget upload error:', err);
            alert('Terjadi kesalahan saat memproses budget: ' + err.message);
        } finally {
            isProcessing = false;
            if (progressArea) progressArea.classList.add('hidden');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Terapkan Budget';
            }
        }
    }

    async function processUpload() {
        if (selectedFiles.length === 0) {
            alert('Pilih minimal satu file Excel terlebih dahulu.');
            return;
        }

        if (isProcessing) return;
        isProcessing = true;

        const progressArea = document.getElementById('uploadProgressArea');
        const progressBar = document.getElementById('uploadProgressBar');
        const statusText = document.getElementById('uploadStatusText');
        const submitBtn = document.getElementById('uploadSubmitButton');

        if (progressArea) progressArea.classList.remove('hidden');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"></span><span class="ml-2">Memproses update...</span>';
        }

        const targetPeriod = getUploadTargetPeriod();
        let totalRowsAdded = 0;
        let totalRowsUpdated = 0;
        let totalRowsUnchanged = 0;
        let successfulDepts = 0;

        try {
            if (getUploadType() === 'budget') {
                await processBudgetUpload();
                return;
            }
            const { mode, selectedMonth, groups, totalRows, validationSummary } = getUploadGroups();
            const mappingIssues = selectedFiles.flatMap(item => {
                const missing = getReportMappingIssues(item);
                return missing.length ? [`${item.name}: ${missing.join(', ')}`] : [];
            });
            if (mappingIssues.length) throw new Error(`Pemetaan kolom wajib belum lengkap. ${mappingIssues.join('; ')}`);
            if (validationSummary.missingAccount || validationSummary.missingProject) {
                const missingParts = [];
                if (validationSummary.missingAccount) missingParts.push(`${validationSummary.missingAccount} baris tanpa nama akun`);
                if (validationSummary.missingProject) missingParts.push(`${validationSummary.missingProject} baris tanpa proyek`);
                throw new Error(`Data file belum valid: ${missingParts.join(' dan ')}. Perbaiki kolom akun/proyek sebelum upload.`);
            }
            const periodIssue = getUploadPeriodIssue(selectedMonth);
            if (periodIssue) throw new Error(periodIssue);
            if (mode === 'update' && !selectedMonth) throw new Error('Pilih bulan target sebelum menerapkan update.');
            if (!totalRows) throw new Error('Tidak ada transaksi yang sesuai untuk diimpor. Periksa pilihan bulan dan tanggal pada file.');
            if (mode === 'overwrite') {
                const confirmed = await window.SmartBaraLayout.confirmDialog({
                    title: 'Konfirmasi overwrite data',
                    message: `TIMPA SELURUH DATA: ${[...groups.keys()].join(', ')} pada periode ${targetPeriod} akan diganti dengan ${totalRows} transaksi. Lanjutkan?`,
                    confirmText: 'Overwrite',
                    cancelText: 'Batal',
                    danger: true
                });
                if (!confirmed) return;
            }

            if (!SmartBaraCore.canApproveAllDepartments()) {
                throw new Error('Hanya akun Superadmin yang dapat mengapprove perubahan data. Semua Superadmin dapat approve semua departemen.');
            }

            if (statusText) statusText.textContent = 'Memuat data periode terbaru sebelum menyimpan...';
            await SmartBaraCore.loadPeriodStore(targetPeriod, true, { showOverlay: false, throwOnError: true });

            const approvalRecord = SmartBaraCore.requireApprovalDecision(targetPeriod, {
                action: mode === 'overwrite' ? 'overwrite' : 'update',
                department_scope: 'ALL',
                total_rows: totalRows,
                departments: [...groups.keys()]
            });

            const currentDepartments = buildDepartmentStoreSnapshot(targetPeriod);

            for (let i = 0; i < selectedFiles.length; i++) {
                const item = selectedFiles[i];
                const pct = Math.round(((i + 1) / selectedFiles.length) * 100);

                if (statusText) statusText.textContent = `${mode === 'overwrite' ? 'Menimpa' : mode === 'add-department' ? 'Menambahkan departemen baru' : `Menambahkan bulan ${selectedMonth}`} (${i + 1}/${selectedFiles.length}): ${item.deptName}...`;
                if (progressBar) progressBar.style.width = `${pct}%`;
                await new Promise(resolve => requestAnimationFrame(resolve));
            }

            for (const [dept, uploadedRows] of groups) {
                const existingRows = Array.isArray(currentDepartments[dept]) ? currentDepartments[dept] : [];
                const merge = mode === 'overwrite'
                    ? { rows: uploadedRows, added: uploadedRows.length, updated: 0, unchanged: 0 }
                    : mergeUpdateTransactions(existingRows, uploadedRows, dept);
                if (mode === 'update' && merge.added === 0 && merge.updated === 0) {
                    totalRowsUnchanged += merge.unchanged;
                    continue;
                }
                await SmartBaraCore.saveDepartmentStore(targetPeriod, dept, merge.rows);
                currentDepartments[dept] = merge.rows;
                totalRowsAdded += merge.added;
                totalRowsUpdated += merge.updated;
                totalRowsUnchanged += merge.unchanged;
                successfulDepts++;
            }

            if (statusText) statusText.textContent = 'Selesai! Menyinkronkan ke Supabase Cloud...';

            const approvalSummary = approvalRecord && approvalRecord.status === 'approved'
                ? ` | Disetujui oleh ${approvalRecord.approved_by} (${approvalRecord.approved_at})`
                : '';

            closeModal();
            alert(mode === 'overwrite'
                ? `Berhasil menimpa data ${successfulDepts} departemen dengan ${totalRowsAdded} transaksi pada periode ${targetPeriod}.${approvalSummary}`
                : mode === 'add-department'
                    ? `Berhasil menambahkan ${successfulDepts} departemen baru dengan ${totalRowsAdded} transaksi pada periode ${targetPeriod}.${approvalSummary}`
                    : `Penambahan selesai untuk ${selectedMonth}/${targetPeriod}: ${totalRowsAdded} transaksi ditambahkan, ${totalRowsUpdated} diperbarui, ${totalRowsUnchanged} sudah sama. ${successfulDepts} departemen berubah.${approvalSummary}`);
            window.location.reload();
        } catch(err) {
            console.error('Process upload error:', err);
            alert('Terjadi kesalahan saat memproses data: ' + err.message);
        } finally {
            isProcessing = false;
            if (progressArea) progressArea.classList.add('hidden');
            if (submitBtn) {
                submitBtn.disabled = false;
                const overwrite = getUploadMode() === 'overwrite';
                const currentMode = getUploadMode();
                submitBtn.innerHTML = overwrite ? 'Timpa Semua Data' : (currentMode === 'add-department' ? 'Tambahkan Departemen Baru' : 'Tambahkan ke Data');
            }
        }
    }

    function getUploadRecord(row) {
        const fallbackMonthDate = resolveRowDate(row) || '';
        const tanggal = SmartBaraFormatters.normalizeDate(getUploadField(row, ['tanggal', 'date'])) || fallbackMonthDate;
        const namaAkun = String(getUploadField(row, ['nama akun up', 'nama akun induk', 'nama akun', 'account name', 'akun', 'nama akun manual', '_calcAkun', '_akunOverride']) || '').trim();
        const proyek = String(getUploadField(row, ['nama proyek up', 'proyek up', 'nama proyek', 'project name', 'proyek', 'proyek manual', '_calcProyek', '_proyekOverride']) || '').trim();
        const noSumber = String(getUploadField(row, ['no sumber', 'nomor sumber', 'no voucher', 'nomor voucher', 'no bukti', 'nomor bukti', 'referensi', 'reference', 'ref']) || '').trim();
        const keterangan = String(getUploadField(row, ['keterangan', 'deskripsi', 'uraian', 'rincian', 'memo']) || '').trim();
        const debit = getUploadNumber(row, ['debit', 'debet']);
        const kredit = getUploadNumber(row, ['kredit', 'credit']);
        const financeValue = getUploadField(row, ['finance', 'nilai finance', 'keuangan', 'sistem']);
        const finance = financeValue === undefined ? debit - kredit : SmartBaraFormatters.parseNumber(financeValue, 0);
        const reconcileValue = getUploadField(row, ['nilai rekonsil', 'nilai rekonsiliasi', 'nilai rekon', 'rekonsil', 'reconcile']);
        let rekonsil = reconcileValue === undefined ? finance : SmartBaraFormatters.parseNumber(reconcileValue, 0);
        if (rekonsil === 0 && finance !== 0) rekonsil = finance;
        return { tanggal, namaAkun, proyek, noSumber, keterangan, debit, kredit, finance, rekonsil };
    }

    function validateUploadRows(rows, deptName = 'UMUM') {
        const summary = {
            total: rows.length,
            valid: 0,
            missingDate: 0,
            missingAccount: 0,
            missingProject: 0,
            mismatchedDept: 0
        };
        const issues = [];

        rows.forEach(row => {
            const record = getUploadRecord(row);
            const issuesHere = [];
            if (!record.tanggal) {
                summary.missingDate++;
                issuesHere.push('tanggal');
            }
            if (!record.namaAkun) {
                summary.missingAccount++;
                issuesHere.push('nama akun');
            }
            if (!record.proyek) {
                summary.missingProject++;
                issuesHere.push('nama proyek');
            }

            const mappedDept = String((row?.dept || row?._department || deptName) || deptName).trim().toUpperCase();
            if (mappedDept && mappedDept !== String(deptName).trim().toUpperCase() && (record.namaAkun || record.proyek || record.noSumber)) {
                summary.mismatchedDept++;
                issuesHere.push('departemen');
            }

            if (!issuesHere.length) summary.valid++;
            else issues.push({ row, issues: issuesHere, record });
        });

        return { summary, issues };
    }

    function getUploadMergeKey(row, dept) {
        const record = getUploadRecord(row);
        const base = [dept, record.tanggal, record.namaAkun, record.proyek, record.keterangan];
        if (record.noSumber) base.splice(2, 0, record.noSumber);
        else base.push(record.debit, record.kredit);
        return JSON.stringify(base.map(value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')));
    }

    function areUploadRecordsEqual(left, right) {
        const a = getUploadRecord(left);
        const b = getUploadRecord(right);
        return ['tanggal', 'namaAkun', 'proyek', 'noSumber', 'keterangan', 'debit', 'kredit', 'finance', 'rekonsil']
            .every(key => a[key] === b[key]);
    }

    function mergeUpdateTransactions(existingRows, uploadedRows, dept) {
        const rows = [...(Array.isArray(existingRows) ? existingRows : [])];
        const existingIndexes = new Map();
        rows.forEach((row, index) => {
            const key = getUploadMergeKey(row, dept);
            const indexes = existingIndexes.get(key) || [];
            indexes.push(index);
            existingIndexes.set(key, indexes);
        });

        const uploadOccurrences = new Map();
        let added = 0;
        let updated = 0;
        let unchanged = 0;
        (uploadedRows || []).forEach(uploaded => {
            const key = getUploadMergeKey(uploaded, dept);
            const occurrence = uploadOccurrences.get(key) || 0;
            uploadOccurrences.set(key, occurrence + 1);
            const existingIndex = existingIndexes.get(key)?.[occurrence];
            if (existingIndex === undefined) {
                rows.push({
                    ...uploaded,
                    id: uploaded.id || SmartBaraCore.createTransactionId(uploaded, dept, occurrence + 1)
                });
                added++;
                return;
            }

            const existing = rows[existingIndex];
            if (areUploadRecordsEqual(existing, uploaded)) {
                unchanged++;
                return;
            }

            rows[existingIndex] = {
                ...existing,
                ...uploaded,
                id: existing.id || existing._uid || uploaded.id,
                adj_finance: existing.adj_finance ?? uploaded.adj_finance ?? 0,
                adj_rekonsil: existing.adj_rekonsil ?? uploaded.adj_rekonsil ?? 0
            };
            updated++;
        });

        return { rows, added, updated, unchanged };
    }

    function buildDepartmentStoreSnapshot(periodName = getUploadTargetPeriod()) {
        const snapshot = {};
        const activePeriod = String(periodName || '').trim();
        if (!activePeriod) return snapshot;

        try {
            const inMemoryStore = (activePeriod === String(SmartBaraCore.getActivePeriod() || '').trim())
                ? (SmartBaraCore.getDepartmentStore ? SmartBaraCore.getDepartmentStore() : null)
                : null;
            if (inMemoryStore && typeof inMemoryStore === 'object' && !Array.isArray(inMemoryStore)) {
                Object.entries(inMemoryStore).forEach(([dept, rows]) => {
                    if (Array.isArray(rows)) snapshot[String(dept || '').trim().toUpperCase()] = [...rows];
                });
                if (Object.keys(snapshot).length) return snapshot;
            }
        } catch (error) {
            console.warn('Unable to read in-memory department store while building snapshot:', activePeriod, error);
        }

        try {
            const stored = JSON.parse(localStorage.getItem(`smartbara_store_${activePeriod}`) || '{}');
            if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
                Object.entries(stored).forEach(([dept, rows]) => {
                    if (Array.isArray(rows)) snapshot[String(dept || '').trim().toUpperCase()] = [...rows];
                });
            }
        } catch (error) {
            console.warn('Unable to read current active-period store while building snapshot:', activePeriod, error);
        }

        return snapshot;
    }

    function previewUpdateGroups(groups) {
        const storedDepartments = buildDepartmentStoreSnapshot(getUploadTargetPeriod());

        return [...groups.entries()].reduce((summary, [dept, uploadedRows]) => {
            const existingRows = Array.isArray(storedDepartments[dept]) ? storedDepartments[dept] : [];
            const merge = mergeUpdateTransactions(existingRows, uploadedRows, dept);
            summary.added += merge.added;
            summary.updated += merge.updated;
            summary.unchanged += merge.unchanged;
            return summary;
        }, { added: 0, updated: 0, unchanged: 0 });
    }

    function parseExcelTransactions(rawRows, deptName) {
        const results = [];
        const identityCounts = new Map();

        rawRows.forEach((row, idx) => {
            const accountValue = getUploadField(row, ['nama akun up', 'nama akun induk', 'nama akun', 'account name', 'akun']);
            const projectValue = getUploadField(row, ['nama proyek up', 'proyek up', 'nama proyek', 'project name', 'proyek', 'project']);
            const rawSource = getUploadField(row, ['no sumber', 'nomor sumber', 'no voucher', 'nomor voucher', 'no bukti', 'nomor bukti', 'referensi', 'reference', 'ref']);
            const rawDescription = getUploadField(row, ['keterangan', 'deskripsi', 'uraian', 'rincian', 'memo']);
            const rawNote = getUploadField(row, ['catatan', 'note', 'koreksi']);
            const rawTanggal = getUploadField(row, ['tanggal', 'date']);
            const rawMonth = getUploadField(row, ['bulan', 'month', 'periode bulan', 'bulan transaksi']);
            const tanggal = SmartBaraFormatters.normalizeDate(rawTanggal) || inferDateFromMonthValue(rawMonth);
            const debit = getUploadNumber(row, ['debit', 'debet']);
            const kredit = getUploadNumber(row, ['kredit', 'credit']);
            const financeValue = getUploadField(row, ['finance', 'nilai finance', 'keuangan', 'sistem']);
            const finance = financeValue === undefined
                ? debit - kredit
                : SmartBaraFormatters.parseNumber(financeValue, 0);
            const reconcileValue = getUploadField(row, ['nilai rekonsil', 'nilai rekonsiliasi', 'nilai rekon', 'rekonsil', 'reconcile']);
            let rekonsil = reconcileValue === undefined
                ? finance
                : SmartBaraFormatters.parseNumber(reconcileValue, 0);
            if (rekonsil === 0 && finance !== 0) rekonsil = finance;
            const namaAkun = String(accountValue || '').trim();
            const proyek = String(projectValue || '').trim();
            const noSumber = String(rawSource || '').trim();
            const keterangan = String(rawDescription || '').trim();
            const catatan = String(rawNote || '').trim();
            const selisih = finance - rekonsil;

            if (!tanggal && !noSumber) return;

            const sourceForId = noSumber || [tanggal, namaAkun, proyek, keterangan, debit, kredit].join('|');
            const identity = [deptName, tanggal, namaAkun, proyek, sourceForId, keterangan, debit, kredit]
                .map(value => String(value || '').trim().toLowerCase())
                .join('|');
            const occurrence = (identityCounts.get(identity) || 0) + 1;
            identityCounts.set(identity, occurrence);
            const transactionId = SmartBaraCore.createTransactionId({ nama_akun: namaAkun, proyek, no_sumber: sourceForId, keterangan }, deptName, occurrence);
            results.push({
                id: transactionId,
                dept: deptName,
                tanggal: tanggal || '',
                nama_akun: namaAkun,
                proyek,
                no_sumber: noSumber,
                keterangan,
                catatan,
                debit,
                kredit,
                finance,
                adj_finance: 0,
                rekonsil,
                adj_rekonsil: 0,
                selisih
            });
        });

        return results;
    }


    function init() {
        // Pre-load SheetJS in the background for faster first-use experience
        if (window.SmartBaraConfig && window.SmartBaraConfig.ensureLibrary) {
            window.SmartBaraConfig.ensureLibrary('sheetjs').catch(() => {});
        }
    }

    return {
        init,
        openModal,
        closeModal,
        handleFileSelect,
        refreshPreview,
        collectBadDataRows,
        showBadDataModal,
        onDataTypeChange,
        onBudgetKindChange,
        toggleTablePreview,
        openHeaderMapping,
        changeHeaderMappingBlock,
        autoDetectHeaderMapping,
        saveHeaderMapping,
        closeHeaderMapping,
        updateFileDept,
        updateFileSheet,
        removeFile,
        clearAllFiles,
        processUpload
    };
})();

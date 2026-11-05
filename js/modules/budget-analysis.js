window.BudgetAnalysisModule = (function() {
    let rows = [];
    let period = '';
    const expandedRows = new Set();
    const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    function getPeriodYear(value) {
        const match = String(value || '').match(/(\d{4})/);
        return match ? Number(match[1]) : new Date().getFullYear();
    }

    function getMonth(value) {
        const normalized = window.SmartBaraFormatters.normalizeDate(value);
        if (!normalized) return null;
        const match = normalized.match(/^(\d{4})-(\d{2})/);
        return match ? Number(match[2]) : null;
    }

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
        return value === undefined ? 0 : window.SmartBaraFormatters.parseNumber(value, 0);
    }

    function getElapsedMonths(periodValue, transactions, year) {
        const periodText = ` ${String(periodValue || '').toLowerCase().replace(/[^a-z]/g, ' ')} `;
        const monthAliases = [
            ['januari', 'jan'], ['februari', 'feb'], ['maret', 'mar'], ['april', 'apr'],
            ['mei', 'may'], ['juni', 'jun'], ['juli', 'jul'], ['agustus', 'agu', 'agt', 'aug'],
            ['september', 'sep'], ['oktober', 'okt', 'oct'], ['november', 'nov'], ['desember', 'des', 'dec']
        ];
        for (let monthIndex = 0; monthIndex < monthAliases.length; monthIndex++) {
            if (monthAliases[monthIndex].some(alias => periodText.includes(` ${alias} `))) return monthIndex + 1;
        }

        let latestObservedMonth = 0;
        (transactions || []).forEach(transaction => {
            const date = window.SmartBaraFormatters.normalizeDate(getTransactionField(transaction, ['tanggal', 'date']));
            if (!date || Number(date.slice(0, 4)) !== year) return;
            latestObservedMonth = Math.max(latestObservedMonth, Number(date.slice(5, 7)) || 0);
        });
        return latestObservedMonth || 12;
    }

    function buildAnalysis(transactions) {
        const year = getPeriodYear(period);
        const elapsedMonths = getElapsedMonths(period, transactions, year);
        const grouped = new Map();
        transactions.forEach(transaction => {
            const dept = String(getTransactionField(transaction, ['dept', '_department', 'Nama Dept', 'Nama Dept.(Up)']) || 'UMUM').trim();
            const account = String(getTransactionField(transaction, ['nama_akun_manual', '_calcAkun', '_akunOverride', 'Nama Akun UP', 'Nama Akun Induk', 'Nama Akun', 'akun']) || 'Lain-lain').trim();
            const key = `${dept.toLowerCase()}|${account.toLowerCase()}`;
            const entry = grouped.get(key) || {
                dept,
                account,
                actual: 0,
                months: new Set(),
                monthlyValues: Array(12).fill(0),
                monthlyCounts: Array(12).fill(0),
                hasUndated: false
            };
            const date = getTransactionField(transaction, ['tanggal', 'date']);
            const normalizedDate = window.SmartBaraFormatters.normalizeDate(date);
            const transactionYear = Number(normalizedDate?.slice(0, 4));
            if (transactionYear && transactionYear !== year) return;
            const reconcile = getTransactionNumber(transaction, ['rekonsil', 'nilai rekonsil', 'nilai rekonsiliasi', 'reconcile']);
            const reconcileAdjustment = getTransactionNumber(transaction, ['adj_rekonsil']);
            const financeValue = getTransactionField(transaction, ['finance']);
            const finance = financeValue !== undefined
                ? window.SmartBaraFormatters.parseNumber(financeValue, 0)
                : getTransactionNumber(transaction, ['debit', 'debet']) - getTransactionNumber(transaction, ['kredit', 'credit']);
            const financeWithAdjustment = finance + getTransactionNumber(transaction, ['adj_finance']);
            const recordedValue = reconcile !== 0 || reconcileAdjustment !== 0 ? reconcile + reconcileAdjustment : financeWithAdjustment;
            entry.actual += recordedValue;
            const month = getMonth(date);
            if (month) {
                entry.months.add(month);
                entry.monthlyValues[month - 1] += recordedValue;
                entry.monthlyCounts[month - 1]++;
            }
            else entry.hasUndated = true;
            grouped.set(key, entry);
        });

        const rate = Number(document.getElementById('analysisRate')?.value) || 0;
        rows = [...grouped.values()].map(entry => {
            const observedMonths = entry.months.size;
            const average = entry.actual / elapsedMonths;
            const forecast = average * 12;
            const id = `${entry.dept.toLowerCase()}|${entry.account.toLowerCase()}`;
            return { ...entry, id, observedMonths, average, forecast, adjustedForecast: forecast * (1 + rate / 100) };
        }).sort((a, b) => a.dept.localeCompare(b.dept) || a.account.localeCompare(b.account));
        render();
    }

    async function init() {
        period = window.SmartBaraCore.getActivePeriod();
        window.addEventListener('smartbara:period_change', async event => {
            period = event.detail?.period || window.SmartBaraCore.getActivePeriod();
            await update(false);
        });
        window.addEventListener('smartbara:dept_filter_change', () => update(false));
        window.addEventListener('smartbara:store_loaded', event => {
            if (event.detail?.period === period) update(false);
        });
        window.addEventListener('smartbara:store_updated', event => {
            if (event.detail?.period === period) update(false);
        });
        document.getElementById('analysisRate')?.addEventListener('input', () => {
            rows.forEach(row => row.adjustedForecast = row.forecast * (1 + (Number(document.getElementById('analysisRate').value) || 0) / 100));
            render();
        });
        await update(false);
    }

    async function update(forceReload = true) {
        const button = document.getElementById('analysisUpdateButton');
        const status = document.getElementById('analysisStatus');
        if (button) button.disabled = true;
        if (status) status.textContent = `Memperbarui analisa periode ${period}...`;
        try {
            if (forceReload) await window.SmartBaraCore.loadPeriodStore(period, true);
            buildAnalysis(window.SmartBaraCore.getAllTransactions());
            const lastUpdated = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            if (status) status.textContent = `${rows.length} akun · data diperbarui ${lastUpdated}. Tautan berita membuka hasil terbaru online.`;
        } catch (error) {
            if (status) status.textContent = `Gagal memperbarui: ${error.message}`;
        } finally {
            if (button) button.disabled = false;
        }
    }

    function render() {
        const tbody = document.getElementById('analysisTableBody');
        if (!tbody) return;
        const query = (document.getElementById('analysisSearch')?.value || '').trim().toLowerCase();
        const filtered = rows.filter(row => `${row.account} ${row.dept}`.toLowerCase().includes(query));
        const actualTotal = rows.reduce((sum, row) => sum + row.actual, 0);
        const forecastTotal = rows.reduce((sum, row) => sum + row.forecast, 0);
        const adjustedTotal = rows.reduce((sum, row) => sum + row.adjustedForecast, 0);
        document.getElementById('analysisAccountCount').textContent = rows.length.toLocaleString('id-ID');
        document.getElementById('analysisActualTotal').textContent = window.SmartBaraFormatters.formatRupiah(actualTotal);
        document.getElementById('analysisForecastTotal').textContent = window.SmartBaraFormatters.formatRupiah(forecastTotal);
        document.getElementById('analysisAdjustedTotal').textContent = window.SmartBaraFormatters.formatRupiah(adjustedTotal);
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="py-10 text-center text-slate-500">Tidak ada transaksi untuk dianalisa pada periode ini.</td></tr>';
            return;
        }
        tbody.innerHTML = filtered.map(row => {
            const newsQuery = encodeURIComponent(`${row.account} ${row.dept} kenaikan harga biaya Indonesia`);
            const newsUrl = `https://news.google.com/search?q=${newsQuery}&hl=id&gl=ID&ceid=ID%3Aid`;
            const monthsLabel = row.observedMonths ? `${row.observedMonths} / 12` : 'Tidak diketahui';
            const isExpanded = expandedRows.has(row.id);
            const monthDetails = MONTH_NAMES.map((monthName, index) => row.monthlyCounts[index] ? `
                <tr>
                    <td class="px-3 py-2 text-slate-200">${monthName}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-slate-400">${row.monthlyCounts[index].toLocaleString('id-ID')}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-teal-300">${window.SmartBaraFormatters.formatRupiah(row.monthlyValues[index])}</td>
                </tr>
            ` : '').join('');
            return `<tr class="hover:bg-white/[0.03]">
                <td class="font-bold text-white">${window.SmartBaraFormatters.escapeHtml(row.account)}</td>
                <td class="text-slate-400">${window.SmartBaraFormatters.escapeHtml(row.dept)}</td>
                <td class="text-right tabular-nums">${window.SmartBaraFormatters.formatRupiah(row.actual)}</td>
                <td class="text-center">
                    <button type="button" data-analysis-month-toggle="${encodeURIComponent(row.id)}" aria-expanded="${isExpanded}" ${row.observedMonths ? '' : 'disabled'} class="font-semibold text-teal-300 underline decoration-dotted underline-offset-4 disabled:cursor-not-allowed disabled:text-slate-500">${monthsLabel}</button>
                </td>
                <td class="text-right tabular-nums text-slate-300">${window.SmartBaraFormatters.formatRupiah(row.average)}</td>
                <td class="text-right tabular-nums text-amber-300">${window.SmartBaraFormatters.formatRupiah(row.forecast)}</td>
                <td class="text-right tabular-nums font-bold text-teal-300">${window.SmartBaraFormatters.formatRupiah(row.adjustedForecast)}</td>
                <td class="text-center"><a href="${newsUrl}" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-sky-300 hover:text-sky-200 underline">Cari berita</a></td>
            </tr>${isExpanded ? `<tr class="bg-slate-950/40"><td colspan="8" class="px-3 py-3"><table class="w-full text-xs"><thead><tr class="border-b border-white/10 text-slate-400"><th class="px-3 py-2 text-left">Bulan Tercatat</th><th class="px-3 py-2 text-right">Jumlah Transaksi</th><th class="px-3 py-2 text-right">Nilai Rekonsil</th></tr></thead><tbody>${monthDetails}</tbody></table></td></tr>` : ''}`;
        }).join('');
        tbody.querySelectorAll('[data-analysis-month-toggle]').forEach(button => {
            button.addEventListener('click', () => {
                const id = decodeURIComponent(button.dataset.analysisMonthToggle || '');
                if (expandedRows.has(id)) expandedRows.delete(id);
                else expandedRows.add(id);
                render();
            });
        });
    }

    async function exportToExcel() {
        if (!rows.length) {
            alert('Tidak ada data analisa untuk diekspor.');
            return;
        }
        await window.SmartBaraConfig.ensureLibrary('exceljs');
        if (typeof ExcelJS === 'undefined') {
            alert('Modul ExcelJS sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Smart BARA';
        workbook.created = new Date();
        const rate = Number(document.getElementById('analysisRate')?.value) || 0;
        const actualTotal = rows.reduce((sum, row) => sum + row.actual, 0);
        const forecastTotal = rows.reduce((sum, row) => sum + row.forecast, 0);
        const adjustedTotal = rows.reduce((sum, row) => sum + row.adjustedForecast, 0);
        const moneyFormat = '"Rp "#,##0';
        const titleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        const titleFont = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
        const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };

        const summarySheet = workbook.addWorksheet('Ringkasan', { views: [{ state: 'frozen', ySplit: 5 }] });
        summarySheet.mergeCells('A1:D1');
        summarySheet.getCell('A1').value = `SMART BARA | ANALISA KENAIKAN BUDGET (${period})`;
        summarySheet.getCell('A1').font = titleFont;
        summarySheet.getCell('A1').fill = titleFill;
        summarySheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
        summarySheet.getRow(1).height = 32;
        summarySheet.addRow(['Periode', period, 'Asumsi kenaikan', rate / 100]);
        summarySheet.getCell('D2').numFmt = '0.0%';
        summarySheet.mergeCells('A3:D3');
        summarySheet.getCell('A3').value = 'Ekspor mencakup seluruh akun hasil analisa periode aktif, tidak terpengaruh pencarian pada tabel.';
        summarySheet.getCell('A3').font = { italic: true, color: { argb: 'FF475569' } };
        summarySheet.mergeCells('A4:D4');
        summarySheet.getCell('A4').value = 'Rincian bulanan hanya memuat transaksi bertanggal; nilai aktual utama dapat mencakup transaksi tanpa tanggal.';
        summarySheet.getCell('A4').font = { italic: true, color: { argb: 'FF475569' } };
        const summaryHeader = summarySheet.addRow(['Indikator', 'Nilai', 'Keterangan', '']);
        summaryHeader.font = headerFont;
        summaryHeader.fill = headerFill;
        summaryHeader.alignment = { vertical: 'middle', horizontal: 'center' };
        summaryHeader.height = 24;
        const summaryRows = [
            ['Akun dianalisa', rows.length, 'Jumlah akun dan departemen yang masuk dalam perhitungan.'],
            ['Aktual tercatat', actualTotal, 'Total nilai aktual dari transaksi periode analisa.'],
            ['Estimasi akhir tahun', forecastTotal, 'Proyeksi tahunan berdasarkan rata-rata bulanan.'],
            ['Rencana + asumsi', adjustedTotal, `Estimasi akhir tahun setelah asumsi kenaikan ${rate}%.`]
        ];
        summaryRows.forEach((values, index) => {
            const row = summarySheet.addRow(values);
            row.alignment = { vertical: 'middle' };
            if (index % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            if (index > 0) row.getCell(2).numFmt = moneyFormat;
            row.getCell(2).font = { bold: true, color: { argb: index === 3 ? 'FF0F766E' : 'FF0F172A' } };
        });
        summarySheet.columns = [{ width: 28 }, { width: 24 }, { width: 78 }, { width: 22 }];

        const analysisSheet = workbook.addWorksheet('Analisa per Akun', {
            views: [{ state: 'frozen', ySplit: 4 }],
            pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        analysisSheet.mergeCells('A1:J1');
        analysisSheet.getCell('A1').value = `SMART BARA | ANALISA PER AKUN (${period})`;
        analysisSheet.getCell('A1').font = titleFont;
        analysisSheet.getCell('A1').fill = titleFill;
        analysisSheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
        analysisSheet.getRow(1).height = 32;
        analysisSheet.addRow(['Periode', period, 'Asumsi kenaikan', rate / 100]);
        analysisSheet.getCell('D2').numFmt = '0.0%';
        analysisSheet.mergeCells('A3:J3');
        analysisSheet.getCell('A3').value = 'Proyeksi akhir tahun = aktual tercatat ÷ bulan berjalan × 12; proyeksi asumsi = proyeksi akhir tahun × (1 + asumsi kenaikan).';
        analysisSheet.getCell('A3').font = { italic: true, color: { argb: 'FF475569' } };
        const analysisHeader = analysisSheet.addRow([
            'Departemen', 'Nama Akun', 'Aktual Tercatat', 'Bulan Tercatat', 'Rata-rata / Bulan',
            'Estimasi Akhir Tahun', 'Proyeksi + Asumsi', 'Selisih vs Aktual', 'Asumsi Kenaikan', 'Cari Berita'
        ]);
        analysisHeader.font = headerFont;
        analysisHeader.fill = headerFill;
        analysisHeader.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        analysisHeader.height = 34;

        rows.forEach((item, index) => {
            const newsQuery = encodeURIComponent(`${item.account} ${item.dept} kenaikan harga biaya Indonesia`);
            const newsUrl = `https://news.google.com/search?q=${newsQuery}&hl=id&gl=ID&ceid=ID%3Aid`;
            const dataRow = analysisSheet.addRow([
                item.dept,
                item.account,
                item.actual,
                item.observedMonths,
                item.average,
                item.forecast,
                item.adjustedForecast,
                item.adjustedForecast - item.actual,
                rate / 100,
                { text: 'Cari berita', hyperlink: newsUrl }
            ]);
            dataRow.alignment = { vertical: 'middle' };
            if (index % 2 === 1) dataRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            [3, 5, 6, 7, 8].forEach(column => { dataRow.getCell(column).numFmt = moneyFormat; });
            dataRow.getCell(9).numFmt = '0.0%';
            dataRow.getCell(7).font = { bold: true, color: { argb: 'FF0F766E' } };
            dataRow.getCell(10).font = { color: { argb: 'FF0284C7' }, underline: true };
        });
        const totalRow = analysisSheet.addRow(['TOTAL', '', actualTotal, '', '', forecastTotal, adjustedTotal, adjustedTotal - actualTotal, rate / 100, '']);
        totalRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF134E4A' } };
        [3, 6, 7, 8].forEach(column => { totalRow.getCell(column).numFmt = moneyFormat; });
        totalRow.getCell(9).numFmt = '0.0%';
        analysisSheet.autoFilter = { from: 'A4', to: `J${analysisSheet.rowCount}` };
        analysisSheet.columns = [
            { width: 18 }, { width: 32 }, { width: 20 }, { width: 16 }, { width: 20 },
            { width: 22 }, { width: 22 }, { width: 20 }, { width: 18 }, { width: 16 }
        ];

        const detailSheet = workbook.addWorksheet('Rincian Bulanan', {
            views: [{ state: 'frozen', ySplit: 4 }],
            pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        detailSheet.mergeCells('A1:E1');
        detailSheet.getCell('A1').value = `SMART BARA | RINCIAN BULANAN (${period})`;
        detailSheet.getCell('A1').font = titleFont;
        detailSheet.getCell('A1').fill = titleFill;
        detailSheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
        detailSheet.getRow(1).height = 32;
        detailSheet.addRow(['Periode', period, 'Asumsi kenaikan', rate / 100]);
        detailSheet.getCell('D2').numFmt = '0.0%';
        detailSheet.mergeCells('A3:E3');
        detailSheet.getCell('A3').value = 'Bulan tanpa tanggal transaksi tidak ditampilkan pada rincian ini.';
        detailSheet.getCell('A3').font = { italic: true, color: { argb: 'FF475569' } };
        const detailHeader = detailSheet.addRow(['Departemen', 'Nama Akun', 'Bulan', 'Jumlah Transaksi', 'Nilai Rekonsil']);
        detailHeader.font = headerFont;
        detailHeader.fill = headerFill;
        detailHeader.alignment = { vertical: 'middle', horizontal: 'center' };
        detailHeader.height = 24;
        rows.forEach(item => {
            item.monthlyCounts.forEach((count, index) => {
                if (!count) return;
                const dataRow = detailSheet.addRow([item.dept, item.account, MONTH_NAMES[index], count, item.monthlyValues[index]]);
                dataRow.getCell(4).numFmt = '#,##0';
                dataRow.getCell(5).numFmt = moneyFormat;
                dataRow.alignment = { vertical: 'middle' };
                if (detailSheet.rowCount % 2 === 1) dataRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            });
        });
        detailSheet.autoFilter = { from: 'A4', to: `E${detailSheet.rowCount}` };
        detailSheet.columns = [{ width: 18 }, { width: 32 }, { width: 18 }, { width: 20 }, { width: 24 }];

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `SmartBARA_Analisa_Kenaikan_Budget_${String(period).replace(/[^a-z0-9_-]+/gi, '_')}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
    }

    return { init, render, update, exportToExcel };
})();

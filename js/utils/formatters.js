// ==============================================================================
// SMART BARA 7.10 HZ - DATA FORMATTERS & UTILITIES
// ==============================================================================
window.SmartBaraFormatters = {
    _rupiah: new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }),

    _number: new Intl.NumberFormat('id-ID', {
        maximumFractionDigits: 2
    }),

    formatRupiah(val) {
        const num = Number(val) || 0;
        return this._rupiah.format(num);
    },

    formatNumber(val) {
        const num = Number(val) || 0;
        return this._number.format(num);
    },

    formatIndoDate(val) {
        if (!val) return '-';
        try {
            const d = new Date(val);
            if (isNaN(d.getTime())) return String(val);
            return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch(e) { return String(val); }
    },

    parseNumber(val, defaultVal = 0) {
        if (val === null || val === undefined || val === '') return defaultVal;
        if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
        let s = String(val).trim().replace(/[^0-9.,-]/g, '');
        if (!s) return defaultVal;
        // Handle Indonesian format: 1.000.000,00
        if (/\.\d{3}/.test(s) && s.includes(',')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else if (/\.\d{3}/.test(s) && !s.includes(',')) {
            // 1.000.000 (no comma)
            s = s.replace(/\./g, '');
        } else if (/,\d{3}/.test(s) && !s.includes('.')) {
            // 1,000,000 (US format with commas)
            s = s.replace(/,/g, '');
        } else if (s.includes(',')) {
            // Decimal comma: 12,5
            s = s.replace(',', '.');
        }
        const num = Number(s);
        return isNaN(num) ? defaultVal : num;
    },

    normalizeDate(val) {
        if (!val) return null;
        if (val instanceof Date && !isNaN(val)) return val.toISOString().slice(0, 10);
        // Excel date serial number
        if (typeof val === 'number' && val > 20000 && val < 90000) {
            const d = new Date(Math.round((val - 25569) * 86400 * 1000));
            if (!isNaN(d)) return d.toISOString().slice(0, 10);
        }
        const str = String(val).trim();
        if (!str) return null;
        if (/^\d{5}$/.test(str)) {
            const num = Number(str);
            const d = new Date(Math.round((num - 25569) * 86400 * 1000));
            if (!isNaN(d)) return d.toISOString().slice(0, 10);
        }
        // ISO yyyy-mm-dd or yyyy/mm/dd
        const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (isoMatch) return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
        // DD/MM/YYYY or DD-MM-YYYY (Indonesian)
        const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (dmyMatch) return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
        const namedDateMatch = str.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
        if (namedDateMatch) {
            const monthNames = {
                januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3,
                april: 4, apr: 4, mei: 5, may: 5, juni: 6, jun: 6,
                juli: 7, jul: 7, agustus: 8, agu: 8, agt: 8, agst: 8, agts: 8, ags: 8, aug: 8,
                september: 9, sep: 9, oktober: 10, okt: 10, oct: 10,
                november: 11, nov: 11, desember: 12, des: 12, dec: 12
            };
            const day = Number(namedDateMatch[1]);
            const month = monthNames[namedDateMatch[2].toLowerCase()];
            const year = Number(namedDateMatch[3]);
            if (month) {
                const date = new Date(Date.UTC(year, month - 1, day));
                if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
                    return date.toISOString().slice(0, 10);
                }
            }
        }
        const parsed = new Date(str);
        if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
        return null;
    },

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};

// Backward compat alias
window.Formatters = window.SmartBaraFormatters;

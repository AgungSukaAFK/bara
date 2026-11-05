// ==============================================================================
// SMART BARA 7.10 HZ - CONFIGURATION & CONSTANTS
// ==============================================================================
window.SMART_BARA_CONFIG = {
    APP_NAME: 'Smart BARA',
    APP_VERSION: '7.10 HZ',
    SUBTITLE: 'Enterprise Consolidation & Multi-User Planning System',

    // Supabase project GOA (dipakai bersama aplikasi GOA)
    SUPABASE_URL: 'https://cjspxjtbgrumfklhewkf.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_Nx2dMQeYYas_U4yqbBxZoQ_FiOucSzJ',

    DEFAULT_PERIOD: 'GMI- SEPTEMBER 2026',
    BUDGET_AI_FUNCTION: 'budget-ai',

    // Dynamic CDN Libraries (lazy-loaded on demand)
    LIBRARIES: {
        sheetjs: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        xlsx:    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
        pptx: 'https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS/dist/pptxgen.bundle.js',
        chartjs: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
        chart:   'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
        jspdf:   'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/dist/jspdf.umd.min.js',
        'html-to-image': 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js'
    }
};

/**
 * Lazy-load a third-party library by name key.
 * Resolves immediately if already available on window.
 * @param {string} name - Library key from SMART_BARA_CONFIG.LIBRARIES
 * @returns {Promise<void>}
 */
window.SmartBaraConfig = {
    ensureLibrary(name) {
        const libUrl = window.SMART_BARA_CONFIG.LIBRARIES[name];
        if (!libUrl) return Promise.reject(new Error(`Library "${name}" tidak terdaftar di config.`));

        const isLoaded = () => {
            if (name === 'xlsx' || name === 'sheetjs') return Boolean(window.XLSX);
            if (name === 'exceljs') return Boolean(window.ExcelJS);
            if (name === 'pptx') return Boolean(window.PptxGenJS || window.pptxgen);
            if (name === 'chartjs' || name === 'chart') return Boolean(window.Chart);
            if (name === 'jspdf') return Boolean(window.jspdf?.jsPDF);
            if (name === 'html-to-image') return Boolean(window.htmlToImage?.toPng);
            return false;
        };

        if (isLoaded()) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${libUrl}"]`);
            if (existing) {
                // Script tag exists but may still be loading
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error(`Gagal memuat ${name}`)));
                if (isLoaded()) resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = libUrl;
            script.async = true;
            script.onload = () => isLoaded() ? resolve() : reject(new Error(`Script ${name} dimuat tapi global belum tersedia`));
            script.onerror = () => reject(new Error(`Gagal mendownload library: ${name}`));
            document.head.appendChild(script);
        });
    }
};

// Backward compat
window.ensureLibrary = (name) => window.SmartBaraConfig.ensureLibrary(name);

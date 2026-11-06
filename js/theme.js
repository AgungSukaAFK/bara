// ==============================================================================
// SMART BARA - KONFIGURASI TEMA
// Tema "hz"     : tampilan asli Smart BARA (selalu gelap).
// Tema "normal" : tampilan bersih dan profesional, mendukung mode terang & gelap.
//
// Warna Tailwind dibungkus CSS variable dengan nilai asli sebagai fallback, jadi
// tema HZ tidak berubah. Tema Normal cukup mengganti nilai variabelnya, tanpa perlu
// menyentuh class warna di HTML/JS. Warna teks punya variabel terpisah (--sb-t-*)
// dari warna latar/border (--sb-c-*), karena keduanya berubah berbeda di mode terang.
//
// File ini harus dimuat tepat setelah script Tailwind CDN di <head>.
// Komponen dan styling tema Normal ada di css/themes.css.
// ==============================================================================

window.SmartBaraTheme = (function() {
    const THEME_KEY = 'smartbara_theme';
    const MODE_KEY = 'smartbara_mode';
    const CHANGE_EVENT = 'smartbara:themechange';
    const DEFAULT_THEME = 'hz';
    const DEFAULT_MODE = 'system';

    const THEMES = [
        { id: 'hz', label: 'HZ', description: 'Tampilan khas Smart BARA', supportsMode: false },
        { id: 'normal', label: 'Normal', description: 'Bersih dan profesional', supportsMode: true }
    ];
    const MODES = [
        { id: 'light', label: 'Terang' },
        { id: 'dark', label: 'Gelap' },
        { id: 'system', label: 'Sistem' }
    ];

    // Area yang selalu memakai palet asli: deck presentasi (ikut terekspor ke PPTX dengan
    // latar gelap) dan elemen yang ditandai .sb-palette-fixed.
    const FIXED_PALETTE_SELECTOR = '#dashboardPresentationModal, .sb-palette-fixed';
    const NORMAL_SELECTOR = 'html[data-sb-theme="normal"]';
    const INTER_FONT_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';

    const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    // Palet resmi Tailwind v3, urut sesuai SHADES.
    const TAILWIND_PALETTE = {
        slate: 'f8fafc f1f5f9 e2e8f0 cbd5e1 94a3b8 64748b 475569 334155 1e293b 0f172a 020617',
        gray: 'f9fafb f3f4f6 e5e7eb d1d5db 9ca3af 6b7280 4b5563 374151 1f2937 111827 030712',
        zinc: 'fafafa f4f4f5 e4e4e7 d4d4d8 a1a1aa 71717a 52525b 3f3f46 27272a 18181b 09090b',
        neutral: 'fafafa f5f5f5 e5e5e5 d4d4d4 a3a3a3 737373 525252 404040 262626 171717 0a0a0a',
        stone: 'fafaf9 f5f5f4 e7e5e4 d6d3d1 a8a29e 78716c 57534e 44403c 292524 1c1917 0c0a09',
        red: 'fef2f2 fee2e2 fecaca fca5a5 f87171 ef4444 dc2626 b91c1c 991b1b 7f1d1d 450a0a',
        orange: 'fff7ed ffedd5 fed7aa fdba74 fb923c f97316 ea580c c2410c 9a3412 7c2d12 431407',
        amber: 'fffbeb fef3c7 fde68a fcd34d fbbf24 f59e0b d97706 b45309 92400e 78350f 451a03',
        yellow: 'fefce8 fef9c3 fef08a fde047 facc15 eab308 ca8a04 a16207 854d0e 713f12 422006',
        lime: 'f7fee7 ecfccb d9f99d bef264 a3e635 84cc16 65a30d 4d7c0f 3f6212 365314 1a2e05',
        green: 'f0fdf4 dcfce7 bbf7d0 86efac 4ade80 22c55e 16a34a 15803d 166534 14532d 052e16',
        emerald: 'ecfdf5 d1fae5 a7f3d0 6ee7b7 34d399 10b981 059669 047857 065f46 064e3b 022c22',
        teal: 'f0fdfa ccfbf1 99f6e4 5eead4 2dd4bf 14b8a6 0d9488 0f766e 115e59 134e4a 042f2e',
        cyan: 'ecfeff cffafe a5f3fc 67e8f9 22d3ee 06b6d4 0891b2 0e7490 155e75 164e63 083344',
        sky: 'f0f9ff e0f2fe bae6fd 7dd3fc 38bdf8 0ea5e9 0284c7 0369a1 075985 0c4a6e 082f49',
        blue: 'eff6ff dbeafe bfdbfe 93c5fd 60a5fa 3b82f6 2563eb 1d4ed8 1e40af 1e3a8a 172554',
        indigo: 'eef2ff e0e7ff c7d2fe a5b4fc 818cf8 6366f1 4f46e5 4338ca 3730a3 312e81 1e1b4b',
        violet: 'f5f3ff ede9fe ddd6fe c4b5fd a78bfa 8b5cf6 7c3aed 6d28d9 5b21b6 4c1d95 2e1065',
        purple: 'faf5ff f3e8ff e9d5ff d8b4fe c084fc a855f7 9333ea 7e22ce 6b21a8 581c87 3b0764',
        fuchsia: 'fdf4ff fae8ff f5d0fe f0abfc e879f9 d946ef c026d3 a21caf 86198f 701a75 4a044e',
        pink: 'fdf2f8 fce7f3 fbcfe8 f9a8d4 f472b6 ec4899 db2777 be185d 9d174d 831843 500724',
        rose: 'fff1f2 ffe4e6 fecdd3 fda4af fb7185 f43f5e e11d48 be123c 9f1239 881337 4c0519'
    };

    // Skala abu-abu tema Normal. c = latar/border, t = teks. Format: "R G B".
    const NORMAL_NEUTRALS = {
        light: {
            c: {
                white: '15 23 42',
                50: '15 23 42', 100: '30 41 59', 200: '51 65 85', 300: '71 85 105', 400: '100 116 139', 500: '148 163 184',
                600: '203 213 225', 700: '226 232 240', 800: '241 245 249', 900: '255 255 255', 950: '241 245 249'
            },
            t: {
                white: '15 23 42',
                50: '15 23 42', 100: '15 23 42', 200: '30 41 59', 300: '51 65 85', 400: '71 85 105', 500: '84 98 120',
                600: '100 116 139'
            }
        },
        dark: {
            c: {
                400: '139 148 163', 500: '100 109 124', 600: '74 82 95', 700: '51 57 68', 800: '35 40 49',
                900: '25 29 36', 950: '16 19 24'
            },
            t: {
                white: '236 239 243',
                50: '236 239 243', 100: '226 230 236', 200: '212 217 225', 300: '192 199 209', 400: '160 170 183',
                500: '137 147 162', 600: '112 122 137'
            }
        }
    };
    // Mode terang: teks berwarna digelapkan agar terbaca di atas putih, dan latar warna
    // yang sangat gelap dijadikan tint lembut.
    const LIGHT_TEXT_SHADE_MAP = { 50: 900, 100: 800, 200: 800, 300: 800, 400: 700, 500: 700, 600: 700 };
    const LIGHT_FILL_SHADE_MAP = { 800: 200, 900: 100, 950: 50 };

    const hexToRgb = hex => [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(' ');
    const paletteRgb = (hue, shade) => hexToRgb(TAILWIND_PALETTE[hue].split(' ')[SHADES.indexOf(Number(shade))]);
    const hues = Object.keys(TAILWIND_PALETTE);

    function readPreference(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function writePreference(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn('Preferensi tema tidak bisa disimpan:', e);
        }
    }

    const isValidTheme = id => THEMES.some(theme => theme.id === id);
    const isValidMode = id => MODES.some(mode => mode.id === id);
    const darkModeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function getTheme() {
        const stored = readPreference(THEME_KEY);
        return isValidTheme(stored) ? stored : DEFAULT_THEME;
    }

    function getMode() {
        const stored = readPreference(MODE_KEY);
        return isValidMode(stored) ? stored : DEFAULT_MODE;
    }

    // Mode yang benar-benar tampil. HZ selalu gelap.
    function getResolvedMode() {
        if (getTheme() === 'hz') return 'dark';
        const mode = getMode();
        if (mode !== 'system') return mode;
        return darkModeQuery?.matches ? 'dark' : 'light';
    }

    const isNormal = () => getTheme() === 'normal';

    function configureTailwind() {
        if (!window.tailwind) return;
        const toColor = (channel, name, rgb) => `rgb(var(--sb-${channel}-${name}, ${rgb}) / <alpha-value>)`;
        const buildColors = channel => {
            const colors = { white: toColor(channel, 'white', '255 255 255') };
            hues.forEach(hue => {
                colors[hue] = {};
                SHADES.forEach(shade => {
                    colors[hue][shade] = toColor(channel, `${hue}-${shade}`, paletteRgb(hue, shade));
                });
            });
            return colors;
        };
        window.tailwind.config = {
            theme: { extend: { colors: buildColors('c'), textColor: buildColors('t') } }
        };
    }

    function buildNeutralDeclarations(mode) {
        const neutrals = NORMAL_NEUTRALS[mode];
        return ['c', 't'].flatMap(channel => Object.entries(neutrals[channel]).map(([shade, rgb]) => {
            const name = shade === 'white' ? 'white' : `slate-${shade}`;
            return `--sb-${channel}-${name}:${rgb};`;
        }));
    }

    function buildLightAccentDeclarations() {
        const accentHues = hues.filter(hue => hue !== 'slate');
        const remap = (channel, shadeMap) => accentHues.flatMap(hue => Object.entries(shadeMap).map(([from, to]) =>
            `--sb-${channel}-${hue}-${from}:${paletteRgb(hue, to)};`));
        return [...remap('t', LIGHT_TEXT_SHADE_MAP), ...remap('c', LIGHT_FILL_SHADE_MAP)];
    }

    function buildFixedPaletteDeclarations() {
        const names = ['white', ...hues.flatMap(hue => SHADES.map(shade => `${hue}-${shade}`))];
        return ['c', 't'].flatMap(channel => names.map(name => `--sb-${channel}-${name}:initial;`));
    }

    function injectPaletteStyles() {
        if (document.getElementById('sbThemePalette')) return;
        const style = document.createElement('style');
        style.id = 'sbThemePalette';
        style.textContent = [
            `${NORMAL_SELECTOR}[data-sb-mode="light"]{${[...buildNeutralDeclarations('light'), ...buildLightAccentDeclarations()].join('')}}`,
            `${NORMAL_SELECTOR}[data-sb-mode="dark"]{${buildNeutralDeclarations('dark').join('')}}`,
            `${NORMAL_SELECTOR} :where(${FIXED_PALETTE_SELECTOR}){${buildFixedPaletteDeclarations().join('')}}`
        ].join('\n');
        document.head.appendChild(style);
    }

    function ensureNormalFont() {
        if (document.getElementById('sbThemeFont')) return;
        const link = document.createElement('link');
        link.id = 'sbThemeFont';
        link.rel = 'stylesheet';
        link.href = INTER_FONT_URL;
        document.head.appendChild(link);
    }

    function updateBrowserChrome() {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        if (!meta.dataset.sbDefault) meta.dataset.sbDefault = meta.content;
        if (!isNormal()) {
            meta.content = meta.dataset.sbDefault;
            return;
        }
        meta.content = getResolvedMode() === 'dark' ? '#101318' : '#f5f6f8';
    }

    function apply() {
        const root = document.documentElement;
        const theme = getTheme();
        const mode = getResolvedMode();
        root.setAttribute('data-sb-theme', theme);
        root.setAttribute('data-sb-mode', mode);
        if (theme === 'normal') {
            root.style.colorScheme = mode;
            ensureNormalFont();
        } else {
            root.style.removeProperty('color-scheme');
        }
        updateBrowserChrome();
    }

    function applyAndNotify() {
        apply();
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
            detail: { theme: getTheme(), mode: getMode(), resolvedMode: getResolvedMode() }
        }));
    }

    function setTheme(id) {
        if (!isValidTheme(id) || id === getTheme()) return;
        writePreference(THEME_KEY, id);
        applyAndNotify();
    }

    function setMode(id) {
        if (!isValidMode(id) || id === getMode()) return;
        writePreference(MODE_KEY, id);
        applyAndNotify();
    }

    function onChange(listener) {
        window.addEventListener(CHANGE_EVENT, listener);
    }

    // Warna untuk canvas Chart.js, yang tidak bisa membaca class Tailwind.
    function getChartColors() {
        if (!isNormal()) {
            return { text: '#94A3B8', grid: 'rgba(255, 255, 255, 0.05)', font: 'Plus Jakarta Sans' };
        }
        return getResolvedMode() === 'dark'
            ? { text: '#A0AAB7', grid: 'rgba(255, 255, 255, 0.08)', font: 'Inter' }
            : { text: '#475569', grid: 'rgba(15, 23, 42, 0.08)', font: 'Inter' };
    }

    configureTailwind();
    injectPaletteStyles();
    apply();

    darkModeQuery?.addEventListener?.('change', () => {
        if (isNormal() && getMode() === 'system') applyAndNotify();
    });
    window.addEventListener('storage', event => {
        if (event.key === THEME_KEY || event.key === MODE_KEY) applyAndNotify();
    });

    return {
        THEMES,
        MODES,
        getTheme,
        getMode,
        getResolvedMode,
        isNormal,
        setTheme,
        setMode,
        onChange,
        getChartColors
    };
})();

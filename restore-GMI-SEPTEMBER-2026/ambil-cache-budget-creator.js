// Tempel di Console browser (F12 > Console) saat membuka aplikasi Smart BARA.
// JANGAN buka halaman Budget Creator untuk periode GMI- SEPTEMBER 2026 sebelum menjalankan ini,
// karena halaman itu akan menimpa cache lokal dengan data cloud yang sudah kosong.
(() => {
    const period = 'GMI- SEPTEMBER 2026';
    const keys = Object.keys(localStorage).filter(k => k.includes(period) && /budget|creator|planning/i.test(k));
    const result = { exportedAt: new Date().toISOString(), period, data: {} };
    keys.forEach(k => { try { result.data[k] = JSON.parse(localStorage.getItem(k)); } catch { result.data[k] = localStorage.getItem(k); } });
    const planning = result.data[`budget_creator_planning_${period}`];
    if (!Array.isArray(planning) || !planning.length) {
        console.warn('Cache Budget Creator periode ini TIDAK ditemukan di browser ini.', keys);
        return;
    }
    const total = planning.reduce((s, it) => s + (Number(it.quantity) || 1) * (Number(it.estimated_unit_price) || 0), 0);
    console.log(`Ditemukan ${planning.length} baris Budget Creator (perkiraan total Rp ${total.toLocaleString('id-ID')}). Mengunduh file...`);
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Cache_BudgetCreator_GMI-SEPTEMBER-2026_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
})();

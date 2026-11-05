# SMART BARA 7.10 HZ - Enterprise Financial & Budgeting Suite

Aplikasi web modular modern untuk konsolidasi keuangan, rekonsiliasi perbankan, perencanaan anggaran (Budget Planning), dan pemantauan belanja modal (Asset Monitoring) dengan proteksi persaingan multi-user (*optimistic versioned concurrency control*) dan sinkronisasi real-time cloud Supabase.

---

## 🌟 Fitur Utama & Struktur Modul

Aplikasi ini telah ditransformasikan dari arsitektur *monolithic single-page* (19.000 baris yang berat) menjadi **Web Modular Multi-Halaman** yang ringan, cepat, dan terpisah:

1. **Dashboard Utama (`index.html`)**
   - Ringkasan KPI eksekutif (Total Budget, Realisasi Rekonsil, Arus Kas Masuk/Keluar, Selisih Bersih).
   - Indikator status koneksi Supabase Realtime cloud dan pintasan navigasi cepat.

2. **Rekonsil Anggaran (`rekonsil.html`)**
   - Ringkasan finance (debit - kredit) dan rekonsil manual pada tingkat departemen maupun transaksi.
   - Filter transaksi, koreksi akun/proyek, catatan manual, audit, carry-over, serta impor/ekspor perubahan.

3. **POV Akun Induk (`pov-akun.html`)**
   - Pengelompokan hierarkis saldo debit, kredit, dan selisih per Akun Induk.

4. **POV Proyek UP (`pov-proyek.html`)**
   - Pengelompokan hierarkis alokasi anggaran dan pengeluaran per Site Proyek Operasional.

5. **Matriks Departemen (`matriks-dept.html`)**
   - Cross-tabulation alokasi dana antar departemen operasional.

6. **Budget Plan Akun (`budget-plan.html`)**
   - Matriks alokasi plafon anggaran 12 bulan (Januari - Desember) per Akun Induk.

7. **Analisa Kenaikan Budget (`budget-analysis.html`)**
   - Analisa aktual per akun, estimasi akhir tahun dari rata-rata bulan, asumsi kenaikan, dan pencarian berita terbaru online.

8. **Budget Creator Planning (`budget-creator.html`)**
   - Perencanaan belanja/kebutuhan barang operasional.
   - Setiap batch Budget AI memperoleh ID yang sama pada seluruh baris bulanan; klik ID di tabel atau cari ID untuk menampilkan dan mengedit baris batch tersebut.
   - Prediksi manual dapat merekomendasikan total tahunan dari budget dan rekonsil hingga empat periode historis, ditambah riset web Gemini Search; ringkasan dan sumber tersimpan pada kolom `catatan`.
   - Proyek UP mendukung multi-pilih; total tahunan dibagi rata dan menghasilkan 12 baris per proyek. Popup Budget AI memakai tampilan layar penuh.
   - Pilihan tahun mencakup hingga 15 tahun ke depan. Rekomendasi bersifat estimasi dan perlu ditinjau sebelum diimpor.
   - **Template Excel Standar**: Download file `.xlsx` dengan combobox dropdown validasi data (Departemen, Nama Akun, Proyek UP) yang diambil langsung dari database.
   - **Import Excel Pintar**: Algoritma fleksibel pencocokan nama kolom, normalisasi format tanggal Indonesia / Excel serial, dan sanitasi angka Rupiah.

9. **Anggaran Masa Depan (`budget-future.html`)**
   - Perencanaan bergulir 12 bulan (*rolling forecast*) dengan simulasi asumsi kenaikan / inflasi (%).
   - Pemindahan alokasi anggaran antar akun secara instan (*budget moving*).
   - 8 KPI cards perbandingan rencana masa depan terhadap budget existing dan rekonsil aktual.

10. **Asset Monitoring (`asset.html`)**
    - Identifikasi dan pemantauan transaksi belanja modal (Capex) dengan batas nilai minimum (threshold nominal).
    - Ekspor laporan aktiva tetap ke Excel.

11. **Monthly Report (`monthly.html`)**
    - Konsolidasi arus kas bulanan Akun ➔ Proyek.
    - Visualisasi grafik tren komparasi Finance vs Rekonsil menggunakan Chart.js.

12. **Pengguna & Akses (`users.html`)**
    - Manajemen peran pengguna (Admin vs Baca Saja).
    - Pemantauan status online dan riwayat login sesi perangkat.

13. **Pengaturan AI Budget (`ai-settings.html`)**
   - Mendukung 20 provider: Gemini, OpenRouter, Groq, Cloudflare Workers AI, Cohere, Cerebras, Claude, SambaNova, Mistral, Together AI, Fireworks, NVIDIA NIM, Hugging Face, SiliconFlow, Novita, Hyperbolic, Z.AI, Alibaba DashScope, Moonshot AI, dan MiniMax.
   - Banyak API key disimpan di tabel `smartbara_ai_keys`; Edge Function mencoba key aktif sesuai urutan prioritas dan beralih ke key berikutnya jika provider gagal atau terkena limit.
   - Model dapat dipilih dari katalog terbaru provider. Jika model Gemini tersimpan tidak lagi tersedia, Edge Function memilih model chat pengganti, menyimpannya, lalu mencoba ulang.
   - Browser hanya menerima metadata key dan empat karakter terakhir. Akses tabel dibatasi untuk `service_role`.
   - Per 31 Oktober 2026, opsi dengan kuota gratis/evaluasi yang terdokumentasi mencakup Gemini, model `:free` OpenRouter, Groq, Cloudflare Workers AI, dan Cohere. Cerebras menyediakan kredit trial terbatas; batas dan syarat dapat berubah.

### Deploy Edge Functions

Deploy Edge Function dari root project dengan Supabase CLI:

```powershell
supabase functions deploy budget-ai --project-ref cjspxjtbgrumfklhewkf
supabase functions deploy admin-users --project-ref cjspxjtbgrumfklhewkf
```

Setelah deploy, menu **Pengaturan AI Budget** memakai fungsi `budget-ai`, sedangkan menu **Pengguna & Akses** memakai fungsi `admin-users`. API key tersimpan pada `smartbara_ai_keys` dan hanya dapat dibaca Edge Function.

---

## 🗄️ Database Supabase & Skrip SQL

Aplikasi menggunakan Supabase project GOA (`https://cjspxjtbgrumfklhewkf.supabase.co`).
Skrip DDL lengkap untuk tabel-tabel baru, RPC dimension list, dan publikasi Realtime tersedia di:
`database_schema.sql`

Jalankan skrip tersebut di **Supabase Dashboard ➔ SQL Editor** untuk membuat tabel key AI `smartbara_ai_keys` sebelum mengelola key dari aplikasi.

Jalankan skrip tersebut di **Supabase Dashboard ➔ SQL Editor** untuk mengaktifkan:
- Tabel `smartbara_budget_creator_planning`
- Tabel `smartbara_future_budget`
- Tabel `smartbara_asset`
- Tabel `smartbara_history`
- RPC `list_smartbara_planning_dimensions`
- Supabase Realtime publication untuk sinkronisasi otomatis antar pengguna.

---

## 🚀 Cara Menjalankan Aplikasi

Aplikasi ini dibangun murni menggunakan standard web modern (Vanilla JS, CSS Tokens, Tailwind CDN, Supabase JS v2, ExcelJS, Chart.js) sehingga **dapat dibuka langsung** melalui:
- **VS Code Live Server**: Klik kanan pada `Smart BARA 7.10 HZ/index.html` ➔ pilih `Open with Live Server`.
- **Browser Langsung**: Dobel klik `index.html` pada File Explorer.
- **Hosting / Deploy**: Langsung siap diunggah ke Vercel, Netlify, atau web hosting static manapun tanpa perlu build step `npm run build`.

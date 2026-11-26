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
    - Memberi/mencabut akses Smart BARA untuk akun Lourdes yang sudah ada, mengatur level (Superadmin, SPV, Tim, Viewer) dan departemen default.
    - Membuat, menonaktifkan, dan reset password akun dilakukan platform admin di `https://monitoring.lourdes.cloud/pengguna`.

13. **Pengaturan AI Budget (`ai-settings.html`)**
   - Mendukung 20 provider: Gemini, OpenRouter, Groq, Cloudflare Workers AI, Cohere, Cerebras, Claude, SambaNova, Mistral, Together AI, Fireworks, NVIDIA NIM, Hugging Face, SiliconFlow, Novita, Hyperbolic, Z.AI, Alibaba DashScope, Moonshot AI, dan MiniMax.
   - Banyak API key disimpan di tabel `smartbara_ai_keys`; Server (`/api/budget-ai`) mencoba key aktif sesuai urutan prioritas dan beralih ke key berikutnya jika provider gagal atau terkena limit.
   - Model dapat dipilih dari katalog terbaru provider. Jika model Gemini tersimpan tidak lagi tersedia, server memilih model chat pengganti, menyimpannya, lalu mencoba ulang.
   - Browser hanya menerima metadata key dan empat karakter terakhir. Tabel hanya bisa diakses server (secret key).
   - Per 31 Oktober 2026, opsi dengan kuota gratis/evaluasi yang terdokumentasi mencakup Gemini, model `:free` OpenRouter, Groq, Cloudflare Workers AI, dan Cohere. Cerebras menyediakan kredit trial terbatas; batas dan syarat dapat berubah.

## 🗄️ Database: Supabase Lourdes

Sejak 26 Nov 2026 Smart BARA memakai **Supabase Lourdes** (self-hosted, `https://db.lourdes.cloud`), schema `smartbara`.
Sebelumnya di Supabase Cloud GOA (schema `public`); data sudah dipindah dan GOA tidak dipakai lagi oleh app ini.

- Skema dikelola **hanya** di repo `~/project/lourdes-db` (migration `20261126120500_app_smartbara.sql`).
  Repo ini tidak boleh punya `supabase/migrations` atau menjalankan `supabase db push`.
  Panduan: `~/project/lourdes-db/docs/claude-app-guide.md` dan `docs/standar-app.md`.
- Login memakai akun Lourdes (satu akun untuk semua app). Hak akses dari `public.app_access` (app `smartbara`):

  | Level Smart BARA | app_access | smartbara.members |
  | --- | --- | --- |
  | Superadmin | `admin` (atau platform admin) | - |
  | SPV | `editor` | `is_spv = true` |
  | Tim | `editor` | `is_spv = false` |
  | Viewer | `viewer` | - |

  Level dibaca lewat RPC `smartbara.access_level()`; RLS di setiap tabel memakai aturan yang sama.
- Fitur AI berjalan di server app (`server/budget-ai.mts`, `POST /api/budget-ai`), bukan Edge Function.

---

## 🚀 Cara Menjalankan Aplikasi

Frontend tetap vanilla JS tanpa build step, dilayani `server.mjs` (Node >= 24) yang juga menyediakan `/api/budget-ai`.

```sh
npm install
# .env.lourdes (tidak di-commit): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
# Isi tanpa menampilkan nilainya:
#   { echo SUPABASE_URL=https://db.lourdes.cloud; ssh root@145.79.8.166 "grep -E '^(SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY)=' /root/apps/supabase/lourdes/.env"; } > .env.lourdes
npm start            # http://127.0.0.1:3000
```

**Deploy:** Coolify (build pack Dockerfile) di VPS Lourdes, domain `https://smartbara.lourdes.cloud`.
Env runtime (jangan centang *Available at Buildtime*): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
Healthcheck: `GET /api/health` (host `127.0.0.1`).

## Tema Tampilan

Pengguna memilih tema lewat tombol **Pengaturan tampilan** di header. Pilihan disimpan per browser.

| Tema | Mode | Keterangan |
| --- | --- | --- |
| HZ (default) | Selalu gelap | Tampilan khas Smart BARA |
| Normal | Terang, Gelap, Sistem | Tampilan bersih dan profesional |

- `js/theme.js`: daftar tema, preferensi, dan pemetaan warna Tailwind ke CSS variable. Harus dimuat tepat setelah script Tailwind CDN.
- `css/themes.css`: pemilih tema dan styling tema Normal. Tema HZ tetap memakai `css/app.css`.
- Class warna Tailwind dipakai seperti biasa. Tema Normal memetakannya otomatis, termasuk untuk mode terang.
- Area dengan class `sb-palette-fixed` dan deck presentasi selalu memakai palet asli.
- Canvas Chart.js mengambil warna dari `SmartBaraTheme.getChartColors()`.

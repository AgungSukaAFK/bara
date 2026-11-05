# Roadmap Modernisasi Smart BARA

Tujuan: membuat aplikasi lebih canggih, modern, stabil, cepat, dan otomatis tanpa mengganggu proses operasional yang sudah berjalan.

## Prioritas 1: Stabilitas data & standardisasi

### Target
- satu sumber data yang konsisten
- tidak ada department tercampur
- history log selaras dengan data tabel
- semua perubahan punya audit yang bisa dipercaya

### Fokus
1. Normalisasi field dept, akun, proyek
2. Validasi import Excel sebelum masuk ke data utama
3. Standardisasi status transaksi: valid / perlu cek / duplikat / mismatch
4. Penyatuan logic history dan department filter
5. Penyederhanaan localStorage vs cloud sync

### Deliverables
- data validator per import
- label status otomatis
- audit log yang konsisten per departemen
- filter history yang mengikuti departemen aktif

---

## Prioritas 2: Automasi proses operasional

### Target
- pekerjaan manual berkurang
- proses import, validasi, sinkronisasi lebih cepat
- keputusan bisa dibuat dari dashboard bukan manual baca tabel

### Fokus
1. Auto map kolom saat upload Excel
2. Auto detect dept berdasarkan pattern nama file / nama row / field
3. Auto flag duplikat, mismatch, outlier
4. Auto summary per periode dan per departemen
5. Auto sync change ke cloud setelah validasi

### Deliverables
- import dengan mapping otomatis
- flag otomatis untuk transaksi bermasalah
- notifikasi status sinkronisasi
- ringkasan periode otomatis

---

## Prioritas 3: Modernisasi UX & workflow

### Target
- tampilan lebih modern seperti dashboard enterprise
- user lebih cepat memahami kondisi data
- alur kerja lebih jelas dan lebih ringkas

### Fokus
1. card KPI yang jelas dan konsisten
2. status timeline / aktivitas terakhir
3. layout lebih rapi per departemen
4. notifikasi toast untuk sync, warning, success
5. state management yang lebih jelas pada halaman utama

### Deliverables
- home dashboard lebih interaktif
- status real-time per periode/dept
- panel insight yang lebih singkat
- lebih sedikit page yang terasa berat dan membingungkan

---

## Prioritas 4: Workflow approval & kontrol akses

### Target
- perubahan penting lewat workflow yang aman
- tidak semua user bisa langsung edit semua data
- audit tetap jelas siapa yang memodifikasi apa

### Fokus
1. level akses: viewer / editor / supervisor / admin
2. approval sebelum data final dipakai
3. per departemen punya rule berbeda
4. perubahan manual harus tercatat dengan alasan

### Deliverables
- role-based access control yang jelas
- status pending / approved / rejected
- log perubahan per user

---

## Prioritas 5: Smart AI & insight otomatis

### Target
- sistem membantu keputusan, bukan hanya menampilkan data

### Fokus
1. rekomendasi akun berdasarkan keterangan transaksi
2. rekomendasi proyek berdasarkan histori sebelumnya
3. deteksi duplikasi dan outlier otomatis
4. rekomendasi kenaikan anggaran dari histori + pola penggunaan
5. ringkasan otomatis untuk laporan manajerial

### Deliverables
- assistive AI panel
- rekomendasi akun/proyek
- insight anomali data
- narasi ringkasan hasil audit

---

## Roadmap implementasi 90 hari

### Phase 1: minggu 1-2
- standardisasi field dan history
- fixing department mismatch
- memperbaiki status transaksi dan audit log

### Phase 2: minggu 3-6
- validasi import otomatis
- auto flag mismatch dan duplikat
- notifikasi sync dan status real-time

### Phase 3: minggu 7-10
- modern dashboard KPI
- UX refinements
- role / approval workflow

### Phase 4: minggu 11-12
- AI recommendation dan insight otomatis
- finalisasi performance tuning
- usability testing

---

## Prinsip utama

1. Stabil dulu, modern setelah stabil
2. Automasi dulu yang benar-benar mengurangi kerja manual
3. Data harus lebih rapi daripada tampilan
4. Setiap perubahan harus punya jejak audit
5. UI harus membantu user mengambil keputusan, bukan hanya menampilkan angka

---

## Langkah eksekusi berikutnya

Saya akan memulai dari 3 item paling berdampak:
1. standardisasi data & department logic
2. otomatisasi validasi import dan status transaksi
3. modernisasi dashboard KPI + UX

Setelah itu, kita lanjut ke workflow approval dan AI assist.

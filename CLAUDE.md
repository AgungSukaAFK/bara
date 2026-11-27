# Smart BARA

## Database & standar
App ini memakai Supabase Lourdes (db.lourdes.cloud). app_id / schema = `smartbara`.
@~/project/lourdes-db/docs/claude-app-guide.md
@~/project/lourdes-db/docs/standar-app.md

## Pengecualian standar (disetujui user, 2026-11-26)
- App lama vanilla JS multi-halaman + `server.mjs` (Node http), bukan starter Next.js. Dideploy via Dockerfile di Coolify.
- Nama tabel sama dengan DB lama (prefix `smartbara_`), dicatat di header migration
  `~/project/lourdes-db/supabase/migrations/20261126120500_app_smartbara.sql`.
- Level akses 4 tingkat (superadmin/spv/tim/viewer) dari `smartbara.access_level()`; spv = editor + `smartbara.members.is_spv`.
- `server/budget-ai.mts` memakai `SUPABASE_SECRET_KEY` (bypass RLS) hanya untuk tabel `smartbara_ai_keys` dan data
  riwayat budget; akses user dicek manual lewat `access_level()` dengan token user.
- Supabase Cloud GOA (cjspxjtbgrumfklhewkf) tidak dipakai lagi oleh app ini. `supabase/.temp` lokal ter-link ke project
  lain (ISO HARIZAL): jangan pakai `--linked`.

## Aplikasi Budget 2027 di /budget/ (2026-11-27)
- Budget tetap app/container terpisah (repo `~/project/AB`; nanti dipindah ke repo ini lalu repo AB pensiun).
  `server.mjs` meneruskan `/budget/*` ke env `BUDGET_UPSTREAM` (prefix dipotong, streaming). UI & logic Budget tidak diubah.
- Satu gerbang login: halaman login Budget dimatikan. `budget-gate.html` mengirim access token Supabase sesi BARA ke
  `/budget/api/auth/sso`; server Budget memverifikasi token, role `app_access` (budget/platform), dan company.
  `budget-gate.html` sengaja tidak memuat `core.js` (core mengarahkan akun khusus-Budget ke gerbang: hindari loop).
- Menu "Budget 2027 GMI/GIS" tampil sesuai company yang boleh dibuka (cek `check_only` ke server Budget, cache sessionStorage).
  Akun GMI/GIS terkunci ke company-nya; akun profil LOURDES boleh memilih dan berpindah GMI/GIS.
- Akun tanpa akses smartbara tapi punya akses budget tetap bisa login dan langsung diarahkan ke `/budget/`.
- Logout dua arah: logout BARA memanggil `/budget/api/auth/logout`; logout Budget ke `login.html?logout=1`.

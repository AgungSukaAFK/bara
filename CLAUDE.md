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

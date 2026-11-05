-- Cek Smart BARA di project GOA. Hanya membaca, dan seluruhnya di-rollback.
-- Jalankan dengan psql, bukan SQL Editor, karena hasilnya banyak baris.
BEGIN READ ONLY;

\echo '== Anggota: harus 5, spv.ga = shared =='
SELECT u.email, m.origin FROM public.smartbara_members m JOIN auth.users u ON u.id = m.user_id ORDER BY 1;

\echo '== Keamanan: policy 18, anon 0, ai_keys false, realtime aset 1 =='
SELECT
    (SELECT count(*) FROM pg_policies WHERE policyname = 'smartbara_member_only') AS member_policies,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname ~ '^(smartbara|smart_asset)'
        AND has_table_privilege('anon', c.oid, 'SELECT')) AS anon_grants,
    has_table_privilege('authenticated', 'public.smartbara_ai_keys', 'SELECT') AS ai_keys_authenticated,
    (SELECT count(*) FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'smart_asset_monitor_config') AS asset_realtime;

\echo '== GOA: bandingkan dengan angka sebelum deploy =='
SELECT
    (SELECT count(*) FROM auth.users) AS auth_users,
    (SELECT count(*) FROM public.profiles) AS profiles,
    (SELECT count(*) FROM public.assets) AS goa_assets;

\echo '== Data Smart BARA =='
SELECT
    (SELECT count(*) FROM public.smartbara_periods) AS periods,
    (SELECT count(*) FROM public.smartbara_store) AS store,
    (SELECT count(*) FROM public.smartbara_budget) AS budget,
    (SELECT count(*) FROM public.smartbara_ai_keys WHERE enabled) AS ai_keys_active;

\echo '== Sebagai moderator@demo.com: is_member false, periods 0, store 0 =='
SELECT set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text, true) IS NOT NULL AS claims_set
FROM auth.users WHERE email = 'moderator@demo.com';
SET LOCAL ROLE authenticated;
SELECT public.smartbara_is_member() AS is_member,
    (SELECT count(*) FROM public.smartbara_periods) AS periods,
    (SELECT count(*) FROM public.smartbara_store) AS store;
RESET ROLE;

\echo '== Sebagai hse@garudamart.com: is_member true, level superadmin, data terbaca, GOA 0 =='
SELECT set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated', 'email', email, 'app_metadata', raw_app_meta_data)::text, true) IS NOT NULL AS claims_set
FROM auth.users WHERE email = 'hse@garudamart.com';
SET LOCAL ROLE authenticated;
SELECT public.smartbara_is_member() AS is_member, public.smartbara_access_level() AS level,
    (SELECT count(*) FROM public.smartbara_periods) AS periods,
    (SELECT count(*) FROM public.assets) AS goa_assets;
RESET ROLE;

\echo '== Sebagai anon: harus permission denied =='
SET LOCAL ROLE anon;
SELECT count(*) AS anon_store FROM public.smartbara_store;

ROLLBACK;

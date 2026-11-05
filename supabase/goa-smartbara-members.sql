-- Smart BARA di project GOA: batas keanggotaan pada auth.users yang dipakai bersama.
-- Hanya menyentuh objek Smart BARA. Tabel GOA dan baris auth.users tidak diubah.
-- origin: smartbara = akun milik Smart BARA, shared = akun yang juga dipakai aplikasi GOA.

CREATE TABLE IF NOT EXISTS public.smartbara_members (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    origin TEXT NOT NULL DEFAULT 'smartbara' CHECK (origin IN ('smartbara', 'shared')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.smartbara_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.smartbara_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.smartbara_members TO service_role;

CREATE OR REPLACE FUNCTION public.smartbara_is_member()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM public.smartbara_members m WHERE m.user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.smartbara_is_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.smartbara_is_member() TO authenticated, service_role;

INSERT INTO public.smartbara_members (user_id, origin)
SELECT u.id, CASE WHEN lower(u.email) = 'spv.ga@garudamart.com' THEN 'shared' ELSE 'smartbara' END
FROM auth.users u
WHERE lower(u.email) IN (
    'spv.ga@garudamart.com', 'hse@garudamart.com', 'intan@garudamart.com',
    'it@garudamart.com', 'legal@garudamart.com'
)
ON CONFLICT (user_id) DO NOTHING;

-- Default privileges GOA memberi grant ke tabel baru, jadi anon dicabut di sini.
DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOR target_table IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename ~ '^(smartbara|smart_asset)'
          AND tablename <> 'smartbara_members'
    LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', target_table);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_member_only ON public.%I', target_table);
        EXECUTE format(
            'CREATE POLICY smartbara_member_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
            'USING ((SELECT public.smartbara_is_member())) WITH CHECK ((SELECT public.smartbara_is_member()))',
            target_table
        );
    END LOOP;
END;
$$;

-- API key AI hanya untuk Edge Function.
REVOKE ALL ON TABLE public.smartbara_ai_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.smartbara_ai_keys TO service_role;

-- smart-asset-project/app.js mendengarkan perubahan tabel ini.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'smart_asset_monitor_config'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.smart_asset_monitor_config;
    END IF;
END;
$$;

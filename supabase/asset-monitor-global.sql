-- ============================================================
-- SMART ASSET GLOBAL MONITORING (INDEPENDENT FROM PERIOD/DEPT)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.smart_asset_master (
    asset_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset_code TEXT NOT NULL UNIQUE,
    asset_name TEXT NOT NULL,
    asset_category TEXT NOT NULL DEFAULT 'Lainnya'::text,
    asset_location TEXT DEFAULT 'Belum diatur'::text,
    asset_no_akun TEXT DEFAULT ''::text,
    asset_project TEXT DEFAULT ''::text,
    asset_department TEXT DEFAULT 'GLOBAL'::text,
    asset_purchase_value NUMERIC(18,2) DEFAULT 0 NOT NULL,
    asset_purchase_date DATE,
    asset_use_date DATE,
    asset_useful_life_years INTEGER DEFAULT 0 NOT NULL,
    asset_depreciation_method TEXT DEFAULT 'Garis Lurus'::text,
    asset_status TEXT DEFAULT 'Aktif'::text,
    audit_status TEXT DEFAULT 'Belum Audit'::text,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.smart_asset_monitor_config (
    key TEXT PRIMARY KEY,
    value JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_smart_asset_master_category
    ON public.smart_asset_master (asset_category, asset_location);

CREATE INDEX IF NOT EXISTS idx_smart_asset_master_value
    ON public.smart_asset_master (asset_purchase_value DESC);

ALTER TABLE public.smart_asset_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_asset_monitor_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.smart_asset_master FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.smart_asset_monitor_config FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smart_asset_master TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smart_asset_monitor_config TO authenticated;
GRANT ALL ON TABLE public.smart_asset_master TO service_role;
GRANT ALL ON TABLE public.smart_asset_monitor_config TO service_role;

DROP POLICY IF EXISTS smart_asset_master_read_authenticated ON public.smart_asset_master;
DROP POLICY IF EXISTS smart_asset_master_insert_by_role ON public.smart_asset_master;
DROP POLICY IF EXISTS smart_asset_master_update_by_role ON public.smart_asset_master;
DROP POLICY IF EXISTS smart_asset_master_delete_by_role ON public.smart_asset_master;
CREATE POLICY smart_asset_master_read_authenticated ON public.smart_asset_master
    FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY smart_asset_master_insert_by_role ON public.smart_asset_master
    FOR INSERT TO authenticated
    WITH CHECK (public.smartbara_access_level() IN ('superadmin', 'spv', 'tim'));
CREATE POLICY smart_asset_master_update_by_role ON public.smart_asset_master
    FOR UPDATE TO authenticated
    USING (public.smartbara_access_level() IN ('superadmin', 'spv', 'tim'))
    WITH CHECK (public.smartbara_access_level() IN ('superadmin', 'spv', 'tim'));
CREATE POLICY smart_asset_master_delete_by_role ON public.smart_asset_master
    FOR DELETE TO authenticated
    USING (public.smartbara_access_level() IN ('superadmin', 'spv'));

DROP POLICY IF EXISTS smart_asset_monitor_config_read_authenticated ON public.smart_asset_monitor_config;
DROP POLICY IF EXISTS smart_asset_monitor_config_insert_by_role ON public.smart_asset_monitor_config;
DROP POLICY IF EXISTS smart_asset_monitor_config_update_by_role ON public.smart_asset_monitor_config;
DROP POLICY IF EXISTS smart_asset_monitor_config_delete_by_role ON public.smart_asset_monitor_config;
CREATE POLICY smart_asset_monitor_config_read_authenticated ON public.smart_asset_monitor_config
    FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY smart_asset_monitor_config_insert_by_role ON public.smart_asset_monitor_config
    FOR INSERT TO authenticated
    WITH CHECK (public.smartbara_access_level() IN ('superadmin', 'spv', 'tim'));
CREATE POLICY smart_asset_monitor_config_update_by_role ON public.smart_asset_monitor_config
    FOR UPDATE TO authenticated
    USING (public.smartbara_access_level() IN ('superadmin', 'spv', 'tim'))
    WITH CHECK (public.smartbara_access_level() IN ('superadmin', 'spv', 'tim'));
CREATE POLICY smart_asset_monitor_config_delete_by_role ON public.smart_asset_monitor_config
    FOR DELETE TO authenticated
    USING (public.smartbara_access_level() IN ('superadmin', 'spv'));

-- Sample upsert for configuration key used by the asset page
-- INSERT INTO public.smart_asset_monitor_config (key, value)
-- VALUES ('asset_monitor_global', '{"selected_ids": [], "asset_accounts": [], "min_value": 5000000}'::jsonb)
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = timezone('utc'::text, now());

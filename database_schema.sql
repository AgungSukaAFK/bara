-- ==============================================================================
-- SMART BARA 7.10 HZ - SUPABASE COMPLETE DATABASE SCHEMA & REALTIME SETUP
-- Jalankan skrip ini di Supabase SQL Editor jika ada tabel yang belum dibuat.
-- ==============================================================================

-- 1. Tabel Registrasi Periode
CREATE TABLE IF NOT EXISTS public.smartbara_periods (
    period_name TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabel Penyimpanan Data Transaksi Laporan Departemen
CREATE TABLE IF NOT EXISTS public.smartbara_store (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL,
    dept_name TEXT NOT NULL,
    row_data JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_smartbara_store_period_dept UNIQUE (period_name, dept_name)
);

-- 3. Tabel Metadata Rekonsiliasi (Catatan & Adjustment Saldo)
CREATE TABLE IF NOT EXISTS public.smartbara_meta (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL,
    meta_key TEXT NOT NULL,
    adj_sistem NUMERIC DEFAULT 0 NOT NULL,
    adj_bank NUMERIC DEFAULT 0 NOT NULL,
    catatan TEXT DEFAULT ''::text,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_smartbara_meta_period_key UNIQUE (period_name, meta_key)
);

-- 4. Tabel Budget Plan Akun Induk
CREATE TABLE IF NOT EXISTS public.smartbara_budget (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL,
    nama_akun TEXT NOT NULL,
    departemen TEXT NOT NULL,
    budget JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabel Budget Site Proyek UP
CREATE TABLE IF NOT EXISTS public.smartbara_budget_site (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL,
    nama_proyek_up TEXT NOT NULL,
    departemen TEXT NOT NULL,
    budget JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Tabel Rencana Anggaran Masa Depan (Future Budget)
CREATE TABLE IF NOT EXISTS public.smartbara_future_budget (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL UNIQUE,
    default_rate NUMERIC DEFAULT 5 NOT NULL,
    rows_data JSONB DEFAULT '[]'::jsonb NOT NULL,
    config_data JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Tabel Pengaturan Asset Report
CREATE TABLE IF NOT EXISTS public.smartbara_asset (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL UNIQUE,
    asset_data JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7A. Tabel Global Asset Monitoring (tidak terikat periode/departemen)
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

ALTER TABLE public.smart_asset_master DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_asset_monitor_config DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.smart_asset_master TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.smart_asset_monitor_config TO anon, authenticated, service_role;

-- 8. Tabel Visibilitas Departemen
CREATE TABLE IF NOT EXISTS public.smartbara_dept_visibility (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL UNIQUE,
    visibility_data JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Tabel Pengaturan & Fallback Settings
CREATE TABLE IF NOT EXISTS public.smartbara_settings (
    key TEXT PRIMARY KEY,
    value JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Kunci API AI disimpan di server dan hanya dapat diakses oleh Edge Function.
CREATE TABLE IF NOT EXISTS public.smartbara_ai_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    label TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN (
        'claude', 'gemini', 'openrouter', 'groq', 'cloudflare', 'cohere', 'cerebras',
        'sambanova', 'mistral', 'together', 'fireworks', 'nvidia', 'huggingface',
        'siliconflow', 'novita', 'hyperbolic', 'zai', 'dashscope', 'moonshot', 'minimax'
    )),
    account_id TEXT,
    model TEXT NOT NULL,
    api_key TEXT NOT NULL,
    priority INTEGER DEFAULT 10 NOT NULL,
    enabled BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.smartbara_ai_keys ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE public.smartbara_ai_keys DROP CONSTRAINT IF EXISTS smartbara_ai_keys_provider_check;
ALTER TABLE public.smartbara_ai_keys ADD CONSTRAINT smartbara_ai_keys_provider_check CHECK (provider IN (
    'claude', 'gemini', 'openrouter', 'groq', 'cloudflare', 'cohere', 'cerebras',
    'sambanova', 'mistral', 'together', 'fireworks', 'nvidia', 'huggingface',
    'siliconflow', 'novita', 'hyperbolic', 'zai', 'dashscope', 'moonshot', 'minimax'
));

CREATE INDEX IF NOT EXISTS idx_smartbara_ai_keys_priority
    ON public.smartbara_ai_keys (enabled, priority, created_at);

ALTER TABLE public.smartbara_ai_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.smartbara_ai_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.smartbara_ai_keys TO service_role;

-- 10. Tabel Riwayat Audit Perubahan Rekonsiliasi (History Log)
CREATE TABLE IF NOT EXISTS public.smartbara_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT,
    old_value JSONB,
    new_value JSONB,
    changed_by TEXT,
    changed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 11. Tabel Budget Creator Planning (Perencanaan Pembelian & Pengadaan)
CREATE TABLE IF NOT EXISTS public.smartbara_budget_creator_planning (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    period_name TEXT NOT NULL,
    department TEXT NOT NULL,
    account_name TEXT DEFAULT ''::text,
    project_name TEXT DEFAULT ''::text,
    item_name TEXT NOT NULL,
    specification TEXT DEFAULT ''::text,
    catatan TEXT DEFAULT ''::text NOT NULL,
    ai_budget_id TEXT,
    quantity NUMERIC DEFAULT 1 NOT NULL,
    unit TEXT DEFAULT 'unit'::text NOT NULL,
    estimated_unit_price NUMERIC DEFAULT 0 NOT NULL,
    priority TEXT DEFAULT 'Normal'::text NOT NULL,
    needed_by DATE,
    status TEXT DEFAULT 'Draft'::text NOT NULL,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.smartbara_budget_creator_planning
    ADD COLUMN IF NOT EXISTS catatan TEXT DEFAULT ''::text NOT NULL;

ALTER TABLE public.smartbara_budget_creator_planning
    ADD COLUMN IF NOT EXISTS ai_budget_id TEXT;

CREATE INDEX IF NOT EXISTS idx_smartbara_creator_ai_budget_id
    ON public.smartbara_budget_creator_planning (period_name, ai_budget_id)
    WHERE ai_budget_id IS NOT NULL;

-- ==============================================================================
-- INDEXING UNTUK PERFORMA TINGGI
-- ==============================================================================
ALTER TABLE public.smartbara_history
    ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smartbara_store_period ON public.smartbara_store (period_name);
CREATE INDEX IF NOT EXISTS idx_smartbara_budget_period ON public.smartbara_budget (period_name);
CREATE INDEX IF NOT EXISTS idx_smartbara_budget_site_period ON public.smartbara_budget_site (period_name);
CREATE INDEX IF NOT EXISTS idx_smartbara_creator_period ON public.smartbara_budget_creator_planning (period_name);
CREATE INDEX IF NOT EXISTS idx_smartbara_history_period ON public.smartbara_history (period_name, changed_at DESC);

-- ==============================================================================
-- RPC FUNCTION: list_smartbara_planning_dimensions
-- Mengembalikan daftar unik kombinasi Departemen, Akun, dan Proyek dari database
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.list_smartbara_planning_dimensions(p_period TEXT)
RETURNS TABLE (department TEXT, account_name TEXT, project_name TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT DISTINCT
        COALESCE(NULLIF(s.dept_name, ''), 'UMUM')::text AS department,
        COALESCE(
            NULLIF(r.value->>'_calcAkun', ''),
            NULLIF(r.value->>'_akunOverride', ''),
            NULLIF(r.value->>'Akun', ''),
            NULLIF(r.value->>'Nama Akun', ''),
            ''
        )::text AS account_name,
        COALESCE(
            NULLIF(r.value->>'_calcProyek', ''),
            NULLIF(r.value->>'_proyekOverride', ''),
            NULLIF(r.value->>'Proyek', ''),
            NULLIF(r.value->>'Nama Proyek', ''),
            ''
        )::text AS project_name
    FROM public.smartbara_store AS s
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(s.row_data) = 'array' THEN s.row_data
            ELSE '[]'::jsonb
        END
    ) AS r(value)
    WHERE s.period_name = p_period
      AND (
          COALESCE(
              NULLIF(r.value->>'_calcAkun', ''),
              NULLIF(r.value->>'_akunOverride', ''),
              NULLIF(r.value->>'Akun', ''),
              NULLIF(r.value->>'Nama Akun', ''),
              ''
          ) <> ''
          OR COALESCE(
              NULLIF(r.value->>'_calcProyek', ''),
              NULLIF(r.value->>'_proyekOverride', ''),
              NULLIF(r.value->>'Proyek', ''),
              NULLIF(r.value->>'Nama Proyek', ''),
              ''
          ) <> ''
      );
$$;

-- ==============================================================================
-- AKTIFKAN SUPABASE REALTIME REPLICATION UNTUK MULTI-USER SYNC
-- ==============================================================================
DO $$
DECLARE
    table_name TEXT;
    realtime_tables TEXT[] := ARRAY[
        'smartbara_store', 'smartbara_meta', 'smartbara_budget',
        'smartbara_budget_site', 'smartbara_future_budget', 'smartbara_asset',
        'smartbara_dept_visibility', 'smartbara_history',
        'smartbara_budget_creator_planning'
    ];
BEGIN
    FOREACH table_name IN ARRAY realtime_tables LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = table_name
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
        END IF;
    END LOOP;
END;
$$;

-- ==============================================================================
-- ROLE ACCESS CONTROL
-- Role claims are stored in auth.users.raw_app_meta_data and signed into the JWT.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.smartbara_access_level()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
    SELECT CASE
        WHEN lower(COALESCE(auth.jwt()->>'email', '')) = 'spv.ga@garudamart.com' THEN 'superadmin'
        WHEN lower(COALESCE(auth.jwt()->'app_metadata'->>'role', '')) IN ('superadmin', 'admin') THEN 'superadmin'
        WHEN lower(COALESCE(auth.jwt()->'app_metadata'->>'role', '')) = 'spv' THEN 'spv'
        WHEN lower(COALESCE(auth.jwt()->'app_metadata'->>'role', '')) IN ('tim', 'editor') THEN 'tim'
        ELSE 'viewer'
    END;
$$;

REVOKE ALL ON FUNCTION public.smartbara_access_level() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smartbara_access_level() TO authenticated;

CREATE OR REPLACE FUNCTION public.smartbara_assign_default_superadmin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF lower(COALESCE(NEW.email, '')) = 'spv.ga@garudamart.com' THEN
        NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'superadmin');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS smartbara_default_superadmin_role ON auth.users;
CREATE TRIGGER smartbara_default_superadmin_role
    BEFORE INSERT OR UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.smartbara_assign_default_superadmin();

UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'superadmin')
WHERE lower(email) = 'spv.ga@garudamart.com';

DO $$
DECLARE
    table_name TEXT;
    write_rule TEXT;
    delete_rule TEXT;
    application_tables TEXT[] := ARRAY[
        'smartbara_periods', 'smartbara_store', 'smartbara_meta', 'smartbara_budget',
        'smartbara_budget_site', 'smartbara_future_budget', 'smartbara_asset',
        'smartbara_dept_visibility', 'smartbara_settings', 'smartbara_history',
        'smartbara_budget_creator_planning'
    ];
BEGIN
    FOREACH table_name IN ARRAY application_tables LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_name);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_read_authenticated ON public.%I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_access_authenticated ON public.%I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_insert_authenticated ON public.%I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_update_authenticated ON public.%I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_delete_authenticated ON public.%I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_insert_by_role ON public.%I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_update_by_role ON public.%I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS smartbara_delete_by_role ON public.%I', table_name);

        write_rule := 'public.smartbara_access_level() IN (''superadmin'', ''spv'', ''tim'')';
        delete_rule := 'public.smartbara_access_level() IN (''superadmin'', ''spv'')';

        IF table_name IN ('smartbara_periods', 'smartbara_dept_visibility') THEN
            write_rule := 'public.smartbara_access_level() = ''superadmin''';
            delete_rule := 'public.smartbara_access_level() = ''superadmin''';
        ELSIF table_name = 'smartbara_settings' THEN
            write_rule := 'public.smartbara_access_level() = ''superadmin'' OR (public.smartbara_access_level() IN (''spv'', ''tim'') AND (left(key, char_length(''smartbara_reconcile_override_'')) = ''smartbara_reconcile_override_'' OR left(key, char_length(''budget_creator_planning_'')) = ''budget_creator_planning_''))';
            delete_rule := 'public.smartbara_access_level() = ''superadmin'' OR (public.smartbara_access_level() = ''spv'' AND (left(key, char_length(''smartbara_reconcile_override_'')) = ''smartbara_reconcile_override_'' OR left(key, char_length(''budget_creator_planning_'')) = ''budget_creator_planning_''))';
        END IF;

        EXECUTE format('CREATE POLICY smartbara_read_authenticated ON public.%I FOR SELECT TO authenticated USING (true)', table_name);
    EXECUTE format('CREATE POLICY smartbara_access_authenticated ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', table_name);
    EXECUTE format('CREATE POLICY smartbara_insert_authenticated ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', table_name);
    EXECUTE format('CREATE POLICY smartbara_update_authenticated ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', table_name);
    EXECUTE format('CREATE POLICY smartbara_delete_authenticated ON public.%I FOR DELETE TO authenticated USING (true)', table_name);
    EXECUTE format('CREATE POLICY smartbara_insert_by_role ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', table_name, write_rule);
    EXECUTE format('CREATE POLICY smartbara_update_by_role ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', table_name, write_rule, write_rule);
    EXECUTE format('CREATE POLICY smartbara_delete_by_role ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', table_name, delete_rule);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.list_smartbara_planning_dimensions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_smartbara_planning_dimensions(TEXT) TO authenticated;

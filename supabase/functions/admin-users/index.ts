import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const allowedRoles = new Set(["superadmin", "spv", "tim", "viewer"]);
const defaultSuperadminEmail = "spv.ga@garudamart.com";
const notMemberError = "Pengguna ini bukan anggota Smart BARA.";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    if (!accessToken || accessToken === authorization) {
      return jsonResponse({ error: "Sesi login tidak valid. Silakan login kembali." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Konfigurasi admin function belum lengkap." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return jsonResponse({ error: "Sesi login tidak valid atau sudah kedaluwarsa." }, 401);
    }

    const requester = authData.user;
    const requesterRole = String(requester.app_metadata?.role || "").toLowerCase();
    if (requester.email?.toLowerCase() !== defaultSuperadminEmail && !["superadmin", "admin"].includes(requesterRole)) {
      return jsonResponse({ error: "Hanya Superadmin yang dapat mengelola pengguna." }, 403);
    }
    if (!await getMembership(supabase, requester.id)) {
      return jsonResponse({ error: "Akun Anda bukan anggota Smart BARA." }, 403);
    }

    const body = await request.json();
    const action = String(body.action || "");

    if (action === "list") {
      const { data: members, error: membersError } = await supabase.from("smartbara_members").select("user_id");
      if (membersError) throw membersError;
      const users = [];
      for (const member of members || []) {
        const { data, error } = await supabase.auth.admin.getUserById(member.user_id);
        if (error) throw error;
        if (data.user) users.push(data.user);
      }

      return jsonResponse({
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || "",
          department: user.user_metadata?.department || "",
          position: user.user_metadata?.position || "",
          app_metadata: user.app_metadata,
          email_confirmed: Boolean(user.email_confirmed_at),
          last_sign_in_at: user.last_sign_in_at,
          activeSessions: [],
        })),
      });
    }

    if (action === "create") {
      const email = normalizeEmail(body.email);
      const role = normalizeRole(email, body.role);
      const metadata = buildUserMetadata(body);
      const password = String(body.password || "");
      if (password.length < 8 || password.length > 128) {
        return jsonResponse({ error: "Password harus memiliki 8 sampai 128 karakter." }, 400);
      }
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
        app_metadata: { role },
      });
      if (error) throw error;

      const { error: memberError } = await supabase.from("smartbara_members").insert({ user_id: data.user.id, origin: "smartbara" });
      if (memberError) {
        await supabase.auth.admin.deleteUser(data.user.id);
        throw memberError;
      }
      return jsonResponse({ success: true, userId: data.user.id });
    }

    if (action === "update") {
      const userId = requireUserId(body.userId);
      const membership = await getMembership(supabase, userId);
      if (!membership) return jsonResponse({ error: notMemberError }, 403);
      const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId);
      if (targetError) throw targetError;
      const target = targetData.user;
      if (!target) return jsonResponse({ error: "Pengguna tidak ditemukan." }, 404);

      const email = normalizeEmail(body.email);
      const isShared = membership.origin === "shared";
      if (isShared && email !== target.email?.toLowerCase()) {
        return jsonResponse({ error: "Email akun bersama dengan GOA tidak dapat diubah dari Smart BARA." }, 403);
      }
      const role = normalizeRole(email, body.role);
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        ...(isShared ? {} : { email }),
        app_metadata: { ...target.app_metadata, role },
        user_metadata: { ...target.user_metadata, ...buildUserMetadata(body) },
      });
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    if (action === "delete") {
      const userId = requireUserId(body.userId);
      const membership = await getMembership(supabase, userId);
      if (!membership) return jsonResponse({ error: notMemberError }, 403);
      if (userId === requester.id) return jsonResponse({ error: "Akun yang sedang digunakan tidak dapat dihapus." }, 403);
      const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId);
      if (targetError) throw targetError;
      if (!targetData.user) return jsonResponse({ error: "Pengguna tidak ditemukan." }, 404);
      if (targetData.user.email?.toLowerCase() === defaultSuperadminEmail) {
        return jsonResponse({ error: "Superadmin default tidak dapat dihapus." }, 403);
      }

      if (membership.origin === "shared") {
        const { error: revokeError } = await supabase.from("smartbara_members").delete().eq("user_id", userId);
        if (revokeError) throw revokeError;
        return jsonResponse({ success: true });
      }

      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    if (action === "reset-password") {
      const userId = requireUserId(body.userId);
      const membership = await getMembership(supabase, userId);
      if (!membership) return jsonResponse({ error: notMemberError }, 403);
      if (membership.origin === "shared") {
        return jsonResponse({ error: "Password akun bersama dengan GOA tidak dapat direset dari Smart BARA." }, 403);
      }
      const password = String(body.password || "");
      if (password.length < 8 || password.length > 128) {
        return jsonResponse({ error: "Password harus memiliki 8 sampai 128 karakter." }, 400);
      }
      const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId);
      if (targetError) throw targetError;
      if (!targetData.user) return jsonResponse({ error: "Pengguna tidak ditemukan." }, 404);
      if (body.email && targetData.user.email?.toLowerCase() !== normalizeEmail(body.email)) {
        return jsonResponse({ error: "Email tidak cocok dengan akun yang dipilih." }, 400);
      }

      const { error } = await supabase.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Aksi pengguna tidak dikenal." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permintaan pengelolaan pengguna gagal.";
    return jsonResponse({ error: message }, 400);
  }
});

async function getMembership(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase.from("smartbara_members").select("origin").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as { origin: string } | null;
}

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Format email tidak valid.");
  }
  return email;
}

function normalizeRole(email: string, value: unknown) {
  if (email === defaultSuperadminEmail) return "superadmin";
  const role = String(value || "viewer").trim().toLowerCase();
  if (!allowedRoles.has(role)) throw new Error("Level akses tidak valid.");
  return role;
}

function requireUserId(value: unknown) {
  const userId = String(value || "").trim();
  if (!userId) throw new Error("ID pengguna wajib diisi.");
  return userId;
}

function buildUserMetadata(body: Record<string, unknown>) {
  return {
    full_name: String(body.fullName || "").trim().slice(0, 160),
    department: String(body.department || "").trim().slice(0, 120),
    position: String(body.position || "").trim().slice(0, 160),
  };
}
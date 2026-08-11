const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "https://dzgczkwwezzsfqnjdqen.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_TeKmqDoWR6tN4sWy-3CXLw_qikOsQsg";
const SESSION_KEY = "led-stage-supabase-session-v1";

const baseHeaders = () => ({
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
});

const readJson = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || `Supabase 오류 (${res.status})`;
    throw new Error(message);
  }
  return data;
};

const persistSession = (session) => {
  if (!session?.access_token) return null;
  const normalized = {
    ...session,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  return normalized;
};

const clearSession = () => localStorage.removeItem(SESSION_KEY);

export async function signUpCloud(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await readJson(res);
  if (data?.access_token) persistSession(data);
  return data;
}

export async function signInCloud(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await readJson(res);
  return persistSession(data);
}

export async function refreshCloudSession(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await readJson(res);
  return persistSession(data);
}

export async function getCloudSession() {
  let session = null;
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    clearSession();
    return null;
  }
  if (!session?.access_token) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - now < 60 && session.refresh_token) {
    try {
      session = await refreshCloudSession(session.refresh_token);
    } catch {
      clearSession();
      return null;
    }
  }
  return session;
}

export async function signOutCloud() {
  const session = await getCloudSession();
  if (session?.access_token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { ...baseHeaders(), Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null);
  }
  clearSession();
}

export async function loadCloudProject(session) {
  if (!session?.access_token || !session?.user?.id) return null;
  const query = new URLSearchParams({
    select: "project_name,project_data,updated_at",
    user_id: `eq.${session.user.id}`,
    limit: "1",
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/led_stage_user_projects?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const rows = await readJson(res);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function saveCloudProject(session, projectData, projectName = "내 무대 프로젝트") {
  if (!session?.access_token || !session?.user?.id) throw new Error("로그인이 필요해요.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/led_stage_user_projects?on_conflict=user_id`, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      Authorization: `Bearer ${session.access_token}`,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      user_id: session.user.id,
      project_name: projectName,
      project_data: projectData,
    }),
  });
  const rows = await readJson(res);
  return Array.isArray(rows) ? rows[0] : rows;
}

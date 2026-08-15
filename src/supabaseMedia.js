const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "https://dzgczkwwezzsfqnjdqen.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_TeKmqDoWR6tN4sWy-3CXLw_qikOsQsg";
const MEDIA_BUCKET = "led-stage-audio";
const MAX_MEDIA_BYTES = 300 * 1024 * 1024;

const safeExt = (name = "") => {
  const ext = String(name).split(".").pop()?.toLowerCase() || "bin";
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
};

const uniqueMediaPath = (userId, file) => {
  const stamp = Date.now().toString(36);
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${userId}/media/${stamp}-${nonce}.${safeExt(file?.name)}`;
};

export async function uploadCloudMedia(session, file, onProgress = null) {
  if (!session?.access_token || !session?.user?.id) throw new Error("로그인이 필요해요.");
  if (!file) throw new Error("미디어 파일이 없어요.");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("클라우드 미디어는 300MB 이하만 업로드할 수 있어요.");

  // Each uploaded media object gets its own path so independent PROJECTS cannot overwrite
  // one another. Existing historical metadata that points to /media/current remains readable.
  const path = uniqueMediaPath(session.user.id, file);
  const url = `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`;

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
    };
    xhr.onerror = () => reject(new Error("Supabase Storage 미디어 업로드 중 네트워크 오류가 발생했어요."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = `미디어 업로드 실패 (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          message = body?.message || body?.error || message;
        } catch {}
        reject(new Error(message));
      }
    };
    xhr.send(file);
  });

  if (typeof onProgress === "function") onProgress(100);
  return {
    bucket: MEDIA_BUCKET,
    path,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    kind: file.type?.startsWith("video/") ? "video" : "audio",
    uploadedAt: new Date().toISOString(),
  };
}

export async function downloadCloudMedia(session, mediaMeta) {
  if (!session?.access_token) throw new Error("로그인이 필요해요.");
  if (!mediaMeta?.path) throw new Error("저장된 클라우드 미디어 경로가 없어요.");
  const bucket = mediaMeta.bucket || MEDIA_BUCKET;
  const encodedPath = mediaMeta.path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${encodedPath}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (!res.ok) {
    let message = `클라우드 미디어 다운로드 실패 (${res.status})`;
    try {
      const body = await res.json();
      message = body?.message || body?.error || message;
    } catch {}
    throw new Error(message);
  }
  return res.blob();
}

export const CLOUD_MEDIA_LIMIT_BYTES = MAX_MEDIA_BYTES;

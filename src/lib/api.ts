import type {
  AdminOrder,
  BankVoice,
  KhqrConfig,
  VoxDiagnosis,
  OwnVox,
  CastVoice,
  LicenseKey,
  ProjectFile,
  RecapNarrator,
  RecapScene,
  SubscriptionOrder,
  SubscriptionPlan,
  SubscriptionStatus,
  TimelineSegment,
  LongDubProject,
  UploadReply,
  UploadSeries,
  User,
  VoiceReport,
  VoxSettings,
  VideoJob,
  VideoResult,
  VoxcpmStatus,
} from './types';

const TOKEN_KEY = 'studio_auth_token';

export const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setAuthToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
};

export const getDeviceId = (): string => {
  try {
    let id = localStorage.getItem('studio_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
      localStorage.setItem('studio_device_id', id);
    }
    return id;
  } catch {
    return 'dev_unknown';
  }
};

/** Media URLs fetched by <audio>/<video> cannot send headers; the cookie usually covers it, the token is a fallback. */
export const withToken = (url: string): string => {
  const t = getAuthToken();
  if (!t || !(url.startsWith('/api/') || url.startsWith('/media/'))) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-Device-Id', getDeviceId());
  const res = await fetch(endpoint, { ...options, headers, credentials: 'same-origin' });
  if (!res.ok) {
    let detail: any = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail ?? j.message ?? detail;
    } catch {}
    const msg = typeof detail === 'string' ? detail : detail?.message || res.statusText;
    throw new ApiError(msg, res.status);
  }
  return res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const CHUNK_BYTES = 8 * 1024 * 1024;

const errorText = async (res: Response) => {
  try {
    const body = await res.json();
    return typeof body.detail === 'string' ? body.detail : body.detail?.message || `Upload មិនបាន (${res.status})`;
  } catch {
    return `Upload មិនបាន (${res.status})`;
  }
};

async function chunkedUpload(file: File, kind: 'video' | 'longdub', onProgress: (pct: number) => void): Promise<unknown> {
  const uploadId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  const headers = (): Record<string, string> => {
    const t = getAuthToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };
  let sent = 0;
  for (let i = 0; i < total; i += 1) {
    const piece = file.slice(i * CHUNK_BYTES, Math.min(file.size, (i + 1) * CHUNK_BYTES));
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await fetch(`/api/upload/chunk?uploadId=${uploadId}&index=${i}`, {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/octet-stream' },
          body: piece,
        });
        if (res.ok) break;
        // a refusal (too big, signed out) will not get better by trying again
        if (res.status < 500 && res.status !== 408 && res.status !== 429) throw new ApiError(await errorText(res), res.status);
        throw new Error(await errorText(res));
      } catch (e) {
        if (e instanceof ApiError || attempt >= 5) throw e instanceof Error && e.message ? e : new Error('បណ្តាញដាច់ពេល Upload');
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    sent += piece.size;
    onProgress(Math.min(99, Math.round((sent / Math.max(1, file.size)) * 100)));
  }
  const res = await fetch('/api/upload/finish', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, total, filename: file.name, kind }),
  });
  if (!res.ok) throw new ApiError(await errorText(res), res.status);
  onProgress(100);
  return res.json();
}

export const api = {
  // ── Auth ──
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', json('POST', { username, password, deviceId: getDeviceId() })),
  telegramLogin: (initData: string) =>
    request<{ token: string; user: User }>('/api/auth/telegram', json('POST', { initData, deviceId: getDeviceId() })),
  authConfig: () => request<{ enabled: boolean; passwordLogin: boolean; botUsername: string }>('/api/auth/telegram/enabled'),
  me: () => request<{ user: User | null }>('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  activateLicense: (license_key: string) =>
    request<{ success: boolean; message: string; user: User }>('/api/license/activate', json('POST', { license_key })),

  // ── Engines ──
  voxStatus: () => request<VoxcpmStatus>('/api/voxcpm/status'),
  checkVoice: (file: File, hasTranscript = false) => {
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('hasTranscript', String(hasTranscript));
    return request<{ report: VoiceReport }>('/api/voice-check', { method: 'POST', body: fd });
  },
  voiceBank: () => request<{ online: boolean; voices: BankVoice[]; message?: string; proLimit?: number }>('/api/voice-bank'),

  // ── Video in ──
  // Both uploads go in 8 MB pieces: one big request is cut off by proxies such as Cloudflare
  // (100 MB per request), and a network hiccup only resends one piece.
  uploadVideo: (file: File, onProgress: (pct: number) => void) =>
    chunkedUpload(file, 'video', onProgress).then((body: any) => {
      if (!body.file) throw new Error('Upload មិនបាន');
      return { file: body.file, parts: body.parts || null, series: body.series || null } as UploadReply;
    }),
  longdubUpload: (file: File, onProgress: (pct: number) => void) =>
    chunkedUpload(file, 'longdub', onProgress) as Promise<{ filename: string; originalName: string; duration: number }>,
  downloadVideo: (url: string) =>
    request<{ filename: string; originalName: string; size: number; url: string; parts?: ProjectFile[] | null; series?: UploadSeries | null }>('/api/video/download', json('POST', { url })),
  scanTimeline: (filename: string, scope: 'full' | '180', voiceMode = 'voice_actor_clone') =>
    request<{ success: boolean; segments: TimelineSegment[] }>('/api/dubbing/scan-timeline', json('POST', { filename, scope, voiceMode })),

  // ── Character voices ──
  listCastVoices: (projectKey: string) =>
    request<{ casts: CastVoice[] }>(`/api/cast/voices?projectKey=${encodeURIComponent(projectKey)}`),
  uploadCastVoice: (p: { file: File; projectKey: string; speakerKey: string; marker: string; gender: string; lineCount: number }) => {
    const fd = new FormData();
    fd.append('audioFile', p.file);
    fd.append('projectKey', p.projectKey);
    fd.append('speakerKey', p.speakerKey);
    fd.append('marker', p.marker);
    fd.append('gender', p.gender);
    fd.append('lineCount', String(p.lineCount));
    return request<{ cast: CastVoice }>('/api/cast/voices', { method: 'POST', body: fd });
  },
  castVoiceFromVideo: (body: {
    projectKey: string;
    speakerKey: string;
    marker: string;
    gender: string;
    lineCount: number;
    ranges: { start: number; end: number }[];
  }) => request<{ cast: CastVoice; seconds: number }>('/api/cast/voices/from-video', json('POST', { ...body, cleanVocals: true })),
  deleteCastVoice: (projectKey: string, speakerKey: string) =>
    request(`/api/cast/voices?projectKey=${encodeURIComponent(projectKey)}&speakerKey=${encodeURIComponent(speakerKey)}`, {
      method: 'DELETE',
    }),

  // ── The one "make the video" function ──
  startVideo: (body: {
    filename: string;
    segments: TimelineSegment[];
    outputName: string;
    bgmMode: 'auto' | 'none';
    /** whole video (picture + voices) faster or slower */
    videoSpeed?: number;
    /** fill in a channel logo / watermark that stays put */
    removeLogo?: boolean;
    /** one voice (a channel voice id) acts every character */
    soloVoice?: string;
    /** take burned-in Chinese subtitles out of the picture */
    removeSubtitles?: boolean;
  }) =>
    request<{ jobId: string; notice?: string | null }>(
      '/api/video/generate',
      json('POST', {
        ...body,
        burnSubtitles: false, // no Khmer subtitles on the picture
        removeOriginalVocals: body.bgmMode === 'auto',
        naturalVoice: true,
        subtitleStyle: { fontSize: 22, position: 'bottom', textColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 2, boxEnabled: false },
      })
    ),
  videoJob: (jobId: string) => request<VideoJob>(`/api/video/generate/${encodeURIComponent(jobId)}`),
  videoResults: () => request<{ items: VideoResult[] }>('/api/video/results'),
  mergeVideos: (ids: string[], name: string) => request<{ item: VideoResult }>('/api/video/merge', json('POST', { ids, name })),
  deleteVideoResult: (id: string) => request(`/api/video/results/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  renameVideoResult: (id: string, name: string) =>
    request<{ item: VideoResult }>(`/api/video/results/${encodeURIComponent(id)}`, json('PATCH', { name })),

  // ── AI recap (one narrator retells the video) ──
  recapNarrators: () =>
    request<{ items: RecapNarrator[]; default: string; moods: string[]; geminiVoice?: boolean }>('/api/recap/narrators'),
  voiceFromFile: (file: File, name: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    return request<{ item: RecapNarrator }>('/api/voices/from-file', { method: 'POST', body: fd });
  },
  deleteCustomVoice: (id: string) => request(`/api/voices/custom/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  recapPreviewUrl: (id: string) => withToken(`/api/recap/narrators/${encodeURIComponent(id)}/preview`),
  recapScript: (body: { filename?: string; segments?: TimelineSegment[]; projectId?: string; targetSeconds: number }) =>
    request<{ title: string; scenes: RecapScene[]; duration: number; parts: string[] }>('/api/recap/script', json('POST', body)),
  startRecap: (body: {
    filename?: string;
    projectId?: string;
    scenes: RecapScene[];
    narrator: string;
    outputName: string;
    videoSpeed: number;
    removeLogo: boolean;
    removeSubtitles: boolean;
  }) =>
    request<{ jobId: string }>('/api/recap/render', json('POST', body)),

  // ── Long video (chunked) dubbing ──
  longdubCreate: (filename: string, chunkMinutes: number, voiceMode = 'voice_actor_clone') =>
    request<{ project: LongDubProject }>('/api/longdub/create', json('POST', { filename, chunkMinutes, voiceMode })),
  longdubBatch: (files: { filename: string; originalName: string }[], voiceMode = 'voice_actor_clone') =>
    request<{ project: LongDubProject }>('/api/longdub/batch', json('POST', { files, voiceMode })),
  longdubList: () => request<{ items: LongDubProject[] }>('/api/longdub'),
  longdubGet: (pid: string) => request<{ project: LongDubProject }>(`/api/longdub/${encodeURIComponent(pid)}`),
  longdubSaveChunk: (pid: string, idx: number, segments: TimelineSegment[]) =>
    request(`/api/longdub/${encodeURIComponent(pid)}/chunk/${idx}`, json('POST', { segments })),
  longdubRescan: (pid: string, idx: number) =>
    request<{ project: LongDubProject }>(`/api/longdub/${encodeURIComponent(pid)}/rescan/${idx}`, { method: 'POST' }),
  longdubGenerate: (
    pid: string,
    body: { bgmMode: 'auto' | 'none'; burnSubtitles: boolean; naturalVoice: boolean; outputName?: string; fromChunk?: number; speed?: number; mergeAll?: boolean; videoSpeed?: number; removeLogo?: boolean; removeSubtitles?: boolean; soloVoice?: string }
  ) => request<{ project: LongDubProject }>(`/api/longdub/${encodeURIComponent(pid)}/generate`, json('POST', body)),
  longdubDelete: (pid: string) => request(`/api/longdub/${encodeURIComponent(pid)}`, { method: 'DELETE' }),

  // ── Plans (KHQR) ──
  plans: () =>
    request<{ plans: SubscriptionPlan[]; status: SubscriptionStatus; khqrConfigured: boolean; banks: { id: 'primary' | 'alt'; label: string }[] }>(
      '/api/subscription/plans'
    ),
  createOrder: (plan: string, bank: 'primary' | 'alt') =>
    request<{ order: SubscriptionOrder }>('/api/subscription/create-order', json('POST', { plan, bank })),
  pollOrder: (ticket: string) =>
    request<{ order: SubscriptionOrder; status: SubscriptionStatus }>(`/api/subscription/order/${encodeURIComponent(ticket)}`),
  uploadReceipt: (ticket: string, file: File) => {
    const fd = new FormData();
    fd.append('receipt', file);
    return request<{ order: SubscriptionOrder }>(`/api/subscription/order/${encodeURIComponent(ticket)}/receipt`, { method: 'POST', body: fd });
  },
  myVox: () => request<OwnVox>('/api/me/voxcpm'),
  saveMyVox: (url: string, apiKey?: string) =>
    request<{ url: string; hasKey: boolean; status: OwnVox['status'] }>('/api/me/voxcpm', json('POST', { url, ...(apiKey ? { apiKey } : {}) })),
  myGemini: () => request<{ hasKey: boolean; masked: string; link: string }>('/api/me/gemini'),
  saveMyGemini: (key: string) => request<{ hasKey: boolean; masked: string; message?: string }>('/api/me/gemini', json('POST', { key })),
  clearMyGemini: () => request('/api/me/gemini', { method: 'DELETE' }),
  clearMyVox: () => request('/api/me/voxcpm', { method: 'DELETE' }),

  // ── Admin: plans, KHQR, orders ──
  adminPlans: () => request<{ plans: SubscriptionPlan[] }>('/api/admin/plans'),
  adminSavePlan: (plan: Partial<Omit<SubscriptionPlan, 'visible' | 'own_vox_url' | 'features' | 'perMonth'>> & { id: string; visible?: boolean; own_vox_url?: boolean }) =>
    request<{ plan: SubscriptionPlan }>('/api/admin/plans', json('POST', plan)),
  adminDeletePlan: (id: string) => request(`/api/admin/plans/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminKhqrStatus: () => request<KhqrConfig>('/api/admin/khqr/status'),
  adminKhqrConfig: (body: { slot: 'primary' | 'alt'; payload?: string; label?: string; rename?: boolean; displayName?: string; clear?: boolean }) =>
    request<KhqrConfig>('/api/admin/khqr/config', json('POST', body)),
  adminKhqrPreview: (slot: 'primary' | 'alt') => request<{ image: string; payee: string | null }>('/api/admin/khqr/preview', json('POST', { slot })),
  adminOrders: () => request<{ orders: AdminOrder[] }>('/api/admin/subscription/orders'),
  adminRejectOrder: (ticket: string) => request('/api/admin/subscription/reject', json('POST', { ticket })),
  adminMarkVoicePro: (voice: string, pro: boolean) => request(`/api/admin/voice-bank/${encodeURIComponent(voice)}/pro`, json('POST', { pro })),

  // ── Admin ──
  adminUsers: () => request<{ users: User[] }>('/api/admin/users'),
  adminSetPremium: (userId: number, days: number) => request('/api/admin/set-premium', json('POST', { userId, days })),
  adminRevokePremium: (userId: number) => request('/api/admin/revoke-premium', json('POST', { userId })),
  adminToggleVoxcpm: (userId: number, enabled: boolean, days?: number) =>
    request('/api/admin/toggle-voxcpm', json('POST', { userId, enabled, days })),
  adminResetDevice: (userId: number) => request('/api/admin/reset-device', json('POST', { userId })),
  adminConfirmOrder: (ticket: string) =>
    request<{ order: SubscriptionOrder }>('/api/admin/subscription/confirm', json('POST', { ticket })),
  adminLicenseKeys: () => request<{ keys: LicenseKey[] }>('/api/admin/license-keys'),
  adminCreateLicenseKey: (days: number) =>
    request<{ key: LicenseKey }>('/api/admin/license-keys/create', json('POST', { days, feature: 'voxcpm2' })),
  adminVoxDiagnose: () => request<VoxDiagnosis & { success: boolean }>('/api/admin/voxcpm/diagnose'),
  adminVoxSettings: () => request<VoxSettings>('/api/admin/voxcpm'),
  adminSaveVoxSettings: (body: { url?: string; apiKey?: string; reset?: boolean }) =>
    request<VoxSettings>('/api/admin/voxcpm', json('POST', body)),
  adminAddBankVoice: (p: { voice: string; emotion: string; transcript: string; pro: boolean; file: File }) => {
    const fd = new FormData();
    fd.append('pro', String(p.pro));
    fd.append('voice', p.voice);
    fd.append('emotion', p.emotion);
    fd.append('transcript', p.transcript);
    fd.append('audio', p.file);
    return request<{ report: VoiceReport | null }>('/api/admin/voice-bank', { method: 'POST', body: fd });
  },
  adminDeleteBankVoice: (voice: string) => request(`/api/admin/voice-bank/${encodeURIComponent(voice)}`, { method: 'DELETE' }),
};

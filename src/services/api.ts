import { User, LicenseKey, CharacterVoice, TimelineSegment, ProjectFile, StudioConfig, VoxcpmStatus, VideoDownloadResult, ProjectGroup, VideoShelfItem, HardwareProfile, CastVoice, SupabaseStatus } from '../types';

const API_BASE = '';

function getAuthToken(): string | null {
  return localStorage.getItem('studio_auth_token');
}

export function getDeviceId(): string {
  let devId = localStorage.getItem('studio_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('studio_device_id', devId);
  }
  return devId;
}

export async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const devId = getDeviceId();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('X-Device-Id')) {
    headers.set('X-Device-Id', devId);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorDetail = res.statusText;
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || errJson.message || errorDetail;
    } catch (_) {}
    throw new Error(errorDetail);
  }

  return res.json();
}

export const api = {
  // Auth & Single-Device Session
  login: (body: { username: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, deviceId: getDeviceId() }),
    }),

  register: (body: { username: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, deviceId: getDeviceId() }),
    }),

  logout: () => request('/api/auth/logout', { method: 'POST' }),

  getMe: () => request<{ user: User }>('/api/auth/me'),

  // License Key & VoxCPM2 Permissions
  activateLicense: (license_key: string) =>
    request<{ success: boolean; message: string; user: User }>('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key }),
    }),

  adminListLicenseKeys: () =>
    request<{ keys: LicenseKey[] }>('/api/admin/license-keys'),

  adminCreateLicenseKey: (days: number = 30, feature: string = 'voxcpm2') =>
    request<{ success: boolean; key: LicenseKey }>('/api/admin/license-keys/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days, feature }),
    }),

  adminDeleteLicenseKey: (keyId: number) =>
    request<{ success: boolean }>(`/api/admin/license-keys/${keyId}`, {
      method: 'DELETE',
    }),

  adminToggleUserVoxcpm: (userId: number, enabled: boolean, days?: number) =>
    request<{ success: boolean; data: any }>('/api/admin/toggle-voxcpm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, enabled, days }),
    }),

  adminListUsers: () => request<{ users: User[] }>('/api/admin/users'),

  adminSetPremium: (userId: number, days: number) =>
    request('/api/admin/set-premium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, days }),
    }),

  adminRevokePremium: (userId: number) =>
    request('/api/admin/revoke-premium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }),

  adminResetDevice: (userId: number) =>
    request<{ success: boolean; message: string }>('/api/admin/reset-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }),

  adminResetPassword: (userId: number, newPassword: string) =>
    request<{ success: boolean; message: string }>('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, newPassword }),
    }),

  adminDeleteUser: (userId: number) =>
    request<{ success: boolean }>('/api/admin/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }),

  // Config & System
  getConfig: () => request<StudioConfig>('/api/config'),

  updateConfig: (body: any) =>
    request('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getVoxcpmStatus: () => request<VoxcpmStatus>('/api/voxcpm/status'),

  switchVoxcpmMode: (mode: string, cloudUrl?: string) =>
    request('/api/voxcpm/switch-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, cloudUrl }),
    }),

  switchMode: (mode: string, cloudUrl?: string) =>
    request('/api/voxcpm/switch-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, cloudUrl }),
    }),

  getElevenlabsStatus: () => request<any>('/api/elevenlabs/status'),
  getElevenlabsVoices: () => request<any>('/api/elevenlabs/voices'),
  cloneElevenVoice: (voiceName: string, sampleFilename: string) =>
    request<{ success: boolean; voiceId: string; voiceName: string }>('/api/elevenlabs/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceName, sampleFilename }),
    }),

  getNetworkInfo: () => request<any>('/api/system/network-info'),

  getOutputStats: () => request<{ count: number; totalBytes: number; formattedSize: string }>('/api/outputs/stats'),


  clearOutputs: () => request<{ success: boolean; count: number; formattedFreed: string }>('/api/outputs/clear', { method: 'POST' }),

  // Media & Files
  uploadMedia: (file: File) => {
    const fd = new FormData();
    fd.append('mediaFile', file);
    return request<{ success: boolean; file: ProjectFile; filename: string; url: string }>('/api/upload', {
      method: 'POST',
      body: fd,
    });
  },
  uploadFile: (
    file: File,
    onProgress?: (percent: number, loaded: number, total: number) => void
  ): Promise<{ success: boolean; file: ProjectFile; filename: string; url: string }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('mediaFile', file);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent, e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch (err) {
            reject(new Error('Invalid JSON response from server'));
          }
        } else {
          try {
            const errJson = JSON.parse(xhr.responseText);
            reject(new Error(errJson.detail || errJson.message || `Upload failed with status ${xhr.status}`));
          } catch (_) {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network error during file upload'));
      xhr.open('POST', '/api/upload');

      const token = getAuthToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.send(fd);
    });
  },

  getFiles: () => request<ProjectFile[]>('/api/files'),

  deleteFile: (filename: string) =>
    request<{ success: boolean; message: string }>(`/api/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),

  clearAllFiles: () =>
    request<{ success: boolean; count: number; formattedFreed: string; message: string }>('/api/files/clear', {
      method: 'POST',
    }),

  // Characters
  getCharacters: () => request<{ success: boolean; count: number; characters: CharacterVoice[]; isFree: boolean }>('/api/characters/all'),

  createCharacter: (fd: FormData) => request('/api/characters/create', { method: 'POST', body: fd }),

  updateCharacter: (body: any) =>
    request('/api/characters/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  characterSpeak: (body: { voiceId: string; text: string; emotion?: string; gender?: string }) =>
    request<{ success: boolean; audioUrl: string }>('/api/character/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Character Voice Casting (1 តួ = 1 សំឡេង)
  uploadCastVoice: (params: { file: File; projectKey: string; speakerKey: string; marker: string; gender: string; lineCount: number }) => {
    const fd = new FormData();
    fd.append('audioFile', params.file);
    fd.append('projectKey', params.projectKey);
    fd.append('speakerKey', params.speakerKey);
    fd.append('marker', params.marker);
    fd.append('gender', params.gender);
    fd.append('lineCount', String(params.lineCount));
    return request<{ success: boolean; cast: CastVoice }>('/api/cast/voices', { method: 'POST', body: fd });
  },

  listCastVoices: (projectKey: string) =>
    request<{ success: boolean; casts: CastVoice[]; cloud: boolean }>(`/api/cast/voices?projectKey=${encodeURIComponent(projectKey)}`),

  deleteCastVoice: (projectKey: string, speakerKey: string) =>
    request<{ success: boolean; removed: boolean }>(
      `/api/cast/voices?projectKey=${encodeURIComponent(projectKey)}&speakerKey=${encodeURIComponent(speakerKey)}`,
      { method: 'DELETE' }
    ),

  getSupabaseStatus: (refresh = false) => request<SupabaseStatus>(`/api/supabase/status${refresh ? '?refresh=true' : ''}`),

  // Video Downloader
  downloadVideo: (url: string, quality = 'best') =>
    request<VideoDownloadResult>('/api/video/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, quality }),
    }),

  // Dubbing
  startDubbing: (body: any) =>
    request<{ success: boolean; jobId: string }>('/api/dubbing/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getDubbingStatus: (jobId: string) => request<any>(`/api/dubbing/status/${jobId}`),

  scanTimeline: (filename: string, scope = 'full', voiceMode = 'voice_actor_clone') =>
    request<{ success: boolean; duration: number; segments: TimelineSegment[] }>('/api/dubbing/scan-timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, scope, voiceMode }),
    }),

  generateLine: (body: { 
    text: string; 
    lineIndex?: number; 
    gender?: string; 
    voiceId?: string; 
    speakerId?: string; 
    emotion?: string;
    // Advanced emotional voice parameters
    intensity?: number;
    volume?: number;
    speed?: number;
    pitch?: number;
    breathiness?: number;
    raspiness?: number;
    vibrato?: number;
  }) =>
    request<{ success: boolean; lineIndex: number; audioUrl: string }>('/api/dubbing/generate-line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  assembleCustom: (params: { filename: string; segments: TimelineSegment[]; bgmAudio?: string; removeOriginalVocals?: boolean; vocalGain?: number; bgmGain?: number }) =>
    request<{ success: boolean; outputVideo: string; outputAudio: string; totalLinesDubbed: number }>('/api/dubbing/assemble-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  renderExportVideo: (params: {
    filename: string;
    inputVideo?: string;
    titleOverlayBase64?: string;
    burnSubtitles?: boolean;
    subtitles?: any[];
    resolution?: string;
    format?: string;
    bitrate?: string;
    watermark?: any;
    subtitleStyle?: any;
    turbo?: boolean;
    outputDir?: string;
  }) =>
    request<{ success: boolean; outputVideo: string; filename: string; hasOverlay: boolean; hasSubtitles: boolean }>('/api/video/render-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  // Translation
  translate: (text: string, sourceLang = 'zh', targetLang = 'km') =>
    request<{ translation: string }>('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceLang, targetLang }),
    }),

  // Audio Mixer
  separateAudio: (filename: string, preferAi = true) =>
    request<{ success: boolean; engine: string; vocalsUrl: string; bgmUrl: string }>('/api/audio/separate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, preferAi }),
    }),

  // Project Persistence (Never lose timeline/segments on browser refresh)
  saveProject: (data: any) =>
    request<{ success: boolean; message: string }>('/api/project/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  loadProject: () =>
    request<{ success: boolean; project: any }>('/api/project/load'),

  clearProject: () =>
    request<{ success: boolean; message: string }>('/api/project/clear', {
      method: 'POST',
    }),

  // Video Shelf (Store up to 10 Videos ready for Dubbing)
  getVideoShelf: () =>
    request<{
      success: boolean;
      shelf: VideoShelfItem[];
      maxSlots: number;
      usedSlots: number;
      remainingSlots: number;
      groups: ProjectGroup[];
    }>('/api/shelf'),

  addToShelf: (body: {
    filename: string;
    originalName?: string;
    size?: number;
    duration?: number;
    thumbnail?: string;
    groupId?: string;
    groupName?: string;
  }) =>
    request<{ success: boolean; message: string; item: VideoShelfItem; shelf: VideoShelfItem[] }>('/api/shelf/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  removeFromShelf: (itemId: string) =>
    request<{ success: boolean; message: string; shelf: VideoShelfItem[] }>(`/api/shelf/${itemId}`, {
      method: 'DELETE',
    }),

  updateShelfGroup: (itemId: string, groupId: string, groupName: string) =>
    request<{ success: boolean; shelf: VideoShelfItem[] }>(`/api/shelf/${itemId}/group`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, groupName }),
    }),

  // Project & Series Groups
  getProjectGroups: () =>
    request<{ success: boolean; groups: ProjectGroup[] }>('/api/groups'),

  createProjectGroup: (body: {
    name: string;
    color?: string;
    description?: string;
    maleLeadVoice?: string;
    femaleLeadVoice?: string;
    narratorVoice?: string;
    supportingVoice?: string;
  }) =>
    request<{ success: boolean; group: ProjectGroup; groups: ProjectGroup[] }>('/api/groups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  updateProjectGroup: (
    groupId: string,
    body: {
      name?: string;
      color?: string;
      description?: string;
      maleLeadVoice?: string;
      femaleLeadVoice?: string;
      narratorVoice?: string;
      supportingVoice?: string;
    }
  ) =>
    request<{ success: boolean; group: ProjectGroup; groups: ProjectGroup[] }>(`/api/groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteProjectGroup: (groupId: string) =>
    request<{ success: boolean; groups: ProjectGroup[] }>(`/api/groups/${groupId}`, {
      method: 'DELETE',
    }),

  // Hardware Performance Profile
  getHardwareInfo: () =>
    request<HardwareProfile>('/api/system/hardware'),

  // In-App Software Update System
  getAppVersion: () =>
    request<{
      current_version: string;
      latest_version: string;
      has_update: boolean;
      release_date: string;
      download_url?: string;
      changelog: Array<{ type: string; text: string }>;
      patch_size_mb?: number;
    }>('/api/system/version'),

  checkUpdate: () =>
    request<{
      has_update: boolean;
      current_version: string;
      latest_version: string;
      download_url?: string;
      patch_size_mb?: number;
      changelog: Array<{ type: string; text: string }>;
      source?: string;
    }>('/api/system/check-update', { method: 'POST' }),

  applyUpdate: (body?: { target_version?: string; download_url?: string }) =>
    request<{ success: boolean; message: string; new_version: string }>('/api/system/apply-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),

  uploadPatchFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ success: boolean; message: string; new_version: string }>('/api/system/upload-patch', {
      method: 'POST',
      body: formData,
    });
  },

  // Checkpoints & Restore System
  getCheckpoints: () =>
    request<{
      success: boolean;
      checkpoints: Array<{
        id: string;
        name: string;
        version: string;
        type: string;
        created_at: string;
        formatted_date: string;
        size_mb: number;
        files_count: number;
        components: string[];
        note?: string;
      }>;
      count: number;
      current_version: string;
    }>('/api/system/checkpoints'),

  createCheckpoint: (name?: string, note?: string) =>
    request<{ success: boolean; message: string; checkpoint: any }>('/api/system/checkpoints/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, note }),
    }),

  restoreCheckpoint: (checkpoint_id: string) =>
    request<{ success: boolean; message: string; restored_version: string }>('/api/system/checkpoints/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint_id }),
    }),

  deleteCheckpoint: (checkpoint_id: string) =>
    request<{ success: boolean; message: string }>(`/api/system/checkpoints/${checkpoint_id}`, {
      method: 'DELETE',
    }),

  publishAdminUpdate: (payload: {
    latest_version: string;
    changelog: Array<{ type: string; text: string }>;
    download_url?: string;
    patch_size_mb?: number;
  }) =>
    request('/api/system/admin/publish-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  rollbackUpdate: () =>
    request<{ success: boolean; message: string; restored_version?: string }>('/api/system/update/rollback', {
      method: 'POST',
    }),
};



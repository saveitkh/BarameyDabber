import type { ProjectFile, User } from './types';

export interface RecentUpload {
  filename: string;
  originalName: string;
  size: number;
  at: number;
}

const key = (u: User) => `kd_recent_v1_${u.id}`;

export const listRecent = (u: User): RecentUpload[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(key(u)) || '[]');
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.filename === 'string') : [];
  } catch {
    return [];
  }
};

const save = (u: User, items: RecentUpload[]) => {
  try {
    localStorage.setItem(key(u), JSON.stringify(items.slice(0, 8)));
  } catch {}
};

export const rememberUpload = (u: User, f: ProjectFile) =>
  save(u, [{ filename: f.filename, originalName: f.originalName || f.filename, size: f.size, at: Date.now() }, ...listRecent(u).filter((r) => r.filename !== f.filename)]);

export const forgetUpload = (u: User, filename: string) => save(u, listRecent(u).filter((r) => r.filename !== filename));

/** Does the server still hold this file? (it may have been cleaned up) */
export const stillOnServer = async (filename: string): Promise<boolean> => {
  try {
    const r = await fetch(`/media/uploads/${encodeURIComponent(filename)}`, { method: 'HEAD' });
    return r.ok;
  } catch {
    return true; // offline: assume yes rather than hiding the user's work
  }
};

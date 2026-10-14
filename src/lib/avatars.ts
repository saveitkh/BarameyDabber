import { useCallback, useEffect, useState } from 'react';

export interface Profile {
  photo?: string;
  emoji?: string;
}

export const EMOJIS = {
  male: ['👨', '🧔', '👦', '👴', '🤴', '🥷', '🦸‍♂️', '🧙‍♂️'],
  female: ['👩', '👧', '👵', '👸', '🧕', '🥷', '🦸‍♀️', '🧙‍♀️'],
};

export const defaultEmoji = (gender: 'male' | 'female', number: number) => EMOJIS[gender][(Math.max(1, number) - 1) % EMOJIS[gender].length];

const storeKey = (projectKey: string) => `kd_avatars_v1_${projectKey}`;

const read = (projectKey: string | null): Record<string, Profile> => {
  if (!projectKey) return {};
  try {
    return JSON.parse(localStorage.getItem(storeKey(projectKey)) || '{}') || {};
  } catch {
    return {};
  }
};

/** Profile picture / emoji per character, remembered per video on this device. */
export const useProfiles = (projectKey: string | null) => {
  const [profiles, setProfiles] = useState<Record<string, Profile>>(() => read(projectKey));
  useEffect(() => setProfiles(read(projectKey)), [projectKey]);
  const setProfile = useCallback(
    (character: string, p: Profile | null) => {
      setProfiles((prev) => {
        const next = { ...prev };
        if (p) next[character] = p;
        else delete next[character];
        if (projectKey) {
          try {
            localStorage.setItem(storeKey(projectKey), JSON.stringify(next));
          } catch {}
        }
        return next;
      });
    },
    [projectKey]
  );
  return { profiles, setProfile };
};

/** Square-crop and shrink a picked photo so it is cheap to keep on the device. */
export const photoToDataUrl = (file: File, size = 112): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('មិនអាចអានរូបនេះបានទេ'));
    };
    img.src = url;
  });

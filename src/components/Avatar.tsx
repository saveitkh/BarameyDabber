import React, { useRef } from 'react';
import { Camera } from 'lucide-react';
import type { Character } from '../lib/cast';
import { characterColor } from '../lib/cast';
import { EMOJIS, Profile, defaultEmoji, photoToDataUrl } from '../lib/avatars';
import { Button, Sheet, useToast } from './ui';

/** Character profile picture: their photo if set, else an emoji on the character's colour. */
export const Avatar: React.FC<{ character: Character; profile?: Profile; size?: number; className?: string }> = ({ character: c, profile, size = 26, className = '' }) => {
  const color = characterColor(c.key);
  return (
    <span
      className={`relative shrink-0 rounded-full overflow-hidden flex items-center justify-center ${className}`}
      style={{ width: size, height: size, background: `${color}33` }}
    >
      {profile?.photo ? (
        <img src={profile.photo} alt="" className="w-full h-full object-cover" />
      ) : (
        <span style={{ fontSize: size * 0.58, lineHeight: 1 }}>{profile?.emoji || defaultEmoji(c.gender, c.number)}</span>
      )}
    </span>
  );
};

export const ProfileSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  character: Character;
  profile?: Profile;
  onChange: (p: Profile | null) => void;
}> = ({ open, onClose, character: c, profile, onChange }) => {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet open={open} onClose={onClose} title="រូបតួអង្គ">
      <div className="flex flex-col items-center gap-4">
        <Avatar character={c} profile={profile} size={56} />
        <div className="grid grid-cols-4 gap-2 w-full">
          {EMOJIS[c.gender].map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onChange({ emoji: e });
                onClose();
              }}
              className={`h-12 rounded-xl text-2xl ring-1 ${profile?.emoji === e && !profile.photo ? 'ring-2 ring-accent bg-accent/10' : 'ring-line bg-raised'}`}
            >
              {e}
            </button>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              onChange({ ...profile, photo: await photoToDataUrl(f) });
              onClose();
            } catch (err: any) {
              toast(err.message, 'error');
            }
          }}
        />
        <div className="grid grid-cols-2 gap-2 w-full">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Camera className="w-4 h-4" /> ដាក់រូប
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onChange(null);
              onClose();
            }}
          >
            ដូចដើម
          </Button>
        </div>
      </div>
    </Sheet>
  );
};

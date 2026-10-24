import React, { useRef, useState } from 'react';
import { AlertTriangle, Film, Loader2, Lock, Merge, Mic, Pencil, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { AI_AUTO, AI_VOICES, AUTO_VOICE, Character, bankName, characterColor, displayName, isAiVoice, isBankVoice, km } from '../lib/cast';
import type { Profile } from '../lib/avatars';
import type { Casting } from '../lib/useCasting';
import type { BankVoice, CastVoice, TimelineSegment } from '../lib/types';
import { Button, PlayButton, Segmented, Sheet, useToast } from './ui';
import { Avatar, ProfileSheet } from './Avatar';

const AGE_WORDS: Record<string, string> = {
  adult: 'ពេញវ័យ',
  deep: 'សំឡេងធ្ងន់',
  high: 'សំឡេងខ្ពស់',
  old: 'ចាស់',
  young: 'ក្មេង',
  child: 'កុមារ',
  teen: 'យុវវ័យ',
};

/** "male-adult-1" -> "ប្រុស · ពេញវ័យ ១" */
export const prettyBankName = (name: string): string => {
  const [g, age, n] = name.split('-');
  if (g !== 'male' && g !== 'female') return name;
  const gender = g === 'female' ? 'ស្រី' : 'ប្រុស';
  return [gender, age ? `${AGE_WORDS[age] || age}${n ? ` ${km(n)}` : ''}` : ''].filter(Boolean).join(' · ');
};

export const voiceInfo = (voiceId: string, cast: CastVoice | undefined, bank: BankVoice[]) => {
  if (cast && cast.voiceId === voiceId) return { label: 'សំឡេងផ្ទាល់ខ្លួន (Upload / ក្លូនពីវីដេអូ)', preview: cast.previewUrl, kind: 'custom' as const };
  if (voiceId === AUTO_VOICE || !voiceId) return { label: 'Auto — VoxCPM2 ជ្រើសសំឡេងមិនជាន់គ្នា', preview: '', kind: 'auto' as const };
  if (voiceId === AI_AUTO) return { label: 'សំឡេង AI — តាមភេទ & អាយុតួ (លឿន)', preview: '', kind: 'auto' as const };
  if (isAiVoice(voiceId)) {
    const v = AI_VOICES.find((a) => a.id === voiceId);
    return { label: `សំឡេង AI · ${v ? v.label : voiceId.slice(3)}`, preview: '', kind: 'auto' as const };
  }
  if (isBankVoice(voiceId)) {
    const v = bank.find((b) => b.id === voiceId);
    return { label: prettyBankName(bankName(voiceId)), preview: v?.previewUrl || '', kind: 'bank' as const };
  }
  return { label: 'សំឡេងចាស់ (ប្ដូរទៅ Auto ល្អជាង)', preview: '', kind: 'other' as const };
};

interface Props {
  character: Character;
  segments: TimelineSegment[];
  casting: Casting;
  bank: BankVoice[];
  bankOnline: boolean;
  others: Character[];
  /** Other characters sharing this exact voice */
  sharedWith: string[];
  disabled: boolean;
  profile?: Profile;
  onProfile: (p: Profile | null) => void;
  proLimit: number;
  /** Pro voices already chosen by the characters of this video */
  proPicked: Set<string>;
  onOpenAccount: () => void;
}

export const CharacterCard: React.FC<Props> = ({ character: c, segments, casting, bank, bankOnline, others, sharedWith, disabled, profile, onProfile, proLimit, proPicked, onOpenAccount }) => {
  const color = characterColor(c.key);
  const [profileOpen, setProfileOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(c.name);
  const busy = casting.busyKey === c.key;
  const info = voiceInfo(c.voiceId, casting.casts[c.key], bank);

  const saveName = () => {
    casting.rename(c, nameDraft);
    setEditing(false);
  };

  return (
    <article className="bg-surface rounded-2xl ring-1 ring-line overflow-hidden" style={{ boxShadow: `inset 4px 0 0 ${color}` }}>
      <div className="pl-5 pr-4 pt-3.5 pb-3 flex items-start gap-3">
        <button type="button" disabled={disabled} onClick={() => setProfileOpen(true)} aria-label="ប្ដូររូបតួអង្គ" className="relative shrink-0">
          <Avatar character={c} profile={profile} size={32} />
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-surface ring-1 ring-line-strong flex items-center justify-center">
            <Pencil className="w-2.5 h-2.5 text-mute" />
          </span>
        </button>
        <div className="flex-1 min-w-0">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveName();
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                maxLength={40}
                placeholder={c.marker}
                className="flex-1 min-w-0 rounded-lg ring-1 ring-line-strong px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </form>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setNameDraft(c.name);
                setEditing(true);
              }}
              className="flex items-center gap-1.5 max-w-full text-left"
            >
              <span className="text-[15px] font-bold text-ink truncate">{displayName(c)}</span>
              {c.name && <span className="text-xs text-mute shrink-0">({c.marker})</span>}
              <Pencil className="w-3.5 h-3.5 text-mute shrink-0" />
            </button>
          )}
          <p className="text-xs text-mute mt-0.5">
            {km(c.lineIndexes.length)} ឃ្លា · {km(Math.round(c.seconds))} វិនាទី
          </p>
        </div>
        <Segmented
          value={c.gender}
          disabled={disabled}
          onChange={(g) => casting.setGender(c, g)}
          options={[
            { value: 'male', label: 'ប្រុស' },
            { value: 'female', label: 'ស្រី' },
          ]}
        />
      </div>

      {/* Voice */}
      <div className="mx-4 mb-3 rounded-xl bg-raised ring-1 ring-line px-3 py-2.5 flex items-center gap-3">
        <div className="w-9 h-9 shrink-0 rounded-full bg-surface ring-1 ring-line flex items-center justify-center">
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
          ) : info.kind === 'auto' ? (
            <Sparkles className="w-4 h-4 text-accent" />
          ) : (
            <Mic className="w-4 h-4" style={{ color }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-mute">សំឡេងតួ</p>
          <p className="text-sm font-semibold text-ink truncate">{busy ? 'កំពុងរៀបចំសំឡេង…' : info.label}</p>
        </div>
        {info.preview && <PlayButton src={info.preview} size="sm" />}
        <Button variant="secondary" className="min-h-[36px] px-3 text-xs" disabled={disabled || busy} onClick={() => setPicker(true)}>
          ប្ដូរ
        </Button>
      </div>

      {sharedWith.length > 0 && (
        <p className="mx-4 mb-3 -mt-1 flex items-start gap-1.5 text-xs text-warn">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          សំឡេងដូចគ្នានឹង {sharedWith.join(', ')} — ជ្រើសសំឡេងផ្សេង ដើម្បីបែងចែកតួឲ្យច្បាស់
        </p>
      )}

      {others.length > 0 && (
        <div className="border-t border-line">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMergeOpen(true)}
            className="flex items-center gap-1.5 px-5 min-h-[40px] text-xs font-semibold text-ink-2"
          >
            <Merge className="w-4 h-4" /> បញ្ចូលតួនេះទៅតួផ្សេង
          </button>
        </div>
      )}

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} character={c} profile={profile} onChange={onProfile} />

      <VoicePicker
        open={picker}
        onClose={() => setPicker(false)}
        character={c}
        casting={casting}
        bank={bank}
        bankOnline={bankOnline}
        current={c.voiceId}
        proLimit={proLimit}
        proPicked={proPicked}
        onOpenAccount={onOpenAccount}
      />

      <Sheet open={mergeOpen} onClose={() => setMergeOpen(false)} title={`បញ្ចូល ${displayName(c)} ទៅក្នុងតួ…`}>
        <p className="text-xs text-mute mb-3">ប្រើពេល AI បំបែកមនុស្សតែម្នាក់ជា ២ តួ។ ឃ្លាទាំងអស់នឹងប្រើសំឡេងរបស់តួដែលអ្នកជ្រើស។</p>
        <div className="flex flex-col gap-2">
          {others.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                casting.merge(c, o);
                setMergeOpen(false);
              }}
              className="flex items-center gap-3 rounded-xl ring-1 ring-line px-3 min-h-[52px] text-left hover:bg-raised"
            >
              <span className="w-3 h-3 rounded-full" style={{ background: characterColor(o.key) }} />
              <span className="flex-1 text-sm font-semibold">{displayName(o)}</span>
              <span className="text-xs text-mute">{km(o.lineIndexes.length)} ឃ្លា</span>
            </button>
          ))}
        </div>
      </Sheet>
    </article>
  );
};

const VoicePicker: React.FC<{
  open: boolean;
  onClose: () => void;
  character: Character;
  casting: Casting;
  bank: BankVoice[];
  bankOnline: boolean;
  current: string;
  proLimit: number;
  proPicked: Set<string>;
  onOpenAccount: () => void;
}> = ({ open, onClose, character: c, casting, bank, bankOnline, current, proLimit, proPicked, onOpenAccount }) => {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const same = bank.filter((v) => v.gender === c.gender);
  const rest = bank.filter((v) => v.gender !== c.gender);
  const custom = casting.casts[c.key];

  const choose = (id: string) => {
    const v = bank.find((b) => b.id === id);
    if (v?.locked) {
      toast('សំឡេង Pro ត្រូវការគម្រោង Pro ឬខ្ពស់ជាងនេះ — ដំឡើងគម្រោងក្នុង ការកំណត់', 'warning');
      onClose();
      onOpenAccount();
      return;
    }
    if (v?.pro && proLimit > 0 && !proPicked.has(id) && proPicked.size >= proLimit) {
      toast(`គម្រោងរបស់អ្នកជ្រើសសំឡេង Pro បាន ${km(proLimit)} សំឡេងក្នុងមួយវីដេអូ — ប្ដូរតួផ្សេងទៅសំឡេងធម្មតាសិន`, 'warning');
      return;
    }
    casting.setVoice(c, id);
    onClose();
  };

  const Option: React.FC<{ id: string; title: string; sub?: string; preview?: string; icon?: React.ReactNode; pro?: boolean; locked?: boolean }> = ({ id, title, sub, preview, icon, pro, locked }) => {
    const active = current === id;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => choose(id)}
        onKeyDown={(e) => e.key === 'Enter' && choose(id)}
        className={`flex items-center gap-3 rounded-xl px-3 min-h-[56px] cursor-pointer ring-1 transition-colors ${
          active ? 'ring-2 ring-accent bg-accent/10' : 'ring-line hover:bg-raised'
        }`}
      >
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate flex items-center gap-1.5">
            {title}
            {pro && <span className="text-[10px] font-bold text-warn bg-amber-500/10 rounded px-1.5 py-0.5">PRO</span>}
            {locked && <Lock className="w-3.5 h-3.5 text-mute" />}
          </p>
          {sub && <p className="text-[11px] text-mute truncate">{sub}</p>}
        </div>
        {preview && <PlayButton src={preview} size="sm" />}
      </div>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={`សំឡេងសម្រាប់ ${displayName(c)}`}>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold text-mute">សំឡេង AI — លឿន មិនបាច់ Clone</p>
        <Option
          id={AI_AUTO}
          title="AI តាមតួ (ណែនាំ)"
          sub="AI ជ្រើសសំឡេងតាមភេទ & អាយុ (ក្មេង/យុវវ័យ/ពេញវ័យ/ចាស់) និយាយមានអារម្មណ៍តាមរឿងដើម"
          icon={<Sparkles className="w-5 h-5 text-accent shrink-0" />}
        />
        <div className="flex flex-wrap gap-1.5">
          {AI_VOICES.filter((a) => a.gender === c.gender).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => choose(a.id)}
              className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold ring-1 ${
                current === a.id ? 'ring-2 ring-accent bg-accent/10 text-accent' : 'ring-line text-ink-2 hover:bg-raised'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        <p className="text-xs font-bold text-mute mt-3">VoxCPM2 — ក្លូនសំឡេង</p>
        <Option
          id={AUTO_VOICE}
          title="Auto (ណែនាំ)"
          sub="VoxCPM2 ផ្ដល់សំឡេងមួយដាច់ដោយឡែកឲ្យតួនីមួយៗ ហើយរក្សាដដែលគ្រប់ឃ្លា"
          icon={<Sparkles className="w-5 h-5 text-accent shrink-0" />}
        />

        {!bankOnline && (
          <p className="text-xs text-warn bg-amber-500/10 rounded-xl px-3 py-2 mt-1">
            ម៉ាស៊ីន VoxCPM2 មិនទាន់រួចរាល់ — នឹងប្រើសំឡេងខ្មែរ AI ធម្មតាជំនួសសិន។
          </p>
        )}

        {proLimit !== 0 && bank.some((v) => v.pro) && (
          <p className="text-[11px] text-mute">
            សំឡេង <b className="text-warn">PRO</b> ច្បាស់ល្អ៖ {proLimit < 0 ? 'ជ្រើសបានទាំងអស់' : `ជ្រើសបាន ${km(proLimit)} ក្នុងមួយវីដេអូ (បានជ្រើស ${km(proPicked.size)})`}
          </p>
        )}
        {proLimit === 0 && bank.some((v) => v.pro) && (
          <p className="text-[11px] text-mute flex items-center gap-1">
            <Lock className="w-3 h-3" /> សំឡេង <b className="text-warn">PRO</b> ត្រូវការគម្រោង Pro — ស្ដាប់គំរូបាន ប៉ុន្តែជ្រើសមិនបាន។
          </p>
        )}
        {same.length > 0 && <p className="text-xs font-bold text-mute mt-3">សំឡេង{c.gender === 'female' ? 'ស្រី' : 'ប្រុស'}</p>}
        {same.map((v) => (
          <Option key={v.id} id={v.id} title={prettyBankName(v.name)} sub={v.name} preview={v.previewUrl} pro={v.pro} locked={v.locked} />
        ))}
        {rest.length > 0 && <p className="text-xs font-bold text-mute mt-3">សំឡេងផ្សេងទៀត</p>}
        {rest.map((v) => (
          <Option key={v.id} id={v.id} title={prettyBankName(v.name)} sub={v.name} preview={v.previewUrl} pro={v.pro} locked={v.locked} />
        ))}

        <p className="text-xs font-bold text-mute mt-3">ក្លូនសំឡេងផ្ទាល់ខ្លួន</p>
        {custom && (
          <div className="flex items-center gap-3 rounded-xl ring-2 ring-accent bg-accent/10 px-3 min-h-[56px]">
            <Mic className="w-5 h-5 text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">សំឡេងបច្ចុប្បន្ន</p>
              <p className="text-[11px] text-mute truncate">{custom.originalName || custom.filename}</p>
            </div>
            <PlayButton src={custom.previewUrl} size="sm" />
            <button
              type="button"
              onClick={() => casting.setVoice(c, AUTO_VOICE)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-bad hover:bg-red-500/10"
              aria-label="លុបសំឡេងនេះ"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              casting.cloneFromVideo(c);
              onClose();
            }}
          >
            <Film className="w-4 h-4" /> ពីវីដេអូ
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> Upload
          </Button>
        </div>
        <p className="text-[11px] text-mute leading-relaxed">
          <Wand2 className="inline w-3 h-3 mr-1" />
          សំឡេងគំរូល្អ៖ មនុស្សម្នាក់និយាយ ៦–១៥ វិនាទី គ្មានភ្លេង។ "ពីវីដេអូ" កាត់ឃ្លារបស់តួនេះពីរឿងដោយស្វ័យប្រវត្តិ ហើយដកភ្លេងចេញ។
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) {
              casting.uploadVoice(c, f);
              onClose();
            }
          }}
        />
      </div>
    </Sheet>
  );
};

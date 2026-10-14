import React, { useEffect, useState } from 'react';
import { ChevronRight, Film, Link2, Mic, Play, Plus, Upload, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { km } from '../lib/cast';
import type { BankVoice, SubscriptionStatus, User, VideoResult } from '../lib/types';
import { prettyBankName } from '../components/CharacterCard';
import { Card, PlayButton, Progress } from '../components/ui';
import { telegramProfile } from '../lib/telegram';

interface Props {
  user: User;
  bank: BankVoice[];
  videos: VideoResult[] | null;
  onCreate: () => void;
  onUpload: () => void;
  onLink: () => void;
  onVideos: () => void;
  onVoices: () => void;
  onAccount: () => void;
}

const daysLeft = (iso?: string | null) => {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return Number.isFinite(d) ? Math.max(0, d) : null;
};

export const HomeScreen: React.FC<Props> = ({ user, bank, videos, onCreate, onUpload, onLink, onVideos, onVoices, onAccount }) => {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  useEffect(() => {
    api.plans().then((r) => setStatus(r.status)).catch(() => {});
  }, []);

  const name = telegramProfile().name || user.username;
  const left = daysLeft(status?.expiresAt);
  const trialPct = status && status.trialLimit ? Math.round((status.trialUsed / status.trialLimit) * 100) : 0;
  const recent = (videos || []).slice(0, 3);
  const top = bank.slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-ink">
          សួស្តី{name ? ` ${name}` : ''}! <span aria-hidden>👋</span>
        </h2>
        <p className="text-xs text-mute mt-0.5">បង្កើតសំឡេងខ្មែរសម្រាប់វីដេអូជាមួយ TeleScripts AI</p>
      </div>

      {/* Hero call to action */}
      <button
        type="button"
        onClick={onCreate}
        className="w-full text-left rounded-2xl p-[1px] bg-gradient-to-r from-cyan-500/70 via-sky-500/50 to-blue-600/60 shadow-glow active:scale-[.99] transition-transform"
      >
        <span className="flex items-center gap-3.5 rounded-[15px] bg-surface p-4">
          <span className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-cyan-400 to-sky-600 flex items-center justify-center text-navy shadow-md shadow-cyan-500/30">
            <Plus className="w-6 h-6" strokeWidth={2.8} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 text-base font-bold text-ink">
              បង្កើត Dub ថ្មី
              <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/20">New</span>
            </span>
            <span className="block text-xs text-mute mt-0.5">បញ្ចូលវីដេអូ ឬ Link ដើម្បីបង្កើតសំឡេងខ្មែរ</span>
          </span>
          <span className="w-8 h-8 shrink-0 rounded-full bg-raised ring-1 ring-line-strong flex items-center justify-center text-accent">
            <ChevronRight className="w-4 h-4" />
          </span>
        </span>
      </button>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Upload, en: 'Upload Video', km: 'បញ្ចូលវីដេអូ', tone: 'text-accent bg-accent/10', go: onUpload },
          { icon: Link2, en: 'Paste Link', km: 'ភ្ជាប់តំណ', tone: 'text-cyan-300 bg-cyan-400/10', go: onLink },
          { icon: Mic, en: 'Voices', km: 'សំឡេង', tone: 'text-violet-300 bg-violet-400/10', go: onVoices },
        ].map((a) => (
          <button key={a.en} type="button" onClick={a.go} className="rounded-2xl bg-surface ring-1 ring-line py-4 px-2 flex flex-col items-center gap-2 active:bg-raised">
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${a.tone}`}>
              <a.icon className="w-5 h-5" />
            </span>
            <span className="text-[12px] font-semibold text-ink font-sans leading-tight">{a.en}</span>
            <span className="text-[11px] text-mute leading-tight">{a.km}</span>
          </button>
        ))}
      </div>

      {/* Plan / usage */}
      <Card className="p-4">
        <button type="button" onClick={onAccount} className="w-full flex items-center gap-3 text-left">
          <span className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-bold text-ink">{status?.isPaid ? 'គម្រោងរបស់អ្នក' : 'ការសាកល្បងឥតគិតថ្លៃ'}</span>
            <span className="block text-xs text-mute">
              {status?.isPaid ? (status.plan === 'unlimited' ? 'គ្មានដែនកំណត់' : 'ប្រចាំខែ') : 'ដំឡើងដើម្បីប្រើសំឡេងក្លូន VoxCPM2'}
            </span>
          </span>
          {status?.isPaid && left !== null && status.plan !== 'unlimited' && (
            <span className="text-[11px] font-semibold text-accent bg-accent/10 ring-1 ring-accent/30 rounded-full px-2.5 py-1">នៅសល់ {km(left)} ថ្ងៃ</span>
          )}
          <ChevronRight className="w-4 h-4 text-mute" />
        </button>
        {status && !status.isPaid && status.trialLimit > 0 && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-xs mb-1.5">
              <span className="text-ink">
                <b className="text-lg">{km(status.trialUsed)}</b> <span className="text-mute">/ {km(status.trialLimit)} ដង</span>
              </span>
              <span className="text-mute">នៅសល់ {km(status.trialRemaining)}</span>
            </div>
            <Progress value={trialPct} />
          </div>
        )}
      </Card>

      {/* Recent videos */}
      <section>
        <div className="flex items-center mb-2.5 px-0.5">
          <h3 className="flex-1 text-base font-bold text-ink">វីដេអូថ្មីៗ</h3>
          {recent.length > 0 && (
            <button type="button" onClick={onVideos} className="text-xs font-semibold text-accent inline-flex items-center gap-0.5">
              ទាំងអស់ <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {recent.length ? (
          <div className="flex flex-col gap-2.5">
            {recent.map((v) => (
              <button key={v.id} type="button" onClick={onVideos} className="flex items-center gap-3 rounded-2xl bg-surface ring-1 ring-line p-3 text-left active:bg-raised">
                <span className="relative w-24 aspect-video shrink-0 rounded-lg overflow-hidden bg-raised flex items-center justify-center">
                  {v.exists !== false && <video src={`${v.video}#t=0.5`} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
                  <span className="relative w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
                    <Play className="w-3.5 h-3.5 text-white ml-0.5" />
                  </span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="inline-block text-[10px] font-semibold text-ok bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded px-1.5 py-0.5">● រួចរាល់</span>
                  <span className="block text-sm font-semibold text-ink truncate mt-1">{v.name}</span>
                  <span className="block text-xs text-mute">ខ្មែរ · {km(v.lines)} ឃ្លា</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" onClick={onCreate} className="w-full rounded-2xl border border-dashed border-line-strong py-6 flex flex-col items-center gap-2 text-mute">
            <Film className="w-6 h-6" />
            <span className="text-xs">មិនទាន់មានវីដេអូ — ចុចដើម្បីបង្កើតវីដេអូដំបូង</span>
          </button>
        )}
      </section>

      {/* Top voices */}
      {top.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center mb-3">
            <h3 className="flex-1 text-sm font-bold text-ink flex items-center gap-2">
              <Mic className="w-4 h-4 text-accent" /> សំឡេងពេញនិយម
            </h3>
            <button type="button" onClick={onVoices} className="text-xs text-accent font-semibold">
              {km(bank.length)} សំឡេង
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {top.map((v) => (
              <div key={v.id} className="rounded-xl bg-raised ring-1 ring-line p-2.5 flex flex-col items-center gap-1.5">
                <PlayButton src={v.previewUrl} size="sm" />
                <span className="text-xs font-semibold text-ink text-center leading-tight">{prettyBankName(v.name)}</span>
                <span className={`text-[10px] ${v.gender === 'female' ? 'text-pink-300' : 'text-accent'}`}>{v.gender === 'female' ? 'ស្រី' : v.gender === 'male' ? 'ប្រុស' : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

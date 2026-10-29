import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, Loader2, PenLine, Play, Square, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { km } from '../lib/cast';
import { haptic } from '../lib/telegram';
import type { ProjectFile, RecapNarrator, RecapScene, TimelineSegment, User, VideoJob } from '../lib/types';
import { Button, Card, Progress, Segmented, useToast } from './ui';

const MOODS: { value: string; label: string }[] = [
  { value: 'neutral', label: '😐 ធម្មតា' },
  { value: 'dramatic', label: '🎭 តានតឹង' },
  { value: 'excited', label: '🤩 រំភើប' },
  { value: 'happy', label: '😊 សប្បាយ' },
  { value: 'sad', label: '😢 សោកសៅ' },
  { value: 'fearful', label: '😨 ភ័យ' },
  { value: 'angry', label: '😠 ខឹង' },
  { value: 'heroic', label: '💪 ក្លាហាន' },
];

const LENGTHS = [
  { value: '60', label: '១ នាទី' },
  { value: '180', label: '៣ នាទី' },
  { value: '300', label: '៥ នាទី' },
];

/** About 13 Khmer letters are said per second */
const CPS = 13;

const clock = (sec: number) => `${km(Math.floor(sec / 60))}:${km(String(Math.floor(sec % 60)).padStart(2, '0'))}`;

interface Saved {
  scenes: RecapScene[];
  title: string;
  jobId: string | null;
}

const keyFor = (u: User, f: ProjectFile) => `kd_recap_${u.id}_${f.filename}`;
const narratorKey = (u: User) => `kd_recap_narrator_${u.id}`;

const load = (u: User, f: ProjectFile): Saved => {
  try {
    const raw = localStorage.getItem(keyFor(u, f));
    if (raw) return { scenes: [], title: '', jobId: null, ...JSON.parse(raw) };
  } catch {}
  return { scenes: [], title: '', jobId: null };
};

interface Props {
  user: User;
  file: ProjectFile;
  segments: TimelineSegment[];
  /** default name for the recap file (the full video's name) */
  baseName: string;
  speed: number;
  removeLogo: boolean;
  disabled?: boolean;
  onVideoReady: () => void;
}

/**
 * AI recap next to the full dubbed video: one narrator voice retells the story over the best
 * moments. AI writes the script as scenes; every scene's words and mood can be edited first.
 * Render it with key={file.filename} so another video starts from its own saved script.
 */
export const RecapPanel: React.FC<Props> = ({ user, file, segments, baseName, speed, removeLogo, disabled, onVideoReady }) => {
  const toast = useToast();
  const [saved, setSaved] = useState<Saved>(() => load(user, file));
  const { scenes, title, jobId } = saved;
  const patch = (p: Partial<Saved>) => setSaved((s) => ({ ...s, ...p }));
  const [narrators, setNarrators] = useState<RecapNarrator[]>([]);
  const [narrator, setNarrator] = useState<string>(() => {
    try {
      return localStorage.getItem(narratorKey(user)) || '';
    } catch {
      return '';
    }
  });
  const [length, setLength] = useState('180');
  const [writing, setWriting] = useState(false);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(keyFor(user, file), JSON.stringify(saved));
    } catch {}
  }, [saved, user, file]);
  useEffect(() => {
    try {
      if (narrator) localStorage.setItem(narratorKey(user), narrator);
    } catch {}
  }, [narrator, user]);

  useEffect(() => {
    api
      .recapNarrators()
      .then((r) => {
        setNarrators(r.items);
        setNarrator((n) => (r.items.some((v) => v.id === n) ? n : r.default));
      })
      .catch(() => {});
    return () => audio.current?.pause();
  }, []);

  const preview = (id: string) => {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(api.recapPreviewUrl(id));
    audio.current = a;
    setLoadingVoice(id);
    a.oncanplay = () => setLoadingVoice(null);
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setLoadingVoice(null);
      setPlaying(null);
      toast('ស្ដាប់សំឡេងគំរូមិនបាន — សូមពិនិត្យ Gemini key', 'error');
    };
    setPlaying(id);
    a.play().catch(() => {});
  };

  const write = async () => {
    if (scenes.length && !window.confirm('សរសេរអត្ថបទ Recap ថ្មី? អត្ថបទដែលបានកែនឹងបាត់')) return;
    setWriting(true);
    try {
      const r = await api.recapScript(file.filename, segments, Number(length));
      patch({ scenes: r.scenes, title: r.title });
      haptic('success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setWriting(false);
    }
  };

  const editScene = (i: number, p: Partial<RecapScene>) => patch({ scenes: scenes.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const dropScene = (i: number) => patch({ scenes: scenes.filter((_, k) => k !== i) });

  const start = async () => {
    try {
      const r = await api.startRecap({
        filename: file.filename,
        scenes: scenes.filter((s) => s.text.trim()),
        narrator,
        outputName: `${(title || baseName).trim()}_recap`,
        videoSpeed: speed,
        removeLogo,
      });
      patch({ jobId: r.jobId });
      setJob(null);
      haptic();
    } catch (e: any) {
      toast(`ចាប់ផ្ដើម Recap មិនបាន: ${e.message}`, 'error');
    }
  };

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const j = await api.videoJob(jobId);
        if (!live) return;
        setJob(j);
        if (j.status === 'done') {
          setSaved((s) => ({ ...s, jobId: null }));
          if (j.notice) toast(j.notice, 'warning');
          toast('🎬 Recap រួចរាល់! មើលក្នុងផ្ទាំង "វីដេអូ"', 'success');
          haptic('success');
          onVideoReady();
          return;
        }
        if (j.status === 'error') {
          setSaved((s) => ({ ...s, jobId: null }));
          toast(`បង្កើត Recap មិនបាន: ${j.error}`, 'error');
          haptic('error');
          return;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setSaved((s) => ({ ...s, jobId: null }));
          toast('ការងារ Recap បាត់ (Server ចាប់ផ្ដើមឡើងវិញ) — សូមចុចបង្កើតម្ដងទៀត', 'warning');
          return;
        }
      }
      timer = setTimeout(poll, 2500);
    };
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobId, toast, onVideoReady]);

  const running = Boolean(jobId);
  const locked = disabled || running || writing;
  const narrationSec = scenes.reduce((t, s) => t + s.text.length, 0) / CPS / (speed || 1);
  const pct = job?.phase === 'voices' && job.total ? Math.round((job.done / job.total) * 70) : job?.phase === 'video' ? 85 : 3;

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
          <span className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center text-[12px]">🎙️</span>
          Recap — AI និទានរឿង
        </h2>
        <p className="text-[11px] text-mute mt-1">
          អ្នកនិទានម្នាក់ និទានរឿងសង្ខេប លើឈុតល្អៗ។ វីដេអូពេញ ចុច «បង្កើតវីដេអូ» ខាងក្រោម — ធ្វើទាំងពីរព្រមគ្នាបាន។
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-2">សំឡេងអ្នកនិទាន</span>
        <div className="grid grid-cols-2 gap-2">
          {narrators.map((n) => (
            <div
              key={n.id}
              className={`flex items-center gap-1.5 rounded-xl ring-1 pl-3 pr-1 min-h-[44px] ${
                narrator === n.id ? 'ring-2 ring-accent bg-accent/5' : 'ring-line-strong'
              }`}
            >
              <button
                type="button"
                disabled={locked}
                onClick={() => setNarrator(n.id)}
                className="flex-1 min-w-0 text-left text-[12px] font-semibold text-ink leading-tight py-1.5"
              >
                {n.label}
              </button>
              <button
                type="button"
                onClick={() => preview(n.id)}
                aria-label={`ស្ដាប់ ${n.label}`}
                className="w-9 h-9 shrink-0 rounded-full bg-raised flex items-center justify-center text-accent"
              >
                {loadingVoice === n.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : playing === n.id ? (
                  <Square className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-4 h-4 ml-0.5" />
                )}
              </button>
            </div>
          ))}
        </div>
        <span className="text-[11px] text-mute">ជ្រើសម្ដង ចាំរហូត — ឆាណែលមានសំឡេងតែមួយ ដែលអ្នកមើលស្គាល់</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex-1 text-xs font-semibold text-ink-2">ប្រវែង Recap</span>
        <Segmented value={length} disabled={locked} onChange={setLength} options={LENGTHS} />
      </div>

      <Button variant={scenes.length ? 'secondary' : 'primary'} block loading={writing} disabled={locked} onClick={write}>
        {!writing && <PenLine className="w-4 h-4" />} {writing ? 'AI កំពុងសរសេរ…' : scenes.length ? 'សរសេរអត្ថបទថ្មី' : 'AI សរសេរអត្ថបទ Recap'}
      </Button>

      {scenes.length > 0 && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-ink-2" htmlFor="recap-title">
              ចំណងជើង
            </label>
            <input
              id="recap-title"
              value={title}
              disabled={locked}
              maxLength={80}
              onChange={(e) => patch({ title: e.target.value })}
              className="rounded-xl bg-navy ring-1 ring-line-strong px-3 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <p className="text-[11px] text-mute">
            {km(scenes.length)} ឈុត · ប្រហែល {clock(narrationSec)} · ចុចអត្ថបទ ដើម្បីកែ · ជ្រើសអារម្មណ៍ឲ្យសំឡេងតាម
          </p>
          <ol className="flex flex-col gap-2">
            {scenes.map((s, i) => (
              <li key={i} className="rounded-xl ring-1 ring-line p-2.5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-mute">
                    {i === 0 ? '🪝 ' : i === scenes.length - 1 ? '❓ ' : ''}
                    {clock(s.start)}–{clock(s.end)}
                  </span>
                  <select
                    value={s.mood}
                    disabled={locked}
                    onChange={(e) => editScene(i, { mood: e.target.value })}
                    aria-label="អារម្មណ៍"
                    className="ml-auto rounded-lg bg-raised ring-1 ring-line-strong text-[12px] px-2 min-h-[32px]"
                  >
                    {MOODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => dropScene(i)}
                    aria-label="លុបឈុតនេះ"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-mute hover:text-bad"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <textarea
                  value={s.text}
                  disabled={locked}
                  rows={Math.min(5, Math.max(2, Math.ceil(s.text.length / 45)))}
                  onChange={(e) => editScene(i, { text: e.target.value })}
                  className="w-full rounded-lg bg-navy ring-1 ring-line-strong px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </li>
            ))}
          </ol>

          {running ? (
            <div className="flex flex-col gap-2 px-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                <span className="flex-1">
                  {job?.phase === 'voices'
                    ? `កំពុងនិទាន ${km(job.done)}/${km(job.total)}`
                    : job?.phase === 'video'
                    ? 'កំពុងផ្គុំវីដេអូ Recap'
                    : 'កំពុងរង់ចាំវេន…'}
                </span>
              </div>
              <Progress value={pct} pulse={job?.phase !== 'voices'} />
            </div>
          ) : (
            <Button block className="min-h-[48px]" disabled={locked || !narrator || !scenes.some((s) => s.text.trim())} onClick={start}>
              <Clapperboard className="w-4 h-4" /> បង្កើត Recap
            </Button>
          )}
        </>
      )}
    </Card>
  );
};

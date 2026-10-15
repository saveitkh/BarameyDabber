import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, Crown, Download, ExternalLink, Film, Link2, Loader2, Plus, RefreshCw, ScanText, Upload, Users, Wand2, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { AUTO_VOICE, Character, displayName, formatBytes, isBankVoice, km, prepareScannedSegments } from '../lib/cast';
import { QuotaMeter } from './PlansPanel';
import { useCasting } from '../lib/useCasting';
import { haptic } from '../lib/telegram';
import type { BankVoice, ProjectFile, SubscriptionStatus, TimelineSegment, User, VideoJob } from '../lib/types';
import { Button, Card, Progress, Segmented, Stepper, Toggle, useToast } from '../components/ui';
import { CharacterCard } from '../components/CharacterCard';
import { DialogueChat } from '../components/DialogueChat';
import { useProfiles } from '../lib/avatars';
import { forgetUpload, listRecent, rememberUpload, stillOnServer } from '../lib/recent';

interface Session {
  file: ProjectFile | null;
  segments: TimelineSegment[];
  outputName: string;
  subtitles: boolean;
  bgm: 'auto' | 'none';
  jobId: string | null;
  result: VideoJob['result'];
}

const EMPTY: Session = { file: null, segments: [], outputName: '', subtitles: true, bgm: 'auto', jobId: null, result: null };
const storeKey = (u: User) => `kd_session_v2_${u.id}`;

const loadSession = (u: User): Session => {
  try {
    const raw = localStorage.getItem(storeKey(u));
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {}
  return EMPTY;
};

const nameFromVideo = (n: string) =>
  `${n
    .replace(/\.[^.]+$/, '')
    .replace(/^(mediaFile-\d+-|yt_dlp_\d+_)/, '')
    .trim()
    .slice(0, 60) || 'video'}_khmer`;

const PHASE: Record<VideoJob['phase'], string> = {
  queued: 'កំពុងរង់ចាំវេន…',
  voices: 'កំពុងបង្កើតសំឡេងតួ',
  mix: 'កំពុងលាយសំឡេង + ភ្លេងផ្ទៃខាងក្រោយ',
  video: 'កំពុងផ្គុំវីដេអូ',
  subtitles: 'កំពុងដាក់អក្សរខ្មែរ',
  done: 'រួចរាល់',
};

export const openExternal = (url: string) => {
  const abs = new URL(url, window.location.origin).toString();
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.openLink) tg.openLink(abs);
  else window.open(abs, '_blank', 'noopener');
};

/** What other tabs can ask the Create screen to do (Home / Videos shortcuts). */
export interface CreateHandle {
  openPicker: () => void;
  focusLink: () => void;
  resume: (f: ProjectFile) => void;
  newVideo: () => void;
}

interface Props {
  user: User;
  bank: BankVoice[];
  bankOnline: boolean;
  /** how many distinct Pro voices one video may use (-1 any, 0 none) */
  proLimit: number;
  status: SubscriptionStatus | null;
  onOpenAccount: () => void;
  onVideoReady: () => void;
}

export const CreateScreen = forwardRef<CreateHandle, Props>(function CreateScreen({ user, bank, bankOnline, proLimit, status, onOpenAccount, onVideoReady }, ref) {
  const toast = useToast();
  const [session, setSession] = useState<Session>(() => loadSession(user));
  const { file, segments, outputName, subtitles, bgm, jobId, result } = session;
  const patch = useCallback((p: Partial<Session>) => setSession((s) => ({ ...s, ...p })), []);
  const setSegments = useCallback<React.Dispatch<React.SetStateAction<TimelineSegment[]>>>(
    (next) => setSession((s) => ({ ...s, segments: typeof next === 'function' ? (next as any)(s.segments) : next })),
    []
  );

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storeKey(user), JSON.stringify(session));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [session, user]);

  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [link, setLink] = useState('');
  const [fetchingLink, setFetchingLink] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [quickScan, setQuickScan] = useState(false);
  const [job, setJob] = useState<VideoJob | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState(() => listRecent(user));

  const projectKey = file?.filename || null;
  const casting = useCasting(projectKey, segments, setSegments, toast);
  const { profiles, setProfile } = useProfiles(projectKey);
  const audioSrc = file ? `/media/outputs/audio_${encodeURIComponent(file.filename.replace(/\.[^.]+$/, ''))}.mp3` : '';
  const { cast } = casting;
  const ent = status?.entitlement;
  const proPicked = useMemo(() => {
    const pro = new Set(bank.filter((v) => v.pro).map((v) => v.id));
    return new Set(cast.map((c) => c.voiceId).filter((id) => pro.has(id)));
  }, [bank, cast]);
  const running = Boolean(jobId);
  const locked = running || scanning;

  // ── video in ──
  const scan = useCallback(
    async (filename: string) => {
      setScanning(true);
      try {
        const r = await api.scanTimeline(filename, quickScan ? '180' : 'full');
        if (!r.segments?.length) {
          toast('រកមិនឃើញឃ្លានិយាយក្នុងវីដេអូនេះទេ', 'warning');
          return;
        }
        setSegments(prepareScannedSegments(r.segments));
        toast(`✓ រកឃើញ ${km(r.segments.length)} ឃ្លា — ពិនិត្យតួ និងសំឡេងខាងក្រោម`, 'success');
        haptic('success');
      } catch (e: any) {
        toast(`ស្កេនមិនបាន: ${e.message}`, 'error');
      } finally {
        setScanning(false);
      }
    },
    [quickScan, setSegments, toast]
  );

  const startWithVideo = (f: ProjectFile) => {
    patch({ file: f, segments: [], result: null, outputName: nameFromVideo(f.originalName || f.filename) });
    rememberUpload(user, f);
    setRecent(listRecent(user));
    scan(f.filename);
  };

  // Drop remembered uploads the server no longer has
  useEffect(() => {
    let live = true;
    Promise.all(listRecent(user).map(async (r) => ((await stillOnServer(r.filename)) ? null : r.filename))).then((gone) => {
      if (!live) return;
      gone.forEach((f) => f && forgetUpload(user, f));
      setRecent(listRecent(user));
    });
    return () => {
      live = false;
    };
  }, [user]);

  useImperativeHandle(ref, () => ({
    openPicker: () => {
      if (!locked) fileInput.current?.click();
    },
    focusLink: () => {
      if (!locked) setTimeout(() => linkInput.current?.focus(), 50);
    },
    resume: (f) => {
      if (locked) return;
      if (file?.filename !== f.filename) patch({ file: f, segments: [], result: null, outputName: nameFromVideo(f.originalName || f.filename) });
    },
    newVideo: () => {
      if (!locked) patch({ file: null, segments: [], result: null, outputName: '' });
    },
  }));

  const pickFile = async (f: File) => {
    setUploadPct(0);
    try {
      const uploaded = await api.uploadVideo(f, setUploadPct);
      startWithVideo(uploaded);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setUploadPct(null);
    }
  };

  const fetchLink = async () => {
    if (!/^https?:\/\//i.test(link.trim())) {
      toast('សូមបិទភ្ជាប់ Link វីដេអូ (https://…)', 'warning');
      return;
    }
    setFetchingLink(true);
    try {
      const r = await api.downloadVideo(link.trim());
      setLink('');
      startWithVideo({ filename: r.filename, originalName: r.originalName, size: r.size, url: r.url });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setFetchingLink(false);
    }
  };

  // ── the one generate function ──
  const generate = async () => {
    if (!file || !segments.length) return;
    try {
      const r = await api.startVideo({
        filename: file.filename,
        segments,
        outputName: outputName.trim() || nameFromVideo(file.originalName || file.filename),
        burnSubtitles: subtitles,
        bgmMode: bgm,
      });
      patch({ jobId: r.jobId, result: null });
      setJob(null);
      if (r.notice) toast(r.notice, 'warning');
      haptic();
    } catch (e: any) {
      toast(`ចាប់ផ្ដើមមិនបាន: ${e.message}`, 'error');
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
          patch({ jobId: null, result: j.result });
          if (j.notice) toast(j.notice, 'warning');
          toast(
            j.result?.subtitleError ? `វីដេអូរួចរាល់ (ដាក់អក្សរមិនបាន: ${j.result.subtitleError})` : '🎉 វីដេអូរួចរាល់! អាចមើល និងទាញយកបាន',
            j.result?.subtitleError ? 'warning' : 'success'
          );
          haptic('success');
          onVideoReady();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (j.status === 'error') {
          patch({ jobId: null });
          toast(`បង្កើតវីដេអូមិនបាន: ${j.error}`, 'error');
          haptic('error');
          return;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          patch({ jobId: null });
          toast('ការងារត្រូវបានបាត់ (Server ចាប់ផ្ដើមឡើងវិញ) — សូមចុចបង្កើតម្ដងទៀត', 'warning');
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
  }, [jobId, patch, toast, onVideoReady]);

  // ── casting overview ──
  const sharedVoices = useMemo(() => {
    const byVoice = new Map<string, Character[]>();
    cast.forEach((c) => {
      if (c.voiceId && c.voiceId !== AUTO_VOICE) byVoice.set(c.voiceId, [...(byVoice.get(c.voiceId) || []), c]);
    });
    return (c: Character) => (byVoice.get(c.voiceId) || []).filter((o) => o.key !== c.key).map(displayName);
  }, [cast]);

  const autoShortfall = useMemo(() => {
    if (!bankOnline) return null;
    const need = { male: 0, female: 0 };
    cast.forEach((c) => c.voiceId === AUTO_VOICE && (need[c.gender] += 1));
    const have = {
      male: bank.filter((v) => v.gender === 'male').length,
      female: bank.filter((v) => v.gender === 'female').length,
    };
    const short = (['male', 'female'] as const).filter((g) => need[g] > have[g] && have[g] > 0);
    return short.length ? short.map((g) => `${g === 'male' ? 'ប្រុស' : 'ស្រី'} ${km(need[g])} តួ / មានសំឡេង ${km(have[g])}`).join(' · ') : null;
  }, [bank, bankOnline, cast]);

  const pct = job?.phase === 'voices' && job.total ? Math.round((job.done / job.total) * 80) : job?.phase === 'queued' || !job ? 2 : 90;

  const step = running || result ? 4 : segments.length ? 3 : file ? 2 : 1;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <Stepper steps={['វីដេអូ', 'ស្កេន', 'សំឡេង', 'បង្កើត']} current={step} />
      {ent && ent.voxLimit >= 0 && user.role !== 'admin' && (
        <Card className={`p-3.5 flex flex-col gap-2.5 ${ent.voxRemaining === 0 ? 'bg-amber-500/10 ring-amber-500/30' : ''}`}>
          <div className="flex items-start gap-3">
            <Crown className="w-5 h-5 text-warn shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">{ent.paid ? `គម្រោង ${ent.planLabel}` : 'គណនីឥតគិតថ្លៃ'}</p>
              <p className="text-xs text-ink-2 mt-0.5 leading-relaxed">
                {ent.voxRemaining === 0
                  ? 'VoxCPM2 អស់ហើយ — វីដេអូបន្ទាប់នឹងប្រើសំឡេង AI ខ្មែរធម្មតា។ ដំឡើងគម្រោងដើម្បីបន្តប្រើ VoxCPM2។'
                  : 'វីដេអូដែលប្រើ VoxCPM2 នឹងកាត់ចំនួនក្នុងគម្រោង។ សំឡេង AI ធម្មតា គ្មានដែនកំណត់។'}
              </p>
            </div>
            <Button variant="secondary" className="min-h-[36px] px-3 text-xs" onClick={onOpenAccount}>
              ដំឡើង
            </Button>
          </div>
          <QuotaMeter ent={ent} />
        </Card>
      )}

      {/* ── Result ── */}
      {result && !running && (
        <Card className="overflow-hidden">
          <video key={result.outputVideo} src={result.outputVideo} controls playsInline className="w-full bg-black max-h-[60vh]" />
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-ok shrink-0" />
              <p className="text-sm font-bold text-ink truncate">{result.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={result.outputVideo}
                download={result.name}
                className="inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-semibold"
              >
                <Download className="w-4 h-4" /> ទាញយក
              </a>
              <Button variant="secondary" onClick={() => openExternal(result.outputVideo)}>
                <ExternalLink className="w-4 h-4" /> បើកក្នុង Browser
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Step 1: video ── */}
      <Card className="p-4">
        <StepTitle n={1} title="វីដេអូ" done={Boolean(file)} />
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) pickFile(f);
          }}
        />
        {uploadPct !== null ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm text-ink-2">កំពុង Upload… {km(uploadPct)}%</p>
            <Progress value={uploadPct} />
          </div>
        ) : file ? (
          <div className="mt-3 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-raised flex items-center justify-center shrink-0">
              <Film className="w-5 h-5 text-mute" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{file.originalName || file.filename}</p>
              <p className="text-xs text-mute">{formatBytes(file.size)}</p>
            </div>
            <Button variant="secondary" className="min-h-[36px] px-3 text-xs" disabled={locked} onClick={() => patch({ file: null, segments: [], result: null, outputName: '' })}>
              <Plus className="w-3.5 h-3.5" /> វីដេអូថ្មី
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="w-full rounded-2xl border-2 border-dashed border-line-strong hover:border-accent hover:bg-accent/5 py-8 flex flex-col items-center gap-2 transition-colors"
            >
              <Upload className="w-7 h-7 text-accent" />
              <span className="text-sm font-bold text-ink">ជ្រើសវីដេអូ</span>
              <span className="text-xs text-mute">រឿងចិន / Anime ដែលចង់បញ្ចូលសំឡេងខ្មែរ</span>
            </button>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 rounded-xl bg-navy ring-1 ring-line-strong px-3 focus-within:ring-2 focus-within:ring-accent">
                <Link2 className="w-4 h-4 text-mute shrink-0" />
                <input
                  ref={linkInput}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  inputMode="url"
                  placeholder="ឬបិទភ្ជាប់ Link (YouTube, TikTok…)"
                  className="flex-1 min-w-0 min-h-[44px] bg-transparent text-sm focus:outline-none"
                />
              </div>
              <Button variant="secondary" loading={fetchingLink} disabled={!link.trim()} onClick={fetchLink}>
                ទាញ
              </Button>
            </div>
            {recent.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-mute flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> វីដេអូដែលបាន Upload រួច
                </p>
                {recent.slice(0, 4).map((r) => (
                  <div key={r.filename} className="flex items-center gap-2 rounded-xl bg-raised ring-1 ring-line pl-3 pr-1">
                    <Film className="w-4 h-4 text-mute shrink-0" />
                    <button
                      type="button"
                      onClick={() => patch({ file: { filename: r.filename, originalName: r.originalName, size: r.size, url: `/media/uploads/${r.filename}` }, segments: [], result: null, outputName: nameFromVideo(r.originalName) })}
                      className="flex-1 min-w-0 py-2.5 text-left"
                    >
                      <span className="block text-[13px] font-semibold text-ink truncate">{r.originalName}</span>
                      <span className="block text-[11px] text-mute">{formatBytes(r.size)} · ចុចដើម្បីបន្ត</span>
                    </button>
                    <button
                      type="button"
                      aria-label="ដកចេញ"
                      onClick={() => {
                        forgetUpload(user, r.filename);
                        setRecent(listRecent(user));
                      }}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-mute"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Step 2: characters ── */}
      {file && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <StepTitle n={2} title="តួអង្គ & សំឡេង" done={segments.length > 0} />
            <div className="flex-1" />
            {segments.length > 0 && !scanning && (
              <Button variant="ghost" className="min-h-[36px] px-2 text-xs" disabled={locked} onClick={() => scan(file.filename)}>
                <RefreshCw className="w-3.5 h-3.5" /> ស្កេនម្ដងទៀត
              </Button>
            )}
          </div>

          {scanning ? (
            <Card className="p-6 text-center">
              <Loader2 className="w-7 h-7 mx-auto text-accent animate-spin" />
              <p className="text-sm font-semibold text-ink mt-3">AI កំពុងស្ដាប់ បកប្រែ និងបែងចែកតួ…</p>
              <p className="text-xs text-mute mt-1">វីដេអូវែងត្រូវការពេលបន្តិច</p>
            </Card>
          ) : segments.length === 0 ? (
            <Card className="p-5 flex flex-col gap-3">
              <p className="text-sm text-ink-2">ស្កេនវីដេអូ ដើម្បីរកឃ្លា និងបែងចែកតួ ប្រុស ១, ស្រី ១ …</p>
              <Toggle checked={quickScan} onChange={setQuickScan} label="សាកល្បង ៣ នាទីដំបូង" hint="លឿនជាង សម្រាប់ពិនិត្យសំឡេងមុន" />
              <Button block onClick={() => scan(file.filename)}>
                <ScanText className="w-4 h-4" /> ស្កេនឃ្លា & តួ
              </Button>
            </Card>
          ) : (
            <>
              <p className="px-1 text-xs text-mute flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {km(cast.length)} តួ · {km(segments.length)} ឃ្លា — តួនីមួយៗមានសំឡេងតែមួយ ដូចគ្នាគ្រប់ឃ្លា
              </p>
              {autoShortfall && (
                <p className="px-1 text-xs text-warn">Auto: {autoShortfall} — តួខ្លះនឹងប្រើសំឡេងដូចគ្នា។ បន្ថែមសំឡេងក្នុងផ្ទាំង "សំឡេង" ឬក្លូនពីវីដេអូ។</p>
              )}
              {cast.map((c) => (
                <CharacterCard
                  key={c.key}
                  character={c}
                  segments={segments}
                  casting={casting}
                  bank={bank}
                  bankOnline={bankOnline}
                  others={cast.filter((o) => o.key !== c.key)}
                  sharedWith={isBankVoice(c.voiceId) || casting.casts[c.key] ? sharedVoices(c) : []}
                  disabled={locked}
                  profile={profiles[c.key]}
                  onProfile={(p) => setProfile(c.key, p)}
                  proLimit={proLimit}
                  proPicked={proPicked}
                  onOpenAccount={onOpenAccount}
                />
              ))}
            </>
          )}
        </section>
      )}

      {/* ── Dialogue as a voice chat ── */}
      {segments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 flex items-center gap-2 text-sm font-bold text-ink">
            <span className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center text-[12px]">💬</span>
            ការសន្ទនា <span className="text-xs font-normal text-mute">ចុចរូបតួ ដើម្បីប្ដូរអ្នកនិយាយ · ចុចអត្ថបទ ដើម្បីកែ</span>
          </h2>
          <DialogueChat segments={segments} cast={cast} profiles={profiles} casting={casting} audioSrc={audioSrc} disabled={locked} />
        </section>
      )}

      {/* ── Step 3: output ── */}
      {segments.length > 0 && (
        <Card className="p-4 flex flex-col gap-2">
          <StepTitle n={3} title="វីដេអូចេញ" done={Boolean(result)} />
          <label className="mt-2 text-xs font-semibold text-ink-2" htmlFor="out-name">
            ឈ្មោះឯកសារ
          </label>
          <div className="flex items-center rounded-xl bg-navy ring-1 ring-line-strong px-3 focus-within:ring-2 focus-within:ring-accent">
            <input
              id="out-name"
              value={outputName}
              disabled={locked}
              onChange={(e) => patch({ outputName: e.target.value })}
              maxLength={80}
              className="flex-1 min-w-0 min-h-[44px] bg-transparent text-sm focus:outline-none"
            />
            <span className="text-xs text-mute">.mp4</span>
          </div>
          <Toggle checked={subtitles} disabled={locked} onChange={(v) => patch({ subtitles: v })} label="អក្សរខ្មែរលើវីដេអូ" />
          <div className="flex items-center gap-3 py-2">
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink">សំឡេងផ្ទៃខាងក្រោយ</span>
              <span className="block text-xs text-mute mt-0.5">
                {bgm === 'auto' ? 'ដកសំឡេងចិនចេញ រក្សាភ្លេង & សំឡេងឈុតឲ្យច្បាស់' : 'តែសំឡេងខ្មែរ'}
              </span>
            </span>
            <Segmented
              value={bgm}
              disabled={locked}
              onChange={(v) => patch({ bgm: v })}
              options={[
                { value: 'auto', label: 'ច្បាស់' },
                { value: 'none', label: 'គ្មាន' },
              ]}
            />
          </div>
        </Card>
      )}

      {/* ── Generate ── */}
      {segments.length > 0 && (
        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10">
          <Card className="p-3 shadow-lg">
            {running ? (
              <div className="flex flex-col gap-2 px-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span className="flex-1">
                    {PHASE[job?.phase || 'queued']}
                    {job?.phase === 'voices' && ` ${km(job.done)}/${km(job.total)}`}
                  </span>
                </div>
                <Progress value={pct} pulse={job?.phase !== 'voices'} />
                <p className="text-[11px] text-mute">អាចបិទ App បាន — វីដេអូនឹងនៅក្នុងផ្ទាំង "វីដេអូ" ពេលរួច</p>
              </div>
            ) : (
              <Button block className="min-h-[52px] text-base" onClick={generate} disabled={scanning || Boolean(casting.busyKey)}>
                <Wand2 className="w-5 h-5" /> {result ? 'បង្កើតវីដេអូម្ដងទៀត' : 'បង្កើតវីដេអូ'}
              </Button>
            )}
          </Card>
        </div>
      )}
    </div>
  );
});

const StepTitle: React.FC<{ n: number; title: string; done: boolean }> = ({ n, title, done }) => (
  <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
    <span
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${done ? 'bg-ok text-white' : 'bg-brand text-white'}`}
    >
      {done ? '✓' : km(n)}
    </span>
    {title}
  </h2>
);

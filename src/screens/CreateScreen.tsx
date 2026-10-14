import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Crown, Download, ExternalLink, Film, Link2, Loader2, RefreshCw, ScanText, Upload, Users, Wand2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { AUTO_VOICE, Character, displayName, formatBytes, isBankVoice, isLicensed, km, prepareScannedSegments } from '../lib/cast';
import { useCasting } from '../lib/useCasting';
import { haptic } from '../lib/telegram';
import type { BankVoice, ProjectFile, TimelineSegment, User, VideoJob } from '../lib/types';
import { Button, Card, Progress, Segmented, Toggle, useToast } from '../components/ui';
import { CharacterCard } from '../components/CharacterCard';

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

interface Props {
  user: User;
  bank: BankVoice[];
  bankOnline: boolean;
  onOpenAccount: () => void;
  onVideoReady: () => void;
}

export const CreateScreen: React.FC<Props> = ({ user, bank, bankOnline, onOpenAccount, onVideoReady }) => {
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

  const projectKey = file?.filename || null;
  const casting = useCasting(projectKey, segments, setSegments, toast);
  const { cast } = casting;
  const licensed = isLicensed(user);
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
    scan(f.filename);
  };

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

  return (
    <div className="flex flex-col gap-4 pb-6">
      {!licensed && (
        <Card className="p-4 flex items-start gap-3 bg-amber-50/60 ring-amber-200">
          <Crown className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">គណនីឥតគិតថ្លៃ</p>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">វីដេអូនឹងប្រើសំឡេងខ្មែរ AI ធម្មតា។ ការក្លូនសំឡេង VoxCPM2 សម្រាប់គម្រោង VIP។</p>
          </div>
          <Button variant="secondary" className="min-h-[36px] px-3 text-xs" onClick={onOpenAccount}>
            ដំឡើង
          </Button>
        </Card>
      )}

      {/* ── Result ── */}
      {result && !running && (
        <Card className="overflow-hidden">
          <video key={result.outputVideo} src={result.outputVideo} controls playsInline className="w-full bg-black max-h-[60vh]" />
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <p className="text-sm font-bold text-slate-900 truncate">{result.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={result.outputVideo}
                download={result.name}
                className="inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] bg-blue-600 text-white text-sm font-semibold"
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
            <p className="text-sm text-slate-700">កំពុង Upload… {km(uploadPct)}%</p>
            <Progress value={uploadPct} />
          </div>
        ) : file ? (
          <div className="mt-3 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Film className="w-5 h-5 text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{file.originalName || file.filename}</p>
              <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
            </div>
            <Button variant="secondary" className="min-h-[36px] px-3 text-xs" disabled={locked} onClick={() => fileInput.current?.click()}>
              ប្ដូរ
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="w-full rounded-2xl border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 py-8 flex flex-col items-center gap-2 transition-colors"
            >
              <Upload className="w-7 h-7 text-blue-600" />
              <span className="text-sm font-bold text-slate-900">ជ្រើសវីដេអូ</span>
              <span className="text-xs text-slate-500">រឿងចិន / Anime ដែលចង់បញ្ចូលសំឡេងខ្មែរ</span>
            </button>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 rounded-xl ring-1 ring-slate-300 px-3 focus-within:ring-2 focus-within:ring-blue-500">
                <Link2 className="w-4 h-4 text-slate-400 shrink-0" />
                <input
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
              <Loader2 className="w-7 h-7 mx-auto text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-900 mt-3">AI កំពុងស្ដាប់ បកប្រែ និងបែងចែកតួ…</p>
              <p className="text-xs text-slate-500 mt-1">វីដេអូវែងត្រូវការពេលបន្តិច</p>
            </Card>
          ) : segments.length === 0 ? (
            <Card className="p-5 flex flex-col gap-3">
              <p className="text-sm text-slate-700">ស្កេនវីដេអូ ដើម្បីរកឃ្លា និងបែងចែកតួ ប្រុស ១, ស្រី ១ …</p>
              <Toggle checked={quickScan} onChange={setQuickScan} label="សាកល្បង ៣ នាទីដំបូង" hint="លឿនជាង សម្រាប់ពិនិត្យសំឡេងមុន" />
              <Button block onClick={() => scan(file.filename)}>
                <ScanText className="w-4 h-4" /> ស្កេនឃ្លា & តួ
              </Button>
            </Card>
          ) : (
            <>
              <p className="px-1 text-xs text-slate-500 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {km(cast.length)} តួ · {km(segments.length)} ឃ្លា — តួនីមួយៗមានសំឡេងតែមួយ ដូចគ្នាគ្រប់ឃ្លា
              </p>
              {autoShortfall && (
                <p className="px-1 text-xs text-amber-700">Auto: {autoShortfall} — តួខ្លះនឹងប្រើសំឡេងដូចគ្នា។ បន្ថែមសំឡេងក្នុងផ្ទាំង "សំឡេង" ឬក្លូនពីវីដេអូ។</p>
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
                />
              ))}
            </>
          )}
        </section>
      )}

      {/* ── Step 3: output ── */}
      {segments.length > 0 && (
        <Card className="p-4 flex flex-col gap-2">
          <StepTitle n={3} title="វីដេអូចេញ" done={Boolean(result)} />
          <label className="mt-2 text-xs font-semibold text-slate-600" htmlFor="out-name">
            ឈ្មោះឯកសារ
          </label>
          <div className="flex items-center rounded-xl ring-1 ring-slate-300 px-3 focus-within:ring-2 focus-within:ring-blue-500">
            <input
              id="out-name"
              value={outputName}
              disabled={locked}
              onChange={(e) => patch({ outputName: e.target.value })}
              maxLength={80}
              className="flex-1 min-w-0 min-h-[44px] bg-transparent text-sm focus:outline-none"
            />
            <span className="text-xs text-slate-400">.mp4</span>
          </div>
          <Toggle checked={subtitles} disabled={locked} onChange={(v) => patch({ subtitles: v })} label="អក្សរខ្មែរលើវីដេអូ" />
          <div className="flex items-center gap-3 py-2">
            <span className="flex-1">
              <span className="block text-sm font-medium text-slate-800">សំឡេងផ្ទៃខាងក្រោយ</span>
              <span className="block text-xs text-slate-500 mt-0.5">
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
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span className="flex-1">
                    {PHASE[job?.phase || 'queued']}
                    {job?.phase === 'voices' && ` ${km(job.done)}/${km(job.total)}`}
                  </span>
                </div>
                <Progress value={pct} pulse={job?.phase !== 'voices'} />
                <p className="text-[11px] text-slate-500">អាចបិទ App បាន — វីដេអូនឹងនៅក្នុងផ្ទាំង "វីដេអូ" ពេលរួច</p>
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
};

const StepTitle: React.FC<{ n: number; title: string; done: boolean }> = ({ n, title, done }) => (
  <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
    <span
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${done ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'}`}
    >
      {done ? '✓' : km(n)}
    </span>
    {title}
  </h2>
);

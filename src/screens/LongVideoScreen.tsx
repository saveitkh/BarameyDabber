import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Clock,
  Download,
  ExternalLink,
  Film,
  FolderUp,
  Loader2,
  Plus,
  RefreshCw,
  ScanText,
  Trash2,
  Upload,
  Users,
  Wand2,
} from 'lucide-react';
import { api, ApiError, withToken } from '../lib/api';
import { AUTO_VOICE, Character, displayName, isBankVoice, km } from '../lib/cast';
import { haptic } from '../lib/telegram';
import { useCasting } from '../lib/useCasting';
import { useProfiles } from '../lib/avatars';
import type { BankVoice, LongDubChunk, LongDubProject, TimelineSegment } from '../lib/types';
import { Button, Card, Progress, Segmented, Toggle, useToast } from '../components/ui';
import { CharacterCard } from '../components/CharacterCard';
import { RecapPanel } from '../components/RecapPanel';
import { SoloVoiceSetting, useChannelVoice } from '../components/VoicePicker';
import { openExternal } from './CreateScreen';

const fmtTime = (s: number) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const STATUS_KM: Record<LongDubChunk['status'], string> = {
  pending: 'រង់ចាំ',
  scanning: 'កំពុងស្កេន…',
  scanned: 'ត្រៀមរួច',
  queued: 'ក្នុងជួរ',
  rendering: 'កំពុងបង្កើត…',
  done: 'រួចរាល់ ✓',
  error: 'បញ្ហា',
};

const STATUS_TONE: Record<LongDubChunk['status'], string> = {
  pending: 'text-mute',
  scanning: 'text-accent',
  scanned: 'text-ok',
  queued: 'text-mute',
  rendering: 'text-accent',
  done: 'text-ok',
  error: 'text-danger',
};

interface Props {
  onVideoReady: () => void;
  bank: BankVoice[];
  bankOnline: boolean;
  proLimit: number;
  onOpenAccount: () => void;
  /** 'long': one long video cut into chunks · 'batch': many short videos (a folder) at once */
  kind?: 'long' | 'batch';
}

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|3gp|flv|ts)$/i;
const isVideo = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);
const byName = (a: File, b: File) =>
  (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true });

export const LongVideoScreen: React.FC<Props> = ({ onVideoReady, bank, bankOnline, proLimit, onOpenAccount, kind = 'long' }) => {
  const batch = kind === 'batch';
  const toast = useToast();
  const [list, setList] = useState<LongDubProject[] | null>(null);
  const [pid, setPid] = useState<string | null>(null);
  const [project, setProject] = useState<LongDubProject | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [chunkMin, setChunkMin] = useState<'3' | '5' | '10'>('3');
  const [voiceMode, setVoiceMode] = useState<'movie_clone_all' | 'voice_actor_clone' | 'khmer_natural'>('khmer_natural');
  const [speed, setSpeed] = useState(1);
  const [bgm, setBgm] = useState<'auto' | 'none'>('auto');
  const [subtitles, setSubtitles] = useState(false);
  const [outputName, setOutputName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [mergeAll, setMergeAll] = useState(false);
  const [removeLogo, setRemoveLogo] = useState(true);
  const [solo, setSolo] = useState(false);
  const channel = useChannelVoice();
  const [uploadStep, setUploadStep] = useState<{ n: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const announcedDone = useRef<string | null>(null);

  const loadList = useCallback(() => {
    api
      .longdubList()
      .then((r) => setList(r.items.filter((p) => (p.kind === 'batch') === batch)))
      .catch(() => setList([]));
  }, [batch]);

  useEffect(() => {
    if (!pid) loadList();
  }, [pid, loadList]);

  // Poll the open project while it scans or renders
  useEffect(() => {
    if (!pid) {
      setProject(null);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api.longdubGet(pid);
        if (!live) return;
        setProject(r.project);
        if (r.project.status === 'done' && announcedDone.current !== pid) {
          announcedDone.current = pid;
          toast(
            r.project.kind === 'batch'
              ? '🎉 វីដេអូទាំងអស់រួចរាល់! មើល/ទាញយកក្នុងផ្ទាំង «វីដេអូ»'
              : '🎉 វីដេអូវែងរួចរាល់ទាំងអស់! អាចទាញយកពេញ និងកាត់ៗ',
            'success'
          );
          haptic('success');
          onVideoReady();
        }
        if (r.project.status === 'scanning' || r.project.status === 'rendering') {
          timer = setTimeout(poll, 2500);
        }
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) {
          toast('គម្រោងនេះលែងមាន', 'warning');
          setPid(null);
          return;
        }
        timer = setTimeout(poll, 4000);
      }
    };
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pid, toast, onVideoReady]);

  const startUpload = async (f: File) => {
    setUploadPct(0);
    try {
      const uploaded = await api.longdubUpload(f, setUploadPct);
      const r = await api.longdubCreate(uploaded.filename, Number(chunkMin), voiceMode);
      setOutputName('');
      announcedDone.current = null;
      setPid(r.project.id);
      setProject(r.project);
      toast(`✓ កាត់ជា ${km(r.project.chunks.length)} ចំណែក — AI កំពុងស្កេនម្ដងមួយ`, 'success');
    } catch (e: any) {
      toast(e.message || 'បង្កើតមិនបាន', 'error');
    } finally {
      setUploadPct(null);
    }
  };

  // Many short videos (picked together, or a whole folder): upload one by one, then one batch
  const startBatch = async (picked: File[]) => {
    const files = picked.filter(isVideo).sort(byName);
    if (!files.length) {
      toast('រកមិនឃើញវីដេអូក្នុងអ្វីដែលបានជ្រើស', 'warning');
      return;
    }
    if (files.length > 50) {
      toast('ម្ដងមួយបានត្រឹម ៥០ វីដេអូ — យក ៥០ ដំបូង', 'warning');
      files.length = 50;
    }
    const sent: { filename: string; originalName: string }[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        setUploadStep({ n: i + 1, total: files.length });
        setUploadPct(0);
        const up = await api.longdubUpload(files[i], setUploadPct);
        sent.push({ filename: up.filename, originalName: files[i].name });
      }
      const r = await api.longdubBatch(sent, voiceMode);
      setMergeAll(false);
      announcedDone.current = null;
      setPid(r.project.id);
      setProject(r.project);
      toast(`✓ ${km(sent.length)} វីដេអូ — AI កំពុងស្កេនម្ដងមួយ`, 'success');
    } catch (e: any) {
      toast(e.message || 'Upload មិនបាន', 'error');
    } finally {
      setUploadPct(null);
      setUploadStep(null);
    }
  };

  const generate = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const r = await api.longdubGenerate(project.id, {
        bgmMode: bgm,
        burnSubtitles: subtitles,
        naturalVoice: true,
        outputName: outputName.trim() || undefined,
        videoSpeed: speed,
        removeLogo,
        soloVoice: solo ? channel.voice : undefined,
        mergeAll: batch && mergeAll,
      });
      setProject(r.project);
      toast(batch ? '⏳ កំពុងបង្កើតម្ដងមួយវីដេអូ — អ្នកអាចបិទ App បាន' : '⏳ កំពុងបង្កើតម្ដងមួយចំណែក — អ្នកអាចបិទ App បាន', 'info');
      haptic();
    } catch (e: any) {
      toast(e.message || 'ចាប់ផ្ដើមមិនបាន', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rescan = async (idx: number) => {
    if (!project) return;
    try {
      const r = await api.longdubRescan(project.id, idx);
      setProject(r.project);
      toast('កំពុងស្កេនចំណែកនេះឡើងវិញ…', 'info');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const removeProject = async (id: string) => {
    try {
      await api.longdubDelete(id);
      if (pid === id) setPid(null);
      setList((l) => (l ? l.filter((p) => p.id !== id) : l));
      toast('បានលុបគម្រោង', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const saveChunk = async (idx: number, segments: TimelineSegment[]) => {
    if (!project) return;
    try {
      await api.longdubSaveChunk(project.id, idx, segments);
      setProject((p) =>
        p
          ? { ...p, chunks: p.chunks.map((c) => (c.index === idx ? { ...c, segments, segmentCount: segments.length } : c)) }
          : p
      );
      toast('បានរក្សាទុកការកែ', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const fileField = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="video/*"
        multiple={batch}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          e.target.value = '';
          if (!picked.length) return;
          if (batch) startBatch(picked);
          else startUpload(picked[0]);
        }}
      />
      {batch && (
        <input
          ref={folderInput}
          type="file"
          className="hidden"
          // a whole folder (Chrome, Edge, Safari, Telegram Desktop); phones use "many videos"
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          multiple
          onChange={(e) => {
            const picked = Array.from(e.target.files || []);
            e.target.value = '';
            if (picked.length) startBatch(picked);
          }}
        />
      )}
    </>
  );

  // ── Project list / new upload ──
  if (!pid || !project) {
    return (
      <div className="flex flex-col gap-4 pb-6">
        {fileField}
        <Card className="p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
            <Clapperboard className="w-4 h-4 text-accent" /> {batch ? 'វីដេអូខ្លីច្រើន (Folder)' : 'វីដេអូវែង (Dub ម្ដងមួយចំណែក)'}
          </h2>
          <p className="text-xs text-ink-2 mt-1 leading-relaxed">
            {batch
              ? 'ជ្រើសវីដេអូខ្លីច្រើន ឬ Folder ទាំងមូល → AI ស្កេន & បកប្រែម្ដងមួយ → អ្នកពិនិត្យ/កែតួ & សំឡេង → ចុចបង្កើត វាធ្វើទាំងអស់បន្តរហូតចប់។ វីដេអូនីមួយៗចូលផ្ទាំង «វីដេអូ» (ឬភ្ជាប់ជាវីដេអូពេញ)។'
              : 'Upload វីដេអូវែង → AI កាត់ជាចំណែកៗ → ស្កេន & បកប្រែម្ដងមួយ → អ្នកពិនិត្យ/កែ → ចុចបង្កើត វានឹងធ្វើបន្តរហូតចប់។ ទទួលបានទាំង វីដេអូពេញ និងកាត់ៗ។'}
          </p>
          {uploadPct !== null ? (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-sm text-ink-2">
                កំពុង Upload{uploadStep ? ` ${km(uploadStep.n)}/${km(uploadStep.total)}` : ''}… {km(uploadPct)}%
              </p>
              <Progress value={uploadPct} />
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className={`flex items-center gap-3 py-1 ${batch ? 'hidden' : ''}`}>
                <span className="text-sm font-medium text-ink flex-1">ប្រវែងចំណែក</span>
                <Segmented
                  value={chunkMin}
                  onChange={setChunkMin}
                  options={[
                    { value: '3', label: '៣ នាទី' },
                    { value: '5', label: '៥ នាទី' },
                    { value: '10', label: '១០ នាទី' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5 py-1">
                <span className="text-sm font-medium text-ink">សម្លេងតួ</span>
                <Segmented
                  value={voiceMode}
                  onChange={setVoiceMode}
                  options={[
                    { value: 'khmer_natural', label: 'AI (លឿន)' },
                    { value: 'voice_actor_clone', label: 'សម្លេង Pro' },
                    { value: 'movie_clone_all', label: 'ដូចតួដើម' },
                  ]}
                />
                <span className="text-[11px] text-mute">
                  {voiceMode === 'movie_clone_all' ? 'ក្លូនសម្លេងតួដើម — និយាយខ្មែរដោយសម្លេងដូចតួដើម (ត្រូវ VoxCPM2)' : voiceMode === 'voice_actor_clone' ? 'សម្លេង Pro ច្បាស់ល្អ (ត្រូវ VoxCPM2)' : 'សំឡេង AI តាមភេទ & អាយុតួ និយាយមានអារម្មណ៍ — លឿន មិនបាច់ Clone'}
                </span>
              </div>
              {batch ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => folderInput.current?.click()}
                    className="rounded-2xl border-2 border-dashed border-line-strong hover:border-accent hover:bg-accent/5 py-6 flex flex-col items-center gap-1.5 transition-colors"
                  >
                    <FolderUp className="w-7 h-7 text-accent" />
                    <span className="text-sm font-bold text-ink">ជ្រើស Folder</span>
                    <span className="text-[11px] text-mute">វីដេអូទាំងអស់ក្នុង Folder</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="rounded-2xl border-2 border-dashed border-line-strong hover:border-accent hover:bg-accent/5 py-6 flex flex-col items-center gap-1.5 transition-colors"
                  >
                    <Upload className="w-7 h-7 text-accent" />
                    <span className="text-sm font-bold text-ink">ជ្រើសវីដេអូច្រើន</span>
                    <span className="text-[11px] text-mute">វីដេអូនីមួយ ≤ ១០ នាទី</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="w-full rounded-2xl border-2 border-dashed border-line-strong hover:border-accent hover:bg-accent/5 py-8 flex flex-col items-center gap-2 transition-colors"
                >
                  <Upload className="w-7 h-7 text-accent" />
                  <span className="text-sm font-bold text-ink">ជ្រើសវីដេអូវែង</span>
                  <span className="text-xs text-mute">រឿងពេញ / វគ្គវែង ដែលចង់បញ្ចូលសំឡេងខ្មែរ</span>
                </button>
              )}
            </div>
          )}
        </Card>

        {list && list.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="px-1 text-xs font-semibold text-mute flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> {batch ? 'គម្រោងវីដេអូខ្លីច្រើន' : 'គម្រោងវីដេអូវែង'}
            </p>
            {list.map((p) => (
              <Card key={p.id} className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-raised flex items-center justify-center shrink-0">
                  <Film className="w-5 h-5 text-mute" />
                </div>
                <button type="button" onClick={() => { announcedDone.current = p.id; setPid(p.id); }} className="flex-1 min-w-0 text-left">
                  <span className="block text-[13px] font-semibold text-ink truncate">{p.originalName || p.source}</span>
                  <span className="block text-[11px] text-mute">
                    {km(p.chunks?.length || p.renderTotal)} {batch ? 'វីដេអូ' : 'ចំណែក'} · {fmtTime(p.duration)} ·{' '}
                    <span className={STATUS_TONE[(p.status as any) === 'ready' ? 'scanned' : (p.status as any) === 'done' ? 'done' : (p.status as any) === 'error' ? 'error' : 'scanning']}>
                      {p.status === 'ready' ? 'ត្រៀមបង្កើត' : p.status === 'done' ? 'រួចរាល់ ✓' : p.status === 'error' ? 'បញ្ហា' : p.status === 'rendering' ? 'កំពុងបង្កើត…' : 'កំពុងស្កេន…'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="លុប"
                  onClick={() => removeProject(p.id)}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-mute hover:text-danger"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Card>
            ))}
          </section>
        )}
      </div>
    );
  }

  // ── Open project ──
  const scanning = project.status === 'scanning';
  const rendering = project.status === 'rendering';
  const ready = project.status === 'ready';
  const done = project.status === 'done';
  const scanPct = project.scanTotal ? Math.round((project.scanDone / project.scanTotal) * 100) : 0;
  const renderPct = project.renderTotal ? Math.round((project.renderDone / project.renderTotal) * 100) : 0;
  const scannedCount = project.chunks.filter((c) => (c.segmentCount || 0) > 0 || c.status === 'scanned' || c.status === 'done').length;

  return (
    <div className="flex flex-col gap-4 pb-6">
      {fileField}
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="min-h-[36px] px-2 text-xs" onClick={() => setPid(null)}>
          ← ត្រឡប់
        </Button>
        <div className="flex-1" />
        {!rendering && !scanning && (
          <Button variant="ghost" className="min-h-[36px] px-2 text-xs text-danger" onClick={() => removeProject(project.id)}>
            <Trash2 className="w-3.5 h-3.5" /> លុប
          </Button>
        )}
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Clapperboard className="w-4 h-4 text-accent shrink-0" />
          <p className="text-sm font-bold text-ink truncate flex-1">{project.originalName || project.source}</p>
        </div>
        <p className="text-xs text-mute mt-1">
          {batch
            ? `${km(project.chunks.length)} វីដេអូ · សរុប ${fmtTime(project.duration)}`
            : `${km(project.chunks.length)} ចំណែក · ${fmtTime(project.duration)} · ម្ដង ${km(Math.round(project.chunkSeconds / 60))} នាទី`}
        </p>
        {scanning && (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-xs text-accent flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> AI កំពុងស្កេន & បកប្រែ ({km(project.scanDone)}/{km(project.scanTotal)})
            </p>
            <Progress value={scanPct || 4} pulse />
          </div>
        )}
        {rendering && (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-xs text-accent flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {batch ? 'កំពុងបង្កើតម្ដងមួយវីដេអូ' : 'កំពុងបង្កើតម្ដងមួយចំណែក'} ({km(project.renderDone)}/{km(project.renderTotal)})
            </p>
            <Progress value={renderPct || 4} pulse />
            <p className="text-[11px] text-mute">អាចបិទ App បាន — វានឹងធ្វើបន្តរហូតចប់។</p>
          </div>
        )}
        {project.error && <p className="mt-2 text-xs text-danger">⚠️ {project.error}</p>}
      </Card>

      {/* Full result */}
      {done && project.full && (
        <Card className="overflow-hidden">
          <video key={project.full.video} src={withToken(project.full.video)} controls playsInline className="w-full bg-black max-h-[55vh]" />
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-ok shrink-0" />
              <p className="text-sm font-bold text-ink truncate">{project.full.name} · វីដេអូពេញ</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={withToken(project.full.video)}
                download={project.full.name}
                className="inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-semibold"
              >
                <Download className="w-4 h-4" /> ទាញយកពេញ
              </a>
              <Button variant="secondary" onClick={() => project.full && openExternal(withToken(project.full.video))}>
                <ExternalLink className="w-4 h-4" /> បើកក្នុង Browser
              </Button>
            </div>
          </div>
        </Card>
      )}

      {done && batch && !project.full && (
        <Card className="p-4 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-ok shrink-0" />
          <p className="text-sm text-ink flex-1">
            វីដេអូទាំង {km(project.renderDone)} រួចរាល់ — មើល/ទាញយកក្នុងផ្ទាំង <b>«វីដេអូ»</b> ឬបើកវីដេអូនីមួយខាងក្រោម។
          </p>
        </Card>
      )}

      {/* Chunk list */}
      <section className="flex flex-col gap-2">
        <p className="px-1 text-xs text-mute">
          {scanning
            ? 'ពិនិត្យបានពេលចំណែកនីមួយៗស្កេនរួច'
            : `${batch ? 'វីដេអូ' : 'ចំណែក'} ${km(scannedCount)}/${km(project.chunks.length)} ត្រៀមរួច — ចុចបើកដើម្បីពិនិត្យ/កែតួ & សំឡេង`}
        </p>
        {project.chunks.map((c) => (
          <ChunkCard
            key={c.index}
            chunk={c}
            expanded={open === c.index}
            onToggle={() => setOpen(open === c.index ? null : c.index)}
            onSave={(segs) => saveChunk(c.index, segs)}
            onRescan={() => rescan(c.index)}
            canEdit={!rendering && !scanning}
            bank={bank}
            bankOnline={bankOnline}
            proLimit={proLimit}
            onOpenAccount={onOpenAccount}
            batch={batch}
          />
        ))}
      </section>

      {/* AI recap of the whole series / movie from every scanned part */}
      {!scanning && scannedCount > 0 && (
        <RecapPanel
          key={project.id}
          storeKey={`kd_recap_proj_${project.id}`}
          source={{ projectId: project.id }}
          partNames={project.chunks.map((c) => c.name || c.file)}
          baseName={project.originalName || project.source}
          speed={speed}
          removeLogo={removeLogo}
          disabled={rendering}
          onVideoReady={onVideoReady}
        />
      )}

      {/* Generate */}
      {(ready || done) && (
        <Card className="p-4 flex flex-col gap-3">
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-accent" /> បង្កើតវីដេអូ
          </h3>
          {batch && (
            <Toggle checked={mergeAll} onChange={setMergeAll} label="ភ្ជាប់ទាំងអស់ជាវីដេអូពេញមួយទៀត" hint="វីដេអូនីមួយៗនៅដដែល + វីដេអូពេញតាមលំដាប់ឈ្មោះ" />
          )}
          <label className={`text-xs font-semibold text-ink-2 ${batch && !mergeAll ? 'hidden' : ''}`} htmlFor="ld-name">
            {batch ? 'ឈ្មោះវីដេអូពេញ (ស្ម័គ្រចិត្ត)' : 'ឈ្មោះឯកសារ (ស្ម័គ្រចិត្ត)'}
          </label>
          <div className={`flex items-center rounded-xl bg-navy ring-1 ring-line-strong px-3 focus-within:ring-2 focus-within:ring-accent ${batch && !mergeAll ? 'hidden' : ''}`}>
            <input
              id="ld-name"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              maxLength={80}
              placeholder={project.originalName || 'khmer_video'}
              className="flex-1 min-w-0 min-h-[44px] bg-transparent text-sm focus:outline-none"
            />
          </div>
          <Toggle checked={subtitles} onChange={setSubtitles} label="អក្សរខ្មែរលើវីដេអូ" />
          <SoloVoiceSetting solo={solo} onSolo={setSolo} voices={channel.voices} voice={channel.voice} onVoice={channel.setVoice} />
          <Toggle checked={removeLogo} onChange={setRemoveLogo} label="លុប logo / watermark" hint="រក logo ដែលនៅមួយកន្លែងរហូត (ឧ. bilibili) ហើយលុបចេញ" />
          <div className="flex items-center gap-3 py-1">
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink">សំឡេងផ្ទៃខាងក្រោយ</span>
              <span className="block text-xs text-mute mt-0.5">{bgm === 'auto' ? 'ដកសំឡេងដើម រក្សាភ្លេង' : 'តែសំឡេងខ្មែរ'}</span>
            </span>
            <Segmented
              value={bgm}
              onChange={setBgm}
              options={[
                { value: 'auto', label: 'ច្បាស់' },
                { value: 'none', label: 'គ្មាន' },
              ]}
            />
          </div>
          <div className="flex items-center gap-3 py-1 border-t border-line">
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink">ល្បឿនវីដេអូ (រូប + សំឡេង)</span>
              <span className="block text-xs text-mute mt-0.5">{speed === 1 ? 'ល្បឿនដើម' : speed <= 1.1 ? 'លឿនបន្តិច — ស្ដាប់ស្រួល' : speed <= 1.25 ? 'លឿន ស្ទីលរឿង AI' : 'លឿនខ្លាំង'}</span>
            </span>
            <Segmented
              value={String(speed)}
              onChange={(v) => setSpeed(Number(v))}
              options={[
                { value: '1', label: '1×' },
                { value: '1.1', label: '1.1×' },
                { value: '1.25', label: '1.25×' },
                { value: '1.5', label: '1.5×' },
              ]}
            />
          </div>
          <Button block className="min-h-[52px] text-base" loading={busy} onClick={generate}>
            <Wand2 className="w-5 h-5" /> {done ? 'បង្កើតម្ដងទៀត' : batch ? `បង្កើតវីដេអូទាំង ${km(project.chunks.length)}` : 'បង្កើតវីដេអូទាំងអស់'}
          </Button>
        </Card>
      )}
    </div>
  );
};

// ── One chunk: collapsed header; the editor mounts only when expanded ──
const ChunkCard: React.FC<{
  chunk: LongDubChunk;
  expanded: boolean;
  onToggle: () => void;
  onSave: (segments: TimelineSegment[]) => void;
  onRescan: () => void;
  canEdit: boolean;
  bank: BankVoice[];
  bankOnline: boolean;
  proLimit: number;
  onOpenAccount: () => void;
  batch?: boolean;
}> = ({ chunk, expanded, onToggle, onSave, onRescan, canEdit, bank, bankOnline, proLimit, onOpenAccount, batch }) => {
  const live = chunk.status === 'rendering' && chunk.total ? Math.round(((chunk.done || 0) / chunk.total) * 100) : 0;
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full p-3 flex items-center gap-3 text-left">
        <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center shrink-0 text-xs font-bold text-ink-2">
          {km(chunk.index + 1)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-ink truncate">
            {batch
              ? `${chunk.name || chunk.file} · ${fmtTime(chunk.length)}`
              : `ចំណែក ${km(chunk.index + 1)} · ${fmtTime(chunk.start)}–${fmtTime(chunk.start + chunk.length)}`}
          </p>
          <p className={`text-[11px] ${STATUS_TONE[chunk.status]}`}>
            {chunk.status === 'rendering' && chunk.total ? `${STATUS_KM.rendering} ${km(chunk.done || 0)}/${km(chunk.total)}` : STATUS_KM[chunk.status]}
            {chunk.segmentCount ? ` · ${km(chunk.segmentCount)} ឃ្លា` : ''}
          </p>
          {chunk.status === 'rendering' && chunk.total ? <Progress value={live || 4} pulse /> : null}
          {chunk.error ? <p className="text-[11px] text-danger truncate">⚠️ {chunk.error}</p> : null}
        </div>
        {chunk.status === 'scanning' ? (
          <Loader2 className="w-4 h-4 text-accent animate-spin" />
        ) : expanded ? (
          <ChevronUp className="w-4 h-4 text-mute" />
        ) : (
          <ChevronDown className="w-4 h-4 text-mute" />
        )}
      </button>

      {expanded && (
        <ChunkEditor
          chunk={chunk}
          onSave={onSave}
          onRescan={onRescan}
          canEdit={canEdit}
          bank={bank}
          bankOnline={bankOnline}
          proLimit={proLimit}
          onOpenAccount={onOpenAccount}
        />
      )}
    </Card>
  );
};

// ── The per-chunk review: dubbed output, voice casting (pick/clone a voice per
// character, exactly like a single video), and the Khmer text editor. Mounted
// only while the chunk is open so one casting hook is active at a time. ──
const ChunkEditor: React.FC<{
  chunk: LongDubChunk;
  onSave: (segments: TimelineSegment[]) => void;
  onRescan: () => void;
  canEdit: boolean;
  bank: BankVoice[];
  bankOnline: boolean;
  proLimit: number;
  onOpenAccount: () => void;
}> = ({ chunk, onSave, onRescan, canEdit, bank, bankOnline, proLimit, onOpenAccount }) => {
  const toast = useToast();
  const [draft, setDraft] = useState<TimelineSegment[]>(chunk.segments || []);
  // Follow server updates (rescan / resume) while the user is not mid-edit
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(chunk.segments || []), [draft, chunk.segments]);
  useEffect(() => {
    setDraft(chunk.segments || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk.segments]);

  // Voice casting works against this chunk's own file, so clone-from-video cuts
  // the right footage and each character's chosen voice is saved into the chunk.
  const casting = useCasting(chunk.file, draft, setDraft, toast);
  const { profiles, setProfile } = useProfiles(chunk.file);
  const { cast } = casting;

  const proPicked = useMemo(() => {
    const pro = new Set(bank.filter((v) => v.pro).map((v) => v.id));
    return new Set(cast.map((c) => c.voiceId).filter((id) => pro.has(id)));
  }, [bank, cast]);
  const sharedVoices = useMemo(() => {
    const byVoice = new Map<string, Character[]>();
    cast.forEach((c) => {
      if (c.voiceId && c.voiceId !== AUTO_VOICE) byVoice.set(c.voiceId, [...(byVoice.get(c.voiceId) || []), c]);
    });
    return (c: Character) => (byVoice.get(c.voiceId) || []).filter((o) => o.key !== c.key).map(displayName);
  }, [cast]);

  const editLine = (i: number, khmer: string) => setDraft((d) => d.map((s, idx) => (idx === i ? { ...s, khmer_translation: khmer } : s)));
  const deleteLine = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));
  const save = () => onSave(draft);

  const hasSegments = chunk.status === 'scanned' || (chunk.segments && chunk.segments.length > 0);

  return (
    <div className="px-3 pb-3 flex flex-col gap-2 border-t border-line">
      {chunk.output && (
        <div className="mt-3 flex flex-col gap-2">
          <video key={chunk.output.video} src={withToken(chunk.output.video)} controls playsInline className="w-full bg-black rounded-lg max-h-[40vh]" />
          <a
            href={withToken(chunk.output.video)}
            download={chunk.output.name}
            className="inline-flex items-center justify-center gap-2 rounded-xl min-h-[40px] bg-raised ring-1 ring-line text-ink text-sm font-semibold"
          >
            <Download className="w-4 h-4" /> ទាញយកចំណែកនេះ
          </a>
        </div>
      )}

      {hasSegments ? (
        <>
          {/* ── Characters & voices: pick or clone a voice per character ── */}
          {cast.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs font-semibold text-mute flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> តួអង្គ & សំឡេង ({km(cast.length)} តួ) — ជ្រើសសំឡេង ឬក្លូនពីវីដេអូ
              </p>
              {cast.map((c) => (
                <CharacterCard
                  key={c.key}
                  character={c}
                  segments={draft}
                  casting={casting}
                  bank={bank}
                  bankOnline={bankOnline}
                  others={cast.filter((o) => o.key !== c.key)}
                  sharedWith={isBankVoice(c.voiceId) || casting.casts[c.key] ? sharedVoices(c) : []}
                  disabled={!canEdit}
                  profile={profiles[c.key]}
                  onProfile={(p) => setProfile(c.key, p)}
                  proLimit={proLimit}
                  proPicked={proPicked}
                  onOpenAccount={onOpenAccount}
                />
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <p className="text-xs font-semibold text-mute flex-1">ពិនិត្យ & កែអត្ថបទ ({km(draft.length)} ឃ្លា)</p>
            {canEdit && (
              <Button variant="ghost" className="min-h-[32px] px-2 text-xs" onClick={onRescan}>
                <RefreshCw className="w-3.5 h-3.5" /> ស្កេនឡើងវិញ
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2 max-h-[46vh] overflow-y-auto">
            {draft.map((s, i) => (
              <div key={i} className="rounded-lg bg-navy ring-1 ring-line p-2 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-accent truncate flex-1">
                    {s.speaker_label || s.speaker_name || s.speaker_id} · {fmtTime(s.start_time)}
                  </span>
                  {canEdit && (
                    <button type="button" aria-label="លុបឃ្លា" onClick={() => deleteLine(i)} className="text-mute hover:text-danger">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {s.chinese_text ? <p className="text-[11px] text-mute leading-snug">{s.chinese_text}</p> : null}
                <textarea
                  value={s.khmer_translation || ''}
                  disabled={!canEdit}
                  onChange={(e) => editLine(i, e.target.value)}
                  rows={2}
                  className="w-full bg-transparent text-[13px] text-ink resize-none focus:outline-none"
                />
              </div>
            ))}
            {draft.length === 0 && <p className="text-xs text-mute py-2">គ្មានឃ្លាសន្ទនាក្នុងចំណែកនេះ (នឹងរក្សាសំឡេងដើម)។</p>}
          </div>
          {canEdit && dirty && (
            <Button variant="secondary" block onClick={save}>
              <CheckCircle2 className="w-4 h-4" /> រក្សាទុកការកែ
            </Button>
          )}
        </>
      ) : chunk.status === 'scanning' ? (
        <p className="text-xs text-mute py-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent" /> កំពុងស្កេនចំណែកនេះ…
        </p>
      ) : chunk.status === 'pending' ? (
        <p className="text-xs text-mute py-3 flex items-center gap-2">
          <ScanText className="w-4 h-4" /> រង់ចាំស្កេន…
        </p>
      ) : chunk.status === 'error' && canEdit ? (
        <Button variant="secondary" block onClick={onRescan}>
          <RefreshCw className="w-4 h-4" /> ស្កេនចំណែកនេះឡើងវិញ
        </Button>
      ) : null}

      {/* allow a quick add of an empty line */}
      {canEdit && hasSegments && (
        <Button
          variant="ghost"
          className="min-h-[36px] text-xs"
          onClick={() =>
            setDraft((d) => [
              ...d,
              {
                line_index: d.length,
                start_time: d.length ? d[d.length - 1].end_time + 0.5 : chunk.start,
                end_time: (d.length ? d[d.length - 1].end_time + 0.5 : chunk.start) + 3,
                speaker_id: 'speaker_1',
                speaker_name: 'តួ',
                gender: 'male',
                khmer_translation: '',
              } as TimelineSegment,
            ])
          }
        >
          <Plus className="w-3.5 h-3.5" /> បន្ថែមឃ្លា
        </Button>
      )}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import {
  Film,
  ScanText,
  Upload,
  Loader2,
  Wand2,
  Download,
  ChevronDown,
  ChevronUp,
  KeyRound,
  CircleAlert,
  Check,
  RefreshCw,
  ArrowRight,
  Subtitles,
  Music2,
  Mic,
} from 'lucide-react';
import { api } from '../../services/api';
import { CharacterVoice, ProjectFile, TimelineSegment, User, VoxcpmStatus } from '../../types';
import { DubbingStudioPanel } from './DubbingStudioPanel';
import { OutputSettingsCard } from './OutputSettingsCard';
import { BackgroundMixCard } from './BackgroundMixCard';
import { BGM_LABELS, OutputSettings, loadOutputSettings, saveOutputSettings, toAssemblePayload } from './outputSettings';
import { SegmentsSetter, useVoiceCasts } from './useVoiceCasts';
import { buildCast, isLicensedUser, lineNeedsAudio, speakerKeyOf, toKhmerNumber } from './castUtils';

type Toast = (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;

interface VoiceCloneSessionProps {
  uploadedFile: ProjectFile | null;
  isUploadingFile: boolean;
  uploadProgress: number;
  onUploadFile: (file: File) => void;
  segments: TimelineSegment[];
  setSegments: SegmentsSetter;
  onScanTimeline: (scope?: string) => void;
  isScanningTimeline: boolean;
  libraryVoices: CharacterVoice[];
  user: User | null;
  voxStatus: VoxcpmStatus | null;
  onOpenAuthModal: () => void;
  onOpenLicenseModal: () => void;
  onOpenVoxModal: () => void;
  onOpenSettings: () => void;
  /** Only passed when the advanced tools are switched on */
  onOpenAdvancedStudio?: () => void;
  cleanBgmUrl?: string | null;
  outputVideo: string | null;
  outputAudio: string | null;
  onOutputReady: (video: string, audio?: string | null) => void;
  onShowToast: Toast;
}

const GUIDE_KEY = 'cs_session_guide_hidden';

const GUIDE_STEPS = [
  { title: 'Upload វីដេអូ', body: 'ដាក់វីដេអូរឿង (ចិន/Anime) ដែលចង់បញ្ចូលសំឡេងខ្មែរ។' },
  { title: 'ស្កេនឃ្លា (Auto)', body: 'ក្រោយ Upload រួច AI ស្កេនឃ្លា បកប្រែជាខ្មែរ ហើយចែកតួជា ប្រុស ១, ស្រី ១ … ដោយខ្លួនឯង។' },
  { title: 'សំឡេងតួ (ជម្រើស)', body: 'ចុច 🎬 ពីរឿង ដើម្បីក្លូនសំឡេងតួពីក្នុងវីដេអូ ឬ Upload សំឡេង ១០–៣០ វិនាទី។ AI ចែកតួខុស? ចុច ˅ ដើម្បីបញ្ចូលតួ ឬប្ដូរភេទ។' },
  { title: 'បង្កើតវីដេអូ', body: 'ជ្រើស Subtitle និងភ្លេងក្នុង “ការកំណត់វីដេអូ” រួចចុច “បង្កើតវីដេអូ” ហើយទាញយក។' },
];

const StepPill: React.FC<{ n: number; label: string; state: 'done' | 'current' | 'todo' }> = ({ n, label, state }) => (
  <li className="flex items-center gap-2 shrink-0">
    <span
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
        state === 'done'
          ? 'bg-[var(--cs-ok)] text-[var(--cs-surface)]'
          : state === 'current'
          ? 'bg-[var(--cs-accent)] text-[var(--cs-on-accent)]'
          : 'bg-[var(--cs-sunken)] text-[var(--cs-muted)] border border-[var(--cs-border)]'
      }`}
    >
      {state === 'done' ? <Check className="w-3.5 h-3.5" /> : toKhmerNumber(n)}
    </span>
    <span className={`text-xs font-semibold ${state === 'todo' ? 'text-[var(--cs-muted)]' : 'text-[var(--cs-text)]'}`}>{label}</span>
  </li>
);

const formatSize = (bytes: number) => (bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '');

export const VoiceCloneSession: React.FC<VoiceCloneSessionProps> = ({
  uploadedFile,
  isUploadingFile,
  uploadProgress,
  onUploadFile,
  segments,
  setSegments,
  onScanTimeline,
  isScanningTimeline,
  libraryVoices,
  user,
  voxStatus,
  onOpenAuthModal,
  onOpenLicenseModal,
  onOpenVoxModal,
  onOpenSettings,
  onOpenAdvancedStudio,
  cleanBgmUrl,
  outputVideo,
  outputAudio,
  onOutputReady,
  onShowToast,
}) => {
  const projectKey =
    uploadedFile && !isUploadingFile && uploadedFile.url && !uploadedFile.url.startsWith('blob:') ? uploadedFile.filename : null;

  const castState = useVoiceCasts(projectKey, segments, setSegments, onShowToast);
  const { cast, casts, readyCount } = castState;

  const [showGuide, setShowGuide] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [guideForced, setGuideForced] = useState(false);
  const [settings, setSettingsState] = useState<OutputSettings>(loadOutputSettings);
  const setSettings = (next: OutputSettings) => {
    setSettingsState(next);
    saveOutputSettings(next);
  };
  // Set when the user picks a new video here; the automatic scan fires once its upload finishes.
  const [autoArmed, setAutoArmed] = useState(false);
  const autoGenerateForRef = useRef<string | null>(null);
  const [gen, setGen] = useState<{ running: boolean; phase: 'lines' | 'assemble' | ''; done: number; total: number }>({
    running: false,
    phase: '',
    done: 0,
    total: 0,
  });
  const videoInputRef = useRef<HTMLInputElement>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const licensed = isLicensedUser(user);
  const cloneEngineReady = Boolean(voxStatus && voxStatus.online && voxStatus.mode !== 'pure_khmer');
  const hasUploadedVoices = Object.keys(casts).length > 0;
  const missingCount = cast.length - readyCount;

  const [gemini, setGemini] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    api.testGeminiKey().then(setGemini).catch(() => setGemini(null));
  }, []);

  const guideVisible = showGuide && (segments.length === 0 || guideForced);
  const toggleGuide = () => {
    if (segments.length > 0 && !guideVisible) {
      setGuideForced(true);
      setShowGuide(true);
      return;
    }
    setGuideForced(false);
    setShowGuide((v) => {
      try {
        localStorage.setItem(GUIDE_KEY, v ? '1' : '0');
      } catch {}
      return !v;
    });
  };

  const stepState = (n: number): 'done' | 'current' | 'todo' => {
    const done = [Boolean(projectKey), segments.length > 0, cast.length > 0 && missingCount === 0, Boolean(outputVideo)];
    if (done[n - 1]) return 'done';
    const firstOpen = done.findIndex((d) => !d) + 1;
    return firstOpen === n ? 'current' : 'todo';
  };

  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  /** Generate line audio (all characters, or only one) and optionally assemble the final video. */
  const runGenerate = async (opts: { onlyKey?: string; assemble: boolean } = { assemble: true }) => {
    if (!projectKey || segments.length === 0 || gen.running) return;
    if (!opts.assemble && !licensed) {
      onShowToast('ការបង្កើតសំឡេងម្ដងមួយឃ្លា ត្រូវការ License — ចុច "បង្កើតវីដេអូ" ដើម្បីប្រើសំឡេងខ្មែរ AI ធម្មតា', 'info');
      if (user) onOpenLicenseModal();
      else onOpenAuthModal();
      return;
    }
    if (hasUploadedVoices && !licensed) {
      onShowToast('សំឡេង Upload (Voice Clone) ត្រូវការ License Key — សូមចូលគណនី ឬបញ្ចូល Key ជាមុនសិន', 'warning');
      if (user) onOpenLicenseModal();
      else onOpenAuthModal();
      return;
    }

    const snapshot = segmentsRef.current;
    const castNow = buildCast(snapshot);
    const genderByKey = new Map(castNow.map((c) => [c.key, c.gender]));
    const numberByKey = new Map(castNow.map((c) => [c.key, c.number]));
    const produced: Record<number, string> = {};

    // Free accounts cannot call the clone endpoint; the server's assemble step voices every line instead.
    const queue = licensed
      ? snapshot
          .map((s, i) => i)
          .filter(
            (i) =>
              (!opts.onlyKey || speakerKeyOf(snapshot[i]) === opts.onlyKey) &&
              (opts.onlyKey ? true : lineNeedsAudio(snapshot[i])) &&
              (snapshot[i].khmer_translation || snapshot[i].chinese_text)
          )
      : [];

    setGeneratingKey(opts.onlyKey || null);
    setGen({ running: true, phase: queue.length ? 'lines' : 'assemble', done: 0, total: queue.length });

    let licenseBlocked = false;
    let failed = 0;
    const worker = async () => {
      while (queue.length && !licenseBlocked) {
        const idx = queue.shift()!;
        const seg = snapshot[idx];
        try {
          const r = await api.generateLine({
            text: seg.khmer_translation || seg.chinese_text || '',
            lineIndex: idx,
            gender: genderByKey.get(speakerKeyOf(seg)) || seg.gender || 'male',
            voiceId: seg.voiceId || 'voxcpm-voice-actor',
            speakerId: seg.speaker_role,
            emotion: seg.emotion,
            speed: seg.speed,
            pitch: seg.pitch,
            naturalVoice: settings.naturalVoice,
            characterNumber: numberByKey.get(speakerKeyOf(seg)),
            slotSeconds: Math.max(0, (seg.end_time || 0) - (seg.start_time || 0)) || undefined,
          });
          produced[idx] = r.audioUrl;
          setSegments((prev) => {
            if (!prev[idx] || speakerKeyOf(prev[idx]) !== speakerKeyOf(seg)) return prev;
            const copy = [...prev];
            copy[idx] = {
              ...copy[idx],
              audioUrl: r.audioUrl,
              audioVoiceId: seg.voiceId || null,
              status: 'ready',
              // Gemini detected this line's emotion from the Khmer text itself — reflect it
              // in the casting table so the dropdown shows what actually drove the voice.
              ...(r.detectedEmotion ? { emotion: r.detectedEmotion } : {}),
            };
            return copy;
          });
        } catch (e: any) {
          if (/license|key/i.test(e.message || '')) licenseBlocked = true;
          failed += 1;
        } finally {
          setGen((g) => ({ ...g, done: g.done + 1 }));
        }
      }
    };

    try {
      await Promise.all([worker(), worker()]);
      if (licenseBlocked) {
        onShowToast('គណនីនេះមិនទាន់មាន License សម្រាប់ Voice Clone — សូមបញ្ចូល Key', 'warning');
        onOpenLicenseModal();
        return;
      }
      if (failed > 0) {
        onShowToast(`ឃ្លា ${toKhmerNumber(failed)} បង្កើតមិនបាន — Server នឹងព្យាយាមម្តងទៀតពេលផ្គុំវីដេអូ`, 'warning');
      }
      if (!opts.assemble) {
        onShowToast('✓ បង្កើតសំឡេងរួច — ចុច ▶ ដើម្បីស្ដាប់', 'success');
        return;
      }

      setGen((g) => ({ ...g, phase: 'assemble' }));
      const finalSegments = snapshot.map((s, i) =>
        produced[i] ? { ...s, audioUrl: produced[i], audioVoiceId: s.voiceId || null } : s
      );
      const res = await api.assembleCustom({
        filename: projectKey,
        segments: finalSegments,
        bgmAudio: cleanBgmUrl || undefined,
        ...toAssemblePayload(settings),
      });
      if (!res.success) throw new Error('ផ្គុំវីដេអូមិនបាន');
      onOutputReady(res.outputVideo, res.outputAudio);
      if (res.subtitleError) {
        onShowToast(`វីដេអូរួចរាល់ ប៉ុន្តែដាក់ Subtitle មិនបាន (${res.subtitleError}) — វីដេអូគ្មានអក្សរ`, 'warning');
      } else {
        onShowToast('🎉 វីដេអូរួចរាល់! អាចមើល និងទាញយកបាន', 'success');
      }
      if (res.bgmEngine === 'dsp') {
        onShowToast(
          'ភ្លេងត្រូវបានបំបែកដោយ Filter ធម្មតា (Demucs AI មិនទាន់ដំឡើង) — ភ្លេង/សំឡេងឈុតអាចស្រាលខ្លះ។ បើចង់ឮ Background ច្បាស់ សាក "Voice-over"',
          'warning'
        );
      }
    } catch (e: any) {
      onShowToast(`បង្កើតវីដេអូមិនបាន: ${e.message}`, 'error');
    } finally {
      setGen({ running: false, phase: '', done: 0, total: 0 });
      setGeneratingKey(null);
    }
  };

  const startScan = () => onScanTimeline(settings.scanScope);

  // ── Automatic mode: scan right after a new upload, then (optionally) build the video ──
  useEffect(() => {
    if (!autoArmed || !projectKey || isScanningTimeline || gen.running) return;
    setAutoArmed(false);
    if (!settings.autoScan || segments.length > 0) return;
    autoGenerateForRef.current = settings.autoGenerate ? projectKey : null;
    onShowToast('⚡ Auto: កំពុងស្កេនឃ្លា & តួដោយស្វ័យប្រវត្ត...', 'info');
    startScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoArmed, projectKey, isScanningTimeline, gen.running]);

  const wasScanningRef = useRef(false);
  useEffect(() => {
    const scanJustEnded = wasScanningRef.current && !isScanningTimeline;
    wasScanningRef.current = isScanningTimeline;
    if (!projectKey || autoGenerateForRef.current !== projectKey || isScanningTimeline || gen.running) return;
    if (segments.length === 0) {
      // The automatic scan found nothing (or failed) — don't build later on a manual scan
      if (scanJustEnded) autoGenerateForRef.current = null;
      return;
    }
    autoGenerateForRef.current = null;
    onShowToast('⚡ Auto: កំពុងបង្កើតវីដេអូ...', 'info');
    runGenerate({ assemble: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, isScanningTimeline, segments.length, gen.running]);

  const pickVideo = (f: File) => {
    autoGenerateForRef.current = null;
    setAutoArmed(true);
    onUploadFile(f);
  };

  const genPercent =
    gen.phase === 'assemble' ? 100 : gen.total > 0 ? Math.round((gen.done / gen.total) * 100) : 0;

  return (
    <div className="cs-root flex-1 flex flex-col h-full overflow-hidden font-khmer">
      {/* ── Header ── */}
      <header className="shrink-0 border-b border-[var(--cs-border)] px-4 sm:px-8 py-4">
        <div className="max-w-[1600px] mx-auto flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">បញ្ចូលសំឡេងខ្មែរ</h1>
              <p className="text-sm text-[var(--cs-muted)] mt-0.5">Upload វីដេអូ → AI ស្កេន & បកប្រែ → ចុចបង្កើតវីដេអូ</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggleGuide} className="cs-btn-ghost rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1">
                របៀបប្រើ {guideVisible ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <ol className="flex items-center gap-3 sm:gap-5 overflow-x-auto pb-0.5" aria-label="ជំហាន">
            <StepPill n={1} label="វីដេអូ" state={stepState(1)} />
            <span aria-hidden className="w-6 h-px bg-[var(--cs-border-strong)] shrink-0" />
            <StepPill n={2} label="ស្កេនឃ្លា" state={stepState(2)} />
            <span aria-hidden className="w-6 h-px bg-[var(--cs-border-strong)] shrink-0" />
            <StepPill n={3} label="សំឡេងតួ" state={stepState(3)} />
            <span aria-hidden className="w-6 h-px bg-[var(--cs-border-strong)] shrink-0" />
            <StepPill n={4} label="បង្កើតវីដេអូ" state={stepState(4)} />
          </ol>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-6 flex flex-col gap-5">
          {/* ── How to use ── */}
          {guideVisible && (
            <section className="cs-card p-5" aria-label="របៀបប្រើ">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {GUIDE_STEPS.map((g, i) => (
                  <div key={g.title} className="flex gap-3">
                    <span className="w-7 h-7 shrink-0 rounded-full bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)] flex items-center justify-center text-xs font-bold">
                      {toKhmerNumber(i + 1)}
                    </span>
                    <div>
                      <p className="text-sm font-bold">{g.title}</p>
                      <p className="text-xs text-[var(--cs-muted)] leading-relaxed mt-0.5">{g.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--cs-text-2)] mt-4 pt-3 border-t border-[var(--cs-border)] leading-relaxed">
                💡 ឃ្លាណាមានប៊ូតុង <span className="font-bold text-[var(--cs-accent-text)]">⬆ Upload សំឡេង ប្រុស ១</span> មានន័យថាតួនោះមិនទាន់មានសំឡេង។
                Upload ម្តងនៅលើតួ — ឃ្លាទាំងអស់របស់តួនោះនឹងប្ដូរជា <span className="font-bold text-[var(--cs-ok)]">✓</span> ភ្លាមៗ។
              </p>
            </section>
          )}

          {/* ── Notices: only when the user has to act ── */}
          {!licensed && (
            <div className="rounded-xl border border-[var(--cs-border)] bg-[var(--cs-warn-soft)] px-4 py-3 flex items-center gap-3 flex-wrap">
              <KeyRound className="w-4 h-4 text-[var(--cs-warn)] shrink-0" />
              <p className="text-xs text-[var(--cs-text-2)] flex-1 min-w-[200px]">
                ការប្រើសំឡេងដែល Upload (Voice Clone) ត្រូវការ License Key។ បើគ្មាន Key វីដេអូនឹងប្រើសំឡេងខ្មែរ AI ធម្មតា។
              </p>
              <button
                type="button"
                onClick={user ? onOpenLicenseModal : onOpenAuthModal}
                className="cs-btn-primary rounded-lg px-3 py-1.5 text-xs font-bold"
              >
                {user ? 'បញ្ចូល License Key' : 'ចូលគណនី'}
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 empty:hidden">
          {gemini && !gemini.ok && (
            <div className="rounded-xl border border-[var(--cs-border)] bg-[var(--cs-warn-soft)] px-4 py-3 flex items-center gap-3 flex-wrap">
              <CircleAlert className="w-4 h-4 text-[var(--cs-warn)] shrink-0" />
              <p className="text-xs text-[var(--cs-text-2)] flex-1 min-w-[200px]">
                <span className="font-bold">Gemini (ស្កេនឃ្លា & បកប្រែ):</span> {gemini.message}
              </p>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="cs-btn-ghost rounded-lg px-3 py-1.5 text-xs font-semibold"
              >
                យក Key
              </a>
              <button type="button" onClick={onOpenSettings} className="cs-btn-primary rounded-lg px-3 py-1.5 text-xs font-bold">
                ដាក់ Key
              </button>
            </div>
          )}
          {licensed && voxStatus && !cloneEngineReady && (
            <div className="rounded-xl border border-[var(--cs-border)] bg-[var(--cs-warn-soft)] px-4 py-3 flex items-center gap-3 flex-wrap">
              <CircleAlert className="w-4 h-4 text-[var(--cs-warn)] shrink-0" />
              <p className="text-xs text-[var(--cs-text-2)] flex-1 min-w-[200px]">
                ម៉ាស៊ីនក្លូនសំឡេង (VoxCPM2) មិនទាន់ភ្ជាប់ — សំឡេងចេញមកនឹងមិនដូចសំឡេងដែលអ្នក Upload ទេ។
              </p>
              <button type="button" onClick={onOpenVoxModal} className="cs-btn-primary rounded-lg px-3 py-1.5 text-xs font-bold">
                ភ្ជាប់ VoxCPM2
              </button>
            </div>
          )}

          </div>

          {/* ── Step 1: video ── */}
          <section className="cs-card px-4 py-3" aria-label="វីដេអូ">
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) pickVideo(f);
              }}
            />
            {!uploadedFile ? (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) pickVideo(f);
                }}
                className="w-full rounded-xl border-2 border-dashed border-[var(--cs-border-strong)] hover:border-[var(--cs-accent)] hover:bg-[var(--cs-accent-soft)] py-10 flex flex-col items-center gap-2 transition-colors"
              >
                <Film className="w-7 h-7 text-[var(--cs-accent)]" />
                <span className="text-sm font-bold">Upload វីដេអូ</span>
                <span className="text-xs text-[var(--cs-muted)]">ទាញវីដេអូមកដាក់ទីនេះ ឬចុចដើម្បីជ្រើសរើស</span>
              </button>
            ) : (
              <div className="flex items-center gap-4 flex-wrap">
                <div className="w-11 h-11 rounded-xl bg-[var(--cs-sunken)] flex items-center justify-center shrink-0">
                  <Film className="w-5 h-5 text-[var(--cs-muted)]" />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-semibold truncate">{uploadedFile.originalName || uploadedFile.filename}</p>
                  {isUploadingFile ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--cs-sunken)] overflow-hidden">
                        <div className="h-full bg-[var(--cs-accent)] transition-all" style={{ width: `${uploadProgress}%` }} />
                      </div>
                      <span className="text-[11px] font-mono text-[var(--cs-muted)]">{uploadProgress}%</span>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--cs-muted)]">{formatSize(uploadedFile.size) || 'រួចរាល់'}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isUploadingFile || gen.running}
                    onClick={() => videoInputRef.current?.click()}
                    className="cs-btn-ghost rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" /> ប្ដូរវីដេអូ
                  </button>
                  <button
                    type="button"
                    disabled={!projectKey || isScanningTimeline || gen.running}
                    onClick={startScan}
                    className={`${segments.length ? 'cs-btn-ghost' : 'cs-btn-primary'} rounded-lg px-4 py-2 text-xs font-bold flex items-center gap-1.5`}
                  >
                    {isScanningTimeline ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : segments.length ? <RefreshCw className="w-3.5 h-3.5" /> : <ScanText className="w-3.5 h-3.5" />}
                    {isScanningTimeline ? 'កំពុងស្កេន...' : segments.length ? 'ស្កេនម្តងទៀត' : 'ស្កេនឃ្លា & តួ'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Result ── */}
          {outputVideo && (
            <section className="cs-card p-4 sm:p-5 flex flex-col gap-3" aria-label="លទ្ធផល">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[var(--cs-ok)] text-[var(--cs-surface)] flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </span>
                  វីដេអូរួចរាល់
                </h2>
                <div className="flex gap-2">
                  <a href={outputVideo} download className="cs-btn-primary rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> ទាញយកវីដេអូ
                  </a>
                  {outputAudio && (
                    <a href={outputAudio} download className="cs-btn-ghost rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" /> សំឡេង MP3
                    </a>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Steps 2-3: characters + lines ── */}
          {segments.length > 0 ? (
            <DubbingStudioPanel
              state={castState}
              segments={segments}
              setSegments={setSegments}
              libraryVoices={libraryVoices}
              sourceVideoUrl={uploadedFile?.url || ''}
              outputVideoUrl={outputVideo}
              subtitles={settings.subtitles ? { position: settings.subtitlePosition, size: settings.subtitleSize } : null}
              busy={gen.running}
              generatingKey={generatingKey}
              onGenerateAll={() => runGenerate({ assemble: false })}
              onGenerateCharacter={(key) => runGenerate({ onlyKey: key, assemble: false })}
              onShowToast={onShowToast}
              bgmLabel={BGM_LABELS[settings.bgmMode]}
            />
          ) : (
            projectKey && (
              <div className="rounded-2xl border border-dashed border-[var(--cs-border-strong)] px-6 py-10 text-center">
                {isScanningTimeline ? (
                  <Loader2 className="w-6 h-6 mx-auto text-[var(--cs-accent)] animate-spin" />
                ) : (
                  <ScanText className="w-6 h-6 mx-auto text-[var(--cs-muted)]" />
                )}
                <p className="text-sm font-semibold mt-2">
                  {isScanningTimeline ? 'AI កំពុងស្ដាប់ និងបកប្រែឃ្លា… (វីដេអូវែង ត្រូវការពេលបន្តិច)' : 'ចុច “ស្កេនឃ្លា & តួ” ដើម្បីចាប់ផ្ដើម'}
                </p>
                <p className="text-xs text-[var(--cs-muted)] mt-1">AI នឹងបង្ហាញឃ្លាទាំងអស់ និងចែកតួជា ប្រុស ១, ស្រី ១ …</p>
              </div>
            )
          )}

          {uploadedFile && (
            <BackgroundMixCard
              projectKey={projectKey}
              settings={settings}
              onChange={setSettings}
              disabled={gen.running}
              onShowToast={onShowToast}
            />
          )}

          {uploadedFile && <OutputSettingsCard settings={settings} onChange={setSettings} disabled={gen.running} geminiReady={Boolean(gemini?.ok)} />}

          {onOpenAdvancedStudio && (
            <button
              type="button"
              onClick={onOpenAdvancedStudio}
              className="self-center text-xs text-[var(--cs-muted)] hover:text-[var(--cs-text)] underline-offset-4 hover:underline flex items-center gap-1 py-2"
            >
              ត្រូវការកែលម្អិត (Timeline, Effects)? បើកស្ទូឌីយោកម្រិតខ្ពស់ <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── Step 4: generate ── */}
      {segments.length > 0 && (
        <footer className="shrink-0 border-t border-[var(--cs-border)] bg-[var(--cs-surface)] px-4 sm:px-8 py-3">
          <div className="max-w-[1600px] mx-auto flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              {gen.running ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-semibold">
                    {gen.phase === 'lines'
                      ? `កំពុងបង្កើតសំឡេង ${toKhmerNumber(gen.done)}/${toKhmerNumber(gen.total)} ឃ្លា…`
                      : 'កំពុងផ្គុំវីដេអូ (បញ្ចូលសំឡេង + ភ្លេង)…'}
                  </p>
                  <div className="h-1.5 rounded-full bg-[var(--cs-sunken)] overflow-hidden">
                    <div
                      className={`h-full bg-[var(--cs-accent)] transition-all ${gen.phase === 'assemble' ? 'animate-pulse' : ''}`}
                      style={{ width: `${genPercent}%` }}
                    />
                  </div>
                </div>
              ) : missingCount > 0 ? (
                <p className="text-xs text-[var(--cs-text-2)]">
                  <span className="font-bold text-[var(--cs-accent-text)]">នៅខ្វះសំឡេង {toKhmerNumber(missingCount)} តួ</span> — តួដែលគ្មានសំឡេង
                  នឹងប្រើសំឡេងលំនាំដើម (ដូចគ្នាគ្រប់ឃ្លា)
                </p>
              ) : (
                <p className="text-xs text-[var(--cs-ok)] font-semibold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> តួទាំង {toKhmerNumber(cast.length)} មានសំឡេងរួចរាល់
                </p>
              )}
            </div>
            {!gen.running && (
              <button
                type="button"
                onClick={() => document.getElementById('cs-output-settings')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                title="ប្ដូរការកំណត់វីដេអូ"
                className="flex items-center gap-2 text-[11px] font-semibold text-[var(--cs-text-2)]"
              >
                <span className="cs-btn-ghost rounded-full px-2.5 py-1 flex items-center gap-1">
                  <Subtitles className="w-3 h-3" /> {settings.subtitles ? 'Subtitle: បើក' : 'Subtitle: បិទ'}
                </span>
                <span
                  role="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    document.getElementById('cs-background')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className="cs-btn-ghost rounded-full px-2.5 py-1 flex items-center gap-1"
                >
                  <Music2 className="w-3 h-3" /> {BGM_LABELS[settings.bgmMode]}
                </span>
                {settings.naturalVoice && (
                  <span className="cs-btn-ghost rounded-full px-2.5 py-1 hidden sm:flex items-center gap-1">
                    <Mic className="w-3 h-3" /> សំឡេងធម្មជាតិ
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              disabled={!projectKey || gen.running || isScanningTimeline}
              onClick={() => runGenerate({ assemble: true })}
              className="cs-btn-primary rounded-xl px-6 py-2.5 text-sm font-bold flex items-center gap-2"
            >
              {gen.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {outputVideo ? 'បង្កើតវីដេអូម្តងទៀត' : 'បង្កើតវីដេអូ'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};

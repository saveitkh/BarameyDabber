import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Download,
  Film,
  Sparkles,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  ExternalLink,
  Check,
  Folder,
  Sliders,
  ArrowRight,
} from 'lucide-react';
import { VideoEffects, TimelineSegment } from '../../types';
import { api } from '../../services/api';
import { generateVideoOverlayImage } from '../../services/videoOverlayRenderer';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProjectTitle: string;
  outputVideoUrl?: string | null;
  filename?: string;
  videoEffects?: VideoEffects;
  segments?: TimelineSegment[];
  onShowToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  /** A free account's trial Export quota ran out (server returns 402) -- opens the Subscription modal instead of a plain error. */
  onTrialExhausted?: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  activeProjectTitle,
  outputVideoUrl,
  filename,
  videoEffects,
  segments,
  onShowToast,
  onTrialExhausted,
}) => {
  // ── Step 1: Quality Selection ──
  const [quality, setQuality] = useState<'720p' | '1080p' | '2k' | '4k'>('1080p');

  // ── Step 2: Drive Selection ──
  const [selectedDrive, setSelectedDrive] = useState<'C:' | 'D:' | 'E:' | 'custom'>('D:');
  const [customPath, setCustomPath] = useState('D:\\AnimeDub_Outputs');

  // Rendering States
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStepText, setRenderStepText] = useState('');
  const [renderedDownloadUrl, setRenderedDownloadUrl] = useState<string | null>(null);
  const [renderedFilename, setRenderedFilename] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  const handleStartRender = async () => {
    setIsRendering(true);
    setRenderProgress(15);
    setRenderStepText('កំពុងរៀបចំ Video Master & Assets...');
    setRenderedDownloadUrl(null);

    try {
      // 1. Generate Overlay Image if needed
      let titleOverlayBase64: string | undefined = undefined;
      const effectiveEffects: VideoEffects = {
        ...(videoEffects || {
          brightness: 100,
          contrast: 100,
          saturation: 100,
          sepia: 0,
          blur: 0,
          aspectRatio: '16:9',
          lutPreset: 'standard',
        }),
      };

      if (videoEffects?.styleText?.enabled || videoEffects?.watermark?.enabled) {
        const videoEl = document.querySelector('video') as HTMLVideoElement | null;
        const srcW = videoEl?.videoWidth || 1920;
        const srcH = videoEl?.videoHeight || 1080;
        const isPortrait = srcH > srcW;

        let targetW = srcW;
        let targetH = srcH;
        if (quality === '1080p') {
          targetW = isPortrait ? 1080 : 1920;
          targetH = isPortrait ? 1920 : 1080;
        } else if (quality === '720p') {
          targetW = isPortrait ? 720 : 1280;
          targetH = isPortrait ? 1280 : 720;
        } else if (quality === '2k') {
          targetW = isPortrait ? 1440 : 2560;
          targetH = isPortrait ? 2560 : 1440;
        } else if (quality === '4k') {
          targetW = isPortrait ? 2160 : 3840;
          targetH = isPortrait ? 3840 : 2160;
        }

        const overlayData = generateVideoOverlayImage({
          width: targetW,
          height: targetH,
          videoEffects: effectiveEffects,
        });
        if (overlayData) {
          titleOverlayBase64 = overlayData;
        }
      }

      setRenderProgress(45);
      setRenderStepText('កំពុងសមកាលកម្មសំឡេង និង Subtitle...');

      await new Promise((r) => setTimeout(r, 400));
      setRenderProgress(70);
      setRenderStepText('FFmpeg Hardware Encode កំពុងដំណើរការ...');

      // 2. Call backend server to execute FFmpeg permanently
      const destination = selectedDrive === 'custom' ? customPath : `${selectedDrive}\\AnimeDub_Outputs`;
      const targetFilename = filename || (outputVideoUrl ? outputVideoUrl.split('/').pop()?.split('?')[0] : undefined) || 'project_video.mp4';
      const response = await api.renderExportVideo({
        filename: targetFilename,
        inputVideo: outputVideoUrl || undefined,
        titleOverlayBase64,
        burnSubtitles: Boolean(segments && segments.length > 0),
        subtitles: segments,
        resolution: quality === '2k' ? '1080p' : (quality as any),
        format: 'mp4',
        bitrate: quality === '4k' ? 'ultra' : 'high',
        outputDir: destination,
      });

      if (response && response.success && response.outputVideo) {
        setRenderProgress(100);
        setRenderStepText('🎉 Render វីដេអូបានជោគជ័យ 100%!');
        setRenderedDownloadUrl(response.outputVideo);
        setRenderedFilename(response.filename || `dubbed_${activeProjectTitle}.mp4`);

        const destination = selectedDrive === 'custom' ? customPath : `${selectedDrive}\\AnimeDub_Outputs`;
        onShowToast(`🎉 Export ជោគជ័យ 100%! រក្សាទុកក្នុង: ${destination}`, 'success');
      } else {
        throw new Error('Server មិនបានបញ្ជូនឯកសារវីដេអូមកវិញឡើយ');
      }
    } catch (err: any) {
      console.error('Export error:', err);
      if (err?.status === 402 && err?.detail?.code === 'trial_exhausted' && onTrialExhausted) {
        onTrialExhausted();
      } else {
        onShowToast(`បរាជ័យក្នុងការ Render: ${err.message}`, 'error');
      }
    } finally {
      setIsRendering(false);
    }
  };

  const handleCopyLink = () => {
    if (!renderedDownloadUrl) return;
    const fullUrl = renderedDownloadUrl.startsWith('http')
      ? renderedDownloadUrl
      : `${window.location.origin}${renderedDownloadUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(true);
    onShowToast('📋 បានចម្លង Link វីដេអូ Master ជោគជ័យ!', 'info');
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const QUALITIES = [
    {
      id: '720p',
      name: '720p HD',
      desc: 'លឿនបំផុត (Fast Export)',
      badge: 'លឿន',
    },
    {
      id: '1080p',
      name: '1080p FULL HD',
      desc: 'ស្ដង់ដារច្បាស់ត្រជាក់ភ្នែក (ណែនាំ)',
      badge: 'ល្អបំផុត',
      recommended: true,
    },
    {
      id: '2k',
      name: '2K QUAD HD',
      desc: 'ច្បាស់ខ្លាំងសម្រាប់ Monitor ធំ',
      badge: 'ច្បាស់',
    },
    {
      id: '4k',
      name: '4K ULTRA HD',
      desc: 'កម្រិតភាពយន្ត Cinema កំពូល',
      badge: 'PRO',
    },
  ];

  const DRIVES = [
    { id: 'C:', label: 'C: Drive', path: 'C:\\AnimeDub_Outputs' },
    { id: 'D:', label: 'D: Drive', path: 'D:\\AnimeDub_Outputs', default: true },
    { id: 'E:', label: 'E: Drive', path: 'E:\\AnimeDub_Outputs' },
    { id: 'custom', label: 'Folder ផ្ទាល់ខ្លួន', path: customPath },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-3 sm:p-5 select-none font-khmer animate-in fade-in duration-200">
      <div className="bg-[#0b0f19] border border-cyan-500/30 rounded-2xl w-full max-w-2xl overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.2)] flex flex-col max-h-[92vh]">
        {/* ── Modal Header ── */}
        <div className="p-4 px-6 border-b border-white/[0.08] flex items-center justify-between bg-[#070a13]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30">
              <Download className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  EXPORT វីដេអូ MASTER
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  FAST EXPORT
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                ជ្រើសរើស Quality ➔ ជ្រើសរើស Drive ➔ ចុច SUBMIT ជាការស្រេច!
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Modal Body: 2 Clean Steps ── */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-5 text-xs">
          {/* Active Video Name */}
          <div className="p-3 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/20 flex items-center gap-3">
            <Film className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-white truncate text-xs">
                {activeProjectTitle || 'Anime_Master_Project.mp4'}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                វីដេអូបញ្ចូលសំឡេងខ្មែរ + ភ្លេង BGM + Subtitle 3D
              </div>
            </div>
          </div>

          {/* ── STEP 1: ជ្រើសរើស QUALITY ── */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                  1
                </span>
                <span>ជ្រើសរើសកម្រិតរូបភាព (QUALITY):</span>
              </span>
              <span className="text-[10px] text-cyan-300 font-bold uppercase font-mono">
                {quality.toUpperCase()}
              </span>
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {QUALITIES.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setQuality(q.id as any)}
                  className={`p-3 rounded-xl border flex flex-col justify-between gap-1.5 text-left transition-all ${
                    quality === q.id
                      ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                      : 'bg-[#080c14] border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-mono text-xs">{q.name}</span>
                    <span
                      className={`text-[8px] font-bold px-1.5 py-0.2 rounded ${
                        q.recommended
                          ? 'bg-cyan-500/30 text-cyan-300'
                          : 'bg-white/10 text-slate-400'
                      }`}
                    >
                      {q.badge}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 leading-tight">
                    {q.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── STEP 2: ជ្រើសរើស DRIVE COMPUTER ── */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                  2
                </span>
                <span>ជ្រើសរើសទីតាំង DRIVE COMPUTER:</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedDrive === 'custom' ? customPath : `${selectedDrive}\\AnimeDub_Outputs`}
              </span>
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {DRIVES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setSelectedDrive(d.id as any);
                    if (d.id !== 'custom') {
                      setCustomPath(`${d.id}\\AnimeDub_Outputs`);
                    }
                  }}
                  className={`p-3 rounded-xl border flex items-center gap-2.5 text-left transition-all ${
                    selectedDrive === d.id
                      ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                      : 'bg-[#080c14] border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <HardDrive
                    className={`w-4 h-4 ${
                      selectedDrive === d.id ? 'text-cyan-400' : 'text-slate-500'
                    }`}
                  />
                  <div>
                    <div className="font-bold text-xs">{d.label}</div>
                    <div className="text-[9px] text-slate-500 truncate max-w-[100px]">
                      {d.path}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Custom Path Input if selected */}
            {selectedDrive === 'custom' && (
              <div className="mt-1 flex items-center gap-2">
                <Folder className="w-4 h-4 text-cyan-400 shrink-0" />
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="ឧ. D:\Movies\AnimeDub"
                  className="flex-1 bg-[#080c14] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 outline-none font-mono"
                />
              </div>
            )}
          </div>

          {/* ── STEP 3: BIG SUBMIT BUTTON ── */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleStartRender}
              disabled={isRendering}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-blue-500 text-white font-black text-sm tracking-wide shadow-xl shadow-cyan-500/30 flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50"
            >
              {isRendering ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>កំពុង EXPORT វីដេអូ ({renderProgress}%)...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  <span>🚀 ចាប់ផ្ដើម EXPORT វីដេអូ (SUBMIT)</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          {/* Render Progress Bar & Download Output */}
          {isRendering && (
            <div className="p-4 rounded-xl bg-black/40 border border-cyan-500/20 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{renderStepText}</span>
                <span className="font-mono font-bold text-cyan-400">{renderProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Render Completed Card with Download Link */}
          {renderedDownloadUrl && !isRendering && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold text-white text-xs">
                    Render បានសម្រេច 100%!
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 font-mono truncate max-w-[280px]">
                    {renderedFilename}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300 flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedLink ? 'បានចម្លង!' : 'ចម្លង Link'}</span>
                </button>

                <a
                  href={renderedDownloadUrl}
                  download={renderedFilename}
                  className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>ទាញយក MP4</span>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div className="p-3 px-6 border-t border-white/[0.08] bg-[#070a13] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs transition-colors"
          >
            បិទ
          </button>
        </div>
      </div>
    </div>
  );
};

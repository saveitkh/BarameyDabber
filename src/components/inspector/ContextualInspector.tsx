import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Sliders,
  Mic2,
  Subtitles,
  Volume2,
  Film,
  FileVideo,
  Play,
  RotateCcw,
  Zap,
  CheckCircle2,
  Loader2,
  Users,
  Settings2,
  Layers,
  Wand2,
  Languages,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { ProjectFile, TimelineSegment, CharacterVoice, VideoEffects, SubtitleStyle, User } from '../../types';
import { VoxCPM2OnlineToggle } from '../ui/VoxCPM2OnlineToggle';

interface ContextualInspectorProps {
  uploadedFile: ProjectFile | null;
  isUploadingFile?: boolean;
  uploadProgress?: number;
  uploadInfo?: { loadedMb: string; totalMb: string } | null;
  onUploadFile: (file: File) => void;
  onRemoveFile: () => void;
  voiceMode: string;
  onVoiceModeChange: (m: string) => void;
  dubbingScope?: string;
  onDubbingScopeChange?: (scope: string) => void;
  geminiModel: string;
  onGeminiModelChange: (m: string) => void;
  isDubbing: boolean;
  dubbingProgress: number;
  dubbingMessage: string;
  dubbingOutputVideo: string | null;
  dubbingOutputAudio: string | null;
  onStartDubbing: () => void;
  onPreviewVoice: (filename: string) => void;
  segments?: TimelineSegment[];
  onChangeSegments?: (segments: TimelineSegment[]) => void;
  selectedSegmentIndex?: number;
  onSelectSegment?: (index: number) => void;
  characters?: CharacterVoice[];
  activeCharacterVoice?: string;
  onSelectCharacterVoice?: (voiceId: string) => void;
  onOpenCharacterCast?: () => void;
  videoEffects?: VideoEffects;
  onChangeEffects?: (effects: VideoEffects) => void;
  subtitleStyle?: SubtitleStyle;
  onChangeSubtitleStyle?: (style: SubtitleStyle) => void;
  onGenerateLineAudio?: (idx: number) => void;
  onShowToast?: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  engineMode?: string;
  onSwitchEngine?: (mode: string) => void;
  voxStatus?: any;
  onOpenVoxModal?: () => void;
  user?: User | null;
  onOpenLicenseModal?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

type InspectorTab = 'voice' | 'audio' | 'subtitle' | 'ai' | 'effects' | 'workflow' | 'video' | 'project';

export const ContextualInspector: React.FC<ContextualInspectorProps> = ({
  uploadedFile,
  isUploadingFile = false,
  uploadProgress = 0,
  uploadInfo,
  onUploadFile,
  onRemoveFile,
  voiceMode,
  onVoiceModeChange,
  dubbingScope = '120',
  onDubbingScopeChange,
  geminiModel,
  onGeminiModelChange,
  isDubbing,
  dubbingProgress,
  dubbingMessage,
  dubbingOutputVideo,
  dubbingOutputAudio,
  onStartDubbing,
  onPreviewVoice,
  segments = [],
  onChangeSegments,
  selectedSegmentIndex = 0,
  onSelectSegment,
  characters = [],
  activeCharacterVoice,
  onSelectCharacterVoice,
  onOpenCharacterCast,
  videoEffects,
  onChangeEffects,
  subtitleStyle,
  onChangeSubtitleStyle,
  onGenerateLineAudio,
  onShowToast,
  engineMode = 'local',
  onSwitchEngine,
  voxStatus,
  onOpenVoxModal,
  user,
  onOpenLicenseModal,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('voice');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-switch to voice tab when segment selection changes
  const prevIndexRef = useRef(selectedSegmentIndex);
  useEffect(() => {
    if (prevIndexRef.current !== selectedSegmentIndex && segments.length > 0) {
      prevIndexRef.current = selectedSegmentIndex;
      if (activeTab === 'ai' || activeTab === 'workflow') {
        setActiveTab('voice');
      }
    }
  }, [selectedSegmentIndex, segments.length]);

  const selectedSegment = segments[selectedSegmentIndex] || null;

  const isLicensed = Boolean(user && (user.role === 'admin' || user.has_voxcpm_license));

  // Voice Modes (Guarded by License)
  const availableVoiceModes = !isLicensed
    ? [{ id: 'khmer_natural', label: '🎙️ សំឡេងខ្មែរស្ទូឌីយោ (Khmer Offline Audio)' }]
    : [
        { id: 'voice_actor_clone', label: '🎭 សំឡេងតួអង្គខ្មែរ (Voice Actor)' },
        { id: 'movie_clone_all', label: '🎯 ក្លូនសំឡេងដើមពីភាពយន្ត (Live Clone)' },
        { id: 'khmer_natural', label: '🎙️ សំឡេងខ្មែរធម្មជាតិ (Neural TTS)' },
      ];

  // Collapsed Minimal Dock (48px)
  if (isCollapsed) {
    return (
      <aside className="w-12 bg-white/95 backdrop-blur-xl border-l border-slate-200/90 flex flex-col items-center py-2.5 gap-2 select-none flex-shrink-0 z-10 transition-all duration-200 font-khmer shadow-xs">
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-sky-50 text-slate-600 hover:text-sky-700 flex items-center justify-center transition-all border border-slate-200"
          title="បើកផ្ទាំងគ្រប់គ្រង (ចុច I)"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
        <div className="w-6 h-px bg-slate-200 my-1" />
        {[
          { id: 'workflow', label: 'បញ្ចូលសំឡេង', icon: <Wand2 className="w-4 h-4" /> },
          { id: 'voice', label: 'សំឡេងតួអង្គ', icon: <Mic2 className="w-4 h-4" /> },
          { id: 'subtitle', label: 'អក្សររត់', icon: <Subtitles className="w-4 h-4" /> },
          { id: 'audio', label: 'កម្រិតសំឡេង', icon: <Volume2 className="w-4 h-4" /> },
          { id: 'video', label: 'បែបផែន', icon: <Film className="w-4 h-4" /> },
          { id: 'project', label: 'ព័ត៌មាន', icon: <FileVideo className="w-4 h-4" /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id as InspectorTab);
              onToggleCollapse?.();
            }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all relative group ${
              activeTab === tab.id
                ? 'bg-sky-100 text-sky-800 border border-sky-300 shadow-2xs font-bold'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
            title={`${tab.label} (ចុចបើក)`}
          >
            {tab.icon}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-[340px] bg-white dark:bg-[#0f172a]/95 border-t lg:border-t-0 lg:border-l border-slate-200/90 dark:border-slate-800 text-slate-900 dark:text-slate-100 flex flex-col overflow-hidden select-none flex-shrink-0 z-10 transition-colors duration-200 font-khmer shadow-xs">
      {/* ── Top Header & Tab Navigation ── */}
      <div className="border-b border-slate-200/90 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 p-2 flex flex-col gap-1.5 flex-shrink-0">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
            <Sliders className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>ផ្ទាំងគ្រប់គ្រង</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
              {activeTab === 'voice'
                ? 'សំឡេងតួអង្គ'
                : activeTab === 'audio'
                ? 'គ្រប់គ្រងសំឡេង'
                : activeTab === 'subtitle'
                ? 'ចំណងជើងរង'
                : activeTab === 'ai' || activeTab === 'workflow'
                ? 'ម៉ូឌែល AI'
                : 'បែបផែន & 3D'}
            </span>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                title="បង្រួមផ្ទាំង (ចុច I)"
              >
                <PanelRightClose className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher (5 Clean VIP Tabs) */}
        <div className="grid grid-cols-5 gap-1 p-0.5 rounded-xl bg-slate-200/70 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] shadow-2xs">
          {[
            { id: 'voice', label: 'សំឡេង' },
            { id: 'audio', label: 'អូឌីយ៉ូ' },
            { id: 'subtitle', label: 'អក្សរ' },
            { id: 'ai', label: 'AI' },
            { id: 'effects', label: 'បែបផែន' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as InspectorTab)}
              className={`py-1.5 rounded-lg font-bold transition-all text-center truncate ${
                activeTab === t.id ||
                (t.id === 'ai' && activeTab === 'workflow') ||
                (t.id === 'effects' && activeTab === 'video')
                  ? 'bg-sky-600 text-white shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable Tab Body ── */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 text-xs">
        {/* ================================================================ */}
        {/* TAB 1: AI DUBBING WORKFLOW PIPELINE                              */}
        {/* ================================================================ */}
        {(activeTab === 'ai' || activeTab === 'workflow') && (
          <div className="flex flex-col gap-2.5">
            {/* Mode Selection */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-1.5 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300">ទម្រង់បញ្ចូលសំឡេង</span>
              <div className="grid grid-cols-1 gap-1">
                {availableVoiceModes.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onVoiceModeChange(m.id)}
                    className={`p-2 rounded-lg text-left transition-all border text-xs ${
                      voiceMode === m.id
                        ? 'bg-sky-50 dark:bg-cyan-500/15 border-sky-300 dark:border-cyan-500/40 text-sky-900 dark:text-cyan-300 font-bold'
                        : 'bg-white dark:bg-black/30 border-slate-200 dark:border-white/[0.06] text-slate-700 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scope & Gemini Model */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300">ប្រវែងបញ្ចូល</span>
                <select
                  value={dubbingScope}
                  onChange={(e) => onDubbingScopeChange?.(e.target.value)}
                  className="bg-white dark:bg-[#07090e] border border-slate-300 dark:border-white/[0.1] rounded px-2 py-1 text-xs text-sky-700 dark:text-cyan-400 font-semibold cursor-pointer outline-none"
                >
                  <option value="30">30 វិនាទី (តេស្តលឿន)</option>
                  <option value="60">60 វិនាទី (1 នាទី)</option>
                  <option value="120">120 វិនាទី (2 នាទី)</option>
                  <option value="180">180 វិនាទី (3 នាទី)</option>
                  <option value="full">វីដេអូពេញ (Full)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300">ម៉ូឌែល Gemini</span>
                <select
                  value={geminiModel}
                  onChange={(e) => onGeminiModelChange(e.target.value)}
                  className="bg-white dark:bg-[#07090e] border border-slate-300 dark:border-white/[0.1] rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200 cursor-pointer outline-none"
                >
                  <option value="gemini-flash-latest">Gemini Flash Latest (Recommended)</option>
                  <option value="gemini-flash-lite-latest">Gemini Flash-Lite Latest (លឿនជាង)</option>
                </select>
              </div>
            </div>

            {/* Checklist */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-400" />
                  <span>ដំណាក់កាលផលិត</span>
                </span>
                <span className="text-[10px] font-mono text-sky-600 dark:text-cyan-400 font-bold">
                  {segments.length} បន្ទាត់
                </span>
              </div>

              <div className="space-y-1 pt-1">
                {[
                  { step: 1, name: 'វិភាគវីដេអូ', icon: '🎬', done: !!uploadedFile },
                  { step: 2, name: 'បែងចែកតួអង្គ', icon: '👥', done: segments.length > 0 },
                  { step: 3, name: 'បកប្រែអត្ថបទខ្មែរ', icon: '🇰🇭', done: segments.some((s) => !!s.khmer_translation) },
                  { step: 4, name: 'កំណត់សំឡេងតួអង្គ', icon: '🎙️', done: segments.some((s) => !!s.voiceId) },
                  { step: 5, name: 'ផលិតសំឡេង AI', icon: '⚡', done: !!dubbingOutputAudio || segments.some((s) => !!s.audioUrl) },
                  { step: 6, name: 'បញ្ចូលវីដេអូសម្រេច', icon: '🎚️', done: !!dubbingOutputVideo },
                ].map((s) => (
                  <div key={s.step} className="flex items-center justify-between text-[11px] py-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                          s.done
                            ? 'bg-emerald-100 dark:bg-emerald-500/25 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40'
                            : isDubbing && s.step === 5
                            ? 'bg-sky-100 dark:bg-cyan-500/25 text-sky-800 dark:text-cyan-300 border border-sky-300 dark:border-cyan-400/50 animate-pulse'
                            : 'bg-slate-200 dark:bg-white/[0.04] text-slate-500 dark:text-slate-600'
                        }`}
                      >
                        {s.done ? '✓' : s.step}
                      </span>
                      <span className={s.done ? 'text-slate-800 dark:text-slate-200 font-medium' : 'text-slate-500'}>
                        {s.icon} {s.name}
                      </span>
                    </div>
                    {s.done && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">រួចរាល់</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Active Dubbing Telemetry */}
            {isDubbing && (
              <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    <span>កំពុងបញ្ចូលសំឡេង...</span>
                  </span>
                  <span className="font-mono font-bold text-cyan-300">{dubbingProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden border border-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 transition-all duration-300"
                    style={{ width: `${dubbingProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Master Video Ready */}
            {dubbingOutputVideo && !isDubbing && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-bold text-white text-[11px]">វីដេអូបានបញ្ចូលរួចរាល់</div>
                    <div className="text-[10px] text-emerald-300/80">សំឡេងខ្មែរភ្ជាប់ត្រឹមត្រូវ ១០០%</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/25 text-emerald-200 font-bold text-[10px]">
                  រួចរាល់
                </span>
              </div>
            )}

            {/* Flagship AI Dubbing Action Button */}
            <button
              onClick={onStartDubbing}
              disabled={isDubbing || !uploadedFile}
              className={`w-full py-3 rounded-xl text-slate-950 font-black text-xs shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 ${
                isDubbing
                  ? 'bg-cyan-600/50 cursor-wait text-white'
                  : 'vip-ai-cta-gradient hover:brightness-110 shadow-[0_0_20px_rgba(0,240,255,0.4)]'
              }`}
            >
              {isDubbing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>កំពុងបង្កើតសំឡេង AI... {dubbingProgress}%</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 fill-slate-950 text-slate-950" />
                  <span>{dubbingOutputVideo ? 'AI បង្កើតសំឡេងខ្មែរឡើងវិញ' : 'AI បង្កើតសំឡេងខ្មែរ'}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 2: VOICE & CHARACTER CASTING                                 */}
        {/* ================================================================ */}
        {activeTab === 'voice' && (
          <div className="flex flex-col gap-2.5">
            {/* VoxCPM2 Engine Option */}
            <VoxCPM2OnlineToggle
              engineMode={engineMode}
              voxStatus={voxStatus}
              user={user}
              onSwitchEngine={(m) => onSwitchEngine?.(m)}
              onOpenVoxModal={onOpenVoxModal}
              onOpenLicenseModal={onOpenLicenseModal}
              variant="card"
              title="ម៉ាស៊ីនក្លូនសំឡេង AI"
              showDetails={false}
            />

            {/* Parameters: Speed, Volume, Pitch */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-2 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300">កែសម្រួលសំឡេង (Voice Parameters)</span>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-slate-600 dark:text-slate-400">
                    <span>ល្បឿន (Speed)</span>
                    <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">{selectedSegment?.speed || 1.0}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.75"
                    max="1.5"
                    step="0.05"
                    value={selectedSegment?.speed || 1.0}
                    onChange={(e) => {
                      if (selectedSegment && onChangeSegments) {
                        const copy = [...segments];
                        copy[selectedSegmentIndex] = { ...copy[selectedSegmentIndex], speed: parseFloat(e.target.value) };
                        onChangeSegments(copy);
                      }
                    }}
                    className="accent-sky-600 dark:accent-cyan-400 cursor-pointer h-1.5 bg-slate-200 dark:bg-black/40 rounded-lg"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-slate-600 dark:text-slate-400">
                    <span>កម្រិតសំឡេង (Volume)</span>
                    <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">100%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    defaultValue="100"
                    className="accent-sky-600 dark:accent-cyan-400 cursor-pointer h-1.5 bg-slate-200 dark:bg-black/40 rounded-lg"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-slate-600 dark:text-slate-400">
                    <span>កម្ពស់សំឡេង (Pitch)</span>
                    <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">0.0</span>
                  </div>
                  <input
                    type="range"
                    min="-10"
                    max="10"
                    defaultValue="0"
                    className="accent-sky-600 dark:accent-cyan-400 cursor-pointer h-1.5 bg-slate-200 dark:bg-black/40 rounded-lg"
                  />
                </div>
              </div>

            {/* Generate Single Line Audio */}
            {onGenerateLineAudio && selectedSegment && (
              <button
                onClick={() => onGenerateLineAudio(selectedSegmentIndex)}
                className="w-full py-2 rounded-xl bg-sky-50 dark:bg-cyan-500/15 hover:bg-sky-100 dark:hover:bg-cyan-500/25 border border-sky-300 dark:border-cyan-500/30 text-sky-800 dark:text-cyan-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
              >
                <Mic2 className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-400" />
                <span>បង្កើតសំឡេងបន្ទាត់ទី #{selectedSegmentIndex + 1}</span>
              </button>
            )}

            {onOpenCharacterCast && (
              <button
                onClick={onOpenCharacterCast}
                className="w-full py-1.5 rounded-lg bg-slate-100 dark:bg-white/[0.04] hover:bg-slate-200 dark:hover:bg-white/[0.08] text-slate-700 dark:text-slate-300 text-xs border border-slate-200 dark:border-white/[0.08] flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
              >
                <Users className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-400" />
                <span>តារាងតួអង្គទាំងអស់</span>
              </button>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 3: SUBTITLE SEGMENT EDITOR                                   */}
        {/* ================================================================ */}
        {activeTab === 'subtitle' && (
          <div className="flex flex-col gap-2.5">
            {selectedSegment ? (
              <>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-2 shadow-2xs">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900 dark:text-slate-200">
                      បន្ទាត់ទី #{selectedSegment.line_index + 1}
                    </span>
                    <span className="font-mono text-sky-600 dark:text-cyan-400 text-[11px] font-bold">
                      {selectedSegment.start_time?.toFixed(1)}s - {selectedSegment.end_time?.toFixed(1)}s
                    </span>
                  </div>

                  {/* Chinese Source Text */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">អត្ថបទដើម (ចិន)</label>
                    <textarea
                      rows={2}
                      value={selectedSegment.chinese_text || ''}
                      onChange={(e) => {
                        if (onChangeSegments) {
                          const copy = [...segments];
                          copy[selectedSegmentIndex] = { ...copy[selectedSegmentIndex], chinese_text: e.target.value };
                          onChangeSegments(copy);
                        }
                      }}
                      className="w-full bg-white dark:bg-[#07090e] border border-slate-200 dark:border-white/[0.1] rounded-lg p-2 text-xs text-slate-800 dark:text-slate-300 outline-none focus:border-sky-500 dark:focus:border-cyan-400 resize-none font-mono"
                    />
                  </div>

                  {/* Khmer Translated Text */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-sky-700 dark:text-cyan-400">អត្ថបទបកប្រែ (ខ្មែរ)</label>
                    <textarea
                      rows={3}
                      value={selectedSegment.khmer_translation || ''}
                      onChange={(e) => {
                        if (onChangeSegments) {
                          const copy = [...segments];
                          copy[selectedSegmentIndex] = { ...copy[selectedSegmentIndex], khmer_translation: e.target.value };
                          onChangeSegments(copy);
                        }
                      }}
                      className="w-full bg-white dark:bg-[#07090e] border border-sky-300 dark:border-cyan-500/30 rounded-lg p-2 text-xs text-slate-900 dark:text-white outline-none focus:border-sky-500 dark:focus:border-cyan-400 resize-none font-khmer font-medium"
                    />
                  </div>
                </div>

                {/* Subtitle Styling Settings */}
                {subtitleStyle && onChangeSubtitleStyle && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-2.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-sky-800 dark:text-cyan-300 font-khmer flex items-center gap-1.5">
                        <Subtitles className="w-3.5 h-3.5" />
                        <span>កំណត់ទម្រង់អក្សររត់ (Custom Subtitles)</span>
                      </span>
                      {/* Presets */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onChangeSubtitleStyle({
                            ...subtitleStyle,
                            fontFamily: 'Kantumruy Pro',
                            fontSize: 22,
                            textColor: '#fef08a',
                            strokeColor: '#000000',
                            strokeWidth: 2,
                            backgroundColor: 'rgba(0,0,0,0.75)',
                            boxEnabled: true,
                          })}
                          className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[10px] font-bold border border-amber-300 dark:border-amber-500/30"
                          title="Cinema Yellow Box"
                        >
                          Cinema
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeSubtitleStyle({
                            ...subtitleStyle,
                            fontFamily: 'Koulen',
                            fontSize: 24,
                            textColor: '#38bdf8',
                            strokeColor: '#000000',
                            strokeWidth: 3,
                            backgroundColor: 'transparent',
                            boxEnabled: false,
                          })}
                          className="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-cyan-500/20 text-sky-800 dark:text-cyan-300 text-[10px] font-bold border border-sky-300 dark:border-cyan-500/30"
                          title="Neon Cyan"
                        >
                          Neon
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeSubtitleStyle({
                            ...subtitleStyle,
                            fontFamily: 'Battambang',
                            fontSize: 20,
                            textColor: '#ffffff',
                            strokeColor: '#000000',
                            strokeWidth: 2,
                            backgroundColor: 'rgba(0,0,0,0.65)',
                            boxEnabled: true,
                          })}
                          className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-800 dark:text-white text-[10px] font-bold border border-slate-300 dark:border-white/10"
                          title="Classic White"
                        >
                          Classic
                        </button>
                      </div>
                    </div>

                    {/* Font & Position */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 dark:text-slate-400 font-khmer">Font អក្សរខ្មែរ</label>
                        <select
                          value={subtitleStyle.fontFamily}
                          onChange={(e) => onChangeSubtitleStyle({ ...subtitleStyle, fontFamily: e.target.value })}
                          className="w-full bg-white dark:bg-[#07090e] border border-slate-200 dark:border-white/[0.1] rounded px-2 py-1 text-xs text-slate-800 dark:text-white mt-0.5 outline-none font-khmer cursor-pointer"
                        >
                          <option value="Kantumruy Pro">Kantumruy Pro (Modern)</option>
                          <option value="Battambang">Battambang (Standard)</option>
                          <option value="Moul">Moul (Classic Luxury)</option>
                          <option value="Siemreap">Siemreap (Clean)</option>
                          <option value="Koulen">Koulen (Bold Movie)</option>
                          <option value="Outfit">Outfit (Sans)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 dark:text-slate-400 font-khmer">ទីតាំង</label>
                        <select
                          value={subtitleStyle.position}
                          onChange={(e) => onChangeSubtitleStyle({ ...subtitleStyle, position: e.target.value as any })}
                          className="w-full bg-white dark:bg-[#07090e] border border-slate-200 dark:border-white/[0.1] rounded px-2 py-1 text-xs text-slate-800 dark:text-white mt-0.5 outline-none font-khmer cursor-pointer"
                        >
                          <option value="bottom">ខាងក្រោម (Bottom)</option>
                          <option value="center">កណ្តាល (Center)</option>
                          <option value="top">ខាងលើ (Top)</option>
                        </select>
                      </div>
                    </div>

                    {/* Size & Stroke Width */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400 font-khmer">
                          <span>ទំហំអក្សរ</span>
                          <span className="font-mono text-cyan-300">{subtitleStyle.fontSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="14"
                          max="44"
                          value={subtitleStyle.fontSize}
                          onChange={(e) => onChangeSubtitleStyle({ ...subtitleStyle, fontSize: parseInt(e.target.value) || 20 })}
                          className="w-full accent-cyan-400 cursor-pointer mt-1"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400 font-khmer">
                          <span>កម្រាស់ស៊ុម (Stroke)</span>
                          <span className="font-mono text-cyan-300">{subtitleStyle.strokeWidth}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="6"
                          value={subtitleStyle.strokeWidth}
                          onChange={(e) => onChangeSubtitleStyle({ ...subtitleStyle, strokeWidth: parseInt(e.target.value) || 0 })}
                          className="w-full accent-cyan-400 cursor-pointer mt-1"
                        />
                      </div>
                    </div>

                    {/* Colors */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/[0.04]">
                      <div>
                        <label className="text-[10px] text-slate-400 font-khmer block mb-1">ពណ៌អក្សរ</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={subtitleStyle.textColor || '#ffffff'}
                            onChange={(e) => onChangeSubtitleStyle({ ...subtitleStyle, textColor: e.target.value })}
                            className="w-7 h-7 rounded border border-white/20 bg-transparent cursor-pointer p-0.5"
                          />
                          <span className="font-mono text-[11px] text-slate-300 uppercase">{subtitleStyle.textColor}</span>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 font-khmer block mb-1">ពណ៌ស៊ុមអក្សរ</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={subtitleStyle.strokeColor || '#000000'}
                            onChange={(e) => onChangeSubtitleStyle({ ...subtitleStyle, strokeColor: e.target.value })}
                            className="w-7 h-7 rounded border border-white/20 bg-transparent cursor-pointer p-0.5"
                          />
                          <span className="font-mono text-[11px] text-slate-300 uppercase">{subtitleStyle.strokeColor}</span>
                        </div>
                      </div>
                    </div>

                    {/* Box Background Toggle */}
                    <div className="flex items-center justify-between p-2 rounded-lg bg-black/40 border border-white/[0.06] mt-0.5">
                      <span className="text-xs text-slate-200 font-khmer">ប្រអប់ផ្ទៃក្រោយ (Background Box)</span>
                      <input
                        type="checkbox"
                        checked={subtitleStyle.boxEnabled !== false}
                        onChange={(e) => onChangeSubtitleStyle({ ...subtitleStyle, boxEnabled: e.target.checked })}
                        className="accent-cyan-400 w-4 h-4 cursor-pointer"
                      />
                    </div>
                  </div>
                )}

              </>
            ) : (
              <div className="p-6 text-center text-slate-500">
                សូមចុចលើបន្ទាត់សំឡេងណាមួយលើ Timeline ដើម្បីកែសម្រួល
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 4: AUDIO MIXER CONTROLS                                      */}
        {/* ================================================================ */}
        {activeTab === 'audio' && (
          <div className="flex flex-col gap-2.5">
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex flex-col gap-2.5">
              <span className="text-[11px] font-bold text-slate-300">កម្រិតសំឡេង Mixer</span>

              {/* Master Volume */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>សំឡេងបញ្ចូលខ្មែរ (Khmer Dub)</span>
                  <span className="font-mono text-cyan-400 font-bold">100%</span>
                </div>
                <input type="range" min="0" max="150" defaultValue="100" className="accent-cyan-400 cursor-pointer" />
              </div>

              {/* BGM Level */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>សំឡេងភ្លេង BGM</span>
                  <span className="font-mono text-cyan-400 font-bold">75%</span>
                </div>
                <input type="range" min="0" max="150" defaultValue="75" className="accent-cyan-400 cursor-pointer" />
              </div>

              {/* Original Vocal Suppression */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08]">
                <span className="text-xs text-slate-700 dark:text-slate-200 font-medium">បិទសំឡេងដើម (Mute Original)</span>
                <input type="checkbox" defaultChecked className="accent-sky-600 dark:accent-cyan-400 w-4 h-4 cursor-pointer" />
              </div>

              {/* Auto Ducking */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08]">
                <span className="text-xs text-slate-700 dark:text-slate-200 font-medium">បន្ថយភ្លេងស្វ័យប្រវត្តិ (BGM Ducking)</span>
                <input type="checkbox" defaultChecked className="accent-sky-600 dark:accent-cyan-400 w-4 h-4 cursor-pointer" />
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 5: VIDEO FX & TRANSFORMS                                     */}
        {/* ================================================================ */}
        {(activeTab === 'effects' || activeTab === 'video') && (
          <div className="flex flex-col gap-2.5">
            {videoEffects && onChangeEffects ? (
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-2.5 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300">កែពន្លឺ និងបែបផែនវីដេអូ</span>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-slate-600 dark:text-slate-400">
                    <span>ពន្លឺ (Brightness)</span>
                    <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">{videoEffects.brightness}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="150"
                    value={videoEffects.brightness}
                    onChange={(e) => onChangeEffects({ ...videoEffects, brightness: parseInt(e.target.value) })}
                    className="accent-sky-600 dark:accent-cyan-400 cursor-pointer h-1.5 bg-slate-200 dark:bg-black/40 rounded-lg"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-slate-600 dark:text-slate-400">
                    <span>កម្រិតពណ៌ (Contrast)</span>
                    <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">{videoEffects.contrast}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="150"
                    value={videoEffects.contrast}
                    onChange={(e) => onChangeEffects({ ...videoEffects, contrast: parseInt(e.target.value) })}
                    className="accent-sky-600 dark:accent-cyan-400 cursor-pointer h-1.5 bg-slate-200 dark:bg-black/40 rounded-lg"
                  />
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/[0.06]">
                  <span className="text-xs text-slate-700 dark:text-slate-200 font-medium">គែមស្រមោលកុន (Vignette)</span>
                  <input
                    type="checkbox"
                    checked={videoEffects.vignette || false}
                    onChange={(e) => onChangeEffects({ ...videoEffects, vignette: e.target.checked })}
                    className="accent-sky-600 dark:accent-cyan-400 w-4 h-4 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/[0.06]">
                  <span className="text-xs text-slate-700 dark:text-slate-200 font-medium">ស៊ុមកុន Letterbox (2.35:1)</span>
                  <input
                    type="checkbox"
                    checked={videoEffects.letterbox || false}
                    onChange={(e) => onChangeEffects({ ...videoEffects, letterbox: e.target.checked })}
                    className="accent-sky-600 dark:accent-cyan-400 w-4 h-4 cursor-pointer"
                  />
                </div>

                {/* Watermark Configuration Section */}
                <div className="pt-2.5 border-t border-slate-200/90 dark:border-white/[0.08] flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-400" />
                      សម្គាល់ឈ្មោះឆានែល (Watermark)
                    </span>
                    <input
                      type="checkbox"
                      checked={videoEffects.watermark?.enabled || false}
                      onChange={(e) => {
                        const wm = videoEffects.watermark || {
                          enabled: false,
                          text: 'សម្រាយរឿង HD',
                          position: 'top-right',
                          opacity: 85,
                          fontSize: 14,
                          fontFamily: 'Kantumruy Pro',
                          textColor: '#ffffff',
                          showBadge: true,
                        };
                        onChangeEffects({
                          ...videoEffects,
                          watermark: { ...wm, enabled: e.target.checked }
                        });
                      }}
                      className="accent-sky-600 dark:accent-cyan-400 w-4 h-4 cursor-pointer"
                    />
                  </div>

                  {videoEffects.watermark?.enabled && (
                    <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-slate-100/90 dark:bg-black/40 border border-slate-200 dark:border-white/[0.06]">
                      <div>
                        <label className="text-[10px] text-slate-600 dark:text-slate-400 block mb-1">អក្សរ Watermark</label>
                        <input
                          type="text"
                          value={videoEffects.watermark.text || ''}
                          onChange={(e) => {
                            const wm = videoEffects.watermark!;
                            onChangeEffects({
                              ...videoEffects,
                              watermark: { ...wm, text: e.target.value }
                            });
                          }}
                          placeholder="ឧ. សម្រាយរឿង HD / ឈ្មោះឆានែល"
                          className="w-full px-2.5 py-1.5 text-xs rounded bg-white dark:bg-black/50 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-sky-500 dark:focus:border-cyan-400 outline-none"
                        />
                      </div>

                      {/* Position Grid */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] text-slate-600 dark:text-slate-400">ទីតាំង (Position)</label>
                          <span className="text-[9.5px] text-sky-600 dark:text-cyan-400 font-semibold">📍 អាចទាញ Mouse បាន</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          {[
                            { id: 'free', label: '📍 ទាញសេរី (Drag Free)' },
                            { id: 'center', label: '🎯 កណ្ដាល (Center)' },
                            { id: 'top-left', label: 'លើ ឆ្វេង (Top-L)' },
                            { id: 'top-right', label: 'លើ ស្តាំ (Top-R)' },
                            { id: 'bottom-left', label: 'ក្រោម ឆ្វេង (Bot-L)' },
                            { id: 'bottom-right', label: 'ក្រោម ស្តាំ (Bot-R)' },
                          ].map((pos) => (
                            <button
                              key={pos.id}
                              type="button"
                              onClick={() => {
                                const wm = videoEffects.watermark!;
                                onChangeEffects({
                                  ...videoEffects,
                                  watermark: {
                                    ...wm,
                                    position: pos.id as any,
                                    posX: pos.id === 'free' ? (wm.posX ?? 85) : undefined,
                                    posY: pos.id === 'free' ? (wm.posY ?? 8) : undefined,
                                  }
                                });
                              }}
                              className={`py-1 px-1.5 rounded border text-center transition-all ${
                                (videoEffects.watermark?.position === pos.id || (pos.id === 'free' && (videoEffects.watermark?.posX !== undefined || videoEffects.watermark?.position === 'free')))
                                  ? 'bg-sky-100 dark:bg-cyan-500/20 border-sky-400 dark:border-cyan-400 text-sky-800 dark:text-cyan-300 font-bold'
                                  : 'bg-white dark:bg-white/[0.02] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              {pos.label}
                            </button>
                          ))}
                        </div>

                        {/* Free Drag Coordinates Sliders */}
                        {(videoEffects.watermark?.position === 'free' || videoEffects.watermark?.posX !== undefined) && (
                          <div className="mt-2 p-2 rounded-lg bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60 flex flex-col gap-1.5">
                            <p className="text-[10px] text-sky-700 dark:text-sky-300 font-medium">
                              ✨ <strong>ទាញដោយសេរី:</strong> ចុច Mouse លើ Watermark ក្នុង Video Preview ដើម្បីអូសទាញគ្រប់ទីតាំង!
                            </p>
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                              <div>
                                <div className="flex justify-between mb-0.5 text-slate-600 dark:text-slate-400">
                                  <span>ផ្ដេក X</span>
                                  <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">{videoEffects.watermark.posX ?? 85}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="2"
                                  max="98"
                                  value={videoEffects.watermark.posX ?? 85}
                                  onChange={(e) => {
                                    const wm = videoEffects.watermark!;
                                    onChangeEffects({
                                      ...videoEffects,
                                      watermark: { ...wm, position: 'free', posX: parseInt(e.target.value) }
                                    });
                                  }}
                                  className="w-full accent-sky-600 dark:accent-cyan-400 cursor-pointer"
                                />
                              </div>
                              <div>
                                <div className="flex justify-between mb-0.5 text-slate-600 dark:text-slate-400">
                                  <span>បញ្ឈរ Y</span>
                                  <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">{videoEffects.watermark.posY ?? 8}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="2"
                                  max="98"
                                  value={videoEffects.watermark.posY ?? 8}
                                  onChange={(e) => {
                                    const wm = videoEffects.watermark!;
                                    onChangeEffects({
                                      ...videoEffects,
                                      watermark: { ...wm, position: 'free', posY: parseInt(e.target.value) }
                                    });
                                  }}
                                  className="w-full accent-sky-600 dark:accent-cyan-400 cursor-pointer"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Opacity slider */}
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] text-slate-600 dark:text-slate-400">
                          <span>កម្រិតថ្លា (Opacity)</span>
                          <span className="font-mono text-sky-600 dark:text-cyan-400 font-bold">{videoEffects.watermark.opacity || 85}%</span>
                        </div>
                        <input
                          type="range"
                          min="20"
                          max="100"
                          value={videoEffects.watermark.opacity || 85}
                          onChange={(e) => {
                            const wm = videoEffects.watermark!;
                            onChangeEffects({
                              ...videoEffects,
                              watermark: { ...wm, opacity: parseInt(e.target.value) }
                            });
                          }}
                          className="accent-sky-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </div>

                      {/* Font Size & Badge Style */}
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200 dark:border-white/[0.04]">
                        <div className="flex items-center gap-1.5">
                          <label className="text-[10px] text-slate-600 dark:text-slate-400">ទំហំ:</label>
                          <select
                            value={videoEffects.watermark.fontSize || 14}
                            onChange={(e) => {
                              const wm = videoEffects.watermark!;
                              onChangeEffects({
                                ...videoEffects,
                                watermark: { ...wm, fontSize: parseInt(e.target.value) }
                              });
                            }}
                            className="bg-white dark:bg-black/60 border border-slate-300 dark:border-white/10 rounded px-1.5 py-0.5 text-[11px] text-slate-800 dark:text-white"
                          >
                            <option value={11}>តូច (11px)</option>
                            <option value={14}>មធ្យម (14px)</option>
                            <option value={18}>ធំ (18px)</option>
                            <option value={24}>ធំខ្លាំង (24px)</option>
                          </select>
                        </div>

                        <label className="flex items-center gap-1.5 text-[10.5px] text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={videoEffects.watermark.showBadge !== false}
                            onChange={(e) => {
                              const wm = videoEffects.watermark!;
                              onChangeEffects({
                                ...videoEffects,
                                watermark: { ...wm, showBadge: e.target.checked }
                              });
                            }}
                            className="accent-sky-600 dark:accent-cyan-400 rounded"
                          />
                          <span>ប្រអប់ Badge</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-center py-4">មិនទាន់មានបែបផែនវីដេអូ</div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 6: PROJECT & METADATA INFO                                   */}
        {/* ================================================================ */}
        {activeTab === 'project' && (
          <div className="flex flex-col gap-2.5">
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300">ព័ត៌មានគម្រោង</span>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between py-1 border-b border-slate-200/80 dark:border-white/[0.04]">
                  <span className="text-slate-600 dark:text-slate-400">ឈ្មោះឯកសារ</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono truncate max-w-[180px]">
                    {uploadedFile?.originalName || uploadedFile?.filename || 'មិនទាន់មានវីដេអូ'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/80 dark:border-white/[0.04]">
                  <span className="text-slate-600 dark:text-slate-400">កម្រិតច្បាស់</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono">1920 × 1080 (16:9)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/80 dark:border-white/[0.04]">
                  <span className="text-slate-600 dark:text-slate-400">ភាសាដើម</span>
                  <span className="text-slate-800 dark:text-slate-200">ចិន (Chinese)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/80 dark:border-white/[0.04]">
                  <span className="text-slate-600 dark:text-slate-400">ភាសាបកប្រែ</span>
                  <span className="text-sky-700 dark:text-cyan-300 font-bold">ខ្មែរ (Khmer)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/80 dark:border-white/[0.04]">
                  <span className="text-slate-600 dark:text-slate-400">ចំនួនបន្ទាត់សរុប</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono font-bold">{segments.length} បន្ទាត់</span>
                </div>
              </div>
            </div>

            {/* Video File Replace / Upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadFile(f);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-slate-800 dark:text-slate-200 font-bold text-xs border border-slate-200 dark:border-white/[0.08] transition-colors"
            >
              {uploadedFile ? 'ផ្លាស់ប្តូរវីដេអូថ្មី...' : 'ផ្ទុកវីដេអូឡើង...'}
            </button>
          </div>
        )}
      </div>

      {/* ── VIP Primary AI Dubbing Action Bar ── */}
      <div className="p-3 border-t border-slate-200/90 dark:border-white/[0.08] bg-white/95 dark:bg-[#07090e]/95 backdrop-blur-xl flex flex-col gap-1.5 flex-shrink-0">
        <button
          onClick={onStartDubbing}
          disabled={isDubbing || !uploadedFile}
          className={`w-full py-3 px-3 rounded-xl font-black text-xs shadow-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 ${
            isDubbing
              ? 'bg-sky-600/80 dark:bg-cyan-600/50 cursor-wait text-white'
              : 'bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:brightness-110 text-white shadow-sky-500/25'
          }`}
          title="បង្កើតសំឡេងខ្មែរ AI សម្រាប់វីដេអូទាំងមូល"
        >
          {isDubbing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span className="text-white">កំពុងបង្កើតសំឡេង AI... {dubbingProgress}%</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 fill-white text-white" />
              <span className="font-extrabold tracking-wide">✦ AI បង្កើតសំឡេងខ្មែរ (Generate Khmer AI Voice)</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};

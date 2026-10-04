import React, { useState } from 'react';
import {
  Film,
  Menu,
  Save,
  RotateCcw,
  RotateCw,
  Play,
  Share2,
  Settings,
  User as UserIcon,
  Loader2,
  LogOut,
  ChevronDown,
  Sparkles,
  Keyboard,
  Key,
  FolderKanban,
  HardDrive,
  Zap,
  Plus,
  BookOpen,
  Palette,
  Volume2,
  VolumeX,
  Bell,
  Crown,
  Sun,
  Moon,
} from 'lucide-react';
import { User, VoxcpmStatus, ProjectGroup } from '../../types';
import { VoxCPM2OnlineToggle } from '../ui/VoxCPM2OnlineToggle';
import { isSoundMuted, toggleSoundMute, playOptionSound } from '../../utils/soundEffects';

interface HeaderProps {
  activeProjectTitle: string;
  isSaving: boolean;
  user: User | null;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onSaveProject?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPreview?: () => void;
  onOpenAuthModal?: () => void;
  onOpenLicenseModal?: () => void;
  onOpenSubscription?: () => void;
  engineMode?: string;
  onSwitchEngine?: (mode: string) => void;
  voxStatus?: VoxcpmStatus | null;
  onOpenVoxModal?: () => void;
  onOpenAdmin?: () => void;
  onOpenDownloader?: () => void;
  onOpenThumbnailStudio?: () => void;
  activeTab?: string;
  onSelectTab?: (tab: any) => void;
  videoCount?: number;
  isDubbing?: boolean;
  dubbingProgress?: number;
  onOpenShortcuts?: () => void;
  projectGroups?: ProjectGroup[];
  activeGroupId?: string | null;
  onSelectGroup?: (groupId: string | null) => void;
  onOpenGroupManager?: () => void;
  shelfCount?: number;
  onOpenShelf?: () => void;
  onOpenHardwareTurbo?: () => void;
  onOpenGuide?: () => void;
  onOpenCustomizer?: () => void;
  onOpenUpdateModal?: () => void;
  onToggleMobileMenu?: () => void;
  hasUpdateAvailable?: boolean;
  latestVersion?: string;
  currentVersion?: string;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
  bgMode?: 'color' | 'wallpaper';
  onToggleWallpaperMode?: () => void;
  /** Simple layout: hide the advanced studio controls */
  simpleMode?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeProjectTitle,
  isSaving,
  user,
  onLogout,
  onOpenSettings,
  onOpenExport,
  onSaveProject,
  onUndo,
  onRedo,
  onPreview,
  onOpenAuthModal,
  onOpenLicenseModal,
  onOpenSubscription,
  onOpenAdmin,
  engineMode = 'local',
  onSwitchEngine,
  voxStatus,
  onOpenVoxModal,
  isDubbing = false,
  dubbingProgress = 0,
  onOpenShortcuts,
  projectGroups = [],
  activeGroupId = null,
  onSelectGroup,
  onOpenGroupManager,
  shelfCount = 0,
  onOpenShelf,
  onOpenHardwareTurbo,
  onOpenGuide,
  onOpenCustomizer,
  onOpenUpdateModal,
  onToggleMobileMenu,
  hasUpdateAvailable = false,
  latestVersion = 'V2.3.3 PRO',
  currentVersion = 'V2.3.3 PRO',
  isDarkMode = false,
  onToggleDarkMode,
  bgMode = 'color',
  onToggleWallpaperMode,
  simpleMode = false,
}) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [soundMuted, setSoundMutedState] = useState(() => isSoundMuted());

  const handleToggleSound = () => {
    const next = toggleSoundMute();
    setSoundMutedState(next);
    if (!next) {
      playOptionSound();
    }
  };

  // Extract clean project and episode names
  const rawTitle = activeProjectTitle || 'Perfect World EP145.mp4';
  // Thoroughly clean up upload prefixes, server hashes, mediaFile---, etc.
  const cleanTitle = (raw: string) => {
    let s = raw.split(/[/\\]/).pop() || raw;
    s = s.replace(/.*mediaFile[-_]*/i, '');
    s = s.replace(/[-_]?\d{4,}@[^.\s]*/g, '');
    s = s.replace(/[-_]?(1080P|720P|4K|4000K|300406853|raw|HD)\b/gi, '');
    s = s.replace(/\.(mp4|mkv|mov|avi|webm)$/i, '');
    s = s.replace(/[-_]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
    return s || 'រឿងថ្មី';
  };

  const cleanName = cleanTitle(rawTitle);
  const epMatch = cleanName.match(/(EP\s*\d+|ភាគ\s*\d+|Episode\s*\d+|\b\d+\b)/i);
  const epLabel = epMatch ? epMatch[0].toUpperCase() : 'EP 1';
  const displayTitle = cleanName.replace(epLabel, '').trim() || cleanName;

  const isCloud = engineMode === 'cloud';

  return (
    <header className="h-12 border-b border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-[#0f172a]/95 text-slate-900 dark:text-slate-100 backdrop-blur-2xl px-3 sm:px-4 flex items-center justify-between z-40 select-none font-khmer shadow-xs transition-colors duration-200">
      {/* ── Left: Studio Branding & Project Info ── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mobile Hamburger Menu Button */}
        {onToggleMobileMenu && (
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="md:hidden p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 active:scale-95 transition-all"
            title="បើកមឺនុយ (Menu)"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {/* Animated Studio Logo */}
        <div className="flex items-center gap-2.5">
          <div className="relative group cursor-pointer" onClick={onOpenUpdateModal}>
            <div className="w-9 h-9 rounded-xl overflow-hidden shadow-sm ring-1 ring-slate-200 group-hover:scale-105 transition-all bg-slate-50">
              <img
                src="/app_logo.png"
                alt="ស្ដេចអាទិទេព PRO KHMER"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white animate-record" />
          </div>

          <div className="flex flex-col cursor-pointer" onClick={onOpenUpdateModal} title="ចុចដើម្បីបើក Update & Checkpoint Manager">
            <div className="flex items-center gap-1.5">
              <span className="text-xs sm:text-sm font-black tracking-tight text-slate-900 truncate max-w-[120px] sm:max-w-none font-khmer">
                ស្ដេចអាទិទេព PRO
              </span>
              <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded-full bg-sky-50 border border-sky-200 text-sky-700 font-mono shrink-0">
                {currentVersion}
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">ស្ទូឌីយោផលិតវីដេអូ AI កម្រិត VIP</span>
          </div>
        </div>

        {/* Update Pill Badge if available */}
        {hasUpdateAvailable && onOpenUpdateModal && (
          <button
            onClick={onOpenUpdateModal}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-[11px] font-bold shadow-md shadow-orange-500/25 transition-all active:scale-95 animate-pulse"
            title="មាន Update ថ្មី! ចុចដើម្បីទាញយក"
          >
            <Sparkles className="w-3 h-3 fill-white" />
            <span>Update {latestVersion}</span>
          </button>
        )}

        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

        {/* Current Project & Episode Pill */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors">
          <span className="text-[11px] font-semibold text-slate-700 max-w-[150px] truncate" title={rawTitle}>
            {displayTitle}
          </span>
          <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-mono border border-sky-200">
            {epLabel}
          </span>

          <div className="h-3 w-px bg-slate-200" />

          <div className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
            <span>ចិន</span>
            <span className="text-amber-500/50">→</span>
            <span>ខ្មែរ</span>
          </div>
        </div>

        {/* Active Group / Series Badge & Selector */}
        {!simpleMode && (
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs">
          <FolderKanban className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <select
            value={activeGroupId || ''}
            onChange={(e) => onSelectGroup?.(e.target.value || null)}
            className="bg-transparent border-none text-xs font-semibold text-indigo-800 focus:outline-none cursor-pointer pr-1"
            title="ជ្រើសរើសក្រុមរឿង (Project Group)"
          >
            <option value="" className="bg-white text-slate-700">📁 រឿងទូទៅ (គ្មានក្រុម)</option>
            {projectGroups.map(g => (
              <option key={g.id} value={g.id} className="bg-white text-slate-800">
                {g.name}
              </option>
            ))}
          </select>
          {onOpenGroupManager && (
            <button
              onClick={onOpenGroupManager}
              className="hover:text-indigo-950 p-0.5 rounded hover:bg-indigo-100 transition-colors"
              title="គ្រប់គ្រង ឬបង្កើតក្រុមរឿងថ្មី"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
        )}

        {/* Quick Shelf Button */}
        {!simpleMode && onOpenShelf && (
          <button
            onClick={onOpenShelf}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-all text-xs"
            title="ឃ្លាំងផ្ទុកវីដេអូ (អតិបរមា ១០ វីដេអូ)"
          >
            <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[11px] font-medium hidden xl:inline">ឃ្លាំងវីដេអូ</span>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
              shelfCount >= 10 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
            }`}>
              {shelfCount}/10
            </span>
          </button>
        )}

        {/* Hardware Turbo Button */}
        {onOpenHardwareTurbo && (
          <button
            onClick={onOpenHardwareTurbo}
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-all text-xs font-bold"
            title="បង្កើនល្បឿន Render & TTS តាមកម្លាំង Hardware (CPU/GPU Turbo)"
          >
            <Zap className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
            <span className="text-[11px]">TURBO</span>
          </button>
        )}

        {/* ── VoxCPM2 ON/OFF Engine Switch (Guarded with License Check) ── */}
        <div className={simpleMode ? 'hidden' : 'hidden sm:flex items-center'}>
          <VoxCPM2OnlineToggle
            engineMode={engineMode}
            voxStatus={voxStatus}
            user={user}
            onSwitchEngine={(m) => onSwitchEngine?.(m)}
            onOpenVoxModal={onOpenVoxModal}
            onOpenLicenseModal={onOpenLicenseModal}
            compact
          />
        </div>

        {/* ── Live Dubbing / Pipeline Process Status Badge ── */}
        {isDubbing && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 border border-sky-300 text-sky-800 shadow-sm animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
            <span className="text-[11px] font-bold">កំពុងបញ្ចូល</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-600 text-white font-bold">{dubbingProgress}%</span>
          </div>
        )}
      </div>

      {/* ── Right: Standard Workstation Actions ── */}
      <div className="flex items-center gap-1.5">
        {!simpleMode && (
        <>
        {/* Save Status Button */}
        <button
          onClick={onSaveProject}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 transition-all disabled:opacity-60 shadow-2xs"
          title="រក្សាទុកគម្រោង (Ctrl+S)"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
              <span className="hidden md:inline text-[11px]">កំពុងរក្សាទុក...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5 text-slate-600" />
              <span className="hidden md:inline text-[11px]">រក្សាទុក</span>
            </>
          )}
        </button>

        {/* Undo */}
        <button
          onClick={onUndo}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
          title="ត្រឡប់ក្រោយ (Ctrl+Z)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Redo */}
        <button
          onClick={onRedo}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
          title="ទៅមុខ (Ctrl+Y)"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {/* Preview Play/Pause Toggle */}
        <button
          onClick={onPreview}
          className="p-1.5 rounded-lg text-slate-600 hover:text-sky-600 hover:bg-sky-50 border border-transparent hover:border-sky-200 transition-colors"
          title="ចាក់ / ផ្អាក (Space)"
        >
          <Play className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        {/* Sound Feedback Toggle */}
        <button
          onClick={handleToggleSound}
          className={`p-1.5 rounded-lg transition-colors ${
            soundMuted
              ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
              : 'text-sky-600 hover:text-sky-700 hover:bg-sky-50'
          }`}
          title={soundMuted ? 'បើកសំឡេង Button Click (Muted)' : 'បិទសំឡេង Button Click (Audio Enabled)'}
        >
          {soundMuted ? (
            <VolumeX className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>

        {/* Notification Bell */}
        <button
          onClick={onOpenUpdateModal || onOpenSettings}
          className="relative p-1.5 rounded-lg text-slate-600 hover:text-sky-600 hover:bg-slate-100 transition-colors"
          title="ដំណឹង & បច្ចុប្បន្នភាពស្ទូឌីយោ (Notifications & Updates)"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-sky-500 ring-2 ring-white" />
        </button>
        </>
        )}

        {/* Background Color & Wallpaper Customizer Button */}
        {!simpleMode && onOpenCustomizer && (
          <button
            onClick={onOpenCustomizer}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-sky-50 via-indigo-50 to-purple-50 hover:from-sky-100 hover:via-indigo-100 hover:to-purple-100 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-sky-300 border border-sky-300/80 dark:border-slate-700 shadow-2xs hover:shadow-xs transition-all active:scale-95 shrink-0"
            title="ប្ដូរ Wallpaper 4K & ពណ៌ផ្ទៃខាងក្រោយ (Pearl Snow / Pure White)"
          >
            <Palette className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-bold">🎨 ពណ៌ & Wallpaper</span>
            <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-black ${
              bgMode === 'wallpaper'
                ? 'bg-indigo-600 text-white'
                : 'bg-emerald-600 text-white'
            }`}>
              {bgMode === 'wallpaper' ? '🖼️ Wallpaper' : '🥛 ពណ៌ស'}
            </span>
          </button>
        )}

        {/* 1-Click Night Mode & Light Mode Toggle */}
        {onToggleDarkMode && (
          <button
            type="button"
            onClick={onToggleDarkMode}
            className={`flex items-center gap-1.5 ${simpleMode ? 'p-1.5' : 'px-3 py-1.5'} rounded-xl text-xs font-bold border transition-all active:scale-95 shadow-2xs shrink-0 select-none ${
              isDarkMode
                ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/40 shadow-amber-500/10'
                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-indigo-200 shadow-indigo-500/10'
            }`}
            title={isDarkMode ? 'ចុចដើម្បីប្តូរទៅ Light Mode ☀️ (ពណ៌សស្អាត ភ្លឺច្បាស់)' : 'ចុចដើម្បីប្តូរទៅ Night Mode 🌙 (ពណ៌ងងឹត ត្រជាក់ភ្នែក)'}
          >
            {isDarkMode ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400 fill-amber-400 animate-pulse" />
                {!simpleMode && <span className="hidden sm:inline font-bold">☀️ ភ្លឺ (Light)</span>}
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-600 fill-indigo-500" />
                {!simpleMode && <span className="hidden sm:inline font-bold">🌙 ងងឹត (Night)</span>}
              </>
            )}
          </button>
        )}

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="ការកំណត់ស្ទូឌីយោ"
        >
          <Settings className="w-4 h-4" />
        </button>

        {!simpleMode && (
        <>
        {/* Primary Export Action */}
        <button
          onClick={onOpenExport}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-sm shadow-sky-500/25 transition-all active:scale-95 shrink-0 ml-1"
          title="នាំចេញវីដេអូសម្រេច (Export Video)"
        >
          <Share2 className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>នាំចេញវីដេអូ</span>
        </button>

        {/* VIP Status Pill */}
        <div className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold ml-1 tracking-widest shadow-2xs">
          <Crown className="w-3 h-3 text-amber-500 fill-amber-400" />
          <span>PRO VIP</span>
        </div>
        </>
        )}

        {/* User Profile / Auth */}
        <div className="relative ml-1">
          {user ? (
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200"
            >
              <div className="w-6 h-6 rounded-full bg-sky-100 border border-sky-300 flex items-center justify-center text-[10px] font-bold text-sky-700">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
              <ChevronDown className="w-3 h-3 text-slate-500" />
            </button>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-sky-700 hover:bg-sky-50 border border-sky-300 transition-colors"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>ចូលគណនី</span>
            </button>
          )}

          {/* User Menu Dropdown */}
          {showUserMenu && user && (
            <div
              className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-white border border-slate-200 shadow-xl p-1 z-50 text-xs"
              onMouseLeave={() => setShowUserMenu(false)}
            >
              <div className="px-2.5 py-2 border-b border-slate-100">
                <div className="font-bold text-slate-900 truncate">{user.username}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                  Role: <span className="text-sky-600 font-bold">{user.role}</span>
                </div>
              </div>

              {user.role === 'admin' && onOpenAdmin && (
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    onOpenAdmin();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-amber-50 text-amber-800 transition-colors font-khmer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>ផ្ទាំងគ្រប់គ្រង Admin</span>
                </button>
              )}

              <button
                onClick={() => {
                  setShowUserMenu(false);
                  onOpenLicenseModal?.();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 text-sky-700 transition-colors font-khmer"
              >
                <Key className="w-3.5 h-3.5 text-sky-600" />
                <span>Key License VoxCPM2</span>
              </button>

              {onOpenSubscription && (
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    onOpenSubscription();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-amber-50 text-amber-700 transition-colors font-khmer"
                >
                  <Crown className="w-3.5 h-3.5 text-amber-500" />
                  <span>Subscription</span>
                </button>
              )}

              <button
                onClick={() => {
                  setShowUserMenu(false);
                  onOpenSettings();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Preferences</span>
              </button>

              <button
                onClick={() => {
                  setShowUserMenu(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-red-50 text-red-600 transition-colors mt-0.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

import React from 'react';
import {
  FolderKanban,
  FolderOpen,
  Film,
  Users,
  Mic2,
  Subtitles,
  SlidersHorizontal,
  Share2,
  HardDrive,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  Sparkles,
  Crown,
  X,
  Palette,
  AudioLines,
  Eye,
  EyeOff,
} from 'lucide-react';
import { TabId, User } from '../../types';
import { getSubscriptionInfo } from '../../utils/subscription';

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onNewProject: () => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onOpenCustomizer?: () => void;
  onOpenSystemStatus: () => void;
  isSystemOnline?: boolean;
  user?: User | null;
  shelfCount?: number;
  onOpenShelf?: () => void;
  onOpenGroups?: () => void;
  onOpenHardwareTurbo?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  showAdvancedTools?: boolean;
  onToggleAdvancedTools?: () => void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  isCollapsed: boolean;
  badge?: string;
  badgeVariant?: 'sky' | 'indigo' | 'emerald' | 'amber' | 'violet' | 'rose';
  title?: string;
  iconBg?: string;
}

const BV: Record<string, string> = {
  sky: 'bg-sky-100 text-sky-800 border border-sky-300',
  indigo: 'bg-indigo-100 text-indigo-800 border border-indigo-300',
  emerald: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  amber: 'bg-amber-100 text-amber-800 border border-amber-300',
  violet: 'bg-purple-100 text-purple-800 border border-purple-300',
  rose: 'bg-rose-100 text-rose-800 border border-rose-300',
};

const NavItem: React.FC<NavItemProps> = ({
  icon,
  label,
  active,
  onClick,
  isCollapsed,
  badge,
  badgeVariant = 'sky',
  title,
  iconBg,
}) => (
  <button
    onClick={onClick}
    title={isCollapsed ? title || label : undefined}
    className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-xl text-[12px] font-medium transition-all duration-200 group relative select-none ${
      active
        ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-300 font-bold border border-sky-200/90 dark:border-sky-800 shadow-xs'
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/80 border border-transparent'
    } ${isCollapsed ? 'justify-center px-0' : ''}`}
  >
    {active && !isCollapsed && (
      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-sky-600 shadow-sm" />
    )}
    <span
      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
        active ? 'shadow-xs scale-105' : 'group-hover:scale-105'
      } ${iconBg || 'bg-slate-100 dark:bg-slate-800'}`}
    >
      {icon}
    </span>
    {!isCollapsed && (
      <>
        <span className="flex-1 text-left truncate tracking-wide">{label}</span>
        {badge && (
          <span
            className={`text-[9.5px] font-black px-1.5 py-[1px] rounded-full font-mono leading-none ${
              BV[badgeVariant] || BV.sky
            }`}
          >
            {badge}
          </span>
        )}
      </>
    )}
  </button>
);

const Content: React.FC<{
  isCollapsed: boolean;
  activeTab: TabId;
  onSelectTab: (t: TabId) => void;
  shelfCount: number;
  onOpenShelf?: () => void;
  onOpenGroups?: () => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onOpenCustomizer?: () => void;
  onOpenSystemStatus: () => void;
  isSystemOnline: boolean;
  user?: User | null;
  onToggleCollapse: () => void;
  onCloseMobile?: () => void;
  showAdvancedTools?: boolean;
  onToggleAdvancedTools?: () => void;
}> = ({
  isCollapsed,
  activeTab,
  onSelectTab,
  shelfCount,
  onOpenShelf,
  onOpenGroups,
  onOpenExport,
  onOpenSettings,
  onOpenCustomizer,
  onOpenSystemStatus,
  isSystemOnline,
  user,
  onToggleCollapse,
  onCloseMobile,
  showAdvancedTools = false,
  onToggleAdvancedTools,
}) => {
  const hc = (fn: () => void) => {
    fn();
    onCloseMobile?.();
  };
  const subInfo = user ? getSubscriptionInfo(user) : null;
  const isAdmin = user?.role === 'admin';

  return (
    <>
      {!isCollapsed ? (
        <div className="px-3 pt-3.5 pb-2 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 shadow-xs flex-shrink-0 bg-slate-50 dark:bg-slate-800">
            <img
              src="/app_logo.png"
              alt="Logo"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-black text-slate-900 dark:text-slate-100 tracking-tight leading-none truncate font-khmer">
              ស្ដេចអាទិទេព PRO
            </p>
            <p className="text-[9.5px] text-slate-500 dark:text-slate-400 leading-none mt-1">
              AI Dubbing Studio
            </p>
          </div>
        </div>
      ) : (
        <div className="pt-3 pb-2 flex justify-center">
          <div className="w-7 h-7 rounded-xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 shadow-xs bg-slate-50 dark:bg-slate-800">
            <img
              src="/app_logo.png"
              alt="Logo"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        </div>
      )}

      <div className="mx-2.5 h-px bg-slate-200 dark:bg-slate-800 mb-1.5" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 flex flex-col gap-0.5 scrollbar-thin">
        {/* ── Everyday pages ── */}
        <NavItem
          icon={<AudioLines className="w-3.5 h-3.5 text-orange-700" />}
          label="ធ្វើវីដេអូ"
          active={activeTab === 'tab-session'}
          onClick={() => hc(() => onSelectTab('tab-session'))}
          isCollapsed={isCollapsed}
          iconBg="bg-orange-50"
          title="បញ្ចូលសំឡេងខ្មែរ (Upload → ស្កេន → បង្កើតវីដេអូ)"
        />
        <NavItem
          icon={<FolderOpen className="w-3.5 h-3.5 text-indigo-600" />}
          label="វីដេអូរបស់ខ្ញុំ"
          active={activeTab === 'tab-dashboard'}
          onClick={() => hc(() => onSelectTab('tab-dashboard'))}
          isCollapsed={isCollapsed}
          iconBg="bg-indigo-50"
          title="វីដេអូដែល Upload រួច — ចុចដើម្បីបើកម្តងទៀត"
        />
        <NavItem
          icon={<Users className="w-3.5 h-3.5 text-purple-600" />}
          label="បណ្ណាល័យសំឡេង"
          active={activeTab === 'tab-character'}
          onClick={() => hc(() => onSelectTab('tab-character'))}
          isCollapsed={isCollapsed}
          iconBg="bg-purple-50"
          title="សំឡេងតួដែលមានស្រាប់ / ក្លូនសំឡេង"
        />

        {/* ── Advanced tools (hidden until switched on) ── */}
        {showAdvancedTools && (
          <>
            <div className="my-1.5 mx-1 h-px bg-slate-200 dark:bg-slate-800" />
            {!isCollapsed && (
              <p className="px-2 pb-0.5 text-[9.5px] font-bold uppercase tracking-widest text-slate-400">កម្រិតខ្ពស់</p>
            )}
            <NavItem
              icon={<Film className="w-3.5 h-3.5 text-blue-600" />}
              label="ស្ទូឌីយោ (Timeline)"
              active={activeTab === 'tab-dubbing' || activeTab === 'tab-workflow'}
              onClick={() => hc(() => onSelectTab('tab-dubbing'))}
              isCollapsed={isCollapsed}
              iconBg="bg-blue-50"
              title="Video Dubbing Studio"
            />
            <NavItem
              icon={<Mic2 className="w-3.5 h-3.5 text-emerald-600" />}
              label="AI TTS ខ្មែរ"
              active={activeTab === 'tab-offline' || activeTab === 'tab-manual'}
              onClick={() => hc(() => onSelectTab('tab-offline'))}
              isCollapsed={isCollapsed}
              iconBg="bg-emerald-50"
              title="Khmer TTS"
            />
            <NavItem
              icon={<Subtitles className="w-3.5 h-3.5 text-teal-600" />}
              label="កែ Subtitle"
              active={activeTab === 'tab-subtitles'}
              onClick={() => hc(() => onSelectTab('tab-subtitles'))}
              isCollapsed={isCollapsed}
              iconBg="bg-teal-50"
              title="Subtitles"
            />
            <NavItem
              icon={<SlidersHorizontal className="w-3.5 h-3.5 text-pink-600" />}
              label="ភ្លេង & Effects"
              active={activeTab === 'tab-mixer' || activeTab === 'tab-thumbnail'}
              onClick={() => hc(() => onSelectTab('tab-mixer'))}
              isCollapsed={isCollapsed}
              iconBg="bg-pink-50"
              title="Audio mixer, effects & thumbnail"
            />
            <NavItem
              icon={<Sparkles className="w-3.5 h-3.5 text-amber-600" />}
              label="ឧបករណ៍ AI"
              active={activeTab === 'tab-translator' || activeTab === 'tab-tuner'}
              onClick={() => hc(() => onSelectTab('tab-translator'))}
              isCollapsed={isCollapsed}
              iconBg="bg-amber-50"
              title="AI Tools"
            />
            <NavItem
              icon={<FolderKanban className="w-3.5 h-3.5 text-indigo-600" />}
              label="ក្រុមរឿង (Groups)"
              active={activeTab === 'tab-groups'}
              onClick={() => hc(() => (onOpenGroups ? onOpenGroups() : onSelectTab('tab-groups')))}
              isCollapsed={isCollapsed}
              iconBg="bg-indigo-50"
              title="Project Groups"
            />
            <NavItem
              icon={<HardDrive className="w-3.5 h-3.5 text-sky-600" />}
              label="ឃ្លាំងមេឌៀ"
              active={activeTab === 'tab-shelf'}
              onClick={() => hc(() => (onOpenShelf ? onOpenShelf() : onSelectTab('tab-shelf')))}
              isCollapsed={isCollapsed}
              badge={`${shelfCount}/10`}
              badgeVariant={shelfCount >= 10 ? 'amber' : 'emerald'}
              iconBg="bg-sky-50"
              title="Media Shelf"
            />
            <NavItem
              icon={<FolderOpen className="w-3.5 h-3.5 text-violet-600" />}
              label="គម្រោងវីដេអូ"
              active={activeTab === 'tab-projects'}
              onClick={() => hc(() => onSelectTab('tab-projects'))}
              isCollapsed={isCollapsed}
              iconBg="bg-violet-50"
              title="Video Projects"
            />
            {onOpenCustomizer && (
              <NavItem
                icon={<Palette className="w-3.5 h-3.5 text-purple-600" />}
                label="ពណ៌ & Wallpaper"
                onClick={() => hc(onOpenCustomizer)}
                isCollapsed={isCollapsed}
                iconBg="bg-purple-50"
                title="ប្ដូរ Wallpaper & ពណ៌ផ្ទៃខាងក្រោយ"
              />
            )}
            <NavItem
              icon={<Share2 className="w-3.5 h-3.5 text-blue-600" />}
              label="នាំចេញ (Export)"
              onClick={() => hc(onOpenExport)}
              isCollapsed={isCollapsed}
              iconBg="bg-blue-50"
              title="Export ជាមួយ Watermark / 4K"
            />
          </>
        )}

        <div className="my-1.5 mx-1 h-px bg-slate-200 dark:bg-slate-800" />

        {onToggleAdvancedTools && (
          <NavItem
            icon={
              showAdvancedTools ? (
                <EyeOff className="w-3.5 h-3.5 text-slate-600" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-slate-600" />
              )
            }
            label={showAdvancedTools ? 'លាក់ឧបករណ៍កម្រិតខ្ពស់' : 'ឧបករណ៍កម្រិតខ្ពស់'}
            onClick={onToggleAdvancedTools}
            isCollapsed={isCollapsed}
            iconBg="bg-slate-100"
            title="Timeline, Effects, Export, Media… ត្រូវបានលាក់ដើម្បីកុំឲ្យច្រឡំ — ចុចដើម្បីបង្ហាញ/លាក់"
          />
        )}
        <NavItem
          icon={<Settings className="w-3.5 h-3.5 text-slate-600" />}
          label="ការកំណត់ (API Key)"
          onClick={() => hc(onOpenSettings)}
          isCollapsed={isCollapsed}
          iconBg="bg-slate-100"
          title="Settings"
        />
      </div>

      <div className="p-2 flex flex-col gap-1.5 border-t border-slate-200">
        {!isCollapsed && user && subInfo && (
          <button
            onClick={onOpenSettings}
            className={`w-full p-2.5 rounded-xl border transition-all text-left group ${
              isAdmin
                ? 'bg-amber-50 border-amber-200 hover:border-amber-300'
                : 'bg-slate-50 border-slate-200 hover:border-sky-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-[9.5px] text-slate-500 font-bold uppercase tracking-widest">
                {isAdmin ? (
                  <Crown className="w-3 h-3 text-amber-600" />
                ) : (
                  <Sparkles className="w-3 h-3 text-sky-600" />
                )}
                <span>MEMBERSHIP</span>
              </div>
              <span
                className={`text-[9px] px-1.5 font-black font-mono rounded ${
                  isAdmin
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-sky-100 text-sky-800 border border-sky-300'
                }`}
              >
                {subInfo.badge}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-900 truncate">
                {subInfo.title}
              </span>
              <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-800 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </div>
          </button>
        )}

        {!isCollapsed ? (
          <a
            href="https://t.me/BongCheatz_IT"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-sky-50 border border-sky-200 hover:border-sky-300 text-sky-800 hover:text-sky-950 transition-all group shadow-2xs"
          >
            <span className="text-sm">✈️</span>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[10px] font-black text-sky-800">
                ទាក់ទង ADMIN
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                @BongCheatz_IT
              </span>
            </div>
            <ChevronRight className="w-3 h-3 text-sky-500 group-hover:translate-x-0.5 transition-transform ml-auto" />
          </a>
        ) : (
          <a
            href="https://t.me/BongCheatz_IT"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center p-2 rounded-xl hover:bg-sky-50 text-sky-700 transition-colors"
            title="@BongCheatz_IT"
          >
            ✈️
          </a>
        )}

        <button
          onClick={onOpenSystemStatus}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all text-left group"
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isSystemOnline ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[10.5px] font-semibold text-slate-800 leading-none">
                System Status
              </p>
              <p className="text-[9px] text-slate-500 leading-none mt-0.5">
                {isSystemOnline ? 'All Online' : 'Check Services'}
              </p>
            </div>
          )}
          {!isCollapsed && (
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-700 transition-colors flex-shrink-0" />
          )}
        </button>

        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center py-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-all"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>
    </>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  onNewProject,
  onOpenExport,
  onOpenSettings,
  onOpenCustomizer,
  onOpenSystemStatus,
  isSystemOnline = true,
  user,
  shelfCount = 0,
  onOpenShelf,
  onOpenGroups,
  isMobileOpen = false,
  onCloseMobile,
  showAdvancedTools = false,
  onToggleAdvancedTools,
}) => (
  <>
    <aside
      className={`hidden md:flex bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-xl border-r border-slate-200/90 dark:border-slate-800 text-slate-900 dark:text-slate-100 flex-col select-none transition-colors duration-200 z-20 flex-shrink-0 shadow-xs ${
        isCollapsed ? 'w-[54px]' : 'w-[200px]'
      }`}
    >
      <Content
        isCollapsed={isCollapsed}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        shelfCount={shelfCount}
        onOpenShelf={onOpenShelf}
        onOpenGroups={onOpenGroups}
        onOpenExport={onOpenExport}
        onOpenSettings={onOpenSettings}
        onOpenCustomizer={onOpenCustomizer}
        onOpenSystemStatus={onOpenSystemStatus}
        isSystemOnline={isSystemOnline}
        user={user}
        onToggleCollapse={onToggleCollapse}
        showAdvancedTools={showAdvancedTools}
        onToggleAdvancedTools={onToggleAdvancedTools}
      />
    </aside>
    {isMobileOpen && (
      <div className="fixed inset-0 z-50 md:hidden flex animate-in fade-in duration-200">
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
          onClick={onCloseMobile}
        />
        <aside className="relative w-64 max-w-[85vw] bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800 h-full flex flex-col z-10 shadow-2xl">
          <div className="px-3 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 flex-shrink-0">
            <div className="flex items-center gap-2">
              <img
                src="/app_logo.png"
                className="w-6 h-6 rounded-lg"
                alt="Logo"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="font-black text-xs text-slate-900 dark:text-slate-100 font-khmer">
                ស្ដេចអាទិទេព PRO
              </span>
            </div>
            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <Content
            isCollapsed={false}
            activeTab={activeTab}
            onSelectTab={onSelectTab}
            shelfCount={shelfCount}
            onOpenShelf={onOpenShelf}
            onOpenGroups={onOpenGroups}
            onOpenExport={onOpenExport}
            onOpenSettings={onOpenSettings}
            onOpenCustomizer={onOpenCustomizer}
            onOpenSystemStatus={onOpenSystemStatus}
            isSystemOnline={isSystemOnline}
            user={user}
            onToggleCollapse={onToggleCollapse}
            onCloseMobile={onCloseMobile}
            showAdvancedTools={showAdvancedTools}
            onToggleAdvancedTools={onToggleAdvancedTools}
          />
        </aside>
      </div>
    )}
  </>
);
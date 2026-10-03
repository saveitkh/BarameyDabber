import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { DubbingStudio } from './components/studio/DubbingStudio';
import { CharacterLibrary } from './components/characters/CharacterLibrary';
import { TranslationDesk } from './components/translation/TranslationDesk';
import { AudioMixerConsole } from './components/mixer/AudioMixerConsole';
import { SubtitleStudio } from './components/subtitles/SubtitleStudio';
import { VoiceTunerLab } from './components/tuner/VoiceTunerLab';
import { ThumbnailGenerator } from './components/thumbnail/ThumbnailGenerator';
import { VideoDownloaderModal } from './components/downloader/VideoDownloaderModal';
import { ToastContainer, ToastMessage } from './components/ui/Toast';
import { WorkflowView } from './components/workflow/WorkflowView';
import { VideoProjectManager } from './components/projects/VideoProjectManager';

import { AuthModal } from './components/modals/AuthModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { ExportModal } from './components/modals/ExportModal';
import { QuickVoxcpmModal } from './components/modals/QuickVoxcpmModal';
import { AdminUsersModal } from './components/modals/AdminUsersModal';
import { LicenseActivationModal } from './components/modals/LicenseActivationModal';
import { AddVoiceModal } from './components/modals/AddVoiceModal';
import { EditVoiceModal } from './components/modals/EditVoiceModal';
import { VoiceAuditionModal } from './components/modals/VoiceAuditionModal';
import { KeyboardShortcutsModal } from './components/modals/KeyboardShortcutsModal';
import { SystemStatusModal } from './components/layout/SystemStatusModal';
import { VideoShelfModal } from './components/shelf/VideoShelfModal';
import { GroupManagerModal } from './components/groups/GroupManagerModal';
import { HardwareTurboModal } from './components/settings/HardwareTurboModal';
import { UserGuideModal } from './components/modals/UserGuideModal';
import { VideoTrimmerModal } from './components/trimmer/VideoTrimmerModal';
import { CommercialOverlayModal } from './components/overlay/CommercialOverlayModal';
import { StudioCustomizerModal } from './components/customizer/StudioCustomizerModal';
import { QuickThemeFloatingWidget } from './components/customizer/QuickThemeFloatingWidget';
import { SoftwareUpdateModal } from './components/modals/SoftwareUpdateModal';
import { KhmerOfflineStudioPage } from './components/offline/KhmerOfflineStudioPage';
import { VoiceCloneSession } from './components/session/VoiceCloneSession';

import { api } from './services/api';
import {
  User,
  CharacterVoice,
  TimelineSegment,
  ProjectFile,
  StudioConfig,
  VoxcpmStatus,
  TabId,
  VideoEffects,
  SubtitleStyle,
  ProjectGroup,
  VideoShelfItem,
  StudioEngineOption,
  CommercialOverlayConfig,
  KhmerOfflineConfig,
  StudioCustomUITheme,
} from './types';
import { Mic, Volume2 } from 'lucide-react';
import { initGlobalClickSound } from './utils/soundEffects';

const DEFAULT_PRESET_TIMELINE_SEGMENTS: TimelineSegment[] = [
  { line_index: 0, start_time: 1.2, end_time: 4.8, speaker_name: "Xiao Yan (តួឯកប្រុស)", gender: "male", speaker_role: "male_lead", voiceId: "voxcpm:kxev_char_01_male.mp3", voiceFilename: "kxev_char_01_male.mp3", voiceLabel: "👑 អ្នកប្រុសធំ ផេ (តួឯកប្រុស)", chinese_text: "你好，欢迎来到这里。", khmer_translation: "សួស្តី សូមស្វាគមន៍មកកាន់ទីនេះ!", status: "ready" },
  { line_index: 1, start_time: 5.5, end_time: 9.0, speaker_name: "Yun Yun (តួឯកស្រី)", gender: "female", speaker_role: "female_lead", voiceId: "voxcpm:kxev_char_02_female.mp3", voiceFilename: "kxev_char_02_female.mp3", voiceLabel: "🌸 ប្អូនស្រី ស៊ាវអ៊ី (តួឯកស្រី)", chinese_text: "今天的天气真好，我们走吧。", khmer_translation: "អាកាសធាតុថ្ងៃនេះពិតជាល្អណាស់ តោះពួកយើងចេញដំណើរទៅ។", status: "ready" },
  { line_index: 2, start_time: 10.2, end_time: 14.5, speaker_name: "Elder Gu (ព្រឹទ្ធាចារ្យ)", gender: "male", speaker_role: "elder", voiceId: "voxcpm:kxev_char_04_male.mp3", voiceFilename: "kxev_char_04_male.mp3", voiceLabel: "💼 លោកប្រធាន (ព្រឹទ្ធាចារ្យ)", chinese_text: "大家一定要小心前方的危险！", khmer_translation: "អ្នកទាំងអស់គ្នាត្រូវតែប្រុងប្រយ័ត្ននឹងគ្រោះថ្នាក់នៅខាងមុខ!", status: "ready" }
];

const DEFAULT_ANIME_WALLPAPER = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=2560&q=95&auto=format&fit=crop';

export const App: React.FC = () => {
  // Navigation & Shell
  const [activeTab, setActiveTab] = useState<TabId>('tab-session');
  // Simple mode (default) hides fully-automatic tools so the manual workflow stays clear
  const [showAdvancedTools, setShowAdvancedTools] = useState<boolean>(() => {
    try {
      return localStorage.getItem('studio_show_advanced_tools') === '1';
    } catch {
      return false;
    }
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Series Groups & 10-Video Shelf & Hardware Turbo
  const [isShelfOpen, setIsShelfOpen] = useState(false);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [isHardwareTurboOpen, setIsHardwareTurboOpen] = useState(false);
  const [shelfItems, setShelfItems] = useState<VideoShelfItem[]>([]);
  const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  // User & Auth
  const [user, setUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Config & Status
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [voxStatus, setVoxStatus] = useState<VoxcpmStatus | null>(null);
  const [engineMode, setEngineMode] = useState('local');

  // ── 2026 Core 3 Options & Features ──
  const [studioEngine, setStudioEngine] = useState<StudioEngineOption>('khmer_offline');
  // The Session page has its own inline "how to use", so the slide guide no longer pops up by itself
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const [isVideoTrimmerOpen, setIsVideoTrimmerOpen] = useState(false);
  const [isCommercialOverlayOpen, setIsCommercialOverlayOpen] = useState(false);
  const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{
    current_version: string;
    latest_version: string;
    has_update: boolean;
    force_update?: boolean;
    download_url?: string;
    patch_size_mb?: number;
    changelog?: any[];
  } | null>(null);
  const [voiceVolumeGain, setVoiceVolumeGain] = useState(100);

  const [commercialOverlayConfig, setCommercialOverlayConfig] = useState<CommercialOverlayConfig>({
    enabled: false,
    videoUrl: '',
    position: 'top-right',
    size: 'small',
    opacity: 90,
    startTime: 10,
    duration: 20,
    volume: 80,
    loop: false,
  });

  const [khmerOfflineConfig, setKhmerOfflineConfig] = useState<KhmerOfflineConfig>({
    batchEpisodes: 5,
    mode: 'episodes',
    turboThreads: 8,
    voiceId: 'hang_phleung_char_2_male.mp3',
  });

  const [customUITheme, setCustomUITheme] = useState<StudioCustomUITheme>(() => {
    try {
      const saved = localStorage.getItem('animestudio_custom_theme');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          wallpaperUrl: parsed.wallpaperUrl || DEFAULT_ANIME_WALLPAPER,
          wallpaperOpacity: parsed.wallpaperOpacity !== undefined ? parsed.wallpaperOpacity : 85,
          wallpaperBlur: parsed.wallpaperBlur || 0,
          backgroundColor: parsed.backgroundColor || '#0b0f19',
          bgMode: parsed.bgMode || 'color',
          accentColor: parsed.accentColor || 'sky',
          stickers: parsed.stickers || [],
          glassColor: parsed.glassColor || 'cyber',
          glassOpacity: parsed.glassOpacity !== undefined ? parsed.glassOpacity : 85,
          glassBlur: parsed.glassBlur !== undefined ? parsed.glassBlur : 12,
          glassBorderGlow: parsed.glassBorderGlow || 'subtle',
          backgroundPreset: parsed.backgroundPreset || 'default_dark',
          themeMode: parsed.themeMode || 'dark',
        };
      }
    } catch {}
    return {
      wallpaperUrl: DEFAULT_ANIME_WALLPAPER,
      wallpaperOpacity: 85,
      wallpaperBlur: 0,
      backgroundColor: '#0b0f19',
      bgMode: 'color',
      accentColor: 'sky',
      stickers: [],
      glassColor: 'cyber',
      glassOpacity: 85,
      glassBlur: 12,
      glassBorderGlow: 'subtle',
      backgroundPreset: 'default_dark',
      themeMode: 'dark',
    };
  });

  // 1-Click Night / Light Mode State (Defaults to Pro Studio Dark for zero eye-strain & sharp text)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const savedTheme = localStorage.getItem('animestudio_theme_mode');
      if (savedTheme) return savedTheme === 'dark';
      const customTheme = localStorage.getItem('animestudio_custom_theme');
      if (customTheme) {
        const parsed = JSON.parse(customTheme);
        return parsed.themeMode === 'dark' || parsed.backgroundPreset === 'default_dark';
      }
    } catch {}
    return true; // Default to Pro Studio Dark
  });

  // Sync document.documentElement with dark / light class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const handleToggleDarkMode = (target?: boolean) => {
    const next = target !== undefined ? target : !isDarkMode;
    setIsDarkMode(next);
    localStorage.setItem('animestudio_theme_mode', next ? 'dark' : 'light');
    if (next) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      setCustomUITheme((prev) => ({
        ...prev,
        themeMode: 'dark',
        backgroundColor: prev.bgMode === 'wallpaper' ? prev.backgroundColor : '#0b0f19',
        backgroundPreset: 'default_dark',
      }));
      showToast('🌙 បានប្តូរទៅ Night Mode (ពណ៌ងងឹតត្រជាក់ភ្នែក)', 'info');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
      setCustomUITheme((prev) => ({
        ...prev,
        themeMode: 'light',
        backgroundColor: prev.bgMode === 'wallpaper' ? prev.backgroundColor : '#f8fafc',
        backgroundPreset: 'pearl_snow',
      }));
      showToast('🥛 បានប្តូរទៅ Light Mode (ពណ៌សគុជខ្យង ស្រទន់ភ្នែក)', 'info');
    }
  };

  // Media & Dubbing
  const [uploadedFile, setUploadedFile] = useState<ProjectFile | null>(null);
  const [recentFiles, setRecentFiles] = useState<ProjectFile[]>([]);
  const [voiceMode, setVoiceMode] = useState('voice_actor_clone'); // Default: Voice Actor Library
  const [dubbingScope, setDubbingScope] = useState('120');
  const [maleLeadVoice, setMaleLeadVoice] = useState('hang_phleung_char_2_male.mp3');
  const [femaleLeadVoice, setFemaleLeadVoice] = useState('hang_phleung_char_6_female.mp3');
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash');

  // Video Upload Progress & Instant Preview
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadInfo, setUploadInfo] = useState<{ loadedMb: string; totalMb: string } | null>(null);

  const [isDubbing, setIsDubbing] = useState(false);
  const [dubbingProgress, setDubbingProgress] = useState(0);
  const [dubbingMessage, setDubbingMessage] = useState('');
  const [outputVideo, setOutputVideo] = useState<string | null>(null);
  const [outputAudio, setOutputAudio] = useState<string | null>(null);
  const [cleanBgmUrl, setCleanBgmUrl] = useState<string | null>(null);

  // Video Reference for Frame Grabbing
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbnailCapturedFrame, setThumbnailCapturedFrame] = useState<string | null>(null);

  // Video Effects & Subtitle Styling
  const [videoEffects, setVideoEffects] = useState<VideoEffects>({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    sepia: 0,
    blur: 0,
    aspectRatio: '16:9',
    lutPreset: 'none',
    letterbox: false,
    vignette: false,
    filmGrain: false,
    vhsGlitch: false,
    glowBloom: false,
    colorTint: 'none',
    watermark: {
      enabled: true,
      text: '© សម្រាយរឿង HD - ស្ដេចអាទិទេព PRO',
      position: 'top-right',
      opacity: 85,
      fontSize: 13,
      fontFamily: 'Outfit',
      textColor: '#ffffff',
      showBadge: true,
    },
    styleText: {
      enabled: false,
      title: 'សង្គ្រាមអាទិទេព',
      subtitle: 'បញ្ចូលសំឡេងខ្មែរដោយ AI Dubbing',
      badge: 'ភាគ ០១ - ចប់',
      stylePreset: 'gold3d',
      position: 'bottom-left',
      fontSize: 26,
      fontFamily: 'Koulen',
      showBanner: true,
    },
  });

  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    fontSize: 20,
    fontFamily: 'Kantumruy Pro',
    textColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.65)',
    position: 'bottom',
    animation: 'none',
  });

  // Timeline & Segments
  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [isScanningTimeline, setIsScanningTimeline] = useState(false);

  // License Guard: If user does not have key license, strictly lock engine to Option 3: Khmer Offline!
  useEffect(() => {
    const isLicensed = Boolean(user && (user.role === 'admin' || user.has_voxcpm_license));
    if (!isLicensed && studioEngine !== 'khmer_offline') {
      setStudioEngine('khmer_offline');
    }
  }, [user, studioEngine]);

  // Helper to ensure segments are sorted chronologically and never overlap with each other
  const sanitizeSegments = (segs: TimelineSegment[]): TimelineSegment[] => {
    if (!segs || segs.length === 0) return [];
    const sorted = [...segs].sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
    const cleaned: TimelineSegment[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const item = { ...sorted[i], line_index: i };
      const curStart = Math.max(0, item.start_time || 0);
      const curDur = Math.max(0.6, (item.end_time || curStart + 2.0) - curStart);

      if (cleaned.length > 0) {
        const prev = cleaned[cleaned.length - 1];
        if (curStart < prev.end_time + 0.2) {
          const newStart = Number((prev.end_time + 0.25).toFixed(2));
          item.start_time = newStart;
          item.end_time = Number((newStart + curDur).toFixed(2));
        } else {
          item.start_time = Number(curStart.toFixed(2));
          item.end_time = Number((curStart + curDur).toFixed(2));
        }
      } else {
        item.start_time = Number(curStart.toFixed(2));
        item.end_time = Number((curStart + curDur).toFixed(2));
      }
      cleaned.push(item);
    }
    return cleaned;
  };

  // Characters
  const [characters, setCharacters] = useState<CharacterVoice[]>([]);
  const [selectedCharForEdit, setSelectedCharForEdit] = useState<CharacterVoice | null>(null);
  const [selectedCharForAudition, setSelectedCharForAudition] = useState<CharacterVoice | null>(null);

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isVoxModalOpen, setIsVoxModalOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);
  const [isAddVoiceOpen, setIsAddVoiceOpen] = useState(false);
  const [isDownloaderOpen, setIsDownloaderOpen] = useState(false);
  const [isSystemStatusOpen, setIsSystemStatusOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [diskStats, setDiskStats] = useState<{ formattedSize: string; count: number } | null>(null);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const isRestoringProjectRef = useRef(true);

  // Global tactile audio feedback for options, switches, and buttons
  useEffect(() => {
    return initGlobalClickSound();
  }, []);

  // In-App Auto-Update & Version Check (Startup & Periodic polling)
  useEffect(() => {
    let isMounted = true;
    const loadVersionAndCheckUpdate = async () => {
      try {
        const v = await api.getAppVersion();
        if (isMounted && v) {
          setVersionInfo(v);
        }
        // Active check from remote GitHub / Supabase / Cloud
        const remoteCheck = await api.checkUpdate().catch(() => null);
        if (isMounted && remoteCheck && remoteCheck.latest_version) {
          setVersionInfo((prev: any) => ({
            ...(prev || {}),
            ...remoteCheck,
          }));
        }
      } catch (err) {
        console.error('Failed to load version:', err);
      }
    };

    loadVersionAndCheckUpdate();
    // Poll every 15 minutes for new versions
    const interval = setInterval(loadVersionAndCheckUpdate, 15 * 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Global hotkeys for studio speed
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      } else if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsExportOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, []);

  // Toast Helper with deduplication & max queue protection
  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setToasts((prev) => {
      // Don't append if the exact message is already in recent toasts (prevents polling spam)
      if (prev.some((t) => t.message === message)) {
        return prev;
      }
      const id = `${Date.now()}-${Math.random()}`;
      return [...prev.slice(-4), { id, message, type }];
    });
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Save Project State (localStorage + backend disk file)
  const saveProjectToStorage = async (isManual = false) => {
    try {
      if (isManual) setIsSavingProject(true);
      const projectPayload = {
        timestamp: Date.now(),
        uploadedFile,
        segments,
        outputVideo,
        outputAudio,
        cleanBgmUrl,
        voiceMode,
        dubbingScope,
        maleLeadVoice,
        femaleLeadVoice,
        geminiModel,
        videoEffects,
        subtitleStyle,
        activeTab,
        activeGroupId,
      };

      // 1. Instant client-side persistence
      localStorage.setItem('CHEATAZ_DABBER_PROJECT_STATE', JSON.stringify(projectPayload));

      // 2. Persistent backend storage
      await api.saveProject(projectPayload).catch(() => {});

      if (isManual) {
        showToast('💾 បានរក្សាទុកទិន្នន័យគម្រោងជោគជ័យ! (Refresh មិនបាត់បង់)', 'success');
      }
    } catch (err) {
      if (isManual) {
        showToast('⚠️ ការរក្សាទុកមានបញ្ហាខ្លះ ប៉ុន្តែទិន្នន័យក្នុង Browser ត្រូវបានរក្សាទុក', 'warning');
      }
    } finally {
      if (isManual) {
        setTimeout(() => setIsSavingProject(false), 500);
      }
    }
  };

  // Restore Project State from localStorage / backend on page refresh
  const restoreSavedProject = async () => {
    try {
      let savedData: any = null;

      // Check local storage first
      const localStr = localStorage.getItem('CHEATAZ_DABBER_PROJECT_STATE');
      if (localStr) {
        try {
          savedData = JSON.parse(localStr);
        } catch (_) {}
      }

      // Check server if not in localStorage or to compare
      if (!savedData) {
        const remote = await api.loadProject().catch(() => null);
        if (remote && remote.project) {
          savedData = remote.project;
        }
      }

      if (savedData) {
        // Restore uploaded file (reconstruct playable URL if it was an uploaded file)
        if (savedData.uploadedFile) {
          const uf = { ...savedData.uploadedFile };
          uf.url = `/media/uploads/${uf.filename}`;
          setUploadedFile(uf);
        }

        if (Array.isArray(savedData.segments) && savedData.segments.length > 0) {
          setSegments(savedData.segments);
        }

        if (savedData.outputVideo) setOutputVideo(savedData.outputVideo);
        if (savedData.outputAudio) setOutputAudio(savedData.outputAudio);
        if (savedData.cleanBgmUrl) setCleanBgmUrl(savedData.cleanBgmUrl);
        if (savedData.voiceMode) setVoiceMode(savedData.voiceMode);
        if (savedData.dubbingScope) setDubbingScope(savedData.dubbingScope);
        if (savedData.maleLeadVoice) setMaleLeadVoice(savedData.maleLeadVoice);
        if (savedData.femaleLeadVoice) setFemaleLeadVoice(savedData.femaleLeadVoice);
        if (savedData.geminiModel) setGeminiModel(savedData.geminiModel);
        if (savedData.videoEffects) setVideoEffects(savedData.videoEffects);
        if (savedData.subtitleStyle) setSubtitleStyle(savedData.subtitleStyle);
        if (savedData.activeTab) {
          // Show the new Session page once after updating, then respect the saved tab again
          let introSeen = false;
          try {
            introSeen = localStorage.getItem('cs_session_intro_seen') === '1';
            localStorage.setItem('cs_session_intro_seen', '1');
          } catch {}
          setActiveTab(introSeen ? savedData.activeTab : 'tab-session');
        }
        if (savedData.activeGroupId) setActiveGroupId(savedData.activeGroupId);

        showToast('🔄 បានស្ដារទិន្នន័យគម្រោងមុនរួចរាល់ (Project Restored)', 'info');
      }
    } catch (e) {
      console.error('Error restoring project:', e);
    } finally {
      // Small delay before enabling auto-save to avoid overwriting with initial state
      setTimeout(() => {
        isRestoringProjectRef.current = false;
      }, 1000);
    }
  };

  // Initial Data Fetch & Project Restore
  useEffect(() => {
    // 1. Auth Check
    api
      .getMe()
      .then((res) => {
        if (res.user) setUser(res.user);
        else setIsAuthModalOpen(true);
      })
      .catch(() => setIsAuthModalOpen(true));

    // 2. Config & Status
    loadConfigAndStatus();

    // 3. Characters
    loadCharacters();

    // 4. File Library
    loadFiles();

    // 5. Disk Stats
    api.getOutputStats().then(setDiskStats).catch(() => {});

    // 6. Video Shelf & Project Groups
    loadShelfAndGroups();

    // 7. Auto-Restore Project Data (No data loss on refresh)
    restoreSavedProject();

    // 8. Software Version & In-App Auto Update Check
    api
      .getAppVersion()
      .then((v) => {
        if (v) {
          setVersionInfo(v);
        }
      })
      .catch(() => {});
  }, []);

  const loadShelfAndGroups = async () => {
    try {
      const [shelfRes, groupsRes] = await Promise.all([
        api.getVideoShelf(),
        api.getProjectGroups(),
      ]);
      if (shelfRes.success && shelfRes.shelf) {
        setShelfItems(shelfRes.shelf);
      }
      if (groupsRes.success && groupsRes.groups) {
        setProjectGroups(groupsRes.groups);
      }
    } catch (err) {
      console.error('Error loading shelf or groups:', err);
    }
  };

  const handleLoadFromShelf = (item: VideoShelfItem) => {
    const displayName = item.title || item.originalName || item.filename;
    const projectFile: ProjectFile = {
      filename: item.filename,
      originalName: displayName,
      size: item.size || 0,
      type: 'video',
      url: item.url,
    };
    setUploadedFile(projectFile);
    if (item.groupId) {
      setActiveGroupId(item.groupId);
    }
    setActiveTab('tab-dubbing');
    setIsShelfOpen(false);
    showToast(`បានទាញយកវីដេអូ "${displayName}" ពីឃ្លាំងចូលស្ទូឌីយោ!`, 'success');
  };

  // Debounced Auto-save when segments, media or settings change
  useEffect(() => {
    if (isRestoringProjectRef.current) return;
    if (!uploadedFile && segments.length === 0) return;

    const timer = setTimeout(() => {
      saveProjectToStorage(false);
    }, 1200);

    return () => clearTimeout(timer);
  }, [
    uploadedFile,
    segments,
    outputVideo,
    outputAudio,
    cleanBgmUrl,
    voiceMode,
    dubbingScope,
    maleLeadVoice,
    femaleLeadVoice,
    geminiModel,
    videoEffects,
    subtitleStyle,
    activeTab,
  ]);

  // Studio Professional Keyboard Shortcuts (Space, Ctrl+S, Ctrl+Z, M, F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectToStorage(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          showToast('បានត្រឡប់ក្រោយ (Undo)', 'info');
        }
        return;
      }

      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
        if (!isInput) {
          e.preventDefault();
          showToast('បានធ្វើឡើងវិញ (Redo)', 'info');
        }
        return;
      }

      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        if (videoRef.current) {
          if (videoRef.current.paused) videoRef.current.play();
          else videoRef.current.pause();
        }
        return;
      }

      if (e.key.toLowerCase() === 'm' && !isInput && !e.ctrlKey && !e.metaKey) {
        if (videoRef.current) {
          videoRef.current.muted = !videoRef.current.muted;
          showToast(videoRef.current.muted ? '🔇 បានបិទសំឡេង (Muted)' : '🔊 បានបើកសំឡេង (Unmuted)', 'info');
        }
        return;
      }

      if (e.key.toLowerCase() === 'f' && !isInput && !e.ctrlKey && !e.metaKey) {
        if (videoRef.current) {
          if (!document.fullscreenElement) {
            videoRef.current.parentElement?.requestFullscreen?.();
          } else {
            document.exitFullscreen?.();
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadConfigAndStatus = async () => {
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
      setEngineMode(cfg.mode || 'local');
      if (cfg.geminiModel) setGeminiModel(cfg.geminiModel);
    } catch (_) {}

    try {
      const st = await api.getVoxcpmStatus();
      setVoxStatus(st);
    } catch (_) {}
  };

  const loadCharacters = async () => {
    try {
      const res = await api.getCharacters();
      if (res.characters) {
        setCharacters(res.characters);
      }
    } catch (_) {}
  };

  const loadFiles = async () => {
    try {
      const files = await api.getFiles();
      setRecentFiles(files);
      if (!uploadedFile && files.length > 0) {
        const video = files.find((f) => f.type === 'video');
        if (video) setUploadedFile(video);
      }
    } catch (_) {}
  };

  const handleUploadFile = async (file: File) => {
    // 0. Reset previous video's dubbed output and old segments immediately
    setOutputVideo(null);
    setOutputAudio(null);
    setCleanBgmUrl(null);
    setSegments([]);

    // 1. Instant Zero-Wait Local Preview (0.01s instant loading)
    const localBlobUrl = URL.createObjectURL(file);
    const instantFile: ProjectFile = {
      filename: file.name,
      originalName: file.name,
      size: file.size,
      type: file.type.startsWith('audio') ? 'audio' : 'video',
      url: localBlobUrl,
    };
    setUploadedFile(instantFile);
    setIsUploadingFile(true);
    setUploadProgress(0);
    setUploadInfo({
      loadedMb: '0.0',
      totalMb: (file.size / (1024 * 1024)).toFixed(1),
    });
    showToast(`⚡ បានផ្ទុកវីដេអូលើអេក្រង់ភ្លាមៗ! កំពុងរក្សាទុកក្នុង Server...`, 'info');

    try {
      localStorage.removeItem('CHEATAZ_DABBER_PROJECT_STATE');
    } catch (_) {}

    try {
      const res = await api.uploadFile(file, (percent, loaded, total) => {
        setUploadProgress(percent);
        setUploadInfo({
          loadedMb: (loaded / (1024 * 1024)).toFixed(1),
          totalMb: (total / (1024 * 1024)).toFixed(1),
        });
      });

      if (res.success && res.file) {
        // Ensure playable URL points directly to server static mount
        const verifiedFile = {
          ...res.file,
          url: res.url || res.file.url || `/media/uploads/${res.file.filename}`,
        };
        setUploadedFile(verifiedFile);
        setOutputVideo(null);
        setOutputAudio(null);
        setRecentFiles((prev) => [verifiedFile, ...prev.filter((f) => f.filename !== verifiedFile.filename)]);
        setIsUploadingFile(false);
        showToast(`🎉 វីដេអូ "${file.name}" បាន Upload ជោគជ័យ 100%! ចុច "Start Dubbing" ដើម្បីចាប់ផ្តើម`, 'success');
      }
    } catch (err: any) {
      setIsUploadingFile(false);
      showToast(`បរាជ័យក្នុងការ Upload: ${err.message}`, 'error');
    }
  };

  const handleStartDubbing = async () => {
    if (!uploadedFile) {
      showToast('⚠️ សូមបញ្ចូល ឬ Upload វីដេអូជាមុនសិន!', 'warning');
      return;
    }

    if (isUploadingFile) {
      showToast('⚡ វីដេអូកំពុងផ្ញើចូល Server សូមរង់ចាំឱ្យពេញ ១០០% សិន (ប្រហែលប៉ុន្មានវិនាទី)...', 'warning');
      return;
    }

    setIsDubbing(true);
    setDubbingProgress(10);
    setDubbingMessage('🚀 កំពុងដំណើរការ AI Dubbing ស្រង់សំឡេង និងតួអង្គក្នុងរឿង...');
    showToast('🚀 កំពុងដំណើរការ AI Dubbing វីដេអូ សូមរង់ចាំបន្តិច...', 'info');

    // Collect 1:1 character voice mappings + emotion data from current timeline segments
    const characterVoiceMap: Record<string, string> = {};
    const emotionData: Record<string, any> = {};
    
    segments.forEach((s) => {
      const charKey = s.speaker_name || s.speaker_id;
      if (charKey && s.voiceId) {
        characterVoiceMap[charKey] = s.voiceId;
        if (s.speaker_id) characterVoiceMap[s.speaker_id] = s.voiceId;
      }
      
      // Include emotion parameters if present
      if (s.emotion) {
        const segmentKey = `${s.start_time}-${s.end_time}`;
        emotionData[segmentKey] = {
          emotion: s.emotion,
          emotionIntensity: s.emotionIntensity,
          emotionParams: s.emotionParams,
        };
      }
    });

    try {
      const res = await api.startDubbing({
        filename: uploadedFile.filename,
        sourceLang: 'zh',
        targetLang: 'km',
        voiceId: voiceMode,
        scope: dubbingScope,
        characterVoiceMap,
        emotionData, // 🎭 Send emotion data to backend
        maleLeadVoice,
        femaleLeadVoice,
        geminiModel,
        segments: segments && segments.length > 0 ? segments : undefined,
      });

      if (res.jobId) {
        pollDubbingJob(res.jobId);
      }
    } catch (err: any) {
      setIsDubbing(false);
      showToast(`បរាជ័យក្នុងការ Dubbing: ${err.message}`, 'error');
    }
  };

  const pollDubbingJob = (jobId: string) => {
    let finished = false;
    const interval = setInterval(async () => {
      if (finished) {
        clearInterval(interval);
        return;
      }
      try {
        const job = await api.getDubbingStatus(jobId);
        setDubbingProgress(job.progress || 0);
        setDubbingMessage(job.message || 'កំពុងដំណើរការ...');

        if (job.status === 'completed') {
          finished = true;
          clearInterval(interval);
          setIsDubbing(false);
          setOutputVideo(job.outputVideo || null);
          setOutputAudio(job.outputAudio || null);
          if (job.dialogueSegments && job.dialogueSegments.length > 0) {
            setSegments(sanitizeSegments(job.dialogueSegments));
          }
          showToast('ការបញ្ជូលសំឡេងជោគជ័យ 100%!', 'success');
          loadFiles();
        } else if (job.status === 'failed') {
          finished = true;
          clearInterval(interval);
          setIsDubbing(false);
          showToast(`បរាជ័យ: ${job.error || 'កំហុសបច្ចេកទេស'}`, 'error');
        }
      } catch (_) {}
    }, 1500);
  };

  const handleScanTimeline = async () => {
    if (!uploadedFile) {
      showToast('សូមបញ្ចូល ឬ Upload វីដេអូក្នុង Studio ជាមុនសិន!', 'warning');
      return;
    }

    setIsScanningTimeline(true);
    showToast('AI Gemini កំពុងស្កេន និងស្រង់ឃ្លាសន្ទនារឿង...', 'info');
    try {
      // 180s scope for fast, responsive dialogue extraction without hitting Gemini backoffs
      const res = await api.scanTimeline(uploadedFile.filename, '180', voiceMode);
      if (res.success && res.segments && res.segments.length > 0) {
        setSegments(sanitizeSegments(res.segments));
        showToast(`ស្កេនជោគជ័យ! រកឃើញ ${res.segments.length} ឃ្លាសន្ទនាក្នុងរឿង`, 'success');
      } else {
        showToast('មិនឃើញឃ្លាសន្ទនាក្នុងឈុតនេះឡើយ!', 'info');
      }
    } catch (e: any) {
      showToast(`កំហុសក្នុងការស្កេន: ${e.message}`, 'error');
    } finally {
      setIsScanningTimeline(false);
    }
  };

  const handleAssemble = async () => {
    if (!uploadedFile) {
      showToast('⚠️ សូមបញ្ចូលវីដេអូជាមុនសិន!', 'warning');
      return;
    }
    if (!segments || segments.length === 0) {
      showToast('⚠️ មិនទាន់មានឃ្លាសន្ទនាសម្រាប់បញ្ចូលសំឡេងឡើយ!', 'warning');
      return;
    }

    setIsDubbing(true);
    setDubbingProgress(20);
    setDubbingMessage(`🎬 កំពុង Generate វីដេអូតាមសំឡេងតួអង្គ (${segments.length} ឃ្លា)...`);
    showToast(`🎬 កំពុង Generate វីដេអូតាមសំឡេងតួអង្គដែលបានរើស (${segments.length} ឃ្លា)...`, 'info');

    try {
      const res = await api.assembleCustom({
        filename: uploadedFile.filename,
        segments,
        bgmAudio: cleanBgmUrl || undefined,
        removeOriginalVocals: true, // Auto strips original Chinese vocals!
      });
      if (res.success) {
        setOutputVideo(res.outputVideo);
        if (res.outputAudio) setOutputAudio(res.outputAudio);
        setIsDubbing(false);
        setDubbingProgress(100);
        showToast('🎉 បាន Generate វីដេអូតាមសំឡេងតួអង្គសម្រេចដោយជោគជ័យ ១០០%!', 'success');
        setActiveTab('tab-dubbing');
      } else {
        setIsDubbing(false);
        showToast('ការបង្កើតវីដេអូមិនទាន់ជោគជ័យ', 'error');
      }
    } catch (e: any) {
      setIsDubbing(false);
      showToast(`កំហុសក្នុងការ Generate វីដេអូ: ${e.message}`, 'error');
    }
  };

  const handleDeleteProject = async (file: ProjectFile) => {
    if (!window.confirm(`តើអ្នកពិតជាចង់លុបគម្រោង "${file.originalName || file.filename}" ចោលមែនទេ?`)) {
      return;
    }
    showToast(`កំពុងលុបគម្រោង "${file.filename}"...`, 'info');
    try {
      const res = await api.deleteFile(file.filename);
      if (res.success) {
        setRecentFiles((prev) => prev.filter((f) => f.filename !== file.filename));
        if (uploadedFile?.filename === file.filename) {
          setUploadedFile(null);
        }
        showToast(res.message || 'បានលុបគម្រោងដោយជោគជ័យ!', 'success');
        api.getOutputStats().then(setDiskStats).catch(() => {});
      }
    } catch (err: any) {
      showToast(`កំហុសក្នុងការលុប: ${err.message}`, 'error');
    }
  };

  const handleClearAllProjects = async () => {
    if (!window.confirm(`តើអ្នកពិតជាចង់លុបគម្រោងទាំងអស់ (${recentFiles.length} គម្រោង) ចោលមែនទេ? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានឡើយ!`)) {
      return;
    }
    showToast('កំពុងលុបគម្រោងទាំងអស់...', 'info');
    try {
      const res = await api.clearAllFiles();
      if (res.success) {
        setRecentFiles([]);
        setUploadedFile(null);
        showToast(res.message || 'បានលុបគម្រោងទាំងអស់ដោយជោគជ័យ!', 'success');
        api.getOutputStats().then(setDiskStats).catch(() => {});
      }
    } catch (err: any) {
      showToast(`កំហុសក្នុងការលុប: ${err.message}`, 'error');
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    localStorage.removeItem('studio_auth_token');
    setUser(null);
    setIsAuthModalOpen(true);
  };

  const handleOpenThumbnailStudio = () => {
    if (videoRef.current && videoRef.current.videoWidth > 0) {
      try {
        const v = videoRef.current;
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 1280;
        c.height = v.videoHeight || 720;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const data = c.toDataURL('image/jpeg', 0.95);
          setThumbnailCapturedFrame(data);
        }
      } catch (e) {
        console.warn('Frame grab error:', e);
      }
    }
    setActiveTab('tab-thumbnail');
  };

  const handleSwitchEngine = async (m: string) => {
    setEngineMode(m);
    await api.switchMode(m).catch(() => {});
    loadConfigAndStatus();
    showToast(
      m === 'cloud'
        ? '⚡ បានបើក RUN VOXCPM2: ONLINE MODE (Cloud GPU)'
        : '💻 បានប្ដូរទៅ RUN VOXCPM2: COMPUTER MODE (Local Machine)',
      'success'
    );
  };

  // ── CapCut Style Video Trim ──
  const handleApplyTrim = (inTime: number, outTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = inTime;
    }
    if (segments.length > 0) {
      const filtered = segments.filter(
        (s) => s.end_time >= inTime && s.start_time <= outTime
      );
      if (filtered.length > 0) {
        setSegments(filtered);
      }
    }
    showToast(`✂️ បានកាត់វីដេអូចន្លោះ ${inTime.toFixed(1)}s ដល់ ${outTime.toFixed(1)}s ជោគជ័យ!`, 'success');
  };

  // ── Option 3: Khmer Offline Dubbing ──
  const handleStartOfflineDubbing = async () => {
    const selectedEps = (khmerOfflineConfig.episodes || []).filter((e) => e.isSelected);
    let targetFilename = uploadedFile?.filename;
    if (!targetFilename && selectedEps.length > 0) {
      targetFilename = selectedEps[0].filename;
      if (!uploadedFile) {
        setUploadedFile({
          id: selectedEps[0].id,
          filename: selectedEps[0].filename,
          originalName: selectedEps[0].title,
          url: selectedEps[0].url || `/media/uploads/${selectedEps[0].filename}`,
          size: (selectedEps[0].sizeMb || 150) * 1024 * 1024,
          type: 'video',
          duration: 1440,
          uploadedAt: new Date().toISOString(),
        });
      }
    }

    if (!targetFilename) {
      showToast('⚠️ សូមជ្រើសរើស ឬ SELECT វីដេអូយ៉ាងហោចណាស់ ១ ភាគជាមុនសិន!', 'warning');
      return;
    }

    const targetEpCount = selectedEps.length > 0 ? selectedEps.length : khmerOfflineConfig.batchEpisodes;
    setIsDubbing(true);
    setDubbingProgress(15);
    setDubbingMessage(`⚡ កំពុងដំណើរការ KHMER OFFLINE (ចំនួន ${targetEpCount} ភាគ ${khmerOfflineConfig.mode === 'full_movie' ? '• រឿងពេញ' : ''})...`);
    showToast(`⚡ កំពុងដំណើរការ KHMER OFFLINE ល្បឿនលឿន Multi-thread (${khmerOfflineConfig.turboThreads}x)...`, 'info');

    try {
      const res = await api.assembleCustom({
        filename: targetFilename,
        segments: segments.length > 0 ? segments : DEFAULT_PRESET_TIMELINE_SEGMENTS,
        bgmAudio: cleanBgmUrl || undefined,
        removeOriginalVocals: true,
      });

      if (res.success) {
        setOutputVideo(res.outputVideo);
        if (res.outputAudio) setOutputAudio(res.outputAudio);
        setIsDubbing(false);
        setDubbingProgress(100);
        showToast(`🎉 បានបញ្ចប់ KHMER OFFLINE ${targetEpCount} ភាគជោគជ័យ!`, 'success');
        setActiveTab('tab-dubbing');
      } else {
        setIsDubbing(false);
        showToast('ការបង្កើតមិនទាន់ជោគជ័យ', 'error');
      }
    } catch (e: any) {
      setIsDubbing(false);
      showToast(`កំហុស: ${e.message}`, 'error');
    }
  };

  const glassColorPresets: Record<string, { tint: string; border: string; glow: string; accent: string }> = {
    cyan: { tint: 'rgba(6, 182, 212, 0.10)', border: 'rgba(6, 182, 212, 0.3)', glow: '0 0 35px rgba(6, 182, 212, 0.2)', accent: '#06b6d4' },
    purple: { tint: 'rgba(168, 85, 247, 0.10)', border: 'rgba(168, 85, 247, 0.3)', glow: '0 0 35px rgba(168, 85, 247, 0.2)', accent: '#a855f7' },
    amber: { tint: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.3)', glow: '0 0 35px rgba(245, 158, 11, 0.2)', accent: '#f59e0b' },
    emerald: { tint: 'rgba(16, 185, 129, 0.10)', border: 'rgba(16, 185, 129, 0.3)', glow: '0 0 35px rgba(16, 185, 129, 0.2)', accent: '#10b981' },
    ice: { tint: 'rgba(56, 189, 248, 0.10)', border: 'rgba(56, 189, 248, 0.3)', glow: '0 0 35px rgba(56, 189, 248, 0.2)', accent: '#38bdf8' },
    obsidian: { tint: 'rgba(15, 23, 42, 0.40)', border: 'rgba(255, 255, 255, 0.1)', glow: '0 0 35px rgba(0, 0, 0, 0.6)', accent: '#64748b' },
    crimson: { tint: 'rgba(239, 68, 68, 0.10)', border: 'rgba(239, 68, 68, 0.3)', glow: '0 0 35px rgba(239, 68, 68, 0.2)', accent: '#ef4444' },
    sakura: { tint: 'rgba(244, 114, 182, 0.10)', border: 'rgba(244, 114, 182, 0.3)', glow: '0 0 35px rgba(244, 114, 182, 0.2)', accent: '#f472b6' },
  };

  const activeGlass = glassColorPresets[customUITheme.glassColor || 'cyan'] || glassColorPresets.cyan;

  return (
    <div
      className={`flex flex-col h-screen w-screen overflow-hidden ${isDarkMode ? 'text-slate-100 bg-[#0b0f19]' : 'text-slate-900 bg-[#f8fafc]'} font-khmer studio-enter relative transition-colors duration-300`}
      style={{
        background: customUITheme.bgMode === 'wallpaper' && customUITheme.wallpaperUrl
          ? undefined
          : (customUITheme.backgroundColor || (isDarkMode ? '#0b0f19' : '#f8fafc')),
        ...(customUITheme.bgMode === 'wallpaper' && customUITheme.wallpaperUrl
          ? {
              backgroundImage: `linear-gradient(rgba(${isDarkMode ? '11,15,25' : '248,250,252'},${Math.max(0, (1 - (customUITheme.wallpaperOpacity || 85) / 100)).toFixed(2)}), rgba(${isDarkMode ? '11,15,25' : '248,250,252'},${Math.max(0, (1 - (customUITheme.wallpaperOpacity || 85) / 100)).toFixed(2)})), url("${customUITheme.wallpaperUrl}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundAttachment: 'fixed',
            }
          : {}),
        backdropFilter: customUITheme.wallpaperBlur ? `blur(${customUITheme.wallpaperBlur}px)` : undefined,
      }}
    >
      {/* Dynamic Ambient Color Glass Lighting */}
      {customUITheme.glassColor && customUITheme.glassColor !== 'obsidian' && (
        <div
          className="absolute inset-0 pointer-events-none z-[1] transition-all duration-700"
          style={{
            background: `radial-gradient(ellipse at 50% -15%, ${activeGlass.tint}, transparent 65%), radial-gradient(ellipse at 100% 100%, ${activeGlass.tint}, transparent 55%)`,
          }}
        />
      )}
      {/* Custom UI Floating Stickers */}
      {customUITheme.stickers.map((st) => (
        <div
          key={st.id}
          className="absolute z-30 pointer-events-none select-none text-3xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
          style={{
            left: `${st.x}%`,
            top: `${st.y}%`,
            transform: `scale(${st.scale}) rotate(${st.rotation}deg)`,
          }}
        >
          {st.url}
        </div>
      ))}

      {/* Header Bar */}
      <Header
        activeProjectTitle={uploadedFile?.originalName || uploadedFile?.filename || 'Perfect World EP145.mp4'}
        isSaving={isSavingProject}
        user={user}
        onLogout={handleLogout}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onSaveProject={() => saveProjectToStorage(true)}
        onUndo={() => showToast('បានត្រឡប់ក្រោយ (Undo)', 'info')}
        onRedo={() => showToast('បានធ្វើឡើងវិញ (Redo)', 'info')}
        onPreview={() => {
          if (videoRef.current) {
            if (videoRef.current.paused) videoRef.current.play();
            else videoRef.current.pause();
          }
        }}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
        engineMode={engineMode}
        onSwitchEngine={handleSwitchEngine}
        voxStatus={voxStatus}
        onOpenVoxModal={() => setIsVoxModalOpen(true)}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onOpenDownloader={() => setIsDownloaderOpen(true)}
        onOpenThumbnailStudio={handleOpenThumbnailStudio}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        videoCount={recentFiles.length}
        isDubbing={isDubbing}
        dubbingProgress={dubbingProgress}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        projectGroups={projectGroups}
        activeGroupId={activeGroupId}
        onSelectGroup={setActiveGroupId}
        onOpenGroupManager={() => setIsGroupManagerOpen(true)}
        shelfCount={shelfItems.length}
        onOpenShelf={() => setIsShelfOpen(true)}
        onOpenHardwareTurbo={showAdvancedTools ? () => setIsHardwareTurboOpen(true) : undefined}
        onOpenGuide={() => setIsGuideOpen(true)}
        onOpenCustomizer={() => setIsCustomizerOpen(true)}
        onOpenUpdateModal={() => setIsUpdateModalOpen(true)}
        hasUpdateAvailable={Boolean(versionInfo?.has_update && versionInfo?.current_version !== versionInfo?.latest_version)}
        latestVersion={versionInfo?.latest_version || 'V2.1PRO'}
        currentVersion={versionInfo?.current_version || 'V2.1PRO'}
        isDarkMode={isDarkMode}
        onToggleDarkMode={handleToggleDarkMode}
        bgMode={customUITheme.bgMode || 'color'}
        onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onNewProject={() => {
            if (segments.length > 0 || uploadedFile) {
              if (!window.confirm('តើអ្នកពិតជាចង់បង្កើតគម្រោងថ្មីមែនទេ? ទិន្នន័យចាស់នឹងត្រូវជម្រះចេញ។')) {
                return;
              }
            }
            setUploadedFile(null);
            setSegments([]);
            setOutputVideo(null);
            setOutputAudio(null);
            localStorage.removeItem('CHEATAZ_DABBER_PROJECT_STATE');
            api.clearProject().catch(() => {});
            setActiveTab('tab-session');
            showToast('✨ បានបង្កើតគម្រោងថ្មីរួចរាល់', 'info');
          }}
          onOpenExport={() => setIsExportOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenSystemStatus={() => setIsSystemStatusOpen(true)}
          isSystemOnline={Boolean(voxStatus && (voxStatus.online || voxStatus.configured))}
          user={user}
          shelfCount={shelfItems.length}
          onOpenShelf={() => setIsShelfOpen(true)}
          onOpenGroups={() => setIsGroupManagerOpen(true)}
          onOpenHardwareTurbo={() => setIsHardwareTurboOpen(true)}
          onOpenCustomizer={() => setIsCustomizerOpen(true)}
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
          showAdvancedTools={showAdvancedTools}
          onToggleAdvancedTools={() => {
            const next = !showAdvancedTools;
            setShowAdvancedTools(next);
            try {
              localStorage.setItem('studio_show_advanced_tools', next ? '1' : '0');
            } catch {}
            if (!next && (activeTab === 'tab-offline' || activeTab === 'tab-manual')) setActiveTab('tab-session');
          }}
        />

        {/* Dynamic Studio Views */}
        <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
          {activeTab === 'tab-session' && (
            <VoiceCloneSession
              uploadedFile={uploadedFile}
              isUploadingFile={isUploadingFile}
              uploadProgress={uploadProgress}
              onUploadFile={handleUploadFile}
              segments={segments}
              setSegments={setSegments}
              onScanTimeline={handleScanTimeline}
              isScanningTimeline={isScanningTimeline}
              libraryVoices={characters}
              user={user}
              voxStatus={voxStatus}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
              onOpenVoxModal={() => setIsVoxModalOpen(true)}
              onOpenAdvancedStudio={() => setActiveTab('tab-dubbing')}
              cleanBgmUrl={cleanBgmUrl}
              outputVideo={outputVideo}
              outputAudio={outputAudio}
              onOutputReady={(video, audio) => {
                setOutputVideo(video);
                if (audio) setOutputAudio(audio);
                loadFiles();
              }}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'tab-dashboard' && (
            <DashboardView
              files={recentFiles}
              totalVoices={characters.length}
              voxStatus={voxStatus}
              diskStats={diskStats}
              onNewProject={() => {
                if (segments.length > 0 || uploadedFile) {
                  if (!window.confirm('តើអ្នកពិតជាចង់បង្កើតគម្រោងថ្មីមែនទេ? ទិន្នន័យចាស់នឹងត្រូវជម្រះចេញ។')) {
                    return;
                  }
                }
                setUploadedFile(null);
                setSegments([]);
                setOutputVideo(null);
                setOutputAudio(null);
                localStorage.removeItem('CHEATAZ_DABBER_PROJECT_STATE');
                api.clearProject().catch(() => {});
                setActiveTab('tab-session');
                showToast('✨ បានបង្កើតគម្រោងថ្មីរួចរាល់', 'info');
              }}
              onOpenStudio={() => setActiveTab('tab-session')}
              onSelectProject={(f) => {
                setUploadedFile(f);
                setOutputVideo(null);
                setOutputAudio(null);
                setCleanBgmUrl(null);
                setSegments([]);
                setActiveTab('tab-session');
              }}
              onRefresh={loadFiles}
              onDeleteProject={handleDeleteProject}
              onClearAllProjects={handleClearAllProjects}
            />
          )}

          {/* 6-Step Workflow View */}
          {activeTab === 'tab-workflow' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden tab-content-enter">
              <WorkflowView
                uploadedFile={uploadedFile}
                onUploadFile={handleUploadFile}
                onRemoveFile={() => {
                  setUploadedFile(null);
                  setOutputVideo(null);
                  setOutputAudio(null);
                  setCleanBgmUrl(null);
                  setSegments([]);
                }}
                isUploadingFile={isUploadingFile}
                uploadProgress={uploadProgress}
                uploadInfo={uploadInfo}
                voiceMode={voiceMode}
                onVoiceModeChange={setVoiceMode}
                dubbingScope={dubbingScope}
                onDubbingScopeChange={setDubbingScope}
                geminiModel={geminiModel}
                onGeminiModelChange={setGeminiModel}
                isDubbing={isDubbing}
                dubbingProgress={dubbingProgress}
                dubbingMessage={dubbingMessage}
                dubbingOutputVideo={outputVideo}
                dubbingOutputAudio={outputAudio}
                onStartDubbing={handleStartDubbing}
                segments={segments}
                onChangeSegments={setSegments}
                characters={characters}
                onPreviewVoice={(filename) => {
                  const a = new Audio(`/media/samples/${filename}`);
                  a.play().catch(() => {});
                }}
                onScanTimeline={handleScanTimeline}
                isScanningTimeline={isScanningTimeline}
                onShowToast={showToast}
                onOpenExportModal={() => setIsExportOpen(true)}
                onOpenStudioMode={() => setActiveTab('tab-dubbing')}
                engineMode={engineMode}
                onSwitchEngine={handleSwitchEngine}
                voxStatus={voxStatus}
                onOpenVoxModal={() => setIsVoxModalOpen(true)}
                user={user}
                onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
              />
            </div>
          )}

          {/* Persistent Dubbing Studio so Video DOM is never destroyed when switching tabs */}
          <div className={activeTab === 'tab-dubbing' ? 'flex-1 flex flex-col h-full overflow-hidden' : 'hidden'}>
            <DubbingStudio
              uploadedFile={uploadedFile}
              isUploadingFile={isUploadingFile}
              uploadProgress={uploadProgress}
              uploadInfo={uploadInfo}
              onUploadFile={handleUploadFile}
              onRemoveFile={() => {
                setUploadedFile(null);
                setOutputVideo(null);
                setOutputAudio(null);
                setCleanBgmUrl(null);
                setSegments([]);
              }}
              voiceMode={voiceMode}
              onVoiceModeChange={setVoiceMode}
              dubbingScope={dubbingScope}
              onDubbingScopeChange={setDubbingScope}
              maleLeadVoice={maleLeadVoice}
              onMaleLeadChange={setMaleLeadVoice}
              femaleLeadVoice={femaleLeadVoice}
              onFemaleLeadChange={setFemaleLeadVoice}
              geminiModel={geminiModel}
              onGeminiModelChange={setGeminiModel}
              isDubbing={isDubbing}
              dubbingProgress={dubbingProgress}
              dubbingMessage={dubbingMessage}
              dubbingOutputVideo={outputVideo}
              dubbingOutputAudio={outputAudio}
              onStartDubbing={handleStartDubbing}
              onPreviewVoice={(filename) => {
                const a = new Audio(`/media/samples/${filename}`);
                a.play().catch(() => {});
              }}
              segments={segments}
              onChangeSegments={setSegments}
              selectedSegmentIndex={selectedSegmentIndex}
              onSelectSegment={setSelectedSegmentIndex}
              onScanTimeline={handleScanTimeline}
              isScanningTimeline={isScanningTimeline}
              onAssemble={handleAssemble}
              videoEffects={videoEffects}
              onChangeEffects={setVideoEffects}
              subtitleStyle={subtitleStyle}
              onChangeSubtitleStyle={setSubtitleStyle}
              videoRef={videoRef}
              onOpenThumbnailStudio={handleOpenThumbnailStudio}
              onShowToast={showToast}
              characters={characters}
              onOpenTab={setActiveTab}
              onOpenExport={() => setIsExportOpen(true)}
              engineMode={engineMode}
              onSwitchEngine={handleSwitchEngine}
              voxStatus={voxStatus}
              onOpenVoxModal={() => setIsVoxModalOpen(true)}
              user={user}
              onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
              studioEngine={studioEngine}
              onSelectStudioEngine={setStudioEngine}
              commercialOverlay={commercialOverlayConfig}
              onOpenCommercialOverlay={() => setIsCommercialOverlayOpen(true)}
              onOpenVideoTrimmer={() => setIsVideoTrimmerOpen(true)}
              voiceVolumeGain={voiceVolumeGain}
              onChangeVoiceVolumeGain={setVoiceVolumeGain}
              khmerOfflineConfig={khmerOfflineConfig}
              onChangeKhmerOfflineConfig={setKhmerOfflineConfig}
              onStartOfflineDubbing={handleStartOfflineDubbing}
              onOpenGuide={() => setIsGuideOpen(true)}
              onOpenCustomizer={() => setIsCustomizerOpen(true)}
              projectGroups={projectGroups}
              activeGroupId={activeGroupId}
              onSelectGroup={setActiveGroupId}
              onOpenGroupManager={() => setIsGroupManagerOpen(true)}
            />
          </div>

          {/* Dedicated Khmer Offline Studio Full Page (1-20 Episodes / Full Movie) */}
          {activeTab === 'tab-offline' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden tab-content-enter">
              <KhmerOfflineStudioPage
                config={khmerOfflineConfig}
                onChangeConfig={setKhmerOfflineConfig}
                onStartOfflineDubbing={handleStartOfflineDubbing}
                isProcessing={isDubbing}
                progress={dubbingProgress}
                message={dubbingMessage}
                onOpenTimelineStudio={(url, filename) => {
                  if (url) {
                    setUploadedFile({
                      filename: filename || 'offline_episode.mp4',
                      originalName: filename || 'offline_episode.mp4',
                      size: 0,
                      type: 'video',
                      url,
                    });
                  }
                  setActiveTab('tab-dubbing');
                  showToast('បានផ្ទុកវីដេអូភាគចូលក្នុងស្ទូឌីយោ Timeline!', 'info');
                }}
                onShowToast={showToast}
                user={user}
                onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
              />
            </div>
          )}

          {activeTab === 'tab-manual' && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 tab-content-enter">
              <div className="bg-[#111827] border border-white/[0.08] rounded-xl p-4 flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold text-white">បន្ទប់កាត់តសំឡេងលម្អិត (Timeline Dialogue Editor)</h3>
                  <p className="text-xs text-slate-400">ស្កេន និងប្តូរសំឡេងតួអង្គនីមួយៗក្នុងរឿង បញ្ចូលសំឡេងផ្ទាល់ ឬបង្កើតសំឡេង AI</p>
                </div>
                <button
                  onClick={handleScanTimeline}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs"
                >
                  ស្កេនឃ្លាសន្ទនាទាំងអស់
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                {segments.map((seg, idx) => (
                  <div
                    key={idx}
                    className="bg-[#111827] border border-white/[0.08] rounded-lg p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-sky-500/15 text-sky-400">
                        #{idx + 1}
                      </span>
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <select
                            value={seg.voiceId || ''}
                            onChange={(e) => {
                              const vId = e.target.value;
                              const matched = characters.find((c) => c.id === vId);
                              setSegments((prev) => {
                                const copy = [...prev];
                                copy[idx] = {
                                  ...copy[idx],
                                  voiceId: vId,
                                  speaker_name: matched ? matched.label : copy[idx].speaker_name,
                                  gender: matched ? matched.gender : copy[idx].gender,
                                };
                                return copy;
                              });
                            }}
                            className="bg-[#07090e] border border-white/[0.1] rounded px-2 py-1 text-xs text-sky-300 font-semibold"
                          >
                            <option value="">ជ្រើសរើសសំឡេងតួអង្គ...</option>
                            {characters.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label} ({c.gender === 'female' ? 'ស្រី' : 'ប្រុស'})
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-slate-400 font-mono">
                            {seg.start_time.toFixed(1)}s - {seg.end_time.toFixed(1)}s
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-white">
                          "{seg.khmer_translation || ''}"
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {seg.chinese_text}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          showToast(`កំពុងបង្កើតសំឡេងឃ្លាទី #${idx + 1}...`, 'info');
                          try {
                            const r = await api.generateLine({
                              text: seg.khmer_translation || seg.chinese_text || 'បាទ',
                              lineIndex: idx,
                              gender: seg.gender || 'male',
                              voiceId: seg.voiceId || 'voxcpm-voice-actor',
                              speakerId: seg.speaker_role,
                            });
                            if (r.success) {
                              setSegments((prev) => {
                                const copy = [...prev];
                                copy[idx] = { ...copy[idx], audioUrl: r.audioUrl, status: 'ready' };
                                return copy;
                              });
                              showToast(`សំឡេងឃ្លាទី #${idx + 1} រួចរាល់!`, 'success');
                              new Audio(r.audioUrl).play();
                            }
                          } catch (e: any) {
                            showToast(`កំហុស: ${e.message}`, 'error');
                          }
                        }}
                        className="px-3 py-1.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-medium flex items-center gap-1.5"
                      >
                        <Mic className="w-3.5 h-3.5" />
                        <span>បង្កើតសំឡេង AI</span>
                      </button>

                      {seg.audioUrl && (
                        <button
                          onClick={() => seg.audioUrl && new Audio(seg.audioUrl).play()}
                          className="p-1.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-amber-300"
                          title="ស្ដាប់សំឡេង"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'tab-character' && (
            <CharacterLibrary
              characters={characters}
              onOpenAddModal={() => setIsAddVoiceOpen(true)}
              onOpenEditModal={(c) => setSelectedCharForEdit(c)}
              onOpenAuditionModal={(c) => setSelectedCharForAudition(c)}
              user={user}
              onDeleteVoice={(char) => {
                setCharacters((prev) => prev.filter((c) => c.id !== char.id));
              }}
              onSelectVoice={(char) => {
                setMaleLeadVoice(char.filename);
                showToast(`បានជ្រើសរើស "${char.label}" ជាសំឡេងតួឯក!`, 'success');
              }}
              selectedVoiceId={maleLeadVoice}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'tab-translator' && <TranslationDesk onShowToast={showToast} />}

          {activeTab === 'tab-mixer' && (
            <AudioMixerConsole
              uploadedFilename={uploadedFile?.filename}
              onShowToast={showToast}
              onBgmReady={(bgm) => {
                setCleanBgmUrl(bgm);
                showToast('បានភ្ជាប់បទភ្លេង BGM ស្អាតចូលទៅក្នុង Timeline Master!', 'success');
              }}
            />
          )}

          {activeTab === 'tab-subtitles' && (
            <SubtitleStudio
              segments={segments}
              characters={characters}
              onUpdateSegment={(idx, updated) => {
                setSegments((prev) => {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...updated };
                  return copy;
                });
              }}
              onOpenExportModal={() => setIsExportOpen(true)}
              onShowToast={showToast}
              onGenerateCustomVideo={handleAssemble}
              isGenerating={isDubbing}
            />
          )}

          {activeTab === 'tab-thumbnail' && (
            <ThumbnailGenerator
              currentProject={uploadedFile}
              videoUrl={outputVideo || uploadedFile?.url || (uploadedFile?.filename ? `/media/uploads/${uploadedFile.filename}` : '')}
              videoRef={videoRef}
              initialCapturedImage={thumbnailCapturedFrame}
              onShowToast={showToast}
              onApplyToVideo={(cfg) => {
                setVideoEffects((prev) => ({
                  ...prev,
                  styleText: {
                    enabled: true,
                    title: cfg.title,
                    subtitle: cfg.subtitle,
                    badge: cfg.badge,
                    stylePreset: cfg.effectStyle || 'gold3d',
                    fontFamily: cfg.fontFamily || 'Koulen',
                    fontSize: Math.min(48, Math.max(22, Math.round((cfg.fontSize || 58) * 0.6))),
                    subtitleFontSize: cfg.subtitleFontSize ? Math.round(cfg.subtitleFontSize * 0.7) : undefined,
                    position: 'free',
                    posX: cfg.posX ?? 10,
                    posY: cfg.posY ?? 82,
                    textAlign: cfg.textAlign || 'left',
                    rotationAngle: cfg.rotationAngle || 0,
                    showBanner: cfg.bgBanner !== 'none',
                    depth3D: cfg.depth3D ?? 6,
                    glowIntensity: cfg.glowIntensity ?? 16,
                    strokeWidth: cfg.strokeWidth ?? 5,
                  },
                }));
                showToast('🎉 បានដាក់អក្សរ Style Thumbnail លើវីដេអូបានជោគជ័យ! បើក Video Preview ដើម្បីទស្សនា', 'success');
              }}
              onOpenExportModal={() => setIsExportOpen(true)}
            />
          )}

          {activeTab === 'tab-tuner' && <VoiceTunerLab onShowToast={showToast} />}

          {activeTab === 'tab-projects' && (
            <VideoProjectManager
              onShowToast={showToast}
              onLoadProject={(project) => {
                showToast(`📂 បានបើកគម្រោង "${project.name}"`, 'success');
                setActiveTab('tab-dubbing');
              }}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onSuccess={(u) => {
          setUser(u);
          setIsAuthModalOpen(false);
          loadCharacters();
        }}
        onShowToast={showToast}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onShowToast={showToast}
        onRefreshConfig={loadConfigAndStatus}
        user={user}
        onLogout={handleLogout}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        onShowToast={showToast}
        activeProjectTitle={uploadedFile?.originalName || 'khmer_dubbed_movie'}
        outputVideoUrl={outputVideo || uploadedFile?.url || null}
        filename={uploadedFile?.filename || (outputVideo ? outputVideo.split('/').pop() || '' : '')}
        videoEffects={videoEffects}
        segments={segments}
      />

      <QuickVoxcpmModal
        isOpen={isVoxModalOpen}
        onClose={() => setIsVoxModalOpen(false)}
        onRefreshStatus={loadConfigAndStatus}
        onShowToast={showToast}
      />

      <AdminUsersModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        onShowToast={showToast}
      />

      <LicenseActivationModal
        isOpen={isLicenseModalOpen}
        user={user}
        onClose={() => setIsLicenseModalOpen(false)}
        onSuccess={(updatedUser) => {
          setUser(updatedUser);
          loadConfigAndStatus();
        }}
        onShowToast={showToast}
      />

      <AddVoiceModal
        isOpen={isAddVoiceOpen}
        onClose={() => setIsAddVoiceOpen(false)}
        onSuccess={loadCharacters}
        onShowToast={showToast}
      />

      <EditVoiceModal
        isOpen={!!selectedCharForEdit}
        character={selectedCharForEdit}
        onClose={() => setSelectedCharForEdit(null)}
        onSuccess={loadCharacters}
        onShowToast={showToast}
      />

      <VoiceAuditionModal
        isOpen={!!selectedCharForAudition}
        character={selectedCharForAudition}
        onClose={() => setSelectedCharForAudition(null)}
        onShowToast={showToast}
      />

      {/* Video Downloader Modal (YouTube, TikTok, Facebook) */}
      <VideoDownloaderModal
        isOpen={isDownloaderOpen}
        onClose={() => setIsDownloaderOpen(false)}
        onVideoDownloaded={(file) => {
          setUploadedFile(file);
          setRecentFiles((prev) => [file, ...prev.filter((f) => f.filename !== file.filename)]);
          setActiveTab('tab-dubbing');
          showToast(`បានទាញយក និងផ្ទុកវីដេអូ ${file.originalName} ចូលស្ទូឌីយោ!`, 'success');
        }}
        onShowToast={showToast}
      />

      {/* Professional System Status Modal */}
      <SystemStatusModal
        isOpen={isSystemStatusOpen}
        onClose={() => setIsSystemStatusOpen(false)}
        voxStatus={voxStatus}
        config={config}
        diskStats={diskStats}
        onRefresh={loadConfigAndStatus}
        onOpenVoxModal={() => {
          setIsSystemStatusOpen(false);
          setIsVoxModalOpen(true);
        }}
        onOpenSettings={() => {
          setIsSystemStatusOpen(false);
          setIsSettingsOpen(true);
        }}
      />

      {/* Keyboard Shortcuts Speed HUD Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* 10-Video Shelf Modal */}
      <VideoShelfModal
        isOpen={isShelfOpen}
        onClose={() => setIsShelfOpen(false)}
        onSelectVideo={handleLoadFromShelf}
        onShelfUpdated={loadShelfAndGroups}
        groups={projectGroups}
        activeGroupId={activeGroupId}
        onShowToast={showToast}
      />

      {/* Project / Series Groups Manager Modal */}
      <GroupManagerModal
        isOpen={isGroupManagerOpen}
        onClose={() => setIsGroupManagerOpen(false)}
        groups={projectGroups}
        onGroupsUpdated={loadShelfAndGroups}
        onSelectGroup={(gid) => {
          setActiveGroupId(gid);
          setIsGroupManagerOpen(false);
        }}
        activeGroupId={activeGroupId}
        onShowToast={showToast}
        characters={characters}
        isLicensed={Boolean(user && (user.role === 'admin' || user.has_voxcpm_license))}
      />

      {/* Hardware Turbo Acceleration Modal */}
      <HardwareTurboModal
        isOpen={isHardwareTurboOpen}
        onClose={() => setIsHardwareTurboOpen(false)}
        onShowToast={showToast}
      />

      {/* ── 2026 Core Upgraded Modals ── */}
      <UserGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
        onOpenOfflineStudio={() => {
          setIsGuideOpen(false);
          setActiveTab('tab-offline');
        }}
        onOpenTrimmer={() => {
          setIsGuideOpen(false);
          setIsVideoTrimmerOpen(true);
        }}
        onOpenCustomizer={() => {
          setIsGuideOpen(false);
          setIsCustomizerOpen(true);
        }}
      />

      <VideoTrimmerModal
        isOpen={isVideoTrimmerOpen}
        onClose={() => setIsVideoTrimmerOpen(false)}
        videoSrc={outputVideo || uploadedFile?.url || ''}
        videoTitle={uploadedFile?.originalName || uploadedFile?.filename || 'video.mp4'}
        onApplyTrim={handleApplyTrim}
        onShowToast={showToast}
      />

      <CommercialOverlayModal
        isOpen={isCommercialOverlayOpen}
        onClose={() => setIsCommercialOverlayOpen(false)}
        config={commercialOverlayConfig}
        onChangeConfig={setCommercialOverlayConfig}
        mainVideoSrc={outputVideo || uploadedFile?.url || ''}
        onShowToast={showToast}
      />

      <StudioCustomizerModal
        isOpen={isCustomizerOpen}
        onClose={() => setIsCustomizerOpen(false)}
        theme={customUITheme}
        onChangeTheme={setCustomUITheme}
        onShowToast={showToast}
      />

      {/* In-App One-Click Software Update Modal */}
      <SoftwareUpdateModal
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
        currentVersion={versionInfo?.current_version || 'V2.1PRO'}
        latestVersion={versionInfo?.latest_version || 'V2.1PRO'}
        hasUpdate={Boolean(versionInfo?.has_update && versionInfo?.current_version !== versionInfo?.latest_version)}
        downloadUrl={versionInfo?.download_url}
        patchSizeMb={versionInfo?.patch_size_mb}
        changelog={versionInfo?.changelog}
        onUpdateSuccess={(newVer) => {
          setVersionInfo((prev: any) => ({
            ...prev,
            current_version: newVer,
            latest_version: newVer,
            has_update: false,
          }));
          showToast(`🎉 បានធ្វើបច្ចុប្បន្នភាពទៅ ${newVer} ដោយជោគជ័យ!`, 'success');
        }}
        onShowToast={showToast}
        isAdmin={Boolean(user && (user.role === 'admin' || user.has_voxcpm_license))}
      />

      {/* Floating Theme & Wallpaper Quick-Access Dock (kept off the Session page so it never covers "បង្កើតវីដេអូ") */}
      {activeTab !== 'tab-session' && (
        <QuickThemeFloatingWidget
          theme={customUITheme}
          isDarkMode={isDarkMode}
          onToggleDarkMode={handleToggleDarkMode}
          onChangeTheme={setCustomUITheme}
          onOpenCustomizer={() => setIsCustomizerOpen(true)}
          onShowToast={showToast}
        />
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} raised={activeTab === 'tab-session' && segments.length > 0} />
    </div>
  );
};

export default App;

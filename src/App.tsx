import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Icon3D, Icon3DName } from './components/Icon3D';
import { api, setAuthToken } from './lib/api';
import { inTelegram, setupTelegramShell, telegramProfile, waitForInitData } from './lib/telegram';
import type { BankVoice, SubscriptionStatus, User, VideoResult, VoxcpmStatus } from './lib/types';
import { Logo, Segmented, ToastProvider } from './components/ui';
import { HomeScreen } from './screens/HomeScreen';
import { CreateHandle, CreateScreen } from './screens/CreateScreen';
import { LongVideoScreen } from './screens/LongVideoScreen';
import { VideosScreen } from './screens/VideosScreen';
import { VoicesScreen } from './screens/VoicesScreen';
import { AccountScreen } from './screens/AccountScreen';
import { LoginScreen } from './screens/LoginScreen';

type Tab = 'home' | 'create' | 'videos' | 'voices' | 'account';
type StudioMode = 'single' | 'long' | 'short';

const TABS: { id: Tab; label: string; icon: Icon3DName; title: string; hint: string }[] = [
  { id: 'home', label: 'ដើម', icon: 'home', title: 'TeleScripts', hint: 'Khmer Dubbing Studio' },
  { id: 'create', label: 'បង្កើត', icon: 'create', title: 'បង្កើតវីដេអូ', hint: 'វីដេអូមួយ · វែង · ខ្លី' },
  { id: 'videos', label: 'វីដេអូ', icon: 'videos', title: 'វីដេអូរបស់ខ្ញុំ', hint: 'My Projects' },
  { id: 'voices', label: 'សំឡេង', icon: 'voices', title: 'បណ្ណាល័យសំឡេង', hint: 'Voice Library' },
  { id: 'account', label: 'ការកំណត់', icon: 'settings', title: 'ការកំណត់', hint: 'Account & Settings' },
];

const Shell: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authPending, setAuthPending] = useState(true);
  const [tgError, setTgError] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [studioMode, setStudioMode] = useState<StudioMode>('single');
  const [vox, setVox] = useState<VoxcpmStatus | null>(null);
  const [bank, setBank] = useState<{ online: boolean; voices: BankVoice[]; message?: string; proLimit?: number }>({ online: false, voices: [] });
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [videos, setVideos] = useState<VideoResult[] | null>(null);
  const create = useRef<CreateHandle>(null);

  // Inside Telegram (opened from the bot) log in with Telegram itself, else reuse the session.
  useEffect(() => {
    setupTelegramShell();
    const fromSession = () =>
      api
        .me()
        .then((r) => setUser(r.user || null))
        .catch(() => setUser(null))
        .finally(() => setAuthPending(false));
    waitForInitData().then((initData) => {
      if (!initData) return fromSession();
      api
        .telegramLogin(initData)
        .then((r) => {
          setAuthToken(r.token);
          setUser(r.user);
          setAuthPending(false);
        })
        .catch((e) => {
          setTgError(e.message || 'ចូលតាម Telegram មិនបាន');
          return fromSession();
        });
    });
  }, []);

  const loadEngines = useCallback(() => {
    api.voxStatus().then(setVox).catch(() => {});
    api
      .voiceBank()
      .then(setBank)
      .catch(() => setBank({ online: false, voices: [] }));
  }, []);
  const loadStatus = useCallback(() => {
    api
      .plans()
      .then((r) => setStatus(r.status))
      .catch(() => {});
  }, []);
  const onStatus = useCallback(
    (s: SubscriptionStatus) => {
      setStatus(s);
      loadEngines();
    },
    [loadEngines]
  );
  const loadVideos = useCallback(() => {
    api
      .videoResults()
      .then((r) => setVideos(r.items))
      .catch(() => setVideos([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadEngines();
    loadVideos();
    loadStatus();
    // The VoxCPM2 model can take a while to load after a deploy; keep the status fresh
    const t = setInterval(loadEngines, 60000);
    return () => clearInterval(t);
  }, [user, loadEngines, loadVideos, loadStatus]);

  const logout = async () => {
    await api.logout().catch(() => {});
    setAuthToken(null);
    setUser(null);
    setTab('home');
  };

  if (authPending) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-surface">
        <Loader2 className="w-7 h-7 text-accent animate-spin" />
        <p className="text-sm text-mute">{inTelegram() ? 'កំពុងចូលតាម Telegram…' : 'កំពុងផ្ទុក…'}</p>
      </div>
    );
  }
  if (!user) return <LoginScreen onLogin={setUser} telegramError={tgError} />;

  const current = TABS.find((t) => t.id === tab)!;
  const voxOk = Boolean(vox?.online && bank.online);
  const { photo, name } = telegramProfile();
  return (
    <div className="min-h-[100dvh] bg-navy lg:flex">
      {/* Desktop: a left sidebar replaces the bottom tabs, and the content is wider */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 lg:sticky lg:top-0 lg:h-[100dvh] border-r border-line bg-surface px-3 py-5 gap-1">
        <div className="flex items-center gap-2 px-2 pb-4">
          <Logo />
          <span className="font-bold text-ink tracking-tight">TeleScripts</span>
        </div>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (t.id === 'videos' || t.id === 'home') loadVideos();
              }}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${active ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-ink-2 hover:bg-raised'}`}
            >
              <Icon3D name={t.icon} className="w-7 h-7" muted={!active} />
              {t.label}
            </button>
          );
        })}
        <div className="mt-auto px-2 pt-3 text-[11px] text-mute">@TeleScriptsAgentbot</div>
      </aside>

      <div className="flex-1 min-w-0">
      <header className="sticky top-0 z-20 bg-navy/85 backdrop-blur-xl border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="max-w-md lg:max-w-4xl mx-auto px-4 h-16 flex items-center gap-2.5">
          <Logo />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[17px] font-bold tracking-tight text-ink truncate">{current.title}</h1>
              {tab === 'home' && <span className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">AI</span>}
            </div>
            <p className="text-[11px] text-mute -mt-0.5 truncate">{current.hint}</p>
          </div>
          <button
            type="button"
            title={vox?.message}
            onClick={() => setTab('voices')}
            className={`h-8 px-2.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5 ring-1 ${
              voxOk ? 'bg-emerald-500/10 text-ok ring-emerald-500/30' : 'bg-amber-500/10 text-warn ring-amber-500/30'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${voxOk ? 'bg-ok' : 'bg-warn animate-pulse'}`} />
            VoxCPM2
          </button>
          <button
            type="button"
            onClick={() => setTab('account')}
            aria-label="គណនី"
            className="w-8 h-8 rounded-full p-0.5 bg-gradient-to-tr from-sky-500 to-cyan-400 shrink-0 overflow-hidden"
          >
            {photo ? (
              <img src={photo} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="w-full h-full rounded-full bg-navy flex items-center justify-center text-[11px] font-bold text-accent">
                {(name || user.username || '?').trim().charAt(0).toUpperCase()}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-md lg:max-w-4xl mx-auto px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-10">
        {tab === 'home' && (
          <HomeScreen
            user={user}
            bank={bank.voices}
            videos={videos}
            status={status}
            onCreate={() => {
              setStudioMode('single');
              setTab('create');
            }}
            // the file picker must open inside the tap itself, or the browser blocks it
            onUpload={() => {
              setStudioMode('single');
              setTab('create');
              create.current?.openPicker();
            }}
            onLink={() => {
              setStudioMode('single');
              setTab('create');
              create.current?.focusLink();
            }}
            onVideos={() => setTab('videos')}
            onVoices={() => setTab('voices')}
            onAccount={() => setTab('account')}
          />
        )}
        {/* One 3-in-1 tab: pick the kind of video, then edit & generate in place.
            Both flows stay mounted so an in-flight upload, job, or render keeps
            its state when switching kind or visiting another tab. */}
        <div hidden={tab !== 'create'} className="flex flex-col gap-4">
          <div className="flex items-center justify-center">
            <Segmented
              value={studioMode}
              onChange={setStudioMode}
              options={[
                { value: 'single', label: 'វីដេអូមួយ' },
                { value: 'long', label: 'វែង' },
                { value: 'short', label: 'ខ្លី' },
              ]}
            />
          </div>
          <div hidden={studioMode === 'long'}>
            <CreateScreen
              ref={create}
              user={user}
              bank={bank.voices}
              bankOnline={bank.online}
              proLimit={bank.proLimit ?? 0}
              status={status}
              shortMode={studioMode === 'short'}
              onOpenAccount={() => setTab('account')}
              onVideoReady={() => {
                loadVideos();
                loadStatus();
                loadEngines();
              }}
            />
          </div>
          <div hidden={studioMode !== 'long'}>
            <LongVideoScreen
              onVideoReady={loadVideos}
              bank={bank.voices}
              bankOnline={bank.online}
              proLimit={bank.proLimit ?? 0}
              onOpenAccount={() => setTab('account')}
            />
          </div>
        </div>
        {tab === 'videos' && (
          <VideosScreen
            items={videos}
            reload={loadVideos}
            onUpload={() => {
              setStudioMode('single');
              setTab('create');
              create.current?.openPicker();
            }}
          />
        )}
        {tab === 'voices' && (
          <VoicesScreen user={user} bank={bank.voices} bankOnline={bank.online} bankMessage={bank.message} vox={vox} reload={loadEngines} status={status} onOpenAccount={() => setTab('account')} />
        )}
        {tab === 'account' && (
          <AccountScreen
            user={user}
            status={status}
            onStatus={onStatus}
            onUser={setUser}
            onLogout={logout}
          />
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-navy/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="ផ្ទាំង">
        <div className="max-w-md mx-auto grid grid-cols-5">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  if (t.id === 'videos' || t.id === 'home') loadVideos();
                }}
                aria-current={active ? 'page' : undefined}
                className={`relative h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active ? 'text-accent' : 'text-mute'}`}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-cyan shadow-glow" />}
                <Icon3D name={t.icon} className={active ? 'w-7 h-7' : 'w-6 h-6'} muted={!active} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
      </div>
    </div>
  );
};

const App: React.FC = () => (
  <ToastProvider>
    <Shell />
  </ToastProvider>
);

export default App;

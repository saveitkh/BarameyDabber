import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Home, Loader2, Mic, Settings, SquarePlus } from 'lucide-react';
import { api, setAuthToken } from './lib/api';
import { inTelegram, setupTelegramShell, telegramProfile, waitForInitData } from './lib/telegram';
import type { BankVoice, User, VideoResult, VoxcpmStatus } from './lib/types';
import { Logo, ToastProvider } from './components/ui';
import { HomeScreen } from './screens/HomeScreen';
import { CreateHandle, CreateScreen } from './screens/CreateScreen';
import { VideosScreen } from './screens/VideosScreen';
import { VoicesScreen } from './screens/VoicesScreen';
import { AccountScreen } from './screens/AccountScreen';
import { LoginScreen } from './screens/LoginScreen';

type Tab = 'home' | 'create' | 'videos' | 'voices' | 'account';

const TABS: { id: Tab; label: string; icon: React.ElementType; title: string; hint: string }[] = [
  { id: 'home', label: 'ដើម', icon: Home, title: 'TeleScripts', hint: 'Khmer Dubbing Studio' },
  { id: 'create', label: 'បង្កើត', icon: SquarePlus, title: 'បង្កើត Dub ថ្មី', hint: 'Step-by-step Khmer Dubbing' },
  { id: 'videos', label: 'វីដេអូ', icon: FolderOpen, title: 'វីដេអូរបស់ខ្ញុំ', hint: 'My Projects' },
  { id: 'voices', label: 'សំឡេង', icon: Mic, title: 'បណ្ណាល័យសំឡេង', hint: 'Voice Library' },
  { id: 'account', label: 'ការកំណត់', icon: Settings, title: 'ការកំណត់', hint: 'Account & Settings' },
];

const Shell: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authPending, setAuthPending] = useState(true);
  const [tgError, setTgError] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [vox, setVox] = useState<VoxcpmStatus | null>(null);
  const [bank, setBank] = useState<{ online: boolean; voices: BankVoice[]; message?: string }>({ online: false, voices: [] });
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
    // The VoxCPM2 model can take a while to load after a deploy; keep the status fresh
    const t = setInterval(loadEngines, 60000);
    return () => clearInterval(t);
  }, [user, loadEngines, loadVideos]);

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
    <div className="min-h-[100dvh] bg-navy">
      <header className="sticky top-0 z-20 bg-navy/85 backdrop-blur-xl border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="max-w-md mx-auto px-4 h-16 flex items-center gap-2.5">
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

      <main className="max-w-md mx-auto px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))]">
        {tab === 'home' && (
          <HomeScreen
            user={user}
            bank={bank.voices}
            videos={videos}
            onCreate={() => setTab('create')}
            // the file picker must open inside the tap itself, or the browser blocks it
            onUpload={() => {
              setTab('create');
              create.current?.openPicker();
            }}
            onLink={() => {
              setTab('create');
              create.current?.focusLink();
            }}
            onVideos={() => setTab('videos')}
            onVoices={() => setTab('voices')}
            onAccount={() => setTab('account')}
          />
        )}
        {/* Create stays mounted so an in-flight upload or job keeps its state across tabs */}
        <div hidden={tab !== 'create'}>
          <CreateScreen ref={create} user={user} bank={bank.voices} bankOnline={bank.online} onOpenAccount={() => setTab('account')} onVideoReady={loadVideos} />
        </div>
        {tab === 'videos' && (
          <VideosScreen
            user={user}
            items={videos}
            reload={loadVideos}
            onUpload={() => {
              setTab('create');
              create.current?.openPicker();
            }}
            onResume={(f) => {
              create.current?.resume(f);
              setTab('create');
            }}
          />
        )}
        {tab === 'voices' && (
          <VoicesScreen user={user} bank={bank.voices} bankOnline={bank.online} bankMessage={bank.message} vox={vox} reload={loadEngines} />
        )}
        {tab === 'account' && <AccountScreen user={user} onUser={setUser} onLogout={logout} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-navy/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]" aria-label="ផ្ទាំង">
        <div className="max-w-md mx-auto grid grid-cols-5">
          {TABS.map((t) => {
            const Icon = t.icon;
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
                <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

const App: React.FC = () => (
  <ToastProvider>
    <Shell />
  </ToastProvider>
);

export default App;

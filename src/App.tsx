import React, { useCallback, useEffect, useState } from 'react';
import { AudioLines, Film, Loader2, Mic, UserRound, Wand2 } from 'lucide-react';
import { api, setAuthToken } from './lib/api';
import { inTelegram, setupTelegramShell, waitForInitData } from './lib/telegram';
import type { BankVoice, User, VideoResult, VoxcpmStatus } from './lib/types';
import { ToastProvider } from './components/ui';
import { CreateScreen } from './screens/CreateScreen';
import { VideosScreen } from './screens/VideosScreen';
import { VoicesScreen } from './screens/VoicesScreen';
import { AccountScreen } from './screens/AccountScreen';
import { LoginScreen } from './screens/LoginScreen';

type Tab = 'create' | 'videos' | 'voices' | 'account';

const TABS: { id: Tab; label: string; icon: React.ElementType; title: string }[] = [
  { id: 'create', label: 'បង្កើត', icon: Wand2, title: 'បញ្ចូលសំឡេងខ្មែរ' },
  { id: 'videos', label: 'វីដេអូ', icon: Film, title: 'វីដេអូរបស់ខ្ញុំ' },
  { id: 'voices', label: 'សំឡេង', icon: Mic, title: 'ធនាគារសំឡេង' },
  { id: 'account', label: 'គណនី', icon: UserRound, title: 'គណនី' },
];

const Shell: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authPending, setAuthPending] = useState(true);
  const [tgError, setTgError] = useState('');
  const [tab, setTab] = useState<Tab>('create');
  const [vox, setVox] = useState<VoxcpmStatus | null>(null);
  const [bank, setBank] = useState<{ online: boolean; voices: BankVoice[]; message?: string }>({ online: false, voices: [] });
  const [videos, setVideos] = useState<VideoResult[] | null>(null);

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
    setTab('create');
  };

  if (authPending) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-white">
        <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500">{inTelegram() ? 'កំពុងចូលតាម Telegram…' : 'កំពុងផ្ទុក…'}</p>
      </div>
    );
  }
  if (!user) return <LoginScreen onLogin={setUser} telegramError={tgError} />;

  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <AudioLines className="w-4 h-4 text-white" />
          </div>
          <h1 className="flex-1 text-base font-bold text-slate-900 truncate">{current.title}</h1>
          <span
            title={vox?.message}
            className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${
              vox?.online && bank.online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {vox?.online && bank.online ? 'VoxCPM2 ✓' : 'VoxCPM2 …'}
          </span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4 pb-[calc(88px+env(safe-area-inset-bottom))]">
        {/* Create stays mounted so an in-flight upload or job keeps its state across tabs */}
        <div hidden={tab !== 'create'}>
          <CreateScreen user={user} bank={bank.voices} bankOnline={bank.online} onOpenAccount={() => setTab('account')} onVideoReady={loadVideos} />
        </div>
        {tab === 'videos' && <VideosScreen items={videos} reload={loadVideos} onCreate={() => setTab('create')} />}
        {tab === 'voices' && (
          <VoicesScreen user={user} bank={bank.voices} bankOnline={bank.online} bankMessage={bank.message} vox={vox} reload={loadEngines} />
        )}
        {tab === 'account' && <AccountScreen user={user} onUser={setUser} onLogout={logout} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]" aria-label="ផ្ទាំង">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  if (t.id === 'videos') loadVideos();
                }}
                aria-current={active ? 'page' : undefined}
                className={`h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active ? 'text-blue-600' : 'text-slate-500'}`}
              >
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

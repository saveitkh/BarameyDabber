import React, { useEffect, useState } from 'react';
import { AudioLines, Send } from 'lucide-react';
import { api, setAuthToken } from '../lib/api';
import { inTelegram } from '../lib/telegram';
import type { User } from '../lib/types';
import { Button, Card, useToast } from '../components/ui';

type AuthConfig = { enabled: boolean; passwordLogin: boolean; botUsername: string };

/** Signing in happens through the Telegram bot; the password form only appears when the server allows it. */
export const LoginScreen: React.FC<{ onLogin: (u: User) => void; telegramError?: string }> = ({ onLogin, telegramError }) => {
  const toast = useToast();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfig().then(setCfg).catch(() => setCfg({ enabled: false, passwordLogin: false, botUsername: '' }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.login(username.trim(), password);
      setAuthToken(r.token);
      onLogin(r.user);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const botUrl = cfg?.botUsername ? `https://t.me/${cfg.botUsername}` : '';
  const input = 'w-full rounded-xl ring-1 ring-slate-300 px-3 min-h-[48px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10 bg-white">
      <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center">
        <AudioLines className="w-8 h-8 text-white" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-900">Khmer Dubber</h1>
      <p className="mt-1 text-sm text-slate-500">បញ្ចូលសំឡេងខ្មែរ ដោយក្លូនសំឡេងតួ</p>

      <Card className="mt-6 w-full max-w-sm p-5 flex flex-col gap-3">
        {telegramError ? (
          <>
            <p className="text-sm font-semibold text-red-600">ចូលតាម Telegram មិនបាន</p>
            <p className="text-xs text-slate-600 leading-relaxed break-words">{telegramError}</p>
            <p className="text-xs text-slate-500">សូមបិទ ហើយបើកម្ដងទៀតពី Bot។</p>
          </>
        ) : inTelegram() ? (
          <p className="text-sm text-slate-700">កំពុងចូលតាម Telegram… បើមិនបានទេ សូមបិទ ហើយបើកម្ដងទៀតពី Bot។</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-900">ចូលតាម Telegram</p>
            <p className="text-xs text-slate-600 leading-relaxed">បើកកម្មវិធីនេះពី Telegram Bot ហើយអ្នកនឹងចូលដោយស្វ័យប្រវត្តិ — មិនបាច់មានពាក្យសម្ងាត់ទេ។</p>
            {botUrl && (
              <a
                href={botUrl}
                className="inline-flex items-center justify-center gap-2 rounded-xl min-h-[48px] bg-blue-600 text-white text-sm font-semibold"
              >
                <Send className="w-4 h-4" /> បើកក្នុង Telegram
              </a>
            )}
          </>
        )}
      </Card>

      {cfg?.passwordLogin && (
        <Card className="mt-3 w-full max-w-sm p-5">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input className={input} placeholder="Email / ឈ្មោះគណនី" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input className={input} type="password" placeholder="ពាក្យសម្ងាត់" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" variant="secondary" block loading={busy} disabled={!username.trim() || !password}>
              ចូលដោយពាក្យសម្ងាត់
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { AudioLines } from 'lucide-react';
import { api, setAuthToken } from '../lib/api';
import type { User } from '../lib/types';
import { Button, Card, useToast } from '../components/ui';

export const LoginScreen: React.FC<{ onLogin: (u: User) => void }> = ({ onLogin }) => {
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = mode === 'login' ? await api.login(username.trim(), password) : await api.register(username.trim(), password);
      setAuthToken(r.token);
      onLogin(r.user);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-xl ring-1 ring-slate-300 px-3 min-h-[48px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10 bg-white">
      <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center">
        <AudioLines className="w-8 h-8 text-white" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-900">Khmer Dubber</h1>
      <p className="mt-1 text-sm text-slate-500">បញ្ចូលសំឡេងខ្មែរ ដោយក្លូនសំឡេងតួ</p>
      <Card className="mt-6 w-full max-w-sm p-5">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input className={input} placeholder="Email / ឈ្មោះគណនី" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input
            className={input}
            type="password"
            placeholder="ពាក្យសម្ងាត់"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" block loading={busy} disabled={!username.trim() || !password}>
            {mode === 'login' ? 'ចូលគណនី' : 'បង្កើតគណនី'}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}
          className="mt-3 w-full text-xs text-slate-500 min-h-[36px]"
        >
          {mode === 'login' ? 'មិនទាន់មានគណនី? បង្កើតថ្មី' : 'មានគណនីហើយ? ចូលគណនី'}
        </button>
      </Card>
      <p className="mt-6 text-xs text-slate-400 text-center max-w-xs">បើកពី Telegram Bot ដើម្បីចូលដោយស្វ័យប្រវត្តិ</p>
    </div>
  );
};

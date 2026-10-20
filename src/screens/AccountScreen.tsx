import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crown, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { isLicensed, km } from '../lib/cast';
import type { AdminOrder, KhqrConfig, LicenseKey, SubscriptionStatus, User, VoxSettings } from '../lib/types';
import { Button, Card, Collapsible as Section, inputClass, useToast } from '../components/ui';
import { GeminiKeyCard, OwnVoxCard, PlansPanel } from './PlansPanel';
import { AdminKhqr, AdminOrders, AdminPlansEditor } from './AdminPlans';
import { VoxDiagnoseSheet } from '../components/VoxDiagnoseSheet';

const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('km-KH') : '');

interface Props {
  user: User;
  status: SubscriptionStatus | null;
  onStatus: (s: SubscriptionStatus) => void;
  onUser: (u: User) => void;
  onLogout: () => void;
}

export const AccountScreen: React.FC<Props> = ({ user, status, onStatus, onUser, onLogout }) => {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [activating, setActivating] = useState(false);

  const activate = async () => {
    setActivating(true);
    try {
      const r = await api.activateLicense(key.trim());
      onUser(r.user);
      setKey('');
      api.plans().then((p) => onStatus(p.status)).catch(() => {});
      toast(r.message || '✓ License បានបើក', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setActivating(false);
    }
  };

  const vip = isLicensed(user);
  const ent = status?.entitlement;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
          <UserRound className="w-6 h-6 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink truncate">{user.username}</p>
          <p className="text-xs text-mute mt-0.5 flex items-center gap-1">
            {user.role === 'admin' ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-accent" /> Admin
              </>
            ) : ent?.paid ? (
              <>
                <Crown className="w-3.5 h-3.5 text-warn" /> {ent.planLabel}
                {ent.expiresAt ? ` · ដល់ ${date(ent.expiresAt)}` : ''}
              </>
            ) : (
              'គណនីឥតគិតថ្លៃ'
            )}
          </p>
        </div>
        <Button variant="ghost" className="px-3" onClick={onLogout} aria-label="ចាកចេញ">
          <LogOut className="w-4 h-4" />
        </Button>
      </Card>

      <PlansPanel user={user} status={status} onStatus={onStatus} onUser={onUser} />
      <GeminiKeyCard />
      <OwnVoxCard ent={ent} />

      {!vip && (
        <Card className="p-4 flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-accent" /> មាន License Key?
          </p>
          <div className="flex gap-2">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              className="flex-1 min-w-0 rounded-xl ring-1 ring-line-strong px-3 min-h-[44px] text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <Button disabled={!key.trim()} loading={activating} onClick={activate}>
              បើក
            </Button>
          </div>
        </Card>
      )}

      {user.role === 'admin' && <AdminPanel />}
    </div>
  );
};

const AdminPanel: React.FC = () => {
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [query, setQuery] = useState('');
  const [khqr, setKhqr] = useState<KhqrConfig | null>(null);
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [keys, setKeys] = useState<LicenseKey[]>([]);
  const [keyDays, setKeyDays] = useState(30);
  const [vox, setVox] = useState<VoxSettings | null>(null);
  const [voxUrl, setVoxUrl] = useState('');
  const [voxKey, setVoxKey] = useState('');
  const [voxBusy, setVoxBusy] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(() => {
    api.adminUsers().then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'error'));
    api.adminKhqrStatus().then(setKhqr).catch(() => {});
    api.adminOrders().then((r) => setOrders(r.orders)).catch(() => {});
    api.adminLicenseKeys().then((r) => setKeys(r.keys)).catch(() => {});
    api.adminVoxSettings().then((v) => { setVox(v); setVoxUrl(v.url); }).catch(() => {});
  }, [toast]);

  const saveVox = async (body: { url?: string; apiKey?: string; reset?: boolean }) => {
    setVoxBusy(true);
    try {
      const v = await api.adminSaveVoxSettings(body);
      setVox(v);
      setVoxUrl(v.url);
      setVoxKey('');
      toast(v.status.online ? '✓ ភ្ជាប់ VoxCPM2 បានជោគជ័យ' : `រក្សាទុកហើយ — ${v.status.message || 'ម៉ាស៊ីនមិនទាន់ឆ្លើយតប'}`, v.status.online ? 'success' : 'warning');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setVoxBusy(false);
    }
  };
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      load();
    }
  }, [load]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const input = inputClass;
  const pendingOrders = (orders || []).filter((o) => o.status === 'pending').length;
  const shown = (users || []).filter((u) => u.username.toLowerCase().includes(query.toLowerCase())).slice(0, 50);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-bold text-mute">Admin</h2>

      <Section title={`ការបញ្ជាទិញ${pendingOrders ? ` · រង់ចាំ ${km(pendingOrders)}` : ''}`} defaultOpen={pendingOrders > 0}>
        <AdminOrders orders={orders} reload={() => api.adminOrders().then((r) => setOrders(r.orders)).catch((e) => toast(e.message, 'error'))} />
      </Section>

      <Section title="គម្រោង & តម្លៃ (Plans)">
        <AdminPlansEditor />
      </Section>

      <Section title={`KHQR ទទួលប្រាក់ ${khqr?.configured ? '✓' : '(មិនទាន់កំណត់)'}`} defaultOpen={khqr ? !khqr.configured : false}>
        <AdminKhqr cfg={khqr} onCfg={setKhqr} />
      </Section>

      <Section title={`អ្នកប្រើ${users ? ` (${km(users.length)})` : ''}`}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ស្វែងរក…" className={input} />
        <ul className="flex flex-col divide-y divide-line">
          {shown.map((u) => (
            <li key={u.id} className="py-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-semibold text-ink truncate">{u.username}</span>
                {u.role === 'admin' ? (
                  <span className="text-[11px] text-accent bg-accent/10 rounded-full px-2 py-0.5">Admin</span>
                ) : isLicensed(u) ? (
                  <span className="text-[11px] text-warn bg-amber-500/10 rounded-full px-2 py-0.5">VIP</span>
                ) : u.tier === 'premium' ? (
                  <span className="text-[11px] text-ok bg-emerald-500/10 rounded-full px-2 py-0.5">Premium</span>
                ) : null}
              </div>
              {u.role !== 'admin' && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" className="min-h-[34px] px-3 text-xs" onClick={() => act(() => api.adminSetPremium(u.id, 30), '✓ Premium ៣០ ថ្ងៃ')}>
                    Premium +៣០ថ្ងៃ
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-[34px] px-3 text-xs"
                    onClick={() => act(() => api.adminToggleVoxcpm(u.id, !isLicensed(u), 30), isLicensed(u) ? 'បានបិទ VIP' : '✓ VIP ៣០ ថ្ងៃ')}
                  >
                    {isLicensed(u) ? 'បិទ VIP' : 'VIP +៣០ថ្ងៃ'}
                  </Button>
                  {u.tier === 'premium' && (
                    <Button variant="ghost" className="min-h-[34px] px-3 text-xs" onClick={() => act(() => api.adminRevokePremium(u.id), 'បានដក Premium')}>
                      ដក Premium
                    </Button>
                  )}
                  <Button variant="ghost" className="min-h-[34px] px-3 text-xs" onClick={() => act(() => api.adminResetDevice(u.id), 'បាន Reset ឧបករណ៍')}>
                    Reset ឧបករណ៍
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="License Keys">
        <div className="flex gap-2 items-center">
          <input type="number" min={1} max={3650} value={keyDays} onChange={(e) => setKeyDays(Number(e.target.value) || 30)} className={`${input} max-w-[100px]`} />
          <span className="text-xs text-mute">ថ្ងៃ</span>
          <div className="flex-1" />
          <Button onClick={() => act(() => api.adminCreateLicenseKey(keyDays), '✓ បានបង្កើត Key')}>បង្កើត Key</Button>
        </div>
        <ul className="flex flex-col gap-1">
          {keys.slice(0, 20).map((k) => (
            <li key={k.id} className="flex items-center gap-2 text-xs">
              <span className={`font-mono flex-1 ${k.is_used ? 'text-mute line-through' : 'text-ink'}`}>{k.key_code}</span>
              <span className="text-mute">{k.is_used ? k.used_by_username || 'ប្រើរួច' : `${km(k.days_valid)} ថ្ងៃ`}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`VoxCPM2 ក្លូនសំឡេង ${vox?.status.online ? '✓' : '(មិនទាន់ភ្ជាប់)'}`} defaultOpen={!vox?.status.online}>
        <p className="text-xs text-ink-2 leading-relaxed">
          ដាក់ Link ពី Colab (<span className="font-mono">https://….trycloudflare.com</span>) និងកូដសម្ងាត់ (API key) ដែលអ្នកកំណត់ក្នុង Colab។ មិនបាច់កែ <span className="font-mono">.env</span> លើ VPS ទេ។
        </p>
        <input value={voxUrl} onChange={(e) => setVoxUrl(e.target.value)} placeholder="https://xxxx.trycloudflare.com" inputMode="url" autoCapitalize="none" className={`${input} font-mono text-xs`} />
        <input
          type="password"
          value={voxKey}
          onChange={(e) => setVoxKey(e.target.value)}
          autoComplete="off"
          placeholder={vox?.hasKey ? 'API key (បានដាក់រួច — ទុកទទេដើម្បីរក្សា)' : 'API key (ដូចក្នុង Colab)'}
          className={`${input} font-mono text-xs`}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button loading={voxBusy} disabled={!voxUrl.trim()} onClick={() => saveVox({ url: voxUrl, ...(voxKey ? { apiKey: voxKey } : {}) })}>
            រក្សាទុក & សាកល្បង
          </Button>
          <Button variant="secondary" disabled={voxBusy || vox?.source !== 'app'} onClick={() => saveVox({ reset: true })}>
            ប្រើលំនាំដើម Server
          </Button>
        </div>
        <Button variant="secondary" onClick={() => setDiagnosing(true)}>
          🔎 ពិនិត្យមូលហេតុ & មើល Log កំហុស
        </Button>
        <VoxDiagnoseSheet open={diagnosing} onClose={() => setDiagnosing(false)} />
        {vox && (
          <p className={`text-xs leading-relaxed ${vox.status.online ? 'text-ok' : 'text-warn'}`}>
            {vox.status.online ? '● ភ្ជាប់រួចរាល់' : '● មិនទាន់ភ្ជាប់'} — {vox.status.message}
            <br />
            <span className="text-mute">ប្រភព៖ {vox.source === 'app' ? 'ដាក់ក្នុងកម្មវិធី' : 'Server (.env)'}{vox.hasKey ? ' · មាន key' : ' · គ្មាន key'}</span>
          </p>
        )}
        {vox?.hasKey === false && voxUrl.includes('trycloudflare') && (
          <p className="text-xs text-warn">គ្មាន key ទេ — អ្នកណាមាន Link ក៏ប្រើ GPU របស់អ្នកបាន។ ដាក់ <span className="font-mono">API_KEY</span> ក្នុង Colab ហើយដាក់ដូចគ្នានៅទីនេះ។</p>
        )}
      </Section>

    </section>
  );
};

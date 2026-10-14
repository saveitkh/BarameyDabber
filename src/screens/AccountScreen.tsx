import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Crown, KeyRound, LogOut, QrCode, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { isLicensed, km } from '../lib/cast';
import type { LicenseKey, SubscriptionOrder, SubscriptionPlan, SubscriptionStatus, User, VoxSettings } from '../lib/types';
import { Button, Card, useToast } from '../components/ui';

const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('km-KH') : '');

interface Props {
  user: User;
  onUser: (u: User) => void;
  onLogout: () => void;
}

export const AccountScreen: React.FC<Props> = ({ user, onUser, onLogout }) => {
  const toast = useToast();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [khqrReady, setKhqrReady] = useState(true);
  const [order, setOrder] = useState<SubscriptionOrder | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [activating, setActivating] = useState(false);

  const loadPlans = useCallback(() => {
    api
      .plans()
      .then((r) => {
        setPlans(r.plans);
        setStatus(r.status);
        setKhqrReady(r.khqrConfigured);
      })
      .catch(() => {});
  }, []);
  useEffect(loadPlans, [loadPlans]);

  useEffect(() => {
    if (!order || order.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const r = await api.pollOrder(order.ticket);
        if (r.order.status !== 'pending') {
          setOrder({ ...order, ...r.order });
          setStatus(r.status);
          if (r.order.status === 'paid') {
            toast('🎉 បង់ប្រាក់ជោគជ័យ!', 'success');
            api.me().then((m) => m.user && onUser(m.user));
          }
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [order, onUser, toast]);

  const buy = async (plan: SubscriptionPlan['id']) => {
    setCreating(plan);
    try {
      const r = await api.createOrder(plan);
      setOrder(r.order);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setCreating(null);
    }
  };

  const activate = async () => {
    setActivating(true);
    try {
      const r = await api.activateLicense(key.trim());
      onUser(r.user);
      setKey('');
      toast(r.message || '✓ License បានបើក', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setActivating(false);
    }
  };

  const vip = isLicensed(user);

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
            ) : vip ? (
              <>
                <Crown className="w-3.5 h-3.5 text-warn" /> VIP{user.voxcpm_license_expires_at ? ` · ដល់ ${date(user.voxcpm_license_expires_at)}` : ''}
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

      {/* Plans */}
      {user.role !== 'admin' && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-bold text-mute">គម្រោង</h2>
          {status && (
            <p className="px-1 text-xs text-ink-2">
              បច្ចុប្បន្ន៖ <b>{status.plan === 'free' ? 'ឥតគិតថ្លៃ' : status.plan}</b>
              {status.expiresAt ? ` · ផុតកំណត់ ${date(status.expiresAt)}` : ''}
            </p>
          )}
          {order ? (
            <Card className="p-5 flex flex-col items-center gap-3 text-center">
              {order.status === 'paid' ? (
                <>
                  <CheckCircle2 className="w-10 h-10 text-ok" />
                  <p className="text-sm font-bold">បង់ប្រាក់រួចរាល់</p>
                </>
              ) : order.status === 'expired' ? (
                <p className="text-sm text-ink-2">QR ផុតកំណត់ — សូមបង្កើតម្ដងទៀត</p>
              ) : (
                <>
                  <p className="text-sm font-bold text-ink">ស្កេន KHQR ដើម្បីបង់ ${order.amount_usd}</p>
                  {order.qrImage ? (
                    <img src={order.qrImage} alt="KHQR" className="w-60 h-60 rounded-2xl ring-1 ring-line p-2 bg-white" />
                  ) : (
                    <QrCode className="w-16 h-16 text-mute" />
                  )}
                  <p className="text-xs text-mute">លេខ Ticket៖ <span className="font-mono">{order.ticket}</span> · កំពុងរង់ចាំការបង់ប្រាក់…</p>
                </>
              )}
              <Button variant="secondary" onClick={() => setOrder(null)}>
                ត្រឡប់
              </Button>
            </Card>
          ) : (
            plans.map((p) => (
              <Card key={p.id} className="p-4 flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-bold text-ink">
                    {p.label_km} · ${p.price_usd}
                  </p>
                  <p className="text-xs text-mute mt-0.5">
                    {km(p.days)} ថ្ងៃ{p.includesVoxcpm ? ' · រួមទាំងក្លូនសំឡេង VoxCPM2' : ''}
                  </p>
                </div>
                <Button disabled={!khqrReady} loading={creating === p.id} onClick={() => buy(p.id)}>
                  ទិញ
                </Button>
              </Card>
            ))
          )}
          {!khqrReady && <p className="px-1 text-xs text-warn">ការបង់ប្រាក់ KHQR មិនទាន់បើក — សូមទាក់ទង Admin</p>}
        </section>
      )}

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

const Section: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center px-4 min-h-[52px] text-sm font-bold text-ink">
        <span className="flex-1 text-left">{title}</span>
        <ChevronDown className={`w-4 h-4 text-mute transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 flex flex-col gap-3">{children}</div>}
    </Card>
  );
};

const AdminPanel: React.FC = () => {
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [query, setQuery] = useState('');
  const [ticket, setTicket] = useState('');
  const [khqr, setKhqr] = useState<{ configured: boolean; preview: string | null } | null>(null);
  const [khqrPayload, setKhqrPayload] = useState('');
  const [keys, setKeys] = useState<LicenseKey[]>([]);
  const [keyDays, setKeyDays] = useState(30);
  const [vox, setVox] = useState<VoxSettings | null>(null);
  const [voxUrl, setVoxUrl] = useState('');
  const [voxKey, setVoxKey] = useState('');
  const [voxBusy, setVoxBusy] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(() => {
    api.adminUsers().then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'error'));
    api.adminKhqrStatus().then(setKhqr).catch(() => {});
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

  const input = 'flex-1 min-w-0 rounded-xl ring-1 ring-line-strong px-3 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-accent';
  const shown = (users || []).filter((u) => u.username.toLowerCase().includes(query.toLowerCase())).slice(0, 50);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-bold text-mute">Admin</h2>

      <Section title="បញ្ជាក់ការបង់ប្រាក់ (Ticket)" defaultOpen>
        <div className="flex gap-2">
          <input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Ticket" className={`${input} font-mono`} />
          <Button
            disabled={!ticket.trim()}
            onClick={() => act(() => api.adminConfirmOrder(ticket.trim()).then(() => setTicket('')), '✓ បានបញ្ជាក់ការបង់ប្រាក់')}
          >
            បញ្ជាក់
          </Button>
        </div>
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

      <Section title={`KHQR ${khqr?.configured ? '✓' : '(មិនទាន់កំណត់)'}`}>
        <p className="text-xs text-mute">បិទភ្ជាប់ KHQR string ពីកម្មវិធីធនាគាររបស់អ្នក (ចាប់ផ្ដើមដោយ 000201…)</p>
        <textarea value={khqrPayload} onChange={(e) => setKhqrPayload(e.target.value)} rows={3} className="rounded-xl ring-1 ring-line-strong px-3 py-2 text-xs font-mono" />
        <Button disabled={!khqrPayload.trim()} onClick={() => act(() => api.adminSetKhqr(khqrPayload.trim()).then(() => setKhqrPayload('')), '✓ បានរក្សាទុក KHQR')}>
          រក្សាទុក
        </Button>
      </Section>
    </section>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Crown, Download, ImagePlus, Link2, Loader2, Lock, QrCode, Send, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { km } from '../lib/cast';
import type { Entitlement, OwnVox, SubscriptionOrder, SubscriptionPlan, SubscriptionStatus, User } from '../lib/types';
import { Button, Card, Progress, Sheet, inputClass, useToast } from '../components/ui';

const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('km-KH') : '');
export const limitText = (n: number, unit = '') => (n < 0 ? 'គ្មានដែនកំណត់' : `${km(n)}${unit}`);

/** "VoxCPM2 Pro · ប្រើ ៣ / ២០" with a bar, or "គ្មានដែនកំណត់". */
export const QuotaMeter: React.FC<{ ent: Entitlement }> = ({ ent }) => {
  if (ent.voxLimit < 0) return <p className="text-xs text-ok font-semibold">{ent.voxLabel} · គ្មានដែនកំណត់</p>;
  const pct = ent.voxLimit ? Math.round((ent.voxUsed / ent.voxLimit) * 100) : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1.5">
        <span className="text-ink-2 font-semibold">{ent.voxLabel}</span>
        <span className="text-mute">
          ប្រើ <b className="text-ink">{km(ent.voxUsed)}</b> / {km(ent.voxLimit)} វីដេអូ · នៅសល់ <b className={ent.voxRemaining ? 'text-ink' : 'text-bad'}>{km(ent.voxRemaining)}</b>
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
};

interface Props {
  user: User;
  status: SubscriptionStatus | null;
  onStatus: (s: SubscriptionStatus) => void;
  onUser: (u: User) => void;
}

export const PlansPanel: React.FC<Props> = ({ user, status, onStatus, onUser }) => {
  const toast = useToast();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [banks, setBanks] = useState<{ id: 'primary' | 'alt'; label: string }[]>([]);
  const [buying, setBuying] = useState<SubscriptionPlan | null>(null);

  // The parent's callbacks can change identity on every render; keep the latest in a ref so loading
  // plans happens once (not in a loop) and an open checkout is never reset by a refresh.
  const latest = useRef({ onStatus, toast });
  latest.current = { onStatus, toast };
  const load = useCallback(() => {
    api
      .plans()
      .then((r) => {
        setPlans(r.plans);
        setBanks((old) => (JSON.stringify(old) === JSON.stringify(r.banks) ? old : r.banks));
        latest.current.onStatus(r.status);
      })
      .catch((e) => latest.current.toast(e.message, 'error'));
  }, []);
  useEffect(load, [load]);

  const ent = status?.entitlement;
  const admin = user.role === 'admin';

  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-xs font-bold text-mute">គម្រោង & ការប្រើប្រាស់</h2>

      {ent && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
              <Crown className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-ink">{admin ? 'Admin · គ្មានដែនកំណត់' : ent.paid ? `គម្រោង ${ent.planLabel}` : 'គម្រោងឥតគិតថ្លៃ'}</p>
              <p className="text-xs text-mute">{ent.paid && ent.expiresAt ? `ផុតកំណត់ ${date(ent.expiresAt)}` : ent.paid ? '' : 'សំឡេង AI ខ្មែរ គ្មានដែនកំណត់'}</p>
            </div>
          </div>
          <QuotaMeter ent={ent} />
          <p className="text-xs text-mute">
            សំឡេង Pro៖ <b className="text-ink">{ent.proVoices === 0 ? 'មិនទាន់មាន' : ent.proVoices < 0 ? 'ជ្រើសបានទាំងអស់' : `${km(ent.proVoices)} សំឡេង/វីដេអូ`}</b>
          </p>
        </Card>
      )}

      {!admin &&
        plans.map((p) => {
          const current = ent?.planId === p.id && (p.id === 'free' || ent?.paid);
          const free = p.id === 'free';
          return (
            <Card key={p.id} className={`p-4 flex flex-col gap-3 ${p.badge === 'popular' ? 'ring-2 ring-accent/50' : p.badge === 'best' ? 'ring-2 ring-amber-400/60' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-ink flex items-center gap-2 flex-wrap">
                    {p.label_km}
                    {p.badge === 'popular' && <span className="text-[10px] font-semibold text-accent bg-accent/10 rounded-full px-2 py-0.5">ពេញនិយម</span>}
                    {p.badge === 'best' && <span className="text-[10px] font-semibold text-warn bg-amber-500/10 rounded-full px-2 py-0.5">ចំណេញបំផុត</span>}
                    {current && <span className="text-[10px] font-semibold text-ok bg-emerald-500/10 rounded-full px-2 py-0.5">បច្ចុប្បន្ន</span>}
                  </p>
                  <p className="text-xs text-mute mt-0.5 leading-relaxed">{p.pitch_km}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-bold text-ink leading-none">{free ? '$0' : `$${p.price_usd}`}</p>
                  <p className="text-[11px] text-mute mt-1">{free ? 'ឥតគិតថ្លៃ' : p.days >= 360 ? '/ឆ្នាំ' : p.days >= 28 && p.days <= 31 ? '/ខែ' : `/${km(p.days)} ថ្ងៃ`}</p>
                </div>
              </div>
              <ul className="flex flex-col gap-1.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-ink-2 leading-snug">
                    <Check className="w-3.5 h-3.5 text-ok shrink-0 mt-px" /> {f}
                  </li>
                ))}
              </ul>
              {!free && (
                <Button disabled={!banks.length} onClick={() => setBuying(p)} variant={current ? 'secondary' : 'primary'}>
                  <QrCode className="w-4 h-4" /> {current ? 'ពន្យារ / បន្ត' : p.price_usd > (plans.find((x) => x.id === ent?.planId)?.price_usd ?? 0) && ent?.paid ? 'ដំឡើងគម្រោង' : 'ជ្រើសគម្រោងនេះ'} · ${p.price_usd}
                </Button>
              )}
            </Card>
          );
        })}
      {!admin && !banks.length && plans.length > 0 && <p className="px-1 text-xs text-warn">ការបង់ប្រាក់ KHQR មិនទាន់បើក — សូមទាក់ទង Admin</p>}

      <CheckoutSheet
        plan={buying}
        banks={banks}
        onClose={() => setBuying(null)}
        onPaid={(s) => {
          onStatus(s);
          api.me().then((m) => m.user && onUser(m.user));
        }}
      />
    </section>
  );
};

/* ── Checkout: pick bank → scan KHQR → (receipt) → paid ── */
const CheckoutSheet: React.FC<{
  plan: SubscriptionPlan | null;
  banks: { id: 'primary' | 'alt'; label: string }[];
  onClose: () => void;
  onPaid: (s: SubscriptionStatus) => void;
}> = ({ plan, banks, onClose, onPaid }) => {
  const toast = useToast();
  const [bank, setBank] = useState<'primary' | 'alt'>('primary');
  const [order, setOrder] = useState<SubscriptionOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [left, setLeft] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const paidNotified = useRef(false);

  const firstBank = useRef<'primary' | 'alt'>('primary');
  firstBank.current = banks[0]?.id ?? 'primary';
  useEffect(() => {
    if (plan) {
      setOrder(null);
      setBank(firstBank.current);
      paidNotified.current = false;
    }
  }, [plan]);

  const pending = order?.status === 'pending';

  // Poll the bank / admin decision
  useEffect(() => {
    if (!order || !pending) return;
    const t = setInterval(async () => {
      try {
        const r = await api.pollOrder(order.ticket);
        setOrder((o) => (o ? { ...o, ...r.order } : o));
        if (r.order.status === 'paid' && !paidNotified.current) {
          paidNotified.current = true;
          onPaid(r.status);
          toast('🎉 បង់ប្រាក់ជោគជ័យ!', 'success');
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [order?.ticket, pending, onPaid, toast]);

  // Countdown (the QR times out unless a receipt is with the admin)
  useEffect(() => {
    if (!order || !pending) return;
    const end = new Date(order.created_at).getTime() + (order.expiresInSec ?? 600) * 1000;
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [order?.ticket, order?.created_at, order?.expiresInSec, pending]);

  const create = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      setOrder((await api.createOrder(plan.id, bank)).order);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendReceipt = async (f: File) => {
    if (!order) return;
    setSending(true);
    try {
      const r = await api.uploadReceipt(order.ticket, f);
      setOrder((o) => (o ? { ...o, ...r.order } : o));
      toast('✓ បានផ្ញើ Receipt — Admin នឹងបញ្ជាក់ក្នុងពេលឆាប់ៗ', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const mmss = useMemo(() => `${km(Math.floor(left / 60))}:${km(String(left % 60).padStart(2, '0'))}`, [left]);

  return (
    <Sheet open={Boolean(plan)} onClose={onClose} title={plan ? `ទិញគម្រោង ${plan.label_km}` : ''}>
      {plan && !order && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-raised p-4 flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-accent" />
            <div className="flex-1">
              <p className="text-sm font-bold text-ink">{plan.label_km}</p>
              <p className="text-xs text-mute">{plan.days >= 360 ? '១ ឆ្នាំ' : `${km(plan.days)} ថ្ងៃ`}</p>
            </div>
            <p className="text-xl font-bold text-ink">${plan.price_usd}</p>
          </div>
          {banks.length > 1 && (
            <div>
              <p className="text-xs font-semibold text-ink-2 mb-2">ជ្រើសធនាគារ</p>
              <div className="grid grid-cols-2 gap-2">
                {banks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBank(b.id)}
                    className={`min-h-[44px] rounded-xl text-sm font-bold ring-1 ${bank === b.id ? 'ring-2 ring-accent bg-accent/10 text-accent' : 'ring-line text-ink-2'}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-mute mt-2">KHQR ដដែល — App ធនាគារណាក៏ស្កេនបាន។</p>
            </div>
          )}
          <Button block loading={busy} onClick={create}>
            <QrCode className="w-4 h-4" /> បង្កើត KHQR បង់ប្រាក់
          </Button>
        </div>
      )}

      {order && order.status === 'paid' && (
        <div className="flex flex-col items-center gap-3 text-center py-4">
          <CheckCircle2 className="w-14 h-14 text-ok" />
          <p className="text-base font-bold text-ink">បង់ប្រាក់រួចរាល់!</p>
          <p className="text-sm text-ink-2">គម្រោង <b>{order.planLabel}</b> ត្រូវបានបើកហើយ។</p>
          <Button block onClick={onClose}>
            បន្តប្រើ
          </Button>
        </div>
      )}

      {order && (order.status === 'expired' || order.status === 'rejected') && (
        <div className="flex flex-col items-center gap-3 text-center py-4">
          <p className="text-sm font-bold text-ink">{order.status === 'rejected' ? 'Admin បដិសេធការបង់ប្រាក់នេះ' : 'KHQR ផុតកំណត់'}</p>
          <p className="text-xs text-mute">{order.status === 'rejected' ? 'បើអ្នកបានបង់ពិតប្រាកដ សូមទាក់ទង Admin ជាមួយ Ticket ខាងក្រោម។' : 'សូមបង្កើតម្ដងទៀត។ បើបានបង់ហើយ ផ្ញើ Receipt ទៅ Admin។'}</p>
          <p className="text-[11px] font-mono text-mute">{order.ticket}</p>
          <Button block onClick={() => setOrder(null)}>
            បង្កើត KHQR ថ្មី
          </Button>
        </div>
      )}

      {order && pending && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-ink-2 text-center">
            ស្កេនជាមួយ App ធនាគារ ដើម្បីបង់ <b className="text-ink text-base">${order.amount_usd}</b>
          </p>
          {order.qrImage ? <img src={order.qrImage} alt="KHQR" className="w-56 h-56 rounded-2xl ring-1 ring-line p-2 bg-white" /> : <QrCode className="w-16 h-16 text-mute" />}
          <div className="text-center">
            {order.payee && <p className="text-sm font-bold text-ink">{order.payee}</p>}
            <p className="text-xs text-mute">
              {order.bankLabel} · {order.planLabel} · <span className="tabular-nums">{left > 0 ? `ផុតក្នុង ${mmss}` : 'ជិតផុតកំណត់'}</span>
            </p>
          </div>
          {order.qrImage && (
            <a href={order.qrImage} download={`khqr-${order.amount_usd}.png`} className="text-xs font-semibold text-accent inline-flex items-center gap-1">
              <Download className="w-3.5 h-3.5" /> រក្សាទុករូប QR (ស្កេនពី Gallery)
            </a>
          )}
          <div className="w-full rounded-2xl bg-raised p-3 flex items-start gap-2 text-xs text-ink-2 leading-relaxed">
            <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0 mt-0.5" />
            <span>{order.autoConfirm ? 'កំពុងរង់ចាំការបង់ប្រាក់ — គម្រោងនឹងបើកដោយស្វ័យប្រវត្តិពេលបង់រួច។' : 'បង់រួច សូមផ្ញើរូប Receipt ខាងក្រោម។ Admin នឹងបញ្ជាក់ ហើយគម្រោងនឹងបើក។'}</span>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) sendReceipt(f);
            }}
          />
          {order.hasReceipt ? (
            <p className="w-full text-center text-xs font-semibold text-ok bg-emerald-500/10 rounded-xl py-3">✓ បានផ្ញើ Receipt — កំពុងរង់ចាំ Admin បញ្ជាក់</p>
          ) : (
            <Button block variant="secondary" loading={sending} onClick={() => file.current?.click()}>
              <ImagePlus className="w-4 h-4" /> ផ្ញើរូប Receipt (បង់រួចហើយ)
            </Button>
          )}
          <p className="text-[11px] font-mono text-mute">Ticket: {order.ticket}</p>
        </div>
      )}
    </Sheet>
  );
};

/* ── A member's own VoxCPM2 link (Pro Plus / Unlimited) ── */
export const OwnVoxCard: React.FC<{ ent?: Entitlement }> = ({ ent }) => {
  const toast = useToast();
  const [vox, setVox] = useState<OwnVox | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .myVox()
      .then((v) => {
        setVox(v);
        setUrl(v.url);
      })
      .catch(() => {});
  }, [ent?.planId]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.saveMyVox(url.trim(), key.trim() || undefined);
      setVox((v) => ({ allowed: true, url: r.url, hasKey: r.hasKey, status: r.status, ...(v ? {} : {}) }));
      setUrl(r.url);
      setKey('');
      toast(r.status?.online ? '✓ ភ្ជាប់ VoxCPM2 របស់អ្នកបាន' : `រក្សាទុកហើយ — ${r.status?.message || 'មិនទាន់ភ្ជាប់'}`, r.status?.online ? 'success' : 'warning');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const allowed = vox?.allowed ?? ent?.ownVoxUrl ?? false;
  return (
    <Card className="p-4 flex flex-col gap-3">
      <p className="text-sm font-bold text-ink flex items-center gap-2">
        <Link2 className="w-4 h-4 text-accent" /> VoxCPM2 ផ្ទាល់ខ្លួន (Link)
        {!allowed && <Lock className="w-3.5 h-3.5 text-mute" />}
      </p>
      {!allowed ? (
        <p className="text-xs text-mute leading-relaxed">ដាក់ Link VoxCPM2 របស់អ្នកផ្ទាល់ (Colab / GPU) ដើម្បីបង្កើតវីដេអូដោយមិនកាត់ចំនួន — មានក្នុងគម្រោង <b>Pro Plus</b> និង <b>Unlimited</b>។</p>
      ) : (
        <>
          <p className="text-xs text-ink-2 leading-relaxed">
            ដាក់ Link ពី Colab (<span className="font-mono">https://….trycloudflare.com</span>) និងកូដសម្ងាត់ (API key)។ វីដេអូរបស់អ្នកនឹងប្រើ VoxCPM2 របស់អ្នក ហើយមិនកាត់ចំនួនវីដេអូក្នុងគម្រោងទេ។
          </p>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.trycloudflare.com" inputMode="url" autoCapitalize="none" className={`${inputClass} font-mono text-xs`} />
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            placeholder={vox?.hasKey ? 'API key (បានដាក់រួច — ទុកទទេដើម្បីរក្សា)' : 'API key (ដូចក្នុង Colab)'}
            className={`${inputClass} font-mono text-xs`}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button loading={busy} disabled={!url.trim()} onClick={save}>
              <Send className="w-4 h-4" /> រក្សាទុក & សាកល្បង
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !vox?.url}
              onClick={async () => {
                await api.clearMyVox().catch(() => {});
                setVox({ allowed: true, url: '', hasKey: false, status: null });
                setUrl('');
                toast('បានលុប Link ផ្ទាល់ខ្លួន — ប្រើ Server រួម', 'info');
              }}
            >
              ប្រើ Server រួម
            </Button>
          </div>
          {vox?.url && vox.status && (
            <p className={`text-xs ${vox.status.online ? 'text-ok' : 'text-warn'}`}>
              {vox.status.online ? '● ភ្ជាប់រួចរាល់' : '● មិនទាន់ភ្ជាប់'} — {vox.status.message}
            </p>
          )}
        </>
      )}
    </Card>
  );
};

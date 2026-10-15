import React, { useCallback, useEffect, useState } from 'react';
import { Check, EyeOff, Plus, QrCode, Receipt, RefreshCw, Trash2, X } from 'lucide-react';
import { api, withToken } from '../lib/api';
import { km } from '../lib/cast';
import type { AdminOrder, KhqrConfig, SubscriptionPlan } from '../lib/types';
import { Button, Sheet, Toggle, inputClass, useToast } from '../components/ui';

/* ── Plans editor ── */
type Draft = Omit<SubscriptionPlan, 'features' | 'perMonth'>;
const blank = (id: string): Draft => ({
  id,
  label_km: '',
  label_en: '',
  price_usd: 3,
  days: 30,
  sort: 50,
  visible: 1,
  badge: '',
  vox_label: 'VoxCPM2 Pro',
  vox_videos: 20,
  pro_voices: 0,
  own_vox_url: 0,
  pitch_km: '',
});

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[11px] font-semibold text-ink-2">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-mute">{hint}</span>}
  </label>
);

/** A limit: a number, or "unlimited" (-1). */
const LimitField: React.FC<{ label: string; value: number; onChange: (n: number) => void; unit: string }> = ({ label, value, onChange, unit }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[11px] font-semibold text-ink-2">{label}</span>
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        disabled={value < 0}
        value={value < 0 ? '' : value}
        placeholder="∞"
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className={`${inputClass} max-w-[110px]`}
      />
      <span className="text-xs text-mute">{unit}</span>
      <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <input type="checkbox" checked={value < 0} onChange={(e) => onChange(e.target.checked ? -1 : 0)} className="w-4 h-4 accent-sky-600" /> គ្មានដែនកំណត់
      </label>
    </div>
  </div>
);

export const AdminPlansEditor: React.FC = () => {
  const toast = useToast();
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.adminPlans().then((r) => setPlans(r.plans)).catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const edit = (p: SubscriptionPlan) => {
    const { features: _f, perMonth: _p, ...rest } = p;
    setDraft(rest);
    setIsNew(false);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.adminSavePlan({ ...draft, visible: Boolean(draft.visible), own_vox_url: Boolean(draft.own_vox_url) });
      toast('✓ បានរក្សាទុកគម្រោង', 'success');
      setDraft(null);
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft || !window.confirm(`លុបគម្រោង "${draft.label_km}"?\nអ្នកដែលកំពុងប្រើនឹងនៅតែមានដល់ថ្ងៃផុតកំណត់។`)) return;
    try {
      await api.adminDeletePlan(draft.id);
      setDraft(null);
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <p className="text-xs text-mute leading-relaxed">កែតម្លៃ ចំនួនថ្ងៃ ការពិពណ៌នា និងដែនកំណត់នៃគម្រោងនីមួយៗ។ បញ្ជីអត្ថប្រយោជន៍ត្រូវបង្កើតតាមលេខដោយស្វ័យប្រវត្តិ។</p>
      <ul className="flex flex-col divide-y divide-line">
        {(plans || []).map((p) => (
          <li key={p.id} className="py-2.5 flex items-center gap-2">
            <button type="button" onClick={() => edit(p)} className="flex-1 min-w-0 text-left">
              <span className="text-sm font-bold text-ink flex items-center gap-1.5">
                {p.label_km} <span className="text-xs font-normal text-mute font-mono">({p.id})</span>
                {!p.visible && <EyeOff className="w-3.5 h-3.5 text-mute" />}
              </span>
              <span className="block text-[11px] text-mute">
                {p.id === 'free' ? 'ឥតគិតថ្លៃ' : `$${p.price_usd} · ${km(p.days)} ថ្ងៃ`} · VoxCPM2 {p.vox_videos < 0 ? '∞' : km(p.vox_videos)} · Pro {p.pro_voices < 0 ? '∞' : km(p.pro_voices)}
                {p.own_vox_url ? ' · Link ផ្ទាល់ខ្លួន' : ''}
              </span>
            </button>
            <Button variant="secondary" className="min-h-[34px] px-3 text-xs" onClick={() => edit(p)}>
              កែ
            </Button>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        onClick={() => {
          setDraft(blank(''));
          setIsNew(true);
        }}
      >
        <Plus className="w-4 h-4" /> បន្ថែមគម្រោងថ្មី
      </Button>

      <Sheet open={Boolean(draft)} onClose={() => setDraft(null)} title={isNew ? 'គម្រោងថ្មី' : `កែគម្រោង ${draft?.label_km || ''}`}>
        {draft && (
          <div className="flex flex-col gap-3">
            {isNew && (
              <Field label="លេខកូដ (id)" hint="អក្សរឡាតាំង/លេខ ឧ. pro, vip2">
                <input value={draft.id} onChange={(e) => set('id', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} className={`${inputClass} font-mono`} />
              </Field>
            )}
            <Field label="ឈ្មោះគម្រោង (ខ្មែរ)">
              <input value={draft.label_km} onChange={(e) => set('label_km', e.target.value)} className={inputClass} />
            </Field>
            <Field label="ឈ្មោះ (English)">
              <input value={draft.label_en} onChange={(e) => set('label_en', e.target.value)} className={inputClass} />
            </Field>
            {draft.id !== 'free' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="តម្លៃ ($)">
                  <input type="number" min={0} step="0.5" value={draft.price_usd} onChange={(e) => set('price_usd', Number(e.target.value) || 0)} className={inputClass} />
                </Field>
                <Field label="រយៈពេល (ថ្ងៃ)" hint="៣០ = ១ ខែ, ៣៦៥ = ១ ឆ្នាំ">
                  <input type="number" min={1} value={draft.days} onChange={(e) => set('days', Number(e.target.value) || 1)} className={inputClass} />
                </Field>
              </div>
            )}
            <Field label="ការពិពណ៌នា (បង្ហាញក្រោមឈ្មោះគម្រោង)">
              <textarea value={draft.pitch_km} onChange={(e) => set('pitch_km', e.target.value)} rows={3} className="rounded-xl ring-1 ring-line-strong px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </Field>
            <Field label="ឈ្មោះ VoxCPM2 ក្នុងគម្រោង" hint="ឧ. VoxCPM2 Pro / VoxCPM2 Pro Plus">
              <input value={draft.vox_label} onChange={(e) => set('vox_label', e.target.value)} className={inputClass} />
            </Field>
            <LimitField label={draft.id === 'free' ? 'VoxCPM2 សាកល្បង (សរុប)' : 'VoxCPM2 ក្នុងមួយគម្រោង (វីដេអូ)'} value={draft.vox_videos} onChange={(n) => set('vox_videos', n)} unit="វីដេអូ" />
            <LimitField label="សំឡេង Pro ក្នុងមួយវីដេអូ" value={draft.pro_voices} onChange={(n) => set('pro_voices', n)} unit="សំឡេង" />
            <Toggle checked={Boolean(draft.own_vox_url)} onChange={(v) => set('own_vox_url', v ? 1 : 0)} label="អនុញ្ញាតដាក់ Link VoxCPM2 ផ្ទាល់ខ្លួន" hint="ប្រើ Colab/GPU របស់ខ្លួន — មិនកាត់ចំនួនវីដេអូ" />
            {draft.id !== 'free' && <Toggle checked={Boolean(draft.visible)} onChange={(v) => set('visible', v ? 1 : 0)} label="បង្ហាញដល់អ្នកប្រើ" hint="បិទ = លាក់ពីបញ្ជីទិញ" />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="ស្លាក">
                <select value={draft.badge} onChange={(e) => set('badge', e.target.value as Draft['badge'])} className="rounded-xl ring-1 ring-line-strong bg-navy px-3 min-h-[44px] text-sm">
                  <option value="">គ្មាន</option>
                  <option value="popular">ពេញនិយម</option>
                  <option value="best">ចំណេញបំផុត</option>
                </select>
              </Field>
              <Field label="លំដាប់">
                <input type="number" value={draft.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} className={inputClass} />
              </Field>
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" loading={busy} disabled={!draft.label_km.trim() || !draft.id} onClick={save}>
                <Check className="w-4 h-4" /> រក្សាទុក
              </Button>
              {!isNew && draft.id !== 'free' && (
                <Button variant="danger" onClick={remove} aria-label="លុបគម្រោង">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
};

/* ── KHQR (like NINTPLEX): paste the bank's own KHQR, up to two banks ── */
const KhqrSlotEditor: React.FC<{ slot: 'primary' | 'alt'; cfg: KhqrConfig; onCfg: (c: KhqrConfig) => void; title: string }> = ({ slot, cfg, onCfg, title }) => {
  const toast = useToast();
  const s = cfg.slots[slot];
  const [payload, setPayload] = useState('');
  const [label, setLabel] = useState(s.label);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ image: string; payee: string | null } | null>(null);

  const apply = async (body: Omit<Parameters<typeof api.adminKhqrConfig>[0], 'slot'>, ok: string) => {
    setBusy(true);
    try {
      onCfg(await api.adminKhqrConfig({ slot, ...body }));
      toast(ok, 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl ring-1 ring-line p-3 flex flex-col gap-2.5">
      <p className="text-xs font-bold text-ink flex items-center gap-2">
        <QrCode className="w-4 h-4 text-accent" /> {title}
        <span className={`ml-auto text-[11px] font-semibold ${s.set ? 'text-ok' : 'text-mute'}`}>{s.set ? `✓ ${s.payee || ''}` : 'មិនទាន់កំណត់'}</span>
      </p>
      <textarea
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        rows={3}
        placeholder="00020101021229450016…  (KHQR ពី App ធនាគារ — ត្រូវមានចំនួនទឹកប្រាក់)"
        className="rounded-xl ring-1 ring-line-strong px-3 py-2 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="flex gap-2 items-center">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} placeholder="ឈ្មោះប៊ូតុង ឧ. ABA" className={`${inputClass} max-w-[130px]`} />
        <span className="text-[11px] text-mute">ឈ្មោះលើប៊ូតុងជ្រើសធនាគារ</span>
      </div>
      <Toggle
        checked={s.rename}
        onChange={(v) => apply({ rename: v }, v ? 'នឹងប្ដូរឈ្មោះក្នុង QR នេះ' : 'រក្សាឈ្មោះដើមរបស់ធនាគារ')}
        label="ប្ដូរឈ្មោះក្នុង QR ជា «ឈ្មោះបង្ហាញ»"
        hint="ABA បដិសេធ QR ដែលប្ដូរឈ្មោះ — សូមបិទសម្រាប់ ABA។ ACLEDA ទទួលយកបាន។"
        disabled={busy}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          loading={busy}
          disabled={!payload.trim() && label === s.label}
          onClick={() => apply({ ...(payload.trim() ? { payload: payload.trim() } : {}), label }, '✓ បានរក្សាទុក').then(() => setPayload(''))}
        >
          រក្សាទុក
        </Button>
        <Button
          variant="secondary"
          disabled={!s.set}
          onClick={() =>
            api
              .adminKhqrPreview(slot)
              .then(setPreview)
              .catch((e) => toast(e.message, 'error'))
          }
        >
          សាកមើល ($1)
        </Button>
        {s.set && (
          <Button variant="ghost" disabled={busy} onClick={() => window.confirm('លុប KHQR នេះ?') && apply({ clear: true }, 'បានលុប')}>
            លុប
          </Button>
        )}
      </div>
      {preview && (
        <div className="flex items-center gap-3 rounded-xl bg-raised p-3">
          <img src={preview.image} alt="KHQR" className="w-28 h-28 rounded-lg bg-white p-1" />
          <p className="text-[11px] text-ink-2 leading-relaxed">
            ស្កេន QR សាកល្បង <b>$1</b> នេះជាមួយ App ធនាគាររបស់អ្នក ដើម្បីពិនិត្យថា <b>ឈ្មោះ ({preview.payee || '—'})</b> និងគណនីត្រឹមត្រូវ។ <b>កុំបង់ប្រាក់។</b>
            <button type="button" onClick={() => setPreview(null)} className="ml-2 text-accent font-semibold">
              បិទ
            </button>
          </p>
        </div>
      )}
    </div>
  );
};

export const AdminKhqr: React.FC<{ cfg: KhqrConfig | null; onCfg: (c: KhqrConfig) => void }> = ({ cfg, onCfg }) => {
  const toast = useToast();
  const [name, setName] = useState('');
  useEffect(() => setName(cfg?.displayName || ''), [cfg?.displayName]);
  if (!cfg) return <p className="text-xs text-mute">កំពុងផ្ទុក…</p>;
  return (
    <>
      <p className="text-xs text-mute leading-relaxed">
        បង្កើត QR ណាមួយ<b className="text-ink-2">ដែលមានចំនួនទឹកប្រាក់</b>ក្នុង App ធនាគារ → ចុចជាប់លើ QR → Copy → បិទភ្ជាប់ទីនេះ។ កម្មវិធីប្ដូរតែ <b className="text-ink-2">ចំនួនទឹកប្រាក់</b> ក្នុងការទិញនីមួយៗ — ផ្នែកផ្សេងទៀតរក្សាដដែល ដូច្នេះធនាគារទទួលស្គាល់។
      </p>
      <p className={`text-xs font-semibold ${cfg.bakongAuto ? 'text-ok' : 'text-warn'}`}>
        {cfg.bakongAuto ? '● បញ្ជាក់ការបង់ប្រាក់ដោយស្វ័យប្រវត្តិ (Bakong)' : '● បញ្ជាក់ដោយដៃ — សមាជិកផ្ញើ Receipt ហើយ Admin ចុចបញ្ជាក់ (ដាក់ BAKONG_API_TOKEN ក្នុង .env ដើម្បីស្វ័យប្រវត្តិ)'}
      </p>
      <KhqrSlotEditor slot="primary" cfg={cfg} onCfg={onCfg} title="ធនាគារទី ១" />
      <KhqrSlotEditor slot="alt" cfg={cfg} onCfg={onCfg} title="ធនាគារទី ២ (ស្រេចចិត្ត)" />
      <div className="flex gap-2 items-center">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={25} placeholder="ឈ្មោះបង្ហាញ ឧ. TELESCRIPTS (≤២៥ តួ)" className={inputClass} />
        <Button
          variant="secondary"
          disabled={name === cfg.displayName}
          onClick={() =>
            api
              .adminKhqrConfig({ slot: 'primary', displayName: name })
              .then((c) => {
                onCfg(c);
                toast('✓ បានរក្សាទុកឈ្មោះបង្ហាញ', 'success');
              })
              .catch((e) => toast(e.message, 'error'))
          }
        >
          រក្សាទុក
        </Button>
      </div>
    </>
  );
};

/* ── Orders waiting for the admin ── */
const STATUS: Record<AdminOrder['status'], string> = {
  pending: 'រង់ចាំ',
  paid: 'បានបង់',
  expired: 'ផុតកំណត់',
  rejected: 'បដិសេធ',
};

export const AdminOrders: React.FC<{ orders: AdminOrder[] | null; reload: () => void }> = ({ orders, reload }) => {
  const toast = useToast();
  const [view, setView] = useState<AdminOrder | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
      setView(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };
  const list = orders || [];
  return (
    <>
      <div className="flex items-center">
        <p className="flex-1 text-xs text-mute">ការបញ្ជាទិញ ៧២ ម៉ោងចុងក្រោយ។ ពិនិត្យ Receipt រួចចុចបញ្ជាក់។</p>
        <button type="button" onClick={reload} className="w-9 h-9 rounded-full flex items-center justify-center text-mute" aria-label="ផ្ទុកឡើងវិញ">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {list.length === 0 && <p className="text-xs text-mute text-center py-3">មិនទាន់មានការបញ្ជាទិញ</p>}
      <ul className="flex flex-col divide-y divide-line">
        {list.map((o) => (
          <li key={o.ticket} className="py-2.5 flex items-center gap-2">
            <button type="button" onClick={() => setView(o)} className="flex-1 min-w-0 text-left">
              <span className="text-[13px] font-semibold text-ink block truncate">{o.username}</span>
              <span className="text-[11px] text-mute block">
                {o.plan} · ${o.amount_usd} · {new Date(o.created_at).toLocaleString('km-KH', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </button>
            {o.hasReceipt && <Receipt className="w-4 h-4 text-accent" aria-label="មាន Receipt" />}
            <span
              className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                o.status === 'paid' ? 'text-ok bg-emerald-500/10' : o.status === 'pending' ? 'text-warn bg-amber-500/10' : 'text-mute bg-raised'
              }`}
            >
              {STATUS[o.status]}
            </span>
          </li>
        ))}
      </ul>
      <Sheet open={Boolean(view)} onClose={() => setView(null)} title="ពិនិត្យការបង់ប្រាក់">
        {view && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-raised p-3 text-sm">
              <p className="font-bold text-ink">{view.username}</p>
              <p className="text-xs text-ink-2 mt-0.5">
                គម្រោង <b>{view.plan}</b> · <b>${view.amount_usd}</b>
              </p>
              <p className="text-[11px] text-mute font-mono mt-1 break-all">{view.ticket}</p>
            </div>
            {view.hasReceipt ? (
              <img src={withToken(`/api/admin/subscription/orders/${encodeURIComponent(view.ticket)}/receipt`)} alt="Receipt" className="w-full max-h-[50vh] object-contain rounded-xl ring-1 ring-line bg-raised" />
            ) : (
              <p className="text-xs text-mute text-center py-2">សមាជិកមិនទាន់ផ្ញើ Receipt ទេ — ពិនិត្យក្នុង App ធនាគាររបស់អ្នក។</p>
            )}
            {view.status === 'pending' ? (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => act(() => api.adminConfirmOrder(view.ticket), '✓ បានបញ្ជាក់ — គម្រោងបានបើក')}>
                  <Check className="w-4 h-4" /> បញ្ជាក់
                </Button>
                <Button variant="danger" onClick={() => act(() => api.adminRejectOrder(view.ticket), 'បានបដិសេធ')}>
                  <X className="w-4 h-4" /> បដិសេធ
                </Button>
              </div>
            ) : view.status === 'expired' ? (
              <Button onClick={() => act(() => api.adminConfirmOrder(view.ticket), '✓ បានបញ្ជាក់ — គម្រោងបានបើក')}>
                <Check className="w-4 h-4" /> បញ្ជាក់ (បានបង់ពិត)
              </Button>
            ) : (
              <p className="text-xs text-center text-mute">ស្ថានភាព៖ {STATUS[view.status]}</p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
};


import React, { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Lock, Mic, Plus, Star, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { km } from '../lib/cast';
import type { BankVoice, SubscriptionStatus, User, VoiceReport, VoxcpmStatus } from '../lib/types';
import { Button, Card, EmptyState, PlayButton, Sheet, Toggle, useToast } from '../components/ui';
import { prettyBankName } from '../components/CharacterCard';
import { VoiceReportCard } from '../components/VoiceReportCard';

interface Props {
  user: User;
  bank: BankVoice[];
  bankOnline: boolean;
  bankMessage?: string;
  vox: VoxcpmStatus | null;
  reload: () => void;
  status: SubscriptionStatus | null;
  onOpenAccount: () => void;
}

export const VoicesScreen: React.FC<Props> = ({ user, bank, bankOnline, bankMessage, vox, reload, status, onOpenAccount }) => {
  const toast = useToast();
  const admin = user.role === 'admin';
  const [adding, setAdding] = useState(false);
  const std = bank.filter((v) => !v.pro);
  const groups: { title: string; items: BankVoice[] }[] = [
    { title: '⭐ សំឡេង PRO ច្បាស់ល្អ', items: bank.filter((v) => v.pro) },
    { title: 'សំឡេងប្រុស', items: std.filter((v) => v.gender === 'male') },
    { title: 'សំឡេងស្រី', items: std.filter((v) => v.gender === 'female') },
    { title: 'មិនទាន់ចាត់ថ្នាក់', items: std.filter((v) => v.gender === 'unknown') },
  ].filter((g) => g.items.length);
  const ent = status?.entitlement;

  const togglePro = async (v: BankVoice) => {
    try {
      await api.adminMarkVoicePro(v.name, !v.pro);
      toast(v.pro ? `ដក ${v.name} ចេញពីបញ្ជី PRO` : `✓ ${v.name} ជាសំឡេង PRO`, 'success');
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const remove = async (v: BankVoice) => {
    if (!window.confirm(`លុបសំឡេង ${v.name}?`)) return;
    try {
      await api.adminDeleteBankVoice(v.name);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${vox?.online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">ម៉ាស៊ីនក្លូនសំឡេង VoxCPM2</p>
          <p className="text-xs text-mute mt-0.5">{vox?.message || bankMessage || 'កំពុងពិនិត្យ…'}</p>
        </div>
      </Card>

      {ent && bank.some((v) => v.pro) && user.role !== 'admin' && (
        <Card className="p-3.5 flex items-center gap-3">
          <Star className="w-5 h-5 text-warn shrink-0" />
          <p className="flex-1 text-xs text-ink-2 leading-relaxed">
            <b>សំឡេង PRO</b>៖ {ent.proVoices === 0 ? 'ស្ដាប់គំរូបាន តែជ្រើសប្រើត្រូវការគម្រោង Pro។' : ent.proVoices < 0 ? 'ជ្រើសបានគ្រប់សំឡេង។' : `ជ្រើសបាន ${km(ent.proVoices)} សំឡេងក្នុងមួយវីដេអូ។`}
          </p>
          {ent.proVoices === 0 && (
            <Button variant="secondary" className="min-h-[34px] px-3 text-xs" onClick={onOpenAccount}>
              ដំឡើង
            </Button>
          )}
        </Card>
      )}

      <p className="px-1 text-xs text-mute leading-relaxed">
        ធនាគារសំឡេង៖ ពេលតួមួយប្រើ "Auto" ប្រព័ន្ធជ្រើសសំឡេងមួយពីទីនេះតាមភេទ ហើយតួនោះទទួលសំឡេងដដែលជានិច្ច។ តួពីរនាក់មិនជាន់សំឡេងគ្នាទេ (បើមានសំឡេងគ្រប់គ្រាន់)។
      </p>

      <SampleChecker />

      {admin && bankOnline && (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> បន្ថែមសំឡេងទៅធនាគារ
        </Button>
      )}

      {!bankOnline ? (
        <Card>
          <EmptyState icon={Mic} title="ធនាគារសំឡេងមិនទាន់រួចរាល់" body={bankMessage} />
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.title} className="flex flex-col gap-2">
            <h2 className="px-1 text-xs font-bold text-mute">
              {g.title} ({km(g.items.length)})
            </h2>
            {g.items.map((v) => (
              <Card key={v.id} className="pl-3 pr-2 py-2 flex items-center gap-2.5">
                <PlayButton src={v.previewUrl} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
                    {prettyBankName(v.name)}
                    {v.pro && <span className="text-[10px] font-bold text-warn bg-amber-500/10 rounded px-1.5 py-0.5">PRO</span>}
                    {v.locked && <Lock className="w-3.5 h-3.5 text-mute" />}
                  </p>
                  <p className="text-[11px] text-mute truncate">
                    {v.name} · អារម្មណ៍: {v.emotions.join(', ')}
                  </p>
                </div>
                {admin && (
                  <button
                    type="button"
                    onClick={() => togglePro(v)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${v.pro ? 'text-warn bg-amber-500/10' : 'text-mute hover:text-warn'}`}
                    aria-label={v.pro ? `ដក PRO ${v.name}` : `ដាក់ជា PRO ${v.name}`}
                    title="PRO"
                  >
                    <Star className="w-4 h-4" fill={v.pro ? 'currentColor' : 'none'} />
                  </button>
                )}
                {admin && (
                  <button
                    type="button"
                    onClick={() => remove(v)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-mute hover:text-bad hover:bg-red-500/10"
                    aria-label={`លុប ${v.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </Card>
            ))}
          </section>
        ))
      )}

      {admin && <AddVoiceSheet open={adding} onClose={() => setAdding(false)} existing={bank} onAdded={reload} />}
    </div>
  );
};

const AGES = [
  { v: 'adult', l: 'ពេញវ័យ' },
  { v: 'young', l: 'ក្មេង' },
  { v: 'old', l: 'ចាស់' },
  { v: 'deep', l: 'សំឡេងធ្ងន់' },
  { v: 'high', l: 'សំឡេងខ្ពស់' },
  { v: 'child', l: 'កុមារ' },
];
const EMOTIONS = ['normal', 'comedy', 'angry', 'sad', 'laugh', 'happy'];

const AddVoiceSheet: React.FC<{ open: boolean; onClose: () => void; existing: BankVoice[]; onAdded: () => void }> = ({
  open,
  onClose,
  existing,
  onAdded,
}) => {
  const toast = useToast();
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [age, setAge] = useState('adult');
  const [emotion, setEmotion] = useState('normal');
  const [target, setTarget] = useState<string>('__new');
  const [transcript, setTranscript] = useState('');
  const [pro, setPro] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<VoiceReport | null>(null);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const chooseFile = async (f: File | null) => {
    setFile(f);
    setReport(null);
    if (!f) return;
    setChecking(true);
    try {
      setReport((await api.checkVoice(f, Boolean(transcript.trim()))).report);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  const nextNumber =
    Math.max(0, ...existing.filter((v) => v.name.startsWith(`${gender}-${age}-`)).map((v) => Number(v.name.split('-')[2]) || 0)) + 1;
  const voiceName = target === '__new' ? `${gender}-${age}-${nextNumber}` : target;
  // Adding an emotion to an existing voice keeps its Pro status unless the admin changes it
  useEffect(() => {
    if (target !== '__new') setPro(Boolean(existing.find((v) => v.name === target)?.pro));
  }, [target, existing]);

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      await api.adminAddBankVoice({ voice: voiceName, emotion, transcript, pro, file });
      toast(`✓ បានបន្ថែម ${voiceName} / ${emotion}`, 'success');
      setFile(null);
      setReport(null);
      setTranscript('');
      setPro(false);
      onAdded();
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const select = 'w-full rounded-xl ring-1 ring-line-strong bg-navy px-3 min-h-[44px] text-sm';
  return (
    <Sheet open={open} onClose={onClose} title="បន្ថែមសំឡេង">
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-ink-2">
          ដាក់ចូល
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${select} mt-1`}>
            <option value="__new">សំឡេងថ្មី</option>
            {existing.map((v) => (
              <option key={v.id} value={v.name}>
                {v.name} (បន្ថែមអារម្មណ៍)
              </option>
            ))}
          </select>
        </label>
        {target === '__new' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-ink-2">
              ភេទ
              <select value={gender} onChange={(e) => setGender(e.target.value as any)} className={`${select} mt-1`}>
                <option value="male">ប្រុស</option>
                <option value="female">ស្រី</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-ink-2">
              ប្រភេទ
              <select value={age} onChange={(e) => setAge(e.target.value)} className={`${select} mt-1`}>
                {AGES.map((a) => (
                  <option key={a.v} value={a.v}>
                    {a.l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label className="text-xs font-semibold text-ink-2">
          អារម្មណ៍
          <select value={emotion} onChange={(e) => setEmotion(e.target.value)} className={`${select} mt-1`}>
            {EMOTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-2">
          អត្ថបទដែលនិយាយក្នុងសំឡេង (ជម្រើស — ធ្វើឲ្យដូចជាង)
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl ring-1 ring-line-strong px-3 py-2 text-sm"
          />
        </label>
        <Toggle checked={pro} onChange={setPro} label="⭐ សំឡេង PRO (ច្បាស់ល្អ)" hint="បញ្ចូលក្នុងបញ្ជី Pro — ប្រើបានតែអ្នកមានគម្រោង Pro ឡើងទៅ" />
        <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => chooseFile(e.target.files?.[0] || null)} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          {file ? file.name : 'ជ្រើសឯកសារសំឡេង (៦–១៥ វិនាទី)'}
        </Button>
        <p className="text-xs text-mute">
          ឈ្មោះ៖ <span className="font-mono">{voiceName}</span> / {emotion}
        </p>
        {checking && <p className="text-xs text-mute">កំពុងពិនិត្យគុណភាព…</p>}
        {report && <VoiceReportCard report={report} />}
        <Button block disabled={!file || checking} loading={saving} variant={report?.verdict === 'poor' ? 'secondary' : 'primary'} onClick={save}>
          {report?.verdict === 'poor' ? 'រក្សាទុកទោះមិនល្អ' : 'រក្សាទុក'}
        </Button>
      </div>
    </Sheet>
  );
};

const CHECKLIST = [
  ['មនុស្សតែម្នាក់', 'និយាយធម្មតា គ្មានអ្នកផ្សេងនិយាយជាន់'],
  ['៨–១៥ វិនាទី', 'សំឡេងនិយាយពិត (មិនរាប់ពេលស្ងាត់) ខ្លីជាង ៣ វិនាទី = មិនច្បាស់'],
  ['គ្មានភ្លេង/សំឡេងរំខាន', 'បើយកពីវីដេអូ ត្រូវប្រើ «ពីវីដេអូ» ដើម្បីដកភ្លេងចេញមុន'],
  ['មិនបែក (clipping)', 'ថតឲ្យសំឡេងមិនខ្លាំងពេក'],
  ['គុណភាពខ្ពស់', 'WAV ឬ M4A/MP3 ≥ 128 kbps ជៀសវាងសំឡេងទូរស័ព្ទ'],
  ['អ្នកនិយាយខ្មែរពិត', 'សំឡេងក្លូនយកសំនៀង (accent) តាមគំរូ'],
  ['មានអត្ថបទ (ជម្រើស)', 'ពាក្យនិយាយត្រូវគ្នា ១០០% → «Ultimate Cloning» ដូចជាង'],
];

/** Pick any recording and see whether it will clone well, without saving it. */
const SampleChecker: React.FC = () => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<VoiceReport | null>(null);
  const [name, setName] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const pick = async (f: File) => {
    setBusy(true);
    setName(f.name);
    setReport(null);
    try {
      setReport((await api.checkVoice(f)).report);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <h2 className="text-sm font-bold text-ink flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-accent" /> ពិនិត្យសំឡេងគំរូ មុនក្លូន
      </h2>
      <ul className="flex flex-col gap-1.5">
        {CHECKLIST.map(([title, hint]) => (
          <li key={title} className="text-xs leading-relaxed">
            <span className="font-semibold text-ink">✓ {title}</span> <span className="text-mute">— {hint}</span>
          </li>
        ))}
      </ul>
      <input ref={ref} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f); }} />
      <Button variant="secondary" loading={busy} onClick={() => ref.current?.click()}>
        {busy ? 'កំពុងពិនិត្យ…' : 'ជ្រើសឯកសារសំឡេង ដើម្បីពិនិត្យ'}
      </Button>
      {name && report && <p className="text-[11px] text-mute truncate">{name}</p>}
      {report && <VoiceReportCard report={report} />}
    </Card>
  );
};

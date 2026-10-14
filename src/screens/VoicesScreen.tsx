import React, { useRef, useState } from 'react';
import { Mic, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { km } from '../lib/cast';
import type { BankVoice, User, VoxcpmStatus } from '../lib/types';
import { Button, Card, EmptyState, PlayButton, Sheet, useToast } from '../components/ui';
import { prettyBankName } from '../components/CharacterCard';

interface Props {
  user: User;
  bank: BankVoice[];
  bankOnline: boolean;
  bankMessage?: string;
  vox: VoxcpmStatus | null;
  reload: () => void;
}

export const VoicesScreen: React.FC<Props> = ({ user, bank, bankOnline, bankMessage, vox, reload }) => {
  const toast = useToast();
  const admin = user.role === 'admin';
  const [adding, setAdding] = useState(false);
  const groups: { title: string; items: BankVoice[] }[] = [
    { title: 'សំឡេងប្រុស', items: bank.filter((v) => v.gender === 'male') },
    { title: 'សំឡេងស្រី', items: bank.filter((v) => v.gender === 'female') },
    { title: 'មិនទាន់ចាត់ថ្នាក់', items: bank.filter((v) => v.gender === 'unknown') },
  ].filter((g) => g.items.length);

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
          <p className="text-sm font-semibold text-slate-900">ម៉ាស៊ីនក្លូនសំឡេង VoxCPM2</p>
          <p className="text-xs text-slate-500 mt-0.5">{vox?.message || bankMessage || 'កំពុងពិនិត្យ…'}</p>
        </div>
      </Card>

      <p className="px-1 text-xs text-slate-500 leading-relaxed">
        ធនាគារសំឡេង៖ ពេលតួមួយប្រើ "Auto" ប្រព័ន្ធជ្រើសសំឡេងមួយពីទីនេះតាមភេទ ហើយតួនោះទទួលសំឡេងដដែលជានិច្ច។ តួពីរនាក់មិនជាន់សំឡេងគ្នាទេ (បើមានសំឡេងគ្រប់គ្រាន់)។
      </p>

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
            <h2 className="px-1 text-xs font-bold text-slate-500">
              {g.title} ({km(g.items.length)})
            </h2>
            {g.items.map((v) => (
              <Card key={v.id} className="px-4 py-3 flex items-center gap-3">
                <PlayButton src={v.previewUrl} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{prettyBankName(v.name)}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {v.name} · អារម្មណ៍: {v.emotions.join(', ')}
                  </p>
                </div>
                {admin && (
                  <button
                    type="button"
                    onClick={() => remove(v)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50"
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
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const nextNumber =
    Math.max(0, ...existing.filter((v) => v.name.startsWith(`${gender}-${age}-`)).map((v) => Number(v.name.split('-')[2]) || 0)) + 1;
  const voiceName = target === '__new' ? `${gender}-${age}-${nextNumber}` : target;

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      await api.adminAddBankVoice({ voice: voiceName, emotion, transcript, file });
      toast(`✓ បានបន្ថែម ${voiceName} / ${emotion}`, 'success');
      setFile(null);
      setTranscript('');
      onAdded();
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const select = 'w-full rounded-xl ring-1 ring-slate-300 bg-white px-3 min-h-[44px] text-sm';
  return (
    <Sheet open={open} onClose={onClose} title="បន្ថែមសំឡេង">
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">
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
            <label className="text-xs font-semibold text-slate-600">
              ភេទ
              <select value={gender} onChange={(e) => setGender(e.target.value as any)} className={`${select} mt-1`}>
                <option value="male">ប្រុស</option>
                <option value="female">ស្រី</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
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
        <label className="text-xs font-semibold text-slate-600">
          អារម្មណ៍
          <select value={emotion} onChange={(e) => setEmotion(e.target.value)} className={`${select} mt-1`}>
            {EMOTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          អត្ថបទដែលនិយាយក្នុងសំឡេង (ជម្រើស — ធ្វើឲ្យដូចជាង)
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl ring-1 ring-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          {file ? file.name : 'ជ្រើសឯកសារសំឡេង (៦–១៥ វិនាទី)'}
        </Button>
        <p className="text-xs text-slate-500">
          ឈ្មោះ៖ <span className="font-mono">{voiceName}</span> / {emotion}
        </p>
        <Button block disabled={!file} loading={saving} onClick={save}>
          រក្សាទុក
        </Button>
      </div>
    </Sheet>
  );
};

import React, { useState } from 'react';
import { Download, ExternalLink, Film, Play, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { km } from '../lib/cast';
import type { VideoResult } from '../lib/types';
import { Button, Card, EmptyState, useToast } from '../components/ui';
import { openExternal } from './CreateScreen';

const when = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${km(d.getDate())}/${km(d.getMonth() + 1)}/${km(d.getFullYear())} ${km(String(d.getHours()).padStart(2, '0'))}:${km(
    String(d.getMinutes()).padStart(2, '0')
  )}`;
};

export const VideosScreen: React.FC<{ items: VideoResult[] | null; reload: () => void; onCreate: () => void }> = ({ items, reload, onCreate }) => {
  const toast = useToast();
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = async (v: VideoResult) => {
    if (!window.confirm(`លុប "${v.name}"?`)) return;
    setDeleting(v.id);
    try {
      await api.deleteVideoResult(v.id);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setDeleting(null);
    }
  };

  if (items === null) return <p className="text-sm text-slate-500 text-center py-10">កំពុងផ្ទុក…</p>;
  if (!items.length)
    return (
      <Card>
        <EmptyState icon={Film} title="មិនទាន់មានវីដេអូ" body="វីដេអូដែលអ្នកបង្កើតនឹងនៅទីនេះ">
          <Button onClick={onCreate}>បង្កើតវីដេអូដំបូង</Button>
        </EmptyState>
      </Card>
    );

  return (
    <div className="flex flex-col gap-3">
      {items.map((v) => (
        <Card key={v.id} className="overflow-hidden">
          {playing === v.id && v.exists !== false ? (
            <video src={v.video} controls autoPlay playsInline className="w-full bg-black max-h-[60vh]" />
          ) : (
            <button
              type="button"
              disabled={v.exists === false}
              onClick={() => setPlaying(v.id)}
              className="relative w-full aspect-video bg-slate-900 flex items-center justify-center disabled:opacity-60"
              aria-label={`លេង ${v.name}`}
            >
              {v.exists !== false && (
                <video src={`${v.video}#t=0.5`} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
              )}
              <span className="relative w-14 h-14 rounded-full bg-white/90 flex items-center justify-center">
                <Play className="w-6 h-6 text-slate-900 ml-1" />
              </span>
            </button>
          )}
          <div className="p-4">
            <p className="text-sm font-bold text-slate-900 break-all">{v.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {when(v.createdAt)} · {km(v.lines)} ឃ្លា{v.hasSubtitles ? ' · មានអក្សរ' : ''}
              {v.exists === false && <span className="text-red-600"> · ឯកសារត្រូវបានលុប</span>}
            </p>
            <div className="mt-3 flex gap-2">
              <a
                href={v.video}
                download={v.name}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] bg-blue-600 text-white text-sm font-semibold"
              >
                <Download className="w-4 h-4" /> ទាញយក
              </a>
              <Button variant="secondary" aria-label="បើកក្នុង Browser" onClick={() => openExternal(v.video)}>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button variant="danger" aria-label="លុប" loading={deleting === v.id} onClick={() => remove(v)}>
                {deleting !== v.id && <Trash2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

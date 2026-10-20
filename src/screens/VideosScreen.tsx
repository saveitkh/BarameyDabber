import React, { useEffect, useState } from 'react';
import { Clapperboard, Clock, Combine, Download, ExternalLink, Film, FilePlus2, Loader2, Play, Trash2, X } from 'lucide-react';
import { api, withToken } from '../lib/api';
import { km } from '../lib/cast';
import { forgetUpload, listRecent, stillOnServer } from '../lib/recent';
import type { LongDubProject, ProjectFile, User, VideoResult } from '../lib/types';
import { Button, Card, EmptyState, useToast } from '../components/ui';
import { openExternal } from './CreateScreen';

const when = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${km(d.getDate())}/${km(d.getMonth() + 1)}/${km(d.getFullYear())} ${km(String(d.getHours()).padStart(2, '0'))}:${km(
    String(d.getMinutes()).padStart(2, '0')
  )}`;
};

interface Props {
  user: User;
  items: VideoResult[] | null;
  reload: () => void;
  onUpload: () => void;
  onResume: (f: ProjectFile) => void;
  onContinueLong: () => void;
}

export const VideosScreen: React.FC<Props> = ({ user, items, reload, onUpload, onResume, onContinueLong }) => {
  const toast = useToast();
  const [drafts, setDrafts] = useState(() => listRecent(user));
  useEffect(() => {
    let live = true;
    Promise.all(listRecent(user).map(async (r) => ((await stillOnServer(r.filename)) ? null : r.filename))).then((gone) => {
      if (!live) return;
      gone.forEach((f) => f && forgetUpload(user, f));
      setDrafts(listRecent(user));
    });
    return () => {
      live = false;
    };
  }, [user]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  const [longJobs, setLongJobs] = useState<LongDubProject[]>([]);
  useEffect(() => {
    let live = true;
    api.longdubList().then((r) => live && setLongJobs(r.items.filter((p) => p.status !== 'done'))).catch(() => {});
    return () => {
      live = false;
    };
  }, [items]);

  const LONG_STATUS: Record<string, string> = {
    scanning: 'កំពុងស្កេន',
    ready: 'ត្រៀមរួច — បន្តកែ/បង្កើត',
    rendering: 'កំពុងបង្កើត',
    error: 'មានបញ្ហា',
  };
  const longList = longJobs.length > 0 && (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-bold text-mute flex items-center gap-1.5">
        <Clapperboard className="w-3.5 h-3.5" /> វីដេអូវែង — កំពុងធ្វើ
      </h2>
      {longJobs.map((p) => {
        const busy = p.status === 'scanning' || p.status === 'rendering';
        return (
          <button
            key={p.id}
            type="button"
            onClick={onContinueLong}
            className="flex items-center gap-2.5 rounded-2xl bg-surface ring-1 ring-line px-3 py-3 text-left"
          >
            <span className="w-9 h-9 shrink-0 rounded-lg bg-raised flex items-center justify-center">
              {busy ? <Loader2 className="w-4 h-4 text-accent animate-spin" /> : <Clapperboard className="w-4 h-4 text-mute" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold text-ink truncate">{p.originalName || p.source}</span>
              <span className="block text-[11px] text-mute">
                {km(p.chunks?.length || p.renderTotal)} ចំណែក · {LONG_STATUS[p.status] || p.status}
                {p.status === 'rendering' ? ` (${km(p.renderDone)}/${km(p.renderTotal)})` : p.status === 'scanning' ? ` (${km(p.scanDone)}/${km(p.scanTotal)})` : ''}
              </span>
            </span>
            <span className="text-[11px] text-accent font-semibold shrink-0">បន្ត →</span>
          </button>
        );
      })}
    </section>
  );

  // Select finished parts and join them (in tap order) into one full video
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const exitMerge = () => {
    setMergeMode(false);
    setPicked([]);
  };
  const doMerge = async () => {
    if (picked.length < 2) {
      toast('ជ្រើសយ៉ាងតិច ២ វីដេអូ ដើម្បីបញ្ចូលគ្នា', 'warning');
      return;
    }
    setMerging(true);
    try {
      const first = (items || []).find((v) => v.id === picked[0]);
      await api.mergeVideos(picked, `${first?.name || 'វីដេអូ'}_ពេញ`);
      toast('បានបញ្ចូលគ្នាជាវីដេអូពេញ ✓', 'success');
      exitMerge();
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setMerging(false);
    }
  };

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

  const uploadButton = (
    <button
      type="button"
      onClick={onUpload}
      className="w-full rounded-2xl border-2 border-dashed border-line-strong hover:border-accent hover:bg-accent/5 py-5 flex items-center justify-center gap-2.5 text-sm font-bold text-accent transition-colors"
    >
      <FilePlus2 className="w-5 h-5" /> បញ្ចូលវីដេអូថ្មី
    </button>
  );
  const draftList = drafts.length > 0 && (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-bold text-mute flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> វីដេអូដែលបាន Upload — បន្តធ្វើ
      </h2>
      {drafts.map((r) => (
        <div key={r.filename} className="flex items-center gap-2 rounded-2xl bg-surface ring-1 ring-line pl-3 pr-1.5">
          <span className="w-9 h-9 shrink-0 rounded-lg bg-raised flex items-center justify-center">
            <Film className="w-4 h-4 text-mute" />
          </span>
          <button
            type="button"
            onClick={() => onResume({ filename: r.filename, originalName: r.originalName, size: r.size, url: `/media/uploads/${r.filename}` })}
            className="flex-1 min-w-0 py-3 text-left"
          >
            <span className="inline-block text-[10px] font-semibold text-mute bg-raised ring-1 ring-line rounded px-1.5 py-0.5">● ព្រាង</span>
            <span className="block text-[13px] font-semibold text-ink truncate mt-0.5">{r.originalName}</span>
            <span className="block text-[11px] text-accent font-semibold">បន្តធ្វើ →</span>
          </button>
          <button
            type="button"
            aria-label="ដកចេញ"
            onClick={() => {
              forgetUpload(user, r.filename);
              setDrafts(listRecent(user));
            }}
            className="w-9 h-9 rounded-full flex items-center justify-center text-mute"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </section>
  );

  if (items === null) return <p className="text-sm text-mute text-center py-10">កំពុងផ្ទុក…</p>;
  if (!items.length)
    return (
      <div className="flex flex-col gap-4">
        {uploadButton}
        {longList}
        {draftList}
        <Card>
          <EmptyState icon={Film} title="មិនទាន់មានវីដេអូដែលបានបង្កើត" body="វីដេអូដែលអ្នកបង្កើតរួចនឹងនៅទីនេះ" />
        </Card>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {uploadButton}
      {longList}
      {draftList}
      <div className="px-1 mt-1 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold text-mute">វីដេអូរួចរាល់</h2>
        {items.length >= 2 &&
          (mergeMode ? (
            <button type="button" onClick={exitMerge} className="text-[11px] font-semibold text-mute">
              បោះបង់
            </button>
          ) : (
            <button type="button" onClick={() => setMergeMode(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Combine className="w-3.5 h-3.5" /> បញ្ចូលគ្នាជាវីដេអូពេញ
            </button>
          ))}
      </div>
      {mergeMode && (
        <p className="px-1 -mt-1 text-[11px] text-mute">ចុចវីដេអូខ្លីៗ តាមលំដាប់ដែលចង់ភ្ជាប់ — លេខបង្ហាញលំដាប់</p>
      )}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-4">
      {items.map((v) => {
        const order = picked.indexOf(v.id);
        const selectable = mergeMode && v.exists !== false;
        return (
        <Card key={v.id} className={`overflow-hidden ${order >= 0 ? 'ring-2 ring-accent' : ''}`}>
          {!mergeMode && playing === v.id && v.exists !== false ? (
            <video src={withToken(v.video)} controls autoPlay playsInline className="w-full bg-black max-h-[60vh]" />
          ) : (
            <button
              type="button"
              disabled={mergeMode ? !selectable : v.exists === false}
              onClick={() => (mergeMode ? selectable && togglePick(v.id) : setPlaying(v.id))}
              className="relative w-full aspect-video bg-raised flex items-center justify-center disabled:opacity-60"
              aria-label={mergeMode ? `ជ្រើស ${v.name}` : `លេង ${v.name}`}
            >
              {v.exists !== false && (
                <video src={`${withToken(v.video)}#t=0.5`} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
              )}
              {mergeMode ? (
                <span
                  className={`relative w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ring-2 ${
                    order >= 0 ? 'bg-accent text-white ring-accent' : 'bg-black/50 text-white ring-white/70'
                  }`}
                >
                  {order >= 0 ? km(order + 1) : ''}
                </span>
              ) : (
                <span className="relative w-14 h-14 rounded-full bg-black/60 text-white flex items-center justify-center">
                  <Play className="w-6 h-6 text-white ml-1" />
                </span>
              )}
            </button>
          )}
          <div className="p-4">
            <p className="text-sm font-bold text-ink break-all">{v.name}</p>
            <p className="text-xs text-mute mt-0.5">
              {when(v.createdAt)} · {km(v.lines)} ឃ្លា
              {v.exists === false && <span className="text-bad"> · ឯកសារត្រូវបានលុប</span>}
            </p>
            {!mergeMode && (
              <div className="mt-3 flex gap-2">
                <a
                  href={withToken(v.video)}
                  download={v.name}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-semibold"
                >
                  <Download className="w-4 h-4" /> ទាញយក
                </a>
                <Button variant="secondary" aria-label="បើកក្នុង Browser" onClick={() => openExternal(withToken(v.video))}>
                  <ExternalLink className="w-4 h-4" />
                </Button>
                <Button variant="danger" aria-label="លុប" loading={deleting === v.id} onClick={() => remove(v)}>
                  {deleting !== v.id && <Trash2 className="w-4 h-4" />}
                </Button>
              </div>
            )}
          </div>
        </Card>
        );
      })}
      </div>
      {mergeMode && (
        <div className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] lg:bottom-4 z-10 flex items-center gap-3 rounded-2xl bg-surface ring-1 ring-line shadow-lg px-4 py-3">
          <span className="flex-1 text-[13px] font-semibold text-ink">បានជ្រើស {km(picked.length)} វីដេអូ</span>
          <Button onClick={doMerge} loading={merging} disabled={picked.length < 2}>
            <Combine className="w-4 h-4" /> បញ្ចូលគ្នា
          </Button>
        </div>
      )}
    </div>
  );
};

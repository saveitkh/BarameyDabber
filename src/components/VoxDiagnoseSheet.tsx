import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCopy, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import type { VoxDiagnosis } from '../lib/types';
import { Button, Sheet, useToast } from './ui';

/** Admin only: why VoxCPM2 is not connected — step by step, the fix, and the recent error log. */
export const VoxDiagnoseSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const toast = useToast();
  const [d, setD] = useState<VoxDiagnosis | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      setD(await api.adminVoxDiagnose());
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) run();
  }, [open, run]);

  const copy = async () => {
    if (!d) return;
    const text = [
      `VoxCPM2 diagnose — ${d.ok ? 'OK' : 'PROBLEM'}`,
      `URL: ${d.url || '-'} (${d.source})`,
      ...d.checks.map((c) => `${c.ok ? '[ok]' : '[FAIL]'} ${c.name}: ${c.detail}`),
      `Cause: ${d.cause}`,
      `Fix: ${d.fix}`,
      '--- recent errors ---',
      ...d.log.map((l) => `${l.at} ${l.where} ${l.code} ${l.raw}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('✓ បានចម្លងរបាយការណ៍', 'success');
    } catch {
      toast('ចម្លងមិនបាន — ថតអេក្រង់ជំនួស', 'warning');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="ពិនិត្យការតភ្ជាប់ VoxCPM2">
      {!d ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-mute">
          <Loader2 className="w-4 h-4 animate-spin" /> កំពុងពិនិត្យ…
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className={`rounded-2xl p-3.5 ring-1 ${d.ok ? 'bg-emerald-500/10 ring-emerald-500/30' : 'bg-red-500/10 ring-red-500/30'}`}>
            <p className={`text-sm font-bold ${d.ok ? 'text-ok' : 'text-bad'}`}>{d.ok ? '● ភ្ជាប់បានល្អ' : '● មូលហេតុ'}</p>
            <p className="text-sm text-ink mt-1 leading-relaxed">{d.cause}</p>
            {d.fix && (
              <p className="text-xs text-ink-2 mt-2 leading-relaxed">
                <b>វិធីដោះស្រាយ៖</b> {d.fix}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-mute mb-1.5">ជំហានពិនិត្យ</p>
            <ol className="flex flex-col gap-1.5">
              {d.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2 text-xs">
                  {c.ok ? <CheckCircle2 className="w-4 h-4 text-ok shrink-0" /> : <XCircle className="w-4 h-4 text-bad shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <b className="text-ink">{c.name}</b>
                    <span className="block text-mute font-mono break-all">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="text-xs font-bold text-mute mb-1.5">Log កំហុសចុងក្រោយ ({d.log.length})</p>
            {d.log.length === 0 ? (
              <p className="text-xs text-mute">មិនទាន់មានកំហុសក្នុងអង្គចងចាំ (Log ត្រូវសម្អាតពេល studio ចាប់ផ្ដើមឡើងវិញ)។</p>
            ) : (
              <ul className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                {d.log.map((l, i) => (
                  <li key={i} className="rounded-lg bg-raised px-2.5 py-1.5 text-[11px] leading-snug">
                    <span className="font-mono text-mute">{l.at}</span> · <b className="text-ink-2">{l.where}</b>
                    <span className="block text-ink-2">{l.cause}</span>
                    <span className="block font-mono text-mute break-all">{l.raw}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-mute leading-relaxed">
            លើ VPS ក៏អាចមើល៖ <span className="font-mono">docker compose ps</span> · <span className="font-mono">docker compose logs --tail=80 voxcpm</span> · <span className="font-mono">docker compose logs --tail=80 studio</span> · <span className="font-mono">free -h</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" loading={busy} onClick={run}>
              <RefreshCw className="w-4 h-4" /> ពិនិត្យម្ដងទៀត
            </Button>
            <Button variant="secondary" onClick={copy}>
              <ClipboardCopy className="w-4 h-4" /> ចម្លងរបាយការណ៍
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
};

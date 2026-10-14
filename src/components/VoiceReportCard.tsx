import React from 'react';
import { CircleAlert, CircleCheck, CircleX, Lightbulb } from 'lucide-react';
import { km } from '../lib/cast';
import type { VoiceReport } from '../lib/types';

const TONE = {
  good: { ring: 'ring-emerald-200 bg-emerald-50', text: 'text-emerald-800', Icon: CircleCheck, bar: 'bg-emerald-500' },
  ok: { ring: 'ring-amber-200 bg-amber-50', text: 'text-amber-800', Icon: CircleAlert, bar: 'bg-amber-500' },
  poor: { ring: 'ring-red-200 bg-red-50', text: 'text-red-800', Icon: CircleX, bar: 'bg-red-500' },
} as const;

/** The result of checking a voice sample: verdict, score, and exactly what to fix. */
export const VoiceReportCard: React.FC<{ report: VoiceReport }> = ({ report }) => {
  const t = TONE[report.verdict];
  const m = report.metrics;
  return (
    <div className={`rounded-2xl ring-1 p-4 flex flex-col gap-3 ${t.ring}`} role="status">
      <div className="flex items-center gap-3">
        <t.Icon className={`w-6 h-6 shrink-0 ${t.text}`} />
        <p className={`flex-1 text-sm font-bold ${t.text}`}>{report.label}</p>
        <span className={`text-sm font-bold tabular-nums ${t.text}`}>{km(report.score)}/{km(100)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/70 overflow-hidden">
        <div className={`h-full ${t.bar}`} style={{ width: `${report.score}%` }} />
      </div>
      {report.tips.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {report.tips.map((tip) => (
            <li key={tip} className="text-xs text-slate-800 leading-relaxed flex gap-2">
              <span aria-hidden>•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}
      {report.notes.map((n) => (
        <p key={n} className="text-xs text-slate-600 leading-relaxed flex gap-2">
          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {n}
        </p>
      ))}
      <p className="text-[11px] text-slate-500">
        សំឡេងនិយាយ {km(Math.round(m.speech))} វិនាទី · សម្លេងរំខាន {m.snr >= 30 ? 'តិច' : m.snr >= 20 ? 'បន្តិច' : 'ច្រើន'} · កម្រិត {km(Math.round(m.level))} dB
      </p>
    </div>
  );
};

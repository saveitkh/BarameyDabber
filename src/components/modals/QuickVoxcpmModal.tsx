import React, { useState, useEffect } from 'react';
import { X, Zap, RefreshCw, Check, Clipboard, ExternalLink } from 'lucide-react';
import { api } from '../../services/api';

/** Pull the tunnel link out of whatever was pasted (Colab prints it inside a sentence). */
const extractUrl = (raw: string): string => {
  const text = (raw || '').trim();
  const tunnel = text.match(/https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (tunnel) return tunnel[0];
  const any = text.match(/https?:\/\/[^\s'"<>]+/);
  return (any ? any[0] : text).replace(/\/+$/, '');
};

const STEPS: React.ReactNode[] = [
  <>
    បើក{' '}
    <a href="https://colab.research.google.com" target="_blank" rel="noreferrer" className="text-sky-400 underline inline-flex items-center gap-0.5">
      Google Colab <ExternalLink className="w-3 h-3" />
    </a>{' '}
    → <b>File → Upload notebook</b> → ជ្រើសឯកសារ <code className="text-sky-300">VoxCPM2_Khmer_Colab.ipynb</code> (នៅក្នុង Folder កម្មវិធីនេះ)
  </>,
  <>
    <b>Runtime → Change runtime type → T4 GPU → Save</b>
  </>,
  <>
    <b>Runtime → Run all</b> រង់ចាំ ៣–៥ នាទី រហូតឃើញ <code className="text-emerald-300">🎉 VOXCPM2 API PUBLIC URL: https://….trycloudflare.com</code>
  </>,
  <>Copy Link នោះ → ចុច <b>Paste</b> ខាងលើ → <b>រក្សាទុក & ភ្ជាប់</b></>,
];

interface QuickVoxcpmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onRefreshStatus: () => void;
}

export const QuickVoxcpmModal: React.FC<QuickVoxcpmModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
  onRefreshStatus,
}) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      api.getConfig().then((cfg) => {
        if (cfg.voxcpmUrl) setUrl(cfg.voxcpmUrl);
        else if (cfg.cloudUrl) setUrl(cfg.cloudUrl);
      }).catch(() => {});
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.includes('http')) {
        setUrl(extractUrl(text));
        setTestResult(null);
        onShowToast('បានបិទភ្ជាប់ URL រួចរាល់!', 'success');
      } else {
        onShowToast('Clipboard មិនមាន Link ទេ — សូម Copy Link ពី Colab ម្តងទៀត', 'info');
      }
    } catch (_) {
      onShowToast('សូមចុច Ctrl+V ដើម្បី Paste ផ្ទាល់', 'info');
    }
  };

  /** Save the URL that is in the box (not the old one) and switch the engine to it. */
  const saveUrl = async (): Promise<string> => {
    const clean = extractUrl(url);
    setUrl(clean);
    await api.updateConfig({ voxcpmUrl: clean });
    await api.switchVoxcpmMode(clean.includes('127.0.0.1') || clean.includes('localhost') ? 'local' : 'cloud', clean);
    return clean;
  };

  const checkConnection = async (): Promise<boolean> => {
    const st = await api.getVoxcpmStatus();
    const ok = Boolean(st.online && st.mode !== 'pure_khmer' && st.mode !== 'elevenlabs');
    setTestResult(
      ok
        ? { ok: true, msg: '✅ ភ្ជាប់បានជោគជ័យ! VoxCPM2 GPU ដំណើរការ — សំឡេងតួដែល Upload នឹងត្រូវក្លូន។' }
        : {
            ok: false,
            msg: /timed out|រវល់/i.test(st.message || '')
              ? '⏳ Colab កំពុងរវល់ (កំពុងផ្ទុក Model ឬបង្កើតសំឡេង) — រង់ចាំ ១ នាទី រួចតេស្តម្តងទៀត'
              : `⚠️ មិនទាន់ឆ្លើយតប (${st.message || 'offline'}) — ពិនិត្យថា Colab នៅ Run, Cell ចុងក្រោយមិនទាន់ឈប់ ហើយ Link ត្រូវជា Link ថ្មីចុងក្រោយ`,
          }
    );
    return ok;
  };

  const handleTestConnection = async () => {
    if (!url.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      await saveUrl();
      await checkConnection();
    } catch (e: any) {
      setTestResult({ ok: false, msg: `កំហុស: ${e.message}` });
    } finally {
      setIsTesting(false);
      onRefreshStatus();
    }
  };

  const handleSave = async () => {
    if (!url.trim()) return;
    setIsLoading(true);
    try {
      await saveUrl();
      const ok = await checkConnection();
      onRefreshStatus();
      if (ok) {
        onShowToast('បានភ្ជាប់ VoxCPM2 Cloud GPU រួចរាល់!', 'success');
        onClose();
      } else {
        onShowToast('បានរក្សាទុក Link ប៉ុន្តែ VoxCPM2 មិនទាន់ឆ្លើយតប — មើលសារខាងក្រោម', 'info');
      }
    } catch (e: any) {
      onShowToast(`កំហុស: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-white/[0.1] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header with real app logo */}
        <div className="p-4 px-6 border-b border-white/[0.08] flex items-center justify-between bg-[#0b0f19]">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-7 h-7 rounded-lg border border-sky-400/40 shadow-[0_0_10px_rgba(56,189,248,0.4)] object-cover"
            />
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5 font-ui">
                <Zap className="w-4 h-4 text-emerald-400" />
                <span>ភ្ជាប់ម៉ាស៊ីន VoxCPM2 Cloud GPU</span>
              </h3>
              <p className="text-[10px] text-slate-400">Google Colab / Kaggle Cloudflare Tunnel</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.05]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4 text-xs">
          <div>
            <label className="font-semibold text-slate-200 block mb-1.5">
              🚀 VoxCPM2 Public URL (ពី Google Colab / Kaggle)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTestResult(null);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  setUrl(extractUrl(e.clipboardData.getData('text')));
                  setTestResult(null);
                }}
                placeholder="https://xxxx.trycloudflare.com"
                className="flex-1 bg-[#07090e] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-slate-100 outline-none focus:border-sky-400 font-mono text-xs transition-colors"
              />
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 border border-white/[0.1] flex items-center gap-1.5 shrink-0 transition-colors"
                title="Paste ពី Clipboard"
              >
                <Clipboard className="w-3.5 h-3.5 text-sky-400" />
                <span>Paste</span>
              </button>
            </div>
          </div>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs leading-relaxed ${
                testResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              {testResult.msg}
            </div>
          )}

          {/* How to get the URL */}
          <div className="p-3.5 rounded-xl bg-sky-500/[0.05] border border-sky-500/20 flex flex-col gap-2">
            <p className="text-sky-300 font-semibold text-xs">របៀបយក Link (ឥតគិតថ្លៃ ប្រើ GPU របស់ Google)</p>
            <ol className="flex flex-col gap-1.5 text-slate-300 text-[11px] leading-relaxed">
              {STEPS.map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-4 h-4 shrink-0 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="text-slate-400 text-[10.5px] leading-relaxed border-t border-white/[0.06] pt-2">
              ⚠️ Link ប្ដូររាល់ពេល Colab ចាប់ផ្ដើមថ្មី ហើយ Colab ឥតគិតថ្លៃបិទខ្លួនឯងពេលទុកចោលយូរ — ពេលនោះ Run all ម្តងទៀត ហើយដាក់ Link ថ្មី។
              បើមិនភ្ជាប់ VoxCPM2 ទេ កម្មវិធីនៅតែប្រើបាន (ប្រើសំឡេងខ្មែរ AI ធម្មតា) តែសំឡេងនឹងមិនដូចសំឡេងតួដែលអ្នក Upload។
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 border-t border-white/[0.08] bg-[#0b0f19] flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 text-xs flex items-center gap-1.5 border border-white/[0.08] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isTesting ? 'animate-spin' : ''}`} />
            <span>{isTesting ? 'កំពុងតេស្ត...' : 'តេស្តការតភ្ជាប់'}</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors"
            >
              បោះបង់
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || !url.trim()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-sky-600/30 transition-all active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>{isLoading ? 'កំពុងរក្សា...' : 'រក្សាទុក & ភ្ជាប់'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

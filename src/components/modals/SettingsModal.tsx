import React, { useState, useEffect } from 'react';
import { X, Sliders, ExternalLink, Save, Copy, HardDrive, Trash2, LogOut, User as UserIcon, Calendar, ShieldCheck, Sparkles, Clock, Crown, Infinity, Zap } from 'lucide-react';
import { api } from '../../services/api';
import { User } from '../../types';
import { getSubscriptionInfo } from '../../utils/subscription';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onRefreshConfig: () => void;
  user?: User | null;
  onLogout?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
  onRefreshConfig,
  user,
  onLogout,
}) => {
  const [elevenKey, setElevenKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-flash-latest');
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [geminiTest, setGeminiTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [voxcpmUrl, setVoxcpmUrl] = useState('');
  const [lanUrl, setLanUrl] = useState('');
  const [diskStats, setDiskStats] = useState<{ formattedSize: string; count: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      api.getConfig().then((cfg) => {
        if (cfg.geminiModel) setGeminiModel(cfg.geminiModel);
        if (cfg.voxcpmUrl) setVoxcpmUrl(cfg.voxcpmUrl);
        if (cfg.hasGemini) {
          api.testGeminiKey().then((r) => {
            setGeminiTest(r);
            setGeminiModels(r.models || []);
          }).catch(() => {});
        }
      });
      api.getNetworkInfo().then((net) => {
        if (net.primaryLanUrl) setLanUrl(net.primaryLanUrl);
      });
      api.getOutputStats().then((stats) => {
        setDiskStats(stats);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestGemini = async () => {
    setIsTestingGemini(true);
    try {
      const r = await api.testGeminiKey(geminiKey.trim() || undefined);
      setGeminiTest(r);
      setGeminiModels(r.models || []);
      if (r.ok && r.models.length && !r.models.includes(geminiModel) && geminiModel !== 'gemini-flash-latest') {
        setGeminiModel('gemini-flash-latest');
      }
    } catch (e: any) {
      setGeminiTest({ ok: false, message: e.message });
    } finally {
      setIsTestingGemini(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.updateConfig({
        elevenlabsKey: elevenKey || undefined,
        geminiKey: geminiKey || undefined,
        geminiModel,
        voxcpmUrl: voxcpmUrl || undefined,
      });
      onShowToast('រក្សាទុកការកំណត់ជោគជ័យ!', 'success');
      onRefreshConfig();
      onClose();
    } catch (e: any) {
      onShowToast(`កំហុស: ${e.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearOutputs = async () => {
    if (!confirm('តើអ្នកពិតជាចង់សម្អាតឯកសារ Output ទាំងអស់ដើម្បីសន្សំទំហំថាសមែនទេ?')) return;
    try {
      const res = await api.clearOutputs();
      if (res.success) {
        onShowToast(`បានសម្អាត ${res.count} ឯកសារ (សន្សំបាន ${res.formattedFreed})!`, 'success');
        api.getOutputStats().then(setDiskStats);
      }
    } catch (e: any) {
      onShowToast(`កំហុសក្នុងការសម្អាត: ${e.message}`, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-white/[0.1] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-white/[0.08] flex items-center justify-between bg-[#0b0f19]">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-7 h-7 rounded-lg border border-sky-400/40 shadow-[0_0_10px_rgba(56,189,248,0.4)] object-cover"
            />
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-ui">
              <span>ការកំណត់ API & ប្រព័ន្ធ (System & AI Config)</span>
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.05]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex flex-col gap-4 text-xs">
          {/* User Account & Subscription Status - Clean Aesthetic Card */}
          {user && (() => {
            const subInfo = getSubscriptionInfo(user);
            const isAdmin = user.role === 'admin';

            return (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#0f1422] to-[#0a0d16] border border-white/[0.08] p-4 shadow-lg flex flex-col gap-3.5">
                {/* Subtle top ambient glow */}
                <div className="absolute -top-10 -right-10 w-28 h-28 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

                {/* Top Profile Header */}
                <div className="relative flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Compact Avatar with status ring */}
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md border border-white/10">
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-[#0a0d16]" />
                    </div>

                    {/* Username & Role */}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-100 tracking-tight truncate max-w-[190px] sm:max-w-[260px]">
                        {user.username}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px]">
                        <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
                          <Crown className="w-3 h-3 text-amber-400 shrink-0" />
                          <span>{isAdmin ? 'Master Admin' : 'សមាជិក'}</span>
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          {subInfo.badge}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Logout Button */}
                  {onLogout && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onLogout();
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.03] hover:bg-rose-500/15 border border-white/[0.08] hover:border-rose-500/30 text-slate-400 hover:text-rose-300 text-xs font-medium transition-all active:scale-95 cursor-pointer shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5 text-rose-400" />
                      <span>ចាកចេញ</span>
                    </button>
                  )}
                </div>

                {/* Minimalist Stats Strip - Clean, Concise, No Clutter */}
                <div className="relative grid grid-cols-3 p-2 rounded-xl bg-black/30 border border-white/[0.05] divide-x divide-white/[0.06] text-center">
                  <div className="flex flex-col items-center px-1">
                    <span className="text-[10px] text-slate-400 font-medium">កញ្ចប់</span>
                    <span className="text-xs font-semibold text-slate-200 mt-0.5 truncate max-w-full">
                      {subInfo.title}
                    </span>
                  </div>

                  <div className="flex flex-col items-center px-1">
                    <span className="text-[10px] text-slate-400 font-medium">សុពលភាព</span>
                    <span className="text-xs font-semibold text-amber-300/90 mt-0.5 truncate max-w-full font-mono">
                      {subInfo.formattedDate || 'ពេញមួយជីវិត'}
                    </span>
                  </div>

                  <div className="flex flex-col items-center px-1">
                    <span className="text-[10px] text-slate-400 font-medium">ស្ថានភាព</span>
                    <span className={`text-xs font-semibold mt-0.5 flex items-center justify-center gap-1.5 ${
                      subInfo.isPremium ? 'text-emerald-400' : 'text-slate-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        subInfo.isPremium ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                      }`} />
                      <span>{subInfo.isPremium ? 'សកម្ម' : 'ផុតកំណត់'}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* ElevenLabs */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">គន្លឹះ ElevenLabs API (Voice Cloning)</span>
              <a
                href="https://elevenlabs.io"
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:underline flex items-center gap-1 text-[11px]"
              >
                <span>យក Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <input
              type="password"
              value={elevenKey}
              onChange={(e) => setElevenKey(e.target.value)}
              placeholder="sk_... (ទុកទំនេរប្រសិនបើបានកំណត់រួច)"
              className="bg-[#07090e] border border-white/[0.08] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-sky-400 font-mono"
            />
          </div>

          {/* Gemini API */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">គន្លឹះ Google Gemini API (Translation & Diarization)</span>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:underline flex items-center gap-1 text-[11px]"
              >
                <span>យក Key ឥតគិតថ្លៃ</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza... (ទុកទំនេរប្រសិនបើបានកំណត់រួច)"
                className="flex-1 min-w-0 bg-[#07090e] border border-white/[0.08] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-sky-400 font-mono"
              />
              <button
                type="button"
                onClick={handleTestGemini}
                disabled={isTestingGemini}
                className="px-3 py-2 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
              >
                {isTestingGemini ? 'កំពុងសាក...' : 'សាក Key'}
              </button>
            </div>
            {geminiTest && (
              <p className={`text-[11px] ${geminiTest.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{geminiTest.message}</p>
            )}
          </div>

          {/* Gemini Model */}
          <div className="flex flex-col gap-1.5">
            <label className="font-semibold text-slate-300">🤖 ម៉ូឌែល AI Gemini សម្រាប់ដំណើរការ</label>
            <select
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              className="bg-[#07090e] border border-white/[0.08] text-sky-400 font-semibold rounded-lg px-3 py-2 outline-none focus:border-sky-400"
            >
              <option value="gemini-flash-latest">🔄 Gemini Flash Latest (Recommended — Google ជ្រើសឲ្យស្វ័យប្រវត្តិ)</option>
              {geminiModels
                .filter((m) => m !== 'gemini-flash-latest')
                .map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              {geminiModel !== 'gemini-flash-latest' && !geminiModels.includes(geminiModel) && (
                <option value={geminiModel}>{geminiModel} (មិនទាន់ពិនិត្យ)</option>
              )}
            </select>
          </div>

          {/* VoxCPM URL */}
          <div className="flex flex-col gap-1.5">
            <label className="font-semibold text-slate-300">🚀 VoxCPM2 Kaggle / Colab Public URL</label>
            <input
              type="text"
              value={voxcpmUrl}
              onChange={(e) => setVoxcpmUrl(e.target.value)}
              placeholder="https://xxxx.trycloudflare.com"
              className="bg-[#07090e] border border-white/[0.08] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-sky-400 font-mono"
            />
          </div>

          {/* LAN Share Link */}
          <div className="bg-sky-500/[0.06] border border-sky-500/20 rounded-lg p-3.5 flex flex-col gap-2">
            <label className="font-semibold text-sky-300">🌐 ប្រើប្រាស់រួមគ្នាលើបណ្ដាញ Wi-Fi / LAN</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={lanUrl || 'កំពុងស្វែងរក...'}
                className="flex-1 bg-[#07090e] border border-white/[0.08] rounded px-3 py-1.5 text-sky-400 font-mono text-xs outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(lanUrl);
                  onShowToast('បានចម្លង Link LAN!', 'success');
                }}
                className="px-3 py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 flex items-center gap-1 shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>ចម្លង</span>
              </button>
            </div>
          </div>

          {/* Storage Cleanup */}
          <div className="bg-rose-500/[0.06] border border-rose-500/20 rounded-lg p-3.5 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-rose-300 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                <span>ទំហំឯកសារ Output & សម្អាតទំហំថាស</span>
              </span>
              <span className="font-mono text-rose-400 font-semibold">{diskStats?.formattedSize || '...'}</span>
            </div>
            <p className="text-[11px] text-slate-400">
              លុបឯកសារ Output ចាស់ៗក្នុងថត outputs/ ដើម្បីសន្សំទំហំថាសកុំព្យូទ័រ។
            </p>
            <button
              onClick={handleClearOutputs}
              className="self-start px-3 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 flex items-center gap-1.5 text-xs transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>សម្អាតឯកសារ Output ទាំងអស់</span>
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 border-t border-white/[0.08] bg-[#0b0f19] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs transition-colors"
          >
            បោះបង់
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs transition-colors shadow-md shadow-sky-500/20"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'កំពុងរក្សាទុក...' : 'រក្សាទុកការកំណត់'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

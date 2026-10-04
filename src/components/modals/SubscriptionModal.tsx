import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles, Crown, CheckCircle2, Loader2, QrCode, Clock, AlertTriangle } from 'lucide-react';
import { api } from '../../services/api';
import { SubscriptionOrder, SubscriptionPlan, SubscriptionStatus, User } from '../../types';

interface SubscriptionModalProps {
  isOpen: boolean;
  user?: User | null;
  reason?: 'trial_exhausted' | null;
  onClose: () => void;
  onSubscribed: (user: User) => void;
  onShowToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const PAY_WINDOW_SEC = 10 * 60;
const POLL_MS = 3000;

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ isOpen, user, reason, onClose, onSubscribed, onShowToast }) => {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [khqrConfigured, setKhqrConfigured] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [order, setOrder] = useState<SubscriptionOrder | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PAY_WINDOW_SEC);
  const [showKhqrAdmin, setShowKhqrAdmin] = useState(false);
  const [khqrInput, setKhqrInput] = useState('');
  const [savingKhqr, setSavingKhqr] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    pollRef.current = null;
    tickRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopPolling();
      setOrder(null);
      return;
    }
    setLoadingPlans(true);
    api
      .getSubscriptionPlans()
      .then((res) => {
        setPlans(res.plans);
        setStatus(res.status);
        setKhqrConfigured(res.khqrConfigured);
      })
      .catch(() => onShowToast('មិនអាចផ្ទុកគម្រោង Subscription បានទេ', 'error'))
      .finally(() => setLoadingPlans(false));
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const beginPoll = (ticket: string) => {
    stopPolling();
    setSecondsLeft(PAY_WINDOW_SEC);
    tickRef.current = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.pollSubscriptionOrder(ticket);
        setOrder((prev) => (prev ? { ...prev, status: res.order.status } : prev));
        setStatus(res.status);
        if (res.order.status === 'paid') {
          stopPolling();
          onShowToast('🎉 ទូទាត់ជោគជ័យ! Subscription របស់អ្នកដំណើរការហើយ', 'success');
          api.getMe().then((me) => me?.user && onSubscribed(me.user)).catch(() => {});
        } else if (res.order.status === 'expired') {
          stopPolling();
        }
      } catch {
        // transient network hiccup -- next tick tries again
      }
    }, POLL_MS);
  };

  const saveKhqr = async () => {
    if (!khqrInput.trim()) return;
    setSavingKhqr(true);
    try {
      await api.adminSetKhqrTemplate(khqrInput.trim());
      onShowToast('បានរក្សាទុក KHQR សម្រាប់ Subscription', 'success');
      setKhqrInput('');
      setShowKhqrAdmin(false);
      const res = await api.getSubscriptionPlans();
      setPlans(res.plans);
      setStatus(res.status);
      setKhqrConfigured(res.khqrConfigured);
    } catch (err: any) {
      onShowToast(err?.message || 'QR មិនត្រឹមត្រូវទេ', 'error');
    } finally {
      setSavingKhqr(false);
    }
  };

  const pickPlan = async (planId: 'monthly' | 'unlimited') => {
    setCreating(planId);
    try {
      const res = await api.createSubscriptionOrder(planId);
      setOrder(res.order);
      beginPoll(res.order.ticket);
    } catch (err: any) {
      onShowToast(err?.message || 'មិនអាចបង្កើត QR បានទេ', 'error');
    } finally {
      setCreating(null);
    }
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-amber-500/30 rounded-2xl w-full max-w-xl overflow-hidden shadow-[0_0_35px_rgba(245,158,11,0.15)] flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-transparent">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-white">Subscription</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {reason === 'trial_exhausted' && !order && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Trial Export របស់អ្នកអស់ហើយ — ជ្រើសរើសគម្រោងខាងក្រោមដើម្បីបន្តប្រើប្រាស់។</span>
            </div>
          )}

          {status && status.plan === 'free' && !order && (
            <div className="text-[13px] text-slate-400">
              Trial នៅសល់ <span className="font-bold text-slate-200">{status.trialRemaining}</span> / {status.trialLimit} វគ្គ
            </div>
          )}

          {!khqrConfigured && !order && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Server នេះមិនទាន់បានកំណត់ KHQR ទេ
                {user?.role === 'admin' ? ' — សូមដាក់ KHQR ខាងក្រោម' : ' — សូមប្រាប់ Admin ដាក់ QR ជាមុន'}។
              </span>
            </div>
          )}

          {user?.role === 'admin' && !order && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <button
                type="button"
                onClick={() => setShowKhqrAdmin((v) => !v)}
                className="w-full flex items-center justify-between text-left text-[12.5px] font-semibold text-slate-300"
              >
                <span>⚙️ Admin: កំណត់ KHQR ទទួលការទូទាត់</span>
                <span className="text-slate-500">{showKhqrAdmin ? '−' : '+'}</span>
              </button>
              {showKhqrAdmin && (
                <div className="mt-2.5 space-y-2">
                  <p className="text-[11.5px] text-slate-500">
                    បើក App ធនាគារ (ABA/ACLEDA) → បង្កើត KHQR ជាមួយចំនួនទឹកប្រាក់ណាមួយ (ឧ. $1) → ចម្លង Text ពេញលេញនៃ QR នោះមក (មិនមែនរូបភាពទេ) ដាក់ចុះខាងក្រោម។
                    ចំនួនទឹកប្រាក់ពិតនឹងត្រូវជំនួសដោយស្វ័យប្រវត្តិតាមគម្រោងដែលគេទិញ។
                  </p>
                  <textarea
                    value={khqrInput}
                    onChange={(e) => setKhqrInput(e.target.value)}
                    placeholder="ចម្លង KHQR Text មកដាក់ទីនេះ..."
                    rows={3}
                    className="w-full rounded-lg bg-black/30 border border-white/10 px-2.5 py-2 text-[12px] font-mono text-slate-200 placeholder:text-slate-600"
                  />
                  <button
                    type="button"
                    disabled={savingKhqr || !khqrInput.trim()}
                    onClick={saveKhqr}
                    className="w-full rounded-lg bg-amber-500 text-black text-[12.5px] font-bold py-1.5 disabled:opacity-50 hover:bg-amber-400"
                  >
                    {savingKhqr ? 'កំពុងរក្សាទុក...' : 'រក្សាទុក KHQR'}
                  </button>
                </div>
              )}
            </div>
          )}

          {!order ? (
            loadingPlans ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!khqrConfigured || Boolean(creating)}
                    onClick={() => pickPlan(p.id)}
                    className={`relative text-left rounded-xl border p-4 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      p.id === 'unlimited'
                        ? 'border-amber-500/50 bg-gradient-to-b from-amber-500/10 to-transparent hover:border-amber-400'
                        : 'border-white/10 bg-white/5 hover:border-white/25'
                    }`}
                  >
                    {p.id === 'unlimited' && (
                      <span className="absolute -top-2.5 right-3 rounded-full bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5">
                        ល្អបំផុត
                      </span>
                    )}
                    <p className="text-sm font-bold text-white flex items-center gap-1.5">
                      {p.id === 'unlimited' ? <Crown className="w-4 h-4 text-amber-400" /> : <Sparkles className="w-4 h-4 text-sky-400" />}
                      {p.label_km}
                    </p>
                    <p className="mt-1 text-2xl font-extrabold text-white">
                      ${p.price_usd}
                      <span className="text-xs font-medium text-slate-400"> /ខែ</span>
                    </p>
                    <ul className="mt-2 space-y-1 text-[12px] text-slate-300">
                      <li className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Export គ្មានកំណត់
                      </li>
                      {p.includesVoxcpm && (
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> VoxCPM2 Premium (ក្លូនសំឡេងកម្រិតខ្ពស់)
                        </li>
                      )}
                    </ul>
                    {creating === p.id ? (
                      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> កំពុងបង្កើត QR...
                      </div>
                    ) : (
                      <div className="mt-3 text-xs font-bold text-amber-300">ជ្រើសរើស →</div>
                    )}
                  </button>
                ))}
              </div>
            )
          ) : order.status === 'paid' ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              <p className="text-base font-bold text-white">ទូទាត់ជោគជ័យ!</p>
              <p className="text-sm text-slate-400">Subscription របស់អ្នកបានដំណើរការហើយ</p>
              <button onClick={onClose} className="mt-3 rounded-lg bg-amber-500 text-black text-sm font-bold px-4 py-2 hover:bg-amber-400">
                បិទ
              </button>
            </div>
          ) : order.status === 'expired' ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Clock className="w-10 h-10 text-slate-500" />
              <p className="text-sm text-slate-300">QR នេះអស់សុពលភាពហើយ (ឲ្យម៉ោង ១០ នាទីក្នុងការទូទាត់)</p>
              <button
                onClick={() => setOrder(null)}
                className="mt-2 rounded-lg border border-white/15 text-sm font-semibold px-4 py-2 text-white hover:bg-white/10"
              >
                ត្រឡប់ទៅជ្រើសគម្រោងវិញ
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-sm text-slate-300 flex items-center gap-1.5">
                <QrCode className="w-4 h-4" /> ស្កេនដើម្បីទូទាត់ ${order.amount_usd}
              </p>
              {order.qrImage && (
                <img src={order.qrImage} alt="KHQR" className="w-56 h-56 rounded-xl border border-white/10 bg-white p-2" />
              )}
              <p className="text-[12px] text-slate-500">ស្កេនដោយ App ធនាគារណាមួយ (ABA, ACLEDA, Wing, Bakong)</p>
              <p className="flex items-center gap-1.5 text-sm font-mono text-amber-300">
                <Clock className="w-3.5 h-3.5" /> {mm}:{ss}
              </p>
              <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> កំពុងរង់ចាំការទូទាត់...
              </p>
              <button
                onClick={() => {
                  stopPolling();
                  setOrder(null);
                }}
                className="mt-1 text-[12px] text-slate-500 hover:text-slate-300 underline"
              >
                ជ្រើសរើសគម្រោងផ្សេង
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

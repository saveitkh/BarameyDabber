import React from 'react';
import { TimelineSegment, CharacterVoice, User } from '../../../types';
import { ChevronRight } from 'lucide-react';
import { VoxCPM2OnlineToggle } from '../../ui/VoxCPM2OnlineToggle';
import { CharacterCastBoard } from '../../session/CharacterCastBoard';
import { SegmentsSetter, useVoiceCasts } from '../../session/useVoiceCasts';
import { toKhmerNumber } from '../../session/castUtils';

interface Step4VoiceCastingProps {
  segments: TimelineSegment[];
  characters: CharacterVoice[];
  onChangeSegments: SegmentsSetter;
  /** Server filename of the uploaded video; null while it is still uploading */
  projectKey: string | null;
  onNext: () => void;
  onBack: () => void;
  onShowToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  engineMode?: string;
  onSwitchEngine?: (mode: string) => void;
  voxStatus?: any;
  onOpenVoxModal?: () => void;
  user?: User | null;
  onOpenLicenseModal?: () => void;
}

export const Step4VoiceCasting: React.FC<Step4VoiceCastingProps> = ({
  segments,
  characters,
  onChangeSegments,
  projectKey,
  onNext,
  onBack,
  onShowToast,
  engineMode = 'local',
  onSwitchEngine,
  voxStatus,
  onOpenVoxModal,
  user,
  onOpenLicenseModal,
}) => {
  const castState = useVoiceCasts(projectKey, segments, onChangeSegments, onShowToast);
  const missing = castState.cast.length - castState.readyCount;

  return (
    <div className="cs-root flex flex-col h-full overflow-hidden font-khmer">
      <div className="px-4 sm:px-8 pt-6 pb-4 shrink-0">
        <div className="text-xs font-mono font-bold text-[var(--cs-accent-text)] mb-1">ជំហានទី ៤ នៃ ៦</div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold mb-1">Upload សំឡេងតួ (១ តួ = ១ សំឡេង)</h2>
            <p className="text-sm text-[var(--cs-muted)] max-w-xl leading-relaxed">
              តួនីមួយៗមានសញ្ញា ប្រុស ១, ស្រី ១ … Upload សំឡេងម្តងនៅលើតួ — ឃ្លាទាំងអស់របស់តួនោះប្រើសំឡេងដូចគ្នាដោយស្វ័យប្រវត្តិ។
            </p>
          </div>
          <VoxCPM2OnlineToggle
            engineMode={engineMode}
            voxStatus={voxStatus}
            user={user}
            onSwitchEngine={(m) => onSwitchEngine?.(m)}
            onOpenVoxModal={onOpenVoxModal}
            onOpenLicenseModal={onOpenLicenseModal}
            variant="compact"
          />
        </div>
      </div>

      <div className="flex-1 px-4 sm:px-8 pb-4 min-h-0 overflow-y-auto">
        {segments.length > 0 ? (
          <CharacterCastBoard state={castState} segments={segments} setSegments={onChangeSegments} libraryVoices={characters} />
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--cs-border-strong)] px-6 py-10 text-center text-sm text-[var(--cs-muted)]">
            មិនទាន់មានឃ្លាសន្ទនា — សូមត្រឡប់ទៅជំហានទី ២ ដើម្បីស្កេនវីដេអូ
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 sm:px-8 py-4 bg-[var(--cs-surface)] border-t border-[var(--cs-border)]">
        <div className="flex items-center justify-between gap-3 max-w-5xl">
          <button onClick={onBack} className="cs-btn-ghost px-5 py-2.5 rounded-xl text-sm font-semibold">
            ← ត្រឡប់ក្រោយ
          </button>
          {missing > 0 && (
            <p className="hidden sm:block text-xs text-[var(--cs-text-2)] flex-1 text-center">
              នៅខ្វះសំឡេង {toKhmerNumber(missing)} តួ — នឹងប្រើសំឡេងលំនាំដើម
            </p>
          )}
          <button onClick={onNext} className="cs-btn-primary flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm">
            <span>បន្តទៅមុខ</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

import type { ClaudeVersionCheck } from '../../../../core/claudeVersion.js';
import type { HealthWarning } from '../../../../shared/health.js';
import { getAppearance } from '../../../../shared/characters.js';
import { toPercent } from '../../../../shared/formatTokenUsage.js';
import { STATE_LABELS_JA } from '../../../../shared/stateLabels.js';
import type { Agent } from '../../../../types/agent.js';
import { inkColor } from '../../colors.js';

interface TopBarProps {
  readonly leader: Agent | null;
  readonly activeCount: number;
  readonly maxWorkers: number;
  readonly attentionCount: number;
  readonly warnings: readonly HealthWarning[];
  readonly claudeVersion: ClaudeVersionCheck;
  /** 一覧の取得に失敗していれば、その説明 */
  readonly fetchError: string | null;
}

/**
 * 上端のバー。`cuse` の印、指揮役の名前と状態、配下数、対応待ち数、コンテキスト使用率。
 * その下に健全性の警告と、Claude Code が古いときの案内を出す。
 */
export const TopBar = ({
  leader,
  activeCount,
  maxWorkers,
  attentionCount,
  warnings,
  claudeVersion,
  fetchError,
}: TopBarProps) => {
  const tokens = leader?.meta?.tokens;
  const notices = [
    ...(fetchError === null ? [] : [fetchError]),
    ...(claudeVersion.ok ? [] : [claudeVersion.message]),
    ...warnings.map((warning) => warning.message),
  ];

  return (
    <header className="top-bar">
      <div className="top-bar__row">
        <span className="brand">cuse</span>
        <span className="top-bar__leader">
          指揮役{' '}
          {leader === null ? (
            <span className="muted">なし（第 2 段階の cuse start で起動）</span>
          ) : (
            <>
              <strong>{leader.name}</strong>{' '}
              <span style={{ color: inkColor(getAppearance(leader.state).color) }}>
                ● {STATE_LABELS_JA[leader.state]}
              </span>
            </>
          )}
        </span>
        <span className="top-bar__spacer" />
        <span className="top-bar__stat">
          配下 <strong>{activeCount}/{maxWorkers}</strong>
        </span>
        <span className={attentionCount > 0 ? 'top-bar__stat top-bar__stat--alert' : 'top-bar__stat'}>
          対応待ち <strong>{attentionCount}</strong>
        </span>
        <span className="top-bar__stat">
          ctx <strong>{tokens === undefined ? '-' : `${toPercent(tokens.ratio)}%`}</strong>
        </span>
      </div>
      {notices.length === 0 ? null : (
        <ul className="top-bar__notices" role="status">
          {notices.map((notice) => (
            <li key={notice}>⚠ {notice}</li>
          ))}
        </ul>
      )}
    </header>
  );
};

import { memo } from 'react';
import { CHARACTERS, getAppearance, getMiniFrame } from '../../../../shared/characters.js';
import { STATE_LABELS_JA } from '../../../../shared/stateLabels.js';
import { blockedReason } from '../../../../shared/statusDetail.js';
import { visibleSubagents } from '../../../../shared/subagents.js';
import type { Agent } from '../../../../types/agent.js';
import { formatDuration } from '../../../../utils/formatDuration.js';
import { inkColor } from '../../colors.js';
import { Character } from '../Character/index.js';

interface WorkerCardProps {
  readonly agent: Agent;
  readonly frame: number;
  /** 経過時間の算出基準時刻 */
  readonly now: number;
}

/**
 * 最後の動き。承認待ちなら何の承認か、そうでなければ最後に与えた指示。
 * 承認しに行く前に、急ぐものかどうかを判断できるようにするため。
 */
const lastActivity = (agent: Agent): string => {
  const reason = blockedReason(agent);
  if (reason !== undefined) {
    return reason;
  }
  const prompt = agent.meta?.lastPrompt;
  return prompt === undefined ? '' : `> ${prompt}`;
};

/**
 * 配下 1 つぶんのカード。Clawd の AA・名前・経過時間・状態・最後の動き。
 *
 * 読み取り専用なので、承認・停止などの操作は置かない（「開く」は第 2 段階）。
 * 枠の色は状態の色にそろえ、承認待ちのカードが一目で分かるようにする。
 */
const WorkerCardComponent = ({ agent, frame, now }: WorkerCardProps) => {
  const { color } = getAppearance(agent.state);
  const elapsed = agent.startedAt > 0 ? formatDuration(now - agent.startedAt) : '-';
  const subagents = visibleSubagents(agent, now);
  const activity = lastActivity(agent);

  return (
    <li
      className={`worker-card worker-card--${agent.state}`}
      style={{ ['--state-color' as string]: inkColor(color) }}
      aria-label={`${agent.name} ${STATE_LABELS_JA[agent.state]}`}
    >
      <div className="worker-card__avatar">
        <Character state={agent.state} frame={frame} />
      </div>
      <div className="worker-card__info">
        <div className="worker-card__line">
          <span className="worker-card__name">{agent.name}</span>
          <span className="worker-card__elapsed">{elapsed}</span>
        </div>
        <div className="worker-card__line">
          <span className="worker-card__state" style={{ color: inkColor(color) }}>
            <span className="worker-card__dot" aria-hidden="true" />
            {STATE_LABELS_JA[agent.state]}
            {agent.state === 'unknown' && agent.rawState !== '' ? `（${agent.rawState}）` : ''}
          </span>
          {subagents.length === 0 ? null : (
            <span className="worker-card__subagents" style={{ color: inkColor(CHARACTERS.working.color) }}>
              ・サブエージェント {subagents.length}
            </span>
          )}
        </div>
        <div className="worker-card__line">
          <span className="worker-card__activity" title={activity === '' ? undefined : activity}>
            {activity}
          </span>
        </div>
        {subagents.length === 0 ? null : (
          <div
            className="worker-card__minis"
            style={{ color: inkColor(CHARACTERS.working.color) }}
            title={subagents
              .map(({ type, description }) => [type, description].filter((p) => p !== '').join(': '))
              .join('\n')}
          >
            {subagents.map((subagent, index) => (
              <pre className="mini" key={subagent.toolUseId}>
                {getMiniFrame(frame + index)}
              </pre>
            ))}
          </div>
        )}
      </div>
    </li>
  );
};

/** 変化のないカードを再描画しないようメモ化する。 */
export const WorkerCard = memo(WorkerCardComponent);

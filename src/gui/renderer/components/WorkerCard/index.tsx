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
  /** 中央で開く。background セッションでなければ渡さない（claude attach できないため） */
  readonly onOpen?: (() => void) | undefined;
  /** 止める。台帳の配下でなければ渡さない（人が手で動かしているセッションは止めない） */
  readonly onStop?: (() => void) | undefined;
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
 * 「開く」で中央に `claude attach` を開き、人はそこで承認する（承認のボタンは置かない）。
 * 「止める」は台帳の配下にだけ出す。
 * 枠の色は状態の色にそろえ、承認待ちのカードが一目で分かるようにする。
 */
const WorkerCardComponent = ({ agent, frame, now, onOpen, onStop }: WorkerCardProps) => {
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
        {onOpen === undefined && onStop === undefined ? null : (
          <div className="worker-card__actions">
            {onOpen === undefined ? null : (
              <button type="button" className="link-button" onClick={onOpen}>
                開く
              </button>
            )}
            {onStop === undefined ? null : (
              <button type="button" className="link-button link-button--quiet" onClick={onStop}>
                止める
              </button>
            )}
          </div>
        )}
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

import type { Agent } from '../../../../types/agent.js';
import { STATE_LABELS_JA } from '../../../../shared/stateLabels.js';
import type { ListScope } from '../../listModel.js';
import { WorkerCard } from '../WorkerCard/index.js';

interface WorkerListProps {
  readonly active: readonly Agent[];
  readonly finished: readonly Agent[];
  readonly scope: ListScope;
  readonly ledgerAvailable: boolean;
  readonly frame: number;
  readonly now: number;
  readonly onScopeChange: (scope: ListScope) => void;
}

/** 空のときの説明。第 1 段階は台帳が無いので、全セッション表示への切り替えを案内する。 */
const EmptyMessage = ({
  scope,
  ledgerAvailable,
  onShowAll,
}: {
  readonly scope: ListScope;
  readonly ledgerAvailable: boolean;
  readonly onShowAll: () => void;
}) => {
  if (scope === 'all') {
    return <p className="worker-list__empty">このマシンで動いている Claude Code セッションはありません。</p>;
  }
  return (
    <div className="worker-list__empty">
      <p>
        {ledgerAvailable
          ? '動いている配下はいません。'
          : '台帳（~/.cuse/ledger.json）がまだ無いので、配下はいません。配下の起動は第 2 段階で入ります。'}
      </p>
      <button type="button" className="link-button" onClick={onShowAll}>
        マシン上の全セッションを表示
      </button>
    </div>
  );
};

/**
 * 左の一覧。承認待ちが先頭。終わったものは「DONE」の下に薄く 1 行で出す。
 */
export const WorkerList = ({
  active,
  finished,
  scope,
  ledgerAvailable,
  frame,
  now,
  onScopeChange,
}: WorkerListProps) => (
  <section className="worker-list" aria-label={scope === 'all' ? '全セッション' : '配下'}>
    <header className="pane-header">
      <span className="pane-header__title">{scope === 'all' ? 'ALL SESSIONS' : 'SUBSESSIONS'}</span>
      <div className="scope-toggle" role="group" aria-label="表示する範囲">
        <button
          type="button"
          aria-pressed={scope === 'workers'}
          onClick={() => {
            onScopeChange('workers');
          }}
        >
          配下
        </button>
        <button
          type="button"
          aria-pressed={scope === 'all'}
          onClick={() => {
            onScopeChange('all');
          }}
        >
          全セッション
        </button>
      </div>
    </header>

    {active.length === 0 && finished.length === 0 ? (
      <EmptyMessage
        scope={scope}
        ledgerAvailable={ledgerAvailable}
        onShowAll={() => {
          onScopeChange('all');
        }}
      />
    ) : (
      <div className="worker-list__body">
        <p className="worker-list__order">承認待ち順</p>
        <ul className="worker-list__cards">
          {active.map((agent) => (
            <WorkerCard key={agent.sessionId} agent={agent} frame={frame} now={now} />
          ))}
        </ul>

        {finished.length === 0 ? null : (
          <>
            <h2 className="worker-list__done-title">DONE</h2>
            <ul className="worker-list__done">
              {finished.map((agent) => (
                <li key={agent.sessionId} className="done-row">
                  <span className="done-row__mark" aria-hidden="true">
                    {agent.state === 'done' ? '✓' : '■'}
                  </span>
                  <span className="done-row__name">{agent.name}</span>
                  <span className="done-row__state">{STATE_LABELS_JA[agent.state]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    )}
  </section>
);

import { getFrame } from '../../../../shared/characters.js';
import { STATE_LABELS_JA } from '../../../../shared/stateLabels.js';
import type { Agent } from '../../../../types/agent.js';
import type { CuseBridge } from '../../../ipc.js';
import type { LeaderStartup } from '../../../leaderStartup.js';
import { TerminalView } from '../TerminalView/index.js';

/** 中央のタブ 1 つ。 */
export interface TerminalTab {
  readonly tabId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly role: 'leader' | 'worker' | 'other';
}

interface CenterPaneProps {
  readonly bridge: CuseBridge;
  readonly tabs: readonly TerminalTab[];
  readonly activeTabId: string | null;
  /** 開いている相手のいまの状態（一覧から引く） */
  readonly agents: readonly Agent[];
  readonly frame: number;
  readonly onSelect: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  /** アプリを開いたときに指揮役をそろえた結果（まだ取れていなければ null） */
  readonly leaderStartup: LeaderStartup | null;
  /** 指揮役を起こせなかったときに、もう一度頼む */
  readonly onRetryLeader: () => void;
}

/**
 * 指揮役のタブが出るまでの案内。アプリを開くと指揮役を起こすので、たいていは「起こしています」。
 * 起こせなかったときは理由と「もう一度」を出す。
 */
const NoLeader = ({
  startup,
  onRetry,
}: {
  readonly startup: LeaderStartup | null;
  readonly onRetry: () => void;
}) => (
  <div className="placeholder__body">
    {startup?.kind === 'failed' ? (
      <>
        <p className="placeholder__stage">指揮役を起こせませんでした</p>
        <p className="placeholder__description">{startup.message}</p>
        <button type="button" className="link-button" onClick={onRetry}>
          もう一度
        </button>
      </>
    ) : (
      <>
        <p className="placeholder__stage">指揮役 cuse-leader を起こしています…</p>
        <p className="placeholder__description">
          起きると、ここに指揮役の会話が出ます。人の依頼は指揮役にだけ伝えます。
        </p>
      </>
    )}
  </div>
);

/**
 * 中央。指揮役の会話（`claude attach cuse-leader`）と、左で開いた配下の会話をタブで並べる。
 * 上に、表に出ている相手の大きめの Clawd と名前を出す。指揮役は cuse の色で描く。
 */
export const CenterPane = ({
  bridge,
  tabs,
  activeTabId,
  agents,
  frame,
  onSelect,
  onClose,
  leaderStartup,
  onRetryLeader,
}: CenterPaneProps) => {
  const active = tabs.find((tab) => tab.tabId === activeTabId) ?? null;
  const agent = active === null ? undefined : agents.find((a) => a.sessionId === active.sessionId);
  const state = agent?.state ?? 'unknown';

  return (
    <section className="center-pane" aria-label="会話">
      {active === null ? (
        <NoLeader startup={leaderStartup} onRetry={onRetryLeader} />
      ) : (
        <>
          <header className="center-pane__header">
            <pre
              className={
                active.role === 'leader'
                  ? 'character character--large character--leader'
                  : 'character character--large'
              }
            >
              {getFrame(state, frame)}
            </pre>
            <div className="center-pane__who">
              <div className="center-pane__name">
                <strong>{active.title}</strong>
                {active.role === 'leader' ? <span className="badge">指揮役</span> : null}
                {active.role === 'worker' ? <span className="badge badge--worker">配下</span> : null}
              </div>
              <div className="center-pane__state">
                {agent === undefined ? '一覧にありません（止まっていれば、つなぐと再開します）' : STATE_LABELS_JA[state]}
                {active.role === 'leader' ? '・編集ツールなし' : ''}
              </div>
            </div>
          </header>
          <nav className="tabs" role="tablist">
            {tabs.map((tab) => (
              <div
                key={tab.tabId}
                className={tab.tabId === activeTabId ? 'tab tab--active' : 'tab'}
                role="tab"
                aria-selected={tab.tabId === activeTabId}
              >
                <button
                  type="button"
                  className="tab__label"
                  onClick={() => {
                    onSelect(tab.tabId);
                  }}
                >
                  {tab.title}
                </button>
                {tab.role === 'leader' ? null : (
                  <button
                    type="button"
                    className="tab__close"
                    aria-label={`${tab.title} を閉じる`}
                    title="閉じる（attach を切るだけで、セッションは止めません）"
                    onClick={() => {
                      onClose(tab.tabId);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </nav>
        </>
      )}
      <div className="center-pane__terminals">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.tabId}
            bridge={bridge}
            tabId={tab.tabId}
            sessionId={tab.sessionId}
            active={tab.tabId === activeTabId}
          />
        ))}
      </div>
      <p className="center-pane__hint">
        人の依頼は指揮役だけが受けます。配下の承認は、左でその配下を開いてここで行います。
      </p>
    </section>
  );
};

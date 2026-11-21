import { useCallback, useState } from 'react';
import { LEADER_GLOVE_WIDTH, getFrame, getLeaderFrame, isBatonRow } from '../../../../shared/characters.js';
import { STATE_LABELS_JA } from '../../../../shared/stateLabels.js';
import type { Agent } from '../../../../types/agent.js';
import type { CuseBridge } from '../../../ipc.js';
import type { LeaderStartup } from '../../../leaderStartup.js';
import type { TerminalLink } from '../../../../shared/terminalLinks.js';
import { ConversationView } from '../ConversationView/index.js';
import { TerminalView } from '../TerminalView/index.js';

/**
 * 指揮役の AA。指揮棒のある行の左 2 桁（棒と、それを握る手）だけ白くする（白い手袋。
 * 身体と同じ色だと指揮棒に見えないため。文字の中では色を分けられないので、手も白くなる）。
 */
const LeaderAa = ({ text }: { readonly text: string }) => (
  <>
    {text.split('\n').map((row, index, rows) => {
      const cells = [...row];
      const glove = isBatonRow(row) ? LEADER_GLOVE_WIDTH : 0;
      return (
        // 行の中身はフレームごとに変わるので、行番号を鍵にする
        <span key={index}>
          {glove === 0 ? null : <span className="character__baton">{cells.slice(0, glove).join('')}</span>}
          {cells.slice(glove).join('')}
          {index < rows.length - 1 ? '\n' : ''}
        </span>
      );
    })}
  </>
);

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
  /** 指揮役を起こすフォルダを選ぶ */
  readonly onChooseLeaderFolder: () => void;
  /** まだ一度も配下を起こしていない（はじめて使う人に、何を書けばよいかを見せる） */
  readonly firstRequest: boolean;
  /** 会話の中のファイル名・URL が押されたとき（右のプレビューに出す） */
  readonly onLink?: ((tab: TerminalTab, link: Pick<TerminalLink, 'text' | 'kind'>) => void) | undefined;
}

/** 信頼してもらう端末のタブの ID。 */
const TRUST_TAB_ID = 'trust';

/**
 * 指揮役のタブが出るまでの案内。
 *
 * - 起こしている途中: その旨
 * - 指揮役の居場所をまだ信頼していない（初回）: そのフォルダで動かした Claude Code を出し、人に信頼してもらう
 * - そのほかで起こせなかった: 理由と「もう一度」「別のフォルダを選ぶ」
 */
const NoLeader = ({
  bridge,
  startup,
  onRetry,
  onChooseFolder,
}: {
  readonly bridge: CuseBridge;
  readonly startup: LeaderStartup | null;
  readonly onRetry: () => void;
  readonly onChooseFolder: () => void;
}) => {
  const openTrust = useCallback(
    (cols: number, rows: number) => bridge.openTrustTerminal({ tabId: TRUST_TAB_ID, cols, rows }),
    [bridge],
  );

  if (startup?.kind === 'failed' && startup.untrustedFolder !== null) {
    return (
      <div className="trust">
        <section className="trust__guide" role="alert" aria-label="初回だけ: 指揮役の居場所を信頼する">
          <p className="trust__badge">初回だけ</p>
          <h2 className="trust__title">指揮役の居場所を Claude Code で信頼してください</h2>
          <ol className="trust__steps">
            <li>
              下の Claude Code が <code>{startup.untrustedFolder}</code> を信頼するか聞いています。
              <strong>↓ キーで「Yes, I trust this folder」を選び、Enter</strong> を押してください（はじめは「No, exit」が選ばれています）。
            </li>
            <li>
              信頼すると、下の Claude Code は自動で閉じて、指揮役が起きます。下の Claude Code には何も打ち込まなくて大丈夫です。
            </li>
            <li>
              起きないときは、<strong>「▶ 指揮役を起こす」</strong>を押してください。
            </li>
          </ol>
          <p className="trust__note">次からは聞かれません。</p>
          <div className="placeholder__actions">
            <button type="button" className="primary-button primary-button--pulse" onClick={onRetry}>
              ▶ 指揮役を起こす
            </button>
            <button type="button" className="link-button link-button--quiet" onClick={onChooseFolder}>
              別のフォルダで起こす
            </button>
          </div>
        </section>
        <p className="trust__terminal-label">
          ↓ 信頼の確認のためだけに動かしている Claude Code です（指揮役ではありません。信頼すると閉じます）
        </p>
        <div className="trust__terminal">
          <TerminalView bridge={bridge} tabId={TRUST_TAB_ID} open={openTrust} active />
        </div>
      </div>
    );
  }

  return (
    <div className="placeholder__body">
      {startup?.kind === 'failed' ? (
        <>
          <p className="placeholder__stage">指揮役を起こせませんでした</p>
          <p className="placeholder__description placeholder__description--error">{startup.message}</p>
          <div className="placeholder__actions">
            <button type="button" className="link-button" onClick={onRetry}>
              もう一度
            </button>
            <button type="button" className="link-button" onClick={onChooseFolder}>
              別のフォルダで起こす
            </button>
          </div>
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
};

/** 指揮役・配下の会話の端末。開く相手は main が sessionId から決める。 */
const SessionTerminal = ({
  bridge,
  tab,
  active,
  onLink,
}: {
  readonly bridge: CuseBridge;
  readonly tab: TerminalTab;
  readonly active: boolean;
  readonly onLink?: ((tab: TerminalTab, link: Pick<TerminalLink, 'text' | 'kind'>) => void) | undefined;
}) => {
  const open = useCallback(
    (cols: number, rows: number) =>
      bridge.openTerminal({ tabId: tab.tabId, sessionId: tab.sessionId, cols, rows }),
    [bridge, tab.tabId, tab.sessionId],
  );
  const link = useCallback(
    (clicked: Pick<TerminalLink, 'text' | 'kind'>) => {
      onLink?.(tab, clicked);
    },
    [onLink, tab],
  );
  return <TerminalView bridge={bridge} tabId={tab.tabId} open={open} active={active} onLink={onLink === undefined ? undefined : link} />;
};

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
  onChooseLeaderFolder,
  firstRequest,
  onLink,
}: CenterPaneProps) => {
  const active = tabs.find((tab) => tab.tabId === activeTabId) ?? null;
  const agent = active === null ? undefined : agents.find((a) => a.sessionId === active.sessionId);
  const state = agent?.state ?? 'unknown';
  // 指揮役は、既定で会話の画面を出す。承認に答えるときや細かい操作は「端末」（Claude Code の画面）で行う
  const [leaderView, setLeaderView] = useState<'chat' | 'terminal'>('chat');
  const leaderTab = tabs.find((tab) => tab.role === 'leader');
  const leaderAgent = leaderTab === undefined ? undefined : agents.find((a) => a.sessionId === leaderTab.sessionId);

  return (
    <section className="center-pane" aria-label="会話">
      {active === null ? (
        <NoLeader
          bridge={bridge}
          startup={leaderStartup}
          onRetry={onRetryLeader}
          onChooseFolder={onChooseLeaderFolder}
        />
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
              {active.role === 'leader' ? <LeaderAa text={getLeaderFrame(state, frame)} /> : getFrame(state, frame)}
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
            {active.role === 'leader' ? (
              <div className="view-toggle" role="group" aria-label="見せ方">
                {(['chat', 'terminal'] as const).map((view) => (
                  <button
                    type="button"
                    key={view}
                    aria-pressed={leaderView === view}
                    className={leaderView === view ? 'view-toggle__button view-toggle__button--on' : 'view-toggle__button'}
                    onClick={() => {
                      setLeaderView(view);
                    }}
                  >
                    {view === 'chat' ? '会話' : '端末'}
                  </button>
                ))}
              </div>
            ) : null}
          </header>
          {active.role === 'leader' && firstRequest ? (
            <div className="first-request" role="note">
              <strong>ここから依頼します。</strong>
              下の入力欄に、やってほしいことを書いて Enter で指揮役に送ってください。
              <span className="first-request__example">
                例: 「~/work/app の README の誤字を直して、テストも足して。終わったら差分を見せて」
              </span>
              指揮役が配下を起こすと、左に並びます。承認が要るときは左のカードに「開いて承認する」が出ます。
            </div>
          ) : null}
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
        {leaderTab === undefined ? null : (
          <ConversationView
            bridge={bridge}
            sessionId={leaderTab.sessionId}
            state={leaderAgent?.state ?? 'unknown'}
            active={leaderTab.tabId === activeTabId && leaderView === 'chat'}
            onShowTerminal={() => {
              setLeaderView('terminal');
            }}
            onLink={onLink === undefined ? undefined : (link) => {
              onLink(leaderTab, link);
            }}
          />
        )}
        {tabs.map((tab) => (
          <SessionTerminal
            key={tab.tabId}
            bridge={bridge}
            tab={tab}
            // 指揮役の端末は、会話の画面を出している間も裏でつないだままにする（会話から送る先になる）
            active={tab.tabId === activeTabId && (tab.role !== 'leader' || leaderView === 'terminal')}
            onLink={onLink}
          />
        ))}
      </div>
      <p className="center-pane__hint">
        人の依頼は指揮役だけが受けます。配下の承認は、左でその配下を開いてここで行います。
      </p>
    </section>
  );
};

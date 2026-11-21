import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAnimationTick } from '../../hooks/useAnimationTick.js';
import { useTransitions } from '../../hooks/useTransitions.js';
import type { Agent } from '../../types/agent.js';
import type { CuseBridge, GuiEnvironment } from '../ipc.js';
import type { LeaderStartup } from '../leaderStartup.js';
import { CenterPane, type TerminalTab } from './components/CenterPane/index.js';
import { Placeholder } from './components/Placeholder/index.js';
import { StopDialog } from './components/StopDialog/index.js';
import { TopBar } from './components/TopBar/index.js';
import { WorkerList } from './components/WorkerList/index.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import { useSnapshot } from './hooks/useSnapshot.js';
import { buildListModel, nextBlockedSince, type ListScope } from './listModel.js';

/** Clawd のコマを進める間隔（cc-park と同じ）。 */
const ANIMATION_INTERVAL_MS = 200;

const NO_AGENTS: readonly Agent[] = [];

/** 上端に出す知らせ（指揮役をそろえたときの警告など）。 */
const leaderNotices = (startup: LeaderStartup | undefined): readonly string[] => [
  ...(startup?.kind === 'ready' ? startup.warnings : []),
];

/** 指揮役のタブの ID。指揮役は 1 人なので固定にする。 */
export const LEADER_TAB_ID = 'leader';

interface AppProps {
  readonly environment: GuiEnvironment;
  readonly bridge: CuseBridge;
}

/**
 * cuse のウィンドウ。上端のバー、左の一覧、中央の会話（埋め込み端末）、右のプレビュー（第 3 段階）。
 */
export const App = ({ environment, bridge }: AppProps) => {
  const { snapshot, previousAgents } = useSnapshot(bridge);
  const [scope, setScope] = useState<ListScope>('workers');
  const [now, setNow] = useState(() => Date.now());
  const [blockedSince, setBlockedSince] = useState<ReadonlyMap<string, number>>(new Map());
  const [openedTabs, setOpenedTabs] = useState<readonly TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [stopping, setStopping] = useState<Agent | null>(null);
  const [cleanMessage, setCleanMessage] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const frame = useAnimationTick(ANIMATION_INTERVAL_MS, !reducedMotion);

  // 経過時間と「完了直後」の期限を進めるため、1 秒ごとに時刻を取り直す
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const fetched = snapshot?.agents;
  const rawAgents = fetched?.ok === true ? fetched.agents : NO_AGENTS;
  const { agents } = useTransitions(rawAgents, previousAgents, { now });

  useEffect(() => {
    setBlockedSince((current) => nextBlockedSince(current, rawAgents, Date.now()));
  }, [rawAgents]);

  const ledger = snapshot?.ledger ?? { kind: 'missing' as const };
  const model = useMemo(
    () =>
      buildListModel(agents, ledger, {
        scope,
        now,
        maxWorkers: environment.maxWorkers,
        blockedSince,
      }),
    [agents, ledger, scope, now, environment.maxWorkers, blockedSince],
  );

  // 指揮役のタブは台帳に指揮役がいる間いつも先頭に置く（閉じられない）
  const leaderRecord = ledger.kind === 'ok' ? ledger.ledger.leader : null;
  const tabs = useMemo<readonly TerminalTab[]>(
    () => [
      ...(leaderRecord === null
        ? []
        : [
            {
              tabId: LEADER_TAB_ID,
              sessionId: leaderRecord.sessionId,
              title: leaderRecord.name,
              role: 'leader' as const,
            },
          ]),
      ...openedTabs,
    ],
    [leaderRecord, openedTabs],
  );
  const shownTabId =
    activeTabId !== null && tabs.some((tab) => tab.tabId === activeTabId)
      ? activeTabId
      : (tabs[0]?.tabId ?? null);

  const openAgent = useCallback(
    (agent: Agent) => {
      if (leaderRecord?.sessionId === agent.sessionId) {
        setActiveTabId(LEADER_TAB_ID);
        return;
      }
      const tabId = `session:${agent.sessionId}`;
      setOpenedTabs((current) =>
        current.some((tab) => tab.tabId === tabId)
          ? current
          : [
              ...current,
              {
                tabId,
                sessionId: agent.sessionId,
                title: agent.name,
                role: model.workerIds.has(agent.sessionId) ? 'worker' : 'other',
              },
            ],
      );
      setActiveTabId(tabId);
    },
    [leaderRecord, model.workerIds],
  );

  // OS 通知を押したら、その配下（または指揮役）を中央に開く
  useEffect(
    () =>
      bridge.onOpenSession((sessionId) => {
        const agent = agents.find((candidate) => candidate.sessionId === sessionId);
        if (agent !== undefined) {
          openAgent(agent);
        }
      }),
    [bridge, agents, openAgent],
  );

  const clean = useCallback(() => {
    setCleanMessage('片付けています…');
    void bridge.cleanWorkers().then((result) => {
      setCleanMessage(result.message);
    });
  }, [bridge]);

  const closeTab = useCallback((tabId: string) => {
    setOpenedTabs((current) => current.filter((tab) => tab.tabId !== tabId));
    setActiveTabId((current) => (current === tabId ? null : current));
  }, []);

  return (
    <div className="app">
      <TopBar
        leader={model.leader}
        activeCount={model.activeCount}
        maxWorkers={environment.maxWorkers}
        attentionCount={model.attentionCount}
        warnings={model.warnings}
        claudeVersion={environment.claudeVersion}
        fetchError={fetched !== undefined && !fetched.ok ? fetched.error.message : null}
        notices={leaderNotices(snapshot?.leaderStartup)}
        leaderPending={snapshot === null || snapshot.leaderStartup.kind === 'starting'}
      />
      <main className="columns">
        {snapshot === null ? (
          <section className="worker-list">
            <p className="worker-list__empty">セッションを読み込んでいます…</p>
          </section>
        ) : (
          <WorkerList
            active={model.active}
            finished={model.finished}
            scope={scope}
            ledgerAvailable={model.ledgerAvailable}
            frame={frame}
            now={now}
            onScopeChange={setScope}
            workerIds={model.workerIds}
            onOpen={openAgent}
            onStop={setStopping}
            onClean={clean}
            cleanMessage={cleanMessage}
          />
        )}
        <CenterPane
          bridge={bridge}
          tabs={tabs}
          activeTabId={shownTabId}
          agents={agents}
          frame={frame}
          onSelect={setActiveTabId}
          onClose={closeTab}
          leaderStartup={snapshot?.leaderStartup ?? null}
          firstRequest={ledger.kind !== 'ok' || ledger.ledger.workers.length === 0}
          onRetryLeader={() => {
            void bridge.ensureLeader();
          }}
          onChooseLeaderFolder={() => {
            void bridge.chooseLeaderFolder();
          }}
        />
        <Placeholder
          title="PREVIEW"
          stage="第 3 段階で入ります"
          description="セッションに出てきたファイル・差分・画像・Web サイトをここに表示します。"
        />
      </main>
      <footer className="footer">
        承認は、左のカードの「開いて承認する」で中央に出る Claude Code の画面で行います。ウィンドウを閉じても指揮役と配下は止まりません。
      </footer>
      {stopping === null ? null : (
        <StopDialog
          name={stopping.name}
          onCancel={() => {
            setStopping(null);
          }}
          onConfirm={async (reason) => {
            const result = await bridge.stopWorker(stopping.sessionId, reason);
            if (result.ok) {
              setStopping(null);
              return null;
            }
            return result.message;
          }}
        />
      )}
    </div>
  );
};

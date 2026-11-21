import { useEffect, useMemo, useState } from 'react';
import { useAnimationTick } from '../../hooks/useAnimationTick.js';
import { useTransitions } from '../../hooks/useTransitions.js';
import type { Agent } from '../../types/agent.js';
import type { CuseBridge, GuiEnvironment } from '../ipc.js';
import { Placeholder } from './components/Placeholder/index.js';
import { TopBar } from './components/TopBar/index.js';
import { WorkerList } from './components/WorkerList/index.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import { useSnapshot } from './hooks/useSnapshot.js';
import { buildListModel, nextBlockedSince, type ListScope } from './listModel.js';

/** Clawd のコマを進める間隔（cc-park と同じ）。 */
const ANIMATION_INTERVAL_MS = 200;

const NO_AGENTS: readonly Agent[] = [];

interface AppProps {
  readonly environment: GuiEnvironment;
  readonly bridge: CuseBridge;
}

/**
 * 第 1 段階のウィンドウ。読み取り専用で、上端のバーと左の一覧だけが動く。
 * 中央（指揮役の会話）は第 2 段階、右（プレビュー）は第 3 段階で入る。
 */
export const App = ({ environment, bridge }: AppProps) => {
  const { snapshot, previousAgents } = useSnapshot(bridge);
  const [scope, setScope] = useState<ListScope>('workers');
  const [now, setNow] = useState(() => Date.now());
  const [blockedSince, setBlockedSince] = useState<ReadonlyMap<string, number>>(new Map());
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

  const model = useMemo(
    () =>
      buildListModel(agents, snapshot?.ledger ?? { kind: 'missing' }, {
        scope,
        now,
        maxWorkers: environment.maxWorkers,
        blockedSince,
      }),
    [agents, snapshot?.ledger, scope, now, environment.maxWorkers, blockedSince],
  );

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
          />
        )}
        <Placeholder
          title="LEADER"
          stage="第 2 段階で入ります"
          description="ここに指揮役 cuse-leader の会話（claude attach の埋め込み端末）が入ります。左の配下を「開く」と、その配下の会話もタブで開けるようになります。"
        />
        <Placeholder
          title="PREVIEW"
          stage="第 3 段階で入ります"
          description="セッションに出てきたファイル・差分・画像・Web サイトをここに表示します。"
        />
      </main>
      <footer className="footer">
        読み取り専用のウィンドウです。承認は claude attach か agent view で行ってください。
      </footer>
    </div>
  );
};

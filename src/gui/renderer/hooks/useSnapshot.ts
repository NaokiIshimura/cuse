import { useEffect, useRef, useState } from 'react';
import type { CuseBridge, Snapshot } from '../../ipc.js';
import type { Agent } from '../../../types/agent.js';

/** 一覧を取り直す間隔。`claude agents --json` の実行コストを踏まえて 2 秒にする。 */
export const POLL_INTERVAL_MS = 2000;

export interface UseSnapshotResult {
  readonly snapshot: Snapshot | null;
  /** 1 回前の一覧。完了直後（DONE!）の判定に使う。初回取得前は null */
  readonly previousAgents: readonly Agent[] | null;
}

/**
 * 一定間隔で一覧と台帳を取る。
 *
 * 前回の取得が終わっていなければ今回は飛ばす（`claude` を重ねて起こさない）。
 * 取得に失敗しても前回の一覧は捨てず、エラーだけを載せ替える。
 */
export const useSnapshot = (
  bridge: CuseBridge,
  intervalMs = POLL_INTERVAL_MS,
): UseSnapshotResult => {
  const [state, setState] = useState<UseSnapshotResult>({ snapshot: null, previousAgents: null });
  const fetching = useRef(false);

  useEffect(() => {
    let disposed = false;
    const tick = async () => {
      if (fetching.current) {
        return;
      }
      fetching.current = true;
      try {
        const snapshot = await bridge.getSnapshot();
        if (disposed) {
          return;
        }
        setState((previous) => ({
          snapshot,
          previousAgents:
            previous.snapshot?.agents.ok === true ? previous.snapshot.agents.agents : null,
        }));
      } finally {
        fetching.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [bridge, intervalMs]);

  return state;
};

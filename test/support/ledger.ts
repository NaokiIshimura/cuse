import type { Ledger, LedgerLeader, LedgerWorker } from '../../src/core/ledger.js';

/** テスト用の指揮役。必要な項目だけ上書きする。 */
export const makeLeader = (overrides: Partial<LedgerLeader> = {}): LedgerLeader => ({
  sessionId: 'leader-session',
  name: 'cuse-leader',
  startedAt: '2026-11-21T09:00:00.000Z',
  shortId: 'leader01',
  cwd: '/Users/example/project',
  permissionMode: null,
  tokenHash: null,
  ...overrides,
});

/** テスト用の配下。名前から sessionId と短縮 ID を作る。 */
export const makeWorker = (
  overrides: Partial<LedgerWorker> & { readonly name: string },
): LedgerWorker => ({
  shortId: `${overrides.name}-id`,
  sessionId: `${overrides.name}-session`,
  task: `${overrides.name} のタスク`,
  cwd: '/Users/example/project',
  worktree: null,
  startedAt: '2026-11-21T09:00:00.000Z',
  endedAt: null,
  endReason: null,
  promptCount: 0,
  ...overrides,
});

export const makeLedger = (overrides: Partial<Ledger> = {}): Ledger => ({
  version: 1,
  leader: null,
  workers: [],
  ...overrides,
});

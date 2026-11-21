import { describe, expect, it } from 'vitest';
import { createFakeWorld } from '../../test/support/fakeClaude.js';
import { makeLeader, makeLedger, makeWorker } from '../../test/support/ledger.js';
import { hashLeaderToken, LEADER_TOKEN_ENV } from '../core/leaderToken.js';
import type { RawAgent } from '../types/agent.js';
import { runClean } from './clean.js';
import { runReview } from './review.js';

const TOKEN = 't';

const finished = (name: string, cwd = `/w/${name}`): RawAgent => ({
  kind: 'background',
  id: `${name}-id`,
  sessionId: `${name}-session`,
  name,
  cwd,
  startedAt: 1,
  state: 'done',
});

const transcriptAt = (dir: string, report: string) =>
  [
    JSON.stringify({ type: 'user', cwd: '/w/app' }),
    JSON.stringify({ type: 'assistant', cwd: dir, message: { id: 'm', content: [{ type: 'text', text: report }] } }),
  ].join('\n');

const world = (env: NodeJS.ProcessEnv = { [LEADER_TOKEN_ENV]: TOKEN }) => {
  const w = createFakeWorld({
    agents: [
      finished('done-clean'),
      finished('dirty'),
      finished('unpushed'),
      { ...finished('busy'), state: 'working', status: 'busy', pid: 9 },
      finished('hand'),
    ],
    ledger: makeLedger({
      leader: makeLeader({ tokenHash: hashLeaderToken(TOKEN) }),
      workers: ['done-clean', 'dirty', 'unpushed', 'busy'].map((name) =>
        makeWorker({ name, shortId: `${name}-id`, sessionId: `${name}-session`, cwd: `/w/${name}` }),
      ),
    }),
    env,
  });
  // 配下は worktree へ移って作業した。git の様子はその場所で見る
  for (const name of ['done-clean', 'dirty', 'unpushed']) {
    w.transcripts.set(`${name}-session`, transcriptAt(`/w/${name}/.claude/worktrees/${name}`, `${name} の報告`));
  }
  w.git.set('/w/dirty/.claude/worktrees/dirty', { uncommitted: [' M a.ts'] });
  w.git.set('/w/unpushed/.claude/worktrees/unpushed', { upstream: null, unpushed: 2 });
  return w;
};

const rmCalls = (w: ReturnType<typeof world>) =>
  w.calls.filter((call) => call.command === 'claude' && call.args[0] === 'rm').map((call) => call.args[1]);

describe('runClean', () => {
  it('終わって作業を失わない配下だけを claude rm し、ほかは理由つきで残す', async () => {
    const w = world();
    const outcome = await runClean({}, w.deps);
    expect(outcome.ok && outcome.value).toEqual({
      cleaned: [{ name: 'done-clean', shortId: 'done-clean-id' }],
      kept: [
        { name: 'dirty', reason: 'commit していない変更が 1 件' },
        { name: 'unpushed', reason: 'push していない commit が 2 件' },
      ],
      running: ['busy'],
    });
    expect(rmCalls(w)).toEqual(['done-clean-id']);
    // 台帳の記録は消さず、片付けた印を付ける
    expect(w.ledger.workers.find((x) => x.name === 'done-clean')).toMatchObject({
      cleanedAt: '2026-11-21T09:00:00.000Z',
      endReason: '片付けた（cuse clean）',
    });
    expect(w.ledger.workers).toHaveLength(4);
  });

  it('台帳に無いセッション（人が動かしているもの）には触れない', async () => {
    const w = world();
    await runClean({}, w.deps);
    expect(rmCalls(w)).not.toContain('hand-id');
  });

  it('一度片付けた配下は二度触らない', async () => {
    const w = world();
    await runClean({}, w.deps);
    await runClean({}, w.deps);
    expect(rmCalls(w)).toEqual(['done-clean-id']);
  });

  it('指揮役でなければ断る。人の操作（ウィンドウ）ならトークンなしで使える', async () => {
    const w = world({});
    expect(await runClean({}, w.deps)).toMatchObject({ ok: false, error: { kind: 'denied' } });
    expect(rmCalls(w)).toEqual([]);
    expect((await runClean({ byHuman: true }, w.deps)).ok).toBe(true);
    expect(rmCalls(w)).toEqual(['done-clean-id']);
  });
});

describe('runReview', () => {
  it('worktree の場所・ブランチ・差分・残す理由・最後の報告をまとめる', async () => {
    const w = world({});
    w.git.set('/w/unpushed/.claude/worktrees/unpushed', { branch: 'cuse/unpushed', upstream: null, unpushed: 2 });
    const outcome = await runReview({ name: 'unpushed' }, w.deps);
    expect(outcome.ok && outcome.value).toMatchObject({
      name: 'unpushed',
      task: 'unpushed のタスク',
      workDir: '/w/unpushed/.claude/worktrees/unpushed',
      git: { repository: true, branch: 'cuse/unpushed', upstream: null, unpushed: 2, diffStat: '1 file changed, 1 insertion(+)' },
      pullRequest: null,
      lastReport: 'unpushed の報告',
      keep: 'push していない commit が 2 件',
    });
    expect(outcome.ok && outcome.text).toContain('片付けると作業を失います');
  });

  it('台帳に無いセッションも見られる（読むだけなので）', async () => {
    const w = world({});
    const outcome = await runReview({ name: 'hand' }, w.deps);
    expect(outcome.ok && outcome.value).toMatchObject({ name: 'hand', task: null, workDir: '/w/hand' });
  });

  it('知らない名前は not-found', async () => {
    expect(await runReview({ name: 'nothing' }, world().deps)).toMatchObject({ ok: false, error: { kind: 'not-found' } });
  });

  it('transcript が読めず worktree が分からない配下は、claude rm せずに残す', async () => {
    const w = world();
    w.transcripts.delete('done-clean-session');
    const outcome = await runClean({}, w.deps);
    expect(outcome.ok && outcome.value.kept).toContainEqual({
      name: 'done-clean',
      reason: '作業した場所（worktree）を transcript から確かめられない',
    });
    expect(rmCalls(w)).not.toContain('done-clean-id');
  });
});

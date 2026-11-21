import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import { approvalNotices } from './approvalNotices.js';

const blocked = (name: string) =>
  makeAgent({
    name,
    state: 'blocked',
    meta: { lastPrompt: undefined, tokens: undefined, subagents: [], pendingTool: { name: 'Bash', detail: 'npm test' } },
  });

describe('approvalNotices', () => {
  const watched = new Set(['tests-session', 'leader-session']);

  it('配下が承認待ちになったら、何の承認かを添えて知らせる', () => {
    const notices = approvalNotices([makeAgent({ name: 'tests' })], [blocked('tests')], watched, 0);
    expect(notices).toEqual([
      {
        sessionId: 'tests-session',
        title: 'tests が承認待ちです',
        body: 'Bash: npm test\ncuse で「開いて承認する」を押して、承認してください。',
      },
    ]);
  });

  it('起動直後・承認待ちのまま・台帳に無いセッションは知らせない', () => {
    expect(approvalNotices(null, [blocked('tests')], watched, 0)).toEqual([]);
    expect(approvalNotices([blocked('tests')], [blocked('tests')], watched, 0)).toEqual([]);
    expect(approvalNotices([makeAgent({ name: 'hand' })], [blocked('hand')], watched, 0)).toEqual([]);
  });

  it('作業中など、承認待ち以外への変化は知らせない', () => {
    expect(
      approvalNotices([makeAgent({ name: 'tests' })], [makeAgent({ name: 'tests', state: 'done' })], watched, 0),
    ).toEqual([]);
  });
});

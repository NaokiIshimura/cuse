import { describe, expect, it } from 'vitest';
import { emptyLedger, type Ledger } from './ledger.js';
import {
  checkLeader,
  createLeaderToken,
  hashLeaderToken,
  LEADER_TOKEN_ENV,
  withoutLeaderToken,
} from './leaderToken.js';

const token = createLeaderToken();

const ledger: Ledger = {
  ...emptyLedger(),
  leader: {
    sessionId: 'leader-session',
    name: 'cuse-leader',
    startedAt: '',
    shortId: 'abcd1234',
    cwd: '/w',
    permissionMode: null,
    tokenHash: hashLeaderToken(token),
  },
};

describe('checkLeader', () => {
  it('トークンが合えば指揮役', () => {
    expect(checkLeader({ [LEADER_TOKEN_ENV]: token }, ledger)).toEqual({ ok: true });
  });

  it('指揮役の background セッションの中からなら指揮役', () => {
    expect(checkLeader({ CLAUDE_JOB_DIR: '/Users/u/.claude/jobs/abcd1234' }, ledger)).toEqual({
      ok: true,
    });
  });

  it('トークンが違う・無い・別のセッションなら断る', () => {
    expect(checkLeader({ [LEADER_TOKEN_ENV]: 'nope' }, ledger).ok).toBe(false);
    expect(checkLeader({}, ledger).ok).toBe(false);
    expect(checkLeader({ CLAUDE_JOB_DIR: '/Users/u/.claude/jobs/ffff0000' }, ledger).ok).toBe(
      false,
    );
  });

  it('指揮役がいなければ断る', () => {
    const result = checkLeader({ [LEADER_TOKEN_ENV]: token }, null);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('指揮役がいません');
  });

  it('台帳にはトークンそのものを置かない', () => {
    expect(JSON.stringify(ledger)).not.toContain(token);
  });
});

describe('withoutLeaderToken', () => {
  it('トークンだけを外す', () => {
    expect(withoutLeaderToken({ [LEADER_TOKEN_ENV]: token, PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });

  it('cuse コマンドを動かすための ELECTRON_RUN_AS_NODE も配下へ渡さない', () => {
    expect(withoutLeaderToken({ ELECTRON_RUN_AS_NODE: '1', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });
});

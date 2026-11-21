import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import { makeLeader, makeLedger, makeWorker } from '../../test/support/ledger.js';
import { resolveAttachTarget } from './attachTarget.js';

const ledger = makeLedger({
  leader: makeLeader({ sessionId: 'L', shortId: 'lead0001' }),
  workers: [makeWorker({ name: 'tests', sessionId: 'T', shortId: 'old00001' })],
});

describe('resolveAttachTarget', () => {
  it('指揮役・配下・それ以外を見分け、一覧の短縮 ID を使う', () => {
    const agents = [
      makeAgent({ name: 'cuse-leader', sessionId: 'L', id: 'lead0001' }),
      makeAgent({ name: 'tests', sessionId: 'T', id: 'new00001' }),
      makeAgent({ name: 'other', sessionId: 'O', id: 'oth00001' }),
    ];
    expect(resolveAttachTarget('L', ledger, agents)).toEqual({ ok: true, shortId: 'lead0001', name: 'cuse-leader', role: 'leader' });
    expect(resolveAttachTarget('T', ledger, agents)).toEqual({ ok: true, shortId: 'new00001', name: 'tests', role: 'worker' });
    expect(resolveAttachTarget('O', ledger, agents)).toEqual({ ok: true, shortId: 'oth00001', name: 'other', role: 'other' });
  });

  it('一覧から消えていても、台帳の短縮 ID で開ける（止まった指揮役を attach で起こす）', () => {
    expect(resolveAttachTarget('L', ledger, [])).toEqual({ ok: true, shortId: 'lead0001', name: 'cuse-leader', role: 'leader' });
  });

  it('interactive セッションは開けない', () => {
    const agents = [makeAgent({ name: 'hand', sessionId: 'H', kind: 'interactive', id: undefined })];
    expect(resolveAttachTarget('H', ledger, agents).ok).toBe(false);
  });

  it('知らないセッション・おかしな短縮 ID は開けない（コマンドに混ぜない）', () => {
    expect(resolveAttachTarget('X', ledger, []).ok).toBe(false);
    const agents = [makeAgent({ name: 'evil', sessionId: 'E', id: '--help; rm' })];
    expect(resolveAttachTarget('E', ledger, agents).ok).toBe(false);
  });
});

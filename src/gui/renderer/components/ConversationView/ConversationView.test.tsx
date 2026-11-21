// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationEntry } from '../../../../shared/conversation.js';
import type { CuseBridge, SendToLeaderResult } from '../../../ipc.js';
import { ConversationView } from './index.js';

afterEach(cleanup);

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const entries: ConversationEntry[] = [
  { kind: 'system', id: 's', text: 'cuse の指揮役として起動しました。', at: 0 },
  { kind: 'user', id: 'u', text: 'README を直して', at: 1 },
  { kind: 'assistant', id: 'a', text: '配下を起こしました。`~/.claude/tmp/a.md` を見てください。', at: 2 },
  { kind: 'tool', id: 't', name: 'Bash', summary: 'cuse spawn …', at: 3 },
];

const makeBridge = (result: SendToLeaderResult = { ok: true }) => {
  const sent: string[] = [];
  const bridge = {
    getConversation: async () => entries,
    sendToLeader: async (text: string) => {
      sent.push(text);
      return result;
    },
  } as unknown as CuseBridge;
  return { bridge, sent };
};

describe('ConversationView', () => {
  it('依頼と返事を吹き出しで並べ、ツールの呼び出しは 1 行で出す', async () => {
    const { bridge } = makeBridge();
    const { container } = render(
      <ConversationView bridge={bridge} sessionId="s" state="waiting" active onShowTerminal={() => undefined} />,
    );
    await flush();
    expect(container.querySelector('.bubble--user')?.textContent).toBe('README を直して');
    expect(container.querySelector('.bubble--leader')?.textContent).toContain('配下を起こしました。');
    expect(container.querySelector('.tool-line')?.textContent).toBe('Bashcuse spawn …');
    expect(container.querySelector('.conversation__system')?.textContent).toContain('起動しました');
  });

  it('Enter で送る。日本語の変換を確定する Enter と Shift+Enter では送らない', async () => {
    const { bridge, sent } = makeBridge();
    const { container } = render(
      <ConversationView bridge={bridge} sessionId="s" state="waiting" active onShowTerminal={() => undefined} />,
    );
    await flush();
    const input = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'テストも足して' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(sent).toEqual([]);
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(sent).toEqual(['テストも足して']);
    expect(input.value).toBe('');
    expect(container.querySelector('.bubble--pending')?.textContent).toBe('テストも足して');
  });

  it('承認待ちのときは送らず、「端末で答える」で端末に切り替える', async () => {
    const { bridge, sent } = makeBridge();
    let shown = 0;
    const { container, getByText } = render(
      <ConversationView
        bridge={bridge}
        sessionId="s"
        state="blocked"
        active
        onShowTerminal={() => {
          shown += 1;
        }}
      />,
    );
    await flush();
    const input = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'はい' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(sent).toEqual([]);
    expect((container.querySelector('.composer__send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByText('端末で答える'));
    expect(shown).toBe(1);
  });

  it('main が送らなかったときは理由を出す', async () => {
    const { bridge } = makeBridge({ ok: false, reason: 'busy', message: '指揮役が作業中です。' });
    const { container } = render(
      <ConversationView bridge={bridge} sessionId="s" state="waiting" active onShowTerminal={() => undefined} />,
    );
    await flush();
    const input = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(container.querySelector('.composer__send') as HTMLElement);
    await flush();
    expect(container.querySelector('.composer__note')?.textContent).toBe('指揮役が作業中です。');
    expect(input.value).toBe('x');
  });

  it('返事の中のファイル名を押すと onLink を呼ぶ', async () => {
    const { bridge } = makeBridge();
    const clicked: unknown[] = [];
    const { getByText } = render(
      <ConversationView
        bridge={bridge}
        sessionId="s"
        state="waiting"
        active
        onShowTerminal={() => undefined}
        onLink={(link) => {
          clicked.push(link);
        }}
      />,
    );
    await flush();
    fireEvent.click(getByText('~/.claude/tmp/a.md'));
    expect(clicked).toEqual([{ text: '~/.claude/tmp/a.md', kind: 'file' }]);
  });
});

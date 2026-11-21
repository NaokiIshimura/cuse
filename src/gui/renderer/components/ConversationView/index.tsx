import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ConversationEntry } from '../../../../shared/conversation.js';
import type { CharacterState } from '../../../../types/agent.js';
import type { CuseBridge } from '../../../ipc.js';
import { MarkdownView, type MarkdownLinkHandler } from '../PreviewPane/MarkdownView.js';

/** 会話を取り直す間隔。 */
const POLL_MS = 1500;
/** いちばん下を見ているとみなす余白（これより上を読んでいたら、勝手に下へ動かさない）。 */
const STICK_PX = 80;

interface ConversationViewProps {
  readonly bridge: CuseBridge;
  readonly sessionId: string;
  /** 指揮役のいまの状態（一覧から） */
  readonly state: CharacterState;
  /** 表に出ているか（隠れている間は取り直さない） */
  readonly active: boolean;
  /** 「端末」に切り替える（承認に答えるとき） */
  readonly onShowTerminal: () => void;
  readonly onLink?: MarkdownLinkHandler | undefined;
}

/** 送れる状態か（main も同じ条件で確かめる。ここでは入力欄を止めるために使う）。 */
const isReady = (state: CharacterState): boolean => state === 'waiting' || state === 'done' || state === 'justFinished';

const notice = (state: CharacterState): string | null => {
  switch (state) {
    case 'working':
      return '指揮役が作業しています… 手が空いたら送れます（急ぎなら「端末」から）。';
    case 'blocked':
      return null;
    case 'stopped':
    case 'unknown':
      return '指揮役の様子が分かりません。「端末」で確かめてください。';
    default:
      return null;
  }
};

/**
 * 指揮役との会話の画面。transcript から人の依頼と返事を吹き出しで並べ、下の入力欄から指揮役に送る。
 *
 * 送るのは main（指揮役の端末へ書き込む）。承認待ち・作業中は送らない（Enter が権限の確認への返事になるため）。
 * 承認待ちのときは「端末で答える」で Claude Code の画面に切り替え、人がそこで答える（承認のボタンは作らない）。
 */
export const ConversationView = ({ bridge, sessionId, state, active, onShowTerminal, onLink }: ConversationViewProps) => {
  const [entries, setEntries] = useState<readonly ConversationEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 送ったが、まだ transcript に出てきていない文
  const [pending, setPending] = useState<{ readonly text: string; readonly count: number } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!active) {
      return;
    }
    let disposed = false;
    const load = async () => {
      const next = await bridge.getConversation(sessionId).catch(() => null);
      if (!disposed && next !== null) {
        setEntries(next);
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [bridge, sessionId, active]);

  // 送った文が会話に出てきたら、仮の吹き出しを消す
  const userCount = entries.filter((entry) => entry.kind === 'user').length;
  useEffect(() => {
    if (pending !== null && userCount > pending.count) {
      setPending(null);
    }
  }, [pending, userCount]);

  // いちばん下を見ていたら、新しいものが来たときに下へ動かす
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && stick.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [entries, pending]);

  const ready = isReady(state);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text === '' || sending) {
      return;
    }
    setSending(true);
    setError(null);
    const result = await bridge.sendToLeader(text).catch((reason: unknown) => ({
      ok: false as const,
      reason: 'unavailable' as const,
      message: `送れませんでした: ${String(reason)}`,
    }));
    setSending(false);
    if (result.ok) {
      setDraft('');
      setPending({ text, count: userCount });
      stick.current = true;
    } else {
      setError(result.message);
    }
  }, [bridge, draft, sending, userCount]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 日本語入力の変換を確定する Enter では送らない。Shift+Enter は改行
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (ready) {
        void send();
      }
    }
  };

  const status = notice(state);

  return (
    <div className={active ? 'conversation' : 'conversation conversation--hidden'}>
      <div
        className="conversation__log"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX;
        }}
      >
        {entries.length === 0 && pending === null ? (
          <p className="conversation__empty">まだ会話がありません。下に、やってほしいことを書いて送ってください。</p>
        ) : null}
        {entries.map((entry) => {
          switch (entry.kind) {
            case 'user':
              return (
                <div key={entry.id} className="bubble-row bubble-row--user">
                  <div className="bubble bubble--user">{entry.text}</div>
                </div>
              );
            case 'assistant':
              return (
                <div key={entry.id} className="bubble-row bubble-row--leader">
                  <MarkdownView className="bubble bubble--leader" text={entry.text} onLink={onLink} />
                </div>
              );
            case 'tool':
              return (
                <div key={entry.id} className="bubble-row bubble-row--leader">
                  <div className="tool-line" title={entry.summary}>
                    <span className="tool-line__name">{entry.name}</span>
                    <span className="tool-line__summary">{entry.summary}</span>
                  </div>
                </div>
              );
            case 'system':
              return (
                <p key={entry.id} className="conversation__system">
                  {entry.text}
                </p>
              );
          }
        })}
        {pending === null ? null : (
          <div className="bubble-row bubble-row--user">
            <div className="bubble bubble--user bubble--pending">{pending.text}</div>
          </div>
        )}
        {state === 'working' ? <p className="conversation__typing">指揮役が作業しています…</p> : null}
      </div>
      {state === 'blocked' ? (
        <div className="conversation__blocked" role="alert">
          <span>指揮役が承認を待っています。Claude Code の画面で答えてください。</span>
          <button type="button" className="link-button" onClick={onShowTerminal}>
            端末で答える
          </button>
        </div>
      ) : null}
      <div className="composer">
        <textarea
          className="composer__input"
          value={draft}
          rows={Math.min(6, Math.max(2, draft.split('\n').length))}
          placeholder={ready ? '指揮役に頼む…（Enter で送る・Shift+Enter で改行）' : (status ?? '指揮役が承認を待っています')}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          aria-label="指揮役への依頼"
        />
        <button
          type="button"
          className="composer__send"
          disabled={!ready || sending || draft.trim() === ''}
          onClick={() => void send()}
        >
          送る
        </button>
      </div>
      {error === null && (ready || status === null) ? null : (
        <p className="composer__note" role="status">
          {error ?? status}
        </p>
      )}
    </div>
  );
};

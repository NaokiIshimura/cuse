import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CuseBridge } from '../../../ipc.js';

interface TerminalViewProps {
  readonly bridge: CuseBridge;
  readonly tabId: string;
  /** 開く相手。実行するコマンドは main が決める */
  readonly sessionId: string;
  /** 表に出ているタブか。隠れている間も会話の続きを受け取るため、閉じずに残す */
  readonly active: boolean;
}

type Connection =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'open' }
  | { readonly kind: 'closed'; readonly message: string };

/**
 * 埋め込み端末。中で `claude attach` が動き、Claude Code の画面をそのまま映す。
 *
 * cuse 独自の入力欄は作らない。人はこの中で Claude Code に直接打ち込み、配下の承認もここで行う
 * （cuse が承認するのではなく、人が Claude Code の画面で承認する）。
 */
export const TerminalView = ({ bridge, tabId, sessionId, active }: TerminalViewProps) => {
  const container = useRef<HTMLDivElement | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [connection, setConnection] = useState<Connection>({ kind: 'connecting' });

  const connect = useCallback(async () => {
    const term = terminal.current;
    if (term === null) {
      return;
    }
    setConnection({ kind: 'connecting' });
    const result = await bridge.openTerminal({ tabId, sessionId, cols: term.cols, rows: term.rows });
    setConnection(result.ok ? { kind: 'open' } : { kind: 'closed', message: result.message });
  }, [bridge, tabId, sessionId]);

  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return;
    }
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false,
      theme: { background: '#0e1014', foreground: '#e6e8eb' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(element);
    fitAddon.fit();
    terminal.current = term;
    fit.current = fitAddon;

    const input = term.onData((data) => {
      bridge.writeTerminal(tabId, data);
    });
    const resize = term.onResize(({ cols, rows }) => {
      bridge.resizeTerminal(tabId, cols, rows);
    });
    const offData = bridge.onTerminalData((id, data) => {
      if (id === tabId) {
        term.write(data);
      }
    });
    const offExit = bridge.onTerminalExit((id, exitCode) => {
      if (id === tabId) {
        setConnection({
          kind: 'closed',
          message: `claude attach が終わりました（終了コード ${exitCode}）。セッションは動き続けています。`,
        });
      }
    });
    // 枠の大きさが変わったら端末の桁数・行数を合わせる
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(element);

    void connect();

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      offData();
      offExit();
      // タブを閉じたら attach を切る（セッションは止めない）
      bridge.closeTerminal(tabId);
      term.dispose();
      terminal.current = null;
      fit.current = null;
    };
  }, [bridge, tabId, connect]);

  // 表に出たときに大きさを合わせ直し、入力を受けられるようにする
  useEffect(() => {
    if (active) {
      fit.current?.fit();
      terminal.current?.focus();
    }
  }, [active]);

  return (
    <div className={active ? 'terminal-view' : 'terminal-view terminal-view--hidden'}>
      <div className="terminal-view__screen" ref={container} />
      {connection.kind === 'closed' ? (
        <div className="terminal-view__notice" role="status">
          <span>{connection.message}</span>
          <button type="button" className="link-button" onClick={() => void connect()}>
            つなぎ直す
          </button>
        </div>
      ) : null}
    </div>
  );
};

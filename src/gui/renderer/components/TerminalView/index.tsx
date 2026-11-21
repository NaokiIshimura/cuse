import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findTerminalLinks, type TerminalLink } from '../../../../shared/terminalLinks.js';
import type { CuseBridge } from '../../../ipc.js';

interface TerminalViewProps {
  readonly bridge: CuseBridge;
  readonly tabId: string;
  /** main に端末を開いてもらう。実行するコマンドは main が決める */
  readonly open: (
    cols: number,
    rows: number,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** 表に出ているタブか。隠れている間も会話の続きを受け取るため、閉じずに残す */
  readonly active: boolean;
  /** 画面のファイル名・URL が押されたとき（右のプレビューに出す）。無ければ押せるようにしない */
  readonly onLink?: ((link: Pick<TerminalLink, 'text' | 'kind'>) => void) | undefined;
}

/**
 * 端末の 1 行を文字列にし、文字列の位置 → 桁（1 始まり）の対応を作る。
 * 日本語などの全角は 2 桁を使うので、文字列の位置と桁はずれる。
 */
const lineText = (term: Terminal, y: number): { readonly text: string; readonly columns: readonly number[] } | null => {
  const line = term.buffer.active.getLine(y - 1);
  if (line === undefined) {
    return null;
  }
  let text = '';
  const columns: number[] = [];
  for (let x = 0; x < line.length; x += 1) {
    const cell = line.getCell(x);
    // 全角の 2 桁目（幅 0）は飛ばす
    if (cell === undefined || cell.getWidth() === 0) {
      continue;
    }
    const chars = cell.getChars() === '' ? ' ' : cell.getChars();
    for (let unit = 0; unit < chars.length; unit += 1) {
      text += chars[unit];
      columns.push(x + 1);
    }
  }
  return { text, columns };
};

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
export const TerminalView = ({ bridge, tabId, open, active, onLink }: TerminalViewProps) => {
  const container = useRef<HTMLDivElement | null>(null);
  // 端末を作り直さずに最新の onLink を呼べるよう、ref に入れておく
  const onLinkRef = useRef(onLink);
  onLinkRef.current = onLink;
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [connection, setConnection] = useState<Connection>({ kind: 'connecting' });

  const connect = useCallback(async () => {
    const term = terminal.current;
    if (term === null) {
      return;
    }
    setConnection({ kind: 'connecting' });
    // 失敗を黙って捨てると、端末が真っ暗なまま理由が分からない。必ず画面に出す
    const result = await open(term.cols, term.rows).catch((error: unknown) => ({
      ok: false as const,
      message: `端末を起こせませんでした: ${String(error)}`,
    }));
    setConnection(result.ok ? { kind: 'open' } : { kind: 'closed', message: result.message });
  }, [open]);

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

    // 画面のファイル名・URL を押せるようにする（下線と指のカーソル）。開くかどうかは main が確かめる
    const links = term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = onLinkRef.current === undefined ? null : lineText(term, y);
        const found = line === null ? [] : findTerminalLinks(line.text);
        if (line === null || found.length === 0) {
          callback(undefined);
          return;
        }
        callback(
          found.map((link) => ({
            range: {
              start: { x: line.columns[link.start] ?? 1, y },
              end: { x: line.columns[link.end - 1] ?? 1, y },
            },
            text: link.text,
            decorations: { underline: true, pointerCursor: true },
            activate: () => {
              onLinkRef.current?.({ text: link.text, kind: link.kind });
            },
          })),
        );
      },
    });

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
      links.dispose();
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

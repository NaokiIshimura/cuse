import { useCallback, useEffect, useMemo, useState } from 'react';
import { previewKey, type PreviewItem } from '../../../../shared/previewItems.js';
import type { CuseBridge, PreviewResult } from '../../../ipc.js';
import { CodeView } from './CodeView.js';
import { languageOf } from './highlight.js';
import { MarkdownView } from './MarkdownView.js';

/** プレビューの一覧を取り直す間隔。 */
const POLL_MS = 2000;
/** 上に並べるタブの数。古いものから閉じる。 */
const MAX_TABS = 5;
/** 下の履歴に出す数。 */
const HISTORY_LIMIT = 20;

interface PreviewPaneProps {
  readonly bridge: CuseBridge;
  /** 見ているセッション。いなければ null */
  readonly sessionId: string | null;
  readonly sessionName: string | null;
  /** 追いかけ中か（固定していないか） */
  readonly following: boolean;
  readonly onToggleFollow: () => void;
}

const itemTitle = (item: PreviewItem): string =>
  item.kind === 'file' ? (item.path.split('/').at(-1) ?? item.path) : item.url.replace(/^https?:\/\//, '');

const itemTool = (item: PreviewItem): string =>
  item.kind === 'url' ? (item.tool === 'WebFetch' ? 'WebFetch' : '会話') : item.tool;

/** 整えて見せられるファイルか（Markdown）。 */
const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path);

/** 文字のファイルの見せ方。差分・整えた表示（Markdown）・元の文字。 */
type TextMode = 'diff' | 'rendered' | 'source';

/** git diff を色分けして見せる。 */
const DiffText = ({ diff }: { readonly diff: string }) => (
  <pre className="preview-text">
    {diff.split('\n').map((line, index) => {
      const kind = line.startsWith('@@')
        ? 'hunk'
        : line.startsWith('+') && !line.startsWith('+++')
          ? 'add'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'del'
            : 'context';
      return (
        <div className={`preview-diff preview-diff--${kind}`} key={index}>
          {line === '' ? ' ' : line}
        </div>
      );
    })}
  </pre>
);

/** 開いたものの中身。 */
const PreviewBody = ({
  item,
  result,
  onReveal,
  onOpenExternal,
}: {
  readonly item: PreviewItem;
  readonly result: PreviewResult | null;
  readonly onReveal: () => void;
  readonly onOpenExternal: (url: string) => void;
}) => {
  const path = item.kind === 'file' ? item.path : '';
  const markdown = isMarkdown(path);
  // 書き換えたファイルはまず差分、Markdown はまず整えた表示を見せる
  const [chosen, setChosen] = useState<TextMode | null>(null);
  if (result === null) {
    return <p className="preview__message">読み込んでいます…</p>;
  }
  switch (result.kind) {
    case 'url':
      return (
        <div className="preview-web">
          <div className="preview__toolbar">
            <span className="preview__path">{result.url}</span>
            <button type="button" className="link-button link-button--small" onClick={() => onOpenExternal(result.url)}>
              ブラウザで開く
            </button>
          </div>
          <webview className="preview-web__view" src={result.url} partition="cuse-preview" />
        </div>
      );
    case 'image':
      return (
        <div className="preview-image">
          <img src={result.dataUrl} alt={item.kind === 'file' ? item.path : ''} />
        </div>
      );
    case 'masked':
      return (
        <div className="preview__message">
          <p>秘密が入っていそうなファイルなので、中身を伏せています。</p>
          <button type="button" className="link-button" onClick={onReveal}>
            中身を見る
          </button>
        </div>
      );
    case 'unavailable':
      return <p className="preview__message">{result.message}</p>;
    case 'text': {
      const diff = result.diff;
      const modes: TextMode[] = [
        ...(diff === null ? [] : (['diff'] as const)),
        ...(markdown ? (['rendered'] as const) : []),
        'source',
      ];
      const mode = chosen !== null && modes.includes(chosen) ? chosen : (modes[0] ?? 'source');
      const label: Record<TextMode, string> = { diff: '差分', rendered: '整えて見る', source: '元の文字' };
      return (
        <div className="preview-file">
          <div className="preview__toolbar">
            <span className="preview__path">{path}</span>
            {modes.length < 2 ? null : (
              <span className="preview__modes" role="group" aria-label="見せ方">
                {modes.map((candidate) => (
                  <button
                    type="button"
                    key={candidate}
                    aria-pressed={candidate === mode}
                    className={
                      candidate === mode ? 'link-button link-button--small link-button--on' : 'link-button link-button--small'
                    }
                    onClick={() => {
                      setChosen(candidate);
                    }}
                  >
                    {label[candidate]}
                  </button>
                ))}
              </span>
            )}
          </div>
          {mode === 'diff' && diff !== null ? (
            <DiffText diff={diff} />
          ) : mode === 'rendered' ? (
            <MarkdownView text={result.text} />
          ) : (
            <CodeView text={result.text} language={languageOf(path)} />
          )}
          {result.truncated ? <p className="preview__message">大きなファイルなので、先頭だけを出しています。</p> : null}
        </div>
      );
    }
  }
};

/**
 * 右のプレビュー。セッションに出てきたファイル・差分・画像・Web サイトを見せる。
 *
 * - 既定では、中央で見ているセッション（指揮役か、開いた配下）を追いかけ、新しく出てきたものを開く
 * - 「固定」で追いかけを止める（いま見ているセッションのまま、自動では開かない）
 * - 開けるのはセッションに出てきたものだけ。中身は main が確かめてから読む
 */
export const PreviewPane = ({ bridge, sessionId, sessionName, following, onToggleFollow }: PreviewPaneProps) => {
  const [items, setItems] = useState<readonly PreviewItem[]>([]);
  const [tabs, setTabs] = useState<readonly string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  // セッションが変わったら、開いていたものは閉じる（別のセッションのものを出し続けない）
  useEffect(() => {
    setItems([]);
    setTabs([]);
    setActiveKey(null);
    setResult(null);
    setRevealed(new Set());
  }, [sessionId]);

  useEffect(() => {
    if (sessionId === null) {
      return;
    }
    let disposed = false;
    const load = async () => {
      const next = await bridge.getPreviewItems(sessionId);
      if (!disposed) {
        setItems(next);
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [bridge, sessionId]);

  const open = useCallback((key: string) => {
    setTabs((current) => (current.includes(key) ? current : [...current, key].slice(-MAX_TABS)));
    setActiveKey(key);
  }, []);

  // 追いかけ中は、いちばん新しく出てきたものを開く
  const newestKey = items[0] === undefined ? null : previewKey(items[0]);
  useEffect(() => {
    if (following && newestKey !== null) {
      open(newestKey);
    }
  }, [following, newestKey, open]);

  const itemsByKey = useMemo(() => new Map(items.map((item) => [previewKey(item), item])), [items]);
  const activeItem = activeKey === null ? undefined : itemsByKey.get(activeKey);
  const reveal = activeKey !== null && revealed.has(activeKey);

  useEffect(() => {
    if (sessionId === null || activeKey === null) {
      setResult(null);
      return;
    }
    let disposed = false;
    setResult(null);
    void bridge.readPreview(sessionId, activeKey, reveal).then((next) => {
      if (!disposed) {
        setResult(next);
      }
    });
    return () => {
      disposed = true;
    };
  }, [bridge, sessionId, activeKey, reveal]);

  return (
    <section className="preview" aria-label="プレビュー">
      <header className="pane-header">
        <span className="pane-header__title">PREVIEW</span>
        <button
          type="button"
          className={following ? 'preview__follow preview__follow--on' : 'preview__follow'}
          onClick={onToggleFollow}
          title={following ? '中央で見ているセッションを追いかけています。押すと固定します' : '固定しています。押すと追いかけます'}
        >
          {following ? '● 追いかけ中' : '固定'}
        </button>
      </header>
      {sessionId === null ? (
        <p className="preview__message">中央でセッションを開くと、そのセッションに出てきたファイルやサイトをここに出します。</p>
      ) : (
        <>
          <p className="preview__session">{sessionName ?? ''} に出てきたもの</p>
          {tabs.length === 0 ? null : (
            <nav className="preview-tabs" role="tablist">
              {tabs.map((key) => {
                const item = itemsByKey.get(key);
                return (
                  <button
                    type="button"
                    role="tab"
                    key={key}
                    aria-selected={key === activeKey}
                    className={key === activeKey ? 'preview-tab preview-tab--active' : 'preview-tab'}
                    onClick={() => {
                      setActiveKey(key);
                    }}
                    title={key.replace(/^(file|url):/, '')}
                  >
                    {item === undefined ? key.replace(/^(file|url):/, '') : itemTitle(item)}
                  </button>
                );
              })}
            </nav>
          )}
          <div className="preview__body">
            {activeItem === undefined ? (
              <p className="preview__message">まだ何も出てきていません。ファイルを読んだり書いたり、サイトを開いたりすると、ここに出ます。</p>
            ) : (
              <PreviewBody
                key={activeKey ?? ''}
                item={activeItem}
                result={result}
                onReveal={() => {
                  if (activeKey !== null) {
                    setRevealed((current) => new Set([...current, activeKey]));
                  }
                }}
                onOpenExternal={(url) => {
                  void bridge.openExternalUrl(sessionId, url);
                }}
              />
            )}
          </div>
          <section className="preview-history" aria-label="履歴">
            <h2 className="preview-history__title">HISTORY</h2>
            <ul className="preview-history__list">
              {items.slice(0, HISTORY_LIMIT).map((item) => (
                <li key={previewKey(item)}>
                  <button
                    type="button"
                    className="preview-history__item"
                    onClick={() => {
                      open(previewKey(item));
                    }}
                  >
                    <span className="preview-history__name">{item.kind === 'file' ? item.path : item.url}</span>
                    <span className="preview-history__tool">{itemTool(item)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
};

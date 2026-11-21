import { useMemo, type ReactNode } from 'react';
import { findTerminalLinks, type TerminalLink } from '../../../../shared/terminalLinks.js';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeView } from './CodeView.js';
import { languageOfFence } from './highlight.js';

/**
 * Markdown を整えて見せる（見出し・表・リスト・引用・コード）。
 *
 * ファイルの中身は人が書いたとは限らないので、次のように扱う。
 * - 埋め込まれた HTML は出さない（`skipHtml`）
 * - リンクは押しても移らない（行き先は title で見せる）。renderer のページが別の場所へ移るのを避けるため
 * - 画像は読み込まない（代わりの文字を出す）。手元のファイルや外のサーバーを勝手に読みに行かないため
 * - コードブロックは、言語が分かれば色を付ける（```mermaid などの図は、コードとしてそのまま見せる）
 *
 * 会話の画面では `onLink` を渡す。文の中のファイル名・URL とリンクを押せるようにし、押したものは
 * 右のプレビューで開く（開いてよいかは main が確かめる。ページは移らない）。
 */

export type MarkdownLinkHandler = (link: Pick<TerminalLink, 'text' | 'kind'>) => void;

/** コードブロック・インラインコード・Markdown のリンクの外にあるファイル名・URL を、リンクの書き方に直す。 */
export const linkifyMarkdown = (markdown: string): string =>
  markdown
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, fenceIndex) =>
      fenceIndex % 2 === 1
        ? part
        : part
            .split(/(`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]*>)/)
            .map((piece, index) => {
              if (index % 2 === 1) {
                return piece;
              }
              let out = '';
              let at = 0;
              for (const link of findTerminalLinks(piece)) {
                out += `${piece.slice(at, link.start)}[${link.text}](<${link.text}>)`;
                at = link.end;
              }
              return out + piece.slice(at);
            })
            .join(''),
    )
    .join('');

const kindOf = (target: string): TerminalLink['kind'] => (/^https?:\/\//i.test(target) ? 'url' : 'file');

interface HastText {
  readonly type: string;
  readonly value?: string;
  readonly tagName?: string;
  readonly properties?: { readonly className?: unknown };
  readonly children?: readonly HastText[];
}

const textOf = (node: HastText): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('');

const fenceOf = (node: HastText | undefined): string => {
  const classes = Array.isArray(node?.properties?.className) ? (node.properties.className as unknown[]) : [];
  const language = classes.find((name): name is string => typeof name === 'string' && name.startsWith('language-'));
  return language === undefined ? '' : language.slice('language-'.length);
};

const createComponents = (onLink: MarkdownLinkHandler | undefined): Components => ({
  a: ({ children, href }) =>
    onLink === undefined || href === undefined || href === '' ? (
      <span className="preview-md__link" title={href ?? ''}>
        {children}
      </span>
    ) : (
      <button
        type="button"
        className="preview-md__link preview-md__link--open"
        title={`${href} をプレビューで開く`}
        onClick={() => {
          onLink({ text: href, kind: kindOf(href) });
        }}
      >
        {children}
      </button>
    ),
  // インラインコードが丸ごとファイル名・URL なら押せるようにする（`~/.claude/tmp/a.md` など）
  code: ({ children }) => {
    const text = typeof children === 'string' ? children : '';
    const [only] = findTerminalLinks(text);
    if (onLink === undefined || only === undefined || only.start !== 0 || only.end !== text.length) {
      return <code>{children}</code>;
    }
    return (
      <code>
        <button
          type="button"
          className="preview-md__link preview-md__link--open"
          title={`${text} をプレビューで開く`}
          onClick={() => {
            onLink({ text, kind: only.kind });
          }}
        >
          {text}
        </button>
      </code>
    );
  },
  img: ({ alt, src }) => (
    <span className="preview-md__image" title={src ?? ''}>
      [画像: {alt === undefined || alt === '' ? (src ?? '') : alt}]
    </span>
  ),
  pre: ({ node }) => {
    const code = (node as HastText | undefined)?.children?.find((child) => child.tagName === 'code');
    const text = code === undefined ? '' : textOf(code).replace(/\n$/, '');
    const fence = fenceOf(code);
    return (
      <div className="preview-md__code">
        {fence === '' ? null : <span className="preview-md__fence">{fence}</span>}
        <CodeView text={text} language={languageOfFence(fence)} numbered={false} />
      </div>
    );
  },
});

const PREVIEW_COMPONENTS = createComponents(undefined);

export const MarkdownView = ({
  text,
  onLink,
  className,
}: {
  readonly text: string;
  readonly onLink?: MarkdownLinkHandler | undefined;
  readonly className?: string | undefined;
}): ReactNode => {
  const components = useMemo(() => (onLink === undefined ? PREVIEW_COMPONENTS : createComponents(onLink)), [onLink]);
  return (
    <div className={className === undefined ? 'preview-md' : `preview-md ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {onLink === undefined ? text : linkifyMarkdown(text)}
      </Markdown>
    </div>
  );
};

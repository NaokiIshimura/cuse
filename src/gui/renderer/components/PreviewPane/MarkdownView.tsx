import type { ReactNode } from 'react';
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
 */

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

const components: Components = {
  a: ({ children, href }) => (
    <span className="preview-md__link" title={href ?? ''}>
      {children}
    </span>
  ),
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
};

export const MarkdownView = ({ text }: { readonly text: string }): ReactNode => (
  <div className="preview-md">
    <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
      {text}
    </Markdown>
  </div>
);

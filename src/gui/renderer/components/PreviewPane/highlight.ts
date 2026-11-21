import { common, createLowlight } from 'lowlight';

/**
 * プレビューのコードの色付け。
 *
 * lowlight（highlight.js の文法）で構文木を作り、HTML の文字列にはせずに「行ごとの、色の付いた断片」に直す。
 * HTML として差し込まない（dangerouslySetInnerHTML を使わない）ので、ファイルの中身がそのまま画面の部品になることはない。
 * 行番号を付けるため、複数行にまたがる色（ブロックコメントなど）も行ごとに切り分ける。
 */

const lowlight = createLowlight(common);

/** 色の付いた断片。`classes` は highlight.js のクラス名（`hljs-keyword` など）。 */
export interface Segment {
  readonly text: string;
  readonly classes: readonly string[];
}

/** 拡張子・ファイル名から、highlight.js の言語名を決める。分からなければ null（色を付けない）。 */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonl: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  diff: 'diff',
  patch: 'diff',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
};

const BY_NAME: Readonly<Record<string, string>> = {
  Makefile: 'makefile',
  Dockerfile: 'dockerfile',
};

export const languageOf = (path: string): string | null => {
  const name = path.split('/').at(-1) ?? path;
  const byName = BY_NAME[name];
  if (byName !== undefined) {
    return byName;
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const language = BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
  return language !== undefined && lowlight.registered(language) ? language : null;
};

/** コードブロックの言語名（```ts など）を、使える言語名に直す。分からなければ null。 */
export const languageOfFence = (fence: string): string | null => {
  const name = fence.trim().toLowerCase();
  if (name === '') {
    return null;
  }
  const mapped = BY_EXTENSION[name] ?? name;
  return lowlight.registered(mapped) ? mapped : null;
};

interface HastNode {
  readonly type: string;
  readonly value?: string;
  readonly properties?: { readonly className?: unknown };
  readonly children?: readonly HastNode[];
}

const flatten = (node: HastNode, classes: readonly string[], out: Segment[]): void => {
  if (node.type === 'text') {
    out.push({ text: node.value ?? '', classes });
    return;
  }
  const own = Array.isArray(node.properties?.className)
    ? (node.properties.className as unknown[]).filter((name): name is string => typeof name === 'string')
    : [];
  const next = own.length === 0 ? classes : [...classes, ...own];
  for (const child of node.children ?? []) {
    flatten(child, next, out);
  }
};

/** 断片を行ごとに分ける（改行をまたぐ断片は切り分け、色は両方の行に残す）。 */
export const splitLines = (segments: readonly Segment[]): Segment[][] => {
  const lines: Segment[][] = [[]];
  for (const segment of segments) {
    const parts = segment.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (part !== '') {
        lines.at(-1)?.push({ text: part, classes: segment.classes });
      }
    });
  }
  return lines;
};

/**
 * 文字を色付けし、行ごとの断片にする。言語が分からない・色付けに失敗したときは、色なしの行にする。
 */
export const highlightLines = (text: string, language: string | null): Segment[][] => {
  if (language === null) {
    return text.split('\n').map((line) => (line === '' ? [] : [{ text: line, classes: [] }]));
  }
  try {
    const tree = lowlight.highlight(language, text) as unknown as HastNode;
    const segments: Segment[] = [];
    flatten(tree, [], segments);
    return splitLines(segments);
  } catch {
    return highlightLines(text, null);
  }
};

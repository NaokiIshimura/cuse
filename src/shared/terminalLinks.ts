/**
 * 埋め込み端末の 1 行から、押せるもの（URL・ファイルらしいもの）を探す。
 *
 * ここでは「それらしい文字列」を拾うだけで、開いてよいか・本当にあるかは main が確かめる
 * （そのセッションの transcript に出てきたものか、ファイルがあるか）。
 * renderer からも使うので `node:*` に依存させない。
 */

export interface TerminalLink {
  /** 行の文字列の中での位置（`end` は含まない） */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: 'url' | 'file';
}

/** URL。日本語や全角の記号・かっこで止める（previewItems の会話の URL と同じ考え方）。 */
const URL_PATTERN = /https?:\/\/[^\s"'`<>()[\]{}\u0080-￿]+/g;

/**
 * ファイルらしいもの。
 * - `/` か `~/` か `./` `../` で始まるパス
 * - `src/a.ts` のように `/` を含み、拡張子で終わるもの
 * - `README.md` のように拡張子（英字を含む）で終わる名前
 * 使える文字は ASCII の英数字と `_ . - @ + / ~` だけ（日本語の文に続けて書かれても切れるように）。
 */
const FILE_PATTERN = /(?:~|\.{1,2})?\/?[\w.@+-]*[\w@+-](?:\/[\w.@+-]+)*/g;

/** 末尾についた句読点などを外す。 */
const trimEnd = (text: string): string => text.replace(/[.,;:!?*_)\]]+$/u, '');

const looksLikeFile = (text: string): boolean => {
  if (/^(?:~\/|\.{1,2}\/|\/)[^/]/.test(text)) {
    // `/` だけ・`//` などは除く。絶対パスは少なくとも 2 段（`/Users/x`）あるものに限る
    return text.startsWith('/') ? /^\/[^/]+\/[^/]/.test(text) : true;
  }
  // 拡張子で終わる（拡張子に英字を含む。`v0.3.6` や `1.5` を拾わない）。
  // `/` を含まない名前は、拡張子の前が 2 文字以上のものに限る（`e.g` を拾わない）
  return (
    /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(text) &&
    /^[\w@+-]/.test(text) &&
    (text.includes('/') || /^[^.]{2,}\./.test(text))
  );
};

export const findTerminalLinks = (line: string): TerminalLink[] => {
  const links: TerminalLink[] = [];
  const taken: [number, number][] = [];
  for (const match of line.matchAll(URL_PATTERN)) {
    const text = trimEnd(match[0]);
    if (!/^https?:\/\/[^/?#]+/i.test(text)) {
      continue;
    }
    links.push({ start: match.index, end: match.index + text.length, text, kind: 'url' });
    taken.push([match.index, match.index + match[0].length]);
  }
  for (const match of line.matchAll(FILE_PATTERN)) {
    const start = match.index;
    if (taken.some(([from, to]) => start >= from && start < to)) {
      continue;
    }
    // 前の文字が英数字や記号の途中なら、語の途中なので拾わない（`a=b/c.ts` の `b/c.ts` は拾う）
    const before = line[start - 1];
    if (before !== undefined && /[\w./~@+-]/.test(before)) {
      continue;
    }
    const text = trimEnd(match[0]);
    if (text.length < 3 || !looksLikeFile(text)) {
      continue;
    }
    links.push({ start, end: start + text.length, text, kind: 'file' });
  }
  return links.sort((a, b) => a.start - b.start);
};

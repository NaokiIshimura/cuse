import { isAbsolute, join, resolve } from 'node:path';
import type { PreviewItem } from '../shared/previewItems.js';

/**
 * 埋め込み端末で押されたもの（URL・ファイル名）を、プレビューに出せるものに直す（main で使う）。
 *
 * 右のプレビューは「セッションに出てきたもの」だけを開く約束なので、押された文字列が
 * そのセッションの transcript にそのまま出てきたときだけ受け付ける（画面に別のものを打ち込んで開かせない）。
 * ファイルは、`~` をホームに、相対パスをセッションが作業している場所（transcript の最後の cwd）からのパスに直し、
 * 本当にあるファイルだけを受け付ける。
 */

export interface ResolveLinkOptions {
  /** そのセッションの transcript の末尾 */
  readonly chunk: string;
  /** そのセッションが作業している場所。分からなければ null */
  readonly cwd: string | null;
  readonly home: string;
  readonly now: number;
  /** ファイルがあるか（ディレクトリは false） */
  readonly isFile: (path: string) => Promise<boolean>;
}

export type ResolveLinkResult =
  | { readonly ok: true; readonly item: PreviewItem }
  | { readonly ok: false; readonly message: string };

export const resolveTerminalLink = async (
  text: string,
  kind: 'url' | 'file',
  options: ResolveLinkOptions,
): Promise<ResolveLinkResult> => {
  if (text === '' || !options.chunk.includes(text)) {
    return { ok: false, message: `${text} はこのセッションに出てきたものではないので開きません。` };
  }
  if (kind === 'url') {
    return /^https?:\/\/[^/?#\s]+/i.test(text)
      ? { ok: true, item: { kind: 'url', url: text, at: options.now, tool: 'mention' } }
      : { ok: false, message: `${text} は開けない URL です。` };
  }
  const path = text.startsWith('~/')
    ? join(options.home, text.slice(2))
    : isAbsolute(text)
      ? text
      : options.cwd === null
        ? null
        : resolve(options.cwd, text);
  if (path === null) {
    return { ok: false, message: `${text} がどこにあるか分かりません（セッションの作業場所を読めませんでした）。` };
  }
  if (!(await options.isFile(path))) {
    return { ok: false, message: `${path} は見つかりません。` };
  }
  return { ok: true, item: { kind: 'file', path, edited: false, at: options.now, tool: '端末' } };
};

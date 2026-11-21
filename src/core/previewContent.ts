import { open, realpath, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { imageMimeType, isSensitivePath } from '../shared/previewItems.js';
import type { CommandRunner } from './runCommand.js';

/**
 * プレビューに出すファイルの中身を読む（main プロセスで使う）。
 *
 * 呼び出し側（main）が、そのファイルがセッションに出てきたものかを確かめてから呼ぶ。
 * 大きなファイルは先頭だけ、画像はそのまま、`.env` などは人が「中身を見る」を押すまで伏せる。
 */

export type PreviewContent =
  | { readonly kind: 'image'; readonly dataUrl: string }
  | {
      readonly kind: 'text';
      readonly text: string;
      /** 先頭だけを読んだか */
      readonly truncated: boolean;
      /** 書き換えたファイルなら、最後の commit との差分（git diff）。無ければ null */
      readonly diff: string | null;
    }
  /** `.env` など。人が中身を見ると決めるまで読まない */
  | { readonly kind: 'masked' }
  | { readonly kind: 'unavailable'; readonly message: string };

/** 文字として見せる上限。これを超えたら先頭だけ。 */
export const TEXT_LIMIT_BYTES = 512 * 1024;
/** 画像として見せる上限。 */
export const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

const readHead = async (path: string, bytes: number): Promise<Buffer> => {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/** 書き換えたファイルの差分。git の外・差分なし・読めないときは null。 */
export const readFileDiff = async (path: string, runner: CommandRunner): Promise<string | null> => {
  try {
    const diff = await runner('git', ['-C', dirname(path), 'diff', '--no-color', 'HEAD', '--', basename(path)], {
      timeoutMs: 10_000,
      signal: undefined,
    });
    return diff.trim() === '' ? null : diff;
  } catch {
    return null;
  }
};

export const readPreviewContent = async (
  item: { readonly path: string; readonly edited: boolean },
  options: { readonly reveal: boolean; readonly runner: CommandRunner },
): Promise<PreviewContent> => {
  let size: number;
  try {
    const stats = await stat(item.path);
    if (!stats.isFile()) {
      return { kind: 'unavailable', message: `${item.path} はファイルではありません。` };
    }
    size = stats.size;
  } catch {
    return { kind: 'unavailable', message: `${item.path} は見つかりません（消されたか、移されたようです）。` };
  }

  // 名前だけでなく、リンクの先も見る（`notes.txt` が `~/.ssh/id_rsa` を指していても伏せる）
  const real = await realpath(item.path).catch(() => item.path);
  if ((isSensitivePath(item.path) || isSensitivePath(real)) && !options.reveal) {
    return { kind: 'masked' };
  }

  const mime = imageMimeType(item.path);
  if (mime !== null) {
    if (size > IMAGE_LIMIT_BYTES) {
      return { kind: 'unavailable', message: `画像が大きすぎるので出しません（${Math.round(size / 1024 / 1024)}MB）。` };
    }
    const data = await readHead(item.path, size);
    return { kind: 'image', dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  }

  const head = await readHead(item.path, Math.min(size, TEXT_LIMIT_BYTES));
  if (head.includes(0)) {
    return { kind: 'unavailable', message: 'バイナリのファイルなので出しません。' };
  }
  return {
    kind: 'text',
    text: head.toString('utf8'),
    truncated: size > TEXT_LIMIT_BYTES,
    diff: item.edited ? await readFileDiff(item.path, options.runner) : null,
  };
};

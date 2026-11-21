/**
 * プレビューに出すもの（ファイル・Web サイト）を transcript から拾う。
 *
 * 右のプレビューは「セッションに出てきたもの」だけを開く（それ以外のファイルや URL は開かない）。
 * 拾うのは次の 2 つ:
 * - ツールの呼び出し: Read / Edit / MultiEdit / Write / NotebookEdit の `file_path`（`notebook_path`）と、WebFetch の `url`
 * - 会話（人の依頼と Claude の返事の本文）に出た http(s) の URL
 * - ツールの結果に出た localhost などの URL（開発サーバを起こしたときの出力など）
 *
 * ツールの結果（読んだファイルや取ってきたページの中身）に出た外の URL は拾わない。数が多すぎるうえ、
 * 人が見ていない文書が並べた URL まで候補に混ざるため。開くのは人が押したときだけで、Web 表示は main が隔離する。
 *
 * `node:*` に依存させず、main でも renderer でも使えるようにする。
 */

export type PreviewItem =
  | {
      readonly kind: 'file';
      readonly path: string;
      /** 書き換えたか（Edit / Write）。書き換えたものは差分を見せる */
      readonly edited: boolean;
      /** 最後に出てきた時刻（epoch ms）。分からなければ 0 */
      readonly at: number;
      /** 最後に触ったツール */
      readonly tool: string;
    }
  | {
      readonly kind: 'url';
      readonly url: string;
      readonly at: number;
      /** WebFetch か、会話に出てきただけか */
      readonly tool: 'WebFetch' | 'mention';
    };

/** 項目を指す鍵（同じものを重ねないため・renderer から main へ指すため）。 */
export const previewKey = (item: PreviewItem): string =>
  item.kind === 'file' ? `file:${item.path}` : `url:${item.url}`;

const READ_TOOLS: ReadonlySet<string> = new Set(['Read']);
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** 手元で動いているサイトの URL。ツールの結果からも拾う。 */
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s"'`<>)\]]*)?/g;

/**
 * 会話の本文に出た URL。日本語の文に続けて書かれても切れるよう、ASCII 以外の文字で止める
 * （`https://example.comを開いて` → `https://example.com`）。Markdown のリンク `[名前](URL)` の閉じかっこでも止める。
 */
const ANY_URL = /https?:\/\/[^\s"'`<>()[\]{}\u0080-\uffff]+/g;

/** 末尾についた句読点と、Markdown の強調（`**URL**`）を外す。 */
const trimUrl = (url: string): string => url.replace(/[.,;:!?。、）*_]+$/u, '');

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

interface Block {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly input?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
}

const toEpochMs = (value: unknown): number => {
  if (typeof value !== 'string') {
    return 0;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
};

/** 文字列の本文（text ブロック。`withToolResults` なら tool_result の中身も）を集める。 */
const textsOf = (content: unknown, withToolResults: boolean): string[] => {
  if (typeof content === 'string') {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((block: Block | null) => {
    if (block === null || typeof block !== 'object') {
      return [];
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      return [block.text];
    }
    if (block.type === 'tool_result' && withToolResults) {
      return textsOf(block.content, true);
    }
    return [];
  });
};

/**
 * transcript の断片から、プレビューに出せるものを新しい順に返す（同じものは 1 つにまとめる）。
 */
export const extractPreviewItems = (chunk: string, limit = 50): PreviewItem[] => {
  const items = new Map<string, PreviewItem>();
  const put = (item: PreviewItem): void => {
    const key = previewKey(item);
    const previous = items.get(key);
    // 一度でも書き換えたファイルは、後で読んだだけでも「書き換えた」ままにする
    const merged =
      item.kind === 'file' && previous?.kind === 'file' && previous.edited && !item.edited
        ? { ...item, edited: true }
        : item;
    items.delete(key);
    items.set(key, merged);
  };

  for (const line of chunk.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    let entry: { type?: unknown; isSidechain?: unknown; timestamp?: unknown; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry === null || typeof entry !== 'object' || entry.isSidechain === true) {
      continue;
    }
    const at = toEpochMs(entry.timestamp);
    const content = entry.message?.content;

    if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const block of content as (Block | null)[]) {
        if (block?.type !== 'tool_use' || typeof block.name !== 'string') {
          continue;
        }
        const input = (block.input ?? {}) as { file_path?: unknown; notebook_path?: unknown; url?: unknown };
        const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path;
        if ((READ_TOOLS.has(block.name) || EDIT_TOOLS.has(block.name)) && typeof path === 'string' && path.startsWith('/')) {
          put({ kind: 'file', path, edited: EDIT_TOOLS.has(block.name), at, tool: block.name });
        }
        if (block.name === 'WebFetch' && typeof input.url === 'string' && isHttpUrl(input.url)) {
          put({ kind: 'url', url: input.url, at, tool: 'WebFetch' });
        }
      }
    }

    if (entry.type === 'assistant' || entry.type === 'user') {
      for (const text of textsOf(content, true)) {
        for (const match of text.matchAll(LOCAL_URL)) {
          put({ kind: 'url', url: trimUrl(match[0]), at, tool: 'mention' });
        }
      }
      for (const text of textsOf(content, false)) {
        for (const match of text.matchAll(ANY_URL)) {
          const url = trimUrl(match[0]);
          // `https://` だけのような、ホストの無いものは拾わない
          if (/^https?:\/\/[^/?#]+/i.test(url)) {
            put({ kind: 'url', url, at, tool: 'mention' });
          }
        }
      }
    }
  }

  return [...items.values()].reverse().slice(0, limit);
};

/**
 * 中身を伏せて出すファイルか（`.env` や鍵）。クリックしたときだけ中身を開く。
 */
export const isSensitivePath = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path;
  return (
    /^\.env(\..*)?$/i.test(name) ||
    /\.(pem|key|p12|pfx|keystore)$/i.test(name) ||
    /^id_(rsa|ecdsa|ed25519|dsa)$/i.test(name) ||
    /(credential|secret|token)s?(\.[a-z0-9]+)?$/i.test(name) ||
    name === '.npmrc' ||
    name === '.netrc'
  );
};

/** 画像として見せるファイルか。 */
export const imageMimeType = (path: string): string | null => {
  const ext = path.split('.').at(-1)?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return null;
  }
};

/**
 * transcript（JSONL）を、会話の画面に出す並びに直す。
 *
 * 出すもの:
 * - 人の依頼（user の文字）
 * - 指揮役の返事（assistant の文字）
 * - ツールの呼び出し（名前と 1 行の要約。画面では折りたたむ）
 * - cuse が指揮役を起こしたときの指示（`system`。人の依頼と見分けて小さく出す）
 *
 * 出さないもの: サブエージェントの行、ツールの結果、`isMeta` の行、スラッシュコマンドの出力など、
 * Claude Code が内部で足した行（`<command-name>` などのタグで始まる文字）。
 *
 * renderer からも使うので `node:*` に依存させない。
 */

export type ConversationEntry =
  | { readonly kind: 'user' | 'assistant' | 'system'; readonly id: string; readonly text: string; readonly at: number }
  | {
      readonly kind: 'tool';
      readonly id: string;
      readonly name: string;
      /** 1 行の要約（Bash ならコマンド、Read ならファイル） */
      readonly summary: string;
      readonly at: number;
    };

export interface ParseConversationOptions {
  /** cuse が送った指示（人の依頼ではないので `system` にする） */
  readonly systemPrompts?: readonly string[];
  /** 返す数の上限（新しい方を残す） */
  readonly limit?: number;
}

interface Block {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly name?: unknown;
  readonly input?: unknown;
}

const SUMMARY_LIMIT = 160;

const toEpochMs = (value: unknown): number => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

/** Claude Code が内部で足した文字か（スラッシュコマンドの出力、リマインダなど）。 */
const isInternalText = (text: string): boolean =>
  /^\s*<(command-|local-command-|system-reminder|bash-|user-memory-input|task-notification)/.test(text) ||
  /^\s*Caveat: The messages below were generated/.test(text);

const oneLine = (value: string): string => {
  const line = value.split('\n').find((part) => part.trim() !== '') ?? '';
  return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT)}…` : line;
};

/** ツールの呼び出しを 1 行にする。 */
export const summarizeTool = (_name: string, input: unknown): string => {
  const fields = (input ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value;
      }
    }
    return undefined;
  };
  const chosen =
    pick('command', 'file_path', 'notebook_path', 'url', 'pattern', 'description', 'prompt', 'query') ??
    Object.values(fields).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return chosen === undefined ? '' : oneLine(chosen);
};

const textsOf = (content: unknown): string[] => {
  if (typeof content === 'string') {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((block: Block | null) =>
    block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string'
      ? [block.text]
      : [],
  );
};

export const parseConversation = (chunk: string, options: ParseConversationOptions = {}): ConversationEntry[] => {
  const systemPrompts = new Set((options.systemPrompts ?? []).map((prompt) => prompt.trim()));
  const entries: ConversationEntry[] = [];

  chunk.split('\n').forEach((line, lineIndex) => {
    if (line.trim() === '') {
      return;
    }
    let entry: {
      type?: unknown;
      uuid?: unknown;
      isSidechain?: unknown;
      isMeta?: unknown;
      timestamp?: unknown;
      message?: { content?: unknown };
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      return;
    }
    if (entry === null || typeof entry !== 'object' || entry.isSidechain === true || entry.isMeta === true) {
      return;
    }
    const at = toEpochMs(entry.timestamp);
    const baseId = typeof entry.uuid === 'string' ? entry.uuid : `line-${lineIndex}`;
    const content = entry.message?.content;

    if (entry.type === 'user') {
      textsOf(content).forEach((raw, index) => {
        const text = raw.trim();
        if (text === '' || isInternalText(text)) {
          return;
        }
        entries.push({ kind: systemPrompts.has(text) ? 'system' : 'user', id: `${baseId}:${index}`, text, at });
      });
      return;
    }

    if (entry.type === 'assistant' && Array.isArray(content)) {
      (content as (Block | null)[]).forEach((block, index) => {
        if (block === null || typeof block !== 'object') {
          return;
        }
        const id = `${baseId}:${index}`;
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          entries.push({ kind: 'assistant', id, text: block.text.trim(), at });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          entries.push({ kind: 'tool', id, name: block.name, summary: summarizeTool(block.name, block.input), at });
        }
      });
    }
  });

  const limit = options.limit ?? 300;
  return entries.length > limit ? entries.slice(-limit) : entries;
};

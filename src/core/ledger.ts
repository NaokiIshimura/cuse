import { readFile } from 'node:fs/promises';
import { buildLedgerPath } from './paths.js';

/**
 * 台帳 `~/.cuse/ledger.json` の読み取り。
 *
 * 台帳は cuse が起動した指揮役と配下の記録で、cc-park など他のツールとの唯一の接点になる。
 * 書き込みは第 2 段階（`start` / `spawn`）から始めるため、第 1 段階は「あれば読むだけ」。
 * 形は `schema/ledger.schema.json` で公開している。項目を削る・意味を変えるときは `version` を上げる。
 */

/** 今の台帳の形のバージョン。 */
export const LEDGER_VERSION = 1;

export interface LedgerLeader {
  readonly sessionId: string;
  readonly name: string;
  readonly startedAt: string;
}

export interface LedgerWorker {
  readonly name: string;
  readonly shortId: string | null;
  readonly sessionId: string;
  readonly task: string;
  readonly cwd: string;
  readonly worktree: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly endReason: string | null;
  readonly promptCount: number;
}

export interface Ledger {
  readonly version: number;
  readonly leader: LedgerLeader | null;
  readonly workers: readonly LedgerWorker[];
}

export type ReadLedgerResult =
  /** 台帳がまだ無い（第 1 段階では普通の状態） */
  | { readonly kind: 'missing' }
  | { readonly kind: 'ok'; readonly ledger: Ledger }
  /** 読めたが形が違う。壊れた台帳で配下を取り違えないよう、中身は使わない */
  | { readonly kind: 'invalid'; readonly message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const toLeader = (value: unknown): LedgerLeader | null => {
  if (!isRecord(value) || typeof value['sessionId'] !== 'string') {
    return null;
  }
  return {
    sessionId: value['sessionId'],
    name: typeof value['name'] === 'string' ? value['name'] : '',
    startedAt: typeof value['startedAt'] === 'string' ? value['startedAt'] : '',
  };
};

const toWorker = (value: unknown): LedgerWorker | null => {
  // 名前と sessionId が無い記録は、セッションと突き合わせられないので捨てる
  if (!isRecord(value) || typeof value['name'] !== 'string') {
    return null;
  }
  if (typeof value['sessionId'] !== 'string' || value['sessionId'] === '') {
    return null;
  }
  const promptCount = value['promptCount'];
  return {
    name: value['name'],
    shortId: toStringOrNull(value['shortId']),
    sessionId: value['sessionId'],
    task: typeof value['task'] === 'string' ? value['task'] : '',
    cwd: typeof value['cwd'] === 'string' ? value['cwd'] : '',
    worktree: toStringOrNull(value['worktree']),
    startedAt: typeof value['startedAt'] === 'string' ? value['startedAt'] : '',
    endedAt: toStringOrNull(value['endedAt']),
    endReason: toStringOrNull(value['endReason']),
    promptCount:
      typeof promptCount === 'number' && Number.isInteger(promptCount) && promptCount >= 0
        ? promptCount
        : 0,
  };
};

/**
 * 読み込んだ JSON を台帳として解釈する。
 *
 * 知らない項目は無視する（他のツールが足した項目で壊れないように）。
 * `version` が新しすぎる台帳は意味が変わっているかもしれないので読まない。
 */
export const parseLedger = (value: unknown): ReadLedgerResult => {
  if (!isRecord(value)) {
    return { kind: 'invalid', message: '台帳がオブジェクトではありません。' };
  }
  const version = value['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { kind: 'invalid', message: '台帳に version がありません。' };
  }
  if (version > LEDGER_VERSION) {
    return {
      kind: 'invalid',
      message: `台帳の version ${version} はこの cuse より新しい形です。cuse を更新してください。`,
    };
  }
  const workers = Array.isArray(value['workers']) ? value['workers'] : [];
  return {
    kind: 'ok',
    ledger: {
      version,
      leader: toLeader(value['leader']),
      workers: workers.map(toWorker).filter((worker): worker is LedgerWorker => worker !== null),
    },
  };
};

export interface ReadLedgerOptions {
  readonly home: string;
  /** テストから差し替える */
  readonly read?: (path: string) => Promise<string>;
}

/** 台帳を読む。無い・読めない・壊れているときも例外は投げない。 */
export const readLedger = async (options: ReadLedgerOptions): Promise<ReadLedgerResult> => {
  const read = options.read ?? ((path: string) => readFile(path, 'utf8'));
  let text: string;
  try {
    text = await read(buildLedgerPath(options.home));
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { kind: 'missing' };
    }
    return { kind: 'invalid', message: `台帳を読めませんでした: ${String(error)}` };
  }
  try {
    return parseLedger(JSON.parse(text));
  } catch {
    return { kind: 'invalid', message: '台帳の JSON を解析できませんでした。' };
  }
};

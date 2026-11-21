import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildLedgerPath } from './paths.js';

/**
 * 台帳 `~/.cuse/ledger.json` の読み取り。
 *
 * 台帳は cuse が起動した指揮役と配下の記録で、cc-park など他のツールとの唯一の接点になる。
 * `start` / `spawn` / `prompt` / `kill` が書き、ほかは読むだけ。
 * 形は `schema/ledger.schema.json` で公開している。項目を削る・意味を変えるときは `version` を上げる。
 */

/** 今の台帳の形のバージョン。 */
export const LEDGER_VERSION = 1;

export interface LedgerLeader {
  readonly sessionId: string;
  readonly name: string;
  readonly startedAt: string;
  /** background セッションの短縮 ID。`claude attach` / `stop` に使う */
  readonly shortId: string | null;
  /** 指揮役を起動したディレクトリ */
  readonly cwd: string;
  /** 指揮役の権限モード。配下も同じにそろえる（違うと SendMessage が保留されるため）。既定なら null */
  readonly permissionMode: string | null;
  /**
   * 指揮役のトークンの SHA-256。トークンそのものは指揮役の環境変数にだけ置き、ここには置かない
   * （台帳は配下からも読めるため）。
   */
  readonly tokenHash: string | null;
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
  /** `cuse clean` で片付けた時刻。片付けていなければ null */
  readonly cleanedAt: string | null;
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
    shortId: toStringOrNull(value['shortId']),
    cwd: typeof value['cwd'] === 'string' ? value['cwd'] : '',
    permissionMode: toStringOrNull(value['permissionMode']),
    tokenHash: toStringOrNull(value['tokenHash']),
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
    cleanedAt: toStringOrNull(value['cleanedAt']),
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

/** 台帳がまだ無いときの中身。 */
export const emptyLedger = (): Ledger => ({ version: LEDGER_VERSION, leader: null, workers: [] });

/** 書き込みの実装。テストから差し替える。 */
export interface LedgerFileSystem {
  readonly read: (path: string) => Promise<string>;
  /** 一時ファイルに書いてから名前を変える（途中で落ちても壊れた台帳を残さない） */
  readonly writeAtomic: (path: string, data: string) => Promise<void>;
  /** 書き込みの排他。取れたら解放する関数を返す */
  readonly lock: (path: string) => Promise<() => Promise<void>>;
}

/** ロックを待つ上限。これを超えたら、前の持ち主が落ちて残ったものとみなして奪う。 */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const fsLedgerFileSystem: LedgerFileSystem = {
  read: (path) => readFile(path, 'utf8'),
  writeAtomic: async (path, data) => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  },
  lock: async (path) => {
    const lockPath = `${path}.lock`;
    await mkdir(dirname(path), { recursive: true });
    const startedAt = Date.now();
    for (;;) {
      try {
        const handle = await open(lockPath, 'wx');
        await handle.close();
        return () => rm(lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        const age = await stat(lockPath).then(
          (stats) => Date.now() - stats.mtimeMs,
          () => 0,
        );
        if (age > LOCK_STALE_MS || Date.now() - startedAt > LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
        await sleep(LOCK_RETRY_MS);
      }
    }
  },
};

export interface UpdateLedgerOptions {
  readonly home: string;
  readonly fs?: LedgerFileSystem;
}

/**
 * 台帳を読み、`update` で書き換えて保存する。書き換え後の台帳を返す。
 *
 * 指揮役が `spawn` を続けて呼んでも記録が消えないよう、読みから書きまでをロックで囲む。
 * 壊れた台帳は上書きせずに例外にする（人が直せるよう、元のファイルを残す）。
 */
export const updateLedger = async (
  update: (ledger: Ledger) => Ledger,
  options: UpdateLedgerOptions,
): Promise<Ledger> => {
  const fs = options.fs ?? fsLedgerFileSystem;
  const path = buildLedgerPath(options.home);
  const release = await fs.lock(path);
  try {
    const current = await readLedger({ home: options.home, read: fs.read });
    if (current.kind === 'invalid') {
      throw new Error(`台帳を書き換えられません: ${current.message}（${path}）`);
    }
    const next = update(current.kind === 'ok' ? current.ledger : emptyLedger());
    await fs.writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  } finally {
    await release();
  }
};

/** 名前の重ならない、まだ終わっていない配下。 */
export const activeLedgerWorkers = (ledger: Ledger): LedgerWorker[] =>
  ledger.workers.filter((worker) => worker.endedAt === null);

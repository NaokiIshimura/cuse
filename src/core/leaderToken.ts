import { createHash, randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import type { Ledger } from './ledger.js';

/**
 * 指揮役のトークン。
 *
 * `spawn` / `prompt` / `kill` は指揮役だけが使えるようにする（配下が孫を作ったり、
 * 別の配下を止めたりしないように）。`cuse start` が指揮役を起こすときにだけ
 * トークンを環境変数で渡し、台帳にはそのハッシュだけを残す。
 *
 * 同じユーザーのプロセスなら台帳もトランスクリプトも読めるので、これは悪意への備えではなく
 * 「配下がうっかり指揮役のコマンドを使う」ことへの備え。
 */

/** 指揮役にだけ渡す環境変数。 */
export const LEADER_TOKEN_ENV = 'CUSE_LEADER_TOKEN';

/** background セッションの中で Claude Code が立てる環境変数（`~/.claude/jobs/<短縮 ID>`）。 */
export const JOB_DIR_ENV = 'CLAUDE_JOB_DIR';

export const createLeaderToken = (): string => randomBytes(32).toString('hex');

export const hashLeaderToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export type LeaderCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

const DENIED =
  'このコマンドは指揮役だけが使えます。指揮役は cuse start で起動してください（配下や手で動かすセッションからは使えません）。';

/**
 * 呼び出し元が指揮役かどうかを確かめる。
 *
 * 1. 環境変数のトークンのハッシュが台帳と一致する
 * 2. または、呼び出し元の background セッション（`CLAUDE_JOB_DIR` の末尾）が台帳の指揮役の短縮 ID と一致する
 *
 * 2 は、background セッションを起こす常駐プロセスが `cuse start` の環境変数を引き継がなかった
 * ときの備え（Claude Code の内部の作りに左右されないようにする）。
 */
export const checkLeader = (env: NodeJS.ProcessEnv, ledger: Ledger | null): LeaderCheck => {
  const leader = ledger?.leader;
  if (leader === null || leader === undefined) {
    return { ok: false, message: `指揮役がいません。${DENIED}` };
  }
  const token = env[LEADER_TOKEN_ENV];
  if (
    token !== undefined &&
    token !== '' &&
    leader.tokenHash !== null &&
    hashLeaderToken(token) === leader.tokenHash
  ) {
    return { ok: true };
  }
  const jobDir = env[JOB_DIR_ENV];
  if (
    jobDir !== undefined &&
    jobDir !== '' &&
    leader.shortId !== null &&
    basename(jobDir) === leader.shortId
  ) {
    return { ok: true };
  }
  return { ok: false, message: DENIED };
};

/** 配下へ渡す環境。指揮役のトークンを外す（配下が指揮役のコマンドを使えないように）。 */
export const withoutLeaderToken = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const next = { ...env };
  delete next[LEADER_TOKEN_ENV];
  return next;
};

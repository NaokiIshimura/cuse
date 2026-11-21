import type { CommandRunner } from './runCommand.js';

/**
 * 配下が作業したディレクトリ（worktree）の git の様子。`cuse review` と `cuse clean` が使う。
 *
 * `clean` はこれを見て「消してよいか」を決めるので、分からないことは「消してはいけない」側に倒す
 * （安全の約束 4: 未 commit / 未 push の worktree を残す）。
 */
export interface GitStatus {
  readonly dir: string;
  /** git リポジトリの中か */
  readonly repository: boolean;
  readonly branch: string | null;
  /** 追跡しているリモートのブランチ（`origin/cuse/tests` など）。push していなければ null */
  readonly upstream: string | null;
  /** commit していない変更（`git status --porcelain` の行） */
  readonly uncommitted: readonly string[];
  /**
   * `git status` を読めたか。読めなければ uncommitted が空でも「変更が無い」とは言えない
   * （片付けると変更を失うおそれがあるので、clean は残す）。
   */
  readonly statusRead: boolean;
  /** push していない commit の数。数えられなければ null（＝分からない） */
  readonly unpushed: number | null;
  /** 取り込み先との差分（`git diff --stat <base>...HEAD` の最後の行）。比べられなければ null */
  readonly diffStat: string | null;
  /** 比べた相手（upstream か origin/HEAD） */
  readonly base: string | null;
}

export interface GitStatusOptions {
  readonly runner: CommandRunner;
}

export const readGitStatus = async (dir: string, options: GitStatusOptions): Promise<GitStatus> => {
  const git = async (args: readonly string[]): Promise<string | null> => {
    try {
      return (await options.runner('git', ['-C', dir, ...args], { timeoutMs: 10_000, signal: undefined })).trimEnd();
    } catch {
      return null;
    }
  };

  const inside = await git(['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return {
      dir,
      repository: false,
      branch: null,
      upstream: null,
      uncommitted: [],
      statusRead: false,
      unpushed: null,
      diffStat: null,
      base: null,
    };
  }

  const [branch, status, upstream, originHead] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['status', '--porcelain']),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    git(['rev-parse', '--verify', '--quiet', 'origin/HEAD']),
  ]);

  // push 済みのブランチなら upstream と比べる。まだ push していなければ、取り込み先（origin/HEAD）と比べ、
  // そこに無い commit をすべて「push していない」と数える
  const base = upstream !== null && upstream !== '' ? upstream : originHead !== null ? 'origin/HEAD' : null;
  const [count, stat] =
    base === null
      ? [null, null]
      : await Promise.all([git(['rev-list', '--count', `${base}..HEAD`]), git(['diff', '--stat', `${base}...HEAD`])]);
  const unpushed = count === null ? null : Number.parseInt(count, 10);

  return {
    dir,
    repository: true,
    branch: branch === '' ? null : branch,
    upstream: upstream === '' ? null : upstream,
    uncommitted: (status ?? '').split('\n').filter((line) => line.trim() !== ''),
    statusRead: status !== null,
    unpushed: unpushed === null || Number.isNaN(unpushed) ? null : unpushed,
    diffStat: stat === null || stat === '' ? null : (stat.split('\n').at(-1)?.trim() ?? null),
    base,
  };
};

/**
 * 片付けても作業を失わないか。
 *
 * commit していない変更が無く、push していない commit が無いと**分かっている**ときだけ true。
 * git リポジトリでない場所は worktree が作られないので、片付けても失うものは無い（セッションの一覧から外すだけ）。
 */
export const isSafeToClean = (status: GitStatus): boolean =>
  !status.repository || (status.statusRead && status.uncommitted.length === 0 && status.unpushed === 0);

/** 残す理由（人と指揮役に伝える）。片付けてよければ null。 */
export const keepReason = (status: GitStatus): string | null => {
  if (isSafeToClean(status)) {
    return null;
  }
  const reasons: string[] = [];
  if (!status.statusRead) {
    reasons.push('commit していない変更があるか確かめられない（git status に失敗した）');
  }
  if (status.uncommitted.length > 0) {
    reasons.push(`commit していない変更が ${status.uncommitted.length} 件`);
  }
  if (status.unpushed === null) {
    reasons.push('push したか確かめられない（リモートが無い）');
  } else if (status.unpushed > 0) {
    reasons.push(`push していない commit が ${status.unpushed} 件`);
  }
  return reasons.join('、');
};

export interface PullRequestInfo {
  readonly number: number;
  readonly url: string;
  readonly state: string;
}

/**
 * そのブランチの PR を `gh pr view` で調べる。gh が無い・PR が無いときは null（無くても review は続ける）。
 */
export const readPullRequest = async (
  dir: string,
  options: GitStatusOptions,
): Promise<PullRequestInfo | null> => {
  try {
    const stdout = await options.runner('gh', ['pr', 'view', '--json', 'number,url,state'], {
      timeoutMs: 15_000,
      signal: undefined,
      cwd: dir,
    });
    const parsed = JSON.parse(stdout) as { number?: unknown; url?: unknown; state?: unknown };
    return typeof parsed.number === 'number' && typeof parsed.url === 'string'
      ? { number: parsed.number, url: parsed.url, state: typeof parsed.state === 'string' ? parsed.state : '' }
      : null;
  } catch {
    return null;
  }
};

import { isAbsolute, resolve } from 'node:path';
import {
  LEADER_DISALLOWED_TOOLS,
  LEADER_NAME,
  MIN_LEADER_CLAUDE_VERSION,
} from '../config/defaults.js';
import {
  findByShortId,
  isAlive,
  isAllowedPermissionMode,
  launchBackground,
  stopSession,
  ALLOWED_PERMISSION_MODES,
  type BackgroundLaunch,
} from '../core/claudeBg.js';
import type { LedgerLeader } from '../core/ledger.js';
import { createLeaderToken, hashLeaderToken, LEADER_TOKEN_ENV } from '../core/leaderToken.js';
import type { Agent } from '../types/agent.js';
import { listAgents, loadLedger, saveLedger, type OpsDeps } from './deps.js';
import { describeInstallSkill, installSkill, SKILL_SOURCE, type InstallSkillResult } from './installSkill.js';
import { failure, success, withWarnings, type CommandError, type Outcome } from './outcome.js';

/**
 * `cuse start [--cwd] [--new] [--permission-mode]`。
 *
 * 指揮役 `cuse-leader` を起動する。指揮役はマシンに 1 人だけ。
 *
 * - 台帳の指揮役が動いていれば、新しく起こさない（ウィンドウを開くだけ）
 * - 止まっていれば `claude --resume` で同じ会話を再開する
 * - `--new` のときだけ作り直す（前の指揮役は止める。配下は台帳に残り、新しい指揮役が引き継ぐ）
 *
 * 指揮役は Edit / Write / NotebookEdit を外し、心得を追加のシステムプロンプトで渡して起動する。
 * トークンは指揮役の環境変数（`--settings` の env と、起動するプロセスの環境の両方）にだけ渡す。
 */

export const LEADER_PROMPT_FILE = 'prompts/leader.md';

/** 新しく起こすときの最初の指示。人の依頼はウィンドウの中央で受ける。 */
export const INITIAL_LEADER_PROMPT =
  'cuse の指揮役として起動しました。cuse status で状況を確かめてから、人の依頼を待ってください。';

/** 再開するときの指示。 */
export const RESUME_LEADER_PROMPT =
  'cuse start で指揮役を再開しました。cuse status で配下の状況を確かめてから、人の依頼を待ってください。';

export interface StartInput {
  readonly cwd?: string | undefined;
  readonly new?: boolean;
  readonly permissionMode?: string | undefined;
}

export type StartAction = 'opened' | 'started' | 'resumed' | 'recreated';

export interface StartResult {
  readonly action: StartAction;
  readonly leader: {
    readonly name: string;
    readonly shortId: string | null;
    readonly sessionId: string;
    readonly cwd: string;
    readonly permissionMode: string | null;
  };
  readonly skill: InstallSkillResult;
}

const ACTION_TEXT: Readonly<Record<StartAction, string>> = {
  opened: '指揮役はもう動いています。ウィンドウを開きます。',
  started: '指揮役を起動しました。',
  resumed: '止まっていた指揮役を再開しました（同じ会話の続き）。',
  recreated: '指揮役を作り直しました（前の指揮役は止めました。配下は引き継ぎます）。',
};

/**
 * 指揮役を起こせなかった理由を、人が次に何をすればよいか分かる形にする。
 *
 * Claude Code は、信頼していないフォルダでは background セッションを起こさない。
 * ホームフォルダは特に「1 度に 1 セッションだけ」信頼されるので、指揮役の置き場所には使えない。
 */
export const launchFailure = (message: string, cwd: string, home: string): CommandError => {
  if (/not trusted/i.test(message)) {
    const where =
      cwd === home
        ? 'ホームフォルダでは指揮役を起こせません（Claude Code がホームフォルダを信頼するのは 1 度に 1 セッションだけのため）。作業するリポジトリなど、別のフォルダを選んでください。'
        : `フォルダ ${cwd} を Claude Code がまだ信頼していません。端末でそのフォルダに移って claude を一度起動し、信頼してから、もう一度試してください。`;
    return { kind: 'untrusted', message: `${where}（Claude Code: ${message}）` };
  }
  return { kind: 'launch', message: `指揮役を起こせませんでした: ${message}` };
};

const findLeaderAgent = (agents: readonly Agent[], leader: LedgerLeader): Agent | undefined =>
  agents.find(
    (agent) =>
      agent.sessionId === leader.sessionId || (leader.shortId !== null && agent.id === leader.shortId),
  );

export const runStart = async (input: StartInput, deps: OpsDeps): Promise<Outcome<StartResult>> => {
  if (input.permissionMode !== undefined && !isAllowedPermissionMode(input.permissionMode)) {
    return failure({
      kind: 'usage',
      message: `--permission-mode には ${ALLOWED_PERMISSION_MODES.join(' / ')} のどれかを指定してください（権限確認を飛ばすモードは使えません）。`,
    });
  }

  const version = await deps.checkVersion(MIN_LEADER_CLAUDE_VERSION);
  if (!version.ok) {
    return failure({
      kind: version.kind === 'not-found' ? 'not-found' : 'version',
      message:
        version.kind === 'too-old'
          ? `指揮役は SendMessage（cross-session messaging）で配下に指示するため、Claude Code v${MIN_LEADER_CLAUDE_VERSION} 以降が要ります（いまは v${version.version ?? '?'}）。claude update で更新してください。`
          : version.message,
    });
  }

  const warnings: string[] = [];
  const skill = await installSkill(await deps.readBundled(SKILL_SOURCE), {
    home: deps.home,
    force: false,
    fs: deps.skillFs,
  });
  if (skill.status === 'differs') {
    warnings.push(describeInstallSkill(skill));
  }

  const loaded = await loadLedger(deps);
  if (!loaded.ok) {
    return withWarnings(loaded.outcome, warnings);
  }
  const listed = await listAgents(deps);
  if (!listed.ok) {
    return withWarnings(listed.outcome, warnings);
  }

  const current = loaded.ledger?.leader ?? null;
  const currentAgent = current === null ? undefined : findLeaderAgent(listed.agents, current);

  if (current !== null && input.new !== true && currentAgent !== undefined && isAlive(currentAgent)) {
    return success(
      {
        action: 'opened',
        leader: {
          name: current.name,
          shortId: current.shortId,
          sessionId: current.sessionId,
          cwd: current.cwd,
          permissionMode: current.permissionMode,
        },
        skill,
      },
      ACTION_TEXT.opened,
      warnings,
    );
  }

  if (current !== null && input.new === true && currentAgent !== undefined && isAlive(currentAgent)) {
    const shortId = currentAgent.id ?? current.shortId;
    const stopped = shortId === null ? { ok: false as const, message: '短縮 ID が分かりません' } : await stopSession(shortId, { runner: deps.runner });
    if (!stopped.ok) {
      warnings.push(`前の指揮役 ${current.name} を止められませんでした: ${stopped.message}。指揮役が 2 人にならないよう、claude stop で止めてください。`);
    }
  }

  const resuming = current !== null && input.new !== true;
  const cwd = resuming
    ? current.cwd === '' ? deps.cwd : current.cwd
    : input.cwd === undefined
      ? deps.cwd
      : isAbsolute(input.cwd)
        ? input.cwd
        : resolve(deps.cwd, input.cwd);
  const permissionMode = input.permissionMode ?? (resuming ? current.permissionMode : null);

  // 起動・再開のたびにトークンを作り直す（古いトークンを持つプロセスを指揮役とみなさない）
  const token = createLeaderToken();
  const leaderPrompt = await deps.readBundled(LEADER_PROMPT_FILE);
  const launch: BackgroundLaunch = {
    ...(resuming ? { resume: current.sessionId, prompt: RESUME_LEADER_PROMPT } : { name: LEADER_NAME, prompt: INITIAL_LEADER_PROMPT }),
    permissionMode,
    disallowedTools: LEADER_DISALLOWED_TOOLS,
    appendSystemPrompt: leaderPrompt,
    settings: { env: { [LEADER_TOKEN_ENV]: token } },
  };
  const launched = await launchBackground(launch, {
    runner: deps.runner,
    cwd,
    env: { ...deps.env, [LEADER_TOKEN_ENV]: token },
  });
  if (!launched.ok) {
    return failure(launchFailure(launched.message, cwd, deps.home), warnings);
  }
  const found = await findByShortId(
    async () => {
      const result = await listAgents(deps);
      return result.ok ? result.agents : null;
    },
    launched.shortId,
    { sleep: deps.sleep },
  );
  if (found === null) {
    return failure(
      {
        kind: 'launch',
        message: `指揮役（${launched.shortId}）は起動しましたが、一覧に現れないため台帳に記録できませんでした。cuse agents --all で確かめてください。`,
      },
      warnings,
    );
  }

  const leader: LedgerLeader = {
    sessionId: found.sessionId,
    name: found.name,
    startedAt: resuming ? current.startedAt : new Date(deps.now()).toISOString(),
    shortId: launched.shortId,
    cwd,
    permissionMode,
    tokenHash: hashLeaderToken(token),
  };
  const saved = await saveLedger(deps, (ledger) => ({ ...ledger, leader }));
  if (!saved.ok) {
    return withWarnings(saved.outcome, warnings);
  }
  if (found.name !== LEADER_NAME && !resuming) {
    warnings.push(`同じ名前のセッションがあったため、指揮役の名前は ${found.name} になりました。`);
  }

  const action: StartAction = resuming ? 'resumed' : current === null ? 'started' : 'recreated';
  const skillText = skill.status === 'installed' ? `\n${describeInstallSkill(skill)}` : '';
  return success(
    {
      action,
      leader: {
        name: leader.name,
        shortId: leader.shortId,
        sessionId: leader.sessionId,
        cwd,
        permissionMode,
      },
      skill,
    },
    `${ACTION_TEXT[action]}\n名前: ${leader.name}（${leader.shortId}）  作業ディレクトリ: ${cwd}${skillText}`,
    warnings,
  );
};

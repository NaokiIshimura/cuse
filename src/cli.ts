#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import meow from 'meow';
import { DEFAULT_OUTPUT_LINES, DEFAULT_WAIT_TIMEOUT_SEC, MAX_WORKERS } from './config/defaults.js';
import { buildGuiEnv, ELECTRON_MISSING_MESSAGE, resolveElectronPath } from './gui/launch.js';
import { defaultDeps, runCli } from './runCli.js';

const cli = meow(
  `
  使い方
    $ cuse <コマンド> [options]

  人が使うコマンド
    start                   指揮役 cuse-leader を起動し、ウィンドウを開く（指揮役はマシンに 1 人）
    app                     ウィンドウを開く
    install-skill           cuse スキルを ~/.claude/skills/cuse/ に置く

  見るコマンド
    status                  配下の数、状態ごとの件数、人の対応が要るもの
    agents                  配下の状態・待っているもの・最後の指示・コンテキスト使用率
    output <名前>           最後の報告と claude logs の末尾
    wait <名前…>            誰かが手を止めるまで待ち、誰が何のために止まったかを返す

  指揮役だけが使うコマンド
    spawn "<タスク>" <名前> 配下を起動して台帳に記録する（同時に ${MAX_WORKERS} つまで）
    prompt <名前> "<指示>"  止まった配下に続きを頼む（動いていれば SendMessage で送るよう返す）
    kill <名前>             配下を止め、理由を台帳に残す（--reason 必須）

  オプション
    --json                  結果を JSON で出す。失敗は {"error":{"kind","message"}} と終了コード 1
    --all                   台帳の配下だけでなく、マシン上の全セッションを対象にする（status / agents）
    --lines <N>             output で出す claude logs の行数（既定: ${DEFAULT_OUTPUT_LINES}）
    --cwd <dir>             start / spawn の作業ディレクトリ（既定: いまのディレクトリ）
    --agent <name>          spawn で使うサブエージェントの定義
    --model <model>         spawn で使うモデル
    --until <条件>          wait の条件: attention（既定。誰か 1 人）/ idle（全員）/ done（全員が完了）
    --timeout <秒>          wait の時間切れ（既定: ${DEFAULT_WAIT_TIMEOUT_SEC}）
    --reason <理由>         kill の理由（台帳に残る）
    --new                   start で指揮役を作り直す（前の指揮役は止める）
    --permission-mode <m>   start で指揮役の権限モード（default / acceptEdits / plan / auto）。配下も同じになる
    --no-app                start でウィンドウを開かない
    --force                 install-skill で、違う内容のスキルを置き換える
    --debug                 受け取った claude agents --json の出力を ~/.cuse/debug/ に記録する

  例
    $ cuse start
    $ cuse spawn "通知設定のテストを追加して" tests
    $ cuse wait tests readme --until attention
    $ cuse output tests
    $ cuse kill tests --reason "方針が変わったため"
`,
  {
    importMeta: import.meta,
    flags: {
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      lines: { type: 'number' },
      debug: { type: 'boolean', default: false },
      cwd: { type: 'string' },
      agent: { type: 'string' },
      model: { type: 'string' },
      until: { type: 'string' },
      timeout: { type: 'number' },
      reason: { type: 'string' },
      new: { type: 'boolean', default: false },
      permissionMode: { type: 'string' },
      app: { type: 'boolean', default: true },
      force: { type: 'boolean', default: false },
    },
  },
);

const [command, ...args] = cli.input;

/**
 * ウィンドウを開く。
 *
 * `cuse app` は閉じるまで待つ。`cuse start` は開いたら戻る（端末を返す）。
 * ウィンドウは 1 つだけで、2 つ目を開こうとすると前のウィンドウが前に出る（main.ts）。
 */
const openApp = async (detached: boolean): Promise<void> => {
  const electronPath = await resolveElectronPath(() => import('electron'));
  if (electronPath === null) {
    console.error(ELECTRON_MISSING_MESSAGE);
    process.exitCode = 1;
    return;
  }
  const mainPath = fileURLToPath(new URL('./gui/main.js', import.meta.url));
  if (detached) {
    const child = spawn(electronPath, [mainPath], {
      stdio: 'ignore',
      detached: true,
      env: buildGuiEnv(process.env),
    });
    child.unref();
    return;
  }
  const child = spawn(electronPath, [mainPath], { stdio: 'inherit', env: buildGuiEnv(process.env) });
  // 子プロセスの終了コードをそのまま引き継ぎ、プロセスを残さない
  child.on('exit', (code, signal) => {
    process.exit(signal === null ? (code ?? 0) : 1);
  });
};

if (command === 'app') {
  await openApp(false);
} else {
  const result = await runCli(
    command,
    args,
    {
      all: cli.flags.all,
      json: cli.flags.json,
      lines: cli.flags.lines,
      debug: cli.flags.debug,
      cwd: cli.flags.cwd,
      agent: cli.flags.agent,
      model: cli.flags.model,
      until: cli.flags.until,
      timeout: cli.flags.timeout,
      reason: cli.flags.reason,
      new: cli.flags.new,
      permissionMode: cli.flags.permissionMode,
      force: cli.flags.force,
    },
    defaultDeps(),
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
  if (result.openApp === true && cli.flags.app) {
    await openApp(true);
  }
}

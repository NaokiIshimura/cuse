#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import meow from 'meow';
import { DEFAULT_OUTPUT_LINES } from './config/defaults.js';
import { buildGuiEnv, ELECTRON_MISSING_MESSAGE, resolveElectronPath } from './gui/launch.js';
import { defaultDeps, runCli } from './runCli.js';

const cli = meow(
  `
  使い方
    $ cuse <コマンド> [options]

  コマンド（第 1 段階: 読み取りだけ）
    status                  配下の数、状態ごとの件数、人の対応が要るもの
    agents                  配下の状態・待っているもの・最後の指示・コンテキスト使用率
    output <名前>           最後の報告と claude logs の末尾
    app                     cuse のウィンドウを開く（読み取り専用）

  オプション
    --all                   台帳の配下だけでなく、マシン上の全セッションを対象にする（status / agents）
    --json                  結果を JSON で出す。失敗は {"error":{"kind","message"}} と終了コード 1
    --lines <N>             output で出す claude logs の行数（既定: ${DEFAULT_OUTPUT_LINES}）
    --debug                 受け取った claude agents --json の出力と、解釈できない値を
                            ~/.cuse/debug/ に記録する

  例
    $ cuse agents --all
    $ cuse status --json
    $ cuse output tests --lines 50
    $ cuse app
`,
  {
    importMeta: import.meta,
    flags: {
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      lines: { type: 'number' },
      debug: { type: 'boolean', default: false },
    },
  },
);

const [command, ...args] = cli.input;

if (command === 'app') {
  const electronPath = await resolveElectronPath(() => import('electron'));
  if (electronPath === null) {
    console.error(ELECTRON_MISSING_MESSAGE);
    process.exit(1);
  }
  const mainPath = fileURLToPath(new URL('./gui/main.js', import.meta.url));
  const child = spawn(electronPath, [mainPath], { stdio: 'inherit', env: buildGuiEnv(process.env) });
  // 子プロセスの終了コードをそのまま引き継ぎ、プロセスを残さない
  child.on('exit', (code, signal) => {
    process.exit(signal === null ? (code ?? 0) : 1);
  });
} else {
  const result = await runCli(
    command,
    args,
    {
      all: cli.flags.all,
      json: cli.flags.json,
      lines: cli.flags.lines,
      debug: cli.flags.debug,
    },
    defaultDeps(),
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

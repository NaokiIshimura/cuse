# CLAUDE.md

Claude Code がこのリポジトリで作業するときの指針。

## このツールについて

cuse は、1 つの Claude Code セッション（指揮役）が、同じマシンのほかの Claude Code セッション（配下）を
起動・監視・指示・回収・停止できるようにするデスクトップアプリ（Electron）。配るのは `cuse.app` だけで、CLI は配らない。
指揮役が Bash から使う `cuse` コマンドは、アプリが開くたびに `~/.cuse/bin/cuse` に置く（`src/gui/cuseShim.ts`）。
中身はアプリの中の `dist/cli.js` を、アプリ自身の Electron を `ELECTRON_RUN_AS_NODE=1` で動かして実行するだけ。
そのため `.app` は asar にしない（`--no-asar`）。CLI が読む `node_modules/meow` と、端末の `node_modules/node-pty` を `.app` に入れる。
何をどう作るかは `docs/HANDOFF.md`、設計の理由は `docs/cuse 企画書（単体ツール版）.md` にある。

いまは **第 2 段階（v0.2.0、指揮）**。`start` / `spawn` / `prompt` / `wait` / `kill`、台帳の書き込み、指揮役のトークン、
cuse スキルと心得、ウィンドウ中央の埋め込み端末まで。第 3 段階（`review` / `clean`、プレビュー、OS 通知）は、
Naoki が第 2 段階を確かめてから始める。

## 作業ルール

- 変更後は**テスト・型チェック・ビルドの 3 つ**を通す。CI（`.github/workflows/ci.yml`）も同じ 3 つを回す。
- テストは対象を指定して実行する（`npx vitest run <ファイル>`）。
- PR を出すときは `package.json` と `package-lock.json` の `version` を上げる（`npm version <patch|minor> --no-git-tag-version`）。
  同じブランチで既に上げてあれば重ねて上げない（`main` の `version` と比べて判断する）。
- main へは直接 push せず、ブランチを切って PR にする。マージは Naoki が行う。
- コード中のコメントと README は日本語。「なぜそうしたか」を書く。
- テストや CI で本物の `claude` を呼ばない。実機での確認手順は PR に書いて Naoki に頼む。

## コマンド

```bash
npm run build       # CLI・main・preload・renderer をまとめてビルド
npm run typecheck   # 本体・テスト・GUI renderer の 3 構成すべて型チェック
npm test            # 全テスト
npx vitest run <ファイルパス>   # テストは対象を指定して実行する
npm run gui:dev     # ビルドしてウィンドウを起動（cuse app と同じ）
npm run gui:package # .app にパッケージ化（macOS。ad-hoc 署名まで行う）
```

## リリース

`main` へマージすると `.github/workflows/release.yml` が arm64 / x64 の `.app` をビルドし、`package.json` の `version` に対応するタグ（`v<version>`）が未公開なら Releases へ公開する。
既に公開済みならリリースは作らず、実行ログの artifact にだけ残す。
**配布したいときは `package.json` の `version` を上げてからマージする。**
README のインストール手順は `releases/latest/download/` のバージョンを含まない名前を指すので、`version` を上げても書き換えなくてよい。

## 安全の約束（どの段階でも崩さない）

1. 配下の権限プロンプトを承認するコマンドやボタンを作らない。承認待ちは「人に回すもの」として返す。
2. `spawn` に `--dangerously-skip-permissions` を渡さない。
3. `kill` / `clean` が触れられるのは台帳に載った配下だけ。どれが配下かは台帳の sessionId だけで決める（名前で推測しない）。
4. `clean` は未 commit / 未 push の worktree を残す。`kill` は止めるだけで消さない。
5. 同時に動かす配下の数と、配下 1 つあたりの `prompt` 回数に上限を設ける。
6. main / master へのマージや push はしない。

## 構成

| ディレクトリ | 役割 |
| --- | --- |
| `src/types/` | `claude agents --json` の生データと正規化した型（cc-park から写した） |
| `src/shared/` | UI 非依存の判断（AA 定義・並べ替え・役割分け・名前の解決・健全性）。renderer からも使うので `node:*` に依存させない |
| `src/core/` | 外部コマンド実行・ファイル読み取りなど副作用。`runCommand` で差し替えられる |
| `src/commands/` | 各コマンドの本体。操作系（`run*`）は外への口を `OpsDeps` で受け取り、`Outcome` を返す |
| `src/runCli.ts` | CLI の本体。外部への読み取りを `deps` で受け取り、テストで偽物を渡せる |
| `src/cli.ts` | 引数の解釈とプロセスの出入りだけ |
| `src/gui/` | Electron の main / preload / renderer |
| `src/config/defaults.ts` | 未決事項の仮の値（上限など）。決まっていない値はここに集める |
| `schema/` | 台帳 `~/.cuse/ledger.json` の JSON Schema（他のツール向けに公開） |
| `prompts/` | 指揮役・配下の心得（`--append-system-prompt` で渡す）。npm パッケージに同梱する |
| `skill/cuse/SKILL.md` | cuse スキル（指揮役向けのコマンドの使い方）。指揮役を起こすたびに `~/.claude/skills/cuse/` に置く。`cuse-managed` の印がある（または前の版の cuse の説明文で始まる）ものは cuse のものとして最新に書き直し、人が書いたものは上書きしない。印は消さないこと |
| `test/fixtures/` | `claude agents --json` と transcript の見本 |
| `test/support/fakeClaude.ts` | 本物の `claude` の代わりに使う偽物（`--bg` / `--resume` / `stop` / `agents` / `git rev-parse` に答え、呼ばれ方を記録する） |

### cc-park から写したコード

`src/types/agent.ts`、`src/core/` と `src/shared/` の多く、`src/hooks/`、renderer の `Character` / `StatusBadge` / `colors.ts` は
cc-park v0.25.0 から写した。ファイルの先頭に「写し元: cc-park `<パス>` @ `<コミット>`」がある。
写したファイルを直すときは、先頭の行を残したまま直し、cc-park 側にも要る修正かを PR に書く。

`claude agents --json` の出力仕様は非公開で変わりうる。実際に見た出力は匿名化して
`test/fixtures/agents/` に置き、`src/core/fixtures.test.ts` で正規化できることを固定している。
出力の形が変わったら、まずサンプルを足してテストを落とし、それから `src/core/normalizeAgent.ts` を直す。

### `claude` を起動・停止するコード

`claude --bg` / `--resume` / `stop` の引数は `src/core/claudeBg.ts` だけで組み立て、`claudeBg.test.ts` で固定している。
権限を広げる引数（`--dangerously-skip-permissions`、`bypassPermissions` など）はここで組み立てない。
指揮役のトークンは `withoutLeaderToken` で外してから配下を起動する。新しい起動経路を足すときも必ず通す。

操作系のテストは `test/support/fakeClaude.ts` の偽物で書き、呼ばれた引数・環境変数・作業ディレクトリを確かめる。

### `--json` の出力

指揮役が読むので形を安定させる。項目の削除・意味の変更は minor を上げて README に書く。
値が無いときは項目を省かず `null` を入れる。失敗は終了コード 1 と `{"error":{"kind","message"}}`。

### GUI

renderer は Node API を使えない（contextIsolation 有効、nodeIntegration 無効、sandbox 有効）。
`node:*` に依存する処理は main プロセスへ IPC で委譲する（`tsconfig.gui.json` が型検査で混入を検出する）。
IPC の口は `src/gui/ipc.ts` にまとめる。承認の口は作らない。

ウィンドウを開くと main が `runStart`（`cuse start` と同じ処理）で指揮役をそろえる（`src/gui/leaderStartup.ts`）。
重ねて走らせないようにしてあり、指揮役がマシンに 1 人という約束はそのまま守られる。`.app` にも `prompts/` と `skill/` を入れる。
新しく起こす置き場所が決まらないとき（Finder から開いた・ホームフォルダ）は、指揮役の居場所 `~/.cuse/leader` で起こす
（`runStart` の `newLeaderCwd`）。Claude Code はホームフォルダや信頼していないフォルダでは `claude --bg` を断るので、
初回はそのフォルダで引数なしの `claude` を埋め込み端末で動かし、Claude Code 自身の信頼の確認に人が答える。
cuse が Claude Code の設定（`~/.claude.json`）に信頼を書き込むことはしない（非公開の形式で、壊すおそれがあるため）。
指揮役の居場所はリポジトリではないので、`spawn` は `~/.cuse` の中では配下を起こさない。

`claude` の失敗の理由は標準エラーから取る（`toCommandError`）。execFile の `Command failed: <コマンド全体>` には
指揮役のトークンや心得の全文が入るので、画面やログにそのまま出さない。

埋め込み端末（node-pty）で動かすのは `claude attach <短縮 ID>` だけ。相手は main が台帳と一覧から決め（`src/gui/attachTarget.ts`）、
renderer から来た値でコマンドを組み立てない。タブやウィンドウを閉じても attach を切るだけで、セッションは止めない。
node-pty はネイティブモジュール。`.app` には macOS 用の prebuild だけを入れる（`gui:package`。asar にはしない）。
npm で入れた node-pty は `prebuilds/darwin-*/spawn-helper` の実行権限が落ちていることがあり（既知の不具合）、
そのままだと端末が起きずに真っ暗になる。`gui:package` で `chmod +x` してから組み、main も端末を起こす前に
`ensureSpawnHelperExecutable`（`src/core/ptyHelper.ts`）で確かめる。端末を起こせなかった理由は必ず画面に出す。

### キャラクター（AA）

AA の定義は `src/shared/characters.ts` の 1 箇所だけ（cc-park と同じ）。
制約（3 行 x 9 桁、使える文字など）は `src/shared/characters.test.ts` で固定してある。
AA を変えてテストが落ちたら、テストではなく AA の方を直す。cc-park と見た目をそろえるため、AA は cc-park 側で変える。

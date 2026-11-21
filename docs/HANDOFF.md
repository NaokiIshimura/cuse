# cuse 開発引継書（Claude Code 向け）

Nov 21, 2026 · @Naoki Ishimura

## この引継書の使い方

新しいリポジトリ `NaokiIshimura/cuse` で cuse の開発を始める Claude Code への引継ぎです。最初にやることは「第 1 段階（v0.1.0、読み取り専用）を作って PR を出す」です。

- この文書を Markdown で書き出し、リポジトリの `docs/HANDOFF.md` に置く。Claude Code には「`docs/HANDOFF.md` を読んで、最初のタスクを進めて」と頼む。
- 設計の理由や比較は企画書（末尾の参考資料）にある。この引継書は「何をどう作るか」だけを書く。
- ここに書いていないことで迷ったら、第 1 段階の範囲であれば企画書に合う方を選んで進め、PR の説明に書く。第 2 段階以降の機能（起動・停止など）には手を付けない。

## 作るもの

cuse は、1 つの Claude Code セッション（指揮役）が、同じマシンのほかの Claude Code セッション（配下）を起動・監視・指示・回収・停止できるようにする CLI です。tribe CLI の muse を参考にしています。

- **指揮役はマシンに 1 人**。作業はしない。計画・分担・確認・報告だけ。
- **作業はすべて配下**。配下は `claude --bg --name` で起動する background セッションで、それぞれ別の worktree で編集する。
- **人は指揮役とだけ話す**。人に回るのは権限の承認と方針の判断だけ。
- **画面は GUI（デスクトップアプリ）だけ**。左に配下の一覧（Clawd の AA 付き）、中央に指揮役の会話（埋め込み端末）、右にプレビュー。端末の TUI と Web UI は作らない。
- **cc-park とは別リポジトリ**。cc-park の状態読み取りコードを写して使い、台帳ファイル `~/.cuse/ledger.json` だけでつながる。cuse は cc-park に依存しない。

## 決まっていること

次の約束はどの段階でも崩さないでください。迷ったら、こちらを優先します。

**安全の約束**

1. 配下の権限プロンプトを承認するコマンドやボタンを作らない。承認待ちは「人に回すもの」として返し、人が `claude attach` か agent view で承認する。
2. `spawn` に `--dangerously-skip-permissions` を渡さない。配下の権限モードは指揮役と同じか弱いものだけ。
3. `kill` / `clean` が触れられるのは台帳に載った配下だけ。人が手で動かしているセッションは観察のみ。
4. `clean` は未 commit / 未 push の worktree を残す。`kill` は止めるだけで消さない。
5. 同時に動かす配下の数と、配下 1 つあたりの `prompt` 回数に上限を設ける。
6. main / master へのマージや push はしない。取り込みは人が PR で行う。

**指揮役の約束**

- 指揮役はマシンに 1 人。`cuse start` は 2 人目を起動せず、既存の指揮役を開く（止まっていれば `claude --resume` で再開、`--new` のときだけ作り直す）。
- 指揮役は `--disallowedTools` で Edit / Write / NotebookEdit を外して起動する。作業は必ず配下に渡す。
- `cuse start` は指揮役にだけ専用トークンを環境変数で渡す。`spawn` / `prompt` / `kill` / `clean` はトークンがないと動かない。配下には渡さない（配下が孫を作れない）。人が TUI から使う「止める」はトークンなしで使える。

**作りの約束**

- TypeScript、Node.js 20 以上。CLI は npm、アプリは cc-park と同じく .app でも配る。macOS を先に、Linux はデスクトップ環境があれば対応。
- GUI は Electron + React（cc-park と同じ main / preload / renderer の構成）。中央の埋め込み端末は xterm.js + node-pty。端末の TUI と Web UI は作らない。
- renderer は contextIsolation を有効、nodeIntegration を無効にする。プレビューの Web 表示は別のセッション領域で隔離する。
- `claude` コマンドの実行は差し替えられる形（cc-park の `runCommand` と同じ考え）にし、テストでは偽物を使う。テスト中に本物の `claude` を呼ばない。
- 指揮役向けのコマンドはすべて `--json` に対応する。名前と引数は muse にそろえる。
- ウィンドウを閉じても配下は止めない（配下は Claude Code の background セッションとして動き続ける）。

## 未決事項と仮の既定値

次の 5 点は Naoki がまだ決めていません。第 1 段階は「仮の値」で進めてよく、変えやすいように設定や定数にまとめてください。画面の方式は「GUI のみ」で決定済みです。

| 未決事項 | 仮の値 | 第 1 段階への影響 |
| --- | --- | --- |
| リポジトリ名と npm パッケージ名 | `NaokiIshimura/cuse`、`cuse`（取れなければ `cuse-cli` か `@naoki/cuse`） | `package.json` の `name` と `bin` |
| 共通コードの扱い | cc-park から写す。共通パッケージ化は第 3 段階の後に判断 | 写したファイルの先頭に写し元と cc-park のコミットを書く |
| 同時に動かす配下の上限 | 3 | 第 1 段階では上端のバーに表示するだけ |
| cc-park 側の台帳対応の時期 | cuse の第 2 段階のリリースに合わせる | なし |
| 指揮役 1 人の範囲 | マシンに 1 人 | なし（第 2 段階） |

## 最初のタスク: 第 1 段階（v0.1.0）

第 1 段階は「観察」だけです。セッションを起動・停止・書き換えるコードは一切入れません。対象は `status` / `agents` / `output` の 3 コマンドと、読み取り専用のウィンドウ（`cuse app`）です。

- [ ] **リポジトリの土台**: `package.json`（`type: module`、`bin: { cuse }`、Electron の `main`、`engines.node >= 20`）、`tsconfig`（cc-park と同じく本体・テスト・renderer の 3 構成）、renderer 用の vite、vitest、MIT ライセンス、README。CI でテスト・型チェック・ビルドの 3 つを回す。
- [ ] **CLAUDE.md**: 末尾の「作業ルール」を元に書く。この引継書は `docs/HANDOFF.md` に置く。
- [ ] **状態読み取りの移植**: 次の節の表のファイルを cc-park から写し、テストも一緒に写す。
- [ ] **`cuse agents [--all] [--json]`**: 既定は台帳に載った配下だけ（第 1 段階では台帳がないので空）。`--all` でマシン上の全セッション。
- [ ] **`cuse status [--json]`**: 状態ごとの件数と、人の対応が要るもの（承認待ち・入力待ち）を返す。
- [ ] **`cuse output <名前> [--lines N] [--json]`**: transcript の最後の assistant 発言と `claude logs` の末尾。名前が曖昧なら候補を並べてエラーにする。
- [ ] **`cuse app`（読み取り専用ウィンドウ）**: 上端のバーと左の一覧（Clawd の AA 付き、状態で動く）だけを作る。中央と右は「第 2・第 3 段階で入る」空の場所にする。台帳がない間は「全セッション」表示に切り替えられるようにする。
- [ ] **バージョン確認**: `claude --version` が background セッションの対応版（v2.1.139 以降）未満なら、分かる言葉で知らせる。
- [ ] **見本データ**: `claude agents --json` と transcript の実物の見本を `test/fixtures/` に置き、解釈のテストに使う。cc-park のテストの見本を写してよい。個人のパスや会話の中身は伏せる。

**完了条件**

- テスト・型チェック・ビルドが通り、CI が緑。
- `version` を `0.1.0` にして PR を出す。PR の説明に、Naoki が手元で確かめる手順（実際に `claude --bg` で 2〜3 個動かして `agents --all` / `status` / `output` を実行し、`cuse app` で一覧と Clawd の動きを見る）を書く。
- 人の確認が済むまで、第 2 段階の作業は始めない。

## cc-park から移植するコード

写し元は [cc-park](https://github.com/NaokiIshimura/cc-park) の v0.25.0 です。同名の `*.test.ts` も一緒に写し、写したファイルの先頭に「写し元: cc-park `<パス>` @ `<コミット>`」を書きます。

| 写し元 | 中身 | 段階 | 移すときの注意 |
| --- | --- | --- | --- |
| `src/types/agent.ts` | `claude agents --json` の生データと整えた型 | 1 | そのまま |
| `src/core/runCommand.ts` | 外部コマンド実行の抽象（テストで差し替え） | 1 | そのまま |
| `src/core/shellPath.ts` | Finder から起動したアプリの PATH を補う | 1 | .app から `claude` を見つけるために要る |
| `src/core/fetchAgents.ts` | `claude agents --json` の取得と失敗の種別 | 1 | そのまま |
| `src/core/normalizeAgent.ts` | 生の状態文字列から表示用の状態への対応 | 1 | そのまま |
| `src/core/agentsDebug.ts` | 出力仕様の変化を見張る仕組み | 1 | そのまま |
| `src/core/readSessionMeta.ts` | transcript から最終プロンプト・トークン使用量・サブエージェント | 1 | そのまま |
| `src/shared/parseTranscript.ts` | transcript（JSONL）の解釈 | 1 | `output` 用に「最後の assistant 発言」を取る関数を足す。第 3 段階でプレビュー用に Read / Edit / WebFetch を拾う関数を足す |
| `src/shared/transcriptPath.ts` | transcript の置き場所 | 1 | そのまま |
| `src/core/diffAgents.ts` | 前回と今回の状態遷移 | 1 | 上端のバーの警告と第 2 段階の `wait` で使う |
| `src/shared/statusDetail.ts`、`attention.ts`、`sortAgents.ts`、`subagents.ts` | 状態の説明、要対応の判定、並べ替え、サブエージェント | 1 | Dock バッジ向けの部分は削る |
| `src/shared/characters.ts`、`aaBitmap.ts` | Clawd の AA と状態ごとのコマ | 1 | そのまま |
| `src/gui/` の main / preload / ipc の骨組み、renderer のキャラクター表示部品 | Electron アプリの土台と Clawd の描画 | 1 | ミニ表示、最前面固定、透過、メニューバー、Dock バッジは写さない |
| `src/core/launchAgent.ts`、`stopAgent.ts`、`src/shared/resumeCommand.ts` | 起動・停止・再開のコマンド組み立て | 2 | 第 1 段階では写さない |

写さないもの: 予約起動（`scheduledLaunch.ts`）、cc-park 固有のウィンドウ機能（ミニ表示、最前面固定、透過、四隅への移動）、メニューバーと Dock の件数表示。

## コマンドと台帳の仕様

指揮役が Bash から呼ぶコマンド 10 個と、人が使うアプリ `cuse app` です。muse の `attach` / `dashboard` / `monitor` はアプリ 1 つにまとめます。配下は名前で指します。「段階」は入れる時期です。

| コマンド | 段階 | 動き |
| --- | --- | --- |
| `status [--json]` | 1 | 配下の数、状態ごとの件数、人の対応が要るもの |
| `agents [--all] [--json]` | 1 | 配下（`--all` で全セッション）の状態、`waitingFor`、承認待ちのツール、最後の指示、コンテキスト使用率 |
| `output <名前> [--lines N] [--json]` | 1 | 最後の報告と `claude logs` の末尾 |
| `app` | 1〜3 | cuse のウィンドウを開く。第 1 段階は上端のバーと左の一覧、第 2 段階で中央の埋め込み端末、第 3 段階で右のプレビュー |
| `start [--cwd] [--new]` | 2 | 指揮役 `cuse-leader` を起動し、cuse のウィンドウを開く。既にいればそれを開く。編集系ツールを外し、cuse スキルと心得を読み込ませる |
| `spawn "<タスク>" <名前> [--cwd --agent --model]` | 2 | `claude --bg --name` で起動し、台帳に記録。本当の名前と ID を返す |
| `prompt <名前> "<指示>"` | 2 | 終わった配下には `claude --resume <UUID> --bg`。動いていれば「`SendMessage` で送る」よう返す |
| `wait <名前…> [--until idle\|attention\|done] [--timeout]` | 2 | 条件が成り立つまで待ち、「誰が何のために止まったか」を返す |
| `kill <名前> --reason "<理由>"` | 2 | `claude stop` で止め、理由を台帳に残す |
| `review <名前>` | 3 | worktree のブランチ、`git diff --stat`、未 commit / 未 push、PR、最後の報告 |
| `clean` | 3 | 完了した配下を `claude rm` で片付ける。未 commit / 未 push は残す |

`--json` の出力は安定した形にし、変えるときはバージョンの minor を上げて README に書きます。失敗は終了コード 0 以外と、`{"error":{"kind","message"}}` で返します。

**台帳 `~/.cuse/ledger.json`**（第 2 段階で書き始める。第 1 段階はあれば読むだけ）

```json
{
  "version": 1,
  "leader": { "sessionId": "…", "name": "cuse-leader", "startedAt": "2026-11-21T09:00:00Z" },
  "workers": [
    {
      "name": "tests", "shortId": "…", "sessionId": "…",
      "task": "テストの追加", "cwd": "…", "worktree": "…",
      "startedAt": "…", "endedAt": null, "endReason": null, "promptCount": 0
    }
  ]
}
```

- 書き込みは一時ファイルに書いてから名前を変える（壊れないように）。
- JSON Schema をリポジトリに同梱し、cc-park など他のツールが読めるように公開する。
- 項目を足すのはよいが、削る・意味を変えるときは `version` を上げる。

## 画面（GUI）の仕様

画面はデスクトップアプリだけです。見た目の完成形は [cuse GUI デザイン](https://claude.ai/artifact/Rtxxfb7WABe6atwGFfU644) で、配置と配色はこれに合わせます。Electron + React で、cc-park と同じ main / preload / renderer の構成にします。

| 場所 | 中身 | 入る段階 |
| --- | --- | --- |
| 上端のバー | `cuse` の印、指揮役の名前と状態、配下数、対応待ち数、コンテキスト使用率。健全性の警告（止まっている配下、長い承認待ち、上限に近い同時実行数） | 1 |
| 左 | 配下のカード一覧。承認待ちが先頭。各カードに Clawd の AA・名前・状態・経過時間・最後の動き。終わった配下は「DONE」の下に薄く | 1（「開く」は 2） |
| 中央 | 埋め込み端末で `claude attach cuse-leader` をそのまま動かす。上部に指揮役の大きめの Clawd と「指揮役」の印。左で配下を「開く」とタブを足して `claude attach <配下>` を開き、人はそこで承認する | 2 |
| 右 | プレビュー。セッションに出たファイル・差分・画像・Web サイト。上にタブ、下に表示履歴 | 3 |

**中央の埋め込み端末**

- xterm.js と node-pty。cuse 独自の入力欄は作らず、Claude Code の画面をそのまま使う。
- node-pty は Electron のバージョンに合わせてビルドする。第 2 段階の最初に、埋め込んだ `claude attach` のキー操作・色・サイズ変更を試す。
- ウィンドウを閉じても attach を切るだけで、指揮役と配下は止めない。

**Clawd の AA**

- cc-park の `characters.ts` の定義と renderer の描き方をそのまま使う。200ms ごとにコマを進める。
- 承認待ち = 右手が上下（黄）、作業中 = 足が動く（シアン）、完了直後 = 両手（明るい緑）、入力待ち・停止 = 静止（灰）。指揮役は cuse のアクセント色。
- サブエージェントが動いていれば、AA の横にミニキャラクターを並べる。
- OS の「視差効果を減らす」設定がオンなら動きを止める。

**プレビュー（第 3 段階）**

- transcript の Read / Edit / Write / WebFetch の呼び出しと、人の依頼と Claude の返事に出た URL（ツールの結果からは `localhost` などだけ）を拾う。既定は指揮役を追いかけ、左で配下を選ぶとその配下に切り替える。「固定」で追いかけを止める。
- ファイルは色付き、変更は worktree の差分、画像はそのまま、Web サイトはアプリ内の隔離したブラウザ表示（Node 連携なし、専用のセッション領域）。普段のブラウザで開くボタンも置く。
- セッションに出ていないファイルや URL は開かない。`.env` などは伏せて出し、クリックでだけ中身を開く。

**置かないもの**: 承認ボタン、配下への指示欄、画面からの `spawn`、端末の TUI、Web UI。

## 第 2 段階以降の道筋

段階ごとに minor を上げてリリースします。次の段階には、Naoki が前の段階を手元で確かめてから進みます。

1. **v0.1.0 観察**: `status` / `agents` / `output` と、読み取り専用のウィンドウ（上端のバーと左の一覧）。完了の条件は、手で動かすセッションを正しく読めること。
2. **v0.2.0 指揮**: `start` / `spawn` / `wait` / `prompt` / `kill`、台帳、指揮役のトークン、cuse スキル（SKILL.md）と指揮役の心得、`install-skill`、中央の埋め込み端末（指揮役と配下を開く）。完了の条件は、企画書の利用シーン（3 並列）を最後まで通せること。
3. **v0.3.0 回収と片付け**: `review` / `clean`、右のプレビュー、配下の詳細表示、承認待ちの OS 通知。同じ時期に cc-park 側で台帳の読み取りを出す。
4. **v0.4.0 以降 拡張**: MCP サーバー版（`cuse mcp`）、Claude Code プラグインとしての配布、共通コードの切り出し判断。

**第 2 段階で気をつけること**

- 動いている配下へ CLI から直接文を届ける公開の方法はない。届けるのは指揮役の `SendMessage`。非公開のソケットには触らない。
- 指揮役と配下の権限モードの種類が違うとメッセージが保留される。そろえる。
- 放置された background セッションは自動で止まる。`wait` と `prompt` は「止まっていたら resume」を前提にする。
- 同名の生きたセッションがあると名前が変えられる。`spawn` は起動後の本当の名前と ID を記録する。
- git リポジトリでない場所では worktree が作られず、配下同士が同じファイルを書き合う。`spawn` は警告を返す。
- 必要な Claude Code のバージョン: cross-session messaging は v2.1.224 以降、名前での `attach` / `logs` は v2.1.290 以降。`start` で確かめる。

## 作業ルールと参考資料

作業の進め方は cc-park の CLAUDE.md に合わせます。新しいリポジトリの CLAUDE.md にもこのまま書いてください。

- 変更後は**テスト・型チェック・ビルドの 3 つ**を通す。CI も同じ 3 つを回す。
- テストは対象を指定して実行する（`npx vitest run <ファイル>`）。
- PR を出すときは `package.json` と `package-lock.json` の `version` を上げる（`npm version <patch|minor> --no-git-tag-version`）。
- main へは直接 push せず、ブランチを切って PR にする。マージは Naoki が行う。
- コード中のコメントと README は日本語。「なぜそうしたか」を書く。
- テストや CI で本物の `claude` を呼ばない。実機での確認手順は PR に書いて Naoki に頂む。

**参考資料**

- [cuse 企画書（単体ツール版）](https://claude.ai/artifact/6f5z5xE3oAVRjXyu1twzTj): 設計の理由、利用シーン、安全設計、リスク
- [cuse GUI デザイン](https://claude.ai/artifact/Rtxxfb7WABe6atwGFfU644): アプリ画面の見た目
- [cc-park リポジトリ](https://github.com/NaokiIshimura/cc-park): 移植元（v0.25.0）
- [tribe CLI の muse スキル](https://hub.openclaw.ai/alexander-morris/skills/muse): コマンド体系の手本
- [Claude Code: agent view](https://code.claude.com/docs/en/agent-view): background セッション、`claude agents` / `logs` / `stop` / `rm`
- [Claude Code: Message your other Claude Code sessions](https://code.claude.com/docs/en/cross-session-messaging): `SendMessage` と `notify_when_idle`

企画書とデザインは claude.ai 上にあり、Claude Code からは読めません。必要なら Naoki が Markdown や画像で書き出して `docs/` に置きます。

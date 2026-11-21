# cuse

1 つの Claude Code セッション（**指揮役**）が、同じマシンのほかの Claude Code セッション（**配下**）を
起動・見守り・指示・停止できるようにするデスクトップアプリ（macOS）です。
[tribe CLI の muse](https://hub.openclaw.ai/alexander-morris/skills/muse) を参考にしています。

- 人は cuse のウィンドウの中央で、指揮役とだけ話します。人に回ってくるのは権限の承認と方針の判断だけです。
- 指揮役は作業をしません。計画・分担・確認・報告だけをし、作業はすべて配下（background セッション）に任せます。
- 配下の様子はウィンドウの左に並び、承認が要るとカードに「開いて承認する」が出ます。

> **いまは第 3 段階（v0.3）の途中です。** 指揮役の起動、配下の起動・待機・指示・停止、ウィンドウ中央の埋め込み端末、
> 差分の回収（`review`）と片付け（`clean`）、承認待ちの OS 通知まで。右のプレビューはこの後に入ります。

## 必要なもの

- macOS
- Claude Code v2.1.224 以降（`claude` コマンドが使えること）。古いときは cuse が知らせます。

Node.js や npm は要りません。cuse は `cuse.app` だけで使えます。

## インストール

[Releases](../../releases) から `.app` をダウンロードできます。

| ファイル | 対象 |
| --- | --- |
| `cuse-<version>-darwin-arm64.zip` / `cuse-darwin-arm64.zip` | Apple シリコン（M1 以降） |
| `cuse-<version>-darwin-x64.zip` / `cuse-darwin-x64.zip` | Intel Mac |

バージョンを含まない方は中身が同じ複製で、下記の手順はこちらを使って常に最新版を取得します。

配布用の証明書で署名・公証をしていないため、ブラウザでダウンロードすると初回は Gatekeeper に止められます。
ターミナルで次のコマンドを実行すると、最新版をダウンロードして `/Applications` に置けます（古い `cuse.app` は置き換えます）。

Apple シリコン（M1 以降）:

```bash
curl -fL -o /tmp/cuse.zip https://github.com/NaokiIshimura/cuse/releases/latest/download/cuse-darwin-arm64.zip && \
  rm -rf /Applications/cuse.app && \
  ditto -x -k /tmp/cuse.zip /Applications && \
  rm /tmp/cuse.zip
```

Intel Mac:

```bash
curl -fL -o /tmp/cuse.zip https://github.com/NaokiIshimura/cuse/releases/latest/download/cuse-darwin-x64.zip && \
  rm -rf /Applications/cuse.app && \
  ditto -x -k /tmp/cuse.zip /Applications && \
  rm /tmp/cuse.zip
```

`curl` でダウンロードしたファイルには隔離属性（`com.apple.quarantine`）が付かないため、Gatekeeper に止められません。

ブラウザでダウンロードした場合は、zip を展開して `cuse.app` を `/Applications` に置き、隔離属性を外してください。

```bash
xattr -dr com.apple.quarantine /Applications/cuse.app
```

## はじめて使うとき

1. `cuse.app` を開きます。指揮役は指揮役の居場所 `~/.cuse/leader` で起きます。
2. **初回だけ**、中央の黄色い枠に「指揮役の居場所を Claude Code で信頼してください」と出ます。その下は信頼の確認のためだけに動かしている Claude Code です（指揮役ではありません）。↓ キーで「Yes, I trust this folder」を選んで Enter を押すと、自動で閉じて指揮役が起きます。起きないときは「▶ 指揮役を起こす」を押します。
3. 中央に指揮役が出たら、「ここから依頼します」の例のように、やってほしいことを書いて Enter を押します。どのリポジトリでの作業かも書いてください（例: 「~/work/app の README の誤字を直して、テストも足して。終わったら差分を見せて」）。
4. 指揮役が配下を起こすと、左に並びます。承認が要ると、カードに黄色い「開いて承認する」が出るので、押して中央に出る配下の Claude Code で承認します。
5. 終わったら、指揮役が `cuse review` で差分を確かめ、報告と一緒にまとめて伝えます。取り込み（PR のマージ）は人が行います。
6. 取り込んだら、左の DONE の「片付ける」か、指揮役に頼んで終わった配下を片付けます。commit や push をしていない作業がある配下は残ります。

ウィンドウを見ていない間に配下が承認待ちになると、OS の通知が出ます。通知を押すと、その配下が中央に開きます。

ウィンドウを閉じても、指揮役と配下は止まりません。もう一度開くと、同じ指揮役が開きます。

## ウィンドウ

見た目の完成形は `docs/cuse attach.png` です。

| 場所 | 中身 | 入った段階 |
| --- | --- | --- |
| 上端のバー | `cuse` の印、指揮役の名前と状態、配下数（上限つき）、対応待ち数、指揮役のコンテキスト使用率。健全性の警告（止まっている配下、5 分以上の承認待ち、上限に達した同時実行数）と、Claude Code が古いときの案内 | 1 |
| 左 | 配下のカード一覧。承認待ちが先頭。Clawd の AA・名前・状態・経過時間・最後の動き。終わった配下は「DONE」の下に薄く。「配下 / 全セッション」で切り替え。カードの「開く」（承認待ちなら「開いて承認する」）で中央に開き、「止める」で止める（台帳の配下だけ。理由を書く）。DONE の「片付ける」で終わった配下を片付ける | 1・2・3 |
| 中央 | 埋め込み端末（xterm.js + node-pty）で `claude attach` をそのまま動かす。先頭のタブは指揮役で、上に大きめの Clawd と「指揮役」の印。左で開いた配下はタブで並ぶ | 2 |
| 右 | プレビュー | 3 |

- 人はウィンドウの中央で指揮役と話します。cuse 独自の入力欄はなく、Claude Code の画面をそのまま使います。
- 承認のボタンはありません。「開いて承認する」は配下の Claude Code を中央に開くだけで、承認は人がその画面で行います。
- タブを閉じる・ウィンドウを閉じると `claude attach` を切るだけで、指揮役と配下は止まりません。
- ウィンドウは 1 つだけです。2 つ目を開こうとすると、前のウィンドウが前に出ます。
- Clawd の AA は cc-park と同じ定義です。承認待ち = 右手が上下（黄）、作業中 = 足が動く（シアン）、
  完了直後 = 両手（明るい緑）、入力待ち・停止 = 静止（灰）。指揮役は cuse の色で描きます。サブエージェントが動いていればミニキャラクターが並びます。
- OS の「視差効果を減らす」がオンなら、AA とボタンの光は動きません。

### 指揮役の起こし方

- ウィンドウを開くと指揮役をそろえます。いなければ起こし、止まっていれば `claude --resume` で同じ会話を再開し、動いていればそのまま使います。**指揮役はマシンに 1 人**です。
- 指揮役の居場所は `~/.cuse/leader` です（無ければ作ります）。ホームフォルダは Claude Code がそこでの background セッションを断るので使いません。別の場所で起こしたいときは、中央の「別のフォルダで起こす」を使います。
- 初回だけ、Claude Code がまだ `~/.cuse/leader` を信頼していないので、そのフォルダで動かした Claude Code の確認に人が答えます。cuse が Claude Code の設定に信頼を書き込むことはしません。信頼したかは `~/.claude.json` を読んで確かめ、信頼したら自動で指揮役を起こします（読むだけです）。
- 指揮役は Edit / Write / NotebookEdit を外して起動し、作業は必ず配下に任せます。心得（`prompts/leader.md`）を追加のシステムプロンプトで渡し、cuse スキル（`~/.claude/skills/cuse/SKILL.md`）を置きます。

## 指揮役が使うコマンド

指揮役は Bash から `cuse` コマンドで配下を動かします。このコマンドは人が入れるものではなく、
`cuse.app` が開くたびに `~/.cuse/bin/cuse` に置き、指揮役の PATH の先頭に足します。中身はアプリの中の CLI を、
アプリ自身の Electron を Node として動かして実行するだけなので、Node.js や npm は要りません。

| コマンド | 動き |
| --- | --- |
| `cuse status [--all] [--json]` | 配下の数、状態ごとの件数、人の対応が要るもの（承認待ち・入力待ち）、健全性の警告 |
| `cuse agents [--all] [--json]` | 配下の状態、待っているもの、承認待ちのツール、最後の指示、コンテキスト使用率 |
| `cuse output <名前> [--lines N] [--json]` | 最後の報告（transcript の最後の assistant 発言）と `claude logs` の末尾 |
| `cuse wait <名前…> [--until attention\|idle\|done] [--timeout <秒>] [--json]` | 条件が成り立つまで待ち、誰が何のために止まったかを返す |
| `cuse spawn "<タスク>" <名前> --cwd <dir> [--agent <name>] [--model <model>] [--json]` | 配下を `claude --bg --name` で起動し、台帳に記録する（指揮役だけ） |
| `cuse prompt <名前> "<指示>" [--json]` | 止まった配下に `claude --resume` で続きを頼む。動いていれば送らずに「SendMessage で送る」よう返す（指揮役だけ） |
| `cuse kill <名前> --reason "<理由>" [--json]` | `claude stop` で止め、理由を台帳に残す（指揮役だけ） |
| `cuse review <名前> [--json]` | 作業した場所（worktree）・ブランチ・取り込み先との差分・commit していない変更・push していない commit・PR（`gh` があれば）・最後の報告 |
| `cuse clean [--json]` | 終わった配下を `claude rm` で片付ける。commit していない変更・push していない commit がある配下（確かめられないものも）は残す（指揮役だけ。人はウィンドウの「片付ける」で使える） |

- `status` / `agents` の既定の対象は台帳 `~/.cuse/ledger.json` に載った配下だけです。マシン上の全セッションは `--all` で見られます。
- 名前は、完全一致 → 短縮 ID / sessionId → 前方一致 → 部分一致 の順に探します。1 つに決まらないときは候補を並べてエラーにします。
- `spawn` / `prompt` / `kill` で指せるのは台帳に載った配下だけです。人が手で動かしているセッションは見るだけです。
- 指揮役の居場所はリポジトリではないので、`spawn` には `--cwd <作業するリポジトリ>` を付けます。`~/.cuse` の中では配下を起こしません。
- 配下は指揮役と同じ権限モードで起動します（違うと `SendMessage` が保留されるため）。権限確認を飛ばすモードは使いません。配下には心得（`prompts/worker.md`）を渡し、main / master へのマージや push をしないこと、最後に要約を報告することを伝えます。

### 指揮役のトークン

`spawn` / `prompt` / `kill` は指揮役だけが使えます。指揮役を起こすたびにトークンを作り、指揮役の環境変数 `CUSE_LEADER_TOKEN` にだけ渡します（`--settings` の `env` と、起動するプロセスの環境の両方）。台帳にはハッシュだけを残します。配下を起動するときはこの環境変数を外すので、配下は別の配下を作れません。

background セッションを起こす常駐プロセスが環境変数を引き継がなかった場合に備えて、呼び出し元の `CLAUDE_JOB_DIR`（background セッションの中で Claude Code が立てる）が台帳の指揮役の短縮 ID と一致するときも指揮役とみなします。

同じユーザーのプロセスなら台帳もトランスクリプトも読めるので、これは悪意への備えではなく「配下がうっかり指揮役のコマンドを使う」ことへの備えです。

### `cuse wait`

| `--until` | 返るとき |
| --- | --- |
| `attention`（既定） | 誰か 1 人でも手を止めたら（承認待ち・入力待ち・完了・停止） |
| `idle` | 全員が手を止めたら |
| `done` | 全員が終わったら（完了・停止・一覧から消えた） |

既定の時間切れは 110 秒で、Claude Code の Bash ツールの既定の時間切れ（2 分）より短くしています。時間切れは失敗ではなく `timedOut: true` で返るので、指揮役はもう一度呼びます。

### 上限

| 上限 | 仮の値 | 超えたとき |
| --- | --- | --- |
| 同時に動かす配下 | 3 | `spawn` が `limit` で断る（完了・停止した配下は数えない） |
| 配下 1 つあたりの `prompt` | 20 回 | `prompt` が `limit` で断る（「SendMessage で送る」と返したときも数える） |

### `--json` の形

指揮役が読むため、形を安定させます。項目の削除や意味の変更をするときは minor を上げてここに書きます。
値が無いときは項目を省かず `null` を入れます。

`cuse agents --json`:

```json
{
  "scope": "workers",
  "ledger": "missing",
  "agents": [
    {
      "name": "tests",
      "role": "worker",
      "sessionId": "…",
      "shortId": "a1b2c3d4",
      "kind": "background",
      "state": "blocked",
      "rawState": "blocked",
      "waitingFor": "approval",
      "pendingTool": { "name": "Bash", "detail": "npm test" },
      "lastPrompt": "テストを追加して",
      "context": { "used": 76000, "limit": 200000, "ratio": 0.38 },
      "subagents": 0,
      "cwd": "/Users/you/work/app",
      "startedAt": "2026-11-21T09:00:00.000Z",
      "elapsedMs": 1080000,
      "task": "テストの追加"
    }
  ]
}
```

| 項目 | 値 |
| --- | --- |
| `scope` | `workers`（台帳の配下だけ）/ `all`（`--all`） |
| `ledger` | 台帳の読み取り結果。`ok` / `missing` / `invalid` |
| `role` | `leader` / `worker` / `other`（台帳に無い） |
| `state` | `working` / `waiting` / `blocked` / `done` / `stopped` / `unknown` |
| `waitingFor` | 人の対応が要るとき `approval`（承認待ち）/ `input`（入力待ち）。要らなければ `null` |

`cuse status --json` は `scope` / `ledger` / `leader` / `total` / `active` / `maxWorkers` / `counts`（状態ごとの件数）/
`attention`（`name` / `sessionId` / `waitingFor` / `reason`）/ `warnings`（`kind` / `message` / `names`）を返します。

`cuse output --json` は `name` / `sessionId` / `shortId` / `state` / `lastReport` / `logs`（行の配列）/ `logsError` を返します。
`claude logs` は background セッションにだけあり、短縮 ID で呼びます。

`cuse spawn --json` は `name`（本当の名前）/ `renamed` / `shortId` / `sessionId` / `cwd` / `gitRepository` を返します。

`cuse wait --json` は `until` / `met` / `timedOut` / `elapsedMs` / `sessions`（`name` / `sessionId` / `shortId` / `status` / `reason`）を返します。
`status` は `working` / `approval` / `input` / `done` / `stopped` / `unknown` / `missing` のどれかです。

`cuse prompt --json` は、再開したとき `delivered: true` / `via: "resume"` / `shortId` / `sessionId` / `copied` / `promptCount`、
動いていて送らなかったとき `delivered: false` / `via: "SendMessage"` / `to`（宛先の名前）/ `promptCount` を返します。

`cuse kill --json` は `name` / `shortId` / `reason` / `endedAt` を返します。

`cuse review --json` は `name` / `sessionId` / `shortId` / `state` / `task` / `workDir` / `git`（`repository` / `branch` / `upstream` / `uncommitted` / `unpushed` / `diffStat` / `base`）/ `pullRequest`（`number` / `url` / `state`。無ければ `null`）/ `lastReport` / `keep`（片付けると失うものの説明。失わなければ `null`）を返します。

`cuse clean --json` は `cleaned`（`name` / `shortId`）/ `kept`（`name` / `reason`）/ `running`（まだ動いている配下の名前）を返します。

失敗は終了コード 1 と、標準出力の `{"error":{"kind","message"}}` で返します。
`kind` は `usage` / `not-found` / `ambiguous`（`candidates` 付き）/ `denied`（指揮役ではない）/ `limit`（上限）/
`conflict`（同じ名前の配下がいる）/ `launch`（`claude --bg` / `stop` の失敗）/ `ledger`（台帳を読めない）/ `version` / `timeout` / `exit` / `parse` です。

## 台帳 `~/.cuse/ledger.json`

cuse が起動した指揮役と配下の記録で、cc-park など他のツールとの唯一の接点です。
`start` / `spawn` / `prompt` / `kill` が書き、ほかは読むだけです。形は [`schema/ledger.schema.json`](schema/ledger.schema.json) で公開しています。
項目を足すのはよいが、削る・意味を変えるときは `version` を上げます。

- 書き込みは一時ファイルに書いてから名前を変えます（途中で落ちても壊れた台帳を残さない）。続けて書いても記録が消えないよう、ロックで囲みます。
- 壊れた台帳は上書きせず、エラーにします（人が直せるよう元のファイルを残す）。
- 指揮役のトークンそのものは置かず、SHA-256 だけを置きます。
- `clean` で片付けた配下も記録は消さず、`cleanedAt` を付けます。

## 仮の既定値

まだ決まっていない値は `src/config/defaults.ts` にまとめています。

| 値 | 仮の値 |
| --- | --- |
| 同時に動かす配下の上限 | 3 |
| 配下 1 つあたりの `prompt` の上限 | 20 |
| 指揮役の名前 | `cuse-leader` |
| 対応する Claude Code の最小バージョン | 2.1.224（指揮役が SendMessage を使うため） |
| `cuse output` の既定の行数 | 20 |
| `cuse wait` の既定の時間切れ | 110 秒 |

## 開発

```bash
npm install
npm run typecheck
npm test
npm run build
npm run gui:dev       # ビルドしてウィンドウを起動
npm run gui:package   # .app にパッケージ化（macOS）
```

開発中に端末から試すときは、`npm link` で `cuse` コマンドを入れ、`cuse start` / `cuse app` も使えます（配布はしません）。

状態の読み取りや Clawd の AA は [cc-park](https://github.com/NaokiIshimura/cc-park) v0.25.0 から写しています
（写したファイルの先頭に写し元とコミットがあります）。cuse は cc-park に依存しません。

## ライセンス

MIT

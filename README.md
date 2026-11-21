# cuse

1 つの Claude Code セッション（**指揮役**）が、同じマシンのほかの Claude Code セッション（**配下**）を
起動・監視・指示・回収・停止できるようにする CLI と、人が見るデスクトップアプリです。
[tribe CLI の muse](https://hub.openclaw.ai/alexander-morris/skills/muse) を参考にしています。

- 指揮役はマシンに 1 人。作業はせず、計画・分担・確認・報告だけをします。
- 作業はすべて配下（`claude --bg --name` で起動する background セッション）が、それぞれ別の worktree で行います。
- 人は指揮役とだけ話します。人に回るのは権限の承認と方針の判断だけです。

> **いまは第 1 段階（v0.1.0）です。** 読み取りだけで、セッションを起動・停止・書き換える機能はありません。
> 配下の起動（`start` / `spawn`）は第 2 段階で入ります。

## 必要なもの

- Node.js 20 以上
- Claude Code v2.1.139 以降（background セッションに対応した版）。古いときは cuse が知らせます。
- macOS（Linux はデスクトップ環境があれば動きます）

## インストール

```bash
npm install -g cuse
```

## コマンド（第 1 段階）

| コマンド | 動き |
| --- | --- |
| `cuse status [--all] [--json]` | 配下の数、状態ごとの件数、人の対応が要るもの（承認待ち・入力待ち）、健全性の警告 |
| `cuse agents [--all] [--json]` | 配下の状態、待っているもの、承認待ちのツール、最後の指示、コンテキスト使用率 |
| `cuse output <名前> [--lines N] [--json]` | 最後の報告（transcript の最後の assistant 発言）と `claude logs` の末尾 |
| `cuse app` | 読み取り専用のウィンドウを開く |

- 既定の対象は台帳 `~/.cuse/ledger.json` に載った配下だけです。台帳は第 2 段階から書かれるので、
  いまはマシン上の全セッションを見るには `--all` を付けます。
- `output` の名前は、完全一致 → 短縮 ID / sessionId → 前方一致 → 部分一致 の順に探します。
  1 つに決まらないときは候補を並べてエラーにします。
- `--debug` を付けると、受け取った `claude agents --json` の出力と解釈できない値を `~/.cuse/debug/` に残します。

```bash
cuse agents --all
cuse status --json
cuse output tests --lines 50
```

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

失敗は終了コード 1 と、標準出力の `{"error":{"kind","message"}}` で返します。
`kind` は `usage` / `not-found` / `ambiguous`（`candidates` 付き）/ `timeout` / `exit` / `parse` などです。

## ウィンドウ（`cuse app`）

見た目の完成形は `docs/cuse attach.png` です。第 1 段階では上端のバーと左の一覧だけが動きます。

| 場所 | 中身 | 入る段階 |
| --- | --- | --- |
| 上端のバー | `cuse` の印、指揮役の名前と状態、配下数（上限つき）、対応待ち数、指揮役のコンテキスト使用率。健全性の警告（止まっている配下、5 分以上の承認待ち、上限に達した同時実行数）と、Claude Code が古いときの案内 | 1 |
| 左 | 配下のカード一覧。承認待ちが先頭。Clawd の AA・名前・状態・経過時間・最後の動き。終わった配下は「DONE」の下に薄く。「配下 / 全セッション」で切り替え | 1 |
| 中央 | 指揮役の会話（埋め込み端末） | 2 |
| 右 | プレビュー | 3 |

- Clawd の AA は cc-park と同じ定義です。承認待ち = 右手が上下（黄）、作業中 = 足が動く（シアン）、
  完了直後 = 両手（明るい緑）、入力待ち・停止 = 静止（灰）。サブエージェントが動いていればミニキャラクターが並びます。
- OS の「視差効果を減らす」がオンなら、AA は動きません。
- 承認のボタンはありません。承認は `claude attach` か agent view で行います。
- ウィンドウを閉じても配下は止まりません。

## 台帳 `~/.cuse/ledger.json`

cuse が起動した指揮役と配下の記録で、cc-park など他のツールとの唯一の接点です。
第 2 段階から書き始め、第 1 段階は「あれば読むだけ」です。形は [`schema/ledger.schema.json`](schema/ledger.schema.json) で公開しています。
項目を足すのはよいが、削る・意味を変えるときは `version` を上げます。

## 仮の既定値

まだ決まっていない値は `src/config/defaults.ts` にまとめています。

| 値 | 仮の値 |
| --- | --- |
| 同時に動かす配下の上限 | 3 |
| 指揮役の名前 | `cuse-leader` |
| 対応する Claude Code の最小バージョン | 2.1.139 |
| `cuse output` の既定の行数 | 20 |

## 開発

```bash
npm install
npm run typecheck
npm test
npm run build
npm run gui:dev
```

状態の読み取りや Clawd の AA は [cc-park](https://github.com/NaokiIshimura/cc-park) v0.25.0 から写しています
（写したファイルの先頭に写し元とコミットがあります）。cuse は cc-park に依存しません。

## ライセンス

MIT

---
name: cuse
description: cuse の指揮役として、このマシンのほかの Claude Code セッション（配下）を起動・見守り・指示・停止するときに使う。cuse.app が起こした指揮役（cuse-leader）専用。
---

<!-- cuse-managed: このファイルは cuse.app が置き、開くたびに最新の内容に書き直します。自分で書き換えて使うときは、この行を消してください（消すと書き直されなくなります）。 -->

# cuse（指揮役向け）

cuse は、指揮役が配下の Claude Code セッションを動かすための CLI です。すべて Bash から呼び、`--json` を付けると機械で読める形で返します。失敗は終了コード 1 と `{"error":{"kind","message"}}` です。

`spawn` / `prompt` / `kill` は指揮役だけが使えます（cuse.app が起こしたセッション）。`cuse` コマンドは cuse.app が `~/.cuse/bin/cuse` に置き、指揮役の PATH に入っています。見つからないときは `~/.cuse/bin/cuse` を直接呼んでください。

## 流れ

1. 人の依頼を、互いに独立した小さなタスクに分ける。
2. `cuse spawn "<タスク>" <名前> --cwd <作業するリポジトリ>` で配下を起動する（同時に動かせる数に上限がある）。指揮役の居場所（`~/.cuse/leader`）はリポジトリではないので、`--cwd` は必ず付ける。
3. `cuse wait <名前…>` で待つ。返ってきた「誰が何のために止まったか」で次を決める。
   - 承認待ち（`approval`）: 人に伝え、cuse のウィンドウで承認してもらう。あなたは承認しない。
   - 入力待ち（`input`）: `cuse output <名前>` で質問を読む。方針の範囲内なら `SendMessage` で答え、方針に関わるなら人に聞く。
   - 完了（`done`）: `cuse output <名前>` で報告を読み、差分を確かめて人に伝える。
4. 直しが要れば、動いている配下には `SendMessage`、止まった配下には `cuse prompt <名前> "<指示>"`。
5. 要らなくなった配下は `cuse kill <名前> --reason "<理由>"`。

## コマンド

| コマンド | 動き |
| --- | --- |
| `cuse status [--all] [--json]` | 配下の数、状態ごとの件数、人の対応が要るもの、健全性の警告 |
| `cuse agents [--all] [--json]` | 配下の状態・待っているもの・承認待ちのツール・最後の指示・コンテキスト使用率 |
| `cuse spawn "<タスク>" <名前> --cwd <dir> [--agent <name>] [--model <model>] [--json]` | 配下を `claude --bg` で起動し、台帳に記録する。本当の名前と短縮 ID を返す。git リポジトリでない場所では警告を返す。cuse の置き場所（`~/.cuse`）では起こさない |
| `cuse wait <名前…> [--until attention\|idle\|done] [--timeout <秒>] [--json]` | 条件が成り立つまで待つ。既定は `attention`（誰か 1 人でも手を止めたら返す）、`idle` は全員が手を止めるまで、`done` は全員が終わるまで。既定の時間切れは 110 秒（Bash の既定の時間切れより短い）。時間切れなら `timedOut: true` で返るので、もう一度呼ぶ |
| `cuse output <名前> [--lines N] [--json]` | 最後の報告（最後の assistant 発言）と `claude logs` の末尾 |
| `cuse prompt <名前> "<指示>" [--json]` | 止まった配下に `claude --resume` で続きを頼む。動いている配下なら送らずに「SendMessage で送る」よう返す（`delivered: false`） |
| `cuse kill <名前> --reason "<理由>" [--json]` | `claude stop` で止め、理由を台帳に残す。変更や worktree は消さない |

## 注意

- 配下は名前で指します。名前があいまいだと候補を並べたエラーになるので、完全な名前か短縮 ID で指し直します。
- `kill` / `prompt` で指せるのは台帳に載った配下だけです。人が手で動かしているセッションは見るだけにします。
- 配下は放っておくと自動で止まることがあります。止まっていても `cuse prompt` で再開できます。
- `SendMessage` が届かず保留されたら、人に知らせます（権限モードの種類が違うと保留されます。cuse は指揮役と同じ権限モードで配下を起動します）。

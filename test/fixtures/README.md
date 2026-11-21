# テスト用の見本データ

| ディレクトリ | 中身 | 使うテスト |
| --- | --- | --- |
| `agents/` | `claude agents --json` の出力（cc-park から写した実物の匿名化版） | `src/core/fixtures.test.ts` |
| `transcripts/` | セッション transcript（JSONL）の見本 | `src/shared/findLastAssistantText.test.ts`、`src/commands/output.test.ts` |

個人のパス・セッション ID・会話の中身は伏せて、形だけを残す。
パスは `/Users/example/...`、セッション ID は `00000000-0000-4000-...` に置き換える。

`transcripts/worker-report.jsonl` は Claude Code 2.1.325 の transcript の形
（`parentUuid` / `isSidechain` / `message.id` / content ブロック）に合わせて組んだもの。
1 つの応答が content ブロックごとに別行へ書かれること、サブエージェントの発言が
`isSidechain: true` で混ざることを再現している。

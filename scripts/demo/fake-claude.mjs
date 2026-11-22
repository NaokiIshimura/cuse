#!/usr/bin/env node
/**
 * README の GIF を撮るための偽の `claude`（scripts/demo/record.mjs が PATH の先頭に置く）。
 *
 * 本物の `claude` を呼ばずに、見せたい状態を cuse に見せるために使う。
 * 一覧（`agents --json`）は、このファイルと同じ場所の `../state.json` をそのまま返す。
 * record.mjs が場面ごとに state.json を書き換えるので、カードの状態が台本どおりに変わる。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...rest] = process.argv.slice(2);

if (command === '--version') {
  process.stdout.write('2.1.330 (Claude Code)\n');
} else if (command === 'agents') {
  process.stdout.write(readFileSync(join(root, 'state.json'), 'utf8'));
} else if (command === 'attach') {
  // 指揮役のタブは「会話」を出すので端末は写らないが、裏で attach は開くので、それらしく待っておく
  process.stdout.write(`claude attach ${rest[0] ?? ''}（デモ）\r\n`);
  setInterval(() => {}, 60_000);
} else {
  // ほかのコマンド（stop など）は撮影では呼ばれない。何もせず成功にする
}

#!/usr/bin/env node
/**
 * cc-park から写したファイルが、写し元とどれだけずれているかを確かめる。
 *
 * 使い方: node scripts/check-cc-park-copies.mjs <cc-park を clone したディレクトリ>
 *
 * 写したファイルの先頭には「写し元: cc-park `<パス>` @ `<コミット>`」がある。その 1 行を除いた中身を、
 * cc-park のいまの同じパスと比べ、同じ・cuse で変えた・写し元が無い、のどれかを出す。
 * 共通パッケージにせず写して使う（docs/共通コードの判断.md）ので、cc-park を更新したときに
 * どれを取り込むべきかをこれで見る。依存パッケージは使わない（git だけ使う）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ccPark = process.argv[2];
if (ccPark === undefined || !existsSync(join(ccPark, 'package.json'))) {
  console.error('使い方: node scripts/check-cc-park-copies.mjs <cc-park を clone したディレクトリ>');
  process.exit(1);
}

const HEADER = /^\/\/ 写し元: cc-park `([^`]+)` @ `([^`]+)`/;
const root = new URL('..', import.meta.url).pathname;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const ccParkHead = execFileSync('git', ['-C', ccPark, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const temp = mkdtempSync(join(tmpdir(), 'cuse-copies-'));
const rows = [];

try {
  for (const file of walk(join(root, 'src')).filter((path) => /\.(ts|tsx)$/.test(path))) {
    const [first, ...rest] = readFileSync(file, 'utf8').split('\n');
    const matched = HEADER.exec(first ?? '');
    if (matched === null) {
      continue;
    }
    const [, sourcePath, commit] = matched;
    const source = join(ccPark, sourcePath);
    const local = relative(root, file);
    if (!existsSync(source)) {
      rows.push({ local, state: '写し元が無い', detail: sourcePath, commit });
      continue;
    }
    const stripped = join(temp, 'copy');
    writeFileSync(stripped, rest.join('\n'));
    let numstat = '';
    try {
      execFileSync('git', ['diff', '--no-index', '--numstat', '--', source, stripped], { encoding: 'utf8' });
    } catch (error) {
      // 差分があると git diff --no-index は終了コード 1 を返す
      numstat = String(error.stdout ?? '');
    }
    const [added, removed] = numstat.trim().split(/\s+/);
    rows.push(
      numstat.trim() === ''
        ? { local, state: '同じ', detail: '', commit }
        : { local, state: 'cuse で変えた', detail: `+${added} -${removed}`, commit },
    );
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const order = { 'cuse で変えた': 0, '写し元が無い': 1, 同じ: 2 };
rows.sort((a, b) => order[a.state] - order[b.state] || a.local.localeCompare(b.local));
console.log(`cc-park のいま: ${ccParkHead}`);
for (const row of rows) {
  const stale = row.commit === ccParkHead ? '' : `（写したのは ${row.commit}）`;
  console.log(`${row.state}\t${row.local}\t${row.detail}${stale}`);
}
const counts = rows.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] ?? 0) + 1 }), {});
console.log(`\n同じ ${counts['同じ'] ?? 0} / cuse で変えた ${counts['cuse で変えた'] ?? 0} / 写し元が無い ${counts['写し元が無い'] ?? 0}`);

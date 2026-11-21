import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { readPreviewContent, TEXT_LIMIT_BYTES } from './previewContent.js';
import { execFileRunner } from './runCommand.js';

const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cuse-preview-'));
  dirs.push(dir);
  return dir;
};

const read = (path: string, edited = false, reveal = false) =>
  readPreviewContent({ path, edited }, { reveal, runner: execFileRunner });

describe('readPreviewContent', () => {
  it('文字のファイルはそのまま出す', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n');
    expect(await read(join(dir, 'a.ts'))).toEqual({ kind: 'text', text: 'export const a = 1;\n', truncated: false, diff: null });
  });

  it('大きなファイルは先頭だけ', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'big.txt'), 'x'.repeat(TEXT_LIMIT_BYTES + 10));
    const content = await read(join(dir, 'big.txt'));
    expect(content.kind === 'text' && content.truncated).toBe(true);
    expect(content.kind === 'text' && content.text.length).toBe(TEXT_LIMIT_BYTES);
  });

  it('書き換えたファイルは、最後の commit との差分も出す（本物の git）', async () => {
    const dir = await tempDir();
    const git = (...args: string[]) =>
      run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir });
    await git('init', '-q');
    await writeFile(join(dir, 'notify.ts'), 'old\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'init');
    await writeFile(join(dir, 'notify.ts'), 'new\n');
    const content = await read(join(dir, 'notify.ts'), true);
    expect(content.kind === 'text' && content.diff).toContain('-old\n+new');
  });

  it('画像は data URL にする', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await read(join(dir, 'a.png'))).toEqual({ kind: 'image', dataUrl: 'data:image/png;base64,iVBORw==' });
  });

  it('.env は人が「中身を見る」を押すまで読まない', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, '.env'), 'API_KEY=secret\n');
    expect(await read(join(dir, '.env'))).toEqual({ kind: 'masked' });
    expect(await read(join(dir, '.env'), false, true)).toMatchObject({ kind: 'text', text: 'API_KEY=secret\n' });
  });

  it('無いファイル・バイナリは出さない', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'b.bin'), Buffer.from([1, 0, 2]));
    expect((await read(join(dir, 'missing.ts'))).kind).toBe('unavailable');
    expect(await read(join(dir, 'b.bin'))).toEqual({ kind: 'unavailable', message: 'バイナリのファイルなので出しません。' });
  });

  it('名前がふつうでも、リンクの先が鍵のファイルなら伏せる', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'id_ed25519'), 'secret');
    await symlink(join(dir, 'id_ed25519'), join(dir, 'notes.txt'));
    expect(await read(join(dir, 'notes.txt'))).toEqual({ kind: 'masked' });
  });
});

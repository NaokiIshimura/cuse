import { describe, expect, it } from 'vitest';
import { resolveTerminalLink, type ResolveLinkOptions } from './previewLinks.js';

const chunk = [
  JSON.stringify({ type: 'assistant', cwd: '/w/app', message: { content: [{ type: 'text', text: '~/.claude/tmp/sample.md と src/a.ts、https://example.com を見てください。/etc/hosts も' }] } }),
].join('\n');

const files = new Set(['/home/n/.claude/tmp/sample.md', '/w/app/src/a.ts', '/etc/hosts']);
const options: ResolveLinkOptions = {
  chunk,
  cwd: '/w/app',
  home: '/home/n',
  now: 5,
  isFile: async (path) => files.has(path),
};

describe('resolveTerminalLink', () => {
  it('セッションに出てきたファイルは、~ と相対パスを直して開く', async () => {
    expect(await resolveTerminalLink('~/.claude/tmp/sample.md', 'file', options)).toEqual({
      ok: true,
      item: { kind: 'file', path: '/home/n/.claude/tmp/sample.md', edited: false, at: 5, tool: '端末' },
    });
    expect(await resolveTerminalLink('src/a.ts', 'file', options)).toMatchObject({ ok: true, item: { path: '/w/app/src/a.ts' } });
    expect(await resolveTerminalLink('/etc/hosts', 'file', options)).toMatchObject({ ok: true });
  });

  it('セッションに出てきた URL を開く', async () => {
    expect(await resolveTerminalLink('https://example.com', 'url', options)).toEqual({
      ok: true,
      item: { kind: 'url', url: 'https://example.com', at: 5, tool: 'mention' },
    });
  });

  it('transcript に出てこないもの・無いファイル・作業場所が分からない相対パスは開かない', async () => {
    expect(await resolveTerminalLink('/etc/passwd', 'file', options)).toMatchObject({ ok: false });
    expect(await resolveTerminalLink('https://evil.example', 'url', options)).toMatchObject({ ok: false });
    expect(await resolveTerminalLink('src/a.ts', 'file', { ...options, isFile: async () => false })).toMatchObject({ ok: false });
    expect(await resolveTerminalLink('src/a.ts', 'file', { ...options, cwd: null })).toMatchObject({ ok: false });
  });
});

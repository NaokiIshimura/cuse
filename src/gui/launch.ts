/*
 * 写し元: cc-park `src/gui/launch.ts` @ `d1f0f2d`（v0.25.0）の
 * `buildGuiEnv` / `resolveElectronPath` / `ELECTRON_MISSING_MESSAGE` だけを写した。
 * cc-park 固有のオプション（テーマ・ミニ表示など）の受け渡しは cuse には無いので写していない。
 */

/** electron パッケージが見つからないときの案内。 */
export const ELECTRON_MISSING_MESSAGE = [
  'cuse app を起動できませんでした: electron が見つかりません。',
  'npm install をやり直してください。',
].join('\n');

/**
 * Electron へ渡す環境変数。
 *
 * `ELECTRON_RUN_AS_NODE` が残っていると Electron が Node として動き、ウィンドウが開かない。
 * VS Code の端末などはこれを立てたまま子プロセスを起こすので、必ず外す。
 */
export const buildGuiEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const next = { ...env };
  delete next['ELECTRON_RUN_AS_NODE'];
  return next;
};

/**
 * electron パッケージの読み込み。
 *
 * 既定値を持たせると「electron を実際に読み込む」以外に検証しようがない分岐が
 * 増えるため、`() => import('electron')` の指定は呼び出し側（cli.ts）に置く。
 */
export type ElectronImporter = () => Promise<unknown>;

/** electron パッケージが返す実行ファイルのパスを取り出す。見つからなければ null。 */
export const resolveElectronPath = async (
  importer: ElectronImporter,
): Promise<string | null> => {
  let loaded: unknown;
  try {
    loaded = await importer();
  } catch {
    return null;
  }

  const path = (loaded as { readonly default?: unknown } | null)?.default;
  return typeof path === 'string' && path !== '' ? path : null;
};

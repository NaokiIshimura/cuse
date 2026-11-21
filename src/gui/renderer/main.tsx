import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

/**
 * renderer のエントリ。
 *
 * 起動時の環境（Claude Code のバージョン確認など）が揃ってから描画すると
 * App 側に読み込み状態を持たせずに済むため、それだけを待ってからマウントする。
 */
const environment = await window.cuse.getEnvironment();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root が見つかりません');
}

createRoot(container).render(
  <StrictMode>
    <App environment={environment} bridge={window.cuse} />
  </StrictMode>,
);

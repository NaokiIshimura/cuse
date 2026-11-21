import type { CuseBridge } from '../ipc.js';

declare global {
  interface Window {
    /** preload が公開する main プロセスへの橋渡し */
    readonly cuse: CuseBridge;
  }
}

/** Electron の <webview>。右のプレビューの Web 表示に使う（main が will-attach-webview で隔離する）。 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
      };
    }
  }
}

export {};

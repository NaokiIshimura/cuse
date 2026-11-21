import type { CuseBridge } from '../ipc.js';

declare global {
  interface Window {
    /** preload が公開する main プロセスへの橋渡し */
    readonly cuse: CuseBridge;
  }
}

export {};

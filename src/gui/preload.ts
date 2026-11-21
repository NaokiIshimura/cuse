import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type CuseBridge } from './ipc.js';

/**
 * renderer へ公開する API。
 * ロジックは持たせず、IPC の呼び出しへ 1:1 で対応させる。
 */
const bridge: CuseBridge = {
  getEnvironment: () => ipcRenderer.invoke(IPC_CHANNELS.getEnvironment),
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
};

contextBridge.exposeInMainWorld('cuse', bridge);

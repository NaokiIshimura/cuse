import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_CHANNELS,
  type CuseBridge,
  type OpenTerminalRequest,
  type OpenTrustTerminalRequest,
} from './ipc.js';

/**
 * renderer へ公開する API。
 * ロジックは持たせず、IPC の呼び出しへ 1:1 で対応させる。
 */
const bridge: CuseBridge = {
  getEnvironment: () => ipcRenderer.invoke(IPC_CHANNELS.getEnvironment),
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  openTerminal: (request: OpenTerminalRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.openTerminal, request),
  writeTerminal: (tabId: string, data: string) => {
    ipcRenderer.send(IPC_CHANNELS.writeTerminal, tabId, data);
  },
  resizeTerminal: (tabId: string, cols: number, rows: number) => {
    ipcRenderer.send(IPC_CHANNELS.resizeTerminal, tabId, cols, rows);
  },
  closeTerminal: (tabId: string) => {
    ipcRenderer.send(IPC_CHANNELS.closeTerminal, tabId);
  },
  onTerminalData: (listener) => {
    const handler = (_event: IpcRendererEvent, tabId: string, data: string) => {
      listener(tabId, data);
    };
    ipcRenderer.on(IPC_CHANNELS.terminalData, handler);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.terminalData, handler);
    };
  },
  onTerminalExit: (listener) => {
    const handler = (_event: IpcRendererEvent, tabId: string, exitCode: number) => {
      listener(tabId, exitCode);
    };
    ipcRenderer.on(IPC_CHANNELS.terminalExit, handler);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.terminalExit, handler);
    };
  },
  stopWorker: (sessionId: string, reason: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.stopWorker, sessionId, reason),
  ensureLeader: () => ipcRenderer.invoke(IPC_CHANNELS.ensureLeader),
  chooseLeaderFolder: () => ipcRenderer.invoke(IPC_CHANNELS.chooseLeaderFolder),
  openTrustTerminal: (request: OpenTrustTerminalRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.openTrustTerminal, request),
};

contextBridge.exposeInMainWorld('cuse', bridge);

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workbenchDesktop", {
  isDesktop: true,
  notifyFocusComplete(minutes) {
    return ipcRenderer.invoke("workbench:focus-complete", minutes);
  },
  onNavigate(callback) {
    const handler = (_event, destination) => callback(destination);
    ipcRenderer.on("workbench:navigate", handler);
    return () => ipcRenderer.removeListener("workbench:navigate", handler);
  },
  backupNow() {
    return ipcRenderer.invoke("workbench:backup-now");
  },
  backupList() {
    return ipcRenderer.invoke("workbench:backup-list");
  },
  backupRestore(backupId) {
    return ipcRenderer.invoke("workbench:backup-restore", backupId);
  },
  backupDelete(backupId) {
    return ipcRenderer.invoke("workbench:backup-delete", backupId);
  },
});

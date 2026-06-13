const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    // Main → Renderer : initialisation de la fenêtre
    onInitAlphaEss: (callback) => ipcRenderer.on('onInit-alphaEss', (_event, value) => callback(value)),
    // Renderer → Main (bidirectionnel) : récupère les données en temps réel
    getData: () => ipcRenderer.invoke('alphaEss-getData'),
    // Renderer → Main (unidirectionnel) : ferme la fenêtre
    quit: () => ipcRenderer.send('alphaEss-quit')
})

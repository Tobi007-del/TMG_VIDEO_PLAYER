const { app, BrowserWindow, session } = require("electron"),
  path = require("path");

app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

function createWindow() {
  const isDev = process.argv.includes("--dev"),
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      title: "TMG Video Player",
      autoHideMenuBar: true,
      icon: path.join(__dirname, isDev ? 'public/favicon.ico' : 'build/favicon.ico'),
      webPreferences: { nodeIntegration: false, contextIsolation: false, webSecurity: false },
    });

  if (isDev) return mainWindow.loadURL('http://localhost:5173'), mainWindow.webContents.openDevTools();
  mainWindow.loadFile(path.join(__dirname, 'build/index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: { ...details.responseHeaders, "Cross-Origin-Embedder-Policy": ["credentialless"], "Cross-Origin-Opener-Policy": ["same-origin"] },
    })
  );

  createWindow();
  app.on("activate", () => !BrowserWindow.getAllWindows().length && createWindow());
});

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());

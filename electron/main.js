const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let mainWindow;
let pythonProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#0f0f0f',
    show: false,
  });

  const isDev = process.env.NODE_ENV !== 'production';
  const loadPromise = isDev
    ? mainWindow.loadURL('http://localhost:5173')
    : mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));

  loadPromise
    .then(() => {
      windowShown = true;
      mainWindow.show();
      if (isDev) mainWindow.webContents.openDevTools();
    })
    .catch((err) => {
      console.error('Load failed:', err);
      mainWindow.show();
    });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function startPythonBackend() {
  const scriptPath = path.join(__dirname, '../backend/server.py');
  pythonProcess = spawn('python', [scriptPath], { cwd: path.join(__dirname, '../backend') });
  pythonProcess.stdout.on('data', (d) => console.log('[Python]', d.toString()));
  pythonProcess.stderr.on('data', (d) => console.error('[Python]', d.toString()));
}

function checkPort(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const s = net.createServer();
    s.once('error', (e) => resolve(e.code === 'EADDRINUSE'));
    s.once('listening', () => { s.close(); resolve(false); });
    s.listen(port);
  });
}

function waitForBackend() {
  return new Promise((resolve) => {
    const check = () => {
      const http = require('http');
      http.get('http://127.0.0.1:8000/status', (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(check, 1000);
      }).on('error', () => setTimeout(check, 1000));
    };
    check();
  });
}

let windowShown = false;

app.whenReady().then(() => {
  checkPort(8000).then((taken) => {
    if (!taken) startPythonBackend();
    setTimeout(() => waitForBackend().then(createWindow), 1000);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && windowShown) app.quit();
});

app.on('will-quit', () => {
  if (pythonProcess) {
    if (process.platform === 'win32') {
      try { require('child_process').execSync(`taskkill /pid ${pythonProcess.pid} /f /t`); } catch (e) {}
    } else {
      pythonProcess.kill('SIGKILL');
    }
  }
});

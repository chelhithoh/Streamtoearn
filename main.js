const { app, BrowserWindow, ipcMain, shell, MessageChannelMain, globalShortcut, dialog  } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { registerMinecraftIpcEvents } = require("./minecraft/ipcEvents");
const { registerTTLiveEvents } = require("./tiktoklive/ttIpcEvents");
const { registerWebConnectorEvents } = require("./webConnector");
const { registerHttpBridge } = require("./httpBridge/httpBridge");
const { registerFileWriter } = require("./fileWriter/fileWriter");
const { registerWebServer } = require("./webServer/webServer");
const { registerGTA5PluginManagerEvents } = require("./games/gta5");
const { registerWitcher3PluginEvents } = require("./games/witcher3");
const { registerfilesSystemManager } = require("./functions/files-system");
const { registerDeleteMods } = require("./delete-mod/delete-mod");
// const { startOverlayServer } = require("./overlays-server/server");
const { type } = require('node:os');
const { exec } = require('child_process');
const {WebcastPushConnection} = require("tiktok-live-connector");
app.disableHardwareAcceleration();

const dns = require('dns');
// const robot = require('robotjs');
const {killMinecraftServerProcess} = require("./minecraft/minecraft");
const {registerKeyboardEventHandler} = require("./keyboard/KeyboardSimulator");
const {registerRconEventHandler} = require("./rcon/rcon");
const {registerPluginManagerEvents} = require("./games/mod-installer");
const {registerWebSoket} = require("./socket/socketConnector");

// const {registerKeyboardEventHandler} = require("./keyboard/KeyboardSimulator");

// Глобальные переменные для Minecraft сервера
global.minecraftServerPath = null;
global.minecraftServerXmx = null;
global.minecraftServerXms = null;

// Инициализация глобальных переменных для WebSocket
global.socketConnectionInfo = {
    isConnected: false,
    isLauncher: false,
    clientInfo: null,
    launcherInfo: null,
    connectedAt: null
};
global.s4eLauncherSocket = null;

async function setupUpdates(retry = false) {
  const updateUrl = 'https://d1jl7r3beoolrj.cloudfront.net/electron-app';

  if (!retry) {
    const isInternetConnected = await checkInternetConnection();
    if (!isInternetConnected) {
      console.error('No internet connection');
      createErrorWindow(); // Открываем окно ошибки, если нет интернета
      return;
    }
  } else {
    createWindow();
  }

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: updateUrl
  });

  if (!app.isPackaged) {
    createWindow();
    return;  // Прервать выполнение функции setupUpdates, если это режим разработки
  }

  autoUpdater.on('update-available', () => {
    createLoadingWindow();  // Откройте окно загрузки
    sendStatusToWindow('Update. Downloading...');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendProgressToWindow(progress.percent);
  });

  autoUpdater.on('update-downloaded', () => {
    sendStatusToWindow('Downloaded. Restarting...');
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('update-not-available', () => {
    console.log('update-not-available!!!')
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      createNoteWindow();
    } else {
      createWindow();
    }
  });

  autoUpdater.on('error', (error) => {
    sendStatusToWindow(`Error in auto-updater: ${error}`);
    closeLoadingWindow();
    createErrorWindow();
  });

  autoUpdater.checkForUpdates().then(upadteResult => {
    if(!upadteResult){
      createErrorWindow();
    }
  });
}

function checkInternetConnection() {
  return new Promise((resolve) => {
    dns.lookup('google.com', (err) => {
      if (err && err.code === "ENOTFOUND") {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}


function sendStatusToWindow(text) {
  loadingWin.webContents.send('update-status', text);
}

function sendProgressToWindow(value) {
  loadingWin.webContents.send('update-progress', Math.floor(value));
}



let loadingWin;

function createLoadingWindow() {
  loadingWin = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  loadingWin.loadFile(path.join(__dirname, 'preload.html'));  // Указать путь к вашему HTML файлу загрузки
}


function createErrorWindow() {
  appErrorWin = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  appErrorWin.loadFile(path.join(__dirname, 'error.html'));  // Указать путь к вашему HTML файлу загрузки
}

function createNoteWindow() {
  loadingWin = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  loadingWin.loadFile(path.join(__dirname, 'second-window.html'));  // Указать путь к вашему HTML файлу загрузки
}

function closeLoadingWindow() {
  if (loadingWin) {
    loadingWin.close();
    loadingWin = null;
  }
}

// console.log('app.whenReady');
app.whenReady().then(setupUpdates).then( async ()=>{
    // Регистрируем горячие клавиши Alt + 0 до Alt + 9
    registerAltHotkeys();
    globalShortcut.register('Alt+CommandOrControl+I', () => {
      win.webContents.openDevTools()
    })
});

let win;
// const angularPath = process.env.ANGULAR_PATH || path.resolve(__dirname, '..', 'angular', 'dist', 'streamwarps-client');
const currentPath = __dirname;
const angularPath = path.resolve(currentPath, '..', 'dist', 'streamwarps-client');
// console.log(angularPath,'---------------')

function createWindow() {
  // Create the browser window.
  win = new BrowserWindow({
    width: 1400,
    height: 1000,
    webPreferences: {
      // preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      // webSecurity: false,
      allowRunningInsecureContent: true,
      // webSecurity: false,
    }
  })

  win.setMenu(null);


  win.loadURL(`https://app.streamtoearn.io`);
  //win.loadURL(`http://localhost:4200`);
  //win.webContents.reloadIgnoringCache();


  // startOverlayServer(55000);

  // uncomment below to open the DevTools.
  // win.webContents.openDevTools()

  // Event when the window is closed.
  win.on('closed', function () {
    win = null
  })

  win.on('close', function (cevent) {
      killMinecraftServerProcess();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const googleAccountsRegex = /^(https?:\/\/)?(www\.)?(accounts\.google\.com)/i;
    const kickOAuthRegex = /^(https?:\/\/)?(id\.)?(kick\.com\/oauth|kick\.com\/api\/v1\/oauth)/i;

    if (googleAccountsRegex.test(url) || kickOAuthRegex.test(url)) {
      return { action: 'allow' };
    } else {
      if(!url.startsWith("bytedance://")) {
        shell.openExternal(url).catch(() => {
          console.warn("shell.openExternal try start");
          exec(`start "" "${url}"`);
        });
      }
      return { action: 'deny' };
    }
  });
}


let lastDigitPressed = null;



function registerAltHotkeys() {
  // Регистрируем клавиши Alt + 0-9
  for (let i = 0; i <= 9; i++) {
    const accelerator = `Alt+${i}`;
    globalShortcut.register(accelerator, () => {
      const lastDigitPressed = i;
      win.webContents.send('lastDigitPressed', lastDigitPressed);
    });
  }

  // Регистрируем клавиши Alt + Num0-Num9
  for (let i = 0; i <= 9; i++) {
    const accelerator = `Alt+Num${i}`;
    globalShortcut.register(accelerator, () => {
      const lastDigitPressed = i;
      win.webContents.send('lastDigitPressed', lastDigitPressed);
    });
  }

  // Регистрируем клавиши Alt + -
  globalShortcut.register('Alt+-', () => {
    onLose();
  });

  // Регистрируем клавиши Alt + =
  globalShortcut.register('Alt+=', () => {
    onWin();
  });
}

// Выводим последнюю нажатую цифру в консоль
ipcMain.on('getLastDigitPressed', (event) => {
  console.log('getLastDigitPressed', lastDigitPressed)
  // event.reply('lastDigitPressed', lastDigitPressed);
});

ipcMain.on('retry-update', () => {
  console.log('retry-update')
  setupUpdates(true); // Повторный вызов функции setupUpdates
  appErrorWin.close()
});


ipcMain.on('getJavaVersion', (event) => {
  function getJavaVersion(callback) {
    var spawn = require('child_process').spawn('java', ['-version']);
    var javaVersionReceived = false;

    spawn.on('error', function (err) {
      callback(err, null);
    });

    spawn.stderr.on('data', function (data) {
      if (!javaVersionReceived) {
        data = data.toString().split('\n')[0];
        var javaVersion = new RegExp('(java|openjdk) version').test(data) ? data.split(' ')[2].replace(/"/g, '') : false;
        if (javaVersion) {
          javaVersionReceived = true;
          callback(null, javaVersion);
          spawn.kill(); // Закрыть процесс после получения версии
        }
      }
    });

    spawn.on('exit', function (code) {
      if (code !== 0 && !javaVersionReceived) {
        callback(new Error(`Java process exited with code ${code}`), null);
      }
    });
  }


  getJavaVersion((error, javaVersion) => {
    if (error) {
      // console.error('Error getting Java version:', error);
      event.reply('getJavaVersion', null);
    } else {
      // console.log('Java Version:', javaVersion);
      event.reply('getJavaVersion', javaVersion);
    }
  });
});

registerMinecraftIpcEvents();
registerTTLiveEvents();
registerHttpBridge();
registerFileWriter();
registerWebServer();
registerWebConnectorEvents();
registerGTA5PluginManagerEvents();
registerfilesSystemManager();
registerWitcher3PluginEvents();
// registerKeyboardEventHandler();
registerRconEventHandler();
registerKeyboardEventHandler();
registerDeleteMods();
registerPluginManagerEvents();
registerWebSoket(onWin, onLose);

// Kick OAuth handler
ipcMain.on('openKickOAuth', (event, { url, userId, state }) => {
  // Логуємо URL для діагностики
  // console.log('Kick OAuth - Opening window with URL:', url);
  // console.log('Kick OAuth - URL length:', url?.length);
  // console.log('Kick OAuth - Has scope in URL:', url?.includes('scope'));

  // Перевіряємо scope в URL
  try {
    const urlObj = new URL(url);
    const scopeParam = urlObj.searchParams.get('scope');
    // console.log('Kick OAuth - Scope from URL:', scopeParam ? 'PRESENT' : 'MISSING', {
    //   length: scopeParam?.length || 0,
    //   value: scopeParam?.substring(0, 50) || 'empty'
    // });

    if (!scopeParam || scopeParam.trim() === '') {
      console.error('CRITICAL: Scope is empty in OAuth URL!', { url });
    }
  } catch (err) {
    console.error('Error parsing OAuth URL:', err);
  }

  const authWindow = new BrowserWindow({
    width: 600,
    height: 700,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  authWindow.setTitle('Kick OAuth');
  authWindow.loadURL(url);

  let callbackHandled = false;

  function tryHandleCallback(navigationUrl, source) {
    if (callbackHandled) return false;
    try {
      const urlObj = new URL(navigationUrl);

      // Проверяем, что URL содержит streamtoearn (это наш redirect_uri для Kick OAuth)
      // Это предотвращает перехват других OAuth callbacks (например, Google)
      if (!navigationUrl.toLowerCase().includes('streamtoearn')) {
        return false; // Это не наш callback, игнорируем
      }

      const hasCode = urlObj.searchParams.has('code');
      const receivedState = urlObj.searchParams.get('state');
      if (hasCode) {
        const code = urlObj.searchParams.get('code');
        if (!receivedState) {
          console.warn('Kick OAuth: state missing on callback (' + source + '), but will be handled by server');
        }
        // Убираем проверку state на клиенте - проверка должна происходить на сервере
        // где state сохранен в базе данных для пользователя
        // Сервер может найти state по userId, если он не передан
        callbackHandled = true;
        authWindow.close();
        event.reply('kickOAuthCallback', { success: true, code, state: receivedState || state });
        return true;
      }
      if (urlObj.searchParams.has('error')) {
        const error = urlObj.searchParams.get('error');
        callbackHandled = true;
        authWindow.close();
        event.reply('kickOAuthCallback', { error: `Kick OAuth error: ${error}` });
        return true;
      }
    } catch (e) {
      console.error('Kick OAuth: parse error (' + source + '):', e);
    }
    return false;
  }

  // Перехоплюємо всі можливі сценарії редиректів
  authWindow.webContents.on('will-navigate', (navigationEvent, navigationUrl) => {
    if (tryHandleCallback(navigationUrl, 'will-navigate')) {
      navigationEvent.preventDefault();
    }
  });

  authWindow.webContents.on('will-redirect', (_event, urlTo, _isInPlace, _isMainFrame, _frameProcessId, _frameRoutingId) => {
    tryHandleCallback(urlTo, 'will-redirect');
  });

  authWindow.webContents.on('did-redirect-navigation', (_event, urlTo) => {
    tryHandleCallback(urlTo, 'did-redirect-navigation');
  });

  authWindow.webContents.on('did-navigate', (_event, urlTo) => {
    tryHandleCallback(urlTo, 'did-navigate');
  });

  authWindow.webContents.on('did-navigate-in-page', (_event, urlTo) => {
    tryHandleCallback(urlTo, 'did-navigate-in-page');
  });

  // Також перевіряємо URL після завантаження сторінки
  authWindow.webContents.on('did-finish-load', () => {
    const currentUrl = authWindow.webContents.getURL();
    tryHandleCallback(currentUrl, 'did-finish-load');
  });

  authWindow.on('closed', () => {
    // Якщо вікно закрито без callback, відправляємо подію для прибирання spinner
    if (!callbackHandled && win && !win.isDestroyed()) {
      win.webContents.send('kickOAuthWindowClosed');
    }
  });
});

ipcMain.on('getElectronVersion', (event) => {
  // console.log('getElectronVersion: ', app.getVersion())
  event.reply('electronVersionReply', app.getVersion());
});

ipcMain.on('getElectronVersion', (event) => {
  // console.log('getElectronVersion: ', app.getVersion())
  event.reply('electronVersionReply', app.getVersion());
});

ipcMain.on('getRoomInfo', (event, args) => {
  const { username } = args;
  const tiktokLiveConnection = new WebcastPushConnection(username);

  tiktokLiveConnection.fetchRoomInfo().then(roomInfo => {
    console.log('roomInfo: ', roomInfo);
    event.reply('getRoomInfo', roomInfo);
  }).catch(err => {
    console.error(err);
  })
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On macOS specific close process
  if (process.platform !== 'darwin') {
    app.quit()
  }
  killMinecraftServerProcess();
})

app.on('activate', function () {
  // macOS specific close process
  if (win === null) {
    createWindow()
  }
})

function onWin() {
  const lastDigitPressed = '=';
  win.webContents.send('lastDigitPressed', lastDigitPressed);
}

function onLose() {
  const lastDigitPressed = '-';
  win.webContents.send('lastDigitPressed', lastDigitPressed);
}

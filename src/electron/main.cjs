const { app, BrowserWindow, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')

const appRoot = app.isPackaged ? process.resourcesPath + '/app.asar' : join(__dirname, '../..')

let apiServer
let mainWindow

function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true

  autoUpdater.on('update-downloaded', () => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      buttons: ['立即重启更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '发现新版本',
      message: '新版本已下载完成，重启应用后即可完成更新。'
    })

    if (choice === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  autoUpdater.on('error', (error) => {
    console.error('auto update error:', error)
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 960,
    minHeight: 700,
    title: 'lolmasite',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    const address = apiServer?.address()
    await mainWindow.loadURL(`http://127.0.0.1:${address?.port ?? 4177}`)
  }
}

app.whenReady().then(async () => {
  setupAutoUpdater()

  const { startApiServer } = await import(pathToFileURL(join(appRoot, 'dist/main/index.js')).href)
  apiServer = await startApiServer(process.env.VITE_DEV_SERVER_URL ? 4177 : 0, join(appRoot, 'dist/renderer'))
  await createWindow()

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  apiServer?.close()
})

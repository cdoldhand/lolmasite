import electron from 'electron'
import { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Server } from 'node:http'
import { startApiServer } from '../main/index.js'

const { app, BrowserWindow } = electron as unknown as typeof import('electron')
const __dirname = dirname(fileURLToPath(import.meta.url))
let apiServer: Server | undefined
let mainWindow: InstanceType<typeof BrowserWindow> | undefined

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
    const address = apiServer?.address() as AddressInfo | null
    await mainWindow.loadURL(`http://127.0.0.1:${address?.port ?? 4177}`)
  }
}

app.whenReady().then(async () => {
  apiServer = await startApiServer(process.env.VITE_DEV_SERVER_URL ? 4177 : 0, join(__dirname, '../renderer'))
  await createWindow()

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

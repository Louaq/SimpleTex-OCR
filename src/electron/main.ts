import { app, BrowserWindow, ipcMain, dialog, clipboard, globalShortcut, screen, nativeImage, desktopCapturer } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import Store from 'electron-store';
import { ScreenshotArea } from '../types';
import { getCurrentTimestamp } from '../utils/api';
import * as crypto from 'crypto';

// 设置控制台编码为UTF-8，解决中文乱码问题
if (process.platform === 'win32') {
  try {
    // 尝试设置控制台代码页为65001 (UTF-8)
    const { execSync } = require('child_process');
    execSync('chcp 65001', { windowsHide: true });
    console.log('Console code page set to UTF-8 (65001)');
  } catch (error) {
    console.error('Failed to set console code page:', error);
  }
}

// 创建自定义日志函数，确保中文正确显示
const logger = {
  log: (message: string, ...args: any[]) => {
    // 在Windows环境下，确保日志正确显示
    if (process.platform === 'win32') {
      // 如果消息包含中文，添加UTF-8 BOM标记
      if (/[\u4e00-\u9fa5]/.test(message)) {
        console.log('\ufeff' + message, ...args);
      } else {
        console.log(message, ...args);
      }
    } else {
      console.log(message, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    if (process.platform === 'win32') {
      if (/[\u4e00-\u9fa5]/.test(message)) {
        console.error('\ufeff' + message, ...args);
      } else {
        console.error(message, ...args);
      }
    } else {
      console.error(message, ...args);
    }
  }
};

// 定义API配置读取函数
function loadApiConfigFromSettings(): { appId: string; appSecret: string } {
  const config = {
    appId: '',
    appSecret: ''
  };
  
  try {
    // 尝试读取settings.json文件
    const settingsPath = path.join(app.getAppPath(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settingsContent = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(settingsContent);
      if (settings.app_id && settings.app_secret) {
        config.appId = settings.app_id;
        config.appSecret = settings.app_secret;
        logger.log('成功从settings.json加载API配置');
      } else {
        logger.log('settings.json中未找到有效的API配置');
      }
    } else {
      logger.log('未找到settings.json文件，将使用空的API配置');
    }
  } catch (error) {
    logger.error('读取settings.json文件失败:', error);
  }
  
  return config;
}

// 定义应用设置类型
interface AppSettings {
  apiConfig: ApiConfig;
  shortcuts: {
    capture: string;
    upload: string;
  };
  history: HistoryItem[];
}

// 定义API配置类型
interface ApiConfig {
  appId: string;
  appSecret: string;
  endpoint: string;
}

// 定义历史记录项类型
interface HistoryItem {
  latex: string;
  date: string;
}

// 定义API响应类型
interface SimpletexResponse {
  status: boolean;
  res: {
    latex: string;
    conf: number;
  };
  request_id: string;
  message?: string;
  error_code?: string;
}

// 初始默认API配置
let DEFAULT_API_CONFIG: ApiConfig = {
  appId: '',
  appSecret: '',
  endpoint: 'https://server.simpletex.cn/api/latex_ocr'
};

// 临时文件前缀
const TEMP_FILE_PREFIX = 'simpletex-';
const SCREENSHOT_PREFIX = 'screenshot-';

// 存储临时文件路径
const tempFiles = new Set<string>();

// 存储定期清理的定时器ID
let cleanupIntervalId: NodeJS.Timeout | null = null;

// 检测开发环境
const isDevelopment = process.env.NODE_ENV === 'development';

// Electron环境专用的API签名生成函数
function getReqData(reqData: Record<string, any> = {}, apiConfig: ApiConfig) {
  const header: Record<string, string> = {};
  header.timestamp = Math.floor(Date.now() / 1000).toString();
  header['random-str'] = randomStr(16);
  header['app-id'] = apiConfig.appId;

  // 构建签名字符串
  const params: string[] = [];
  
  // 添加请求参数
  const sortedReqKeys = Object.keys(reqData).sort();
  for (const key of sortedReqKeys) {
    params.push(`${key}=${reqData[key]}`);
  }
  
  // 添加头部参数
  const headerKeys = ['app-id', 'random-str', 'timestamp'];
  for (const key of headerKeys) {
    params.push(`${key}=${header[key]}`);
  }
  
  // 添加密钥
  params.push(`secret=${apiConfig.appSecret}`);
  
  // 生成签名
  const preSignString = params.join('&');
  header.sign = crypto.createHash('md5').update(preSignString).digest('hex');
  
  return { header, reqData };
}

// 生成随机字符串
function randomStr(length: number = 16): string {
  const chars = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 临时文件管理函数
function addTempFile(filePath: string): void {
  tempFiles.add(filePath);
  console.log(`Added temporary file to management list: ${filePath}`);
}

function removeTempFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted temporary file: ${filePath}`);
    }
    tempFiles.delete(filePath);
    return true;
  } catch (error) {
    console.error(`Failed to delete temporary file: ${filePath}`, error);
    return false;
  }
}

function cleanupAllTempFiles(): void {
  console.log(`Starting cleanup of ${tempFiles.size} temporary files...`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const filePath of tempFiles) {
    if (removeTempFile(filePath)) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  // 额外清理：扫描临时目录中的旧文件
  try {
    const tempDir = app.getPath('temp');
    const files = fs.readdirSync(tempDir);
    
    for (const file of files) {
      if (file.startsWith(TEMP_FILE_PREFIX)) {
        const fullPath = path.join(tempDir, file);
        try {
          const stats = fs.statSync(fullPath);
          const fileAge = Date.now() - stats.mtime.getTime();
          
          // 删除超过1小时的临时文件
          if (fileAge > 60 * 60 * 1000) {
            fs.unlinkSync(fullPath);
            console.log(`Deleted expired temporary file: ${fullPath}`);
          }
        } catch (error) {
          console.error(`Error processing temporary file: ${fullPath}`, error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to scan temporary directory:', error);
  }
  
  console.log(`Temporary files cleanup completed: Success ${successCount}, Fail ${failCount}`);
  tempFiles.clear();
}

// 定期清理临时文件（每30分钟）
function startPeriodicCleanup(): void {
  // 清除之前的定时器（如果存在）
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
  }
  
  cleanupIntervalId = setInterval(() => {
    console.log('Executing periodic temporary file cleanup...');
    cleanupAllTempFiles();
  }, 30 * 60 * 1000); // 30 minutes
}

// 存储管理
const store = new Store<AppSettings>({
  defaults: {
    apiConfig: DEFAULT_API_CONFIG,
    shortcuts: {
      capture: 'Alt+C',
      upload: 'Alt+U'
    },
    history: []
  }
});

let mainWindow: BrowserWindow | null = null;

// 创建主窗口
async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 830,
    height: 715,
    minWidth: 700,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    title: 'SimpleTex OCR - 数学公式识别工具',
    show: false,
    // 禁用系统菜单栏
    autoHideMenuBar: true
  });

  // 完全移除菜单栏
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  // 开发模式下加载本地服务器，生产模式下加载打包后的文件
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    try {
      await mainWindow.loadURL('http://localhost:3000');
      mainWindow.webContents.openDevTools();
    } catch (error) {
      console.error('Failed to load dev server, falling back to build:', error);
      // 从 dist/electron/electron/ 回到项目根目录的 build 文件夹
      mainWindow.loadFile(path.join(__dirname, '../../../build/index.html'));
    }
  } else {
    // 从 dist/electron/electron/ 回到项目根目录的 build 文件夹
    mainWindow.loadFile(path.join(__dirname, '../../../build/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 监听窗口关闭事件
  mainWindow.on('closed', () => {
    mainWindow = null;
    
    // 在非开发模式下，窗口关闭时强制退出应用
    if (!isDev && process.platform === 'win32') {
      forceQuitApp();
    }
  });
  
  // 监听窗口关闭请求
  mainWindow.on('close', (event) => {
    
    // 在非开发模式下，确保应用完全退出
    if (!isDev && process.platform === 'win32') {
      event.preventDefault(); // 阻止默认关闭行为
      forceQuitApp();
    }
  });
}

// 存储多个截图窗口
const screenshotWindows: BrowserWindow[] = [];

// ===== 简化截图系统 =====

// 重写简单的截图系统
function createSimpleScreenshotWindow(): void {
  try {
    // 清理现有窗口
    screenshotWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.close();
      }
    });
    screenshotWindows.length = 0;

    const displays = screen.getAllDisplays();

    // 为每个显示器创建独立的截图窗口
    displays.forEach((display, index) => {
      
      const screenshotWindow = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        }
      });

      const screenshotHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: rgba(0, 0, 0, 0.1);
      cursor: crosshair;
      user-select: none;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }
    .selection-box {
      position: absolute;
      border: 2px solid #007bff;
      background: rgba(0, 123, 255, 0.1);
      pointer-events: none;
    }
    .info {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      font-family: Arial, sans-serif;
      z-index: 9999;
    }
  </style>
</head>
<body>
  <div class="info">拖拽选择截图区域 | ESC取消 | 显示器 ${index + 1}</div>
  <script>
    // 此窗口对应的显示器信息
    const displayBounds = {
      x: ${display.bounds.x},
      y: ${display.bounds.y},
      width: ${display.bounds.width},
      height: ${display.bounds.height}
    };
    
    let isSelecting = false;
    let startX, startY;
    let selectionBox = null;
    
    console.log('Screenshot window loaded for display ${index}:', displayBounds);
    
    document.addEventListener('mousedown', (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
      
      console.log('🖱️ Mouse down on display ${index} at window coords:', { x: startX, y: startY });
      console.log('🌍 Will become absolute coords:', { 
        x: startX + displayBounds.x, 
        y: startY + displayBounds.y 
      });
      
      if (selectionBox) selectionBox.remove();
      
      selectionBox = document.createElement('div');
      selectionBox.className = 'selection-box';
      selectionBox.style.left = startX + 'px';
      selectionBox.style.top = startY + 'px';
      document.body.appendChild(selectionBox);
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isSelecting || !selectionBox) return;
      
      const left = Math.min(startX, e.clientX);
      const top = Math.min(startY, e.clientY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);
      
      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';
    });
    
    document.addEventListener('mouseup', async (e) => {
      if (!isSelecting || !selectionBox) return;
      
      const left = Math.min(startX, e.clientX);
      const top = Math.min(startY, e.clientY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);
      
      // 清理选择框
      if (selectionBox) {
        selectionBox.remove();
        selectionBox = null;
      }
      isSelecting = false;
      
      if (width > 10 && height > 10) {
        // 转换为绝对屏幕坐标
        const absoluteArea = {
          x: left + displayBounds.x,
          y: top + displayBounds.y,
          width: width,
          height: height
        };
        
        console.log('Window coords:', { x: left, y: top, width, height });
        console.log('Display bounds:', displayBounds);
        console.log('Absolute coords:', absoluteArea);
        
        try {
          await window.screenshotAPI.takeSimpleScreenshot(absoluteArea);
        } catch (error) {
          console.error('Screenshot failed:', error);
        }
      }
      
      await window.screenshotAPI.closeScreenshotWindow();
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        console.log('ESC键被按下，关闭截图窗口');
        try {
          window.screenshotAPI.closeScreenshotWindow();
          console.log('截图窗口关闭请求已发送');
        } catch (error) {
          console.error('关闭截图窗口时出错:', error);
        }
      }
    });
  </script>
</body>
</html>`;
      
      screenshotWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(screenshotHTML)}`);
      screenshotWindows.push(screenshotWindow);
      
    });
    
    
  } catch (error) {
  }
}

// 显示截图窗口
function showSimpleScreenshotOverlay(): void {
  if (screenshotWindows.length === 0) {
    createSimpleScreenshotWindow();
  }
  // 显示所有截图窗口
  screenshotWindows.forEach((window, index) => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });
}

// 删除其他复杂的截图函数
function createUnifiedScreenshotWindow(): void {
  createSimpleScreenshotWindow();
}

function showUnifiedScreenshotOverlay(): void {
  showSimpleScreenshotOverlay();
}

// 重新设计截图窗口创建 - 作为备用方案
function createScreenshotWindows(): void {
  // 现在默认使用简单窗口方案
  createSimpleScreenshotWindow();
}

// 禁用硬件加速以解决GPU问题
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
  
  // 禁用GPU进程
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  
  // 禁用持久化缓存，避免后台进程
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

// 设置用户数据目录以解决权限问题
app.setPath('userData', path.join(app.getPath('appData'), 'SimpleTex-OCR'));

// 确保只有一个实例在运行
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.exit(0);
} else {
  // 当第二个实例启动时，聚焦到第一个实例的窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
  
  // 应用程序就绪时
  app.whenReady().then(async () => {
    // 检查并创建默认的settings.json文件
    const settingsPath = path.join(app.getAppPath(), 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      try {
        // 创建默认的settings.json文件
        const defaultSettings = {
          app_id: '',
          app_secret: ''
        };
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf8');
        logger.log('已创建默认的settings.json文件');
      } catch (error) {
        logger.error('创建默认settings.json文件失败:', error);
      }
    }
    
    // 加载API配置
    const apiConfig = loadApiConfigFromSettings();
          logger.log('从settings.json加载的API配置:', apiConfig);
    
    // 如果配置有效，则更新默认配置
    if (apiConfig.appId && apiConfig.appSecret) {
      DEFAULT_API_CONFIG.appId = apiConfig.appId;
      DEFAULT_API_CONFIG.appSecret = apiConfig.appSecret;
      logger.log('已更新默认API配置');
    } else {
      logger.log('settings.json中的API配置无效或为空，不使用任何默认配置');
      // 确保API配置为空
      DEFAULT_API_CONFIG.appId = '';
      DEFAULT_API_CONFIG.appSecret = '';
    }
    
    // 初始化存储
    store.set('apiConfig', DEFAULT_API_CONFIG);
    
    // 测试日志输出，确认编码设置正常
    logger.log('应用启动 - 中文日志测试');
    logger.log('Application started - English log test');
    
    killZombieProcesses();
    await createMainWindow();
    registerGlobalShortcuts();
    cleanupAllTempFiles();
    startPeriodicCleanup();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });
}

// 所有窗口关闭时
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 在Windows平台上强制退出应用
    forceQuitApp();
  }
});

// 应用退出前清理
app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  
  // 关闭所有截图窗口
  screenshotWindows.forEach(window => {
    if (!window.isDestroyed()) {
      window.removeAllListeners();
      window.close();
    }
  });
  screenshotWindows.length = 0;

  cleanupAllTempFiles();
  
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// 应用退出时的最终清理
app.on('will-quit', (event) => {

  if (tempFiles.size > 0) {
    cleanupAllTempFiles();
  }
  
  // 释放主窗口资源
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners();
    mainWindow = null;
  }
  
  // 确保应用完全退出
  setTimeout(() => {
    if (process.platform === 'win32') {
      terminateAllProcesses();
    } else {
      process.exit(0);
    }
  }, 100);
});

// 注册全局快捷键
function registerGlobalShortcuts(): void {
  const shortcuts = store.get('shortcuts');
  
  // 注册截图快捷键
  globalShortcut.register(shortcuts.capture, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide(); // 隐藏窗口而不是最小化
    }
    setTimeout(() => {
      showUnifiedScreenshotOverlay();
    }, 200);
  });

  // 注册上传快捷键
  globalShortcut.register(shortcuts.upload, () => {
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.show();
      mainWindow.focus();
    }
    mainWindow?.webContents.send('shortcut-triggered', 'upload');
  });
}

// IPC 处理器

// 文件选择
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Image files', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 文件保存
ipcMain.handle('save-file', async (event, content: string, filename: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: filename,
    filters: [
      { name: 'Text file', extensions: ['txt'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  }
  return false;
});

// 保存临时文件
ipcMain.handle('save-temp-file', async (event, buffer: Uint8Array, filename: string) => {
  try {
    const ext = path.extname(filename) || '.png';
    const tempPath = path.join(app.getPath('temp'), `${TEMP_FILE_PREFIX}${Date.now()}${ext}`);
    fs.writeFileSync(tempPath, buffer);
    addTempFile(tempPath); // 添加到临时文件管理列表
    return tempPath;
  } catch (error) {
    throw error;
  }
});

// 简化的测试功能
ipcMain.handle('force-test-second-screen', async () => {
  return { message: '简化截图系统已启用，测试功能已禁用' };
});

// ===== 清理旧截图系统，现在使用简化版本 =====

// 显示截图覆盖层
ipcMain.handle('show-screenshot-overlay', () => {
  // 隐藏主窗口而不是最小化
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  
  // 显示截图窗口
  showUnifiedScreenshotOverlay();
});

// 简化的截图功能
async function takeSimpleScreenshot(area: { x: number; y: number; width: number; height: number }): Promise<string> {
  try {
    // 获取显示器信息
    const displays = screen.getAllDisplays();
    console.log('📺 Available displays:', displays.map((d, i) => ({
      index: i,
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      primary: d.id === screen.getPrimaryDisplay().id
    })));
    
    // 获取屏幕源
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 16384, height: 16384 }  // 使用高分辨率
    });

    console.log('🖼️ Available screen sources:', sources.map((s, i) => ({
      index: i,
      name: s.name,
      id: s.id,
      display_id: s.display_id,
      size: s.thumbnail.getSize()
    })));

    if (sources.length === 0) {
      throw new Error('No screen sources available');
    }

    // 确定截图区域在哪个显示器上
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    
    
    let targetDisplay: Electron.Display | null = null;
    let displayIndex = -1;
    
    // 详细检查每个显示器
    for (let i = 0; i < displays.length; i++) {
      const display = displays[i];
      const inX = centerX >= display.bounds.x && centerX < display.bounds.x + display.bounds.width;
      const inY = centerY >= display.bounds.y && centerY < display.bounds.y + display.bounds.height;
      
      console.log(`Display [${i}] (ID: ${display.id}):`, {
        bounds: display.bounds,
        centerInX: inX,
        centerInY: inY,
        isTarget: inX && inY
      });
      
      if (inX && inY) {
        targetDisplay = display;
        displayIndex = i;
        break;
      }
    }
    
    if (!targetDisplay) {
      // 如果找不到，使用主显示器
      targetDisplay = screen.getPrimaryDisplay();
      displayIndex = displays.findIndex(d => d.id === targetDisplay!.id);
    }
    
    console.log(`🎯 Target display [${displayIndex}]:`, {
      id: targetDisplay.id,
      bounds: targetDisplay.bounds,
      scaleFactor: targetDisplay.scaleFactor
    });

    // 智能选择屏幕源
    let selectedSource: Electron.DesktopCapturerSource | null = null;
    
    // 策略1: 通过display_id精确匹配
    selectedSource = sources.find(s => s.display_id === targetDisplay!.id.toString()) || null;
    if (selectedSource) {
      console.log(`✅ Found exact display_id match: "${selectedSource.name}" for display ID ${targetDisplay.id}`);
    } else {
      console.log(`⚠️ No exact display_id match found for display ID ${targetDisplay.id}`);
      
      // 策略2: 特殊处理第二显示器（非主屏幕）
      if (!targetDisplay.id.toString().includes(screen.getPrimaryDisplay().id.toString())) {
        // 这是第二屏幕，优先选择非主屏幕源
        const nonPrimarySources = sources.filter(s => s.display_id !== screen.getPrimaryDisplay().id.toString());
        if (nonPrimarySources.length > 0) {
          selectedSource = nonPrimarySources[0];
          console.log(`✅ Using non-primary source for secondary display: "${selectedSource.name}"`);
        }
      }
      
      // 策略3: 如果还没找到，按索引匹配
      if (!selectedSource && displayIndex < sources.length) {
        selectedSource = sources[displayIndex];
        console.log(`✅ Using index-based match for display ${displayIndex}: "${selectedSource.name}"`);
      }
      
      // 策略4: 按分辨率匹配
      if (!selectedSource) {
        const expectedWidth = targetDisplay.bounds.width * targetDisplay.scaleFactor;
        const expectedHeight = targetDisplay.bounds.height * targetDisplay.scaleFactor;
        
        let bestMatch = sources[0];
        let bestScore = 0;
        
        console.log(`🔍 Looking for source matching ${expectedWidth}x${expectedHeight}...`);
        
        for (const source of sources) {
          const size = source.thumbnail.getSize();
          const widthDiff = Math.abs(size.width - expectedWidth);
          const heightDiff = Math.abs(size.height - expectedHeight);
          const score = 1 / (1 + widthDiff + heightDiff);  // 越接近分数越高
          
          console.log(`  Source "${source.name}": ${size.width}x${size.height}, score=${score.toFixed(3)}`);
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = source;
          }
        }
        
        selectedSource = bestMatch;
        console.log(`✅ Using resolution-based match: "${selectedSource.name}" (score: ${bestScore.toFixed(3)})`);
      }
    }

    const sourceSize = selectedSource.thumbnail.getSize();
    console.log(`🖥️ Using source: "${selectedSource.name}" (${sourceSize.width}x${sourceSize.height})`);

    // 改进的坐标转换
    let cropArea: { x: number; y: number; width: number; height: number };
    
    if (displays.length === 1) {
      // 单显示器：简单缩放
      const scaleX = sourceSize.width / targetDisplay.bounds.width;
      const scaleY = sourceSize.height / targetDisplay.bounds.height;
      
      cropArea = {
        x: Math.round(area.x * scaleX),
        y: Math.round(area.y * scaleY),
        width: Math.round(area.width * scaleX),
        height: Math.round(area.height * scaleY)
      };
      
    } else {
      // 多显示器：需要考虑显示器相对位置
      if (selectedSource.display_id === targetDisplay.id.toString()) {
        // 如果源和目标显示器匹配，使用相对坐标
        const relativeX = area.x - targetDisplay.bounds.x;
        const relativeY = area.y - targetDisplay.bounds.y;
        
        const scaleX = sourceSize.width / targetDisplay.bounds.width;
        const scaleY = sourceSize.height / targetDisplay.bounds.height;
        
        cropArea = {
          x: Math.round(relativeX * scaleX),
          y: Math.round(relativeY * scaleY),
          width: Math.round(area.width * scaleX),
          height: Math.round(area.height * scaleY)
        };
        
        console.log('📐 Multi-display relative coords:', {
          relative: { x: relativeX, y: relativeY },
          scale: { x: scaleX, y: scaleY }
        });
      } else {
        // 如果源包含多个显示器，使用绝对坐标
        // 计算总虚拟屏幕尺寸
        let minX = Math.min(...displays.map(d => d.bounds.x));
        let minY = Math.min(...displays.map(d => d.bounds.y));
        let maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
        let maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
        
        const totalWidth = maxX - minX;
        const totalHeight = maxY - minY;
        
        const scaleX = sourceSize.width / totalWidth;
        const scaleY = sourceSize.height / totalHeight;
        
        cropArea = {
          x: Math.round((area.x - minX) * scaleX),
          y: Math.round((area.y - minY) * scaleY),
          width: Math.round(area.width * scaleX),
          height: Math.round(area.height * scaleY)
        };
        
        console.log('📐 Multi-display absolute coords:', {
          virtualScreen: { width: totalWidth, height: totalHeight, offset: { x: minX, y: minY } },
          scale: { x: scaleX, y: scaleY }
        });
      }
    }

    // 边界检查
    cropArea.x = Math.max(0, Math.min(cropArea.x, sourceSize.width - 1));
    cropArea.y = Math.max(0, Math.min(cropArea.y, sourceSize.height - 1));
    cropArea.width = Math.max(1, Math.min(cropArea.width, sourceSize.width - cropArea.x));
    cropArea.height = Math.max(1, Math.min(cropArea.height, sourceSize.height - cropArea.y));


    // 裁剪图片
    const croppedImage = selectedSource.thumbnail.crop(cropArea);

    // 验证结果
    const resultSize = croppedImage.getSize();
    if (resultSize.width === 0 || resultSize.height === 0) {
      throw new Error('Cropped image is empty');
    }

    // 保存截图
    const timestamp = Date.now();
    const filename = `screenshot-${timestamp}.png`;
    const tempPath = path.join(app.getPath('temp'), filename);
    
    const buffer = croppedImage.toPNG();
    fs.writeFileSync(tempPath, buffer);
    addTempFile(tempPath);
  
    // 关闭截图窗口
    closeScreenshotWindow();
    
    // 确保文件已经完全写入并可访问后再发送完成事件
    // 添加短暂延迟确保文件系统操作完成
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 验证文件是否存在且可访问
    if (fs.existsSync(tempPath)) {
      // 发送完成事件
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        
        // 发送截图完成事件
        mainWindow.webContents.send('screenshot-complete', tempPath);
      }
      
      return tempPath;
    } else {
      throw new Error('截图文件未能正确保存');
    }
    
  } catch (error) {
    closeScreenshotWindow();
    throw error;
  }
}

// 关闭截图窗口
function closeScreenshotWindow(): void {
  
  // 关闭所有截图窗口
  screenshotWindows.forEach((window, index) => {
    if (!window.isDestroyed()) {
      window.hide();
    }
  });
  
  // 显示主窗口
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// 简化截图
ipcMain.handle('take-simple-screenshot', async (event, area: { x: number; y: number; width: number; height: number }) => {
  console.log('IPC: take-simple-screenshot called with area:', area);
  try {
    const tempPath = await takeSimpleScreenshot(area);
    console.log('IPC: Simple screenshot completed, file saved to:', tempPath);
    return tempPath;
  } catch (error) {
    console.error('IPC: take-simple-screenshot failed:', error);
    throw error;
  }
});

// 剪贴板操作
ipcMain.handle('copy-to-clipboard', (event, text: string) => {
  clipboard.writeText(text);
});

// 获取设置
ipcMain.handle('get-settings', () => {
  return store.store;
});

// 保存设置
ipcMain.handle('save-settings', (event, settings: Partial<AppSettings>) => {
  for (const [key, value] of Object.entries(settings)) {
    store.set(key as keyof AppSettings, value);
  }
  
  // 如果快捷键发生变化，重新注册
  if (settings.shortcuts) {
    globalShortcut.unregisterAll();
    registerGlobalShortcuts();
  }
});

// 公式识别
ipcMain.handle('recognize-formula', async (event, imagePath: string, apiConfig: ApiConfig): Promise<SimpletexResponse> => {
  // 最大重试次数，特别是对于429错误
  const MAX_RETRIES = 2;
  let retryCount = 0;
  let lastError: any = null;
  
  // 重试函数
  const tryRecognize = async (): Promise<SimpletexResponse> => {
    try {
      // 强制检查API配置，完全忽略可能存在的硬编码默认值
      // 首先检查传入的apiConfig
      let hasValidConfig = false;
      
      if (apiConfig && apiConfig.appId && apiConfig.appSecret) {
        // 检查是否是有效的非空字符串（不仅仅是空格）
        if (apiConfig.appId.trim() && apiConfig.appSecret.trim()) {
          hasValidConfig = true;
          logger.log('使用传入的API配置');
        }
      }
      
      // 如果传入的配置无效，尝试从settings.json加载
      if (!hasValidConfig) {
        const settingsConfig = loadApiConfigFromSettings();
        if (settingsConfig.appId && settingsConfig.appSecret) {
          // 同样检查是否是有效的非空字符串
          if (settingsConfig.appId.trim() && settingsConfig.appSecret.trim()) {
            logger.log('使用settings.json中的API配置');
            apiConfig = {
              ...apiConfig,
              appId: settingsConfig.appId,
              appSecret: settingsConfig.appSecret
            };
            hasValidConfig = true;
          }
        }
      }
      
      // 如果仍然没有有效配置，返回错误
      if (!hasValidConfig) {
        logger.error('API配置为空，无法进行公式识别');
        return {
          status: false,
          res: { latex: '', conf: 0 },
          request_id: '',
          message: '请先在设置中配置API密钥',
          error_code: 'NO_API_CONFIG'
        };
      }
      
      // 验证文件是否存在
      if (!fs.existsSync(imagePath)) {
        console.error('图片文件不存在:', imagePath);
        return {
          status: false,
          res: { latex: '', conf: 0 },
          request_id: '',
          message: '图片文件不存在'
        };
      }
      
      // 读取图片文件
      const imageBuffer = fs.readFileSync(imagePath);
      if (!imageBuffer || imageBuffer.length === 0) {
        console.error('图片文件为空:', imagePath);
        return {
          status: false,
          res: { latex: '', conf: 0 },
          request_id: '',
          message: '图片文件为空'
        };
      }
      
      // 再次验证API配置是否有效 - 更严格的检查
      if (!apiConfig || !apiConfig.appId || !apiConfig.appSecret || 
          !apiConfig.appId.trim() || !apiConfig.appSecret.trim()) {
        logger.error('API配置无效，无法进行公式识别');
        return {
          status: false,
          res: { latex: '', conf: 0 },
          request_id: '',
          message: '请先在设置中配置API密钥',
          error_code: 'NO_API_CONFIG'
        };
      }
      
      // 准备API请求 - 每次重试都重新生成签名
      const { header, reqData } = getReqData({}, apiConfig);
      
      // 使用 form-data 包创建表单数据
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename: path.basename(imagePath),
        contentType: 'image/png'
      });
      
      // 添加普通数据字段（如果有的话）
      for (const [key, value] of Object.entries(reqData)) {
        formData.append(key, value);
      }
      
      // 使用自定义logger输出
      logger.log(`API请求准备完成，使用的API配置: appId=${apiConfig.appId.substring(0, 4)}...，重试次数: ${retryCount}`);
      
      // 发送API请求
      const response = await axios.post('https://server.simpletex.cn/api/latex_ocr', formData, {
        headers: {
          ...formData.getHeaders(),
          ...header
        },
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      console.error(`Formula recognition failed (attempt ${retryCount + 1}):`, error);
      lastError = error;
      
      if (axios.isAxiosError(error)) {
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
        
        // 检查是否是429错误（请求过多）
        if (error.response?.status === 429) {
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            logger.log(`遇到429错误，等待后重试 (${retryCount}/${MAX_RETRIES})...`);
            // 等待一段时间后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
            return tryRecognize();
          }
        }
        
        // 返回格式化的错误响应
        return {
          status: false,
          res: { latex: '', conf: 0 },
          request_id: '',
          message: error.response?.data?.message || error.message || '网络请求失败'
        };
      }
      
      // 返回通用错误响应
      return {
        status: false,
        res: { latex: '', conf: 0 },
        request_id: '',
        message: error instanceof Error ? error.message : '未知错误'
      };
    }
  };
  
  // 开始识别流程
  return tryRecognize();
});

// 注册全局快捷键
ipcMain.handle('register-global-shortcuts', (event, shortcuts: { capture: string; upload: string }) => {
  globalShortcut.unregisterAll();
  
  try {
    globalShortcut.register(shortcuts.capture, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide(); // 隐藏窗口而不是最小化
      }
      setTimeout(() => {
        showUnifiedScreenshotOverlay();
      }, 200);
    });

    globalShortcut.register(shortcuts.upload, () => {
      if (mainWindow && !mainWindow.isFocused()) {
        mainWindow.show();
        mainWindow.focus();
      }
      mainWindow?.webContents.send('shortcut-triggered', 'upload');
    });
    
    return true;
  } catch (error) {
    return false;
  }
});

// 取消注册全局快捷键
ipcMain.handle('unregister-global-shortcuts', () => {
  globalShortcut.unregisterAll();
});

// 窗口操作
ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('close-window', () => {
  // 使用强制退出函数确保应用完全退出
  forceQuitApp();
  return true;
});

// 关闭截图窗口
ipcMain.handle('close-screenshot-window', () => {
  logger.log('收到关闭截图窗口请求');
  closeScreenshotWindow();
  logger.log('截图窗口已关闭，主窗口已显示');
  return true;
});

// 截图完成
ipcMain.handle('screenshot-complete', (event, imagePath: string) => {

  // 关闭截图窗口
  screenshotWindows.forEach(window => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
  screenshotWindows.length = 0;
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    
    // 立即发送截图完成事件，不再等待
    mainWindow.webContents.send('screenshot-complete', imagePath);
  }
});

// 临时文件管理
ipcMain.handle('cleanup-temp-files', () => {
  cleanupAllTempFiles();
});

ipcMain.handle('remove-temp-file', (event, filePath: string) => {
  return removeTempFile(filePath);
});

ipcMain.handle('get-temp-files-count', () => {
  return tempFiles.size;
});

// 获取显示器调试信息
ipcMain.handle('get-display-info', async () => {
  try {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 150, height: 150 }
    });
    
    const displayInfo = displays.map((display, index) => ({
      index,
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      workArea: display.workArea,
      isPrimary: index === 0,
      label: display.label || `Display ${index + 1}`
    }));
    
    const sourceInfo = sources.map((source, index) => ({
      index,
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnailSize: source.thumbnail.getSize()
    }));
    
    // 分析屏幕源和显示器的匹配关系
    const matchingAnalysis = displays.map((display, displayIndex) => {
      const potentialSources = sources.filter(s => s.display_id === display.id.toString());
      const nameMatchSources = sources.filter(s => {
        if (displayIndex === 0) {
          return s.name.includes('Primary') || s.name.includes('Main') || !/\d+/.test(s.name);
        } else {
          return !s.name.includes('Primary') && !s.name.includes('Main');
        }
      });
      
      return {
        display: { index: displayIndex, id: display.id, name: `Display ${displayIndex}` },
        exactMatches: potentialSources,
        nameMatches: nameMatchSources,
        recommendedSource: potentialSources[0] || nameMatchSources[0] || sources[displayIndex] || null
      };
    });
    
    return {
      displays: displayInfo,
      sources: sourceInfo,
      matchingAnalysis,
      screenshotWindowsCount: screenshotWindows.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    throw error;
  }
});

// 简化的测试功能（暂时禁用复杂测试）
ipcMain.handle('test-display-screenshot', async (event, displayIndex: number) => {
  return { message: '简化截图系统已启用，复杂测试功能已禁用' };
});

// 保存API设置到settings.json文件
ipcMain.handle('save-api-to-settings-file', async (event, apiConfig: ApiConfig) => {
  try {
    const settingsPath = path.join(app.getAppPath(), 'settings.json');
    const settings = {
      app_id: apiConfig.appId,
      app_secret: apiConfig.appSecret
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
           logger.log('API config saved to settings.json file');
    return true;
  } catch (error) {
    logger.error('保存API配置到settings.json文件失败:', error);
    return false;
  }
});

// 清除API配置
ipcMain.handle('clear-api-config', async (event) => {
  try {
    logger.log('开始清除API配置...');
    
    // 1. 清除内存中的API配置
    DEFAULT_API_CONFIG.appId = '';
    DEFAULT_API_CONFIG.appSecret = '';
    logger.log('1. 内存中的API配置已清除');
    
    // 2. 更新electron-store中的API配置
    store.set('apiConfig', {
      appId: '',
      appSecret: '',
      endpoint: DEFAULT_API_CONFIG.endpoint
    });
    logger.log('2. electron-store中的API配置已清除');
    
    // 3. 清除settings.json文件中的API配置
    const settingsPath = path.join(app.getAppPath(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = {
        app_id: '',
        app_secret: ''
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      logger.log('3. settings.json文件中的API配置已清除');
    } else {
      logger.log('settings.json文件不存在，无需清除');
    }
    
    // 4. 清除浏览器缓存和会话存储
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        // 清除所有类型的存储数据
        await mainWindow.webContents.session.clearStorageData({
          storages: ['localstorage', 'cookies', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
        });
        logger.log('4. 浏览器存储数据已清除');
        
        // 清除HTTP缓存
        await mainWindow.webContents.session.clearCache();
        logger.log('5. 浏览器HTTP缓存已清除');
        
        // 清除主机解析缓存
        await mainWindow.webContents.session.clearHostResolverCache();
        logger.log('6. 主机解析缓存已清除');
        
        // 清除所有授权数据
        await mainWindow.webContents.session.clearAuthCache();
        logger.log('7. 授权缓存已清除');
        
        // 强制刷新窗口内容，确保所有缓存都被清除
        mainWindow.webContents.reloadIgnoringCache();
        logger.log('8. 窗口内容已强制刷新');
      } catch (e) {
        logger.error('清除缓存失败:', e);
      }
    }
    
    logger.log('API配置已完全清除');
    return true;
  } catch (error) {
    logger.error('清除API配置失败:', error);
    return false;
  }
});

// 在Windows平台上强制终止所有相关进程
function terminateAllProcesses(): void {
  if (process.platform === 'win32') {
    try {
      // 在Windows上使用taskkill命令强制终止所有相关进程
      const { execSync } = require('child_process');
      
      // 可能的进程名称列表
      const possibleProcessNames = [
        'LaTeX公式识别工具.exe',
        'electron.exe',
        'SimpleTex-OCR.exe',
        'node.exe'
      ];
      
      
      // 尝试终止每个可能的进程
      for (const processName of possibleProcessNames) {
        try {
          execSync(`taskkill /F /IM "${processName}" /T`, { windowsHide: true });
        } catch (err) {

        }
      }
      process.exit(0);
    } catch (error) {

      // 确保最终退出
      process.exit(0);
    }
  }
}

// 检测和终止可能的僵尸进程
function killZombieProcesses(): void {
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const possibleProcessNames = [
        'LaTeX公式识别工具.exe',
        'electron.exe',
        'SimpleTex-OCR.exe'
      ];
      
      // 获取当前进程ID
      const currentPid = process.pid;
      for (const processName of possibleProcessNames) {
        try {
          // 获取所有匹配的进程ID
          const output = execSync(`wmic process where "name='${processName}'" get processid`, { encoding: 'utf8' });
          const lines = output.split('\n').filter((line: string) => line.trim() !== '' && line.trim().toLowerCase() !== 'processid');
          
          for (const line of lines) {
            const pid = line.trim();
            if (pid && pid !== String(currentPid)) {
              try {
                execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
              } catch (killErr) {
              }
            }
          }
        } catch (err) {
        }
      }
      
    } catch (error) {
    }
  }
}

// 强制退出应用
function forceQuitApp(): void {
  
  // 清理资源
  globalShortcut.unregisterAll();
  
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  
  // 关闭所有窗口
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      try {
        window.removeAllListeners();
        window.webContents.removeAllListeners();
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools();
        }
        window.close();
      } catch (e) {
      }
    }
  });
  
  // 清理临时文件
  cleanupAllTempFiles();
  
  // 释放其他资源
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.session.clearCache();
      mainWindow.webContents.session.clearStorageData();
    } catch (e) {
    }
  }
  
  app.removeAllListeners();
  app.releaseSingleInstanceLock();  // 释放单例锁
  
  // 在Windows平台上，直接使用终止进程函数
  if (process.platform === 'win32') {
    terminateAllProcesses();
  } else {
    app.quit();
    app.exit(0);
    process.exit(0);
  }
}

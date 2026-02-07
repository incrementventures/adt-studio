import { app, BrowserWindow, Menu, ipcMain, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { pathToFileURL } from "node:url";

const IS_PACKAGED = app.isPackaged;
const APP_ROOT = IS_PACKAGED
  ? path.join(process.resourcesPath!, "app")
  : path.resolve(import.meta.dirname, "..");

const STANDALONE_DIR = path.join(APP_ROOT, ".next", "standalone");
const STATIC_DIR = path.join(APP_ROOT, ".next", "static");
const PUBLIC_DIR = path.join(APP_ROOT, "public");

let mainWindow: BrowserWindow | null = null;
let serverPort: number;

// ── Secure key storage ─────────────────────────────────────────────────

const KEY_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

// In-memory cache so we only hit the keychain once per session.
// All keys are stored in a single encrypted JSON file → one decrypt call → one keychain prompt.
const keyCache = new Map<string, string>();
let keyCacheLoaded = false;

const KEYS_ENC_FILE = () => path.join(app.getPath("userData"), "api-keys.enc");
const KEYS_TXT_FILE = () => path.join(app.getPath("userData"), "api-keys.json");

function loadAllKeys(): void {
  if (keyCacheLoaded) return;

  // Try the consolidated encrypted file first (single decrypt = single keychain prompt)
  const encFile = KEYS_ENC_FILE();
  if (fs.existsSync(encFile) && safeStorage.isEncryptionAvailable()) {
    const encrypted = fs.readFileSync(encFile);
    const json = safeStorage.decryptString(encrypted);
    const keys = JSON.parse(json) as Record<string, string>;
    for (const [k, v] of Object.entries(keys)) {
      if (v) keyCache.set(k, v);
    }
    keyCacheLoaded = true;
    return;
  }

  // Fallback: unencrypted JSON
  const txtFile = KEYS_TXT_FILE();
  if (fs.existsSync(txtFile)) {
    const json = fs.readFileSync(txtFile, "utf-8");
    const keys = JSON.parse(json) as Record<string, string>;
    for (const [k, v] of Object.entries(keys)) {
      if (v) keyCache.set(k, v);
    }
    keyCacheLoaded = true;
    return;
  }

  // Migrate from old per-key files (one-time)
  let migrated = false;
  for (const name of KEY_NAMES) {
    const oldEnc = path.join(app.getPath("userData"), `${name}.enc`);
    if (fs.existsSync(oldEnc) && safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(oldEnc);
      keyCache.set(name, safeStorage.decryptString(encrypted));
      fs.unlinkSync(oldEnc);
      migrated = true;
      continue;
    }
    const oldTxt = path.join(app.getPath("userData"), `${name}.txt`);
    if (fs.existsSync(oldTxt)) {
      keyCache.set(name, fs.readFileSync(oldTxt, "utf-8").trim());
      fs.unlinkSync(oldTxt);
      migrated = true;
    }
  }
  if (migrated) {
    saveAllKeys();
  }

  keyCacheLoaded = true;
}

function saveAllKeys(): void {
  const obj: Record<string, string> = {};
  for (const [k, v] of keyCache) {
    obj[k] = v;
  }
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(KEYS_ENC_FILE(), safeStorage.encryptString(json));
  } else {
    fs.writeFileSync(KEYS_TXT_FILE(), json, "utf-8");
  }
}

function storeKey(name: string, value: string): void {
  keyCache.set(name, value);
  saveAllKeys();
}

function loadKey(name: string): string | null {
  loadAllKeys();
  return keyCache.get(name) ?? null;
}

function hasAnyApiKey(): boolean {
  loadAllKeys();
  return keyCache.size > 0;
}

// ── IPC handlers ────────────────────────────────────────────────────────

ipcMain.handle("store-api-key", (_event, name: string, value: string) => {
  storeKey(name, value);
  return true;
});

ipcMain.handle("load-api-key", (_event, name: string) => {
  return loadKey(name);
});

ipcMain.handle("has-any-api-key", () => {
  return hasAnyApiKey();
});

// ── Port finding ────────────────────────────────────────────────────────

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not find free port"));
      }
    });
    server.on("error", reject);
  });
}

// ── Wait for server ─────────────────────────────────────────────────────

function waitForServer(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Server did not start within ${timeoutMs}ms`));
        return;
      }
      const req = net.createConnection({ port, host: "127.0.0.1" }, () => {
        req.destroy();
        resolve();
      });
      req.on("error", () => {
        setTimeout(check, 200);
      });
    };
    check();
  });
}

// ── Start Next.js server ────────────────────────────────────────────────

async function startNextServer(): Promise<number> {
  const port = await findFreePort();
  serverPort = port;

  const booksRoot = path.join(app.getPath("userData"), "books");
  if (!fs.existsSync(booksRoot)) {
    fs.mkdirSync(booksRoot, { recursive: true });
  }

  // Set env vars on the current process (the server runs in-process)
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.BOOKS_ROOT = booksRoot;
  process.env.NODE_ENV = "production";

  for (const keyName of KEY_NAMES) {
    const value = loadKey(keyName);
    if (value) {
      process.env[keyName] = value;
    }
  }

  const serverScript = path.join(STANDALONE_DIR, "server.js");

  // Ensure .next/static is accessible from the standalone dir
  const standaloneStaticDir = path.join(STANDALONE_DIR, ".next", "static");
  if (!fs.existsSync(standaloneStaticDir) && fs.existsSync(STATIC_DIR)) {
    fs.mkdirSync(path.join(STANDALONE_DIR, ".next"), { recursive: true });
    fs.symlinkSync(STATIC_DIR, standaloneStaticDir, "junction");
  }

  // Ensure public/ is accessible from the standalone dir
  const standalonePublicDir = path.join(STANDALONE_DIR, "public");
  if (!fs.existsSync(standalonePublicDir) && fs.existsSync(PUBLIC_DIR)) {
    fs.symlinkSync(PUBLIC_DIR, standalonePublicDir, "junction");
  }

  // Run the Next.js server in-process. This avoids all child process spawning
  // issues (Helper binary, code signing, ELECTRON_RUN_AS_NODE) in packaged apps.
  // The standalone server.js is just an HTTP server that shares the event loop.
  process.chdir(STANDALONE_DIR);
  await import(pathToFileURL(serverScript).href);

  await waitForServer(port);
  return port;
}

// ── API Key Setup Window ────────────────────────────────────────────────

function showApiKeySetup(): Promise<void> {
  return new Promise((resolve) => {
    const setupWindow = new BrowserWindow({
      width: 520,
      height: 480,
      resizable: false,
      title: "ADT Studio - API Key Setup",
      webPreferences: {
        preload: path.join(import.meta.dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const htmlPath = IS_PACKAGED
      ? path.join(process.resourcesPath!, "app", "electron", "api-key-setup.html")
      : path.join(import.meta.dirname, "..", "electron", "api-key-setup.html");

    setupWindow.loadFile(htmlPath);

    ipcMain.once("api-key-setup-complete", () => {
      setupWindow.close();
      resolve();
    });

    setupWindow.on("closed", () => {
      resolve();
    });
  });
}

// ── Main Window ─────────────────────────────────────────────────────────

function createMainWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "ADT Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── Restart server (picks up new keys) ──────────────────────────────────

async function applyKeyChanges(): Promise<void> {
  // Reload keys from disk and update process.env so the in-process server
  // picks up changes on the next request (AI SDK clients read env per-request).
  keyCacheLoaded = false;
  keyCache.clear();
  loadAllKeys();
  for (const keyName of KEY_NAMES) {
    const value = keyCache.get(keyName);
    if (value) {
      process.env[keyName] = value;
    } else {
      delete process.env[keyName];
    }
  }
  if (mainWindow) {
    mainWindow.reload();
  }
}

// ── Application menu ────────────────────────────────────────────────────

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "API Keys…",
                click: async () => {
                  await showApiKeySetup();
                  await applyKeyChanges();
                },
              },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...(process.platform !== "darwin"
          ? [
              {
                label: "API Keys…",
                click: async () => {
                  await showApiKeySetup();
                  await applyKeyChanges();
                },
              },
              { type: "separator" as const },
            ]
          : []),
        { role: "close" as const },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { role: "resetZoom" as const },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App lifecycle ───────────────────────────────────────────────────────

app.whenReady().then(async () => {
  buildMenu();

  if (!hasAnyApiKey()) {
    await showApiKeySetup();
  }

  const port = await startNextServer();
  createMainWindow(port);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(port);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Server runs in-process, no child process to clean up
});

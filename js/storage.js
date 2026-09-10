const DB_NAME = 'focus-limit-local';
const DB_VERSION = 1;

let db = null;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('directions')) {
        database.createObjectStore('directions', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('tasks')) {
        database.createObjectStore('tasks', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('sessions')) {
        const store = database.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('weekKey', 'weekKey', { unique: false });
        store.createIndex('directionId', 'directionId', { unique: false });
      }
    };
  });
}

async function getStore(name, mode = 'readonly') {
  const database = await openDB();
  return database.transaction(name, mode).objectStore(name);
}

async function get(key) {
  const store = await getStore('settings');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}

async function set(key, value) {
  const store = await getStore('settings', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export const defaultSettings = {
  lang: 'ru',
  theme: 'dark',
  onboardingDone: false,
  workDuration: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakInterval: 4,
  parallelMode: false,
  activeDirectionId: 'default',
  pomodoroNumber: 1,
  timerPhase: 'work',
  timerRemaining: 25 * 60,
  timerRunning: false,
  timerStartedAt: null,
  musicTrack: null,
  notificationsEnabled: false,
};

export async function loadSettings() {
  const saved = await get('app');
  return { ...defaultSettings, ...saved };
}

export async function saveSettings(settings) {
  await set('app', settings);
}

const DEFAULT_DIRECTION = {
  id: 'default',
  name: 'other',
  nameKey: 'other',
  weeklyBlocks: null,
  unlimited: true,
  color: '#6b7280',
  isDefault: true,
};

export async function getDirections() {
  const store = await getStore('directions');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const dirs = req.result;
      if (!dirs.find(d => d.id === 'default')) {
        resolve([DEFAULT_DIRECTION, ...dirs]);
      } else {
        resolve(dirs.sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : 0)));
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirection(direction) {
  const store = await getStore('directions', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(direction);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDirection(id) {
  if (id === 'default') return;
  const store = await getStore('directions', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function initDefaultDirection() {
  const store = await getStore('directions');
  const dirs = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!dirs.find(d => d.id === 'default')) {
    await saveDirection({ ...DEFAULT_DIRECTION });
  }
}

export async function getTasks() {
  const store = await getStore('tasks');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTask(task) {
  const store = await getStore('tasks', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(task);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTask(id) {
  const store = await getStore('tasks', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function addSession(session) {
  const store = await getStore('sessions', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add(session);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getSessions(weekKey = null) {
  const store = await getStore('sessions');
  return new Promise((resolve, reject) => {
    if (weekKey) {
      const index = store.index('weekKey');
      const req = index.getAll(weekKey);
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.completedAt - a.completedAt));
      req.onerror = () => reject(req.error);
    } else {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.completedAt - a.completedAt));
      req.onerror = () => reject(req.error);
    }
  });
}

export async function getAllWeekKeys() {
  const sessions = await getSessions();
  const keys = [...new Set(sessions.map(s => s.weekKey))];
  return keys.sort().reverse();
}

export async function exportAllData() {
  const [settings, directions, tasks, sessions] = await Promise.all([
    loadSettings(),
    getDirections(),
    getTasks(),
    getSessions(),
  ]);
  return { version: 1, exportedAt: Date.now(), settings, directions, tasks, sessions };
}

export async function importAllData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid backup format');
  }

  const database = await openDB();
  const tx = database.transaction(['settings', 'directions', 'tasks', 'sessions'], 'readwrite');

  await new Promise((resolve, reject) => {
    tx.objectStore('settings').clear();
    tx.objectStore('directions').clear();
    tx.objectStore('tasks').clear();
    tx.objectStore('sessions').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  if (data.settings) await saveSettings({ ...defaultSettings, ...data.settings });
  for (const d of data.directions || []) await saveDirection(d);
  if (!(data.directions || []).find(d => d.id === 'default')) {
    await saveDirection({ ...DEFAULT_DIRECTION });
  }
  for (const t of data.tasks || []) await saveTask(t);
  for (const s of data.sessions || []) await addSession(s);
}

export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

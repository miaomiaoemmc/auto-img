"use client";

const DB_NAME = "PortraitStudio";
const DB_VERSION = 1;
const STORE_NAME = "queueState";

interface PersistedItem {
  localId: string;
  name: string;
  pathLabel: string;
  status: string;
  detection: object | null;
  keepFaceId: number | null;
  eraseFaceIds: number[];
  result: object | null;
  error: string;
}

interface PersistedState {
  mode: string;
  tool: string;
  faceRatio: number;
  items: PersistedItem[];
  activeItemId: string | null;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

export async function saveState(state: PersistedState): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({ id: "current", ...state });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadState(): Promise<PersistedState | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get("current");
      request.onsuccess = () => {
        const data = request.result;
        if (!data) {
          resolve(null);
          return;
        }
        const { id, ...state } = data;
        resolve(state as PersistedState);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function clearState(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete("current");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // ignore
  }
}

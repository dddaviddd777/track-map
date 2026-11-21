// Emmagatzematge al mòbil (IndexedDB): tracks i punts guardats.

const DB_NAME = 'trackmap';
let dbPromise;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(store, mode, fn) {
  dbPromise ??= openDb();
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAllTracks = () => run('tracks', 'readonly', s => s.getAll());
export const getTrack = id => run('tracks', 'readonly', s => s.get(id));
export const saveTrack = track => run('tracks', 'readwrite', s => s.put(track));
export const deleteTrack = id => run('tracks', 'readwrite', s => s.delete(id));

export const getAllPoints = () => run('points', 'readonly', s => s.getAll());
export const savePoint = p => run('points', 'readwrite', s => s.put(p));
export const deletePoint = id => run('points', 'readwrite', s => s.delete(id));

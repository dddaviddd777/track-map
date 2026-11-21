// Emmagatzematge dels tracks al mòbil (IndexedDB).

const DB_NAME = 'trackmap';
const STORE = 'tracks';
let dbPromise;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  dbPromise ??= openDb();
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAllTracks = () => run('readonly', s => s.getAll());
export const getTrack = id => run('readonly', s => s.get(id));
export const saveTrack = track => run('readwrite', s => s.put(track));
export const deleteTrack = id => run('readwrite', s => s.delete(id));

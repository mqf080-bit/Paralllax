/**
 * 桌面 / Quest 浏览器里的「本地谱面包」暂存。
 *
 * 文件选择 / 拖放发生在游戏页；把字节放进 IndexedDB，然后 reload 成
 * `?localPack=1`。下一次启动时 main 读回再解包，这样不用把文件复制到
 * `public/packages/` 也能直接玩。
 */

const DB_NAME = 'parallax.packages';
const STORE = 'pending';
const KEY = 'open';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打不开'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      let result!: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
      // 写操作必须等事务真正 commit 再返回；只等 request.onsuccess 就 reload，
      // 在 Quest 上可能丢掉 18MB 的包，页面重开后包就不见了。
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'));
    });
  } finally {
    db.close();
  }
}

export async function saveLocalPackage(bytes: ArrayBuffer): Promise<void> {
  await withStore('readwrite', (store) => store.put(bytes, KEY));
}

export async function readLocalPackage(): Promise<ArrayBuffer | null> {
  const value = await withStore<ArrayBuffer | undefined>('readonly', (store) => store.get(KEY));
  return value ?? null;
}

export async function clearLocalPackage(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY));
}

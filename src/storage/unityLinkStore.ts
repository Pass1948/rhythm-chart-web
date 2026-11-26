/**
 * 연결한 유니티 폴더 핸들·프로젝트 이름 1건을 IndexedDB(chartweb-unitylink)에 저장한다.
 * IndexedDB 가 막혀 있으면 오류 없이 "저장 안 됨"으로 보고 이번 세션 동안만 메모리에 유지한다.
 */
import type { LinkDirHandle } from './unityLink.ts';

export interface SavedLink {
  handle: LinkDirHandle;
  projectName: string;
}

const DB_NAME = 'chartweb-unitylink';
const STORE = 'link';
const KEY = 'current';
let memory: SavedLink | null = null;

/** DB 를 연다(실패하면 null) */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      if (typeof indexedDB === 'undefined') return ok(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ok(null);
      req.onblocked = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

/** 값 하나를 쓰거나(value) 읽거나 지운다. 실패하면 false/undefined */
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: boolean; value?: T }> {
  const db = await openDb();
  if (!db) return { ok: false };
  try {
    return await new Promise((done) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); done({ ok: true, value: req.result }); };
      tx.onerror = tx.onabort = () => { db.close(); done({ ok: false }); };
    });
  } catch {
    return { ok: false };
  }
}

/** 연결 저장. 돌려주는 값: IndexedDB 에 저장됐는가(false 면 이번 세션 동안만 유지) */
export async function saveLink(handle: LinkDirHandle, projectName: string): Promise<boolean> {
  memory = { handle, projectName };
  return (await run('readwrite', (s) => s.put({ handle, projectName }, KEY))).ok;
}

/** 저장된 연결 읽기(없으면 null) */
export async function loadLink(): Promise<SavedLink | null> {
  if (memory) return memory;
  const r = await run<SavedLink | undefined>('readonly', (s) => s.get(KEY));
  const v = r.value;
  if (v && v.handle && typeof v.projectName === 'string') {
    memory = v;
    return v;
  }
  return null;
}

/** 연결 해제 */
export async function clearLink(): Promise<void> {
  memory = null;
  await run('readwrite', (s) => s.delete(KEY));
}

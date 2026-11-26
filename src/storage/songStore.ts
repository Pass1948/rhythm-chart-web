/**
 * 곡 저장소(songStore): 브라우저의 IndexedDB(기기 안 저장 공간)에 곡을 보관한다. 서버는 쓰지 않는다.
 * - 곡 하나 = {id, name, audioBlob, audioMeta, analysis, chart, trashedAt?} (계약 5번) + 이전 버전 보관 `history`(최근 20개).
 * - 음원 Blob 은 목록을 빨리 읽으려고 별도 저장소('audio')에 따로 둔다. 겉으로는 한 곡 기록으로 보인다.
 * - 곡 삭제는 휴지통(소프트 삭제): trashedAt 을 기록만 하고, 복원·영구 삭제를 따로 한다.
 * - IndexedDB 를 못 쓰는 환경(시크릿 모드 등)에서는 메모리 어댑터로 동작하고 persistent=false 가 된다.
 */
import type { AnalysisResult } from '../analysis/types.ts';
import { isValidWave, type WaveMap } from '../analysis/wave.ts';
import type { ChartV2 } from '../core/schema.ts';

/** 같은 곡 안에 보관하는 이전 버전 개수 */
export const HISTORY_LIMIT = 20;
const DB_NAME = 'rcw.songs.v1';
const STORE_SONGS = 'songs';
const STORE_AUDIO = 'audio';

/** 음원 파일 정보 */
export interface AudioMeta {
  fileName: string;
  mime: string;
  size: number;
  sha256: string;
  durationMs: number;
}

/** 이전 버전 한 개 */
export interface HistoryEntry {
  savedAt: string;
  chart: ChartV2;
}

/** 곡 한 개의 전체 기록 (audioBlob 은 get() 으로 읽을 때만 채워진다) */
export interface SongRecord {
  id: string;
  name: string;
  audioBlob?: Blob;
  audioMeta: AudioMeta;
  analysis: AnalysisResult | null;
  chart: ChartV2 | null;
  trashedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  history: HistoryEntry[];
}

/** 목록에 보여 주는 곡 요약(원본 서버의 song_info 와 같은 모양) */
export interface SongSummary {
  id: string;
  title: string;
  audio_file: string | null;
  has_audio: boolean;
  duration_ms: number | null;
  has_chart: boolean;
  analyzed: boolean;
  note_count: number;
  analyzing: boolean;
  trashed: boolean;
  sha256: string;
}

/** 저장 공간 부족 등 저장 실패 (메시지는 그대로 화면에 보여도 되는 쉬운 한국어) */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** 값을 읽고 쓰는 최소 저장 어댑터. IndexedDB 와 메모리 두 가지가 있다. */
export interface KvAdapter {
  /** 새로고침 뒤에도 남는 저장소인가 */
  readonly persistent: boolean;
  get(store: string, key: string): Promise<unknown>;
  put(store: string, key: string, value: unknown): Promise<void>;
  del(store: string, key: string): Promise<void>;
  all(store: string): Promise<unknown[]>;
}

/** 메모리 어댑터: 시크릿 모드 대비·단위 테스트용. 새로고침하면 사라진다. */
export function createMemoryAdapter(): KvAdapter {
  const data = new Map<string, Map<string, unknown>>();
  const bucket = (store: string): Map<string, unknown> => {
    let b = data.get(store);
    if (!b) {
      b = new Map();
      data.set(store, b);
    }
    return b;
  };
  return {
    persistent: false,
    get: async (store, key) => bucket(store).get(key),
    put: async (store, key, value) => {
      bucket(store).set(key, value);
    },
    del: async (store, key) => {
      bucket(store).delete(key);
    },
    all: async (store) => [...bucket(store).values()],
  };
}

/** IDB 요청 하나를 Promise 로 바꾼다 */
function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fail) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error ?? new Error('저장소 오류'));
  });
}

/** IndexedDB 어댑터를 연다. 못 열면(막힌 환경) 거부된다. */
export async function openIdbAdapter(dbName: string = DB_NAME): Promise<KvAdapter> {
  if (typeof indexedDB === 'undefined') throw new Error('indexedDB 없음');
  const db = await new Promise<IDBDatabase>((ok, fail) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_SONGS);
      req.result.createObjectStore(STORE_AUDIO);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error ?? new Error('IndexedDB 열기 실패'));
    req.onblocked = () => fail(new Error('IndexedDB 가 막혀 있습니다'));
  });
  const run = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = db.transaction(store, mode);
    const done = new Promise<void>((ok, fail) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => fail(tx.error ?? new Error('저장 실패'));
      tx.onabort = () => fail(tx.error ?? new Error('저장 취소'));
    });
    const result = reqToPromise(fn(tx.objectStore(store)));
    return Promise.all([result, done]).then(([r]) => r);
  };
  return {
    persistent: true,
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: async (store, key, value) => {
      await run(store, 'readwrite', (s) => s.put(value, key));
    },
    del: async (store, key) => {
      await run(store, 'readwrite', (s) => s.delete(key));
    },
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
  };
}

/** 저장 중 오류를 쉬운 한국어로 바꾼다 */
function friendly(err: unknown): StorageError {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
    return new StorageError('이 기기의 저장 공간이 부족해서 저장하지 못했습니다. 안 쓰는 곡을 지우거나 [내보내기]로 파일을 저장해 주세요.');
  }
  return new StorageError('저장하지 못했습니다. 브라우저의 저장 기능이 막혀 있을 수 있습니다. 작업 후 [내보내기]로 파일을 저장해 주세요.');
}

/** 곡 하나를 목록용 요약으로 바꾼다 */
function summarize(rec: SongRecord, analyzing: boolean): SongSummary {
  const chart = rec.chart;
  return {
    id: rec.id,
    title: chart?.song?.title || rec.name,
    audio_file: rec.audioMeta.fileName,
    has_audio: true,
    duration_ms: chart?.song?.duration_ms ?? rec.audioMeta.durationMs,
    has_chart: !!chart,
    analyzed: !!rec.analysis,
    note_count: chart ? chart.difficulties.reduce((n, d) => n + d.notes.length, 0) : 0,
    analyzing,
    trashed: !!rec.trashedAt,
    sha256: rec.audioMeta.sha256,
  };
}

/** 곡 저장소 */
export class SongStore {
  private readonly kv: KvAdapter;
  /** 분석 중인 곡 id (삭제를 막는 데 쓴다. 화면 쪽이 알려 준다) */
  readonly busy = new Set<string>();

  constructor(adapter: KvAdapter) {
    this.kv = adapter;
  }

  /** 새로고침 뒤에도 남는 저장소인가 (false 면 화면이 "저장되지 않습니다" 안내를 띄운다) */
  get persistent(): boolean {
    return this.kv.persistent;
  }

  /** 기본 저장소를 연다: IndexedDB 를 먼저 시도하고, 안 되면 메모리로 동작한다. */
  static async open(): Promise<SongStore> {
    try {
      return new SongStore(await openIdbAdapter());
    } catch {
      return new SongStore(createMemoryAdapter());
    }
  }

  /** 곡 id 를 새로 만든다 */
  private newId(): string {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** 곡 기록을 저장한다(음원 Blob 은 따로). */
  private async writeRecord(rec: SongRecord): Promise<void> {
    const { audioBlob: _blob, ...rest } = rec;
    void _blob;
    try {
      await this.kv.put(STORE_SONGS, rec.id, rest);
    } catch (err) {
      throw friendly(err);
    }
  }

  /** 곡을 새로 추가한다(업로드). 음원 Blob 과 빈 채보를 함께 저장한다. */
  async addSong(input: { name: string; blob: Blob; meta: AudioMeta; chart: ChartV2 | null }): Promise<SongRecord> {
    const now = Date.now();
    const rec: SongRecord = {
      id: this.newId(),
      name: input.name,
      audioMeta: input.meta,
      analysis: null,
      chart: input.chart,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    try {
      await this.kv.put(STORE_AUDIO, rec.id, input.blob);
    } catch (err) {
      throw friendly(err);
    }
    try {
      await this.writeRecord(rec);
    } catch (err) {
      await this.kv.del(STORE_AUDIO, rec.id).catch(() => undefined);
      throw err;
    }
    return { ...rec, audioBlob: input.blob };
  }

  /** 곡 한 개(없으면 null). withAudio=true 면 음원 Blob 도 읽는다. */
  async get(id: string, withAudio = true): Promise<SongRecord | null> {
    const rec = (await this.kv.get(STORE_SONGS, id)) as SongRecord | undefined;
    if (!rec) return null;
    const out: SongRecord = { ...rec, history: rec.history ?? [] };
    if (withAudio) out.audioBlob = ((await this.kv.get(STORE_AUDIO, id)) as Blob | undefined) ?? undefined;
    return out;
  }

  /** 곡 목록(휴지통에 없는 곡만, 최근에 만든 곡이 아래). trashed=true 면 휴지통의 곡만. */
  async list(trashed = false): Promise<SongSummary[]> {
    const all = (await this.kv.all(STORE_SONGS)) as SongRecord[];
    return all
      .filter((r) => !!r.trashedAt === trashed)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => summarize({ ...r, history: r.history ?? [] }, this.busy.has(r.id)));
  }

  /** 같은 음원(SHA-256 같음)을 가진 살아 있는 곡 (없으면 null) */
  async findBySha(sha256: string): Promise<SongSummary | null> {
    const list = await this.list(false);
    return list.find((s) => s.sha256 === sha256) ?? null;
  }

  /** 채보를 저장한다. 바뀌기 전 채보는 이전 버전으로 최근 20개까지 같은 곡 안에 보관한다. */
  async saveChart(id: string, chart: ChartV2): Promise<void> {
    const rec = await this.get(id, false);
    if (!rec) throw new StorageError('저장할 곡을 찾을 수 없습니다. 곡이 지워졌을 수 있습니다.');
    const history = [...rec.history];
    if (rec.chart && JSON.stringify(rec.chart) !== JSON.stringify(chart)) {
      history.push({ savedAt: new Date().toISOString(), chart: rec.chart });
      while (history.length > HISTORY_LIMIT) history.shift();
    }
    await this.writeRecord({ ...rec, chart, history, updatedAt: Date.now() });
  }

  /**
   * [2.1] 곡 제목·아티스트를 저장한다. `rec.name` 과 `chart.song.title` 에 같은 값을 쓰고 `chart.song.artist` 를 고친다.
   * 채보가 없으면 `rec.name` 만 바꾼다. 채보가 바뀌면 이전 채보를 이력에 보관한다(규칙은 saveChart 와 같다).
   * 값 다듬기·길이 검사는 부르는 쪽(localApi.saveSongInfo) 몫이다. 갱신된 곡 요약을 돌려준다.
   */
  async saveSongInfo(id: string, info: { title: string; artist: string }): Promise<SongSummary> {
    const rec = await this.get(id, false);
    if (!rec) throw new StorageError('저장할 곡을 찾을 수 없습니다. 곡이 지워졌을 수 있습니다.');
    const history = [...rec.history];
    let chart = rec.chart;
    if (rec.chart) {
      chart = { ...rec.chart, song: { ...rec.chart.song, title: info.title, artist: info.artist } };
      if (JSON.stringify(rec.chart) !== JSON.stringify(chart)) {
        history.push({ savedAt: new Date().toISOString(), chart: rec.chart });
        while (history.length > HISTORY_LIMIT) history.shift();
      }
    }
    const next: SongRecord = { ...rec, name: info.title, chart, history, updatedAt: Date.now() };
    await this.writeRecord(next);
    return summarize(next, this.busy.has(id));
  }

  /** [04e] 파형을 저장한다(음원 저장소에 `<곡 id>:wave` 키로 따로 둔다. 곡 목록을 읽을 때 딸려 오지 않게). 옛 `<곡 id>:spectro` 는 쓰지 않는다. */
  async saveWave(id: string, wave: WaveMap): Promise<void> {
    try {
      await this.kv.put(STORE_AUDIO, `${id}:wave`, wave);
    } catch (err) {
      throw friendly(err);
    }
  }

  /** [04e] 저장된 파형 (없거나 깨졌으면 null) */
  async getWave(id: string): Promise<WaveMap | null> {
    const s = await this.kv.get(STORE_AUDIO, `${id}:wave`);
    return isValidWave(s) ? s : null;
  }

  /** 분석 결과를 저장한다. */
  async saveAnalysis(id: string, analysis: AnalysisResult): Promise<void> {
    const rec = await this.get(id, false);
    if (!rec) throw new StorageError('저장할 곡을 찾을 수 없습니다. 곡이 지워졌을 수 있습니다.');
    await this.writeRecord({ ...rec, analysis, updatedAt: Date.now() });
  }

  /** 음원 정보(길이 등)를 고친다. */
  async saveMeta(id: string, patch: Partial<AudioMeta>): Promise<void> {
    const rec = await this.get(id, false);
    if (!rec) return;
    await this.writeRecord({ ...rec, audioMeta: { ...rec.audioMeta, ...patch }, updatedAt: Date.now() });
  }

  /** 휴지통으로 보낸다(소프트 삭제). 분석 중인 곡은 거부. 성공하면 true */
  async trash(id: string): Promise<boolean> {
    if (this.busy.has(id)) return false;
    const rec = await this.get(id, false);
    if (!rec) return false;
    await this.writeRecord({ ...rec, trashedAt: Date.now() });
    return true;
  }

  /** 휴지통의 곡을 되돌린다. 같은 이름의 살아 있는 곡이 있으면 이름 뒤에 (2) 를 붙인다. 되돌린 곡을 돌려준다. */
  async restore(id: string): Promise<{ id: string; renamed: boolean } | null> {
    const rec = await this.get(id, false);
    if (!rec || !rec.trashedAt) return null;
    const live = await this.list(false);
    const names = new Set(live.map((s) => s.title));
    let name = rec.name;
    let renamed = false;
    if (names.has(rec.chart?.song?.title || rec.name)) {
      let n = 2;
      while (names.has(`${rec.name} (${n})`)) n++;
      name = `${rec.name} (${n})`;
      renamed = true;
    }
    const chart = rec.chart && renamed ? { ...rec.chart, song: { ...rec.chart.song, title: name } } : rec.chart;
    await this.writeRecord({ ...rec, name, chart, trashedAt: null, updatedAt: Date.now() });
    return { id, renamed };
  }

  /** 영구 삭제(되돌릴 수 없음). 휴지통에 있는 곡만 지운다. */
  async purge(id: string): Promise<boolean> {
    const rec = await this.get(id, false);
    if (!rec || !rec.trashedAt) return false;
    await this.kv.del(STORE_SONGS, id);
    await this.kv.del(STORE_AUDIO, id);
    await this.kv.del(STORE_AUDIO, `${id}:wave`).catch(() => undefined);
    await this.kv.del(STORE_AUDIO, `${id}:spectro`).catch(() => undefined); // 옛 주파수 표(04d)가 남아 있으면 같이 지운다
    return true;
  }
}

/** 남은 저장 공간 점검: 남은 용량이 적으면 안내 문구를, 괜찮거나 알 수 없으면 null 을 돌려준다. */
export async function storageWarning(minFreeBytes = 200 * 1024 * 1024): Promise<string | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.quota === undefined || est.usage === undefined) return null;
    const free = est.quota - est.usage;
    if (free < minFreeBytes) {
      return `이 기기의 남은 저장 공간이 약 ${Math.max(0, Math.round(free / 1024 / 1024))}MB 로 적습니다. 안 쓰는 곡을 지우거나 [내보내기]로 파일을 저장해 두세요.`;
    }
  } catch {
    /* 알 수 없으면 안내하지 않는다 */
  }
  return null;
}

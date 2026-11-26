/**
 * 저장소 테스트(02단계): songStore(메모리 어댑터), settingsStore, 체험용 데모 곡 합성.
 * IndexedDB 어댑터는 Node 에 IndexedDB 가 없으므로 브라우저 스모크 테스트(test\smoke02.mjs)가 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { newChart } from '../src/core/schema.ts';
import { DEFAULT_APP_SETTINGS, fromUserSettingsPatch, keyProblem, loadSettings, saveSettings, sanitizeAppSettings, toUserSettings } from '../src/storage/settingsStore.ts';
import type { KeyValueStorage } from '../src/storage/settingsStore.ts';
import { DEMO_NAME, encodeWav16, makeDemoFile, renderDemoSamples } from '../src/storage/demoSong.ts';
import { HISTORY_LIMIT, SongStore, StorageError, createMemoryAdapter } from '../src/storage/songStore.ts';
import type { AudioMeta } from '../src/storage/songStore.ts';

function memStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function meta(name: string, sha: string): AudioMeta {
  return { fileName: name + '.wav', mime: 'audio/wav', size: 4, sha256: sha, durationMs: 1000 };
}

async function addOne(store: SongStore, name: string, sha: string) {
  return store.addSong({ name, blob: new Blob([new Uint8Array([1, 2, 3, 4])]), meta: meta(name, sha), chart: newChart(name, '', name + '.wav', 1000) });
}

describe('songStore (메모리 어댑터)', () => {
  it('곡 추가 → 목록 → 열기(음원 Blob 포함)', async () => {
    const store = new SongStore(createMemoryAdapter());
    const rec = await addOne(store, '곡A', 'sha-a');
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(rec.id);
    expect(list[0]!.title).toBe('곡A');
    expect(list[0]!.has_audio).toBe(true);
    expect(list[0]!.analyzed).toBe(false);
    const full = await store.get(rec.id);
    expect(full?.audioBlob?.size).toBe(4);
    const light = await store.get(rec.id, false);
    expect(light?.audioBlob).toBeUndefined();
  });

  it('같은 SHA-256 은 findBySha 로 찾고, 휴지통의 곡은 찾지 않는다', async () => {
    const store = new SongStore(createMemoryAdapter());
    const rec = await addOne(store, '곡A', 'sha-a');
    expect((await store.findBySha('sha-a'))?.id).toBe(rec.id);
    expect(await store.findBySha('없음')).toBeNull();
    await store.trash(rec.id);
    expect(await store.findBySha('sha-a')).toBeNull();
  });

  it('채보 저장: 이전 버전을 최근 20개까지 보관하고, 같은 내용이면 쌓지 않는다', async () => {
    const store = new SongStore(createMemoryAdapter());
    const rec = await addOne(store, '곡A', 'sha-a');
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      const c = newChart('곡A', '', '곡A.wav', 1000);
      c.song.artist = '버전' + i;
      await store.saveChart(rec.id, c);
    }
    const after = await store.get(rec.id, false);
    expect(after!.history).toHaveLength(HISTORY_LIMIT);
    expect(after!.chart!.song.artist).toBe('버전' + (HISTORY_LIMIT + 5));
    expect(after!.history[0]!.chart.song.artist).toBe('버전' + 5);
    expect(after!.history[HISTORY_LIMIT - 1]!.chart.song.artist).toBe('버전' + (HISTORY_LIMIT + 4));
    await store.saveChart(rec.id, after!.chart!); // 같은 내용
    expect((await store.get(rec.id, false))!.history).toHaveLength(HISTORY_LIMIT);
  });

  it('소프트 삭제 → 휴지통 목록 → 복원 → 영구 삭제(휴지통에 있는 곡만)', async () => {
    const store = new SongStore(createMemoryAdapter());
    const a = await addOne(store, '곡A', 'sha-a');
    expect(await store.purge(a.id)).toBe(false); // 살아 있는 곡은 영구 삭제하지 않는다
    expect(await store.trash(a.id)).toBe(true);
    expect(await store.list()).toHaveLength(0);
    expect(await store.list(true)).toHaveLength(1);
    expect(await store.restore(a.id)).toEqual({ id: a.id, renamed: false });
    expect(await store.list()).toHaveLength(1);
    await store.trash(a.id);
    expect(await store.purge(a.id)).toBe(true);
    expect(await store.get(a.id)).toBeNull();
    expect(await store.restore('없는곡')).toBeNull();
  });

  it('분석 중인 곡은 휴지통으로 보내지 않는다', async () => {
    const store = new SongStore(createMemoryAdapter());
    const a = await addOne(store, '곡A', 'sha-a');
    store.busy.add(a.id);
    expect(await store.trash(a.id)).toBe(false);
    expect((await store.list())[0]!.analyzing).toBe(true);
  });

  it('같은 이름의 곡이 이미 있으면 복원할 때 (2)를 붙인다', async () => {
    const store = new SongStore(createMemoryAdapter());
    const a = await addOne(store, '곡A', 'sha-a');
    await store.trash(a.id);
    await addOne(store, '곡A', 'sha-b');
    const r = await store.restore(a.id);
    expect(r?.renamed).toBe(true);
    const titles = (await store.list()).map((s) => s.title).sort();
    expect(titles).toEqual(['곡A', '곡A (2)']);
  });

  it('저장 공간 부족은 쉬운 한국어 오류로 바뀐다', async () => {
    const base = createMemoryAdapter();
    const full = {
      ...base,
      put: async (): Promise<void> => {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      },
    };
    const store = new SongStore(full);
    await expect(addOne(store, '곡A', 'sha-a')).rejects.toBeInstanceOf(StorageError);
    await expect(addOne(store, '곡A', 'sha-a')).rejects.toThrow(/저장 공간이 부족/);
  });

  it('메모리 어댑터는 persistent=false (시크릿 모드 안내 근거)', () => {
    expect(new SongStore(createMemoryAdapter()).persistent).toBe(false);
  });
});

describe('settingsStore', () => {
  it('기본값·저장·불러오기·계약 모양', () => {
    const st = memStorage();
    expect(loadSettings(st)).toEqual(DEFAULT_APP_SETTINGS);
    const res = saveSettings({ inputDelayMs: 35, keys: { left: 'KeyA', right: 'KeyL' }, theme: 'dark' }, st);
    expect(res.settings.inputDelayMs).toBe(35);
    expect(st.data.has('rcw.settings.v1')).toBe(true);
    const back = loadSettings(st);
    expect(back.keys).toEqual({ left: 'KeyA', right: 'KeyL' });
    expect(back.theme).toBe('dark');
    for (const k of ['inputDelayMs', 'keys', 'fallTimeMs', 'hitSound', 'showJudgeDetail', 'theme']) expect(k in back).toBe(true);
  });

  it('범위를 벗어난 값·같은 키·쓸 수 없는 키는 고친다', () => {
    const c = sanitizeAppSettings({ inputDelayMs: 999, fallTimeMs: 10, musicVolume: 500, keys: { left: 'KeyS', right: 'KeyS' }, theme: 'bad' });
    expect(c.settings.inputDelayMs).toBe(500);
    expect(c.settings.fallTimeMs).toBe(500);
    expect(c.settings.musicVolume).toBe(100);
    expect(c.settings.keys).toEqual({ left: 'KeyS', right: 'KeyF' });
    expect(c.settings.theme).toBe('light'); // 04b: 기본 화면 모드는 화이트(원본 동작)
    expect(c.notes.length).toBeGreaterThan(0);
    expect(keyProblem('Space')).toMatch(/지정할 수 없습니다/);
    expect(keyProblem('KeyQ')).toBeNull();
  });

  it('깨진 저장값은 기본값으로', () => {
    const st = memStorage();
    st.data.set('rcw.settings.v1', '{깨짐');
    expect(loadSettings(st).inputDelayMs).toBe(0);
  });

  it('원본 테스트 팝업 설정 모양과 서로 변환된다', () => {
    const s = { ...DEFAULT_APP_SETTINGS, inputDelayMs: -20, fallTimeMs: 1500, musicVolume: 60, showJudgeDetail: false };
    const u = toUserSettings(s);
    expect(u).toEqual({ latency_ms: -20, key_left: 'KeyS', key_right: 'KeyF', show_diff: false, lead_ms: 1500, volume: 60 });
    expect(fromUserSettingsPatch({ latency_ms: 10, lead_ms: 900 })).toEqual({ inputDelayMs: 10, fallTimeMs: 900 });
  });
});

describe('체험용 데모 곡 (코드로 합성)', () => {
  it('30초 모노 소리가 만들어지고 같은 결과가 항상 나온다', () => {
    const a = renderDemoSamples(22050);
    const b = renderDemoSamples(22050);
    expect(a.length).toBe(22050 * 30);
    expect(Array.from(a.slice(1000, 1010))).toEqual(Array.from(b.slice(1000, 1010)));
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.91);
  });

  it('WAV 머리글이 올바르다', () => {
    const wav = encodeWav16(new Float32Array(100), 44100);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
    expect(wav.length).toBe(44 + 200);
  });

  it('데모 파일 이름과 형식', () => {
    const f = makeDemoFile();
    expect(f.name).toBe(`${DEMO_NAME}.wav`);
    expect(f.type).toBe('audio/wav');
    expect(f.size).toBe(44 + 44100 * 30 * 2);
  });
});

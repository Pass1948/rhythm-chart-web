/**
 * 04d: 로컬 API 쪽 새 기능 — 분석할 때 파형 저장, 예전 곡의 파형 채우기, 내보내기 3종 준비, ZIP 불러오기, 저장 위임.
 * 음원은 코드로 합성한 소리다(저장소는 메모리).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import { computeWave } from '../src/analysis/wave.ts';
import { renderDemoSamples, encodeWav16, DEMO_SAMPLE_RATE } from '../src/storage/demoSong.ts';
import { SongStore, createMemoryAdapter } from '../src/storage/songStore.ts';
import { readZip } from '../src/storage/zip.ts';
// @ts-ignore 편집기 쪽 JS(타입 검사 제외 대상)
import { api, configureLocalApi, waitForAnalysis } from '../src/app/localApi.js';

let store: SongStore;
let saved: { name: string; size: number }[] = [];
const samples22k = renderDemoSamples(22050, 12);
const wavBytes = encodeWav16(renderDemoSamples(DEMO_SAMPLE_RATE, 12), DEMO_SAMPLE_RATE);
const makeFile = (name = '합성곡.wav'): File => new File([wavBytes as BlobPart], name, { type: 'audio/wav' });

beforeEach(() => {
  saved = [];
  store = new SongStore(createMemoryAdapter());
  configureLocalApi({
    store,
    decode: async () => ({ durationMs: 12000, samples: samples22k }),
    analyzeFile: async (_f: Blob, opts: Record<string, unknown>, onProgress?: (p: number, l: string) => void) => analyzeAudio(samples22k, opts, onProgress),
    computeWave: (s: Float32Array, onProgress?: (f: number) => void) => computeWave(s, 22050, onProgress),
    cancelAnalysis: () => undefined,
    saveFile: async (t: { name: string; blob: Blob }) => {
      saved.push({ name: t.name, size: t.blob.size });
      return { status: 'saved', method: 'downloads', name: t.name, message: '저장했습니다' };
    },
    download: () => undefined,
    createObjectUrl: (b: Blob) => `blob:test/${b.size}`,
    revokeObjectUrl: () => undefined,
  });
});

describe('파형 저장', () => {
  it('분석하면 파형이 곡 데이터에 따로 저장되고, 분석 기록은 가볍게 유지된다', async () => {
    const info = await api.importFile(makeFile());
    await api.analyze({ song: info.id, detector: 'hybrid', sensitivity: 60 });
    await waitForAnalysis(info.id);
    const wv = await api.wave(info.id);
    expect(wv).not.toBeNull();
    expect(wv.data.length).toBe(wv.frames * 4);
    const analysis = await api.analysis(info.id);
    expect(analysis.wave).toBeUndefined();
  });

  it('파형이 없는 예전 곡은 열 때 한 번 계산해서 채운다', async () => {
    const info = await api.importFile(makeFile());
    expect(await api.wave(info.id)).toBeNull();
    const seen: number[] = [];
    const wv = await api.ensureWave(info.id, (f: number) => seen.push(f));
    expect(wv).not.toBeNull();
    expect((await api.wave(info.id)).frames).toBe(wv.frames);
    // 두 번째는 다시 계산하지 않고 저장분을 쓴다
    let calls = 0;
    configureLocalApi({ store, decode: async () => { calls++; return { durationMs: 1, samples: samples22k }; }, createObjectUrl: () => 'blob:x', revokeObjectUrl: () => undefined });
    await api.ensureWave(info.id);
    expect(calls).toBe(0);
  });
});

describe('내보내기 준비·저장·ZIP 불러오기', () => {
  it('3종 모두 파일 1개로 준비되고, 저장은 saveFile 한 곳을 거친다', async () => {
    const info = await api.importFile(makeFile('내 노래.wav'));
    const { chart } = await api.getChart(info.id);
    chart.song.title = '복원 시험';
    const a = await api.prepareExport({ song: info.id, chart, what: 'chart', kind: 'edit' });
    expect(a.files.map((f: { name: string }) => f.name)).toEqual(['복원 시험_편집용.json']);
    const b = await api.prepareExport({ song: info.id, chart, what: 'audio' });
    expect(b.files[0].name).toBe('복원 시험_음원.zip');
    const c = await api.prepareExport({ song: info.id, chart, what: 'both' });
    expect(c.files[0].name).toBe('복원 시험_채보+음원.zip');
    const names = (await readZip(c.files[0].blob)).map((e) => e.name);
    expect(names).toEqual(['채보.json', '내 노래.wav', '읽어보세요.txt']);
    const out = await api.saveExportFile(c.files[0], '내가 바꾼 이름.zip');
    expect(out.status).toBe('saved');
    expect(saved).toEqual([{ name: '내가 바꾼 이름.zip', size: c.files[0].size }]);
    await expect(api.prepareExport({ song: info.id, chart, what: 'video' })).rejects.toThrow('내보낼 것');
  });

  it('채보+음원 ZIP 을 읽으면 같은 음원과 채보가 나오고, JSON 이나 음원만 있는 파일도 구분한다', async () => {
    const info = await api.importFile(makeFile('복원.wav'));
    const { chart } = await api.getChart(info.id);
    const both = (await api.prepareExport({ song: info.id, chart, what: 'both' })).files[0];
    const bundle = await api.readBundle(new File([both.blob], 'x.zip'));
    expect(bundle.audio.name).toBe('복원.wav');
    expect(bundle.audio.blob.size).toBe(wavBytes.length);
    const loaded = await api.loadChart(JSON.parse(bundle.chartText));
    expect(loaded.chart.song.title).toBe(chart.song.title);
    // 음원만 있는 ZIP
    const onlyAudio = (await api.prepareExport({ song: info.id, chart, what: 'audio' })).files[0];
    const b2 = await api.readBundle(new File([onlyAudio.blob], 'a.zip'));
    expect(b2.chartText).toBeNull();
    // ZIP 이 아니면 null (JSON 은 기존 방식)
    expect(await api.readBundle(new File(['{"a":1}'], 'c.json'))).toBeNull();
    // 깨진 ZIP
    await expect(api.readBundle(new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], 'bad.zip'))).rejects.toThrow(/ZIP/);
  });
});

/**
 * 로컬 API 테스트(02단계): 곡 추가 → 분석 → 생성 → 저장 → 목록 → 삭제 → 복원 → 내보내기.
 * 메모리 저장소와 가짜 디코딩·다운로드를 끼워 Node 에서 돌린다(분석은 실제 분석 엔진을 직접 부른다).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import { AnalysisAborted } from '../src/analysis/dsp.ts';
import { renderDemoSamples, encodeWav16, DEMO_SAMPLE_RATE } from '../src/storage/demoSong.ts';
import { SongStore, createMemoryAdapter } from '../src/storage/songStore.ts';
// @ts-ignore 편집기 쪽 JS(타입 검사 제외 대상)
import { api, configureLocalApi, waitForAnalysis } from '../src/app/localApi.js';

type Dl = { name: string; text: string };
let downloads: Dl[] = [];
let store: SongStore;
let analyzeCalls = 0;

/** 30초 데모 소리(22050Hz)는 한 번만 만든다 */
const samples22k = renderDemoSamples(22050, 30);
const wavBytes = encodeWav16(renderDemoSamples(DEMO_SAMPLE_RATE, 30), DEMO_SAMPLE_RATE);

function makeFile(name = '테스트곡.wav'): File {
  return new File([wavBytes as BlobPart], name, { type: 'audio/wav' });
}

beforeEach(() => {
  downloads = [];
  analyzeCalls = 0;
  store = new SongStore(createMemoryAdapter());
  configureLocalApi({
    store,
    decode: async () => ({ durationMs: 30000 }),
    analyzeFile: async (_file: Blob, opts: Record<string, unknown>, onProgress?: (p: number, l: string) => void) => {
      analyzeCalls++;
      return analyzeAudio(samples22k, opts, onProgress);
    },
    cancelAnalysis: () => undefined,
    download: (name: string, text: string) => void downloads.push({ name, text }),
    createObjectUrl: (b: Blob) => `blob:test/${b.size}`,
    revokeObjectUrl: () => undefined,
  });
});

async function importAndAnalyze() {
  const info = await api.importFile(makeFile());
  const r = await api.analyze({ song: info.id, detector: 'hybrid', sensitivity: 60 });
  expect(r.started).toBe(true);
  await waitForAnalysis(info.id);
  return info;
}

describe('로컬 API: 곡 흐름', () => {
  it('곡 추가 → 목록 → 같은 파일은 이미 있는 곡으로 알려 줌', async () => {
    const info = await api.importFile(makeFile());
    expect(info.id).toBeTruthy();
    expect(info.title).toBe('테스트곡');
    expect(info.has_audio).toBe(true);
    expect(info.duration_ms).toBe(30000);
    const list = await api.songs();
    expect(list.songs).toHaveLength(1);
    const dup = await api.findDuplicate(makeFile('다른이름.wav'));
    expect(dup?.id).toBe(info.id);
    const again = await api.importFile(makeFile('다른이름.wav'));
    expect(again.id).toBe(info.id);
    expect((await api.songs()).songs).toHaveLength(1);
  });

  it('지원하지 않는 형식은 쉬운 안내', async () => {
    await expect(api.importFile(new File([new Uint8Array(10)], '문서.txt'))).rejects.toThrow(/지원하지 않는 파일 형식/);
  });

  it('디코딩 실패는 쉬운 안내(목록에 남지 않는다)', async () => {
    configureLocalApi({ store, decode: async () => { throw new Error('boom'); } });
    await expect(api.importFile(makeFile())).rejects.toThrow(/음원을 읽을 수 없습니다/);
    expect((await api.songs()).songs).toHaveLength(0);
  });

  it('audioUrl 은 곡을 올리거나 열 때 준비한 blob 주소를 돌려준다', async () => {
    const info = await api.importFile(makeFile());
    expect(api.audioUrl(info.id)).toMatch(/^blob:/);
    expect(() => api.audioUrl('없는곡')).toThrow(/음원을 아직 준비하지 못했습니다/);
    await api.getChart(info.id);
    expect(api.audioUrl(info.id)).toMatch(/^blob:/);
  });

  it('분석 → 상태 → 결과·파형 저장 → 노트 생성 → 검사 → 저장 → 다시 읽기', async () => {
    const info = await api.importFile(makeFile());
    expect(await api.analysis(info.id).catch((e: Error) => e.message)).toMatch(/분석 결과가 없습니다/);
    const r = await api.analyze({ song: info.id, detector: 'hybrid', sensitivity: 60 });
    expect(r).toEqual({ started: true, finished: false });
    const st = await api.status(info.id);
    expect(['running', 'done']).toContain(st.state);
    await waitForAnalysis(info.id);
    const done = await api.status(info.id);
    expect(done.state).toBe('done');
    expect(done.progress).toBe(100);

    const analysis = await api.analysis(info.id);
    expect(analysis.options.detector).toBe('hybrid');
    expect(analysis.song).toBe('테스트곡');
    expect(analysis.audio_sha256).toHaveLength(64);
    expect(analysis.candidate_count).toBeGreaterThan(10);
    const wave = await api.waveform(info.id);
    expect(wave.step_ms).toBe(10);
    expect(wave.max.length).toBeGreaterThan(100);
    expect(analysis.beats.bpm_candidates.some((c: { bpm: number }) => Math.abs(c.bpm - 120) < 1.5)).toBe(true);

    const gen = await api.generate({ song: info.id, difficulty: 'NORMAL', lane_mode: 'alternate', ratios: { tap: 70, hold: 20, burst: 10 }, hold_beats: 1, burst_count: 8, grid_division: 8 });
    expect(gen.stats.total).toBeGreaterThan(5);
    expect(gen.chart.song.audio_file).toBe('테스트곡.wav');
    expect(gen.chart.song.title).toBe('테스트곡');

    // 편집기가 하는 것처럼 채보에 노트를 합쳐 검사·저장
    const opened = await api.getChart(info.id);
    const chart = opened.chart;
    chart.difficulties = [gen.difficulty];
    chart.keyMode = gen.chart.keyMode;
    chart.lanes = gen.chart.lanes;
    chart.timing = gen.chart.timing;
    chart.song.audio_offset_ms = gen.chart.song.audio_offset_ms;
    const v = await api.validate(chart);
    expect(v.errors).toBe(0);
    const saved = await api.putChart(info.id, chart);
    expect(saved.saved).toBe(true);
    const list = await api.songs();
    expect(list.songs[0].note_count).toBe(gen.stats.total);
    expect(list.songs[0].analyzed).toBe(true);
    const back = await api.getChart(info.id);
    expect(back.chart.difficulties[0].notes).toHaveLength(gen.stats.total);
    expect(back.chart.meta.saved_at).toBeTruthy();
  });

  it('같은 설정으로 다시 분석하면 계산하지 않고 바로 끝난다(박자 직접 입력은 반영)', async () => {
    const info = await importAndAnalyze();
    expect(analyzeCalls).toBe(1);
    const r = await api.analyze({ song: info.id, detector: 'hybrid', sensitivity: 60 });
    expect(r).toEqual({ started: false, finished: true });
    expect(analyzeCalls).toBe(1);
    const m = await api.analyze({ song: info.id, detector: 'hybrid', sensitivity: 60, manual: { bpm: 100, audio_offset_ms: -50 } });
    expect(m.finished).toBe(true);
    const a = await api.analysis(info.id);
    expect(a.timing.source).toBe('manual');
    expect(a.timing.bpm).toBe(100);
    expect(a.timing.audio_offset_ms).toBe(-50);
    expect(a.grid_fit.total).toBe(a.candidate_count);
    // 설정이 바뀌면 새로 분석하고, 직접 입력한 박자는 유지한다
    const c = await api.analyze({ song: info.id, detector: 'hybrid', sensitivity: 80 });
    expect(c.started).toBe(true);
    await waitForAnalysis(info.id);
    expect(analyzeCalls).toBe(2);
    expect((await api.analysis(info.id)).timing.bpm).toBe(100);
  });

  it('분석 취소: 상태가 canceled 가 되고 결과를 저장하지 않는다', async () => {
    let reject: (e: unknown) => void = () => undefined;
    configureLocalApi({
      store,
      decode: async () => ({ durationMs: 30000 }),
      analyzeFile: () => new Promise((_ok, no) => { reject = no; }),
      cancelAnalysis: () => reject(new AnalysisAborted()),
      download: () => undefined,
      createObjectUrl: () => 'blob:x',
      revokeObjectUrl: () => undefined,
    });
    const info = await api.importFile(makeFile());
    await api.analyze({ song: info.id, detector: 'drums', sensitivity: 60 });
    expect((await api.status(info.id)).state).toBe('running');
    expect((await api.songs()).songs[0].analyzing).toBe(true);
    expect(await api.cancel(info.id)).toEqual({ canceled: true });
    await waitForAnalysis(info.id);
    expect((await api.status(info.id)).state).toBe('canceled');
    await expect(api.analysis(info.id)).rejects.toThrow(/분석 결과가 없습니다/);
    expect((await api.songs()).songs[0].analyzing).toBe(false);
  });

  it('분석 오류는 쉬운 한국어로 status 에 남는다', async () => {
    configureLocalApi({ store, decode: async () => ({ durationMs: 1000 }), analyzeFile: async () => { throw new Error('소리가 없습니다.'); }, cancelAnalysis: () => undefined, download: () => undefined, createObjectUrl: () => 'blob:x', revokeObjectUrl: () => undefined });
    const info = await api.importFile(makeFile());
    await api.analyze({ song: info.id });
    await waitForAnalysis(info.id);
    const st = await api.status(info.id);
    expect(st.state).toBe('error');
    expect(st.error).toBe('소리가 없습니다.');
  });

  it('분석 방식 프리셋의 최소 간격이 옵션에 반영된다(드럼 70ms)', async () => {
    const seen: Record<string, unknown>[] = [];
    configureLocalApi({
      store,
      decode: async () => ({ durationMs: 30000 }),
      analyzeFile: async (_f: Blob, opts: Record<string, unknown>) => { seen.push(opts); return analyzeAudio(samples22k, opts); },
      cancelAnalysis: () => undefined, download: () => undefined, createObjectUrl: () => 'blob:x', revokeObjectUrl: () => undefined,
    });
    const info = await api.importFile(makeFile());
    await api.analyze({ song: info.id, detector: 'drums', sensitivity: 60 });
    await waitForAnalysis(info.id);
    expect(seen[0]!.minGapMs).toBe(70);
    expect((await api.analysis(info.id)).options.detector).toBe('drums');
  });

  it('presets 에 분석 방식 5개(종합·베이스·드럼·멜로디·보컬)가 있다', async () => {
    const p = await api.presets();
    const ids = p.presets.filter((x: { enabled: boolean }) => x.enabled).map((x: { id: string }) => x.id);
    for (const id of ['mix', 'bass', 'drums', 'melody', 'vocal']) expect(ids).toContain(id);
    expect(Object.keys(p.detectors)).toEqual(expect.arrayContaining(['hybrid', 'bass', 'drums', 'melody', 'vocal']));
    const cfg = await api.config();
    expect(cfg.judge.perfect_ms).toBeGreaterThan(0);
    expect(cfg.validate.max_burst_per_sec).toBeGreaterThan(0);
  });

  it('곡 삭제(휴지통) → 목록에서 사라짐 → 복원', async () => {
    const info = await api.importFile(makeFile());
    const res = await api.deleteSongs([info.id, '없는곡']);
    expect(res.moved).toBe(1);
    expect(res.results[0]).toMatchObject({ song: info.id, status: 'moved', trash: info.id });
    expect(res.results[1].status).toBe('missing');
    expect((await api.songs()).songs).toHaveLength(0);
    expect((await api.trashSongs()).songs).toHaveLength(1);
    const back = await api.restoreSong(info.id);
    expect(back).toEqual({ song: info.id, renamed: false });
    expect((await api.songs()).songs).toHaveLength(1);
    await expect(api.restoreSong('없는곡')).rejects.toThrow(/찾을 수 없습니다/);
  });

  it('분석 중인 곡은 지우지 않는다', async () => {
    let reject: (e: unknown) => void = () => undefined;
    configureLocalApi({ store, decode: async () => ({ durationMs: 1000 }), analyzeFile: () => new Promise((_o, no) => { reject = no; }), cancelAnalysis: () => reject(new AnalysisAborted()), download: () => undefined, createObjectUrl: () => 'blob:x', revokeObjectUrl: () => undefined });
    const info = await api.importFile(makeFile());
    await api.analyze({ song: info.id });
    const res = await api.deleteSongs([info.id]);
    expect(res.moved).toBe(0);
    expect(res.results[0].status).toBe('skipped');
    await api.cancel(info.id);
    await waitForAnalysis(info.id);
  });
});

describe('로컬 API: 채보 도구와 내보내기', () => {
  it('retime·loadChart·validate 가 원본 모양으로 돌아온다', async () => {
    const info = await api.importFile(makeFile());
    const { chart } = await api.getChart(info.id);
    const rt = await api.retime({ chart, bpm_map: [{ tick: 0, bpm: 90, beats_per_bar: 4, beat_unit: 4 }], audio_offset_ms: 10, mode: 'time' });
    expect(rt.chart.timing.bpm_map[0].bpm).toBe(90);
    expect(Array.isArray(rt.messages)).toBe(true);
    const loaded = await api.loadChart(JSON.parse(JSON.stringify(chart)));
    expect(loaded.chart.schema_version).toBe(2);
    expect(loaded).toHaveProperty('converted_from');
    await expect(api.loadChart({ schema_version: 99 })).rejects.toThrow();
    const v = await api.validate(chart);
    expect(v).toHaveProperty('errors');
    expect(v).toHaveProperty('issues');
  });

  it('내보내기: 편집용·Unity용 파일이 다운로드로 나가고, 오류가 있으면 Unity용은 막는다', async () => {
    const info = await importAndAnalyze();
    const gen = await api.generate({ song: info.id, difficulty: 'NORMAL', grid_division: 8 });
    const { chart } = await api.getChart(info.id);
    chart.difficulties = [gen.difficulty];
    chart.keyMode = gen.chart.keyMode;
    chart.lanes = gen.chart.lanes;
    chart.timing = gen.chart.timing;
    chart.song.audio_offset_ms = gen.chart.song.audio_offset_ms;

    const edit = await api.exportChart({ song: info.id, chart, kind: 'edit' });
    expect(edit.exported).toEqual(['테스트곡_편집용.json']);
    expect(JSON.parse(downloads[0]!.text).schema_version).toBe(2);

    const unity = await api.exportChart({ song: info.id, chart, kind: 'unity', split: false });
    expect(unity.exported).toEqual(['테스트곡_unity.json']);
    const u = JSON.parse(downloads[1]!.text);
    expect(u.format).toBe('four-key-unity.v2');
    expect(u.difficulties[0].notes).toHaveLength(gen.stats.total);
    expect(u.difficulties[0].notes.every((n: { time_ms: number }) => Number.isInteger(n.time_ms))).toBe(true);

    const split = await api.exportChart({ song: info.id, chart, kind: 'unity', split: true });
    expect(split.exported).toEqual(['테스트곡_NORMAL.json']);

    // 오류가 있는 채보(같은 자리 노트 2개) → Unity용 422
    const bad = JSON.parse(JSON.stringify(chart));
    bad.difficulties[0].notes.push({ ...bad.difficulties[0].notes[0], id: 99999 });
    const before = downloads.length;
    await expect(api.exportChart({ song: info.id, chart: bad, kind: 'unity' })).rejects.toMatchObject({ status: 422 });
    expect(downloads.length).toBe(before);
    // 편집용은 오류가 있어도 내보낼 수 있다
    await api.exportChart({ song: info.id, chart: bad, kind: 'edit' });
    expect(downloads.length).toBe(before + 1);
    await expect(api.exportChart({ song: info.id, chart, kind: 'zip' })).rejects.toThrow(/내보내기 종류/);
  });

  it('서버 개념(shutdown·alive·analyzer*)은 항상 준비됨 값을 돌려준다', async () => {
    expect((await api.analyzer()).state).toBe('on');
    expect((await api.analyzerOn()).state).toBe('on');
    expect((await api.analyzerOff(true)).state).toBe('on');
    expect(await api.alive()).toBeTruthy();
    expect(await api.shutdown()).toBeTruthy();
  });

  it('사용자 설정: 불러오기·바꾼 항목 저장·쓸 수 없는 키 거부', async () => {
    const s0 = await api.userSettings();
    expect(s0.settings).toMatchObject({ key_left: 'KeyS', key_right: 'KeyF', latency_ms: 0 });
    const s1 = await api.saveUserSettings({ latency_ms: 40, lead_ms: 1200 });
    expect(s1.settings.latency_ms).toBe(40);
    expect(s1.settings.lead_ms).toBe(1200);
    expect((await api.userSettings()).settings.latency_ms).toBe(40);
    await expect(api.saveUserSettings({ key_left: 'Space' })).rejects.toThrow(/지정할 수 없습니다/);
    await api.saveUserSettings({ latency_ms: 0, lead_ms: 1800 });
  });
});

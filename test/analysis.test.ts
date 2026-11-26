/**
 * 분석 엔진 테스트: DSP 도구, 합성 음원(120BPM) 분석, 취소, 옵션 검사, 원본 결과와의 비교(원본 분석 캐시가 있을 때).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeAudio, normalizeOptions } from '../src/analysis/analyze.ts';
import { bpmCandidates, fitGrid, gridFitStats, normalizedAutocorr, refineWithOnsets } from '../src/analysis/beats.ts';
import { computeFeatures, normalize, pickPeaks } from '../src/analysis/detect.ts';
import { AnalysisAborted, Fft, autocorrelate, biquadFilter, butterHigh2, butterLow2, hannWindow, median, percentile } from '../src/analysis/dsp.ts';
import { buildWaveform, decodeToMono22k, finalizeMono, waveformSummary } from '../src/analysis/prepare.ts';
import { AnalysisError } from '../src/analysis/types.ts';
import type { Candidate } from '../src/analysis/types.ts';
import { makeSyntheticDrums, matchOnsets, phaseDiffMs, readNpyFloat32 } from '../tools/lib.ts';

describe('DSP 기본 도구', () => {
  it('FFT 가 느린 DFT 와 같은 값을 낸다', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.9) + (i % 5) * 0.1);
    for (let i = 0; i < n; i++) re[i] = x[i]!;
    new Fft(n).transform(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        sr += x[t]! * Math.cos((2 * Math.PI * k * t) / n);
        si -= x[t]! * Math.sin((2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(sr, 8);
      expect(im[k]).toBeCloseTo(si, 8);
    }
    expect(() => new Fft(100)).toThrow();
  });

  it('한 창·백분위·중앙값은 numpy 와 같다', () => {
    const w = hannWindow(8);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[4]).toBeCloseTo(1, 12);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBeCloseTo(4.6, 12);
    expect(percentile([1, 2, 3, 4], 75)).toBeCloseTo(3.25, 12);
    expect(median([3, 1, 2, 10])).toBeCloseTo(2.5, 12);
  });

  it('2차 버터워스: 저역은 낮은 소리만, 고역은 높은 소리만 통과', () => {
    const sr = 22050;
    const tone = (f: number): Float32Array => Float32Array.from({ length: sr }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr));
    const rms = (a: Float32Array): number => Math.sqrt(a.slice(5000).reduce((s, v) => s + v * v, 0) / (a.length - 5000));
    const low = butterLow2(300, sr);
    expect(rms(biquadFilter(tone(60), low)) / rms(tone(60))).toBeGreaterThan(0.95);
    expect(rms(biquadFilter(tone(3000), low)) / rms(tone(3000))).toBeLessThan(0.05);
    expect(rms(biquadFilter(tone(300), low)) / rms(tone(300))).toBeCloseTo(Math.SQRT1_2, 2); // 차단 주파수에서 -3dB
    const high = butterHigh2(1500, sr);
    expect(rms(biquadFilter(tone(5000), high)) / rms(tone(5000))).toBeGreaterThan(0.95);
    expect(rms(biquadFilter(tone(100), high)) / rms(tone(100))).toBeLessThan(0.02);
  });

  it('자기상관: 주기 신호의 주기에서 피크', () => {
    const x = Float64Array.from({ length: 2000 }, (_, i) => (i % 50 === 0 ? 1 : 0));
    const ac = autocorrelate(x, 120);
    expect(ac[50]!).toBeGreaterThan(ac[25]!);
    expect(ac[100]!).toBeGreaterThan(ac[75]!);
  });

  it('지역 평균 보정과 피크 선택', () => {
    const v = new Float32Array(2000);
    for (let i = 100; i < 2000; i += 100) v[i] = 1;
    const nv = normalize(v);
    expect(nv[100]!).toBeGreaterThan(0.5);
    const peaks = pickPeaks(nv, 60, 75);
    expect(peaks.length).toBeGreaterThan(10);
    expect(Math.abs(peaks[3]![0] - 400)).toBeLessThan(1);
    expect(pickPeaks(new Float32Array(5)).length).toBe(0);
  });
});

describe('입력 준비', () => {
  it('최대 진폭을 0.99로 맞춘다', () => {
    const raw = Float32Array.from({ length: 22050 }, (_, i) => 0.2 * Math.sin(i / 20));
    const d = finalizeMono(raw);
    let peak = 0;
    for (const v of d.samples) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.99, 4);
    expect(d.sampleRate).toBe(22050);
    expect(d.durationMs).toBeCloseTo(1000, 6);
  });
  it('너무 짧거나 무음이면 쉬운 한국어 안내', () => {
    expect(() => finalizeMono(new Float32Array(100))).toThrow(AnalysisError);
    expect(() => finalizeMono(new Float32Array(30000))).toThrow('무음');
  });
  it('디코딩 실패는 파일 형식 안내 (브라우저 기능이 없으면 그 안내)', async () => {
    await expect(decodeToMono22k(new ArrayBuffer(100))).rejects.toBeInstanceOf(AnalysisError);
  });
  it('파형 요약', () => {
    const s = Float32Array.from({ length: 22050 }, (_, i) => Math.sin(i / 30));
    const w = buildWaveform(s, 100);
    expect(w.length).toBe(200);
    expect(w[1]!).toBeGreaterThan(0);
    const summary = waveformSummary(s, 22050, 10);
    expect(summary.min.length).toBe(100);
    expect(summary.step_ms).toBe(10);
  });
});

describe('옵션 검사', () => {
  it('기본값과 범위', () => {
    const o = normalizeOptions({});
    expect(o.detector).toBe('hybrid');
    expect(o.sensitivity).toBe(60);
    expect(o.minGapMs).toBe(75);
    expect(normalizeOptions({ sensitivity: 5, minGapMs: 9999 })).toMatchObject({ sensitivity: 10, minGapMs: 500 });
  });
  it('모르는 방식·잘못된 BPM 은 한국어 오류 (드럼·멜로디·보컬은 01b에서 등록되어 통과)', () => {
    expect(() => normalizeOptions({ detector: 'nope' as never })).toThrow('알 수 없는');
    expect(normalizeOptions({ detector: 'drums' }).detector).toBe('drums');
    expect(() => normalizeOptions({ manual: { bpm: 10 } })).toThrow('40~300');
    expect(normalizeOptions({ manual: { bpm: 128 } }).manual).toEqual({ bpm: 128, audio_offset_ms: null });
  });
});

describe('합성 음원 분석 (코드로 만든 킥·스네어·하이햇)', () => {
  const synth = makeSyntheticDrums({ bpm: 120, seconds: 45, startMs: 300 });
  const uniqueHits = [...new Set(synth.hits.map((h) => Math.round(h)))];

  it('BPM 120 ± 0.5, 시작 위치와 소리 시작 지점 재현율', async () => {
    const progress: number[] = [];
    const res = await analyzeAudio(synth.samples, { detector: 'hybrid', sensitivity: 60, minGapMs: 75 }, (p) => progress.push(p));
    const bpm = res.timing.bpm;
    const ok = Math.abs(bpm - 120) <= 0.5 || Math.abs(bpm * 2 - 120) <= 0.5 || Math.abs(bpm / 2 - 120) <= 0.5;
    expect(ok).toBe(true);
    expect(Math.abs(bpm - 120)).toBeLessThanOrEqual(0.5);
    // 첫 박(300ms)이 음원 0ms 기준 audio_offset 으로 표현되는지: 박 간격으로 나눈 나머지가 같아야 한다
    expect(Math.abs(phaseDiffMs(res.timing.audio_offset_ms, 300 - 500, 500))).toBeLessThan(15);
    const m = matchOnsets(uniqueHits, res.candidates.map((c) => c.time_ms), 50);
    expect(m.recall).toBeGreaterThan(0.9);
    expect(m.precision).toBeGreaterThan(0.9);
    expect(res.grid_fit.percent).toBeGreaterThan(90);
    expect(res.timing.source).toBe('auto');
    expect(res.beats.bpm_candidates.map((c) => c.kind)).toEqual(expect.arrayContaining(['주 후보', '반 박', '두 배 박']));
    // 진행률: 0~1 안에서 늘어나다가 마지막에 1
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((p) => p >= 0 && p <= 1)).toBe(true);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    expect(res.waveform.min.length).toBeGreaterThan(100);
  });

  it('다른 BPM(90, 150)도 맞게 찾는다 (÷2·×2 관계 허용)', async () => {
    for (const bpm of [90, 150]) {
      const s = makeSyntheticDrums({ bpm, seconds: 40, startMs: 200 });
      const res = await analyzeAudio(s.samples, {});
      const got = res.timing.bpm;
      const ok = [1, 2, 0.5].some((r) => Math.abs(got * r - bpm) <= 0.5);
      expect(ok, `BPM ${bpm} → ${got}`).toBe(true);
    }
  });

  it('직접 입력한 BPM 은 자동 값을 덮어쓴다(source=manual)', async () => {
    const res = await analyzeAudio(synth.samples, { manual: { bpm: 121 } });
    expect(res.timing.source).toBe('manual');
    expect(res.timing.bpm).toBe(121);
    expect(res.timing.auto.bpm).toBeCloseTo(120, 0);
    expect(res.timing.audio_offset_ms).toBe(res.timing.auto.audio_offset_ms); // 시작 위치를 안 줬으면 자동 값
  });

  it('같은 소리·같은 옵션이면 같은 결과', async () => {
    const a = await analyzeAudio(synth.samples, {});
    const b = await analyzeAudio(synth.samples, {});
    expect(JSON.stringify({ ...a, created_at: '' })).toBe(JSON.stringify({ ...b, created_at: '' }));
  });
});

describe('취소', () => {
  const s = makeSyntheticDrums({ bpm: 120, seconds: 20, startMs: 300 }).samples;
  it('시작 전에 취소하면 바로 멈춘다', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(analyzeAudio(s, {}, undefined, ac.signal)).rejects.toBeInstanceOf(AnalysisAborted);
  });
  it('분석 도중 취소하면 다음 단계에서 멈춘다', async () => {
    const ac = new AbortController();
    const p = analyzeAudio(
      s,
      {},
      (frac) => {
        if (frac > 0.1) ac.abort();
      },
      ac.signal,
    );
    await expect(p).rejects.toBeInstanceOf(AnalysisAborted);
  });
});

describe('박자 도구', () => {
  it('fitGrid: 흔들린 박 시각에서 정밀 BPM 과 위상', () => {
    const beats = Array.from({ length: 80 }, (_, k) => 300 + k * 500 + (k % 3 === 0 ? 8 : -4));
    const [bpm, phase] = fitGrid(beats, 119.9);
    expect(bpm).toBeCloseTo(120, 0);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(500.5);
    expect(fitGrid([1, 2], 100)).toEqual([100, 0.0]);
  });
  it('bpmCandidates: 주 후보 + 반 박 + 두 배 박(+3/2, 2/3) 이고 신뢰도는 0~1', () => {
    const ac = new Float64Array(700).map((_, i) => (i % 100 === 0 ? 1 : 0.1));
    const list = bpmCandidates(ac, 120);
    expect(list.map((c) => c.kind).slice(0, 3)).toEqual(['주 후보', '반 박', '두 배 박']);
    expect(list.every((c) => c.confidence >= 0 && c.confidence <= 1)).toBe(true);
  });
  it('refineWithOnsets: 격자에 가장 잘 맞는 BPM 으로 다듬는다', () => {
    const cands: Candidate[] = Array.from({ length: 200 }, (_, k) => ({ time_ms: 100 + k * 250.5, strength: 1, band: 'low', duration_ms: 0 }));
    const [bpm] = refineWithOnsets(cands, 119, 0);
    expect(bpm).toBeCloseTo(60000 / (250.5 * 2), 0); // 8분 단위 250.5ms → 박 501ms(119.76BPM)
    expect(refineWithOnsets(cands.slice(0, 5), 120, 7)).toEqual([120, 7]);
  });
  it('gridFitStats', () => {
    const g = gridFitStats([0, 250, 500, 760], 120, 0, 30, 8);
    expect(g.total).toBe(4);
    expect(g.fit).toBe(4);
    expect(gridFitStats([], 120, 0).percent).toBe(0);
  });
  it('normalizedAutocorr: lag 0 은 1', () => {
    const v = Float32Array.from({ length: 3000 }, (_, i) => (i % 100 === 0 ? 1 : 0));
    expect(normalizedAutocorr(v)[0]).toBeCloseTo(1, 9);
  });
});

// ---------- 원본(Python) 결과와 비교: 원본 분석 캐시와 기준 결과가 있을 때만 실행 ----------
const REF_DIR = resolve('log/ref_python/out');
const manifestPath = resolve(REF_DIR, 'manifest.json');
const hasRef = existsSync(manifestPath);
describe.skipIf(!hasRef)('원본 결과와 비교 (가장 짧은 곡 1개)', () => {
  it('소리 시작 지점 F1 ≥ 0.85, BPM 일치(±0.5 또는 ×2·÷2)', async () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id: string; name: string; samples: number }[];
    const m = [...manifest].sort((a, b) => a.samples - b.samples)[0]!;
    const npy = `D:/MusicNoteDesignProgram/projects/${m.name}/analysis/audio22k.npy`;
    if (!existsSync(npy)) return;
    const ref = JSON.parse(readFileSync(resolve(REF_DIR, `${m.id}_analysis.json`), 'utf8')) as { candidates: { time_ms: number }[]; timing: { bpm: number } };
    const res = await analyzeAudio(readNpyFloat32(npy), { detector: 'hybrid', sensitivity: 60, minGapMs: 75 });
    const mt = matchOnsets(ref.candidates.map((c) => c.time_ms), res.candidates.map((c) => c.time_ms), 50);
    expect(mt.f1).toBeGreaterThanOrEqual(0.85);
    expect([1, 2, 0.5].some((r) => Math.abs(res.timing.bpm * r - ref.timing.bpm) <= 0.5)).toBe(true);
  });
});

describe('특징값', () => {
  it('프레임 수 = 1 + 길이/110, 검출 함수 5종', () => {
    const s = makeSyntheticDrums({ bpm: 120, seconds: 3, startMs: 100 }).samples;
    const f = computeFeatures(s);
    expect(f.frames).toBe(1 + Math.floor(s.length / 110));
    expect(f.novelty.length).toBe(5);
    expect(f.bandFlux.length).toBe(3);
    expect(f.envDb[0]!.length).toBe(f.frames);
  });
});

describe('분석 모드 등록소 (01b가 쓸 자리)', () => {
  it('등록하지 않은 방식은 알 수 없는 방식 오류, 등록하면 그 방식의 후보를 쓴다(덮어쓰기도 가능)', async () => {
    const { registerMode } = await import('../src/analysis/modeRegistry.ts');
    const s = makeSyntheticDrums({ bpm: 120, seconds: 12, startMs: 300 }).samples;
    await expect(analyzeAudio(s, { detector: 'nope' as never })).rejects.toThrow('알 수 없는');
    registerMode('melody', () => ({ candidates: [{ time_ms: 1000, strength: 1, band: 'mid', duration_ms: 200 }], warnings: ['시험 모드입니다.'] }));
    const res = await analyzeAudio(s, { detector: 'melody' });
    expect(res.candidates).toEqual([{ time_ms: 1000, strength: 1, band: 'mid', duration_ms: 200 }]);
    expect(res.options.detector).toBe('melody');
    expect(res.warnings).toContain('시험 모드입니다.');
  });
});

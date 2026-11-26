/**
 * 분석 모드 테스트(01b): 슬라이딩 중앙값·HPSS 정확성, 합성 음원에서 드럼/멜로디/보컬 모드가 의도한 쪽을 우선 검출하는지,
 * 같은 입력이면 같은 결과, 진행률·취소·안내 문구, presets.json 항목.
 * 합성 음원은 메모리에서만 만든다(파일 없음).
 */
import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import { AnalysisAborted, median } from '../src/analysis/dsp.ts';
import { HPSS, APPROX_NOTICE, MONO_VOCAL_NOTICE } from '../src/analysis/modes/modeConfig.ts';
import { runHpss } from '../src/analysis/modes/hpss.ts';
import { medianFilter1d, replaceSorted } from '../src/analysis/modes/slidingMedian.ts';
import { BINS, MonoSpectrumStream } from '../src/analysis/modes/stft.ts';
import { decodeStereo22k } from '../src/analysis/modes/decodeStereo22k.ts';
import { analyzeAudioWithMode } from '../src/analysis/modes/analyzeWithMode.ts';
import { withStereo } from '../src/analysis/modes/vocal.ts';
import { registeredModes } from '../src/analysis/modeRegistry.ts';
import { AnalysisError } from '../src/analysis/types.ts';
import presets from '../config/presets.json' with { type: 'json' };
import { matchOnsets } from './synth.ts';
import { makeDrumMelody } from './synthModes.ts';

/** 같은 시각 중복(킥+스네어가 같은 시각)을 하나로 줄인다 */
function unique(ms: number[]): number[] {
  return [...new Set(ms.map((t) => Math.round(t)))].sort((a, b) => a - b);
}

/** 결정적 난수(0~1) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('슬라이딩 중앙값', () => {
  it('replaceSorted: 하나 빼고 하나 넣어도 정렬이 유지된다', () => {
    const r = rng(1);
    const size = 9;
    const vals = Array.from({ length: size }, () => r());
    const w = Float32Array.from(vals).sort();
    const bag = [...w];
    for (let n = 0; n < 200; n++) {
      const oldV = bag[Math.floor(r() * size)]!;
      const newV = Math.fround(r());
      replaceSorted(w, 0, size, oldV, newV);
      bag.splice(bag.indexOf(oldV), 1, newV);
      expect([...w]).toEqual([...bag].sort((a, b) => a - b));
    }
  });

  it('medianFilter1d: 가장자리를 끝 값으로 채운 단순 계산과 같다', () => {
    const r = rng(7);
    const x = Float32Array.from({ length: 50 }, () => Math.fround(r()));
    for (const size of [3, 5, 9, 17]) {
      const out = new Float32Array(x.length);
      medianFilter1d(x, out, size, new Float32Array(size));
      const h = (size - 1) / 2;
      for (let i = 0; i < x.length; i++) {
        const win: number[] = [];
        for (let j = i - h; j <= i + h; j++) win.push(x[Math.min(x.length - 1, Math.max(0, j))]!);
        expect(out[i]).toBeCloseTo(median(win), 6);
      }
    }
  });
});

describe('HPSS (타악·화음 나누기)', () => {
  it('스트림 계산이 정의대로(시간 창 중앙값·주파수 창 중앙값·소프트 마스크)의 단순 계산과 같다', () => {
    // 짧은 소리에서 모든 프레임의 스펙트로그램을 모아 두고, 일부 프레임·빈에서 중앙값을 직접 계산해 비교한다
    const r = rng(3);
    const y = Float32Array.from({ length: 22050 }, (_, i) => 0.3 * Math.sin(i * 0.05) + 0.2 * (r() - 0.5) + (i % 5000 < 40 ? 0.8 : 0));
    const stream = new MonoSpectrumStream(y);
    const S: Float32Array[] = [];
    for (;;) {
      const row = new Float32Array(BINS);
      if (!stream.read(row)) break;
      S.push(row);
    }
    const F = S.length;
    const params = { timeWindow: 9, freqWindow: 7, maskPower: 2 };
    const rt = 4;
    const rf = 3;
    const frames: { perc: Float32Array; harm: Float32Array }[] = [];
    runHpss(y, (f) => frames.push({ perc: Float32Array.from(f.perc), harm: Float32Array.from(f.harm) }), undefined, undefined, params);
    expect(frames.length).toBe(F);
    for (const c of [0, 1, 3, 10, 55, F - 5, F - 1]) {
      for (const k of [0, 2, 30, 100, 300, 512]) {
        const tWin: number[] = [];
        for (let j = c - rt; j <= c + rt; j++) tWin.push(S[Math.min(F - 1, Math.max(0, j))]![k]!);
        const fWin: number[] = [];
        for (let j = k - rf; j <= k + rf; j++) fWin.push(S[c]![Math.min(BINS - 1, Math.max(0, j))]!);
        const h = median(tWin);
        const p = median(fWin);
        const maskP = (p * p) / (h * h + p * p + HPSS.eps);
        expect(frames[c]!.perc[k]).toBeCloseTo(S[c]![k]! * maskP, 4);
        expect(frames[c]!.harm[k]! + frames[c]!.perc[k]!).toBeCloseTo(S[c]![k]!, 4);
      }
    }
  });

  it('이어지는 사인파는 화음 쪽, 짧은 클릭은 타악 쪽으로 나뉜다', () => {
    const sr = 22050;
    const y = new Float32Array(sr * 3);
    for (let i = 0; i < y.length; i++) y[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr);
    const clickAt = Math.floor(1.5 * sr);
    for (let i = 0; i < 30; i++) y[clickAt + i]! += (i % 2 === 0 ? 1 : -1) * 0.9;
    let percTone = 0;
    let harmTone = 0;
    let percClick = 0;
    let harmClick = 0;
    const clickFrame = Math.round(clickAt / 110);
    runHpss(y, (f) => {
      if (f.t === 100) {
        for (let k = 0; k < BINS; k++) {
          percTone += f.perc[k]!;
          harmTone += f.harm[k]!;
        }
      }
      if (f.t === clickFrame) {
        for (let k = 0; k < BINS; k++) {
          percClick += f.perc[k]!;
          harmClick += f.harm[k]!;
        }
      }
    });
    expect(harmTone).toBeGreaterThan(percTone * 3);
    expect(percClick).toBeGreaterThan(harmClick * 1.5);
  });
});

describe('합성 음원: 드럼 + 멜로디', () => {
  const d = makeDrumMelody({ seconds: 40 });
  const drumHits = unique(d.drumHits);

  it('드럼 모드는 드럼 위치를, 멜로디 모드는 멜로디 음 위치를 우선 뽑는다', async () => {
    const dr = await analyzeAudio(d.samples, { detector: 'drums' });
    const me = await analyzeAudio(d.samples, { detector: 'melody' });
    const drT = dr.candidates.map((c) => c.time_ms);
    const meT = me.candidates.map((c) => c.time_ms);
    const drDrum = matchOnsets(drumHits, drT, 50);
    const drMel = matchOnsets(d.melodyOnsets, drT, 50);
    const meDrum = matchOnsets(drumHits, meT, 50);
    const meMel = matchOnsets(d.melodyOnsets, meT, 50);
    // 드럼 모드: 드럼은 대부분 잡고 멜로디 음은 거의 잡지 않는다
    expect(drDrum.recall).toBeGreaterThan(0.75);
    expect(drDrum.precision).toBeGreaterThan(0.85);
    expect(drMel.recall).toBeLessThan(0.25);
    // 멜로디 모드: 멜로디 음은 거의 다 잡고 드럼은 훨씬 적게 잡는다
    expect(meMel.recall).toBeGreaterThan(0.9);
    expect(meDrum.recall).toBeLessThan(0.45);
    expect(meMel.recall).toBeGreaterThan(meDrum.recall + 0.4);
  });

  it('드럼 후보와 멜로디 후보의 ±50ms 겹침이 80% 미만이다', async () => {
    const dr = (await analyzeAudio(d.samples, { detector: 'drums' })).candidates.map((c) => c.time_ms);
    const me = (await analyzeAudio(d.samples, { detector: 'melody' })).candidates.map((c) => c.time_ms);
    const overlap = (a: number[], b: number[]): number => a.filter((t) => b.some((u) => Math.abs(u - t) <= 50)).length / a.length;
    expect(overlap(dr, me)).toBeLessThan(0.8);
    expect(overlap(me, dr)).toBeLessThan(0.8);
  });

  it('후보 모양은 계약 그대로(시간순, 세기 0~1, 대역, 길이)이고 mode 필드는 감싸기 함수가 붙인다', async () => {
    for (const mode of ['drums', 'melody', 'vocal'] as const) {
      const res = await analyzeAudioWithMode(d.samples, { detector: mode });
      expect(res.mode).toBe(mode);
      expect(res.options.detector).toBe(mode);
      expect(res.candidates.length).toBeGreaterThan(20);
      expect(res.candidate_count).toBe(res.candidates.length);
      let prev = -1;
      for (const c of res.candidates) {
        expect(c.time_ms).toBeGreaterThanOrEqual(prev - 50);
        prev = c.time_ms;
        expect(c.strength).toBeGreaterThanOrEqual(0);
        expect(c.strength).toBeLessThanOrEqual(1);
        expect(['low', 'mid', 'high']).toContain(c.band);
        expect(c.duration_ms).toBeGreaterThanOrEqual(0);
      }
      expect(res.warnings).toContain(APPROX_NOTICE);
    }
  });

  it('드럼 모드에서 킥은 저음, 하이햇은 고음 쪽 대역으로 분류된다', async () => {
    const dr = await analyzeAudio(d.samples, { detector: 'drums' });
    const lows = dr.candidates.filter((c) => c.band === 'low').length;
    const highs = dr.candidates.filter((c) => c.band === 'high').length;
    expect(lows).toBeGreaterThan(10);
    expect(highs).toBeGreaterThan(10);
  });

  it('같은 입력이면 같은 결과', async () => {
    const a = await analyzeAudio(d.samples, { detector: 'drums' });
    const b = await analyzeAudio(d.samples, { detector: 'drums' });
    expect(a.candidates).toEqual(b.candidates);
    const c = await analyzeAudio(d.samples, { detector: 'melody' });
    const e = await analyzeAudio(d.samples, { detector: 'melody' });
    expect(c.candidates).toEqual(e.candidates);
  });
});

describe('보컬 근사 모드', () => {
  // 가운데(왼쪽=오른쪽)에 멜로디, 드럼은 왼쪽에만
  const mel = makeDrumMelody({ seconds: 30, noDrums: true });
  const dru = makeDrumMelody({ seconds: 30, noMelody: true });
  const n = mel.samples.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = 0.5 * mel.samples[i]! + 0.5 * dru.samples[i]!;
    right[i] = 0.5 * mel.samples[i]!;
  }
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (left[i]! + right[i]!);

  it('스테레오: 가운데 성분(멜로디)을 우선 뽑고 왼쪽에만 있는 드럼은 덜 뽑는다', async () => {
    const res = await analyzeAudio(mono, withStereo({ detector: 'vocal' }, left, right));
    const t = res.candidates.map((c) => c.time_ms);
    const m = matchOnsets(mel.melodyOnsets, t, 50);
    const dm = matchOnsets(unique(dru.drumHits), t, 50);
    expect(m.recall).toBeGreaterThan(0.9);
    expect(m.precision).toBeGreaterThan(0.5);
    expect(dm.recall).toBeLessThan(0.5); // 모노로 뽑으면 0.96 정도
    expect(res.warnings).toContain(APPROX_NOTICE);
    expect(res.warnings).not.toContain(MONO_VOCAL_NOTICE);
    expect(res.candidates.every((c) => c.band === 'mid')).toBe(true);
  });

  it('스테레오 정보가 있으면 모노 입력보다 드럼 오검출이 적다', async () => {
    const st = await analyzeAudio(mono, withStereo({ detector: 'vocal' }, left, right));
    const mo = await analyzeAudio(mono, { detector: 'vocal' });
    const stDrum = matchOnsets(unique(dru.drumHits), st.candidates.map((c) => c.time_ms), 50).recall;
    const moDrum = matchOnsets(unique(dru.drumHits), mo.candidates.map((c) => c.time_ms), 50).recall;
    expect(stDrum).toBeLessThan(moDrum);
    // 멜로디 음 쪽 정밀도도 스테레오가 더 높다
    const stPrec = matchOnsets(mel.melodyOnsets, st.candidates.map((c) => c.time_ms), 50).precision;
    const moPrec = matchOnsets(mel.melodyOnsets, mo.candidates.map((c) => c.time_ms), 50).precision;
    expect(stPrec).toBeGreaterThan(moPrec + 0.1);
  });

  it('모노 입력(또는 좌우가 같은 소리)이면 "모노 음원이라 정확도가 낮습니다" 안내가 붙는다', async () => {
    const a = await analyzeAudio(mono, { detector: 'vocal' });
    expect(a.warnings).toContain(MONO_VOCAL_NOTICE);
    expect(MONO_VOCAL_NOTICE).toContain('모노 음원이라 정확도가 낮습니다');
    const b = await analyzeAudio(mono, withStereo({ detector: 'vocal' }, mono, mono));
    expect(b.warnings).toContain(MONO_VOCAL_NOTICE);
  });
});

describe('진행률·취소·등록·문구', () => {
  const s = makeDrumMelody({ seconds: 12 }).samples;

  it('모드 5개가 모두 동작하고, 새 모드 3개가 등록되어 있다', async () => {
    expect(registeredModes().sort()).toEqual(['drums', 'melody', 'vocal']);
    for (const mode of ['hybrid', 'bass', 'drums', 'melody', 'vocal'] as const) {
      const r = await analyzeAudio(s, { detector: mode });
      expect(r.options.detector).toBe(mode);
      expect(r.candidate_count).toBeGreaterThan(5);
    }
  });

  it('진행률이 줄어들지 않고 1 로 끝나며, 드럼·멜로디는 "타악·화음 나누는 중 N%" 단계를 알린다', async () => {
    for (const mode of ['drums', 'melody', 'vocal'] as const) {
      const log: [number, string][] = [];
      await analyzeAudio(s, { detector: mode }, (p, label) => log.push([p, label]));
      for (let i = 1; i < log.length; i++) expect(log[i]![0]).toBeGreaterThanOrEqual(log[i - 1]![0] - 1e-9);
      expect(log[log.length - 1]![0]).toBe(1);
      const key = mode === 'vocal' ? '가운데 소리 뽑는 중' : '타악·화음 나누는 중';
      const mid = log.filter(([, l]) => l.startsWith(key));
      expect(mid.length).toBeGreaterThan(3);
      expect(mid.some(([, l]) => /\d+%$/.test(l))).toBe(true);
    }
  });

  it('분석 도중 취소하면 AnalysisAborted', async () => {
    const ac = new AbortController();
    const p = analyzeAudio(s, { detector: 'drums' }, (_p, label) => {
      if (label.startsWith('타악·화음') && !ac.signal.aborted) ac.abort();
    }, ac.signal);
    await expect(p).rejects.toBeInstanceOf(AnalysisAborted);
  });

  it('스테레오 디코딩은 브라우저 기능이 없으면 쉬운 한국어로 안내한다', async () => {
    await expect(decodeStereo22k(new ArrayBuffer(10))).rejects.toThrow(AnalysisError);
    await expect(decodeStereo22k(new ArrayBuffer(10))).rejects.toThrow('지원하지 않습니다');
  });
});

describe('config\\presets.json', () => {
  const list = presets.presets as { id: string; name: string; enabled: boolean; description?: string; settings?: { detector?: string } }[];
  const byId = (id: string) => list.find((p) => p.id === id);

  it('모드 5개 프리셋(mix·bass·drums·melody·vocal)이 켜져 있고 한국어 설명이 있다', () => {
    for (const id of ['mix', 'bass', 'drums', 'melody', 'vocal']) {
      const p = byId(id);
      expect(p, id).toBeDefined();
      expect(p!.enabled).toBe(true);
      expect(p!.description!.length).toBeGreaterThan(10);
    }
    expect(byId('drums')!.settings!.detector).toBe('drums');
    expect(byId('melody')!.settings!.detector).toBe('melody');
    expect(byId('vocal')!.settings!.detector).toBe('vocal');
    expect(byId('bass')!.settings!.detector).toBe('bass');
  });

  it('근사 모드(드럼·멜로디·보컬) 설명에는 "근사"가 들어 있다', () => {
    for (const id of ['drums', 'melody', 'vocal']) expect(byId(id)!.description).toContain('근사');
    expect(byId('vocal')!.description).toContain('모노');
  });

  it('detectors 목록에 새 방식 이름이 있고 "근사"가 적혀 있다', () => {
    const det = presets.detectors as Record<string, string>;
    for (const id of ['hybrid', 'bass', 'drums', 'melody', 'vocal']) expect(det[id], id).toBeTruthy();
    for (const id of ['drums', 'melody', 'vocal']) expect(det[id]).toContain('근사');
  });
});

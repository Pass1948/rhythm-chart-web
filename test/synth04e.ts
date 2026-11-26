/**
 * 04e 단위 테스트용 합성 데이터(사용자 곡 사용 금지). 박 위치 목록과 노트 후보를 코드로 만든다.
 */
import type { AnalysisResult, Candidate } from '../src/analysis/types.ts';

/** 결정적 난수(0~1) */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface Section {
  bpm: number;
  beats: number;
}

/** 구간 목록(BPM, 박 수) → 박 위치(ms) 목록. 마지막 박 뒤의 한 박은 넣지 않는다. */
export function beatTimes(sections: Section[], startMs = 0): number[] {
  const out: number[] = [];
  let t = startMs;
  for (const s of sections) {
    const per = 60000 / s.bpm;
    for (let i = 0; i < s.beats; i++) {
      out.push(t);
      t += per;
    }
  }
  return out;
}

/** 박 위치에 흔들림(±jitterMs)을 준다 */
export function jitter(times: number[], jitterMs: number, seed = 7): number[] {
  const r = lcg(seed);
  return times.map((t) => t + (r() * 2 - 1) * jitterMs);
}

/** 박 위치 목록에서 8분 격자에 놓인 노트 후보를 만든다(각 박의 앞박·뒷박, 일부는 비움). */
export function candidatesFromBeats(beats: number[], seed = 11): Candidate[] {
  const r = lcg(seed);
  const out: Candidate[] = [];
  for (let i = 0; i < beats.length; i++) {
    const t0 = beats[i]!;
    const next = i + 1 < beats.length ? beats[i + 1]! : t0 + (beats[i]! - beats[i - 1]!);
    const half = (t0 + next) / 2;
    for (const [t, keep] of [[t0, 0.9], [half, 0.6]] as const) {
      if (r() > keep) continue;
      out.push({
        time_ms: Math.round((t + (r() * 2 - 1) * 6) * 100) / 100,
        strength: Math.round((0.3 + r() * 0.7) * 10000) / 10000,
        band: (['low', 'mid', 'high'] as const)[Math.floor(r() * 3)]!,
        duration_ms: Math.round((60 + r() * 600) * 10) / 10,
      });
    }
  }
  return out.sort((a, b) => a.time_ms - b.time_ms);
}

/** 노트 생성에 쓸 합성 분석 결과 */
export function makeAnalysis(cands: Candidate[], bpm: number, offsetMs: number, durationMs: number, beatsMs: number[] = []): AnalysisResult {
  return {
    version: '0.1.0',
    song: '합성곡',
    audio_sha256: 'x'.repeat(8),
    created_at: '2026-01-01T00:00:00',
    info: { sample_rate: 22050, duration_ms: durationMs, lead_silence_ms: 0 },
    options: { detector: 'hybrid', sensitivity: 60, min_gap_ms: 75 },
    beats: { bpm_candidates: [], interval_cv: null, has_downbeats: false, librosa_bpm: bpm, beats_ms: beatsMs, beat_count: beatsMs.length },
    timing: { source: 'auto', bpm, audio_offset_ms: offsetMs, auto: { bpm, audio_offset_ms: offsetMs, before: { bpm, audio_offset_ms: offsetMs } }, user: null },
    candidates: cands,
    candidate_count: cands.length,
    warnings: [],
    grid_fit: { total: cands.length, fit: cands.length, percent: 100, division: 8, tolerance_ms: 30 },
    waveform: { step_ms: 10, duration_ms: durationMs, min: [], max: [] },
  };
}

/** 단일 BPM 기준 합성 곡(120BPM, 96박 = 48초) */
export function singleBpmAnalysis(): AnalysisResult {
  const beats = beatTimes([{ bpm: 120, beats: 96 }], 500);
  return makeAnalysis(candidatesFromBeats(beats), 120, 0, 50000, beats);
}

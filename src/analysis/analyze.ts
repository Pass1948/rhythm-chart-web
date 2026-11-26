/**
 * 분석(①~③) 실행: 22050Hz 모노 소리 → 박자·소리 시작 지점(노트 후보) → AnalysisResult.
 * 원본 analyze.py 의 흐름과 결과 모양을 따른다. 무거운 계산이라 화면에서는 Web Worker 안에서 부른다(workerClient.ts).
 */
import { analyzeBeats, gridFitStats, refineWithOnsets } from './beats.ts';
import { computeFeatures, computeFeaturesAsync, selectCandidates } from './detect.ts';
import { getMode } from './modeRegistry.ts';
import './modes/index.ts'; // 01b가 새 분석 모드를 등록하는 자리(01a에서는 비어 있음)
import { throwIfAborted } from './dsp.ts';
import { ANALYSIS_SR, waveformSummary } from './prepare.ts';
import { ANALYSIS_VERSION, AnalysisError, BASE_DETECTORS, DEFAULT_ANALYZE_OPTIONS } from './types.ts';
import type { AnalysisResult, AnalyzeOptions, Candidate, ProgressFn } from './types.ts';
import { computeWave } from './wave.ts';
import { nowIso } from '../core/schema.ts';

/** 사용자 입력 옵션을 검사하고 기본값으로 채운다. 잘못된 값은 쉬운 한국어 오류. */
export function normalizeOptions(options?: Partial<AnalyzeOptions>): AnalyzeOptions {
  const opt: AnalyzeOptions = { ...DEFAULT_ANALYZE_OPTIONS, ...(options ?? {}) };
  if (!(BASE_DETECTORS as readonly string[]).includes(opt.detector) && !getMode(opt.detector)) {
    if (['drums', 'melody', 'vocal'].includes(opt.detector)) throw new AnalysisError('이 분석 방식은 아직 준비 중입니다. 종합 등 다른 방식을 골라 주세요.');
    throw new AnalysisError(`알 수 없는 검출 방식입니다: ${String(opt.detector)}`);
  }
  const s = Number(opt.sensitivity);
  const g = Number(opt.minGapMs);
  if (Number.isNaN(s) || Number.isNaN(g)) throw new AnalysisError('지점 민감도와 최소 간격은 숫자로 입력해 주세요.');
  opt.sensitivity = Math.min(100, Math.max(10, s));
  opt.minGapMs = Math.min(500, Math.max(30, g));
  const m = opt.manual;
  if (m) {
    const bpm = Number(m.bpm);
    if (Number.isNaN(bpm)) throw new AnalysisError('직접 입력한 BPM이 숫자가 아닙니다.');
    if (!(bpm >= 40 && bpm <= 300)) throw new AnalysisError('BPM은 40~300 사이로 입력해 주세요.');
    const off = m.audio_offset_ms;
    opt.manual = { bpm, audio_offset_ms: off === undefined || off === null ? null : Number(off) };
  }
  return opt;
}

/**
 * 계약 함수: 소리(22050Hz 모노)를 분석해 AnalysisResult 를 돌려준다.
 * onProgress(0~1, 단계 이름), signal 로 취소할 수 있다(단계 경계에서 확인. 화면에서는 워커를 종료하는 방식이 더 빠르다).
 */
export async function analyzeAudio(
  samples: Float32Array,
  options: Partial<AnalyzeOptions>,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
  yielder?: () => Promise<void>,
): Promise<AnalysisResult> {
  // yielder 가 있으면(Web Worker 를 못 쓰는 환경) 단계 사이마다 양보해서 화면이 멈추지 않게 한다 (호환 추가 인자)
  const pause = async (): Promise<void> => {
    if (yielder) await yielder();
  };
  const opt = normalizeOptions(options);
  const report: ProgressFn = onProgress ?? (() => undefined);
  throwIfAborted(signal);

  report(0.02, '소리 준비하는 중');
  const durationMs = (samples.length / ANALYSIS_SR) * 1000;
  let lead = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) > 0.01) {
      lead = i;
      break;
    }
  }
  const leadMs = lead < 0 ? 0 : (lead / ANALYSIS_SR) * 1000;
  const waveform = waveformSummary(samples, ANALYSIS_SR, 10);

  report(0.05, '소리의 변화를 분석하는 중');
  const featProgress = (f: number): void => report(0.05 + 0.6 * f, '소리의 변화를 분석하는 중');
  const feats = yielder ? await computeFeaturesAsync(samples, yielder, featProgress, signal) : computeFeatures(samples, featProgress, signal);
  throwIfAborted(signal);
  await pause();

  // 박자 추정은 사용자가 고른 검출 방식과 상관없이 '종합' 후보(민감도 60, 최소 간격 75ms)로 한다 — 항상 같은 기준
  report(0.66, '소리 시작 지점을 고르는 중');
  const tempoCands = selectCandidates(samples, feats, 'hybrid', 60, 75);
  throwIfAborted(signal);
  await pause();
  report(0.72, '박자 찾는 중');
  const beats = analyzeBeats(feats.novelty[0]!, tempoCands);
  throwIfAborted(signal);
  await pause();

  report(0.76, '파형을 만드는 중');
  const wave = await computeWave(samples, ANALYSIS_SR, (f) => report(0.76 + 0.09 * f, '파형을 만드는 중'), signal, yielder);
  throwIfAborted(signal);
  await pause();

  report(0.85, '노트 후보를 정리하는 중');
  const modeFn = getMode(opt.detector);
  let cands: Candidate[];
  const modeWarnings: string[] = [];
  if (modeFn) {
    // 01b 등에서 등록한 분석 모드가 있으면 그 방식으로 후보를 만든다
    const made = await modeFn({ samples, features: feats, options: opt, report, signal });
    cands = Array.isArray(made) ? made : made.candidates;
    if (!Array.isArray(made) && made.warnings) modeWarnings.push(...made.warnings);
  } else if (opt.detector === 'hybrid' && opt.sensitivity === 60 && opt.minGapMs === 75) {
    cands = tempoCands;
  } else {
    cands = selectCandidates(samples, feats, opt.detector, opt.sensitivity, opt.minGapMs);
  }
  const [autoBpm, autoPhase] = refineWithOnsets(cands, beats.bpm, beats.phase_ms);
  const period = 60000.0 / autoBpm;
  const auto = {
    bpm: Math.round(autoBpm * 1000) / 1000,
    audio_offset_ms: Math.round((autoPhase - period) * 100) / 100,
    // 보정 전 값(박 추적 결과)도 남긴다: 소리에 맞게 다시 보정했는지 화면이 알릴 수 있게
    before: {
      bpm: Math.round(beats.bpm * 1000) / 1000,
      audio_offset_ms: Math.round((beats.phase_ms - 60000.0 / beats.bpm) * 100) / 100,
    },
  };

  const user = opt.manual ? { bpm: opt.manual.bpm, audio_offset_ms: opt.manual.audio_offset_ms ?? auto.audio_offset_ms } : null;
  const chosen = user
    ? { source: 'manual' as const, bpm: user.bpm, audio_offset_ms: user.audio_offset_ms, auto, user }
    : { source: 'auto' as const, bpm: auto.bpm, audio_offset_ms: auto.audio_offset_ms, auto, user: null };
  const gridFit = gridFitStats(
    cands.map((c) => c.time_ms),
    chosen.bpm,
    chosen.audio_offset_ms,
  );

  const warnings = [...beats.warnings, ...modeWarnings];
  if (leadMs > 1000) warnings.push(`곡 앞부분에 ${(leadMs / 1000).toFixed(1)}초의 무음이 있습니다.`);
  if (cands.length < 10) warnings.push('소리가 시작되는 지점이 거의 없습니다. 지점 민감도를 올려 보세요.');
  report(1, '분석이 끝났습니다.');
  return {
    version: ANALYSIS_VERSION,
    song: '',
    audio_sha256: '',
    created_at: nowIso(),
    info: { sample_rate: ANALYSIS_SR, duration_ms: Math.round(durationMs * 100) / 100, lead_silence_ms: Math.round(leadMs * 10) / 10 },
    options: { detector: opt.detector, sensitivity: opt.sensitivity, min_gap_ms: opt.minGapMs },
    beats: {
      bpm_candidates: beats.bpm_candidates,
      interval_cv: beats.interval_cv,
      has_downbeats: beats.has_downbeats,
      librosa_bpm: beats.librosa_bpm,
      beats_ms: beats.beats_ms,
      beat_count: beats.beats_ms.length,
    },
    timing: chosen,
    candidates: cands,
    candidate_count: cands.length,
    warnings,
    grid_fit: gridFit,
    waveform,
    wave,
  };
}

/**
 * ① 입력 준비: 브라우저가 소리 파일을 읽게 하고(22050Hz 모노로 변환) → 진폭 정규화 → 파형 요약.
 * 원본 prepare.py 는 soundfile·soxr(44.1kHz 거쳐 22.05kHz)를 쓰지만, 이 버전은 Web Audio(OfflineAudioContext)의 변환을 쓴다.
 * 이 파일은 화면(메인 스레드)에서 실행한다. (OfflineAudioContext 는 Web Worker 안에서 쓸 수 없다)
 */
import { AnalysisError } from './types.ts';
import type { WaveformSummary } from './types.ts';

export const ANALYSIS_SR = 22050;
const TARGET_PEAK = 0.99;
const SILENCE_LEVEL = 0.01;
const MIN_DURATION_SEC = 0.5;

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: 22050;
  durationMs: number;
  /** 보너스 정보: 곡 앞부분 무음 길이(ms)와 정규화 전 최대 진폭 */
  leadSilenceMs: number;
  originalPeak: number;
}

/**
 * 이미 22050Hz 모노인 값을 분석용으로 다듬는다: 최대 진폭을 0.99로 맞추고 앞 무음 길이를 잰다.
 * (decodeToMono22k 와 테스트·도구가 같이 쓴다. 입력 배열은 바꾸지 않고 새 배열을 돌려준다.)
 */
export function finalizeMono(raw: Float32Array): DecodedAudio {
  if (raw.length < ANALYSIS_SR * MIN_DURATION_SEC) throw new AnalysisError('음원이 너무 짧습니다 (0.5초 미만).');
  let peak = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = Math.abs(raw[i]!);
    if (a > peak) peak = a;
  }
  if (!(peak > 0)) throw new AnalysisError('음원이 완전히 무음입니다.');
  const scale = TARGET_PEAK / peak;
  const samples = new Float32Array(raw.length);
  let lead = -1;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]! * scale;
    samples[i] = v;
    if (lead < 0 && Math.abs(v) > SILENCE_LEVEL) lead = i;
  }
  return {
    samples,
    sampleRate: ANALYSIS_SR,
    durationMs: (raw.length / ANALYSIS_SR) * 1000,
    leadSilenceMs: lead < 0 ? 0 : (lead / ANALYSIS_SR) * 1000,
    originalPeak: peak,
  };
}

/** 계약 함수: 파일(또는 파일 내용)을 22050Hz 모노 Float32Array 로 바꾼다. 실패하면 쉬운 한국어로 안내한다. */
export async function decodeToMono22k(file: File | ArrayBuffer): Promise<DecodedAudio> {
  let bytes: ArrayBuffer;
  try {
    bytes = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  } catch {
    throw new AnalysisError('파일을 열지 못했습니다. 다시 선택해 주세요.');
  }
  const Ctor: typeof OfflineAudioContext | undefined =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) throw new AnalysisError('이 브라우저는 소리 파일을 읽는 기능을 지원하지 않습니다. 최신 크롬·엣지·사파리로 열어 주세요.');
  let audio: AudioBuffer;
  try {
    // 22050Hz 로 만든 컨텍스트에서 디코딩하면 브라우저가 22050Hz 로 변환해 준다. 길이 값은 형식상 필요한 자리표시자다.
    const ctx = new Ctor(1, ANALYSIS_SR, ANALYSIS_SR);
    audio = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new AnalysisError('이 파일을 읽지 못했습니다. mp3나 wav로 바꿔 올려 보세요.');
  }
  const channels = audio.numberOfChannels;
  const length = audio.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i]! += data[i]! / channels;
  }
  return finalizeMono(mono);
}

/** 계약 함수: 화면에 그릴 파형 요약. 구간(buckets)마다 [최소, 최대] 를 이어 붙인 길이 buckets*2 배열. */
export function buildWaveform(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((b + 1) * per)));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[b * 2] = lo;
    out[b * 2 + 1] = hi;
  }
  return out;
}

/** 원본 waveform.json 과 같은 모양의 요약: stepMs 마다 최소·최대 진폭(소수 셋째 자리). */
export function waveformSummary(samples: Float32Array, sampleRate: number, stepMs = 10): WaveformSummary {
  const step = Math.round((sampleRate * stepMs) / 1000);
  const n = Math.ceil(samples.length / step);
  const min: number[] = new Array<number>(n);
  const max: number[] = new Array<number>(n);
  for (let b = 0; b < n; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = b * step; i < (b + 1) * step; i++) {
      const v = i < samples.length ? samples[i]! : 0; // 끝은 0으로 채움(원본과 같다)
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = Math.round(lo * 1000) / 1000;
    max[b] = Math.round(hi * 1000) / 1000;
  }
  return { step_ms: stepMs, duration_ms: Math.round((samples.length / sampleRate) * 1000 * 100) / 100, min, max };
}

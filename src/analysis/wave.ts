/**
 * 음원 파형(편집 화면 오른쪽 세로 띠용): 약 20ms 간격마다 ① 전체 크기(최대 진폭) ② 저음(<250Hz) ③ 중음(250Hz~2kHz) ④ 고음(>2kHz)의
 * 크기를 0~255 정수로 줄여 저장한다. 4분 곡 기준 약 48KB(프레임 12,000 x 4).
 * - 대역 나누기는 `dsp.ts`의 2차 버터워스 필터를 두 번씩 이어 붙여(4차) 쓴다. 새 라이브러리 없음.
 * - 크기 = 그 20ms 안 샘플의 최대 절댓값(분석 단계에서 소리는 최대 진폭 0.99 로 맞춰져 있다).
 */
import { biquadFilter, butterHigh2, butterLow2, throwIfAborted } from './dsp.ts';

/** 프레임 간격(ms) */
export const WAVE_HOP_MS = 20;
/** 한 프레임에 저장하는 값의 수: [전체, 저음, 중음, 고음] */
export const WAVE_CHANNELS = 4;
export const WAVE_LOW_HZ = 250;
export const WAVE_HIGH_HZ = 2000;

/** 파형 데이터. data[프레임 * 4 + 채널] = 0~255 (채널 0 전체, 1 저음, 2 중음, 3 고음) */
export interface WaveMap {
  version: 1;
  /** 프레임 간격(ms). 프레임 t 의 시각 = t * hop_ms */
  hop_ms: number;
  frames: number;
  data: Uint8Array;
}

/** 프레임 수 */
export function waveFrameCount(sampleCount: number, sampleRate = 22050): number {
  return Math.ceil(sampleCount / Math.round((sampleRate * WAVE_HOP_MS) / 1000));
}

/** 신호에 2차 필터를 두 번 통과시킨다(4차, 한 옥타브당 24dB) */
function filter4(x: Float32Array, a: ReturnType<typeof butterLow2>): Float32Array {
  return biquadFilter(biquadFilter(x, a), a);
}

/** 프레임마다 최대 절댓값을 0~255 로 */
function peaks(x: Float32Array, hop: number, frames: number, out: Uint8Array, channel: number): void {
  for (let f = 0; f < frames; f++) {
    const end = Math.min(x.length, (f + 1) * hop);
    let m = 0;
    for (let i = f * hop; i < end; i++) {
      const v = Math.abs(x[i]!);
      if (v > m) m = v;
    }
    out[f * WAVE_CHANNELS + channel] = m >= 1 ? 255 : Math.round(m * 255);
  }
}

/**
 * 파형 데이터를 계산한다. yielder 를 주면 단계 사이에 양보한다(Web Worker 를 못 쓰는 환경).
 * onProgress(0~1) 로 진행률을 알린다.
 */
export async function computeWave(
  samples: Float32Array,
  sampleRate = 22050,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  yielder?: () => Promise<void>,
): Promise<WaveMap> {
  const hop = Math.round((sampleRate * WAVE_HOP_MS) / 1000);
  const frames = waveFrameCount(samples.length, sampleRate);
  const data = new Uint8Array(frames * WAVE_CHANNELS);
  const step = async (fraction: number): Promise<void> => {
    throwIfAborted(signal);
    onProgress?.(fraction);
    if (yielder) await yielder();
  };

  peaks(samples, hop, frames, data, 0);
  await step(0.2);

  const low = filter4(samples, butterLow2(WAVE_LOW_HZ, sampleRate));
  peaks(low, hop, frames, data, 1);
  await step(0.45);

  const mid = filter4(filter4(samples, butterHigh2(WAVE_LOW_HZ, sampleRate)), butterLow2(WAVE_HIGH_HZ, sampleRate));
  peaks(mid, hop, frames, data, 2);
  await step(0.75);

  const high = filter4(samples, butterHigh2(WAVE_HIGH_HZ, sampleRate));
  peaks(high, hop, frames, data, 3);
  await step(1);

  return { version: 1, hop_ms: WAVE_HOP_MS, frames, data };
}

/** 저장된 값이 쓸 수 있는 파형 데이터인가 (깨진 저장분 방어) */
export function isValidWave(w: unknown): w is WaveMap {
  if (!w || typeof w !== 'object') return false;
  const m = w as Partial<WaveMap>;
  return m.version === 1 && typeof m.frames === 'number' && typeof m.hop_ms === 'number' && m.data instanceof Uint8Array && m.data.length === m.frames * WAVE_CHANNELS;
}

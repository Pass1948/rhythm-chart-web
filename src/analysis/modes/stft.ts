/**
 * 모드용 STFT 도우미: 프레임을 0번부터 차례로 하나씩 꺼내 쓰는 스트림 방식(전체 스펙트로그램을 메모리에 쌓지 않는다).
 * 창·간격은 01a 와 같다(1024 한 창, 110 간격, 가운데 맞춤, 바깥은 0). 01a 의 detect.ts 는 이런 도구를 공개하지 않아서 여기서 따로 만들었다.
 */
import { Fft, hannWindow } from '../dsp.ts';
import { HOP, N_FFT } from '../detect.ts';

/** 프레임 수 (01a 와 같은 정의) */
export function frameCount(sampleCount: number): number {
  return 1 + Math.floor(sampleCount / HOP);
}

export const BINS = N_FFT / 2 + 1;

/** 빈 번호 → 주파수(Hz) */
export function binHz(k: number, sampleRate: number): number {
  return (k * sampleRate) / N_FFT;
}

/** 주파수 범위 [lo, hi) 에 들어가는 빈 번호 범위 [from, to) */
export function binRange(hz: [number, number], sampleRate: number): [number, number] {
  const from = Math.max(0, Math.ceil((hz[0] * N_FFT) / sampleRate));
  const to = Math.min(BINS, Math.ceil((hz[1] * N_FFT) / sampleRate));
  return [from, Math.max(from, to)];
}

/** 모노 소리의 크기 스펙트럼을 프레임 순서대로 하나씩 꺼내는 스트림(실수 신호 2프레임을 FFT 1번으로 계산) */
export class MonoSpectrumStream {
  private readonly fft = new Fft(N_FFT);
  private readonly win = hannWindow(N_FFT);
  private readonly re = new Float64Array(N_FFT);
  private readonly im = new Float64Array(N_FFT);
  private readonly pair = [new Float32Array(BINS), new Float32Array(BINS)];
  private next = 0;
  readonly frames: number;

  private readonly y: Float32Array;

  constructor(y: Float32Array) {
    this.y = y;
    this.frames = frameCount(y.length);
  }

  /** 다음 프레임의 크기 스펙트럼을 out 에 채운다. 프레임이 끝났으면 false. */
  read(out: Float32Array): boolean {
    const t = this.next;
    if (t >= this.frames) return false;
    if ((t & 1) === 0) this.computePair(t);
    out.set(this.pair[t & 1]!);
    this.next++;
    return true;
  }

  /** 프레임 t, t+1 을 함께 계산 */
  private computePair(t: number): void {
    const { re, im, win, y } = this;
    const hasSecond = t + 1 < this.frames;
    const s1 = t * HOP - N_FFT / 2;
    const s2 = (t + 1) * HOP - N_FFT / 2;
    for (let i = 0; i < N_FFT; i++) {
      const a = s1 + i;
      const b = s2 + i;
      const w = win[i]!;
      re[i] = a >= 0 && a < y.length ? y[a]! * w : 0;
      im[i] = hasSecond && b >= 0 && b < y.length ? y[b]! * w : 0;
    }
    this.fft.transform(re, im);
    const outA = this.pair[0]!;
    const outB = this.pair[1]!;
    for (let k = 0; k < BINS; k++) {
      const kk = (N_FFT - k) % N_FFT;
      outA[k] = Math.hypot(0.5 * (re[k]! + re[kk]!), 0.5 * (im[k]! - im[kk]!));
      if (hasSecond) outB[k] = Math.hypot(0.5 * (im[k]! + im[kk]!), -0.5 * (re[k]! - re[kk]!));
    }
  }
}

/** 스테레오 한 프레임에서 뽑은 값 */
export interface CenterFrame {
  /** 중앙 성분 크기: max(0, |(L+R)/2| − beta·|(L−R)/2|) */
  center: Float32Array;
  /** 전체 (L+R)/2 의 에너지 합과 (L−R)/2 의 에너지 합(모노 판정용) */
  midEnergy: number;
  sideEnergy: number;
}

/**
 * 스테레오 스펙트럼 스트림: 왼쪽을 실수부, 오른쪽을 허수부로 묶어 FFT 1번으로 두 채널을 함께 얻고,
 * 중앙(L+R)/2 에서 좌우 차이(L−R)/2 를 뺀 '중앙 성분' 크기를 프레임마다 돌려준다.
 */
export class CenterSpectrumStream {
  private readonly fft = new Fft(N_FFT);
  private readonly win = hannWindow(N_FFT);
  private readonly re = new Float64Array(N_FFT);
  private readonly im = new Float64Array(N_FFT);
  private next = 0;
  readonly frames: number;

  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly sideSuppress: number;

  constructor(left: Float32Array, right: Float32Array, sideSuppress: number) {
    this.left = left;
    this.right = right;
    this.sideSuppress = sideSuppress;
    this.frames = frameCount(left.length);
  }

  /** 다음 프레임의 중앙 성분 크기를 out.center 에 채운다. 끝났으면 false. */
  read(out: CenterFrame): boolean {
    const t = this.next;
    if (t >= this.frames) return false;
    const { re, im, win, left, right } = this;
    const s = t * HOP - N_FFT / 2;
    for (let i = 0; i < N_FFT; i++) {
      const a = s + i;
      const w = win[i]!;
      const ok = a >= 0 && a < left.length;
      re[i] = ok ? left[a]! * w : 0;
      im[i] = ok ? right[a]! * w : 0;
    }
    this.fft.transform(re, im);
    let midE = 0;
    let sideE = 0;
    for (let k = 0; k < BINS; k++) {
      const kk = (N_FFT - k) % N_FFT;
      // 한 번의 FFT 에서 왼쪽(L)·오른쪽(R) 복소 스펙트럼 분리
      const lr = 0.5 * (re[k]! + re[kk]!);
      const li = 0.5 * (im[k]! - im[kk]!);
      const rr = 0.5 * (im[k]! + im[kk]!);
      const ri = -0.5 * (re[k]! - re[kk]!);
      const mid = Math.hypot(lr + rr, li + ri) * 0.5;
      const side = Math.hypot(lr - rr, li - ri) * 0.5;
      out.center[k] = Math.max(0, mid - this.sideSuppress * side);
      midE += mid * mid;
      sideE += side * side;
    }
    out.midEnergy = midE;
    out.sideEnergy = sideE;
    this.next++;
    return true;
  }
}

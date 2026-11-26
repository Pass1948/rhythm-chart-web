/**
 * 분석에 쓰는 기본 신호 처리 도구(직접 구현). 외부 패키지를 쓰지 않는다.
 * - FFT(2의 거듭제곱 radix-2), 한(Hann) 창, 2차 버터워스 필터, 백분위·중앙값, 자기상관
 * 원본은 librosa·scipy·numpy 를 쓰는 곳이라, 같은 효과의 간단한 구현으로 바꿨다(결과 md에 정리).
 */

/** 2의 거듭제곱 길이의 복소수 FFT(제자리 계산). 같은 길이는 표(테이블)를 재사용한다. */
export class Fft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT 길이는 2의 거듭제곱이어야 합니다.');
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** re, im 배열을 주파수 영역으로 바꾼다(제자리). */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const stride = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * stride]!;
          const wi = this.sin[k * stride]!;
          const a = start + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }
}

/** 주기형(periodic) 한 창. librosa/scipy 의 get_window('hann', n) 과 같은 값. */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * 정렬하지 않은 값들의 q(0~100) 백분위. numpy.percentile 의 기본(선형 보간)과 같다.
 */
export function percentile(values: ArrayLike<number>, q: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const pos = ((n - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** 중앙값 (numpy.median) */
export function median(values: ArrayLike<number>): number {
  return percentile(values, 50);
}

/** 2차 필터(biquad) 계수. 입력 x, 출력 y: y = b0 x + b1 x1 + b2 x2 - a1 y1 - a2 y2 */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** 2차 버터워스 저역 통과 (scipy.signal.butter(2, fc, 'low') 와 같은 쌍선형 변환 결과) */
export function butterLow2(fc: number, fs: number): Biquad {
  const wc = Math.tan((Math.PI * fc) / fs);
  const s2 = Math.SQRT2;
  const den = 1 + s2 * wc + wc * wc;
  const b0 = (wc * wc) / den;
  return { b0, b1: 2 * b0, b2: b0, a1: (2 * (wc * wc - 1)) / den, a2: (1 - s2 * wc + wc * wc) / den };
}

/** 2차 버터워스 고역 통과 */
export function butterHigh2(fc: number, fs: number): Biquad {
  const wc = Math.tan((Math.PI * fc) / fs);
  const s2 = Math.SQRT2;
  const den = 1 + s2 * wc + wc * wc;
  const b0 = 1 / den;
  return { b0, b1: -2 * b0, b2: b0, a1: (2 * (wc * wc - 1)) / den, a2: (1 - s2 * wc + wc * wc) / den };
}

/** 앞에서 뒤로 한 번 통과시키는 2차 필터(scipy.signal.sosfilt 와 같은 방향·구조). 새 배열을 돌려준다. */
export function biquadFilter(x: Float32Array, c: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = c.b0 * xi + z1;
    z1 = c.b1 * xi - c.a1 * yi + z2;
    z2 = c.b2 * xi - c.a2 * yi;
    y[i] = yi;
  }
  return y;
}

/** 자기상관: lag 0..maxLag 의 합(정규화 없음). 직접 계산(길이가 길어도 lag 수가 적어 충분히 빠르다). */
export function autocorrelate(x: ArrayLike<number>, maxLag: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += x[i]! * x[i + lag]!;
    out[lag] = sum;
  }
  return out;
}

/** 취소 요청이 들어왔으면 예외를 던진다(분석 단계 경계에서 부른다). */
export class AnalysisAborted extends Error {
  constructor() {
    super('분석을 취소했습니다.');
    this.name = 'AnalysisAborted';
  }
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AnalysisAborted();
}

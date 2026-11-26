/**
 * HPSS(타악·화음 나누기, Fitzgerald 방식)를 스트림으로 계산한다.
 *  - 시간 방향 중앙값 필터: 오래 이어지는 소리(화음·멜로디)만 남는다 → '화음 성분'
 *  - 주파수 방향 중앙값 필터: 순간적으로 넓게 퍼지는 소리(드럼)만 남는다 → '타악 성분'
 *  (지시문 표에는 두 방향의 이름이 반대로 적혀 있었으나, 일반적인 HPSS 정의와 목적(타악=순간·화음=지속)에 맞춰 이렇게 구현했다.)
 *  두 결과로 소프트 마스크(비율로 나누는 마스크)를 만들어 원래 스펙트럼에 곱한다.
 * 메모리: 스펙트로그램 전체를 쌓지 않고, 시간 창 길이만큼의 프레임만 돌려 가며 보관한다. 중앙값은 슬라이딩 방식(slidingMedian.ts).
 */
import { MonoSpectrumStream, BINS } from './stft.ts';
import { HPSS } from './modeConfig.ts';
import { replaceSorted, medianFilter1d } from './slidingMedian.ts';
import { throwIfAborted } from '../dsp.ts';

/** 프레임 하나를 처리할 때 넘겨주는 값(배열은 다음 프레임에서 덮어쓰므로 필요하면 복사해서 보관) */
export interface HpssFrame {
  /** 프레임 번호 */
  t: number;
  /** 원래 크기 스펙트럼 */
  mag: Float32Array;
  /** 타악 성분 크기 */
  perc: Float32Array;
  /** 화음 성분 크기 */
  harm: Float32Array;
}

export interface HpssParams {
  timeWindow: number;
  freqWindow: number;
  maskPower: number;
}

/** 홀수로 맞춘다(최소 3) */
function oddAtLeast3(n: number): number {
  const m = Math.max(3, Math.floor(n));
  return m % 2 === 1 ? m : m + 1;
}

/**
 * 소리 전체를 HPSS 로 나누며 프레임마다 visit 을 부른다.
 * onProgress(0~1) 는 약 0.5% 마다 알린다. signal 로 취소할 수 있다.
 */
export function runHpss(
  y: Float32Array,
  visit: (f: HpssFrame) => void,
  onProgress?: (frac: number) => void,
  signal?: AbortSignal,
  params: HpssParams = HPSS,
): void {
  const stream = new MonoSpectrumStream(y);
  const F = stream.frames;
  if (F < 3) return;
  const r = Math.min((oddAtLeast3(params.timeWindow) - 1) >> 1, F - 1);
  const W = 2 * r + 1; // 실제 시간 창 길이
  const fw = oddAtLeast3(params.freqWindow);
  const pw = params.maskPower;

  // 최근 W 프레임을 돌려 쓰는 보관소: 칸 i % W 에 프레임 i 의 크기 스펙트럼
  const ring: Float32Array[] = Array.from({ length: W }, () => new Float32Array(BINS));
  const lastRow = new Float32Array(BINS);
  // 빈마다 정렬된 시간 창 값들: win[k*W .. k*W+W-1]
  const win = new Float32Array(BINS * W);
  const tmp = new Float32Array(BINS);

  // 앞 r+1 프레임을 미리 읽는다(프레임 0..r)
  for (let i = 0; i <= r; i++) {
    stream.read(ring[i % W]!);
  }
  if (r === F - 1) lastRow.set(ring[F - 1]!);
  // 창(프레임 c=0 중심: -r..r, 바깥은 끝 값 되풀이)을 만든다
  for (let k = 0; k < BINS; k++) {
    const base = k * W;
    for (let j = 0; j < W; j++) {
      const idx = j - r; // -r..r
      win[base + j] = ring[(idx < 0 ? 0 : idx) % W]![k]!;
    }
    win.subarray(base, base + W).sort();
  }

  const harmMed = new Float32Array(BINS); // 시간 방향 중앙값 = 화음 강조
  const percMed = new Float32Array(BINS); // 주파수 방향 중앙값 = 타악 강조
  const scratch = new Float32Array(fw);
  const perc = new Float32Array(BINS);
  const harm = new Float32Array(BINS);
  const frame: HpssFrame = { t: 0, mag: ring[0]!, perc, harm };
  const midIdx = r; // 정렬된 창의 가운데 위치
  const eps = HPSS.eps;

  for (let c = 0; c < F; c++) {
    if ((c & 0x1ff) === 0) {
      throwIfAborted(signal);
      onProgress?.(c / F);
    }
    const cur = ring[c % W]!;
    for (let k = 0; k < BINS; k++) harmMed[k] = win[k * W + midIdx]!;
    medianFilter1d(cur, percMed, fw, scratch);
    for (let k = 0; k < BINS; k++) {
      const h = harmMed[k]!;
      const p = percMed[k]!;
      const hp = pw === 2 ? h * h : Math.pow(h, pw);
      const pp = pw === 2 ? p * p : Math.pow(p, pw);
      const maskP = pp / (hp + pp + eps);
      const m = cur[k]!;
      perc[k] = m * maskP;
      harm[k] = m - perc[k]!;
    }
    frame.t = c;
    frame.mag = cur;
    visit(frame);

    // 창을 한 칸 민다: 프레임 c-r 을 빼고 프레임 c+r+1 을 넣는다
    if (c + 1 < F) {
      const incomingIdx = c + r + 1;
      const slot = incomingIdx % W; // c-r 이 있던 칸(같은 칸을 덮어쓴다)
      const leaving = ring[slot]!; // 바깥(c-r<0)일 때는 프레임 0 값을 뺀다 → 아래에서 처리
      const leavingRow = c - r < 0 ? ring[0]! : leaving;
      let incoming: Float32Array;
      if (incomingIdx <= F - 1) {
        // 새 프레임을 읽어 tmp 에 둔다(빼는 값을 쓰기 전에 필요하므로 먼저 tmp 로)
        stream.read(tmp);
        if (incomingIdx === F - 1) lastRow.set(tmp);
        incoming = tmp;
      } else {
        incoming = lastRow;
      }
      for (let k = 0; k < BINS; k++) replaceSorted(win, k * W, W, leavingRow[k]!, incoming[k]!);
      if (incomingIdx <= F - 1) leaving.set(tmp);
    }
  }
  onProgress?.(1);
}

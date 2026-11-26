// "들리는 시계"의 순수 계산(브라우저 코드 없음 → Node 로 테스트). 08단계.
// 문제: AudioContext.currentTime 은 소리를 "내보내는" 시점이고, 블루투스 같은 출력은 실제로 들리기까지 150~300ms 이상 더 걸린다.
//       화면과 판정이 서로 다른 시계를 쓰면 그 차이만큼 판정이 어긋난다.
// 해법: getOutputTimestamp() 가 알려 주는 "지금 귀에 들리는 AudioContext 시간(contextTime)과 그 순간의 performance.now(performanceTime)"로
//       "performance.now ↔ 들리는 AudioContext 시간" 차이(offset)를 구해 부드럽게 다듬고, 화면 그리기와 판정이 모두 이 하나를 쓴다.

/** 다듬기 설정(한 곳) */
export const HEARD_CLOCK_CONFIG = {
  /** 지수 평균 계수: 새 표본을 이만큼 반영한다 */
  alpha: 0.12,
  /** 직전 값 대비 이만큼(ms) 이상 갑자기 변한 표본은 튀는 값으로 보고 버린다 */
  jumpRejectMs: 50,
  /** 튀는 값이 이만큼 연속으로 들어오면 실제로 바뀐 것(장치 전환 등)으로 보고 받아들인다 */
  forceAcceptAfter: 6,
} as const;

/** getOutputTimestamp() 결과 모양(일부만 있을 수도 있다) */
export interface OutputStampLike {
  contextTime?: number;
  performanceTime?: number;
}

/** "들리는 AudioContext 시간(초) ↔ performance.now(ms)" 표본 하나 */
export interface HeardSample {
  contextSec: number;
  perfMs: number;
}

/**
 * 이번에 쓸 표본을 고른다.
 * getOutputTimestamp 가 없거나 0 을 주면(아직 소리가 안 나옴) currentTime − (outputLatency ?? baseLatency ?? 0) 로 대신한다.
 * @param fallbackLatencySec 대신할 때 빼 줄 출력 지연(초): outputLatency ?? baseLatency ?? 0
 */
export function pickHeardSample(stamp: OutputStampLike | undefined, currentTimeSec: number, perfNowMs: number, fallbackLatencySec: number): HeardSample {
  const ct = stamp?.contextTime;
  const pt = stamp?.performanceTime;
  if (typeof ct === 'number' && typeof pt === 'number' && Number.isFinite(ct) && Number.isFinite(pt) && ct > 0 && pt > 0) {
    return { contextSec: ct, perfMs: pt };
  }
  const lat = Number.isFinite(fallbackLatencySec) && fallbackLatencySec > 0 ? fallbackLatencySec : 0;
  return { contextSec: currentTimeSec - lat, perfMs: perfNowMs };
}

/** 표본을 넣을 때의 결과 */
export type FeedResult = 'init' | 'ok' | 'rejected' | 'forced';

/** 들리는 시계: offset(= 들리는 AudioContext 시간 − performance.now/1000)을 부드럽게 유지한다 */
export class HeardClock {
  private offsetSec = 0;
  private ready = false;
  private rejects = 0;

  /** 값이 한 번이라도 정해졌는지 */
  get isReady(): boolean {
    return this.ready;
  }

  /** 처음 상태로 되돌린다(재생을 새로 시작할 때) */
  reset(): void {
    this.ready = false;
    this.rejects = 0;
    this.offsetSec = 0;
  }

  /** 표본 하나를 반영한다. 튀는 값은 버리되, 연속으로 들어오면 실제 변화로 받아들인다. */
  feed(sample: HeardSample): FeedResult {
    const raw = sample.contextSec - sample.perfMs / 1000;
    if (!this.ready) {
      this.offsetSec = raw;
      this.ready = true;
      this.rejects = 0;
      return 'init';
    }
    const jumpMs = Math.abs(raw - this.offsetSec) * 1000;
    if (jumpMs >= HEARD_CLOCK_CONFIG.jumpRejectMs) {
      this.rejects += 1;
      if (this.rejects >= HEARD_CLOCK_CONFIG.forceAcceptAfter) {
        this.offsetSec = raw;
        this.rejects = 0;
        return 'forced';
      }
      return 'rejected';
    }
    this.rejects = 0;
    this.offsetSec += (raw - this.offsetSec) * HEARD_CLOCK_CONFIG.alpha;
    return 'ok';
  }

  /** performance.now 시각(ms)에 귀에 들리는 AudioContext 시간(초). 값이 없으면 NaN */
  heardContextSec(perfMs: number): number {
    return this.ready ? perfMs / 1000 + this.offsetSec : Number.NaN;
  }
}

/** 값이 뒤로 가지 않게 하는 도우미(화면용 곡 시간) */
export class NeverBackwards {
  private last = Number.NEGATIVE_INFINITY;

  /** 새 값을 넣으면 지금까지의 최댓값 이상인 값을 돌려준다 */
  next(value: number): number {
    if (!Number.isFinite(value)) return Number.isFinite(this.last) ? this.last : 0;
    if (value > this.last) this.last = value;
    return this.last;
  }

  /** 다시 시작/이동할 때 기억을 지운다 */
  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

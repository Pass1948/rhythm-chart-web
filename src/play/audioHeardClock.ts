// 브라우저용 들리는 시계: AudioContext 에서 표본을 읽어 HeardClock(순수 계산)에 넣는다. 화면 그리기·판정·싱크 맞추기가 같은 방식을 쓴다.
import { HeardClock, pickHeardSample } from './heardClock';

/** 출력 지연 추정(초): outputLatency ?? baseLatency ?? 0 */
function reportedLatencySec(context: AudioContext): number {
  const c = context as unknown as { outputLatency?: number; baseLatency?: number };
  const v = c.outputLatency ?? c.baseLatency ?? 0;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export class AudioHeardClock {
  private readonly clock = new HeardClock();
  private readonly context: AudioContext;

  constructor(context: AudioContext) {
    this.context = context;
  }

  /** 지금 표본을 한 번 읽어 반영한다(프레임마다·입력마다 불러도 가볍다) */
  sample(): void {
    const stamp = this.context.getOutputTimestamp?.();
    this.clock.feed(pickHeardSample(stamp, this.context.currentTime, performance.now(), reportedLatencySec(this.context)));
  }

  /** 처음부터 다시 구한다(재생을 새로 시작할 때) */
  reset(): void {
    this.clock.reset();
    this.sample();
  }

  /** performance.now 기준 시각(ms)에 귀에 들리는 AudioContext 시간(초). 아직 값이 없으면 currentTime */
  heardContextSec(perfMs: number): number {
    const v = this.clock.heardContextSec(perfMs);
    return Number.isNaN(v) ? this.context.currentTime : v;
  }

  /** 기기 소리 지연 추정(ms): 소리를 내보낸 시점과 들리는 시점의 차이. 0 이상 */
  latencyMs(): number {
    const heard = this.heardContextSec(performance.now());
    return Math.max(0, (this.context.currentTime - heard) * 1000);
  }
}

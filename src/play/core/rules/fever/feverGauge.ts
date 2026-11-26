// 피버타임 게이지: great 이상만 충전, 100%가 되면 자동 발동, 지속 시간 동안 직선으로 감소.
// 시간은 곡 시간(ms)을 호출하는 쪽에서 넘겨준다. 순수 로직.
import type { GameConfig, Grade } from '../../config/gameConfig';

export type FeverConfig = GameConfig['fever'];

const FULL_PERCENT = 100;

export class FeverGauge {
  /** 충전량 g (%) */
  readonly g: number;
  private chargePercent = 0;
  private activeUntilMs = -Infinity;
  private activeFlag = false;
  /** 지금까지 피버가 발동한 횟수 */
  private triggerCount = 0;

  private readonly config: FeverConfig;

  constructor(
    totalNotes: number,
    config: FeverConfig,
  ) {
    this.config = config;
    if (!(totalNotes > 0)) {
      throw new Error('총 노트 수가 0 이하라서 피버 충전량을 계산할 수 없습니다.');
    }
    this.g = config.gNumerator / totalNotes;
  }

  /** 시간이 흘러 피버가 끝났는지 확인하고 상태를 갱신한다. (끝나면 게이지는 0에서 다시 시작) */
  update(timeMs: number): void {
    if (this.activeFlag && timeMs >= this.activeUntilMs) {
      this.activeFlag = false;
      this.chargePercent = 0;
    }
  }

  /** 지금 피버 중인지 */
  isActive(timeMs: number): boolean {
    this.update(timeMs);
    return this.activeFlag;
  }

  /** 피버가 몇 번 발동했는지 */
  get triggers(): number {
    return this.triggerCount;
  }

  /** 표시용 게이지 (%). 피버 중에는 남은 시간 비율로 직선 감소한다. */
  gaugePercent(timeMs: number): number {
    this.update(timeMs);
    if (this.activeFlag) {
      const remaining = Math.max(0, this.activeUntilMs - timeMs);
      return (remaining / this.config.durationMs) * FULL_PERCENT;
    }
    return this.chargePercent;
  }

  /** 점수 배율 (피버 중이면 설정 배율, 아니면 1) */
  scoreMultiplier(timeMs: number): number {
    return this.isActive(timeMs) ? this.config.scoreMultiplier : 1;
  }

  /** 판정 하나를 반영한다. perfect·great 만 충전하며 피버 중에는 충전하지 않는다. weight: 롱노트 부분의 비중(기본 1, 04-H) */
  onGrade(grade: Grade, timeMs: number, weight = 1): void {
    this.update(timeMs);
    if (this.activeFlag) return;
    let factor = 0;
    if (grade === 'perfect') factor = this.config.perfectChargeFactor;
    else if (grade === 'great') factor = this.config.greatChargeFactor;
    if (factor === 0) return;

    this.chargePercent = Math.min(FULL_PERCENT, this.chargePercent + factor * this.g * weight);
    if (this.chargePercent >= FULL_PERCENT) {
      this.activeFlag = true;
      this.activeUntilMs = timeMs + this.config.durationMs;
      this.triggerCount += 1;
    }
  }
}

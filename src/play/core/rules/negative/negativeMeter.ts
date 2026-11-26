// 부정수치: 0%에서 시작해 Hit 하면 줄고 Miss 하면 늘어난다. 100%에 닿으면 즉시 실패.
// 공식은 기획_확정.md 6번을 따른다. 순수 로직.
import type { DifficultyName, GameConfig, Grade } from '../../config/gameConfig';

export type NegativeConfig = GameConfig['negative'];

/** 감소량 h (%) = hNumerator / N */
export function reductionPerNote(totalNotes: number, config: NegativeConfig): number {
  return config.hNumerator / totalNotes;
}

/** 증가량 d (%) = h × (1 - A) / A, 단 하한~상한 사이로 제한 */
export function increasePerMiss(totalNotes: number, allowedMissRatio: number, config: NegativeConfig): number {
  const h = reductionPerNote(totalNotes, config);
  const raw = (h * (1 - allowedMissRatio)) / allowedMissRatio;
  return Math.min(config.dMaxPercent, Math.max(config.dMinPercent, raw));
}

export class NegativeMeter {
  /** 감소량 h (%) */
  readonly h: number;
  /** 증가량 d (%) */
  readonly d: number;
  private current = 0;
  private failedFlag = false;

  private readonly config: NegativeConfig;

  constructor(
    totalNotes: number,
    difficulty: DifficultyName,
    config: NegativeConfig,
  ) {
    this.config = config;
    if (!(totalNotes > 0)) {
      throw new Error('총 노트 수가 0 이하라서 부정수치를 계산할 수 없습니다.');
    }
    this.h = reductionPerNote(totalNotes, config);
    this.d = increasePerMiss(totalNotes, config.allowedMissRatio[difficulty], config);
  }

  /** 현재 부정수치 (%, 0~100) */
  get percent(): number {
    return this.current;
  }

  /** 100%에 닿아 실패했는지 (한 번 실패하면 계속 실패) */
  get failed(): boolean {
    return this.failedFlag;
  }

  /**
   * 등급 하나를 반영하고 새 부정수치를 돌려준다. 이미 실패했으면 변하지 않는다.
   * weight: 이 판정의 비중(기본 1). 롱노트의 시작 판정·틱은 1 ÷ (1 + 틱 수) 를 곱해 적용한다 (04-H).
   */
  apply(grade: Grade, weight = 1): number {
    if (this.failedFlag) return this.current;
    const c = this.config;
    let change = 0;
    switch (grade) {
      case 'perfect':
        change = -c.perfectHFactor * this.h;
        break;
      case 'great':
        change = -c.greatHFactor * this.h;
        break;
      case 'good':
        change = -c.goodHFactor * this.h;
        break;
      case 'bad':
        change = c.badDFactor * this.d;
        break;
      case 'miss':
        change = c.missDFactor * this.d;
        break;
    }
    this.current = Math.min(c.failPercent, Math.max(0, this.current + change * weight));
    if (this.current >= c.failPercent) this.failedFlag = true;
    return this.current;
  }

  /** 곡이 끝났을 때 클리어인지: 실패하지 않았으면(100% 미만) 클리어 */
  isCleared(): boolean {
    return !this.failedFlag && this.current < this.config.failPercent;
  }
}

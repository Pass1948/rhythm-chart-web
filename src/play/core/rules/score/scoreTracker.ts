// 점수 계산: 등급 가중치 × 기본 점수(만점이 표시 만점이 되도록 정규화) × 피버 배율.
// 결과: 점수 비율, 랭크, 적 체력 감소율. 콤보는 표시용으로만 센다. 순수 로직.
import type { GameConfig, Grade, Rank } from '../../config/gameConfig';

export type ScoreConfig = GameConfig['score'];

export interface ScoreSummary {
  /** 표시 점수 (반올림 전 값) */
  score: number;
  /** 표시 만점 */
  maxScore: number;
  /** 점수 ÷ 만점 (피버 보너스가 있으면 1을 넘을 수 있음) */
  ratio: number;
  rank: Rank;
  /** 적 체력 감소율 (0~상한) */
  enemyDamageRatio: number;
  maxCombo: number;
}

/** 점수 비율로 랭크를 정한다. */
export function rankFromRatio(ratio: number, config: ScoreConfig): Rank {
  if (ratio >= config.rankS) return 'S';
  if (ratio >= config.rankA) return 'A';
  if (ratio >= config.rankB) return 'B';
  return 'C';
}

export class ScoreTracker {
  private readonly basePerNote: number;
  private total = 0;
  private combo = 0;
  private best = 0;

  private readonly totalNotes: number;
  private readonly weights: Record<Grade, number>;
  private readonly config: ScoreConfig;

  constructor(
    totalNotes: number,
    weights: Record<Grade, number>,
    config: ScoreConfig,
  ) {
    this.totalNotes = totalNotes;
    this.weights = weights;
    this.config = config;
    if (!(totalNotes > 0)) {
      throw new Error('총 노트 수가 0 이하라서 점수를 계산할 수 없습니다.');
    }
    // perfect 가중치가 1.0일 때 전부 perfect 면 표시 만점이 되도록 정규화한다
    this.basePerNote = config.displayMaxScore / totalNotes;
  }

  /**
   * 판정 하나를 반영한다. feverMultiplier 는 적용할 피버 배율(없으면 1).
   * weight: 점수 비중(기본 1). 롱노트의 시작 판정·틱은 1 ÷ (1 + 틱 수) (04-H).
   * isTick: 롱노트 틱이면 true. 틱은 콤보를 올리기만 하고, BAD 등 콤보를 끊는 등급이어도 끊지 않는다(0 유지).
   */
  add(grade: Grade, feverMultiplier: number, weight = 1, isTick = false): void {
    this.total += this.basePerNote * this.weights[grade] * feverMultiplier * weight;
    if (this.config.comboBreakGrades.includes(grade)) {
      if (!isTick) this.combo = 0;
    } else {
      this.combo += 1;
      if (this.combo > this.best) this.best = this.combo;
    }
  }

  /** 지금 콤보 (표시용) */
  get currentCombo(): number {
    return this.combo;
  }

  /** 지금까지의 점수 요약 */
  summary(): ScoreSummary {
    const maxScore = this.config.displayMaxScore;
    const score = this.config.clampScoreAtMax ? Math.min(this.total, maxScore) : this.total;
    const ratio = score / maxScore;
    return {
      score,
      maxScore,
      ratio,
      rank: rankFromRatio(ratio, this.config),
      enemyDamageRatio: Math.min(ratio, this.config.enemyDamageCap),
      maxCombo: this.best,
    };
  }

  /** 총 노트 수 */
  get notes(): number {
    return this.totalNotes;
  }
}

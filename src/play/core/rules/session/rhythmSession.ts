// 한 곡 플레이의 규칙을 하나로 묶는다: 판정 엔진 → 부정수치 · 피버 · 점수.
// 화면은 이 클래스의 입력 함수(pressLane/releaseLane/advance/finish)와 snapshot/result 만 사용하면 된다.
// 순수 로직이며 렌더링·오디오 코드를 가져오지 않는다.
import type { ChartNote, LaneIndex } from '../../chart/types';
import type { DifficultyName, GameConfig, Grade, Rank } from '../../config/gameConfig';
import { JudgeEngine, holdTickIntervalMs, type JudgeEvent } from '../judge/judgeEngine';
import { NegativeMeter } from '../negative/negativeMeter';
import { FeverGauge } from '../fever/feverGauge';
import { ScoreTracker } from '../score/scoreTracker';

const GRADES: readonly Grade[] = ['perfect', 'great', 'good', 'bad', 'miss'];

/** 플레이 중 화면에 보여 줄 현재 상태 */
export interface SessionSnapshot {
  negativePercent: number;
  failed: boolean;
  score: number;
  combo: number;
  feverGaugePercent: number;
  feverActive: boolean;
  resolvedNotes: number;
  totalNotes: number;
}

/** 곡이 끝난(또는 실패한) 뒤의 결과 */
export interface SessionResult {
  /** 클리어 여부: 부정수치만으로 결정 */
  cleared: boolean;
  failed: boolean;
  /** 실패한 곡 시간 (실패하지 않았으면 null) */
  failedAtMs: number | null;
  negativePercent: number;
  score: number;
  maxScore: number;
  ratio: number;
  rank: Rank;
  /** 적 체력 감소율. 클리어했을 때만 의미가 있고(적은 항상 쓰러짐), 실패하면 0 */
  enemyDamageRatio: number;
  enemyDefeated: boolean;
  maxCombo: number;
  feverTriggers: number;
  /** 판정 집계: 롱노트는 노트당 1번(시작 판정 등급, 중간에 떼면 MISS)만 센다 */
  gradeCounts: Record<Grade, number>;
  totalNotes: number;
  /** 롱노트 틱 hit 수 (내부 값, 화면에는 표시하지 않음) */
  tickHits: number;
}

export class RhythmSession {
  private readonly judge: JudgeEngine;
  private readonly negative: NegativeMeter;
  private readonly fever: FeverGauge;
  private readonly score: ScoreTracker;
  private readonly gradeCounts: Record<Grade, number> = { perfect: 0, great: 0, good: 0, bad: 0, miss: 0 };
  private resolved = 0;
  private tickHits = 0;
  private failedAtMs: number | null = null;
  private finished = false;

  constructor(
    notes: readonly ChartNote[],
    difficulty: DifficultyName,
    config: GameConfig,
    /** 곡 BPM. 있으면 롱노트 틱 간격(16분음표)을 계산한다. 없으면 틱이 없는 롱노트로 동작 */
    bpm?: number,
  ) {
    const total = notes.length;
    const tickIntervalMs = bpm === undefined ? Number.POSITIVE_INFINITY : holdTickIntervalMs(bpm, config.judge);
    this.judge = new JudgeEngine(notes, config.judge, tickIntervalMs);
    this.negative = new NegativeMeter(total, difficulty, config.negative);
    this.fever = new FeverGauge(total, config.fever);
    this.score = new ScoreTracker(total, config.scoreWeight, config.score);
  }

  /** 레인을 눌렀다. 곡 시간(ms)은 입력 지연 보정이 적용된 값을 넘긴다. */
  pressLane(lane: LaneIndex, timeMs: number): JudgeEvent[] {
    if (!this.isActive()) return [];
    return this.consume(this.judge.pressLane(lane, timeMs));
  }

  /** 레인에서 손을 뗐다. */
  releaseLane(lane: LaneIndex, timeMs: number): JudgeEvent[] {
    if (!this.isActive()) return [];
    return this.consume(this.judge.releaseLane(lane, timeMs));
  }

  /** 곡 시간이 흘렀다. 매 프레임 호출한다. */
  advance(timeMs: number): JudgeEvent[] {
    if (!this.isActive()) return [];
    return this.consume(this.judge.advance(timeMs));
  }

  /** 곡이 끝났다. 남은 노트를 모두 확정한다. */
  finish(): JudgeEvent[] {
    if (this.finished) return [];
    const events = this.failedAtMs === null ? this.consume(this.judge.finish()) : [];
    this.finished = true;
    return events;
  }

  /** [읽기 전용] 연타 노트의 남은 횟수 (판정 엔진이 세는 값 그대로). 연타가 아니면 0 */
  burstRemaining(noteIndex: number): number {
    return this.judge.burstRemaining(noteIndex);
  }

  /** 지금 화면에 보여 줄 상태 */
  snapshot(timeMs: number): SessionSnapshot {
    const summary = this.score.summary();
    return {
      negativePercent: this.negative.percent,
      failed: this.negative.failed,
      score: summary.score,
      combo: this.score.currentCombo,
      feverGaugePercent: this.fever.gaugePercent(timeMs),
      feverActive: this.fever.isActive(timeMs),
      resolvedNotes: this.resolved,
      totalNotes: this.score.notes,
    };
  }

  /** 결과를 계산한다. finish() 전에 불러도 되지만, 클리어는 finish() 후에만 true 가 된다. */
  result(): SessionResult {
    const summary = this.score.summary();
    const failed = this.negative.failed;
    const cleared = this.finished && !failed && this.negative.isCleared();
    return {
      cleared,
      failed,
      failedAtMs: this.failedAtMs,
      negativePercent: this.negative.percent,
      score: summary.score,
      maxScore: summary.maxScore,
      ratio: summary.ratio,
      rank: summary.rank,
      enemyDamageRatio: cleared ? summary.enemyDamageRatio : 0,
      enemyDefeated: cleared,
      maxCombo: summary.maxCombo,
      feverTriggers: this.fever.triggers,
      gradeCounts: { ...this.gradeCounts },
      totalNotes: this.score.notes,
      tickHits: this.tickHits,
    };
  }

  /** 입력·시간 처리를 계속해도 되는 상태인지 (실패했거나 끝났으면 false) */
  private isActive(): boolean {
    return !this.finished && this.failedAtMs === null;
  }

  /** 판정 엔진이 내보낸 사건을 부정수치·피버·점수에 반영한다. 실패하면 그 뒤 사건은 버린다. */
  private consume(events: JudgeEvent[]): JudgeEvent[] {
    const accepted: JudgeEvent[] = [];
    for (const event of events) {
      if (this.failedAtMs !== null) break;
      accepted.push(event);

      // 점수·부정수치·피버·콤보에는 비중(weight)이 있는 사건만 반영한다 (롱노트는 시작 판정과 틱이 1개분을 나눠 가짐)
      if (event.weight > 0) {
        // 점수의 피버 배율은 이 판정이 피버를 발동시키기 전 상태로 계산한다
        const multiplier = this.fever.scoreMultiplier(event.timeMs);
        this.score.add(event.grade, multiplier, event.weight, event.kind === 'holdTick');
        this.fever.onGrade(event.grade, event.timeMs, event.weight);
        this.negative.apply(event.grade, event.weight);
      }
      if (event.kind === 'holdTick') this.tickHits += 1;
      if (event.kind === 'resolved') {
        this.gradeCounts[event.grade] += 1;
        this.resolved += 1;
      }
      if (this.negative.failed) this.failedAtMs = event.timeMs;
    }
    return accepted;
  }

  /** 등급 이름 목록 (표시·집계용) */
  static get gradeNames(): readonly Grade[] {
    return GRADES;
  }
}

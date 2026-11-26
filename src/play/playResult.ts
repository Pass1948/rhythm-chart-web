// 한 판의 결과 모으기(순수 로직): 판정 사건에서 평균 오차·MISS 목록을 모으고 PlayResult(계약 6번)로 만든다.
import type { ChartNote } from './core/chart/types';
import type { SessionResult } from './core/rules/session/rhythmSession';
import type { JudgeEvent } from './core/rules/judge/judgeEngine';

/** MISS 한 건 */
export interface MissEntry {
  /** 편집기 노트 번호 (모르면 -1) */
  noteId: number;
  timeMs: number;
  type: string;
}

/** 화면에 보여 줄 한 판 결과 (계약의 PlayResult 보다 조금 더 자세함) */
export interface RunSummary {
  score: number;
  counts: Record<string, number>;
  maxCombo: number;
  /** 부호 있는 평균 오차(ms): 음수 = 빠름, 양수 = 느림. 친 노트가 없으면 0 */
  meanErrorMs: number;
  earlyCount: number;
  lateCount: number;
  /** 빠르게 친 것들의 평균(ms, 음수) / 늦게 친 것들의 평균(ms, 양수). 없으면 0 */
  earlyMeanMs: number;
  lateMeanMs: number;
  missList: MissEntry[];
  totalNotes: number;
  rank: string;
  failed: boolean;
}

/** 판정 사건을 모아 평균 오차와 MISS 목록을 만든다 */
export class RunStats {
  private errorSum = 0;
  private errorCount = 0;
  private earlySum = 0;
  private earlyCount = 0;
  private lateSum = 0;
  private lateCount = 0;
  private readonly misses: MissEntry[] = [];

  /**
   * @param notes 이번 판에 쓰는 노트 목록 (판정 사건의 noteIndex 가 가리키는 목록)
   * @param noteIds notes 와 같은 순서의 편집기 노트 번호 (없으면 -1 로 둔다)
   */
  private readonly notes: readonly ChartNote[];
  private readonly noteIds: ReadonlyArray<number | null>;

  constructor(notes: readonly ChartNote[], noteIds: ReadonlyArray<number | null>) {
    this.notes = notes;
    this.noteIds = noteIds;
  }

  /** 판정 사건 하나를 반영한다. 점수·부정수치와 달리 오차·MISS 목록만 센다. */
  add(event: JudgeEvent): void {
    // 오차: 단타의 판정, 롱노트를 처음 잡은 순간. 모든 폭 밖(miss)은 오차에 넣지 않는다.
    if (event.deltaMs !== null && event.grade !== 'miss' && (event.kind === 'holdStarted' || (event.kind === 'resolved' && event.noteType === 'tap'))) {
      this.errorSum += event.deltaMs;
      this.errorCount += 1;
      if (event.deltaMs < 0) {
        this.earlySum += event.deltaMs;
        this.earlyCount += 1;
      } else if (event.deltaMs > 0) {
        this.lateSum += event.deltaMs;
        this.lateCount += 1;
      }
    }
    if (event.kind === 'resolved' && event.grade === 'miss') {
      const note = this.notes[event.noteIndex];
      if (note === undefined) return;
      this.misses.push({ noteId: this.noteIds[event.noteIndex] ?? -1, timeMs: note.timeMs, type: note.type });
    }
  }

  /** 지금까지 모은 MISS 목록 (시간 순) */
  missList(): MissEntry[] {
    return [...this.misses].sort((a, b) => a.timeMs - b.timeMs);
  }

  /** 세션 결과와 합쳐서 한 판 요약을 만든다 */
  summarize(result: SessionResult): RunSummary {
    return {
      score: Math.round(result.score),
      counts: { ...result.gradeCounts },
      maxCombo: result.maxCombo,
      meanErrorMs: this.errorCount === 0 ? 0 : this.errorSum / this.errorCount,
      earlyCount: this.earlyCount,
      lateCount: this.lateCount,
      earlyMeanMs: this.earlyCount === 0 ? 0 : this.earlySum / this.earlyCount,
      lateMeanMs: this.lateCount === 0 ? 0 : this.lateSum / this.lateCount,
      missList: this.missList(),
      totalNotes: result.totalNotes,
      rank: result.rank,
      failed: result.failed,
    };
  }
}

/** 계약 6번의 PlayResult 모양으로 바꾼다 */
export function toPlayResult(summary: RunSummary): { score: number; counts: Record<string, number>; maxCombo: number; meanErrorMs: number; missList: { noteId: number; timeMs: number; type: string }[] } {
  return {
    score: summary.score,
    counts: summary.counts,
    maxCombo: summary.maxCombo,
    meanErrorMs: Math.round(summary.meanErrorMs * 10) / 10,
    missList: summary.missList.map((m) => ({ noteId: m.noteId, timeMs: m.timeMs, type: m.type })),
  };
}

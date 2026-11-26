// 올 퍼펙트·무입력 시뮬레이션: 렌더링·오디오 없이 규칙(RhythmSession)에 노트의 정확한 시각을 직접 넣어 결과를 본다.
// 자동 입력(브라우저)의 시각 오차와 상관없는 "공식 검증값"이다. 원본 chartCheck\allPerfect.ts 를 웹 버전 위치에 맞게 옮겼다.
import type { ChartNote } from '../play/core/chart/types';
import type { DifficultyName, GameConfig } from '../play/core/config/gameConfig';
import { RhythmSession } from '../play/core/rules/session/rhythmSession';
import { buildInputs, runInputs } from '../play/core/testing/simulate';

export interface SimulationResult {
  cleared: boolean;
  failed: boolean;
  score: number;
  rank: string;
  negativePercent: number;
  missCount: number;
  perfectCount: number;
  totalNotes: number;
}

function summarize(session: RhythmSession): SimulationResult {
  const result = session.result();
  return {
    cleared: result.cleared,
    failed: result.failed,
    score: result.score,
    rank: result.rank,
    negativePercent: result.negativePercent,
    missCount: result.gradeCounts.miss,
    perfectCount: result.gradeCounts.perfect,
    totalNotes: result.totalNotes,
  };
}

/** 모든 노트를 정확한 시각에(오차 0ms) 치는 시뮬레이션 */
export function simulateAllPerfect(notes: readonly ChartNote[], difficulty: DifficultyName, config: GameConfig, bpm: number): SimulationResult {
  const session = new RhythmSession(notes, difficulty, config, bpm);
  runInputs(session, buildInputs(notes, () => 0));
  return summarize(session);
}

/** 아무것도 치지 않는 시뮬레이션 (연습 모드가 아니면 실패해야 정상) */
export function simulateNoInput(notes: readonly ChartNote[], difficulty: DifficultyName, config: GameConfig, bpm: number): SimulationResult {
  const session = new RhythmSession(notes, difficulty, config, bpm);
  runInputs(session, []);
  return summarize(session);
}

// 테스트용 플레이 시뮬레이터: 채보 노트마다 "이렇게 치겠다"는 계획을 받아 입력 이벤트를 만들어 세션에 넣는다.
import type { ChartNote } from '../chart/types';
import type { Grade } from '../config/gameConfig';
import type { RhythmSession } from '../rules/session/rhythmSession';

/** 노트 하나를 어떻게 칠지: 입력 시간 차(ms, 음수=빠름), 또는 null 이면 치지 않음(miss) */
export type NotePlan = number | null;

interface InputEvent {
  timeMs: number;
  kind: 'press' | 'release';
  lane: 0 | 1;
}

/** 시뮬레이션 결과: 기대하는 등급 집계는 계획에서 직접 계산해 엔진 결과와 비교할 수 있게 한다. */
export interface SimulationPlan {
  inputs: InputEvent[];
}

/** 계획대로 입력 이벤트 목록을 만든다. 단타 = 누름, 롱노트 = 누름+끝에서 뗌, 연타 = 구간 안에서 count 번 번갈아 누름. */
export function buildInputs(notes: readonly ChartNote[], plan: (note: ChartNote, index: number) => NotePlan): InputEvent[] {
  const inputs: InputEvent[] = [];
  notes.forEach((note, index) => {
    const delta = plan(note, index);
    if (delta === null) return;
    if (note.type === 'tap') {
      const lane = note.lane as 0 | 1;
      inputs.push({ timeMs: note.timeMs + delta, kind: 'press', lane });
      inputs.push({ timeMs: note.timeMs + delta + 1, kind: 'release', lane });
    } else if (note.type === 'hold') {
      const lane = note.lane as 0 | 1;
      inputs.push({ timeMs: note.timeMs + delta, kind: 'press', lane });
      inputs.push({ timeMs: note.timeMs + note.durationMs, kind: 'release', lane });
    } else {
      const spacing = note.durationMs / note.count;
      for (let i = 0; i < note.count; i += 1) {
        const lane = (i % 2) as 0 | 1;
        const at = note.timeMs + spacing * i + spacing * 0.1;
        inputs.push({ timeMs: at, kind: 'press', lane });
        inputs.push({ timeMs: at + spacing * 0.3, kind: 'release', lane });
      }
    }
  });
  // 같은 시각이면 뗌이 먼저
  inputs.sort((a, b) => a.timeMs - b.timeMs || (a.kind === b.kind ? 0 : a.kind === 'release' ? -1 : 1));
  return inputs;
}

/** 입력 이벤트를 세션에 순서대로 넣고 마지막에 finish 한다. */
export function runInputs(session: RhythmSession, inputs: readonly InputEvent[]): void {
  for (const input of inputs) {
    if (input.kind === 'press') session.pressLane(input.lane, input.timeMs);
    else session.releaseLane(input.lane, input.timeMs);
  }
  session.finish();
}

/** 계획으로부터 기대하는 등급 집계를 계산한다. (엔진과 독립적으로 계산) */
export function expectedGradeCounts(
  notes: readonly ChartNote[],
  plan: (note: ChartNote, index: number) => NotePlan,
  gradeOfDelta: (absDeltaMs: number) => Grade,
): Record<Grade, number> {
  const counts: Record<Grade, number> = { perfect: 0, great: 0, good: 0, bad: 0, miss: 0 };
  notes.forEach((note, index) => {
    const delta = plan(note, index);
    if (delta === null) counts.miss += 1;
    else if (note.type === 'burst') counts.great += 1;
    else counts[gradeOfDelta(Math.abs(delta))] += 1;
  });
  return counts;
}

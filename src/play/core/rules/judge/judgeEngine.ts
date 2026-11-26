// 판정 엔진: 입력 이벤트(레인, 눌림/뗌, 시각)를 받아 노트를 판정한다.
// 순수 로직이다. 렌더링·오디오·브라우저 코드를 가져오지 않는다. 모든 시각은 "곡 시간(ms)"이며,
// 입력 지연 보정은 호출하는 쪽에서 이미 적용해서 넘긴다.
import type { ChartNote, LaneIndex, NoteType } from '../../chart/types';
import type { GameConfig, Grade } from '../../config/gameConfig';

export type JudgeConfig = GameConfig['judge'];

/** 판정 엔진이 내보내는 사건 */
export interface JudgeEvent {
  /**
   * 'resolved'    : 노트 하나가 끝남 (단타·연타의 판정, 롱노트의 완료/MISS). 판정 집계는 노트당 이 사건 1번만 센다
   * 'holdStarted' : 롱노트를 처음 쳐서 잡기 시작함 = 롱노트의 "시작 판정" 부분 (04-H: 규칙에 반영됨)
   * 'holdTick'    : 롱노트를 누르고 있는 동안 16분음표 간격으로 나는 틱 hit (04-H, 등급은 시작 판정을 따름)
   */
  kind: 'resolved' | 'holdStarted' | 'holdTick';
  noteIndex: number;
  noteType: NoteType;
  grade: Grade;
  /** 사건이 일어난 곡 시간 (ms) */
  timeMs: number;
  /** 입력 시간 - 노트 시간 (ms). 음수 = 빠름. 단타·롱노트 첫 입력일 때만 값이 있고 나머지는 null */
  deltaMs: number | null;
  /**
   * 이 사건이 점수·부정수치·피버·콤보에 반영되는 비중 (04-H). 단타·연타·롱노트 MISS 는 1,
   * 롱노트의 시작 판정과 틱은 1 ÷ (1 + 틱 수), 롱노트 완료 사건은 0 (이미 부분마다 반영했으므로 집계용)
   */
  weight: number;
}

type NoteState = 'waiting' | 'holding' | 'resolved';

interface NoteRuntime {
  note: ChartNote;
  state: NoteState;
  /** 롱노트: 첫 입력으로 정해진 등급 */
  firstGrade: Grade;
  firstDeltaMs: number | null;
  /** 연타: 지금까지 센 입력 횟수 */
  burstCount: number;
  /** 롱노트: 틱 개수 T (끝 시각 이내) */
  tickCount: number;
  /** 롱노트: 다음에 낼 틱 번호 (1부터) */
  nextTick: number;
  /** 롱노트: 부분(시작 판정, 틱)마다의 비중 w = 1 ÷ (1 + T). 그 밖의 노트는 1 */
  partWeight: number;
}

/** 롱노트 틱 간격(ms) = 60000 ÷ BPM ÷ 분할 단위. 최소 간격보다 짧으면 최소 간격을 쓴다. (04-H) */
export function holdTickIntervalMs(bpm: number, config: JudgeConfig): number {
  return Math.max(config.holdMinTickIntervalMs, 60000 / bpm / config.holdTickSubdivision);
}

/** 롱노트 길이 안에 들어가는 틱 개수 T: 노트 시작 + k × 간격 (k = 1, 2, …) 이 끝 시각 이내인 k 의 수 */
export function holdTickCount(durationMs: number, tickIntervalMs: number): number {
  if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0) return 0;
  return Math.floor(durationMs / tickIntervalMs + 1e-9);
}

/** k 번째 틱의 곡 시각(ms): 채보의 롱노트 시작 시각 기준으로 고정 */
export function holdTickTimeMs(note: ChartNote, k: number, tickIntervalMs: number): number {
  return note.timeMs + k * tickIntervalMs;
}

/** 입력 시간 차(절댓값, ms)로 등급을 정한다. 모든 폭 밖이면 miss. */
export function gradeFromDelta(absDeltaMs: number, config: JudgeConfig): Grade {
  if (absDeltaMs <= config.perfectMs) return 'perfect';
  if (absDeltaMs <= config.greatMs) return 'great';
  if (absDeltaMs <= config.goodMs) return 'good';
  if (absDeltaMs <= config.badMs) return 'bad';
  return 'miss';
}

export class JudgeEngine {
  private readonly runtimes: NoteRuntime[];
  /** 레인별 눌림 (2키는 앞 두 칸만 쓴다. 4키는 네 칸) */
  private readonly pressed: boolean[] = [false, false, false, false];
  /** 레인별로 지금 잡고 있는 롱노트의 번호 (없으면 -1) */
  private readonly activeHold: number[] = [-1, -1, -1, -1];
  /** 아직 확정되지 않은 가장 앞 노트의 번호 (검색 범위를 줄이기 위함) */
  private cursor = 0;
  private lastTimeMs = -Infinity;

  private readonly config: JudgeConfig;
  private readonly tickIntervalMs: number;

  /**
   * @param tickIntervalMs 롱노트 틱 간격(ms). 생략하면 틱이 없는 롱노트(시작 판정 + 끝 처리만)로 동작한다.
   */
  constructor(
    notes: readonly ChartNote[],
    config: JudgeConfig,
    tickIntervalMs: number = Number.POSITIVE_INFINITY,
  ) {
    this.config = config;
    this.tickIntervalMs = tickIntervalMs;
    this.runtimes = notes.map((note) => {
      const tickCount = note.type === 'hold' ? holdTickCount(note.durationMs, tickIntervalMs) : 0;
      return {
        note,
        state: 'waiting',
        firstGrade: 'miss',
        firstDeltaMs: null,
        burstCount: 0,
        tickCount,
        nextTick: 1,
        partWeight: 1 / (1 + tickCount),
      };
    });
  }

  /** 아직 확정되지 않은 노트 수 */
  get unresolvedCount(): number {
    let count = 0;
    for (let i = this.cursor; i < this.runtimes.length; i += 1) {
      if (this.runtimes[i]!.state !== 'resolved') count += 1;
    }
    return count;
  }

  /**
   * [읽기 전용] 연타 노트의 남은 횟수 = 필요 횟수 - 지금까지 센 횟수 (0 아래로 내려가지 않음).
   * 연타가 아니거나 없는 번호이면 0. 화면의 "×n" 표시가 판정 계산과 어긋나지 않게 하려고 04-B단계에 추가했다.
   */
  burstRemaining(noteIndex: number): number {
    const runtime = this.runtimes[noteIndex];
    if (runtime === undefined || runtime.note.type !== 'burst') return 0;
    return Math.max(0, runtime.note.count - runtime.burstCount);
  }

  /** 곡 시간이 흘러 확정되어야 할 노트(놓친 단타, 끝난 롱노트·연타)를 확정한다. */
  advance(timeMs: number): JudgeEvent[] {
    const events: JudgeEvent[] = [];
    if (timeMs > this.lastTimeMs) this.lastTimeMs = timeMs;
    for (let i = this.cursor; i < this.runtimes.length; i += 1) {
      const runtime = this.runtimes[i]!;
      if (runtime.note.timeMs > timeMs) break;
      if (runtime.state === 'resolved') continue;
      this.advanceNote(i, runtime, timeMs, events);
    }
    this.moveCursor();
    // 긴 롱노트가 먼저 시작해도 확정 시각 순서로 전달한다
    events.sort((a, b) => a.timeMs - b.timeMs);
    return events;
  }

  /** 레인을 눌렀을 때. 연타 구간이면 연타 횟수에 더하고, 아니면 가장 가까운 노트 하나를 판정한다. */
  pressLane(lane: LaneIndex, timeMs: number): JudgeEvent[] {
    const events = timeMs > this.lastTimeMs ? this.advance(timeMs) : [];
    if (this.pressed[lane]) return events; // 키 반복 입력 무시
    this.pressed[lane] = true;

    // 연타 구간 안이면 모든 레인 입력을 합산한다.
    // [웹 버전 수정] 구간 끝 시각(시작 + 길이)에 딱 맞닿은 다음 노트의 입력은 연타로 세지 않는다(끝 시각은 구간에 넣지 않음).
    // 편집기는 연타 바로 뒤에 맞붙은 단타·롱노트를 허용하므로, 원본의 "<=" 이면 그 노트의 정확한 입력이 연타로 먹혀 MISS 가 난다.
    for (let i = this.cursor; i < this.runtimes.length; i += 1) {
      const runtime = this.runtimes[i]!;
      if (runtime.note.timeMs > timeMs) break;
      if (runtime.note.type === 'burst' && runtime.state === 'waiting' && timeMs < runtime.note.timeMs + runtime.note.durationMs) {
        runtime.burstCount += 1;
        return events;
      }
    }

    // 판정 폭 안에 있는 같은 레인의 단타·롱노트 중 가장 가까운 것
    let bestIndex = -1;
    let bestAbsDelta = Infinity;
    for (let i = this.cursor; i < this.runtimes.length; i += 1) {
      const runtime = this.runtimes[i]!;
      if (runtime.note.timeMs - this.config.badMs > timeMs) break;
      if (runtime.state !== 'waiting' || runtime.note.type === 'burst' || runtime.note.lane !== lane) continue;
      const absDelta = Math.abs(timeMs - runtime.note.timeMs);
      if (absDelta <= this.config.badMs && absDelta < bestAbsDelta) {
        bestIndex = i;
        bestAbsDelta = absDelta;
      }
    }
    if (bestIndex < 0) return events; // 노트가 없는 곳을 누름: 아무 일도 없음

    const runtime = this.runtimes[bestIndex]!;
    const deltaMs = timeMs - runtime.note.timeMs;
    const grade = gradeFromDelta(bestAbsDelta, this.config);
    if (runtime.note.type === 'tap') {
      runtime.state = 'resolved';
      events.push(this.makeEvent('resolved', bestIndex, runtime, grade, timeMs, deltaMs, 1));
    } else {
      runtime.state = 'holding';
      runtime.firstGrade = grade;
      runtime.firstDeltaMs = deltaMs;
      this.activeHold[lane] = bestIndex;
      events.push(this.makeEvent('holdStarted', bestIndex, runtime, grade, timeMs, deltaMs, runtime.partWeight));
      // 늦게 눌러서 이미 지나간 틱은 누른 순간에 같은 등급으로 인정한다 (손해 없이 가치만 나눠 받음)
      this.emitTicks(bestIndex, runtime, timeMs, timeMs, events);
    }
    this.moveCursor();
    return events;
  }

  /**
   * 레인에서 손을 뗐을 때. 롱노트를 잡고 있었다면:
   * 길이의 completeRatio(95%) 지점 이후에 뗐으면 정상 완료(남은 틱은 같은 등급으로 자동 hit), 그 전이면 MISS 한 번.
   */
  releaseLane(lane: LaneIndex, timeMs: number): JudgeEvent[] {
    const events = timeMs > this.lastTimeMs ? this.advance(timeMs) : [];
    this.pressed[lane] = false;
    const index = this.activeHold[lane];
    if (index < 0) return events;
    const runtime = this.runtimes[index]!;
    if (runtime.state !== 'holding') return events;

    const note = runtime.note;
    const endMs = note.timeMs + note.durationMs;
    const completeMs = note.timeMs + note.durationMs * this.config.holdCompleteRatio;
    runtime.state = 'resolved';
    this.activeHold[lane] = -1;
    if (timeMs >= completeMs) {
      const doneMs = Math.min(timeMs, endMs);
      this.emitTicks(index, runtime, Number.POSITIVE_INFINITY, doneMs, events); // 남은 틱 자동 hit
      events.push(this.makeEvent('resolved', index, runtime, runtime.firstGrade, doneMs, runtime.firstDeltaMs, 0));
    } else {
      events.push(this.makeEvent('resolved', index, runtime, 'miss', timeMs, runtime.firstDeltaMs, 1));
    }
    this.moveCursor();
    return events;
  }

  /** 곡이 끝났을 때. 남은 노트를 모두 확정한다. (놓친 단타 miss, 잡고 있던 롱노트 성공, 연타 결과) */
  finish(): JudgeEvent[] {
    const events = this.advance(Infinity);
    this.pressed.fill(false);
    return events;
  }

  /** 노트 하나가 시간 경과로 확정되어야 하는지 보고 확정한다. */
  private advanceNote(index: number, runtime: NoteRuntime, timeMs: number, events: JudgeEvent[]): void {
    const note = runtime.note;
    const endMs = note.timeMs + note.durationMs;
    if (note.type === 'burst') {
      if (timeMs > endMs) {
        runtime.state = 'resolved';
        const grade: Grade = runtime.burstCount >= note.count ? 'great' : 'miss'; // 연타 성공 = great, 실패 = miss
        events.push(this.makeEvent('resolved', index, runtime, grade, endMs, null, 1));
      }
      return;
    }
    if (runtime.state === 'holding') {
      // 누르고 있는 동안 지난 틱을 낸다. 끝 시각이 지나도 계속 누르고 있으면 끝 시각에 자동 완료한다 (감점 없음)
      this.emitTicks(index, runtime, timeMs, null, events);
      if (timeMs >= endMs) {
        runtime.state = 'resolved';
        this.activeHold[note.lane as LaneIndex] = -1;
        events.push(this.makeEvent('resolved', index, runtime, runtime.firstGrade, endMs, runtime.firstDeltaMs, 0));
      }
      return;
    }
    // waiting 인 단타·롱노트: 놓침 시간이 지나면 자동 miss
    const deadline = note.timeMs + this.config.autoMissAfterMs;
    if (timeMs > deadline) {
      runtime.state = 'resolved';
      events.push(this.makeEvent('resolved', index, runtime, 'miss', deadline, null, 1));
    }
  }

  /**
   * 롱노트의 틱을 낸다: 곡 시각 uptoMs 까지 도달한 틱(다음 번호부터)을 모두 'holdTick' 사건으로 만든다.
   * 등급은 시작 판정을 그대로 따른다. eventTimeMs 가 null 이면 각 틱의 원래 시각을, 아니면 그 값을 사건 시각으로 쓴다.
   */
  private emitTicks(index: number, runtime: NoteRuntime, uptoMs: number, eventTimeMs: number | null, events: JudgeEvent[]): void {
    while (runtime.nextTick <= runtime.tickCount) {
      const tickMs = holdTickTimeMs(runtime.note, runtime.nextTick, this.tickIntervalMs);
      if (tickMs > uptoMs) break;
      runtime.nextTick += 1;
      events.push(this.makeEvent('holdTick', index, runtime, runtime.firstGrade, eventTimeMs ?? tickMs, null, runtime.partWeight));
    }
  }

  /** 앞쪽의 확정된 노트를 건너뛰도록 cursor 를 옮긴다. */
  private moveCursor(): void {
    while (this.cursor < this.runtimes.length && this.runtimes[this.cursor]!.state === 'resolved') {
      this.cursor += 1;
    }
  }

  private makeEvent(
    kind: JudgeEvent['kind'],
    noteIndex: number,
    runtime: NoteRuntime,
    grade: Grade,
    timeMs: number,
    deltaMs: number | null,
    weight: number,
  ): JudgeEvent {
    return { kind, noteIndex, noteType: runtime.note.type, grade, timeMs, deltaMs, weight };
  }
}

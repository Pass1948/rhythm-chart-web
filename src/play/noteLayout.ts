// 노트가 화면에 어떻게 보이는지 정하는 계산 (순수 함수). 그림은 그리지 않는다.
import type { ChartNote } from './core/chart/types';
import { noteProgress } from './railGeometry';

/** 노트 하나의 화면 상태 (판정 사건으로 바뀐다) */
export const NOTE_STATE = {
  /** 아직 치지 않음 */
  waiting: 0,
  /** 롱노트를 누르고 있는 중 */
  holding: 1,
  /** 판정이 끝나 화면에서 치움 */
  done: 2,
  /** 롱노트를 놓쳐서 회색으로 내려가는 중 */
  broken: 3,
} as const;
export type NoteVisualState = (typeof NOTE_STATE)[keyof typeof NOTE_STATE];

/** 노트 시간 범위를 진행도로 바꾼 값 (머리 = 판정 시각, 꼬리 = 끝 시각) */
export interface NoteSpan {
  head: number;
  tail: number;
}

/** 노트의 머리·꼬리 진행도를 구한다. (결과 객체를 받아서 채우므로 새 객체를 만들지 않는다) */
export function fillNoteSpan(out: NoteSpan, note: ChartNote, songMs: number, visualOffsetMs: number, fallTimeMs: number): NoteSpan {
  out.head = noteProgress(note.timeMs, songMs, visualOffsetMs, fallTimeMs);
  out.tail = noteProgress(note.timeMs + note.durationMs, songMs, visualOffsetMs, fallTimeMs);
  return out;
}

/** 막대(롱노트·연타)가 그려질 진행도 범위 */
export interface BarRange {
  /** 위쪽(먼 쪽) 진행도 */
  top: number;
  /** 아래쪽(가까운 쪽) 진행도 */
  bottom: number;
}

/**
 * 막대 범위를 구한다. 그릴 것이 없으면 false.
 * - 누르는 중인 롱노트와 연타는 막대 아래쪽이 판정선(1)에 붙어 줄어든다.
 * - 아직 안 친 롱노트와 놓친(회색) 롱노트는 그대로 내려가고, 레일 끝(bottomProgress)에서 잘린다.
 */
export function fillBarRange(
  out: BarRange,
  type: ChartNote['type'],
  state: NoteVisualState,
  span: NoteSpan,
  bottomProgress: number,
): boolean {
  const attached = type === 'burst' || state === NOTE_STATE.holding;
  const top = Math.max(span.tail, 0);
  const bottom = attached ? Math.min(span.head, 1) : Math.min(span.head, bottomProgress);
  out.top = top;
  out.bottom = bottom;
  return bottom > 0 && top < bottom;
}

/** 단타가 그려지는지: 레일 맨 위에 나타난 뒤 레일 끝에 닿기 전까지 */
export function isTapVisible(head: number, bottomProgress: number): boolean {
  return head > 0 && head < bottomProgress;
}

/**
 * 보이는 노트 번호 모으기: 노트 목록은 시각 순으로 정렬되어 있다.
 * 이미 완전히 지나간 앞쪽 노트는 cursor 로 건너뛰고, 아직 나타나기 전의 노트가 나오면 멈춘다.
 * 긴 롱노트 뒤에 짧은 노트가 먼저 지나갈 수 있어서, cursor 뒤의 지나간 노트는 하나씩 건너뛴다.
 */
export class VisibleNotes {
  private cursor = 0;
  private readonly span: NoteSpan = { head: 0, tail: 0 };
  /** 지금 그릴 노트 번호 (앞쪽 count 칸만 의미가 있다) */
  readonly indices: Int32Array;
  count = 0;
  /** 한 번이라도 풀이 모자라 못 그린 노트가 있었는지 */
  overflowed = false;

  private readonly notes: readonly ChartNote[];

  constructor(
    notes: readonly ChartNote[],
    capacity: number,
  ) {
    this.notes = notes;
    this.indices = new Int32Array(capacity);
  }

  /** 지금 곡 시간에 보여야 하는 노트를 indices 에 모은다. */
  collect(songMs: number, visualOffsetMs: number, fallTimeMs: number, bottomProgress: number): void {
    const notes = this.notes;
    while (this.cursor < notes.length) {
      fillNoteSpan(this.span, notes[this.cursor]!, songMs, visualOffsetMs, fallTimeMs);
      if (this.span.tail < bottomProgress) break;
      this.cursor += 1;
    }
    let count = 0;
    for (let i = this.cursor; i < notes.length; i += 1) {
      fillNoteSpan(this.span, notes[i]!, songMs, visualOffsetMs, fallTimeMs);
      if (this.span.head <= 0) break;
      if (this.span.tail >= bottomProgress) continue;
      if (count >= this.indices.length) {
        this.overflowed = true;
        break;
      }
      this.indices[count] = i;
      count += 1;
    }
    this.count = count;
  }
}

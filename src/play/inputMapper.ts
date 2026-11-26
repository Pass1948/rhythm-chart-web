// 입력을 레인으로 바꾸는 계산 (순수 함수). 키보드 키 이름 → 레인, 화면 위 클릭 위치 → 레인.
import type { GameConfig } from './core/config/gameConfig';
import type { KeyMode, LaneIndex } from './core/chart/types';
import { PLAY_CONFIG, PLAY_VIEW } from './playConfig';
import { laneOffsetRatio } from './railGeometry';

/** 4키 고정 키 배치: 왼쪽 → 오른쪽 레인 0~3 = S D K L (설정에서 바꿀 수 없다) */
export const FOUR_KEY_CODES: readonly string[] = ['KeyS', 'KeyD', 'KeyK', 'KeyL'];
/** 4키 레인 표시 글자 */
export const FOUR_KEY_LABELS: readonly string[] = ['S', 'D', 'K', 'L'];

export type InputSettings = GameConfig['input'];

/** 키보드 키(KeyboardEvent.code)가 어느 레인 키인지. 키보드를 껐거나 레인 키가 아니면 null */
export function laneFromKey(code: string, input: InputSettings, keyMode: KeyMode = 2): LaneIndex | null {
  if (!input.keyboardEnabled) return null;
  if (keyMode === 4) {
    const index = FOUR_KEY_CODES.indexOf(code);
    return index < 0 ? null : (index as LaneIndex);
  }
  if (code === input.keyLeft) return 0;
  if (code === input.keyRight) return 1;
  return null;
}

/**
 * 화면의 가로 위치(0 = 왼쪽 끝, 1 = 오른쪽 끝)를 레인으로 바꾼다. 마우스를 껐으면 null.
 * 가운데 구분선(0.5)을 기준으로 왼쪽 절반은 왼쪽 레인, 나머지는 오른쪽 레인이다.
 */
export function laneFromPointer(relativeX: number, input: InputSettings, keyMode: KeyMode = 2, bounds: readonly number[] | null = null): LaneIndex | null {
  if (!input.mouseEnabled) return null;
  if (bounds !== null) return zoneIndex(relativeX, bounds);
  if (keyMode === 4) return fourKeyZoneOf(relativeX);
  return relativeX < 0.5 ? 0 : 1;
}

/**
 * 4키 터치 구역의 경계(화면 가로 0~1 비율, 3개). 레일 판정선의 4개 레인 가운데 사이의 한가운데이므로
 * "가장 가까운 레인"과 같다. 맨 왼쪽·맨 오른쪽 레인은 화면 가장자리까지 이어진다.
 */
export function fourKeyZoneBounds(): readonly [number, number, number] {
  const rail = PLAY_CONFIG.rail;
  const half = rail.judgeWidth / 2;
  const centers = [0, 1, 2, 3].map((lane) => rail.centerX + half * laneOffsetRatio(lane, 4));
  return [(centers[0]! + centers[1]!) / 2 / PLAY_VIEW.width, (centers[1]! + centers[2]!) / 2 / PLAY_VIEW.width, (centers[2]! + centers[3]!) / 2 / PLAY_VIEW.width];
}

/** 경계 목록(오름차순, 화면 가로 0~1 비율)으로 가로 위치가 속한 구역 번호 (새 화면 10-C 처럼 레인 위치가 다른 화면용) */
export function zoneIndex(relativeX: number, bounds: readonly number[]): LaneIndex {
  let zone = 0;
  for (const b of bounds) if (relativeX >= b) zone += 1;
  return Math.min(3, zone) as LaneIndex;
}

/** 화면 가로 위치(0~1)가 속한 4키 레인 (가장 가까운 레인 가운데) */
export function fourKeyZoneOf(relativeX: number): LaneIndex {
  const [a, b, c] = fourKeyZoneBounds();
  return relativeX < a ? 0 : relativeX < b ? 1 : relativeX < c ? 2 : 3;
}

/** 클릭한 화면 위치(clientX)와 입력 영역의 위치·폭으로 0~1 가로 위치를 구한다. 폭이 0이면 0.5 */
export function relativeX(clientX: number, areaLeft: number, areaWidth: number): number {
  if (!(areaWidth > 0)) return 0.5;
  return Math.min(1, Math.max(0, (clientX - areaLeft) / areaWidth));
}

/**
 * 손가락(포인터) 번호별로 "어느 레인을 누르고 있는지" 기억한다. (멀티터치: 두 엄지를 동시에, 롱노트를 누른 채 다른 손가락으로 반대 레인)
 * 손가락이 처음 누른 레인으로 고정되므로, 누른 채 입력 영역 밖이나 반대쪽으로 밀려 나가도 뗄 때 같은 레인이 풀린다.
 */
export class PointerLaneTracker {
  private readonly lanes = new Map<number, LaneIndex>();

  /** 손가락이 내려왔다. 처음 보는 손가락이면 true (같은 번호가 이미 눌려 있으면 무시하고 false) */
  down(pointerId: number, lane: LaneIndex): boolean {
    if (this.lanes.has(pointerId)) return false;
    this.lanes.set(pointerId, lane);
    return true;
  }

  /** 손가락이 떨어지거나 취소되었다. 그 손가락이 누르던 레인을 돌려준다 (모르는 손가락이면 undefined) */
  up(pointerId: number): LaneIndex | undefined {
    const lane = this.lanes.get(pointerId);
    this.lanes.delete(pointerId);
    return lane;
  }

  /** 지금 눌려 있는 손가락 수 */
  get size(): number {
    return this.lanes.size;
  }

  /** 모두 뗐다고 본다 (일시정지·앱 전환 등). */
  clear(): void {
    this.lanes.clear();
  }
}

/** 눌린 레인 상태 (판정원 불 켜기용). 같은 레인을 여러 입력(키보드+마우스)으로 누를 수 있어 개수로 센다. */
export class LaneHoldCounter {
  private readonly counts: number[] = [0, 0, 0, 0];

  /** 눌렀다. 이 레인이 새로 눌린 것이면 true (이미 눌려 있었으면 false) */
  press(lane: LaneIndex): boolean {
    this.counts[lane]! += 1;
    return this.counts[lane] === 1;
  }

  /** 뗐다. 이 레인이 완전히 떼어진 것이면 true */
  release(lane: LaneIndex): boolean {
    if (this.counts[lane] === 0) return false;
    this.counts[lane]! -= 1;
    return this.counts[lane] === 0;
  }

  /** 지금 눌려 있는지 */
  isDown(lane: LaneIndex): boolean {
    return this.counts[lane]! > 0;
  }

  /** 모두 뗐다고 본다. */
  clear(): void {
    this.counts.fill(0);
  }
}

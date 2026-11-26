// 롱노트 "둥근 긴 막대(캡슐)"의 기하 계산 (순수 함수, Three.js 없음 → Node 로 테스트). 09단계.
// 모양: 위쪽(꼬리)·아래쪽(머리) 끝이 반원인 막대. 머리 쪽 반지름 = 단타 반지름(원근 반영), 꼬리 쪽은 원근으로 더 작다.
// 두 반원의 중심은 각각 노트 머리 시각·꼬리 시각의 화면 위치(단타 원의 중심과 같은 기준)이고, 몸통은 두 반원의 가로 가장자리를 잇는다.
// 막대는 "가로줄(row)"들의 띠로 표현한다: 위 반원 (CAP_SEGMENTS+1)줄 → 아래 반원 (CAP_SEGMENTS+1)줄. 두 반원 사이의 띠가 몸통이다.
// 몸통이 반원 높이보다 짧아도(짧은 롱노트) 두 반원이 겹쳐 하나의 알약/원처럼 이어져, 별도의 예외 처리가 필요 없다.
// 끝이 화면 밖으로 잘린 쪽(캡 없음)은 반원 대신 평평하게 자른다. 연타(줄무늬 막대)는 같은 줄 구조에서 반원 줄을 한 곳에 모아 사다리꼴로 쓴다.

/** 반원 하나를 나누는 조각 수 */
export const CAP_SEGMENTS = 8;
/** 가로줄 개수 (위 반원 + 아래 반원) */
export const CAPSULE_ROWS = (CAP_SEGMENTS + 1) * 2;

/** 줄마다의 y(화면 좌표, 아래로 커짐)와 왼쪽·오른쪽 x */
export interface CapsuleRows {
  y: Float32Array;
  left: Float32Array;
  right: Float32Array;
}

export function createCapsuleRows(): CapsuleRows {
  return { y: new Float32Array(CAPSULE_ROWS), left: new Float32Array(CAPSULE_ROWS), right: new Float32Array(CAPSULE_ROWS) };
}

/** 캡슐 입력: 위쪽(꼬리)·아래쪽(머리)의 중심 x·y(화면 좌표), 반지름, 반원을 붙일지 */
export interface CapsuleInput {
  topX: number;
  topY: number;
  topR: number;
  /** false 면 위쪽을 반원 없이 평평하게 자른다(꼬리가 아직 레일 맨 위 밖) */
  capTop: boolean;
  bottomX: number;
  bottomY: number;
  bottomR: number;
  /** false 면 아래쪽을 평평하게 자른다(머리가 레일 끝 아래로 지나감) */
  capBottom: boolean;
}

/** 줄들을 채운다(새 배열을 만들지 않는다). 위쪽이 화면 위(작은 y)이고 topY <= bottomY 여야 한다. */
export function fillCapsuleRows(out: CapsuleRows, inp: CapsuleInput): void {
  const half = Math.PI / 2;
  for (let k = 0; k <= CAP_SEGMENTS; k += 1) {
    // 위 반원: 꼭대기(φ=0)에서 가장 넓은 곳(φ=90°)까지
    const phi = (k / CAP_SEGMENTS) * half;
    const w = inp.capTop ? inp.topR * Math.sin(phi) : inp.topR;
    out.y[k] = inp.capTop ? inp.topY - inp.topR * Math.cos(phi) : inp.topY;
    out.left[k] = inp.topX - w;
    out.right[k] = inp.topX + w;
    // 아래 반원: 가장 넓은 곳(φ=90°)에서 맨 아래(φ=180°)까지
    const phi2 = half + (k / CAP_SEGMENTS) * half;
    const w2 = inp.capBottom ? inp.bottomR * Math.sin(phi2) : inp.bottomR;
    const r = CAP_SEGMENTS + 1 + k;
    out.y[r] = inp.capBottom ? inp.bottomY - inp.bottomR * Math.cos(phi2) : inp.bottomY;
    out.left[r] = inp.bottomX - w2;
    out.right[r] = inp.bottomX + w2;
  }
}

/** 연타 같은 사다리꼴(반원 없음)을 같은 줄 구조로 채운다: 위 반원 줄은 모두 위 가장자리에, 아래 반원 줄은 모두 아래 가장자리에 모은다. */
export function fillQuadRows(out: CapsuleRows, topLeftX: number, topRightX: number, topY: number, bottomLeftX: number, bottomRightX: number, bottomY: number): void {
  for (let k = 0; k <= CAP_SEGMENTS; k += 1) {
    out.y[k] = topY;
    out.left[k] = topLeftX;
    out.right[k] = topRightX;
    const r = CAP_SEGMENTS + 1 + k;
    out.y[r] = bottomY;
    out.left[r] = bottomLeftX;
    out.right[r] = bottomRightX;
  }
}

/** 캡슐 전체가 차지하는 세로 범위(화면 y): 반원 끝까지 포함 */
export function capsuleExtent(inp: CapsuleInput): { top: number; bottom: number } {
  return { top: inp.capTop ? inp.topY - inp.topR : inp.topY, bottom: inp.capBottom ? inp.bottomY + inp.bottomR : inp.bottomY };
}

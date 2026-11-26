// 플레이 화면 수치 설정 (한 곳). 화면 배치·원근·노트 크기·카운트다운·풀 크기 등 플레이 화면이 쓰는 모든 수치는 여기서만 읽는다.
// 판정·점수 같은 게임 규칙 수치는 gameConfig.ts 에 있다. 이 파일은 "보이는 것"과 "흐름"에 관한 값만 둔다.

import { STAGE_VIEW } from './core/config/viewConfig';

/** 화면 기준 크기 (메뉴와 같은 세로 720x1280. 값은 viewConfig 한 곳에서 읽는다) */
export const PLAY_VIEW = STAGE_VIEW;

export const PLAY_CONFIG = {
  /** 시작할 때 3·2·1 카운트 (초) */
  startCountdownSec: 3,
  /** 일시정지에서 이어하기를 누른 뒤 카운트 (초) */
  resumeCountdownSec: 3,
  /**
   * 프레임마다 advance(곡 시간 - 이 값)을 부른다 (ms). 02단계 승인 9번:
   * 프레임 직후에 도착한 지연 입력이 이미 자동 miss 로 확정된 노트를 놓치지 않게 하는 여유.
   */
  advanceMarginMs: 50,
  /** 프레임 제한 때 이 시간(ms)만큼은 일찍 도착한 프레임도 그린다 (화면 주사율과 제한 값이 딱 맞지 않을 때의 흔들림 방지) */
  frameSlackMs: 2,
  /** 한 화면에 동시에 그릴 수 있는 노트 수의 최댓값 (그림 풀 크기). 넘치면 가장 먼 노트부터 그리지 않는다 */
  maxVisibleNotes: 48,
  /** 연타 막대 위 "×n" 글자 풀 크기 */
  burstLabelPool: 4,

  /**
   * 레일 원근 모양 (세로 720x1280 화면 좌표) [임시, 사용자 확인 필요]. 위가 좁고 아래가 넓은 사다리꼴.
   * 레일 높이 = bottomY - topY = 780 (화면 높이의 약 61%). 판정원 높이 = judgeY / 1280 ≈ 79%.
   */
  rail: {
    centerX: 360,
    /** 레일 맨 위(노트가 나타나는 곳)의 y 와 전체 폭 */
    topY: 350,
    topWidth: 190,
    /** 판정선의 y 와 그 위치에서의 레일 전체 폭 */
    judgeY: 1010,
    judgeWidth: 620,
    /** 레일 맨 아래(화면에 보이는 끝)의 y */
    bottomY: 1130,
    /** 중앙 구분선 굵기와 레일 바깥 테두리 굵기 (px) */
    centerLineWidth: 5,
    edgeWidth: 7,
  },

  /** 노트 모양 */
  note: {
    /** 판정선에서의 단타 반지름 (px). 원근에 따라 멀수록 작아진다 */
    tapRadius: 46,
    /** 단타 바깥 외곽선 두께 (px, 판정선 기준) */
    tapOutline: 5,
    /** 단타 가운데 크림색 점의 반지름 비율 */
    tapCenterRatio: 0.32,
    /** 롱노트 막대 폭: 레인 폭 대비 비율 */
    holdWidthRatio: 0.5,
    /** 연타 막대 폭: 전체 레일 폭 대비 비율 */
    burstWidthRatio: 0.97,
    /** 막대 외곽선 두께 (px, 판정선 기준) */
    barOutline: 5,
    /** 연타 줄무늬 한 묶음(검은 줄 + 크림 줄)이 차지하는 시간 (ms). 줄무늬는 노트 시간에 붙어서 내려온다 */
    stripeTileMs: 140,
  },

  /** 판정원 (레인 가운데). 노트가 비쳐 보이도록 채움은 반투명 [임시]. 가로 판정선은 없고, 안쪽 작은 원이 노트가 겹쳐야 하는 정확한 지점이다 */
  judgeCircle: {
    radius: 68,
    /** 평상시 채움 불투명도 (0~1) */
    fillOpacity: 0.35,
    /** 키를 누르는 동안 채움 불투명도 (0~1, 이 이상 올리지 않는다) */
    pressedOpacity: 0.5,
    /** 외곽선 굵기 (px). 얇고 선명하게 */
    outlineWidth: 3,
    /** 눌린 동안 바깥으로 번지는 빛의 추가 반지름 (px)과 불투명도 */
    glowExtra: 14,
    glowOpacity: 0.28,
    /** 안쪽 작은 원(링): 반지름은 큰 원의 비율, 외곽선 굵기(px), 외곽선·채움 불투명도 [임시] */
    innerRadiusRatio: 0.45,
    innerOutlineWidth: 3,
    innerOutlineOpacity: 0.95,
    innerFillOpacity: 0.06,
  },

  /** 키 안내 (각 판정원 바로 옆 바깥쪽: 왼쪽 판정원은 그 왼쪽, 오른쪽 판정원은 그 오른쪽). 키보드를 쓸 때만 보인다 */
  keyGuide: {
    /** 판정원 바깥 가장자리에서 떨어진 거리 (px) */
    gap: 10,
    /** 글자 크기 (px). 폰에서는 화면이 작아지므로 크게 */
    fontPx: 34,
    /** 평상시 / 눌렀을 때 글자 불투명도 */
    opacity: 0.7,
    pressedOpacity: 1,
  },

  /**
   * 세로 화면 HUD 배치 (720x1280 화면 좌표, 모두 이 한 곳에서 읽는다) [임시, 사용자 확인 필요].
   * 위에서 아래로: 일시정지·곡 정보 → 점수·피버·부정수치 패널 → 레일 → 판정원.
   */
  layout: {
    /** 화면 가장자리 여백 */
    margin: 16,
    /** 일시정지 버튼: 모서리, 한 변 (폰에서도 최소 터치 44px 이상이 되도록 크게) */
    pauseSize: 92,
    pauseTop: 10,
    /** 곡 정보 줄의 위치와 높이 */
    infoTop: 26,
    infoHeight: 60,
    /** 점수·피버·부정수치 패널 한 줄 (3칸) */
    panelTop: 108,
    panelHeight: 106,
    panelGap: 10,
    /** 판정 글자·콤보 묶음의 아래 끝 y (판정원 위) */
    judgeBlockBottomY: 930,
    /** 시작 카운트다운 숫자와 FEVER! 글자의 위 y */
    countdownTop: 540,
    feverTitleTop: 560,
    /** 터치 안내(탭 영역)의 위·아래 y */
    tapZoneTop: 350,
    tapZoneBottom: 1130,
  },

  /** 색 (팔레트: 크림/블랙/차콜/핫핑크/민트) */
  colors: {
    cream: 0xfbf3e8,
    black: 0x0e090f,
    pink: 0xfb4ea1,
    mint: 0x76f0b8,
    leftLane: 0x2c5446,
    rightLane: 0x5a2a46,
    broken: 0x8a8186,
    brokenOutline: 0x3a3438,
  },

  /** 부정수치 게이지 색: 낮을 때 핫핑크, 높을수록 붉게 */
  negativeColor: { low: [251, 78, 161], high: [255, 45, 45] },

  /** 판정 글자 색 (CSS) */
  gradeColors: { perfect: '#fbf3e8', great: '#76f0b8', good: '#9bd7ff', bad: '#c9a6ff', miss: '#ff5a6e' },
  /** 판정 글자 문구 */
  gradeLabels: { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', bad: 'BAD', miss: 'MISS' },

} as const;

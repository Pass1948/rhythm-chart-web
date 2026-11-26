// 테스트 플레이(편집기에서 여는 게임 화면) 전용 수치 (한 곳). 판정·점수 규칙 수치는 core\config\gameConfig.ts 에 있다.

export const PLAY_TEST_CONFIG = {
  /** 마지막 노트가 끝난 뒤 곡을 이만큼(ms) 더 기다렸다가 끝낸다 (놓친 노트 자동 확정 시간 + 여유) */
  endTailMs: 800,
  /** 시작 준비 화면에서 고를 수 있는 재생 속도 */
  rates: [0.5, 0.75, 1, 1.25] as readonly number[],
  /** 일시정지 화면에서 입력 지연(ms)·낙하 시간(ms)을 한 번에 바꾸는 크기 */
  delayStepMs: 5,
  fallStepMs: 100,
  /** 입력 지연·낙하 시간 허용 범위 (settingsStore 와 같다) */
  delayRange: { min: -500, max: 500 },
  fallRange: { min: 500, max: 2000 },
  /** 결과 화면 MISS 목록에 보여 줄 최대 개수 (넘으면 "외 N개"로 알려 준다) */
  missListShow: 200,
  /** 박자에 맞춘 배경 빛: 박자 시작 순간의 밝기와 줄어드는 정도 */
  beatGlow: { peak: 0.2, power: 2.2 },
  /** 판정 글자 옆 "빠름/느림 ms" 를 보여 주는 최소 오차 (ms). 이보다 작으면 "정확" 으로 본다 */
  detailMinMs: 3,
} as const;

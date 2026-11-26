// 화면 설정 상수: [테스트] 팝업에서 쓰는 키보드 키를 이 한 곳에서만 정한다.
// code 는 글자가 아니라 키의 물리적 위치(event.code)이므로 한글 입력 상태에서도 동작한다.
export const TEST_KEYS = [
  { lane: 0, code: 'KeyS', label: 'S', name: '왼쪽' },
  { lane: 1, code: 'KeyF', label: 'F', name: '오른쪽' },
];

// 키 코드로 레인 번호를 찾는다 (없으면 -1)
export function laneOfKey(code) {
  const k = TEST_KEYS.find((t) => t.code === code);
  return k ? k.lane : -1;
}

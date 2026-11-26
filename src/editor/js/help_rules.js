// 편집 도움말 내용 (`단축키 : 설명` 줄 목록). 실제 키 처리 코드에 있는 것만 적는다:
//  - 키보드: main.js 의 bindHotkeys (keydown)
//  - 마우스: vertical.js 의 onDown/onMove/onWheel
//  - 터치: ui/layout/touchEdit.ts
// 줄 하나 = { keys: [[칩, 칩…], …(또는 "/" 로 나뉜 다른 키)], desc }. keys 의 한 묶음 안은 "+" 로 같이 누르는 것.
// 마우스·터치 동작은 칩 종류를 'act' 로 표시한다(키 모양이 아니라 동작 이름).

const k = (...chips) => chips; // 같이 누르는 키 묶음

// 키보드 (모든 도구 공통)
export const HELP_KEYS = [
  { keys: [k('Space')], desc: '재생 / 일시정지' },
  { keys: [k('Ctrl', 'Z')], desc: '되돌리기' },
  { keys: [k('Ctrl', 'Y'), k('Ctrl', 'Shift', 'Z')], desc: '다시하기' },
  { keys: [k('Ctrl', 'A')], desc: '노트 모두 선택' },
  { keys: [k('Ctrl', 'C')], desc: '선택한 노트 복사' },
  { keys: [k('Ctrl', 'X')], desc: '선택한 노트 잘라내기' },
  { keys: [k('Ctrl', 'V')], desc: '붙여넣기 (마우스로 위치를 고르고 클릭)' },
  { keys: [k('Ctrl', 'Shift', 'V')], desc: '좌우를 뒤집어 붙여넣기' },
  { keys: [k('Delete'), k('Backspace')], desc: '선택한 노트 삭제' },
  { keys: [k('Esc')], desc: '붙여넣기 취소 / 선택 해제' },
  { keys: [k('['), k(']')], desc: '재생 속도 느리게 / 빠르게' },
  { keys: [k('M')], desc: '메트로놈 켜기 / 끄기' },
  { keys: [k('Ctrl', 'S')], desc: '저장' },
];

// 마우스·터치 (공통). act: true = 키가 아니라 동작 이름
export const HELP_POINTER = [
  { keys: [k('휠')], act: true, desc: '위아래로 이동' },
  { keys: [k('Ctrl', '휠')], act: true, desc: '확대 / 축소' },
  { keys: [k('음원 카드 노트 줄')], act: true, desc: '(PC) 음원 카드의 왼쪽·오른쪽 노트 줄에서도 같은 방식으로 편집합니다 (도구·선택은 오른쪽과 같이 바뀜). 눈금자·파형을 누르면 재생 위치 이동' },
  { keys: [k('4키 채보')], act: true, desc: '키 모드를 4키로 만든 채보는 레인이 4줄(1~4레인 = 게임에서 S D K L)입니다. 같은 위치에는 노트를 최대 2개까지, 레인 교체·좌우 뒤집기는 1↔4, 2↔3으로 바뀝니다.' },
  { keys: [k('왼쪽 시간 눈금 클릭')], act: true, desc: '그 시각으로 재생 위치 이동 (파형 띠 클릭도 같음)' },
  { keys: [k('탭')], act: true, desc: '(터치) 선택한 도구로 놓기 / 노트 선택' },
  { keys: [k('한 손가락 끌기')], act: true, desc: '(터치) 위아래 스크롤. 롱노트·연타 도구에서는 구간 만들기' },
  { keys: [k('두 손가락 벌리기')], act: true, desc: '(터치) 확대 / 축소' },
  { keys: [k('길게 누른 뒤 끌기')], act: true, desc: '(터치) 빈 곳이면 범위 선택, 노트 위면 노트 옮기기' },
];

// 도구별 한 줄씩
export const HELP_TOOLS = {
  select: { name: '선택', desc: '노트를 클릭해 선택하고 끌어서 옮깁니다 (연타는 위아래로만). 롱노트·연타의 위/아래 끝을 끌면 길이가 바뀝니다.' },
  tap: { name: '단타', desc: '빈 곳을 클릭하면 격자에 맞춰 단타가 놓입니다.' },
  hold: { name: '롱노트', desc: '빈 곳에서 위로 끌면 롱노트가 만들어집니다 (클릭만 하면 기본 길이).' },
  burst: { name: '연타', desc: '구간을 위로 끌면 양쪽 레인 연타가 만들어지고 횟수를 묻습니다. 연타 구간 안에는 다른 노트를 둘 수 없습니다.' },
};

// 선택 도구에서 쓰는 조작 (마우스)
export const HELP_SELECT = [
  { keys: [k('빈 곳 끌기')], act: true, desc: '(선택 도구) 사각형 안의 노트를 모두 선택' },
  { keys: [k('Shift', '클릭')], act: true, desc: '(선택 도구) 선택에 더하기 / 빼기' },
  { keys: [k('Shift', '영역 끌기')], act: true, desc: '(선택 도구) 기존 선택에 영역 추가' },
  { keys: [k('여러 개 선택 후 끌기')], act: true, desc: '(선택 도구) 선택한 노트를 함께 위아래로 옮기기' },
  { keys: [k('Shift', '끌기·클릭')], act: true, desc: '(단타·롱노트·연타 도구) 격자를 무시하고 놓기' },
];

// 화면 보기 기능
export const HELP_VIEW = [
  { keys: [k('파형')], act: true, desc: '도구줄의 [파형] 버튼: 음원 파형 띠를 오른쪽에 켜고 끕니다. 폭은 소리 크기, 색은 저음(주황)·중음(초록)·고음(하늘)입니다.' },
  { keys: [k('변속 구간')], act: true, desc: '[분석] 옆의 [변속 구간] 카드: BPM이 도중에 바뀌는 곡의 구간 추가·삭제·BPM·박자 고치기와 [변속 자동 찾기]. 마디선·박자 소리(M)·붙여넣기가 구간별 박자를 따릅니다.' },
  { keys: [k('BPM 이름표 끌기')], act: true, desc: '(PC) 편집 화면의 변속 점선 이름표를 위아래로 끌면 그 구간의 시작이 박 단위로 옮겨집니다. 폰은 [변속 구간] 카드에서 숫자로 고칩니다.' },
  { keys: [k('노트 모양')], act: true, desc: '도구줄의 [동그라미 / 바]: 편집 화면의 노트 모양만 바꿉니다 (채보 파일·테스트 화면은 그대로).' },
];

// 도움말 전체 (현재 도구는 강조용)
export function buildHelp(tool) {
  return [
    { title: '키보드', rows: HELP_KEYS },
    { title: '마우스·터치', rows: [...HELP_POINTER, ...HELP_SELECT] },
    {
      title: '도구별',
      rows: Object.entries(HELP_TOOLS).map(([id, t]) => ({ keys: [k(t.name)], act: true, desc: t.desc, current: id === tool })),
    },
    { title: '화면 보기', rows: HELP_VIEW },
  ];
}

// 도움말을 DOM 으로 그린다: 키 칩(<kbd>) : 설명
export function renderHelp(container, tool) {
  container.textContent = '';
  for (const sec of buildHelp(tool)) {
    const h = document.createElement('div');
    h.className = 'hsec';
    h.textContent = sec.title;
    container.appendChild(h);
    for (const row of sec.rows) {
      const line = document.createElement('div');
      line.className = 'hrow' + (row.current ? ' cur' : '');
      const keys = document.createElement('span');
      keys.className = 'hkeys';
      row.keys.forEach((combo, i) => {
        if (i > 0) keys.append(document.createTextNode(' / '));
        combo.forEach((chip, j) => {
          if (j > 0) keys.append(document.createTextNode('+'));
          const kbd = document.createElement('kbd');
          if (row.act) kbd.className = 'act';
          kbd.textContent = chip;
          keys.appendChild(kbd);
        });
      });
      const sep = document.createElement('span');
      sep.className = 'hsep';
      sep.textContent = ':';
      const desc = document.createElement('span');
      desc.className = 'hdesc';
      desc.textContent = row.desc;
      keys.append(document.createTextNode(' '), sep); // ':' 는 키 칩 바로 옆에 붙어 다닌다(줄이 바뀌어도 따로 떨어지지 않게)
      line.append(keys, desc);
      container.appendChild(line);
    }
  }
}

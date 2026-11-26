// 디자인 토큰(tokens.css 의 CSS 변수)을 시작할 때 한 번 읽어 두는 객체. Canvas 가 그릴 때마다 getComputedStyle 을 부르지 않도록 값을 캐시한다.
// 토큰이 바뀌면 refreshTheme() 로 다시 읽는다. 같은 객체를 계속 쓰므로 가져간 쪽에서도 새 값이 보인다.

const MAP = {
  bg: '--bg-canvas', laneA: '--bg-canvas-2', laneB: '--bg-canvas-3',
  text: '--text-on-dark-muted', textDim: '--text-on-dark-dim', textStrong: '--text-on-dark',
  tap: '--note-tap', hold: '--note-hold', holdFill: '--note-hold-fill', burst: '--note-burst', burstFill: '--note-burst-fill',
  tapLine: '--note-outline-tap', holdLine: '--note-outline-hold', burstLine: '--note-outline-burst', burstText: '--note-burst-text',
  onset: '--onset', pasteOk: '--paste-ok', pasteBad: '--paste-bad',
  gridBar: '--grid-bar', gridBeat: '--grid-beat', gridFine: '--grid-fine',
  playhead: '--playhead', selectOuter: '--select-outer', selectInner: '--select-inner', marquee: '--marquee',
  wave: '--wave', viewWindow: '--view-window', laneHeld: '--lane-held', lanePill: '--lane-pill',
  okDark: '--ok-dark', warnDark: '--warn-dark', badDark: '--bad-dark',
  tempo: '--tempo-line', tempoCand: '--tempo-cand',
  wvBg: '--wv-bg', wvLow: '--wv-low', wvMid: '--wv-mid', wvHigh: '--wv-high', wvCenter: '--wv-center', wvSel: '--wv-sel',
  fontFamily: '--font',
};

// 스타일 시트(tokens.css)를 읽을 수 없을 때만 쓰는 최소 대체값. 색의 기준은 tokens.css 한 곳이고,
// 여기에는 "아무것도 안 보이는 일이 없도록" 캔버스 바탕·글자·노트 3색·재생선·선택선만 둔다(나머지는 읽은 뒤에 채워진다).
const FALLBACK = {
  bg: '#252527', laneA: '#272729', laneB: '#2a2a2c', text: '#cccccc', textDim: '#a0a0a5',
  tap: '#6cc3ff', hold: '#5fd6a5', burst: '#ffb454', playhead: '#ffffff', selectOuter: '#ffffff', selectInner: '#1d1d1f',
  tempo: '#ffd166', tempoCand: '#c792ff',
  wvBg: '#161618', wvLow: '#ff9a3d', wvMid: '#3fd6a0', wvHigh: '#8fd8ff', wvCenter: 'rgba(255,255,255,0.18)', wvSel: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
};

export const theme = { ...FALLBACK };

// 글꼴 문자열 (Canvas 의 ctx.font 에 쓴다): theme.font(11) / theme.font(11, true)
theme.font = (px, bold = false) => `${bold ? '600 ' : ''}${px}px ${theme.fontFamily}`;

// CSS 변수를 다시 읽는다 (시작할 때 한 번, 필요하면 다시)
export function refreshTheme() {
  try {
    const cs = getComputedStyle(document.documentElement);
    for (const [key, name] of Object.entries(MAP)) {
      const v = cs.getPropertyValue(name).trim();
      if (v) theme[key] = v;
    }
  } catch (e) {
    /* 읽지 못하면 기본값을 그대로 쓴다 */
  }
  return theme;
}

refreshTheme();

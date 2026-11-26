/**
 * 플레이 화면 배치(04단계): 무대(세로 720x1280)를 창 크기에 맞춰 놓고, 크기별로 주변 표시를 붙인다.
 *  - PC(>=1024): 무대를 가운데에, 양옆에 정보 패널(곡·BPM·점수·콤보·판정 개수·키 안내·설정)
 *  - 태블릿(640~1023): 무대 + 아래 얇은 HUD 한 줄
 *  - 모바일 세로: 전체 화면 무대 / 가로: 무대를 높이에 맞춰 가운데, 양옆은 비움
 *  - 안전 영역(노치·홈 바) 반영, 창 크기·회전 때 바로 다시 맞춤, 길게 누르기 메뉴·선택 방지
 * 판정·점수 규칙은 만지지 않는다. 패널 숫자는 화면에 이미 그려진 글자(곡 이름·판정 글자)와 점검용 읽기 도구(window.__rcwPlay)에서 읽기만 한다.
 */
import './playLayout.css';
import { loadSettings, saveSettings } from '../../storage/settingsStore';
import { describePlayJudge, isDefaultPlayJudge, presetLabel, presetOf } from '../../play/playOptions';
import { volumeControls } from '../../play/playOptionsUi';
import { playJudge, playVolume } from '../../play/playOptionsStore';
import { computePlayLayout, type Insets, type PlayLayoutResult } from './layoutLogic';

/** 점검용 읽기 도구(playController 가 내놓는 것 중 쓰는 부분) */
interface PlayProbe {
  snapshot(): { score: number; combo: number; resolvedNotes: number; totalNotes: number; negativePercent: number } | null;
  rate(): number;
  startMs(): number;
  phase(): string;
  pause(): void;
  openJudgeSettings(): void;
}

const GRADES = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'] as const;
type GradeLabel = (typeof GRADES)[number];

export interface PlayLayoutHandle {
  /** 무대를 다시 맞추고 화면 배율(스테이지 한 칸이 화면 몇 px 인지)을 돌려준다 */
  fit(): number;
  /** 마지막 배치 결과(점검용) */
  last(): PlayLayoutResult;
  dispose(): void;
}

/** 요소 만들기 도우미 */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 안전 영역 여백을 읽는다(env() 값을 계산된 padding 으로 바꿔 읽는 방식) */
function readInsets(probe: HTMLElement): Insets {
  const cs = getComputedStyle(probe);
  const num = (v: string): number => Number.parseFloat(v) || 0;
  return { top: num(cs.paddingTop), right: num(cs.paddingRight), bottom: num(cs.paddingBottom), left: num(cs.paddingLeft) };
}

/** 슬라이더 한 줄(이름·값·범위 입력) */
function sliderRow(label: string, unit: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLElement {
  const row = make('label', 'rcw-set-row');
  const head = make('span', 'rcw-set-head');
  const name = make('span', '', label);
  const val = make('b', '', `${value}${unit}`);
  head.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = `${v}${unit}`;
    onChange(v);
  });
  // 슬라이더를 만지는 동안 플레이 화면의 키·터치 입력으로 번지지 않게 한다
  input.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') e.stopPropagation();
  });
  row.append(head, input);
  return row;
}

/** 플레이 화면(root) 안의 무대(stage)에 배치를 붙인다 */
export function attachPlayLayout(root: HTMLElement, stage: HTMLElement): PlayLayoutHandle {
  // 길게 누르기 메뉴·선택·끌기 방지(플레이 화면 안에서만)
  const stop = (e: Event): void => e.preventDefault();
  root.addEventListener('contextmenu', stop);
  root.addEventListener('selectstart', stop);
  root.addEventListener('dragstart', stop);

  const probe = make('div', 'rcw-insets-probe');
  root.append(probe);

  const left = make('aside', 'rcw-side rcw-side-left');
  const right = make('aside', 'rcw-side rcw-side-right');
  const bottom = make('div', 'rcw-bottombar');
  root.append(left, right, bottom);

  // ---- 왼쪽 패널: 곡 정보 + 키 안내
  const lTitle = make('div', 'rcw-side-title', '곡');
  const lSong = make('div', 'rcw-side-song', '-');
  const lMeta = make('div', 'rcw-side-meta', '-');
  const lProgress = make('div', 'rcw-side-meta', '진행 0 / 0');
  const keys = make('div', 'rcw-keys');
  const settings = loadSettings();
  const keyName = (code: string): string => code.replace(/^Key/, '').replace(/^Digit/, '');
  keys.append(make('div', 'rcw-key', keyName(settings.keys.left)), make('div', 'rcw-key rcw-key-r', keyName(settings.keys.right)));
  const keyHint = make('div', 'rcw-side-meta', '왼쪽 · 오른쪽 키 (화면을 직접 눌러도 됩니다)');
  left.append(lTitle, lSong, lMeta, lProgress, keys, keyHint);

  // ---- 오른쪽 패널: 점수·콤보·판정 개수 + 설정
  const rScore = make('b', 'rcw-big', '0');
  const rCombo = make('b', 'rcw-big', '0');
  const scoreBox = make('div', 'rcw-stat');
  scoreBox.append(make('span', 'rcw-stat-label', 'SCORE'), rScore);
  const comboBox = make('div', 'rcw-stat');
  comboBox.append(make('span', 'rcw-stat-label', 'COMBO'), rCombo);
  const counts = new Map<GradeLabel, HTMLElement>();
  const countList = make('div', 'rcw-counts');
  for (const g of GRADES) {
    const b = make('b', '', '0');
    counts.set(g, b);
    const row = make('div', `rcw-count rcw-count-${g.toLowerCase()}`);
    row.append(make('span', '', g), b);
    countList.append(row);
  }
  const setBox = make('div', 'rcw-settings');
  setBox.append(make('div', 'rcw-side-title', '설정'));
  setBox.append(sliderRow('입력 지연 보정', 'ms', -500, 500, 5, settings.inputDelayMs, (v) => saveSettings({ inputDelayMs: v })));
  setBox.append(sliderRow('낙하 시간', 'ms', 500, 2000, 100, settings.fallTimeMs, (v) => saveSettings({ fallTimeMs: v })));
  // 04b: 볼륨은 플레이 도중에도 바로 적용된다(음악·효과음 슬라이더, 음소거). 판정 설정은 일시정지에서 바꾸고 다음 시작부터 적용된다
  setBox.append(make('div', 'rcw-side-title', '볼륨'), volumeControls(playVolume, 'panel'));
  const judgeInfo = make('div', 'rcw-side-meta', '');
  const judgeBtn = make('button', 'rcw-side-btn', '판정 설정');
  judgeBtn.type = 'button';
  judgeBtn.addEventListener('click', () => probeNow()?.openJudgeSettings());
  const paintJudge = (): void => {
    const j = playJudge.get();
    judgeInfo.textContent = describePlayJudge(j) ?? `판정 설정: ${presetLabel(presetOf(j))}`;
    judgeInfo.dataset.default = String(isDefaultPlayJudge(j));
  };
  paintJudge();
  playJudge.subscribe(() => {
    if (judgeInfo.isConnected) paintJudge();
  });
  const rateInfo = make('div', 'rcw-side-meta', '속도 1배 · 처음부터');
  const setNote = make('div', 'rcw-side-meta', '입력 지연·낙하 시간 슬라이더 값은 저장되어 다음 시작부터 적용됩니다. 판정 설정도 일시정지에서 바꾸면 처음부터 다시 할 때부터 적용돼요(이 설정은 게임 화면 테스트에만 적용).');
  const pauseBtn = make('button', 'rcw-side-btn', '일시정지 · 설정 열기');
  pauseBtn.type = 'button';
  pauseBtn.addEventListener('click', () => probeNow()?.pause());
  setBox.append(judgeInfo, judgeBtn, rateInfo, setNote, pauseBtn);
  right.append(scoreBox, comboBox, countList, setBox);

  // ---- 태블릿 아래 얇은 HUD 한 줄
  const bSong = make('span', 'rcw-bar-song', '-');
  const bScore = make('span', 'rcw-bar-item', 'SCORE 0');
  const bCombo = make('span', 'rcw-bar-item', 'COMBO 0');
  const bCounts = make('span', 'rcw-bar-item rcw-bar-counts', '');
  bottom.append(bSong, bScore, bCombo, bCounts);

  const probeNow = (): PlayProbe | null => (window as unknown as { __rcwPlay?: PlayProbe }).__rcwPlay ?? null;

  // ---- 판정 개수: 화면에 그려지는 판정 글자를 지켜보며 센다(규칙 코드는 건드리지 않는다)
  const tally: Record<GradeLabel, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, BAD: 0, MISS: 0 };
  let lastResolved = 0;
  let observer: MutationObserver | null = null;
  let observed: Element | null = null;
  const renderCounts = (): void => {
    for (const g of GRADES) counts.get(g)!.textContent = String(tally[g]);
    bCounts.textContent = `P ${tally.PERFECT} · G ${tally.GREAT} · g ${tally.GOOD} · B ${tally.BAD} · M ${tally.MISS}`;
  };
  const watchJudge = (): void => {
    const el = root.querySelector('.pl-judge-text');
    if (!el || el === observed) return;
    observer?.disconnect();
    observed = el;
    observer = new MutationObserver(() => {
      const t = (el.textContent ?? '').trim() as GradeLabel;
      if ((GRADES as readonly string[]).includes(t)) {
        tally[t] += 1;
        renderCounts();
      }
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
  };

  let current: PlayLayoutResult = computePlayLayout(window.innerWidth, window.innerHeight);

  /** 패널·HUD 위치와 보이는 여부를 배치 결과에 맞춘다 */
  const place = (r: PlayLayoutResult): void => {
    root.dataset.layoutMode = r.mode;
    const gap = 16;
    const stageLeft = r.fit.left;
    const stageRight = r.fit.left + r.stageWidth;
    const showSide = r.sidePanelWidth > 0;
    left.hidden = !showSide;
    right.hidden = !showSide;
    if (showSide) {
      const top = Math.max(12, r.fit.top + 8);
      const height = Math.max(120, r.stageHeight - 16);
      left.style.cssText = `left:${Math.max(0, stageLeft - gap - r.sidePanelWidth)}px;width:${r.sidePanelWidth}px;top:${top}px;max-height:${height}px`;
      right.style.cssText = `left:${stageRight + gap}px;width:${r.sidePanelWidth}px;top:${top}px;max-height:${height}px`;
    }
    bottom.hidden = r.bottomBarHeight === 0;
    if (r.bottomBarHeight > 0) bottom.style.cssText = `height:${r.bottomBarHeight}px;padding-bottom:0;bottom:0`;
  };

  const fit = (): number => {
    const insets = readInsets(probe);
    current = computePlayLayout(window.innerWidth, window.innerHeight, insets);
    stage.style.transform = `translate(${current.fit.left}px, ${current.fit.top}px) scale(${current.fit.scale})`;
    root.style.setProperty('--stage-scale', String(current.fit.scale));
    place(current);
    return current.fit.scale;
  };

  // ---- 패널 숫자 새로 고침(초당 약 5번, 패널이 보일 때만)
  const timer = window.setInterval(() => {
    watchJudge();
    const song = root.querySelector('.pl-info-song')?.textContent ?? '';
    const bpm = root.querySelector('.pl-info-stage')?.textContent ?? '';
    const diff = root.querySelector('.pl-info-diff')?.textContent ?? '';
    const p = probeNow();
    const snap = p?.snapshot() ?? null;
    if (snap) {
      if (snap.resolvedNotes < lastResolved) {
        for (const g of GRADES) tally[g] = 0; // 처음부터 다시 시작
        renderCounts();
      }
      lastResolved = snap.resolvedNotes;
    }
    if (right.hidden && left.hidden && bottom.hidden) return;
    lSong.textContent = song || '-';
    lMeta.textContent = [bpm, diff].filter(Boolean).join(' · ') || '-';
    bSong.textContent = [song, bpm].filter(Boolean).join(' · ') || '-';
    if (snap) {
      rScore.textContent = Math.round(snap.score).toLocaleString('ko-KR');
      rCombo.textContent = String(snap.combo);
      lProgress.textContent = `진행 ${snap.resolvedNotes} / ${snap.totalNotes}`;
      bScore.textContent = `SCORE ${Math.round(snap.score).toLocaleString('ko-KR')}`;
      bCombo.textContent = `COMBO ${snap.combo}`;
    }
    if (p) rateInfo.textContent = `속도 ${p.rate()}배 · ${p.startMs() > 0 ? `${(p.startMs() / 1000).toFixed(1)}초부터` : '처음부터'}`;
  }, 200);

  fit();
  renderCounts();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);

  return {
    fit,
    last: () => current,
    dispose: () => {
      window.clearInterval(timer);
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
      root.removeEventListener('contextmenu', stop);
      root.removeEventListener('selectstart', stop);
      root.removeEventListener('dragstart', stop);
    },
  };
}

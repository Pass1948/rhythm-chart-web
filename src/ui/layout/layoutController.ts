/**
 * 편집기 반응형 배치 제어(화면 요소 연결 담당).
 *  - body 에 현재 배치(data-layout)와 좁은 화면의 탭(data-tab)을 적는다. 실제 모양은 layout.css 가 정한다.
 *  - PC(폭 1024 이상)는 맨 위 곡 등록 줄 + 3열 배치이고 이 파일은 모양을 바꾸지 않는다.
 *  - 탭별 카드 구성은 layoutLogic.ts 의 TAB_CARDS 가 기준이다.
 *  - 좁은 화면: 하단 탭 바 [곡][분석][편집][검사][플레이], ⋯ 더보기 메뉴의 항목 정리, 긴 상태 문구 펼치기.
 *  - 선택(마지막 탭)은 localStorage 에 기억한다. 저장이 막혀 있어도 그냥 동작한다.
 */
import { layoutModeOf, TAB_QUERY, type LayoutMode } from './layoutLogic';

const STORAGE_KEY = 'rcw.layout.v1';

type MobileTab = 'song' | 'analyze' | 'edit' | 'inspect';

interface LayoutPrefs {
  tab: MobileTab;
}

const DEFAULT_PREFS: LayoutPrefs = { tab: 'song' };

/** 저장된 선택을 읽는다(없거나 깨졌으면 기본값) */
function readPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const o = JSON.parse(raw) as Partial<LayoutPrefs>;
    const tabs: MobileTab[] = ['song', 'analyze', 'edit', 'inspect'];
    return { tab: tabs.includes(o.tab as MobileTab) ? (o.tab as MobileTab) : DEFAULT_PREFS.tab };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** 선택을 저장한다(실패해도 무시) */
function writePrefs(p: LayoutPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* 저장소가 막혀 있어도 화면은 동작한다 */
  }
}

/** 점검 화면(자동 테스트)이 읽는 모양 */
export interface LayoutHandle {
  mode(): LayoutMode;
  /** 손가락 조작을 쓰는 배치(좁은 화면의 탭 배치)인지 */
  isTouchLayout(): boolean;
  setTab(tab: MobileTab): void;
  prefs(): LayoutPrefs;
}

/** 편집기 배치 제어를 시작한다. 편집기 화면 조각이 문서에 들어간 뒤에 호출한다. */
export function initLayoutController(): LayoutHandle {
  const body = document.body;
  const prefs = readPrefs();
  const mqTab = window.matchMedia(TAB_QUERY);

  const mode = (): LayoutMode => layoutModeOf(window.innerWidth, window.innerHeight);
  const isTouchLayout = (): boolean => mode() !== 'pc';

  const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('#tabBar button[data-tab]')];

  /** 현재 선택을 화면 표시(body 속성·버튼 표시)에 반영한다 */
  const apply = (): void => {
    body.dataset.layout = mode();
    body.dataset.tab = prefs.tab;
    for (const b of tabButtons) {
      const on = b.dataset.tab === prefs.tab;
      b.classList.toggle('on', on);
      if (b.dataset.tab !== 'play') b.setAttribute('aria-current', on ? 'page' : 'false');
    }
    syncProxies();
  };

  const setTab = (tab: MobileTab): void => {
    prefs.tab = tab;
    writePrefs(prefs);
    apply();
  };

  // ---- 하단 탭 바: [플레이]는 화면을 바꾸지 않고 게임 화면 테스트를 연다
  for (const b of tabButtons) {
    b.addEventListener('click', () => {
      const tab = b.dataset.tab;
      if (tab === 'play') {
        document.getElementById('btnPlayTest')?.click();
        return;
      }
      setTab(tab as MobileTab);
    });
  }

  // ---- ⋯ 더보기 메뉴: 상단 바에서 숨겨진 버튼만 메뉴 항목으로 보이게 하고, 누르면 원래 버튼을 누른 것과 같다
  const proxies = [...document.querySelectorAll<HTMLButtonElement>('#moreMenu .proxy[data-proxy]')];
  function syncProxies(): void {
    for (const p of proxies) {
      const target = document.getElementById(p.dataset.proxy ?? '');
      const hidden = !!target && getComputedStyle(target).display === 'none';
      p.classList.toggle('show', hidden);
      p.disabled = !hidden;
    }
  }
  for (const p of proxies) p.addEventListener('click', () => document.getElementById(p.dataset.proxy ?? '')?.click());

  // ---- 긴 상태 문구: 눌러서 펼치고 접는다. 전체 문구는 툴팁(title)에도 둔다
  const status = document.getElementById('statusLine');
  if (status) {
    status.addEventListener('click', () => status.classList.toggle('expanded'));
    const sync = (): void => {
      status.title = status.textContent ?? '';
    };
    new MutationObserver(sync).observe(status, { childList: true, characterData: true, subtree: true });
    sync();
  }
  // 곡 이름이 길어 잘릴 때도 전체 이름을 툴팁으로(편집기가 title 을 따로 쓰면 그대로 둔다)
  const songName = document.getElementById('songName');
  if (songName) {
    const sync = (): void => {
      if (!songName.title) songName.title = songName.textContent ?? '';
    };
    new MutationObserver(() => {
      songName.title = songName.textContent ?? '';
    }).observe(songName, { childList: true, characterData: true, subtree: true });
    sync();
  }

  mqTab.addEventListener('change', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  apply();

  return { mode, isTouchLayout, setTab, prefs: () => ({ ...prefs }) };
}

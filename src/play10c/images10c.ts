// 새 플레이 화면 10-C의 그림 파일 불러오기. 파일은 public\img10c 에 두고 빌드 때 dist\img10c 로 복사된다(vite.config 의 copy-img10c). 상대 경로 ./img10c/… 로 읽는다.
// 한 번 읽은 그림은 다음 판에서도 그대로 쓴다.
const heroUrl = './img10c/hero.webp';
const monsterUrl = './img10c/monster.webp';
const strikeUrl = './img10c/strike.webp';
const fxUrl = './img10c/fx.webp';
const barFrameUrl = './img10c/bar_frame.webp';
const barGreenUrl = './img10c/bar_green.webp';
const barBackUrl = './img10c/bar_back.webp';
const barYellowUrl = './img10c/bar_yellow.webp';

/** 그림이 아직 안 왔거나 실패하면 null 을 돌려주므로, 그리는 쪽은 null 이면 그 그림만 건너뛴다 */
export interface Images10c {
  hero(): HTMLImageElement | null;
  monster(): HTMLImageElement | null;
  strike(): HTMLImageElement | null;
  fx(): HTMLImageElement | null;
  barFrame(): HTMLImageElement | null;
  barGreen(): HTMLImageElement | null;
  barBack(): HTMLImageElement | null;
  barYellow(): HTMLImageElement | null;
  /** 몬스터를 하얗게 칠한 그림 (피격 번쩍임용) */
  monsterWhite(): HTMLCanvasElement | null;
  /** 몬스터 그림 가로÷세로 (그림이 오기 전에는 참고 HTML의 기본값 0.88) */
  monsterAspect(): number;
}

function load(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  return img;
}

const ready = (img: HTMLImageElement): HTMLImageElement | null => (img.complete && img.naturalWidth > 0 ? img : null);

let cache: Images10c | null = null;

export function loadImages10c(): Images10c {
  if (cache !== null) return cache;
  const hero = load(heroUrl);
  const monster = load(monsterUrl);
  const strike = load(strikeUrl);
  const fx = load(fxUrl);
  const barFrame = load(barFrameUrl);
  const barGreen = load(barGreenUrl);
  const barBack = load(barBackUrl);
  const barYellow = load(barYellowUrl);
  let white: HTMLCanvasElement | null = null;
  const makeWhite = (): void => {
    if (white !== null || !monster.complete || monster.naturalWidth === 0) return;
    try {
      const c = document.createElement('canvas');
      c.width = monster.naturalWidth;
      c.height = monster.naturalHeight;
      const q = c.getContext('2d');
      if (q === null) return;
      q.drawImage(monster, 0, 0);
      q.globalCompositeOperation = 'source-atop';
      q.fillStyle = '#fff';
      q.fillRect(0, 0, c.width, c.height);
      white = c;
    } catch {
      white = null;
    }
  };
  monster.addEventListener('load', makeWhite);
  cache = {
    hero: () => ready(hero),
    monster: () => ready(monster),
    strike: () => ready(strike),
    fx: () => ready(fx),
    barFrame: () => ready(barFrame),
    barGreen: () => ready(barGreen),
    barBack: () => ready(barBack),
    barYellow: () => ready(barYellow),
    monsterWhite: () => {
      makeWhite();
      return white;
    },
    monsterAspect: () => (monster.complete && monster.naturalHeight > 0 ? monster.naturalWidth / monster.naturalHeight : 0.88),
  };
  return cache;
}

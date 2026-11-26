// 화면 꺼짐 방지 (Screen Wake Lock). 플레이 중에만 켜고, 일시정지·결과·메뉴에서는 끈다.
// 지원하지 않는 브라우저이거나 실패해도 게임은 그대로 계속된다 (조용히 무시).

/** 브라우저가 주는 화면 잠금 열쇠 (필요한 부분만) */
interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
}

/** 화면 잠금을 얻는 함수 모양 (테스트에서 가짜로 바꿔 쓸 수 있게) */
export type WakeLockRequest = () => Promise<WakeLockSentinelLike>;

/** 브라우저의 기본 요청 함수. 지원하지 않으면 null */
export function defaultWakeLockRequest(): WakeLockRequest | null {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } });
  if (nav?.wakeLock === undefined) return null;
  const wakeLock = nav.wakeLock;
  return () => wakeLock.request('screen');
}

/** 화면 꺼짐 방지를 켜고 끄는 도구. 켜 둔 상태에서 앱이 숨겨졌다가 돌아오면 다시 얻는다. */
export class WakeLockHolder {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private requesting = false;

  private readonly request: WakeLockRequest | null;

  constructor(request: WakeLockRequest | null = defaultWakeLockRequest()) {
    this.request = request;
  }

  /** 지금 켜 두려는 상태인지 */
  get isWanted(): boolean {
    return this.wanted;
  }

  /** 켠다. 이미 켜져 있으면 아무것도 하지 않는다. 실패는 무시한다. */
  async acquire(): Promise<void> {
    this.wanted = true;
    if (this.request === null || this.sentinel !== null || this.requesting) return;
    this.requesting = true;
    try {
      const sentinel = await this.request();
      if (!this.wanted) {
        // 기다리는 사이에 꺼 달라는 요청이 왔다
        void sentinel.release().catch(() => undefined);
      } else {
        this.sentinel = sentinel;
        sentinel.addEventListener?.('release', () => {
          if (this.sentinel === sentinel) this.sentinel = null;
        });
      }
    } catch {
      // 배터리 절약 모드 등으로 거절될 수 있다. 게임은 계속한다.
    } finally {
      this.requesting = false;
    }
  }

  /** 끈다. */
  release(): void {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel !== null) void sentinel.release().catch(() => undefined);
  }

  /** 앱이 다시 보이게 되었을 때: 켜 두려는 상태인데 잠금을 잃었으면 다시 얻는다. */
  reacquireIfWanted(): void {
    if (this.wanted && this.sentinel === null) void this.acquire();
  }
}

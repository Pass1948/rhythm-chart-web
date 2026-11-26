/**
 * 파일 저장 한 곳(saveFile): 저장 순서는
 *  ① 게시 환경의 `claude.use("downloads")`.save({filename, data})  (게시된 웹페이지는 직접 다운로드가 막혀 있고, json·zip 등만 저장 가능)
 *  ② 없으면 PC 크롬 계열의 `showSaveFilePicker`(다른 이름으로 저장 창)
 *  ③ 그것도 없으면 기존 `<a download>`
 * `window.claude` 가 없거나 `use` 가 null 을 돌려줘도 오류 없이 다음 방법으로 넘어간다. 실패해도 자동으로 다시 시도하지 않는다.
 */

/** 저장할 파일 */
export interface SaveTarget {
  name: string;
  blob: Blob;
}

export type SaveMethod = 'downloads' | 'picker' | 'anchor';

/** 저장 결과. status 가 declined 면 사용자가 취소한 것이라 조용히 닫는다 */
export interface SaveOutcome {
  status: 'saved' | 'declined' | 'failed';
  method?: SaveMethod;
  /** 실제 저장을 요청한 파일 이름 */
  name: string;
  /** 상태줄에 보일 쉬운 한국어 문구 */
  message: string;
  /** downloads 오류 코드 등 */
  code?: string;
}

/** `claude.use("downloads")` 가 돌려주는 모양(필요한 부분만) */
export interface DownloadsLike {
  save(req: { filename: string; data: Blob }): Promise<{ status?: string } | undefined>;
}

/** 저장 방법을 바꿔 끼울 수 있는 환경(단위 테스트가 가짜를 넣는다) */
export interface SaveEnv {
  /** downloads 기능 (없으면 null) */
  getDownloads(): Promise<DownloadsLike | null>;
  /** 다른 이름으로 저장 창을 부르는 함수 (없으면 null) */
  picker: ((opts: { suggestedName: string; types?: unknown[] }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>) | null;
  /** `<a download>` 로 저장 */
  anchor(name: string, blob: Blob): void;
}

/** 확장자 (점 없이 소문자) */
function extOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/** 브라우저의 실제 환경 */
export function browserSaveEnv(): SaveEnv {
  const w = (typeof window === 'undefined' ? {} : window) as unknown as {
    claude?: { use?: (name: string) => unknown };
    showSaveFilePicker?: SaveEnv['picker'];
  };
  return {
    getDownloads: async () => {
      try {
        const use = w.claude?.use;
        if (typeof use !== 'function') return null;
        const d = (await use.call(w.claude, 'downloads')) as DownloadsLike | null | undefined;
        return d && typeof d.save === 'function' ? d : null;
      } catch {
        return null;
      }
    },
    picker: typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(window) : null,
    anchor: (name, blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    },
  };
}

/** downloads 오류 코드 → 쉬운 한국어 이유 (declined 는 따로 처리) */
export function downloadsErrorMessage(code: string, filename = ''): string {
  const ext = extOf(filename);
  switch (code) {
    case 'rate_limited':
      return '저장 요청이 너무 잦거나 다른 저장 창이 열려 있습니다. 잠시 뒤에 [저장]을 다시 눌러 주세요.';
    case 'rejected_extension':
    case 'extension_not_enabled':
      return `이 화면에서는 ${ext ? '.' + ext : '이'} 파일 형식을 저장할 수 없습니다. (json, zip 만 저장할 수 있습니다)`;
    case 'too_large':
      return '파일이 너무 커서 저장할 수 없습니다.';
    case 'bad_request':
    case 'transform_error':
      return '파일 이름이나 내용이 올바르지 않아 저장하지 못했습니다. 파일 이름을 바꿔 다시 시도해 주세요.';
    case 'unavailable':
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return '이 화면에서는 파일 저장 기능을 쓸 수 없습니다.';
    default:
      return `파일을 저장하지 못했습니다. (이유 코드: ${code || '알 수 없음'})`;
  }
}

/** 오류 객체에서 코드를 꺼낸다 */
function codeOf(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; name?: unknown };
    if (typeof o.code === 'string') return o.code;
    if (typeof o.name === 'string') return o.name;
  }
  return '';
}

/** 파일 하나를 저장한다 (순서: downloads → showSaveFilePicker → <a download>). 자동 재시도 없음. */
export async function saveFile(target: SaveTarget, env: SaveEnv = browserSaveEnv()): Promise<SaveOutcome> {
  const { name, blob } = target;
  const downloads = await env.getDownloads().catch(() => null);
  if (downloads) {
    try {
      await downloads.save({ filename: name, data: blob });
      return { status: 'saved', method: 'downloads', name, message: `저장했습니다: ${name}` };
    } catch (e) {
      const code = codeOf(e);
      if (code === 'declined') return { status: 'declined', name, code, message: '저장을 취소했습니다.' };
      return { status: 'failed', name, code, message: downloadsErrorMessage(code, name) };
    }
  }
  if (env.picker) {
    try {
      const ext = extOf(name);
      const handle = await env.picker({
        suggestedName: name,
        types: ext ? [{ description: `${ext.toUpperCase()} 파일`, accept: { [blob.type || 'application/octet-stream']: ['.' + ext] } }] : undefined,
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { status: 'saved', method: 'picker', name, message: `선택한 위치에 저장했습니다: ${name}` };
    } catch (e) {
      if (codeOf(e) === 'AbortError') return { status: 'declined', name, code: 'AbortError', message: '저장을 취소했습니다.' };
      // 저장 창을 쓸 수 없는 환경(보안 제한 등)이면 아래 <a download> 로 넘어간다
    }
  }
  try {
    env.anchor(name, blob);
    return { status: 'saved', method: 'anchor', name, message: `내려받았습니다. 브라우저의 다운로드 폴더를 확인하세요: ${name}` };
  } catch (e) {
    return { status: 'failed', name, code: codeOf(e), message: '파일을 저장하지 못했습니다. 브라우저가 다운로드를 막고 있을 수 있습니다.' };
  }
}

// ---------- 저장 전 확인 창 문구 ----------

/** 폰(터치 기기) 판단: 터치 포인터이거나 폭이 1024px 보다 좁으면 폰 문구를 쓴다 */
export function isPhoneLike(matches: (query: string) => boolean, width: number): boolean {
  return matches('(pointer: coarse)') || width < 1024;
}

/** 용량 문구 (예: 1.2MB, 340KB) */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 확인 창에 보일 문구 */
export interface SavePrompt {
  question: string;
  note: string;
  okLabel: string;
}

export function savePrompt(phone: boolean): SavePrompt {
  if (phone) {
    return {
      question: '이 파일을 휴대폰에 다운로드할까요?',
      note: '저장 위치는 휴대폰이 정합니다. (iOS 앱은 공유 시트, 브라우저는 다운로드 폴더)',
      okLabel: '다운로드',
    };
  }
  return {
    question: '이 파일을 저장할까요? 파일 이름은 바꿀 수 있습니다.',
    note: '저장 위치를 고르는 창은 브라우저·앱이 허용할 때만 뜹니다. 허용하지 않으면 브라우저가 정한 다운로드 폴더에 저장됩니다.',
    okLabel: '저장',
  };
}

/** 파일 이름 입력칸 값 → 쓸 수 있는 이름. 금지 문자를 지우고 원래 확장자를 지킨다 */
export function cleanFileName(input: string, original: string): string {
  // eslint-disable-next-line no-control-regex
  let n = input.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\.+$/, '');
  const ext = extOf(original);
  if (!n) n = original;
  if (ext && extOf(n) !== ext) n = `${n}.${ext}`;
  return n;
}

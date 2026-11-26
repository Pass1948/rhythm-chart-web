// 탭 소리 파일(TapSound.wav)을 빌드에 넣은 base64 주소에서 읽는다. fetch 를 쓰지 않으므로(아티팩트에서는 data 주소 fetch 가 막힐 수 있다) 직접 풀어서 디코딩한다.

/** base64 글자 → 바이트 */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** `data:audio/wav;base64,...` 주소 → 바이트. base64 형식이 아니면 오류 */
export function dataUrlToArrayBuffer(url: string): ArrayBuffer {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(url);
  if (m === null) throw new Error('base64 data 주소가 아닙니다.');
  return base64ToArrayBuffer(m[1]!);
}

/** 읽어서 디코딩한다. 실패하면 오류를 던진다(호출한 쪽이 합성음으로 대신한다). */
export async function loadTapBuffer(context: Pick<AudioContext, 'decodeAudioData'>, url: string): Promise<AudioBuffer> {
  return context.decodeAudioData(dataUrlToArrayBuffer(url));
}

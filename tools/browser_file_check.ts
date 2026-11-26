/**
 * 브라우저 속도 확인 도구(개발용): 열려 있는 크롬 확인 페이지(mp3_check)의 파일 입력에 곡 파일을 '경로로 지정'해
 * (복사하지 않고 읽기만) 분석 시간을 읽어 온다. 사용: node tools/browser_file_check.ts 9333 "곡 파일 전체 경로"
 */
const port = process.argv[2] ?? '9333';
const filePath = process.argv[3]!;
const tabs = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const tab = tabs.find((t) => t.type === 'page' && t.url.includes('mp3_check'));
if (!tab) throw new Error('mp3_check 탭을 찾지 못했습니다.');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data) as { id?: number; result?: unknown };
  if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
};
await new Promise<void>((ok) => {
  ws.onopen = () => ok();
});
const call = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
  new Promise((ok) => {
    const id = ++seq;
    pending.set(id, ok as (v: unknown) => void);
    ws.send(JSON.stringify({ id, method, params }));
  });
const doc = await call<{ root: { nodeId: number } }>('DOM.getDocument');
const q = await call<{ nodeId: number }>('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#f' });
await call('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [filePath] });
for (let i = 0; i < 180; i++) {
  const t = await call<{ result: { value?: string } }>('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  if (t.result.value === 'DONE' || t.result.value === 'FAILED') {
    const o = await call<{ result: { value?: string } }>('Runtime.evaluate', { expression: "document.getElementById('out').textContent", returnByValue: true });
    console.log(t.result.value, o.result.value);
    ws.close();
    process.exit(t.result.value === 'DONE' ? 0 : 1);
  }
  await new Promise((ok) => setTimeout(ok, 1000));
}
console.log('시간 초과');
process.exit(2);

export {};

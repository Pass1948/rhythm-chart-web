/**
 * 브라우저 확인 도구(개발용): 이미 떠 있는 크롬(원격 디버깅 포트)에 붙어 확인 페이지의 결과(JSON)를 읽어 온다.
 * 사용: 크롬을 --remote-debugging-port=9333 --headless=new 로 열고 확인 페이지 주소를 연 뒤
 *       node tools/browser_check.ts 9333
 */

const port = process.argv[2] ?? '9333';
const tabs = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const tab = tabs.find((t) => t.type === 'page' && t.url.includes('decode_check'));
if (!tab) throw new Error('확인 페이지 탭을 찾지 못했습니다.');
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
const evaluate = (expression: string): Promise<{ result: { value?: string } }> =>
  new Promise((ok) => {
    const id = ++seq;
    pending.set(id, ok as (v: unknown) => void);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
for (let i = 0; i < 120; i++) {
  const title = (await evaluate('document.title')).result.value;
  if (title === 'DONE' || title === 'FAILED') {
    console.log(title);
    console.log((await evaluate("document.getElementById('out').textContent")).result.value);
    ws.close();
    process.exit(title === 'DONE' ? 0 : 1);
  }
  await new Promise((ok) => setTimeout(ok, 1000));
}
console.log('시간 초과');
process.exit(2);

export {};

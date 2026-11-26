// @types/node 를 설치하지 않기 위한 최소 선언(테스트·도구가 쓰는 Node 기능만). 화면 코드는 이 선언을 쓰지 않는다.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8' | 'utf-8'): string;
  export function writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { size: number; isFile(): boolean; isDirectory(): boolean };
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
  export function basename(p: string, ext?: string): string;
  export function dirname(p: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], opts?: { encoding?: string; maxBuffer?: number; cwd?: string }): string;
}
declare const process: { argv: string[]; env: Record<string, string | undefined>; exit(code?: number): never; cwd(): string };
declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(data: string): { digest(encoding: 'hex'): string } };
}

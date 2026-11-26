/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

// 상대 경로(base './')로 빌드해서 어느 주소·폴더에 올려도 동작하게 한다. 결과는 dist\ 폴더.
// 12: 10-C 화면 그림(public\img10c)만 dist\img10c 로 복사한다(publicDir 는 꺼 둔 채). 개발 서버에서도 ./img10c/ 로 보이게 한다.
const img10cDir = resolve(rootDir, 'public', 'img10c');
const copyImg10c = {
  name: 'copy-img10c',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b: Buffer) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const m = /\/img10c\/([\w.-]+\.webp)(?:\?.*)?$/.exec(req.url ?? '');
      const file = m ? join(img10cDir, m[1]!) : '';
      if (!m || !existsSync(file)) return next();
      res.setHeader('Content-Type', 'image/webp');
      res.end(readFileSync(file));
    });
  },
  closeBundle() {
    if (existsSync(img10cDir)) cpSync(img10cDir, resolve(rootDir, 'dist', 'img10c'), { recursive: true });
  },
};

export default defineConfig({
  base: './',
  plugins: [copyImg10c],
  publicDir: false, // publicsfxTapSound.wav 는 ?inline 으로 JS 에 포함한다(dist 에 따로 복사하지 않음)
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { main: resolve(rootDir, 'index.html') },
      // 청크(나뉜 파일) 수를 200개 이하로 유지하기 위한 안전장치: 너무 잘게 나뉘지 않게 한다.
    },
  },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '_to_delete/**', 'log/**'],
    testTimeout: 120000,
  },
});

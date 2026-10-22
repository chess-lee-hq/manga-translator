import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 배포 버전 정보: 빌드 시각 · 커밋 · 패치 로그의 가장 최근 "추가 수정" 제목.
 * 화면(번역 옵션 창)에 보여 주고, 같은 내용을 version.json으로도 내보내 오래 열어 둔 탭이 새 버전을 알아챌 수 있게 함
 */
function readBuildInfo() {
  const run = (command: string) => {
    try {
      return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  let latest = '';
  try {
    const headings = readFileSync('docs/PATCH_LOG_2026-09.md', 'utf8').match(/^## 추가 수정 .+$/gm) ?? [];
    latest = headings.at(-1)?.replace(/^## /, '') ?? '';
  } catch {
    // 패치 로그가 없으면 비워 둠
  }
  return { time: new Date().toISOString(), commit: run('git rev-parse --short HEAD'), latest };
}

const buildInfo = readBuildInfo();

function emitVersionFile(): Plugin {
  return {
    name: 'emit-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(buildInfo) });
    },
  };
}

/**
 * onnxruntime-web이 번들에 넣는 .wasm(약 14MB)을 배포본에서 뺍니다.
 * 말풍선 검출 워커는 wasm을 CDN(jsdelivr, 같은 버전)에서 받도록 설정돼 있어(src/lib/yolo.worker.ts) 이 파일은 쓰이지 않습니다.
 */
function dropUnusedOnnxWasm(): Plugin {
  return {
    name: 'drop-unused-onnx-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(fileName)) delete bundle[fileName];
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropUnusedOnnxWasm(), emitVersionFile()],
  define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
  base: './', // GitHub Pages 프로젝트 사이트 배포를 위한 상대 경로 설정
  // 말풍선 검출 Web Worker(src/lib/yolo.worker.ts)를 ES 모듈로 번들
  worker: { format: 'es', plugins: () => [dropUnusedOnnxWasm()] },
})

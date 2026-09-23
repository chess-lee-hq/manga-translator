import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [react(), dropUnusedOnnxWasm()],
  base: './', // GitHub Pages 프로젝트 사이트 배포를 위한 상대 경로 설정
  // 말풍선 검출 Web Worker(src/lib/yolo.worker.ts)를 ES 모듈로 번들
  worker: { format: 'es', plugins: () => [dropUnusedOnnxWasm()] },
})

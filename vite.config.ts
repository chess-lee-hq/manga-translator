import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // GitHub Pages 프로젝트 사이트 배포를 위한 상대 경로 설정
  // 말풍선 검출 Web Worker(src/lib/yolo.worker.ts)를 ES 모듈로 번들
  worker: { format: 'es' },
})

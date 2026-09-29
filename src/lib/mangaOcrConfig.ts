/**
 * 로컬 OCR: manga-ocr(kha-white, Apache-2.0)의 ONNX 변환본(onnx-community, int8 양자화)을 브라우저에서 실행합니다.
 * 모델(약 117MB)은 처음 한 번 Hugging Face에서 받아 브라우저 Cache Storage에 보관합니다.
 * 받는 쪽 서버가 캐시 금지(no-store)로 보내므로 브라우저 HTTP 캐시에 기대지 않고 직접 보관.
 * 버전을 고정한 주소를 써서, 원본 저장소가 바뀌어도 같은 모델을 받습니다.
 */
const MODEL_REVISION = 'f9023406bb2f6b17df67bc4a327c56ecd20611f0';
const VOCAB_REVISION = 'aa6573bd10b0d446cbf622e29c3e084914df9741';
export const OCR_MODEL_FILES = {
  encoder: `https://huggingface.co/onnx-community/manga-ocr-base-ONNX/resolve/${MODEL_REVISION}/onnx/encoder_model_quantized.onnx`,
  decoder: `https://huggingface.co/onnx-community/manga-ocr-base-ONNX/resolve/${MODEL_REVISION}/onnx/decoder_model_quantized.onnx`,
  vocab: `https://huggingface.co/kha-white/manga-ocr-base/resolve/${VOCAB_REVISION}/vocab.txt`,
};
export const OCR_CACHE_NAME = 'manga-ocr-v1';

/** 세 파일을 합친 대략적인 크기 (받기 전 안내용) */
export const OCR_MODEL_APPROX_MB = 117;

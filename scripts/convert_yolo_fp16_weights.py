"""
YOLO ONNX 모델의 Conv 가중치·편향을 float16으로 저장해 파일 크기를 절반으로 줄입니다.

- 저장만 float16이고, 그래프 앞쪽의 Cast 노드가 실행 시 float32로 되돌리므로 계산 경로는 원본과 같습니다.
- 브라우저(onnxruntime-web, WASM)에서 float16 연산 커널이 없어도 그대로 동작합니다.
- int8 양자화(약 11~17MB)도 시험했지만 경계선 박스가 새로 잡히는 등 검출 결과가 달라져 채택하지 않았습니다.

사용법:
  python3 -m venv .venv && .venv/bin/pip install onnx numpy
  .venv/bin/python scripts/convert_yolo_fp16_weights.py 원본.onnx public/manga109_yolo_s_fp16w.onnx
"""
import os
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def convert(src: str, dst: str) -> None:
    model = onnx.load(src)
    graph = model.graph
    initializers = {t.name: t for t in graph.initializer}

    targets = []
    for node in graph.node:
        if node.op_type != 'Conv':
            continue
        for i in (1, 2):  # 가중치, 편향
            if len(node.input) > i and node.input[i] in initializers:
                targets.append(node.input[i])
    targets = list(dict.fromkeys(targets))

    new_initializers, casts, rename = [], [], {}
    for name in targets:
        weights = numpy_helper.to_array(initializers[name])
        fp16_name, fp32_name = f'{name}_f16', f'{name}_f32'
        new_initializers.append(numpy_helper.from_array(weights.astype(np.float16), fp16_name))
        casts.append(helper.make_node('Cast', [fp16_name], [fp32_name], to=TensorProto.FLOAT, name=f'{name}_Cast'))
        rename[name] = fp32_name

    for node in graph.node:
        for i, name in enumerate(node.input):
            if name in rename:
                node.input[i] = rename[name]

    kept = [t for t in graph.initializer if t.name not in rename]
    del graph.initializer[:]
    graph.initializer.extend(kept + new_initializers)
    nodes = list(graph.node)
    del graph.node[:]
    graph.node.extend(casts + nodes)

    onnx.checker.check_model(model)
    onnx.save(model, dst)
    print(f'{src} ({os.path.getsize(src) / 1048576:.1f}MB) → {dst} ({os.path.getsize(dst) / 1048576:.1f}MB), '
          f'float16으로 저장한 텐서 {len(targets)}개')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('사용법: convert_yolo_fp16_weights.py <원본.onnx> <출력.onnx>')
    convert(sys.argv[1], sys.argv[2])

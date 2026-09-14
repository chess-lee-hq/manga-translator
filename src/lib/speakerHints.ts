/**
 * 화자 힌트: 말풍선을 가장 가까운 얼굴(없으면 몸)과 짝지어 "같은 컷에서 어느 말풍선끼리 같은 인물인지"를 추정합니다.
 * YOLO가 이미 검출하던 얼굴·몸·컷 박스를 쓰므로 추가 계산·요청 비용이 거의 없고,
 * 번역 모델이 대화의 주고받음(누가 누구에게 말하는지)을 알아 말투·존댓말을 일관되게 고르는 데 참고합니다.
 *
 * 한계: 서로 다른 컷의 얼굴이 같은 인물인지는 알 수 없어서, "다른 인물"이라는 판단은 같은 컷 안에서만 합니다.
 */
import type { BoundingBox } from './yoloPostprocess';

const CLASS_BODY = 0;
const CLASS_FACE = 1;
const CLASS_FRAME = 2;
/** 말풍선 중심에서 인물까지 이 거리(페이지 대각선 비율)보다 멀면 화자를 모르는 것으로 봄 */
const MAX_DISTANCE_RATIO = 0.25;
/** 가장 가까운 인물과 두 번째 인물의 거리 차이가 이보다 작으면 애매해서 판단하지 않음 */
const AMBIGUITY_RATIO = 0.03;

interface Point { x: number; y: number }

const center = (b: BoundingBox): Point => ({ x: (b.xmin + b.xmax) / 2, y: (b.ymin + b.ymax) / 2 });
/** 몸 박스는 머리 쪽(위 15%)을 말하는 위치로 봄 */
const headOf = (b: BoundingBox): Point => ({ x: (b.xmin + b.xmax) / 2, y: b.ymin + (b.ymax - b.ymin) * 0.15 });
const area = (b: BoundingBox) => (b.xmax - b.xmin) * (b.ymax - b.ymin);
const contains = (b: BoundingBox, p: Point) => p.x >= b.xmin && p.x <= b.xmax && p.y >= b.ymin && p.y <= b.ymax;

/** 점이 들어 있는 가장 작은 컷의 번호. 어느 컷에도 없으면 -1 */
function panelOf(frames: BoundingBox[], p: Point): number {
  let best = -1;
  frames.forEach((frame, i) => {
    if (contains(frame, p) && (best === -1 || area(frame) < area(frames[best]))) best = i;
  });
  return best;
}

/**
 * 말풍선마다 화자 키를 돌려줍니다. (`컷번호:f얼굴번호` 또는 `컷번호:b몸번호`, 모르면 null)
 * @param texts 읽는 순서로 정렬된 말풍선 박스
 * @param detections 같은 페이지의 전체 검출 결과 (얼굴·몸·컷 포함)
 */
export function assignSpeakers(texts: BoundingBox[], detections: BoundingBox[], width: number, height: number): (string | null)[] {
  const frames = detections.filter(d => d.classId === CLASS_FRAME);
  const faces = detections.filter(d => d.classId === CLASS_FACE);
  const bodies = detections.filter(d => d.classId === CLASS_BODY);
  const diagonal = Math.hypot(width, height) || 1;

  const facePoints = faces.map(center);
  const bodyPoints = bodies.map(headOf);
  const facePanels = facePoints.map(p => panelOf(frames, p));
  const bodyPanels = bodyPoints.map(p => panelOf(frames, p));

  return texts.map(text => {
    const c = center(text);
    const panel = panelOf(frames, c);

    // undefined: 후보 없음(다음 종류로 넘어감) / null: 애매함 / string: 화자 키
    const nearest = (points: Point[], panels: number[], kind: 'f' | 'b'): string | null | undefined => {
      const ranked = points
        .map((p, i) => ({ i, d: Math.hypot(p.x - c.x, p.y - c.y) / diagonal }))
        .filter(({ i }) => panel === -1 || panels[i] === panel)
        .sort((a, b) => a.d - b.d);
      if (ranked.length === 0 || ranked[0].d > MAX_DISTANCE_RATIO) return undefined;
      if (ranked.length > 1 && ranked[1].d - ranked[0].d < AMBIGUITY_RATIO) return null;
      return `${panel}:${kind}${ranked[0].i}`;
    };

    const byFace = nearest(facePoints, facePanels, 'f');
    if (byFace !== undefined) return byFace;
    return nearest(bodyPoints, bodyPanels, 'b') ?? null;
  });
}

/**
 * 격자 칸들의 화자 키로 프롬프트용 힌트를 만듭니다. 알려줄 게 없으면 빈 문자열.
 * 화자 키 형식: `페이지ID|컷번호:인물` (여러 페이지를 묶은 격자에서도 페이지끼리 섞이지 않게)
 */
export function buildSpeakerHint(cells: { id: number; speaker?: string | null }[]): string {
  const panels = new Map<string, Map<string, number[]>>();
  for (const cell of cells) {
    if (!cell.speaker) continue;
    const split = cell.speaker.lastIndexOf(':');
    if (split < 0) continue;
    const panelKey = cell.speaker.slice(0, split);
    const speakers = panels.get(panelKey) ?? new Map<string, number[]>();
    speakers.set(cell.speaker, [...(speakers.get(cell.speaker) ?? []), cell.id]);
    panels.set(panelKey, speakers);
  }

  const lines: string[] = [];
  const label = (ids: number[]) => ids.map(id => `#${id}`).join('·');
  for (const [panelKey, speakers] of panels) {
    const groups = [...speakers.values()].map(ids => [...ids].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
    const inFrame = !panelKey.endsWith('|-1') && panelKey !== '-1';
    if (inFrame && groups.length >= 2) {
      lines.push(`- 같은 컷: ${groups.map(label).join(' / ')} (묶음마다 다른 인물)`);
    } else {
      // 컷을 모르면 "다른 인물"은 단정하지 않고, 같은 얼굴에 붙은 말풍선끼리만 알려줌
      for (const ids of groups) if (ids.length >= 2) lines.push(`- 같은 인물: ${label(ids)}`);
    }
  }
  if (lines.length === 0) return '';
  return `\n# 화자 힌트 (말풍선과 가장 가까운 얼굴 위치로 추정한 것이라 틀릴 수 있음 — 말투·존댓말을 정할 때 참고만 해)\n${lines.join('\n')}\n`;
}

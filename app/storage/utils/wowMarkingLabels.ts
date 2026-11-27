import type { MarkingLabelEntry } from '../../../lib/boxLabelPdf';
import type { WowLine } from '../types';

// ============================================================
// 와우출고 [마킹라벨] — 박스 목록 → 라벨 내용 (마킹번호 하나에 한 장)
//
//   1줄 날짜 / 2줄 (순서) 마킹번호 / 3줄 발주번호-박스번호 / 4줄 센터
//     순서 = 그 박스의 순서지정 번호 (부착문서 · 동봉문서 · 택배엑셀의 번호와 같다). 순서지정을 거치지 않은 박스는 찍지 않는다
//   마대(여러 박스가 마킹번호 하나를 같이 쓴다)는 순서 자리에 "M" · 3줄 "마대1" · 4줄 "마대해체"
//     — 여러 박스의 순서가 합쳐져 있어 번호 대신 M. 받는 쪽이 마대를 풀어 박스마다 센터로 보내야 한다는 표시
//   라벨 글은 받는 쪽(한국)이 읽으므로 화면 언어와 상관없이 한국어로 찍는다
// ============================================================

/** 마대 라벨의 순서 자리 · 3줄 · 4줄 */
const BAG_BADGE = 'M';
const bagRef = (bagNo: number) => `마대${bagNo}`;
const BAG_DEST = '마대해체';

/** 라벨에 쓰는 박스 값 (WowBox 의 첫 줄) */
type MarkingBox = Pick<WowLine, 'box_code' | 'order_number' | 'box_no' | 'center' | 'bag_no' | 'ship_seq'>;

// ── 마킹번호 순으로, 마킹번호마다 한 장 (마킹번호가 없는 박스는 뺀다) ──
export function toMarkingEntries(boxes: MarkingBox[], date: string): MarkingLabelEntry[] {
  const byCode = new Map<string, MarkingBox[]>();
  for (const box of boxes) {
    if (!box.box_code) continue;
    byCode.set(box.box_code, [...(byCode.get(box.box_code) ?? []), box]);
  }

  return Array.from(byCode.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, list]) => {
      const bag = list.find((b) => b.bag_no !== null);
      if (bag && bag.bag_no !== null) return { date, badge: BAG_BADGE, code, ref: bagRef(bag.bag_no), dest: BAG_DEST };
      const [box] = list;
      return {
        date,
        badge: box.ship_seq === null ? null : String(box.ship_seq),
        code,
        ref: `${box.order_number}-${box.box_no}`,
        dest: box.center ?? '',
      };
    });
}

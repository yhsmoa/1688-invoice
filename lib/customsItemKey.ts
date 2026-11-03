// ============================================================
// 통관서류 합산 키 — 상자(위치) 안에서 같은 키끼리 한 행으로 합친다
//   화면(품목별 보기)과 엑셀(/api/export-customs-excel) 이 같은 함수를 쓴다
//
//   지금은 "품목(한글 품명)" 만 본다. (2026-11-03)
//   원래는 품목 + 혼용률(또는 HS CODE) 로 나누는 게 맞지만, [불러오기] 가 넣는 혼용률
//   (ft_order_items.composition) 이 자유 입력이라 같은 품목이 표기 차이로 쪼개져서 기준을 뺐다.
//   되돌릴 때는 여기 한 곳만 `${category}_${blend_ratio}` 로 바꾸면 된다.
// ============================================================
export interface CustomsItemKeySource {
  item_category?: string | null;
  blend_ratio?: string | null;
}

export const customsItemKey = (item: CustomsItemKeySource): string =>
  (item.item_category || '').trim();

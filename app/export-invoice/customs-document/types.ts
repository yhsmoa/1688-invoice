// ============================================================
// 통관서류 작성 — 행 타입
//   한 행 = 한 상자(location) 안의 상품 1건.
//   [구글 시트 등록] 붙여넣기와 [불러오기](쉽먼트) 두 경로가 같은 모양으로 만든다.
// ============================================================
export interface CustomsDocumentData {
  id: string;
  /** 상자 코드 (엑셀 마킹, C/T 1 단위) — 합배송이면 마스터 박스 */
  location?: string;
  order_number?: string;
  barcode?: string;
  product_name?: string;
  option_name?: string;
  out_quantity?: string;
  in_quantity?: string;
  note?: string;
  /** 단가 (위안) — 엑셀에서 달러로 환산 */
  unit_price?: string;
  image?: string;
  /** 통관 품목 (한글, invoiceManager-Customs.item_name_ko 와 같은 키) */
  item_category?: string;
  blend_ratio?: string;
  /** 상자 사이즈 `60x50x40` — [불러오기] 로 온 행만. 엑셀 CBM 칸에 `60*50*40` 으로 */
  box_size?: string;
  /** 사업자명 (ft_users.vender_name) — [불러오기] 로 온 행만. 하나뿐이면 엑셀 받는곳·사업자명에 */
  vender_name?: string;
}

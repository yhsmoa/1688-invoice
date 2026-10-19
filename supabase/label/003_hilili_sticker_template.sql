-- ============================================================
-- 안녕릴리(HI) 라벨 스티커 50×70 — BarTender "2026 HI.btw" 양식 이식
--
-- 배치 (BarTender 화면 좌표 기준, mm)
--   왼쪽 위  : QR (product_no) + 그 아래 배송 사이즈 코드 (A/B/C/P/X)
--   가운데 위: HILILI (나눔스퀘어 굵게)
--   상품명+옵션 3줄 (나눔손글씨 펜)
--   정보 8줄: 출고번호 / 제조사 / 제조국 / 제조연월 / 주소 / 연락처 / 혼용률 / 제외 문구
--   맨 아래  : Code128 바코드 = 출고번호(product_no) + 큰 손글씨 번호
--
-- · 바코드 값은 BarTender 양식과 같은 출고번호(product_no, 예: HI-261019-0002) — 쿠팡 바코드 아님
--   (Code128 · 좁은 바 2 dots → 41.8mm, 라벨 폭 안에 들어감)
-- · 주소·연락처는 고정 문구 — ft_users(HI) 의 address/phone 과 달라 계정 필드를 바인딩하지 않는다
-- · HI 상품은 권장연령 있는 상품이 없어(2026-10-19 기준 0/3,610) 성인용만 만든다
-- · overflow=clip 인 한 줄 요소(HILILI·사이즈코드)는 h_mm 이 한 줄 높이(size_pt×0.353×1.25) 이상이어야 잘리지 않는다
-- · 용지·인쇄 설정은 설온/아이엠몽 스티커(50×67.5, TSPL2, 203dpi, 틈 2mm)와 동일
-- 적용: 2026-10-19 (운영 DB mkcxpkblohioqboemmah)
-- ============================================================

insert into public.label_templates (
  name, label_type, printer_lang, width_mm, height_mm, gap_mm, dpi, density, speed,
  media, cutter, is_default, user_ids, audiences, description, layout
)
select
  '안녕릴리 스티커 라벨 50×70', 'barcode', 'TSPL2', 50, 67.5, 2, 203, 8, 1,
  'gap', 'each', true,
  array[u.id], array['adult'],
  'HILILI 条码标签 50×70 · 成人 (HI)',
  $layout$[
    {"id":"hi_qr","name":"QR","type":"qr","field":"product_no","x_mm":2,"y_mm":1.4,"cell":2,"ecc":"M","rotate":0},
    {"id":"hi_size","name":"배송 사이즈코드","type":"text","field":"shipment_size","x_mm":2,"y_mm":7.6,"h_mm":3.8,"max_w_mm":6.2,"align":"center","v_align":"middle","size_pt":8,"overflow":"clip","font_family":"NanumSquare","rotate":0},
    {"id":"hi_brand","name":"브랜드 로고","type":"text","text":"HILILI","x_mm":9,"y_mm":1.6,"h_mm":8.4,"max_w_mm":32,"align":"center","v_align":"middle","size_pt":18,"bold":true,"letter_spacing_mm":0.2,"overflow":"clip","font_family":"NanumSquare","rotate":0},
    {"id":"hi_item","name":"상품명 + 옵션","type":"text","field":"item_name","x_mm":2.2,"y_mm":12,"h_mm":17,"max_w_mm":45.6,"align":"left","v_align":"top","size_pt":13,"min_pt":7,"line_gap":1.12,"overflow":"shrink","font_family":"Nanum Pen Script","rotate":0},
    {"id":"hi_info","name":"제품 정보","type":"text","text":"출고번호 : {product_no}\n제조사(수입원) : 안녕릴리\n제조국 : 중국\n제조연월 : 2026.01\n주소 : 대구 동구 신천동 323-1 201\n연락처 : 010-4117-4433\n{composition}\n(심지,보강재,상표,무늬,레이스,밴드 등 제외)","x_mm":2.6,"y_mm":30.6,"h_mm":23.4,"max_w_mm":45,"align":"left","v_align":"top","size_pt":7.4,"min_pt":5,"line_gap":1.08,"overflow":"shrink","font_family":"Nanum Pen Script","rotate":0},
    {"id":"hi_bc","name":"바코드 (출고번호)","type":"barcode","field":"product_no","symbology":"128","x_mm":2,"y_mm":54.6,"h_mm":6.2,"narrow":2,"wide":2,"max_w_mm":46,"align":"center","human_readable":false,"rotate":0},
    {"id":"hi_bc_text","name":"바코드 번호","type":"text","field":"product_no","x_mm":2,"y_mm":61.4,"h_mm":5.6,"max_w_mm":46,"align":"center","v_align":"middle","size_pt":15,"min_pt":9,"overflow":"shrink","font_family":"Nanum Pen Script","rotate":0}
  ]$layout$::jsonb
from public.ft_users u
where u.user_code = 'HI'
  and not exists (select 1 from public.label_templates t where t.name = '안녕릴리 스티커 라벨 50×70');

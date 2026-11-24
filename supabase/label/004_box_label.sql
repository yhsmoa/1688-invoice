-- ============================================================
-- 박스 라벨 (label_type = 'box') — 와우출고 [라벨출력] 용
--
-- 와우출고 박스 라벨(발주번호-박스번호)도 상품 라벨과 같은 길로 뽑는다:
--   [라벨 설정] 템플릿 → 데이터 바인딩 → TSPL → QZ Tray (app/storage/utils/printWowBoxLabels.ts)
-- 그래서 라벨 종류에 'box' 를 더하고, 바로 쓸 수 있는 기본 템플릿을 하나 넣는다.
--
-- 1) label_templates.label_type 에 'box' 허용
--    (label_printers 는 옛 방식(PC-NO → 프린터)이라 건드리지 않는다 — 지금은 PC 마다 템플릿별 프린터를 브라우저에 기억한다)
-- 2) 기본 템플릿 "와우출고 박스 라벨 50×70" — 공용(user_ids NULL) · 기본
--    용지 · 인쇄 설정은 상품 스티커(50×67.5, TSPL2, 203dpi, 틈 2mm, 농도 8, 속도 1, 매 장 절단)와 같다
--    배치 (mm)
--      위       : 물류센터(왼쪽) · (입고예정 MMDD)(오른쪽)
--      그 아래   : 발주번호-박스번호 (큰 글씨)
--      가운데    : Code128 바코드 = 발주번호-박스번호 — 모바일 작업(/m/wow) · [순서지정] 이 찍는 값
--                 (11~12자 · 좁은 바 2 dots → 39~42mm, 라벨 폭 안에 들어간다)
--      아래      : 박스 순번 n/총(왼쪽) · 박스 크기(오른쪽) / 상품 종수 · 수량
--    필드 이름은 lib/labelTypes.ts 의 BOX_FIELDS 와 같다 (로켓 immongRK_scan 박스 라벨의 po_* · bx_*)
--    양식은 [라벨 설정] 에서 자유롭게 고친다 — 다시 실행해도 이미 있는 템플릿은 덮어쓰지 않는다
--
-- 적용: 2026-11-24 (운영 DB mkcxpkblohioqboemmah)
-- ============================================================

alter table public.label_templates drop constraint if exists label_templates_label_type_check;
alter table public.label_templates
  add constraint label_templates_label_type_check check (label_type in ('care', 'barcode', 'box'));

insert into public.label_templates (
  name, label_type, printer_lang, width_mm, height_mm, gap_mm, dpi, density, speed,
  media, cutter, is_default, user_ids, audiences, description, layout
)
select
  '와우출고 박스 라벨 50×70', 'box', 'TSPL2', 50, 67.5, 2, 203, 8, 1,
  'gap', 'each', true,
  null, array['adult'],
  'WOW出库 箱子标签 50×70（采购单号-箱号）',
  $layout$[
    {"id":"bx_center","name":"물류센터","type":"text","field":"po_center","x_mm":3,"y_mm":3,"h_mm":8,"max_w_mm":28,"align":"left","v_align":"middle","size_pt":16,"min_pt":9,"bold":true,"font_family":"NanumSquare","rotate":0},
    {"id":"bx_arrival","name":"입고예정일","type":"text","text":"({po_arrival_mmdd})","x_mm":32,"y_mm":3,"h_mm":8,"max_w_mm":15,"align":"right","v_align":"middle","size_pt":11,"min_pt":7,"bold":true,"font_family":"NanumSquare","rotate":0},
    {"id":"bx_code","name":"발주번호-박스번호","type":"text","field":"bx_order_box","x_mm":2,"y_mm":13,"h_mm":10,"max_w_mm":46,"align":"center","v_align":"middle","size_pt":20,"min_pt":12,"bold":true,"font_family":"NanumSquare","rotate":0},
    {"id":"bx_barcode","name":"바코드 (발주번호-박스번호)","type":"barcode","field":"bx_order_box","symbology":"128","x_mm":2,"y_mm":25,"h_mm":18,"narrow":2,"wide":2,"max_w_mm":46,"align":"center","human_readable":false,"rotate":0},
    {"id":"bx_seq","name":"박스 순번","type":"text","field":"bx_seq","x_mm":3,"y_mm":46,"h_mm":9,"max_w_mm":22,"align":"left","v_align":"middle","size_pt":18,"min_pt":10,"bold":true,"font_family":"NanumSquare","rotate":0},
    {"id":"bx_size","name":"박스 크기","type":"text","field":"bx_size","x_mm":25,"y_mm":46,"h_mm":9,"max_w_mm":22,"align":"right","v_align":"middle","size_pt":18,"min_pt":10,"bold":true,"font_family":"NanumSquare","rotate":0},
    {"id":"bx_summary","name":"종수 · 수량","type":"text","text":"{bx_item_count}종 · {bx_qty}개","x_mm":2,"y_mm":58,"h_mm":6,"max_w_mm":46,"align":"center","v_align":"middle","size_pt":10,"min_pt":7,"font_family":"NanumSquare","rotate":0}
  ]$layout$::jsonb
where not exists (select 1 from public.label_templates t where t.label_type = 'box');

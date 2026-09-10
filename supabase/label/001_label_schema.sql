-- ============================================================
-- 라벨 즉시출력 — Supabase 스키마 (다른 프로젝트에 그대로 옮길 때 사용)
--
-- 원본: manage-item (mkcxpkblohioqboemmah) / public 스키마, 2026-09-10 기준
-- 적용: Supabase SQL Editor 또는 `supabase db push` 로 이 파일을 순서대로 실행
--
-- 표 3개
--   label_templates  : 라벨 양식 (레이아웃 JSONB) — 라벨 설정 화면이 편집, 인쇄가 읽음
--   label_print_logs : 인쇄 기록 (무엇을 몇 장) — 인쇄 성공 후 일괄 기록
--   label_printers   : (레거시) PC-NO 별 프린터 매핑. 새 인쇄 경로는 브라우저 로컬
--                      저장(lib/localPrinterMap.ts)을 쓰므로 만들지 않아도 된다.
--
-- RLS: 원본은 세 표 모두 RLS 꺼짐 (서버에서 service-role 키로만 접근). 앱을
--      anon 키로 붙일 계획이면 RLS + 정책을 따로 설계해야 한다.
-- 외래키: 원본에는 FK 가 없다. user_ids 는 사업자 표(ft_users.id, uuid) 를 느슨하게
--      가리킨다 — 새 프로젝트의 사업자 표 id 로 값을 다시 채워야 한다 (README 참고).
-- ============================================================

-- ============================================================
-- 1) label_templates — 라벨 양식
-- ============================================================
CREATE TABLE IF NOT EXISTS public.label_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,                     -- 템플릿 이름 (한글)
  description  text,                                     -- 작업자용 설명 (중국어) — 드롭다운 두 번째 줄
  label_type   text        NOT NULL,                     -- 'barcode' (스티커) | 'care' (케어라벨)
  audiences    text[]      NOT NULL DEFAULT '{adult}',   -- 대상: 'adult'(권장연령 없음) / 'kids'(있음), 둘 다 가능
  user_ids     uuid[],                                   -- 쓸 수 있는 사업자 id 목록. NULL/빈 배열 = 공용
  printer_lang text        NOT NULL DEFAULT 'TSPL2',     -- 현재 TSPL2 만 사용
  width_mm     numeric     NOT NULL,
  height_mm    numeric     NOT NULL,
  gap_mm       numeric     NOT NULL DEFAULT 2,           -- media=gap 이면 GAP, blackmark 면 BLINE 높이
  media        text        NOT NULL DEFAULT 'gap',       -- 'gap' | 'continuous' | 'blackmark'
  cutter       text        NOT NULL DEFAULT 'off',       -- 'off' | 'each' | 'batch'
  dpi          integer     NOT NULL DEFAULT 203,         -- 203 | 300 | 600
  density      integer,                                  -- TSPL DENSITY 0~15, NULL = 프린터 기본
  speed        numeric,                                  -- TSPL SPEED inch/s, NULL = 프린터 기본
  layout       jsonb       NOT NULL DEFAULT '[]'::jsonb, -- 요소 배열 (lib/labelTypes.ts LabelElement[])
  is_default   boolean     NOT NULL DEFAULT false,       -- 사업자·종류·대상 조합당 1개 (API 가 강제)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT label_templates_label_type_check CHECK (label_type IN ('care', 'barcode')),
  CONSTRAINT label_templates_media_check      CHECK (media IN ('gap', 'continuous', 'blackmark')),
  CONSTRAINT label_templates_cutter_check     CHECK (cutter IN ('off', 'each', 'batch')),
  CONSTRAINT label_templates_density_check    CHECK (density >= 0 AND density <= 15),
  CONSTRAINT label_templates_speed_check      CHECK (speed > 0 AND speed <= 20),
  CONSTRAINT label_templates_audiences_check  CHECK (
    cardinality(audiences) > 0 AND audiences <@ ARRAY['adult', 'kids']::text[]
  )
);

CREATE INDEX IF NOT EXISTS label_templates_type_idx     ON public.label_templates USING btree (label_type);
CREATE INDEX IF NOT EXISTS label_templates_user_ids_gin ON public.label_templates USING gin (user_ids);

-- ============================================================
-- 2) label_print_logs — 인쇄 기록
-- ============================================================
CREATE TABLE IF NOT EXISTS public.label_print_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid,                                    -- label_templates.id (FK 없음 — 템플릿 삭제돼도 기록 유지)
  order_item_id uuid,                                    -- 주문 항목 id (원본: ft_order_items.id)
  barcode       text,
  item_name     text,
  qty           integer     NOT NULL DEFAULT 1,
  station_no    integer,                                 -- PC-NO (참고용)
  label_type    text,                                    -- 'barcode' | 'care'
  printed_by    text,                                    -- 담당자 (참고용)
  printed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS label_print_logs_printed_at_idx ON public.label_print_logs USING btree (printed_at DESC);

-- ============================================================
-- 3) label_printers — (레거시) PC-NO 별 프린터. 필요 없으면 이 블록은 건너뛴다.
--    /api/label-printers 라우트를 옮길 때만 만든다.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.label_printers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_no      integer     NOT NULL,
  label_type      text        NOT NULL,
  qz_printer_name text        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT label_printers_label_type_check CHECK (label_type IN ('care', 'barcode')),
  CONSTRAINT label_printers_station_no_label_type_key UNIQUE (station_no, label_type)
);

-- ============================================================
-- 운송장 1회 사용 제약 — ft_personal_invoice_prints 신규 테이블
--
-- 작성: 2026-04-27
-- 실행: Supabase Studio → SQL Editor 에서 한 번 실행
--
-- 목적:
--   personal_order_no 송장은 물리적으로 1번만 사용되는 자원.
--   같은 송장을 공유하는 N개 ft_order_items 중 일부만 출력했으면,
--   그 출력 조합 안의 item만 재출력 가능 (분실/손상 대응),
--   조합 밖의 item은 영원히 같은 송장으로 출력 불가.
--
-- 비즈니스 룰:
--   1. 첫 출력 시 N개 row INSERT (선택된 item 각각)
--   2. 재출력 시 ON CONFLICT 로 printed_at 만 갱신 (조합은 영구 보존)
--   3. 같은 personal_order_no 의 prints 가 비어있으면 자유 출력
--   4. prints 가 있으면 선택 item_ids ⊆ 기존 prints item_ids 조건 만족 시만 출력
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. 테이블 생성
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ft_personal_invoice_prints (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_order_no   text NOT NULL,
  item_id             uuid NOT NULL REFERENCES public.ft_order_items(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL,
  printed_at          timestamptz NOT NULL DEFAULT now(),
  printed_by          text,
  CONSTRAINT ft_personal_invoice_prints_unique
    UNIQUE (personal_order_no, item_id)
);

COMMENT ON TABLE public.ft_personal_invoice_prints IS
  '운송장(personal_order_no) 출력 이력 — 1 row = 1 item. UNIQUE 로 중복 차단, ON CONFLICT 로 재출력 처리';
COMMENT ON COLUMN public.ft_personal_invoice_prints.personal_order_no IS
  'ft_order_items.personal_order_no 와 동일. 같은 송장에 묶이는 여러 item 이 같은 값을 공유';
COMMENT ON COLUMN public.ft_personal_invoice_prints.item_id IS
  'ft_order_items.id FK. 출력 시점에 선택된 item';
COMMENT ON COLUMN public.ft_personal_invoice_prints.printed_at IS
  '재출력 시 갱신됨. printed_item_ids 조합 자체는 영구 보존';


-- ────────────────────────────────────────────────────────────
-- 2. 인덱스 — 쿼리 성능
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pip_personal_order_no
  ON public.ft_personal_invoice_prints (personal_order_no);

CREATE INDEX IF NOT EXISTS idx_pip_user_id
  ON public.ft_personal_invoice_prints (user_id);


-- ============================================================
-- 검증 쿼리 (실행 후 결과 확인용)
-- ============================================================

-- (a) 테이블이 정상 생성됐는지 + 빈 상태인지 확인
SELECT COUNT(*) AS row_count FROM public.ft_personal_invoice_prints;
-- 기대 결과: 0


-- (b) 인덱스 확인
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'ft_personal_invoice_prints'
ORDER BY indexname;
-- 기대 결과: PK + idx_pip_personal_order_no + idx_pip_user_id + UNIQUE constraint index


-- (c) UNIQUE 제약 동작 테스트 (실패해야 정상)
-- DO $$
-- DECLARE test_item_id uuid;
-- BEGIN
--   SELECT id INTO test_item_id FROM ft_order_items LIMIT 1;
--   INSERT INTO ft_personal_invoice_prints (personal_order_no, item_id, user_id)
--   VALUES ('TEST_DUP', test_item_id, gen_random_uuid());
--   INSERT INTO ft_personal_invoice_prints (personal_order_no, item_id, user_id)
--   VALUES ('TEST_DUP', test_item_id, gen_random_uuid());
-- EXCEPTION WHEN unique_violation THEN
--   RAISE NOTICE 'UNIQUE 제약 정상 동작';
--   DELETE FROM ft_personal_invoice_prints WHERE personal_order_no = 'TEST_DUP';
-- END $$;


-- ============================================================
-- 롤백 SQL (마이그레이션 되돌리기 — 비상시만)
-- ============================================================
-- 주의: 운영 데이터가 있으면 백업 필수
--
-- DROP TABLE IF EXISTS public.ft_personal_invoice_prints;

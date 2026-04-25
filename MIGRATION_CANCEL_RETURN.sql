-- ============================================================
-- CANCEL / RETURN 분리 리팩토링 — Phase 1 DB 마이그레이션
--
-- 작성: 2026-04-23
-- 실행: Supabase Studio → SQL Editor 에서 한 번 실행
--
-- 변경 사항:
--   1. ft_cancel_details 에 cancel_type 컬럼 추가 (DEFAULT 'CANCEL')
--   2. ft_cancel_details.cancel_type CHECK 제약 추가
--   3. ft_fulfillment_inbounds.type CHECK 제약 갱신 (RETURN 허용)
--
-- 기존 데이터 영향:
--   - ft_cancel_details 모든 기존 row → cancel_type='CANCEL' 자동 채움 (DEFAULT)
--   - ft_fulfillment_inbounds 모든 기존 row → type 변경 없음
--   - 잘못된 분류는 운영자가 수동 보정
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. ft_cancel_details 에 cancel_type 컬럼 추가
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.ft_cancel_details
  ADD COLUMN IF NOT EXISTS cancel_type TEXT NOT NULL DEFAULT 'CANCEL';

-- 코멘트 추가 (Supabase Studio 에서 컬럼 설명 표시용)
COMMENT ON COLUMN public.ft_cancel_details.cancel_type IS
  'CANCEL = 주문 취소(입고 전), RETURN = 반품 접수(입고 후 돌려보냄). ft_fulfillment_inbounds.type 와 항상 동기화';


-- ────────────────────────────────────────────────────────────
-- 2. ft_cancel_details.cancel_type CHECK 제약 — 값 범위 강제
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.ft_cancel_details
  DROP CONSTRAINT IF EXISTS ft_cancel_details_cancel_type_check;

ALTER TABLE public.ft_cancel_details
  ADD CONSTRAINT ft_cancel_details_cancel_type_check
  CHECK (cancel_type IN ('CANCEL', 'RETURN'));


-- ────────────────────────────────────────────────────────────
-- 3. ft_fulfillment_inbounds.type CHECK 제약 갱신 — RETURN 허용
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.ft_fulfillment_inbounds
  DROP CONSTRAINT IF EXISTS ft_fulfillment_inbounds_type_check;

ALTER TABLE public.ft_fulfillment_inbounds
  ADD CONSTRAINT ft_fulfillment_inbounds_type_check
  CHECK (type IN ('ARRIVAL', 'CANCEL', 'RETURN'));


-- ============================================================
-- 검증 쿼리 (실행 후 결과 확인용)
-- ============================================================

-- (a) cancel_type 컬럼이 정상 추가되었는지 + 기존 row 가 모두 'CANCEL' 로 채워졌는지 확인
SELECT
  cancel_type,
  COUNT(*) AS row_count
FROM public.ft_cancel_details
GROUP BY cancel_type;
-- 기대 결과: cancel_type='CANCEL' 1행만 보임 (개수는 기존 데이터 만큼)


-- (b) ft_fulfillment_inbounds 의 type 분포 확인
SELECT
  type,
  COUNT(*) AS row_count
FROM public.ft_fulfillment_inbounds
GROUP BY type
ORDER BY type;
-- 기대 결과: ARRIVAL, CANCEL 두 type 만 (RETURN 0건 — 이번 마이그레이션 직후엔 없음)


-- (c) CHECK 제약이 정상 동작하는지 테스트 (실패해야 정상)
-- DO $$ BEGIN
--   INSERT INTO public.ft_cancel_details (order_items_id, qty, cancel_type)
--   VALUES (gen_random_uuid(), 1, 'INVALID_VALUE');
-- EXCEPTION WHEN check_violation THEN
--   RAISE NOTICE 'CHECK 제약 정상 동작 — INVALID_VALUE 차단됨';
-- END $$;


-- ============================================================
-- 롤백 SQL (마이그레이션 되돌리기 — 비상시만)
-- ============================================================

-- 주의: 운영 중인 데이터가 있으면 실행 전 백업 필수
-- 또한 cancel_type='RETURN' 데이터가 있다면 그 정보가 사라짐
--
-- ALTER TABLE public.ft_fulfillment_inbounds
--   DROP CONSTRAINT IF EXISTS ft_fulfillment_inbounds_type_check;
-- ALTER TABLE public.ft_fulfillment_inbounds
--   ADD CONSTRAINT ft_fulfillment_inbounds_type_check
--   CHECK (type IN ('ARRIVAL', 'CANCEL'));
--
-- ALTER TABLE public.ft_cancel_details
--   DROP CONSTRAINT IF EXISTS ft_cancel_details_cancel_type_check;
--
-- ALTER TABLE public.ft_cancel_details
--   DROP COLUMN IF EXISTS cancel_type;

-- ============================================================
-- ft_cancel_details 금액 칼럼 이름 정리
--   total_price_cny   → price_cny         (상품가격 — "total" 이 붙어 총액으로 오해됨)
--   refund_amount_cny → total_refund_cny  (환불 총액 = 상품가격 + 배송비 + 서비스)
--
-- 이 테이블을 쓰는 운영 앱이 둘이다 (1688-invoice, purchase-agent).
-- RENAME 한 번에 끝내면 두 앱 배포가 끝날 때까지 접수·반품·잔액 조회가 깨지므로
-- 단계적으로 전환한다.
--
--   1단계 (이 파일 PART 1) — 무중단. 구 코드 그대로 동작
--     · price_cny 추가 + 트리거로 total_price_cny 와 양방향 동기화
--     · refund_amount_cny → total_refund_cny RENAME
--       (추가 당일(2026-09-22) 이라 읽는 코드가 아직 없음 — 두 앱 전수 확인)
--     · 기존 행 price_cny 채움 — 기존 칼럼 값은 바뀌지 않는다
--   2단계 — 두 앱 코드를 price_cny / total_refund_cny 로 바꿔 배포
--   3단계 (이 파일 PART 2) — 두 앱 배포 확인 후 total_price_cny 삭제
--
-- 환불 잔액 기준은 supabase/ledger/002_refund_settlement.sql 의 refund_cny 를 따른다:
--   원장 전환일(9/1) 이전 완료 → price_cny (이미 상품가격만 돌려준 건 — 다시 계산하지 않음)
--   이후 완료               → total_refund_cny
--
-- 적용 상태: PART 1 — 운영 DB(mkcxpkblohioqboemmah) 적용 완료 (2026-09-22)
--           PART 2 — 미적용 (두 앱 배포 확인 후 진행)
-- ============================================================


-- ============================================================
-- PART 1 — 무중단 전환
-- ============================================================

-- ── 1) 새 칼럼 / 이름 변경 ──
ALTER TABLE public.ft_cancel_details
  ADD COLUMN IF NOT EXISTS price_cny numeric NULL;

COMMENT ON COLUMN public.ft_cancel_details.price_cny IS
  '상품가격(CNY). 환불 잔액 계산 기준 금액.';

ALTER TABLE public.ft_cancel_details
  RENAME COLUMN refund_amount_cny TO total_refund_cny;

COMMENT ON COLUMN public.ft_cancel_details.total_refund_cny IS
  '환불 총액(CNY) = price_cny + delivery_price_cny + service_fee (소수 2자리). 세 칸 모두 NULL 이면 NULL. 트리거가 자동 계산 — 직접 쓰지 말 것.';

-- ── 2) 트리거 함수 — 전환기 동기화 + 환불 총액 계산 ──
--   동기화 규칙 (price_cny 가 기준, 둘이 다르게 들어오면 price_cny 우선)
--     INSERT : price_cny 가 비었으면 total_price_cny 를 복사 (구 코드),
--              아니면 total_price_cny 를 price_cny 로 맞춤 (신 코드)
--     UPDATE : 바뀐 쪽을 다른 쪽에 복사
CREATE OR REPLACE FUNCTION public.ft_cancel_details_sync_amounts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- ── 전환기 동기화: price_cny ↔ total_price_cny ──
  IF TG_OP = 'INSERT' THEN
    IF NEW.price_cny IS NULL THEN
      NEW.price_cny := NEW.total_price_cny;
    ELSE
      NEW.total_price_cny := NEW.price_cny;
    END IF;
  ELSE
    IF NEW.price_cny IS DISTINCT FROM OLD.price_cny THEN
      NEW.total_price_cny := NEW.price_cny;
    ELSIF NEW.total_price_cny IS DISTINCT FROM OLD.total_price_cny THEN
      NEW.price_cny := NEW.total_price_cny;
    END IF;
  END IF;

  -- ── 환불 총액 ──
  IF NEW.price_cny IS NULL
     AND NEW.delivery_price_cny IS NULL
     AND NEW.service_fee IS NULL THEN
    NEW.total_refund_cny := NULL;
  ELSE
    NEW.total_refund_cny := round(
        coalesce(NEW.price_cny, 0)
      + coalesce(NEW.delivery_price_cny, 0)
      + coalesce(NEW.service_fee, 0), 2);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ft_cancel_details_refund_amount ON public.ft_cancel_details;
DROP FUNCTION IF EXISTS public.ft_cancel_details_set_refund_amount();

CREATE TRIGGER trg_ft_cancel_details_amounts
  BEFORE INSERT OR UPDATE ON public.ft_cancel_details
  FOR EACH ROW
  EXECUTE FUNCTION public.ft_cancel_details_sync_amounts();

-- ── 3) 기존 행 price_cny 채움 ──
--   · 새 칼럼만 채운다. total_price_cny / 배송비 / 서비스 / 상태 값은 그대로
--     (트리거가 total_refund_cny 를 다시 계산하지만 같은 식이라 값 동일)
--   · SQL 단일 UPDATE 라 PostgREST 1000행 제한과 무관 (대상 3,723행, 2026-09-22 기준)
UPDATE public.ft_cancel_details
   SET price_cny = total_price_cny
 WHERE price_cny IS NULL
   AND total_price_cny IS NOT NULL;


-- ============================================================
-- PART 2 — 구 칼럼 제거 (미적용)
--   전제: 1688-invoice · purchase-agent 둘 다 price_cny 코드로 배포 완료.
--   total_price_cny 를 읽거나 쓰는 코드가 남아 있으면 그 앱이 깨진다.
--   ※ 정산건 잠금 트리거 ft_cancel_details_settled_guard (supabase/ledger/002_refund_settlement.sql)
--     도 total_price_cny 를 비교하므로, 칼럼 삭제 전에 그 함수에서 해당 줄을 먼저 제거할 것.
-- ============================================================

-- CREATE OR REPLACE FUNCTION public.ft_cancel_details_sync_amounts()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- AS $$
-- BEGIN
--   IF NEW.price_cny IS NULL
--      AND NEW.delivery_price_cny IS NULL
--      AND NEW.service_fee IS NULL THEN
--     NEW.total_refund_cny := NULL;
--   ELSE
--     NEW.total_refund_cny := round(
--         coalesce(NEW.price_cny, 0)
--       + coalesce(NEW.delivery_price_cny, 0)
--       + coalesce(NEW.service_fee, 0), 2);
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- ALTER TABLE public.ft_cancel_details DROP COLUMN total_price_cny;

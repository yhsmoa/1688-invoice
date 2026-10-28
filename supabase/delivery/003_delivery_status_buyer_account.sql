-- ============================================================
-- 배송상황 CSV → im_1688_orders_delivery_status — 계정(1688 구매 계정)별 교체
--
-- 배경:
--   1688 주문은 두 계정에서 진행한다. 배송상황 콘솔 스크립트는 로그인한 계정의
--   주문목록만 긁는다. 지금까지 업로드는 "표 전체 삭제 → 새 파일 삽입" 이라,
--   다른 계정으로 긁은 CSV 를 올리면 앞 계정의 배송상황이 통째로 사라졌다.
--   또 삭제와 삽입이 따로 실행돼, 삽입 도중 실패하면 일부 행이 빠진 채로 남았다.
--
-- 계정 판정:
--   CSV 에는 계정 열이 없다. 대신 주문번호를 1688 주문 엑셀 표
--   (1688_invoice_deliveryInfo_check.buyer_account) 와 맞춰 보면 계정이 나온다
--   (두 계정 엑셀에 같은 주문이 함께 있는 경우는 없음 — 2026-10-28 확인 0건).
--   판정은 업로드 API 가 한다 (lib/deliveryStatusAccount.ts). 이 파일의 함수는
--   판정된 계정의 행만 교체한다.
--
-- 변경:
--   1) buyer_account 열
--   2) 기존 행 채우기 — 같은 방식(1688 주문 엑셀과 대조)으로 계정이 하나로 나올 때만.
--      (2026-10-28 확인: 1,081행 모두 같은 업로드 1회분, 매칭 961건 전부 tb4576013988)
--      계정이 안 나오거나 둘 이상이면 아무것도 하지 않고 중단한다.
--   3) buyer_account NOT NULL + 인덱스
--   4) delivery_status_replace_account(계정, 행 jsonb)
--      — 그 계정의 행만 지우고 새 행을 넣는다. 한 트랜잭션 (실패 시 아무것도 안 바뀜).
--      — 계정별 advisory lock: 같은 계정 업로드가 동시에 들어와도 차례로 처리.
--      — 행의 buyer_account 가 그 계정이 아니면 거부.
--
-- 업로드 경로: /api/upload-delivery-status-csv
--   ([배송상황 csv] — 상품입고 V1·V2·V3 · 주문상태 V2)
-- 오류 메시지는 'delivery_status: ' 접두사 + 한글.
--
-- 배포 순서: 코드 배포 → 이 마이그레이션
--   (반대로 하면 이전 코드가 계정 없이 삽입하다 NOT NULL 에 걸린다 — 삭제 이후라 데이터가 빈다)
--   (코드만 배포된 사이의 업로드는 함수가 없어 교체 전에 실패 → 기존 데이터 유지)
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah)
-- ============================================================


-- ============================================================
-- 1) 열 추가
-- ============================================================
ALTER TABLE public.im_1688_orders_delivery_status
  ADD COLUMN IF NOT EXISTS buyer_account text;

COMMENT ON COLUMN public.im_1688_orders_delivery_status.buyer_account IS
  '1688 구매 계정 ID — 업로드 때 주문번호를 1688 주문 엑셀(1688_invoice_deliveryInfo_check)과 대조해 판정. 업로드는 이 계정의 행만 교체한다';


-- ============================================================
-- 2) 기존 행 채우기 (1688 주문 엑셀과 대조해 계정이 하나로 나올 때만)
-- ============================================================
DO $$
DECLARE
  v_null     integer;
  v_accounts text[];
BEGIN
  SELECT count(*) INTO v_null
    FROM public.im_1688_orders_delivery_status
   WHERE buyer_account IS NULL;

  IF v_null = 0 THEN
    RETURN;   -- 이미 채워짐 (재실행) 또는 빈 표
  END IF;

  -- 주문이 한 계정에만 있는 경우만 센다 (양쪽에 있으면 판정 근거가 아님)
  SELECT array_agg(DISTINCT m.account ORDER BY m.account) INTO v_accounts
    FROM (
      SELECT d.order_id, min(d.buyer_account) AS account
        FROM public."1688_invoice_deliveryInfo_check" d
       WHERE d.order_id IN (
               SELECT s."1688_order_no" FROM public.im_1688_orders_delivery_status s
                WHERE s.buyer_account IS NULL)
       GROUP BY d.order_id
      HAVING count(DISTINCT d.buyer_account) = 1
    ) m;

  IF v_accounts IS NULL OR cardinality(v_accounts) <> 1 THEN
    RAISE EXCEPTION 'delivery_status: 기존 행의 계정을 하나로 정할 수 없습니다 (매칭 계정 %). 확인 후 적용하세요.',
      coalesce(array_to_string(v_accounts, ', '), '없음');
  END IF;

  UPDATE public.im_1688_orders_delivery_status
     SET buyer_account = v_accounts[1]
   WHERE buyer_account IS NULL;
END $$;


-- ============================================================
-- 3) NOT NULL + 인덱스
-- ============================================================
ALTER TABLE public.im_1688_orders_delivery_status
  ALTER COLUMN buyer_account SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_status_buyer_account
  ON public.im_1688_orders_delivery_status (buyer_account);


-- ============================================================
-- 4) 계정별 교체 함수
--
--   p_account : 이번 업로드의 계정 (업로드 API 가 판정)
--   p_rows    : 넣을 행 (표 열 이름 그대로의 jsonb 배열, id·created_at 제외). 모든 행의 buyer_account = p_account
--   반환      : { account, deleted, inserted }
-- ============================================================
CREATE OR REPLACE FUNCTION public.delivery_status_replace_account(
  p_account text,
  p_rows    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_bad      integer;
  v_deleted  integer;
  v_inserted integer;
BEGIN
  -- ── 계정 검증 ──
  IF p_account IS NULL OR btrim(p_account) = '' THEN
    RAISE EXCEPTION 'delivery_status: 계정이 없습니다.';
  END IF;

  -- ── 행 검증 ──
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'delivery_status: 넣을 행이 없습니다.';
  END IF;
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_rows) r
   WHERE (r->>'buyer_account') IS DISTINCT FROM p_account;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'delivery_status: 업로드 계정 밖의 행이 % 건 있습니다.', v_bad;
  END IF;
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_rows) r
   WHERE coalesce(btrim(r->>'1688_order_no'), '') = '';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'delivery_status: 주문번호가 없는 행이 % 건 있습니다.', v_bad;
  END IF;

  -- ── 계정별 잠금 ──
  PERFORM pg_advisory_xact_lock(hashtext('delivery_status_account:' || p_account));

  -- ── 교체 ──
  DELETE FROM public.im_1688_orders_delivery_status
   WHERE buyer_account = p_account;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- id·created_at 은 열 기본값 (populate_recordset 은 빠진 키를 NULL 로 채우므로 열을 명시)
  INSERT INTO public.im_1688_orders_delivery_status (
    buyer_account, "1688_order_no", order_status, "timestamp", status_details,
    delivery_status, description, courier, tracking_no, status_since, location_since
  )
  SELECT
    r.buyer_account, r."1688_order_no", r.order_status, r."timestamp", r.status_details,
    r.delivery_status, r.description, r.courier, r.tracking_no, r.status_since, r.location_since
  FROM jsonb_populate_recordset(NULL::public.im_1688_orders_delivery_status, p_rows) r;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('account', p_account, 'deleted', v_deleted, 'inserted', v_inserted);
END;
$$;

COMMENT ON FUNCTION public.delivery_status_replace_account(text, jsonb) IS
  '배송상황 CSV 업로드 — 지정 계정의 im_1688_orders_delivery_status 행만 한 트랜잭션으로 교체';

REVOKE ALL ON FUNCTION public.delivery_status_replace_account(text, jsonb)
  FROM PUBLIC, anon, authenticated;

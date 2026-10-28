-- ============================================================
-- 1688 주문 엑셀 → 1688_invoice_deliveryInfo_check — 계정(구매자 회원명)별 교체
--
-- 배경:
--   1688 주문은 두 계정에서 진행한다. 엑셀(주문 내보내기)은 계정마다 따로 받는다.
--   지금까지 업로드는 "표 전체 삭제 → 새 파일 삽입" 이라, 두 번째 계정 파일을 올리면
--   첫 번째 계정 데이터가 통째로 사라졌다. 또 삭제와 삽입이 따로 실행돼, 삽입 도중
--   실패하면 일부 행이 빠진 채로 남았다.
--
-- 변경:
--   1) buyer_account 열 — 엑셀 C열(买家会员名, 구매자 회원명 = 1688 계정 ID)
--   2) 기존 행 채우기 — 적용 시점 표의 모든 주문(3,549건)이 tb4576013988 계정 엑셀
--      (2026-10-28 사용자 제공 파일, 주문 3,551건)에 들어 있음을 확인함 → 그 계정으로 채움.
--      확인 이후 표가 바뀌었으면(행 수가 다르면) 아무것도 하지 않고 중단한다.
--   3) buyer_account NOT NULL + 인덱스
--   4) delivery_info_replace_accounts(계정 목록, 행 jsonb)
--      — 그 계정들의 행만 지우고 새 행을 넣는다. 한 트랜잭션 (실패 시 아무것도 안 바뀜).
--      — 계정별 advisory lock: 같은 계정 업로드가 동시에 들어와도 차례로 처리.
--      — 행의 buyer_account 가 계정 목록 밖이면 거부 (다른 계정 행을 섞어 넣지 못하게).
--
-- 업로드 경로 (둘 다 이 함수를 쓴다):
--   · /api/upload-delivery-excel      — [1688 XLSX] (상품입고 V1·V2·V3 · 주문상태 V2)
--   · /api/upload-order-check-excel   — 주문 검사
-- 오류 메시지는 'delivery: ' 접두사 + 한글.
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah)
-- ============================================================


-- ============================================================
-- 1) 열 추가
-- ============================================================
ALTER TABLE public."1688_invoice_deliveryInfo_check"
  ADD COLUMN IF NOT EXISTS buyer_account text;

COMMENT ON COLUMN public."1688_invoice_deliveryInfo_check".buyer_account IS
  '1688 구매 계정 ID — 주문 엑셀 C열(买家会员名). 업로드는 이 계정의 행만 교체한다';


-- ============================================================
-- 2) 기존 행 채우기 (확인한 상태 그대로일 때만)
-- ============================================================
DO $$
DECLARE
  v_null  integer;
  v_total integer;
BEGIN
  SELECT count(*) FILTER (WHERE buyer_account IS NULL), count(*)
    INTO v_null, v_total
    FROM public."1688_invoice_deliveryInfo_check";

  IF v_null = 0 THEN
    RETURN;   -- 이미 채워짐 (재실행)
  END IF;
  IF v_null <> 7587 OR v_total <> 7587 THEN
    RAISE EXCEPTION 'delivery: 확인 이후 표가 바뀌었습니다 (계정 없는 행 %, 전체 %). 기존 행의 계정을 다시 확인한 뒤 적용하세요.', v_null, v_total;
  END IF;

  UPDATE public."1688_invoice_deliveryInfo_check"
     SET buyer_account = 'tb4576013988'
   WHERE buyer_account IS NULL;
END $$;


-- ============================================================
-- 3) NOT NULL + 인덱스
-- ============================================================
ALTER TABLE public."1688_invoice_deliveryInfo_check"
  ALTER COLUMN buyer_account SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_1688_invoice_delivery_check_account
  ON public."1688_invoice_deliveryInfo_check" (buyer_account);


-- ============================================================
-- 4) 계정별 교체 함수
--
--   p_accounts : 이번 업로드에 들어 있는 계정 (1개 이상, 중복·빈 값 불가)
--   p_rows     : 넣을 행 (표 열 이름 그대로의 jsonb 배열). 모든 행의 buyer_account 는 p_accounts 안
--   반환       : { deleted, inserted, accounts: [{ account, deleted, inserted }] }
-- ============================================================
CREATE OR REPLACE FUNCTION public.delivery_info_replace_accounts(
  p_accounts text[],
  p_rows     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_accounts text[];
  v_acc      text;
  v_bad      integer;
  v_deleted  integer;
  v_inserted integer;
  v_detail   jsonb;
BEGIN
  -- ── 계정 목록 검증 ──
  IF p_accounts IS NULL OR cardinality(p_accounts) = 0 THEN
    RAISE EXCEPTION 'delivery: 계정이 없습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_accounts) a WHERE a IS NULL OR btrim(a) = '') THEN
    RAISE EXCEPTION 'delivery: 빈 계정 ID 가 있습니다.';
  END IF;
  SELECT array_agg(DISTINCT a ORDER BY a) INTO v_accounts FROM unnest(p_accounts) a;
  IF cardinality(v_accounts) <> cardinality(p_accounts) THEN
    RAISE EXCEPTION 'delivery: 같은 계정이 두 번 들어 있습니다.';
  END IF;

  -- ── 행 검증 ──
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'delivery: 넣을 행이 없습니다.';
  END IF;
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_rows) r
   WHERE NOT ((r->>'buyer_account') = ANY (v_accounts));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'delivery: 업로드 계정 밖의 행이 % 건 있습니다.', v_bad;
  END IF;

  -- ── 계정별 잠금 (정렬 순서 — 교착 방지) ──
  FOREACH v_acc IN ARRAY v_accounts LOOP
    PERFORM pg_advisory_xact_lock(hashtext('delivery_info_account:' || v_acc));
  END LOOP;

  -- ── 계정별 삭제 건수 (보고용) ──
  SELECT coalesce(jsonb_agg(jsonb_build_object('account', a, 'deleted', d) ORDER BY a), '[]'::jsonb)
    INTO v_detail
    FROM (
      SELECT a, (SELECT count(*) FROM public."1688_invoice_deliveryInfo_check" t WHERE t.buyer_account = a) AS d
        FROM unnest(v_accounts) a
    ) s;

  -- ── 교체 ──
  DELETE FROM public."1688_invoice_deliveryInfo_check"
   WHERE buyer_account = ANY (v_accounts);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public."1688_invoice_deliveryInfo_check"
  SELECT * FROM jsonb_populate_recordset(NULL::public."1688_invoice_deliveryInfo_check", p_rows);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- ── 계정별 삽입 건수 붙이기 ──
  SELECT jsonb_agg(
           e || jsonb_build_object(
             'inserted',
             (SELECT count(*) FROM jsonb_array_elements(p_rows) r WHERE r->>'buyer_account' = e->>'account')
           )
           ORDER BY e->>'account')
    INTO v_detail
    FROM jsonb_array_elements(v_detail) e;

  RETURN jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted, 'accounts', v_detail);
END;
$$;

COMMENT ON FUNCTION public.delivery_info_replace_accounts(text[], jsonb) IS
  '1688 주문 엑셀 업로드 — 지정 계정의 1688_invoice_deliveryInfo_check 행만 한 트랜잭션으로 교체';

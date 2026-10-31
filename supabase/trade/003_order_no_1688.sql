-- ============================================================
-- 무역계좌 — 1688 주문번호 컬럼 (order_no_1688)
--
-- 왜
--   주문 검사 [비용처리 › 회사 부담] 으로 회사가 직접 부담한 1688 주문이 생겼다.
--   그동안은 참조키(TRADE-1688-{주문번호}) 안에 주문번호를 끼워 넣어 찾았는데,
--   참조키는 중복 저장 차단용 키라 업무 데이터를 담는 자리가 아니다.
--   고객 원장(ft_user_transactions)과 같은 구조로 전용 컬럼을 둔다.
--
-- 무엇
--   1) ft_trade_transactions.order_no_1688 text (선택) + 부분 인덱스
--   2) trade_append_row — p_order_no_1688 인자 추가 (맨 끝, DEFAULT NULL)
--        · 회사 행: 호출자가 넘긴 값
--        · 미러 행(p_user_tx_id 있음): 값이 없으면 원본 고객 행의 order_no_1688 을 그대로 가져온다
--          (잔액 스냅샷처럼 고객 원장이 정본 — 미러 트리거는 손대지 않는다)
--      인자가 늘어 시그니처가 바뀌므로 옛 함수를 DROP 한 뒤 다시 만든다.
--      기존 호출(트리거·급여·취소·보정)은 모두 위치 인자 19개까지만 쓰므로 그대로 동작한다.
--   3) trade_record — p_rows 의 order_no_1688 을 받아 전달
--   4) 기존 행 채우기 — 참조키 TRADE-1688-* 회사 행, 미러 행은 원본 고객 행에서
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-01)
-- ============================================================


-- ============================================================
-- 1) 컬럼 + 인덱스
-- ============================================================
ALTER TABLE public.ft_trade_transactions
  ADD COLUMN IF NOT EXISTS order_no_1688 text;

COMMENT ON COLUMN public.ft_trade_transactions.order_no_1688 IS
  '1688 주문번호 — 회사가 직접 부담한 주문(주문 검사 비용처리) 또는 미러 원본 고객 행의 주문번호. 조회용, 중복 차단은 reference_id';

CREATE INDEX IF NOT EXISTS idx_ft_trade_tx_order_no
  ON public.ft_trade_transactions (order_no_1688)
  WHERE order_no_1688 IS NOT NULL;


-- ============================================================
-- 2) 단일 진입점 — p_order_no_1688 추가
-- ============================================================
DROP FUNCTION IF EXISTS public.trade_append_row(
  text, text, date, numeric, numeric, numeric, numeric, text, text,
  numeric, uuid, uuid, numeric, uuid, uuid, date, numeric, text, text
);

CREATE OR REPLACE FUNCTION public.trade_append_row(
  p_kind             text,
  p_category         text,
  p_applied_date     date,
  p_bank_delta       numeric,
  p_customer_delta   numeric,
  p_pnl_delta        numeric,
  p_amount           numeric,
  p_description      text,
  p_reference_id     text,
  p_customer_balance numeric DEFAULT NULL,
  p_user_tx_id       uuid    DEFAULT NULL,
  p_balance_id       uuid    DEFAULT NULL,
  p_krw_amount       numeric DEFAULT NULL,
  p_reverses_id      uuid    DEFAULT NULL,
  p_employee_id      uuid    DEFAULT NULL,
  p_payroll_month    date    DEFAULT NULL,
  p_expected_amount  numeric DEFAULT NULL,
  p_admin_note       text    DEFAULT NULL,
  p_created_by       text    DEFAULT NULL,
  p_order_no_1688    text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prev_bank     numeric;
  v_prev_customer numeric;
  v_bank          numeric;
  v_customer      numeric;
  v_cust_delta    numeric;
  v_note          text := p_admin_note;
  v_order_no      text := nullif(btrim(coalesce(p_order_no_1688, '')), '');
  v_id            uuid;
  v_today_kst     date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF p_reference_id IS NULL OR btrim(p_reference_id) = '' THEN
    RAISE EXCEPTION 'trade: reference_id is required';
  END IF;
  IF p_description IS NULL OR btrim(p_description) = '' THEN
    RAISE EXCEPTION 'trade: description is required';
  END IF;
  IF p_applied_date IS NULL THEN
    RAISE EXCEPTION 'trade: applied_date is required';
  END IF;
  IF p_applied_date > v_today_kst THEN
    RAISE EXCEPTION 'trade: applied_date % is in the future (today KST %)', p_applied_date, v_today_kst;
  END IF;

  -- ── 미러 행: 주문번호가 없으면 원본 고객 행에서 가져온다 (고객 원장이 정본) ──
  IF v_order_no IS NULL AND p_user_tx_id IS NOT NULL THEN
    SELECT nullif(btrim(coalesce(u.order_no_1688, '')), '') INTO v_order_no
    FROM ft_user_transactions u
    WHERE u.id = p_user_tx_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_trade_ledger'));

  IF EXISTS (SELECT 1 FROM ft_trade_transactions WHERE reference_id = p_reference_id) THEN
    RAISE EXCEPTION 'trade: duplicate reference_id %', p_reference_id USING ERRCODE = 'unique_violation';
  END IF;

  -- ── 직전 스냅샷 ──
  SELECT bank_balance, customer_balance INTO v_prev_bank, v_prev_customer
  FROM ft_trade_transactions
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF p_kind = 'opening' THEN
    IF FOUND THEN
      RAISE EXCEPTION 'trade: ledger already opened';
    END IF;
    v_prev_bank     := 0;
    v_prev_customer := 0;
  ELSIF NOT FOUND THEN
    RAISE EXCEPTION 'trade: ledger not opened (no opening row)';
  END IF;

  v_bank := round(v_prev_bank + p_bank_delta, 2);

  -- ── 충전금: 미러 행은 고객 원장 스냅샷이 정본. 기대값과 다르면 막지 않고 기록에 남긴다 ──
  IF p_customer_balance IS NOT NULL THEN
    v_customer   := round(p_customer_balance, 2);
    v_cust_delta := round(v_customer - v_prev_customer, 2);
    IF p_kind <> 'opening' AND abs(v_cust_delta - round(p_customer_delta, 2)) >= 0.005 THEN
      v_note := concat_ws(' | ', v_note,
        format('고객 잔액 불연속: 기대 Δ%s, 실제 Δ%s (직전 %s → %s)',
               round(p_customer_delta, 2), v_cust_delta, v_prev_customer, v_customer));
    END IF;
  ELSE
    v_cust_delta := round(p_customer_delta, 2);
    v_customer   := round(v_prev_customer + v_cust_delta, 2);
  END IF;

  INSERT INTO ft_trade_transactions (
    created_at, applied_date, kind, category,
    bank_delta, customer_delta, asset_delta, pnl_delta,
    bank_balance, customer_balance, asset_balance,
    amount, krw_amount, description, reference_id, order_no_1688,
    user_tx_id, balance_id, reverses_id,
    employee_id, payroll_month, expected_amount,
    admin_note, created_by
  ) VALUES (
    clock_timestamp(), p_applied_date, p_kind, p_category,
    round(p_bank_delta, 2), v_cust_delta, round(p_bank_delta, 2) - v_cust_delta, round(p_pnl_delta, 2),
    v_bank, v_customer, v_bank - v_customer,
    round(abs(p_amount), 2), p_krw_amount, btrim(p_description), btrim(p_reference_id), v_order_no,
    p_user_tx_id, p_balance_id, p_reverses_id,
    p_employee_id, p_payroll_month, p_expected_amount,
    v_note, p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trade_append_row(
  text, text, date, numeric, numeric, numeric, numeric, text, text,
  numeric, uuid, uuid, numeric, uuid, uuid, date, numeric, text, text, text
) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 3) 회사 행 기록 — order_no_1688 전달
--   p_rows: [{ applied_date, category, type?, amount, krw_amount?, description, reference_id, admin_note?, order_no_1688? }]
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_record(p_rows jsonb, p_created_by text DEFAULT NULL)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r        record;
  v_type   text;
  v_bank   numeric;
  v_pnl    numeric;
  v_ids    uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      applied_date date, category text, type text, amount numeric,
      krw_amount numeric, description text, reference_id text, admin_note text,
      order_no_1688 text
    )
  LOOP
    IF r.amount IS NULL OR r.amount <= 0 THEN
      RAISE EXCEPTION 'trade record: amount must be > 0 (%)', r.reference_id;
    END IF;

    IF r.category IN ('전기세', '수도가스', '임대료', '통신비', '소모품', '물류비', '세금수수료', '기타경비') THEN
      v_type := 'out'; v_bank := -r.amount; v_pnl := -r.amount;
    ELSIF r.category = '인출' THEN
      v_type := 'out'; v_bank := -r.amount; v_pnl := 0;
    ELSIF r.category = '자본투입' THEN
      v_type := 'in';  v_bank := r.amount;  v_pnl := 0;
    ELSIF r.category IN ('환차', '보정') THEN
      IF r.type NOT IN ('in', 'out') THEN
        RAISE EXCEPTION 'trade record: % needs type in|out (%)', r.category, r.reference_id;
      END IF;
      IF r.admin_note IS NULL OR btrim(r.admin_note) = '' THEN
        RAISE EXCEPTION 'trade record: % needs a reason in admin_note (%)', r.category, r.reference_id;
      END IF;
      v_type := r.type;
      v_bank := CASE WHEN r.type = 'in' THEN r.amount ELSE -r.amount END;
      v_pnl  := v_bank;
    ELSIF r.category = '급여' THEN
      RAISE EXCEPTION 'trade record: use trade_record_payroll for 급여';
    ELSE
      RAISE EXCEPTION 'trade record: unknown category % (%)', r.category, r.reference_id;
    END IF;

    IF r.type IS NOT NULL AND r.type <> v_type THEN
      RAISE EXCEPTION 'trade record: category % is always %, got % (%)', r.category, v_type, r.type, r.reference_id;
    END IF;

    v_ids := v_ids || public.trade_append_row(
      'company', r.category, r.applied_date,
      v_bank, 0, v_pnl, r.amount,
      r.description, r.reference_id,
      NULL, NULL, NULL, r.krw_amount, NULL, NULL, NULL, NULL,
      r.admin_note, p_created_by,
      r.order_no_1688
    );
  END LOOP;

  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'trade record: no rows';
  END IF;
  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.trade_record(jsonb, text) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 4) 기존 행 채우기 (잔액·체인은 건드리지 않는다 — 새 컬럼만)
-- ============================================================
-- 주문 검사에서 참조키로 기록한 회사 행
UPDATE public.ft_trade_transactions
SET order_no_1688 = substr(reference_id, length('TRADE-1688-') + 1)
WHERE kind = 'company'
  AND reference_id LIKE 'TRADE-1688-%'
  AND order_no_1688 IS NULL;

-- 미러 행 — 원본 고객 행의 주문번호
UPDATE public.ft_trade_transactions t
SET order_no_1688 = nullif(btrim(u.order_no_1688), '')
FROM public.ft_user_transactions u
WHERE t.user_tx_id = u.id
  AND t.order_no_1688 IS NULL
  AND nullif(btrim(coalesce(u.order_no_1688, '')), '') IS NOT NULL;

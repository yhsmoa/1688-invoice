-- ============================================================
-- RPC: record_manual_transaction_v2
--
-- 고객계좌(신) 화면의 [추가 → 충전 / 차감] 이 신 원장(ft_user_transactions) 에
-- 기록할 때 쓰는 함수. 1688 주문 엑셀 차감은 auto-1688-order 가 만든
-- deduct_balance_and_record_transaction_v2 를 그대로 사용한다 (이 함수는 그 규칙을 따른다).
--
-- 신 원장이 잔액의 **유일한** 정본이다. 대체재 없음.
--   1) 입력 검증: type in/out, amount > 0, 항목·참조키·판매자명 필수, 유저-그룹 소속,
--      적용일(applied_date) 필수 + 미래 날짜 금지
--      · out(차감): 배송비/서비스비/기타비용 ≥ 0, 합계 ≤ 전체금액 → 지출금액 = 전체금액 − 비용합
--      · in (충전): 비용 항목은 0, 원화금액(krw_amount)은 있으면 > 0
--   2) balance 단위 advisory lock — 동시 기록 직렬화 (두 관리자가 동시에 저장해도 체인 보존)
--   3) 참조키(reference_id) 중복 차단 — 같은 키로 두 번 저장(더블 클릭·재시도) 방지
--   4) 원장 전환 여부 — 이월 행(category='이월')이 없는 그룹은 즉시 예외로 중단
--   5) 직전 스냅샷 = 원장 마지막 행 (created_at DESC, id DESC)
--   6) 원장 INSERT — category: in→'충전', out→'차감'. source_table='manual', source_ids NULL
--   7) ft_balances 캐시 갱신 (기준값 아님)
-- 어느 단계든 실패하면 전부 롤백. 호출 측은 예외를 받으면 그대로 알리고 멈춘다.
--
-- created_at = clock_timestamp() — lock 을 잡은 **뒤**의 실제 시각. 체인 정렬 키이므로
--   now()(트랜잭션 시작 시각)를 쓰면 lock 대기 순서와 시각 순서가 어긋나 직전 스냅샷을
--   잘못 잡을 수 있다 (두 관리자가 거의 동시에 저장하는 경우). clock_timestamp() 는
--   lock 으로 직렬화된 순서와 항상 같은 순서가 된다.
-- applied_date 는 관리자가 고른 날짜 (월 귀속 기준).
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_manual_transaction_v2(
  p_balance_id     uuid,
  p_user_id        uuid,
  p_vender_name    text,
  p_type           text,                    -- 'in' (충전) | 'out' (차감)
  p_amount         numeric,                 -- 전체금액 (위안, > 0)
  p_applied_date   date,                    -- 적용일 (월 귀속)
  p_description    text,                    -- 항목
  p_reference_id   text,                    -- 참조키 (MANUAL-충전-… / MANUAL-차감-…) — 중복 방지
  p_order_no_1688  text    DEFAULT NULL,    -- 차감: 1688 주문번호 (선택)
  p_admin_note     text    DEFAULT NULL,
  p_shipping_fee   numeric DEFAULT 0,       -- 차감 전용
  p_service_fee    numeric DEFAULT 0,       -- 차감 전용
  p_other_fee      numeric DEFAULT 0,       -- 차감 전용
  p_krw_amount     numeric DEFAULT NULL,    -- 충전 전용: 원화 송금액 (환율 = krw ÷ amount)
  p_master_account text    DEFAULT NULL,
  p_user_code      text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_category  text;
  v_amount    numeric;
  v_ship      numeric;
  v_svc       numeric;
  v_other     numeric;
  v_item      numeric;
  v_krw       numeric;
  v_prev      numeric;
  v_new       numeric;
  v_tx_id     uuid;
  v_today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  -- ── 1) 입력 검증 ──
  IF p_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid type: % (in|out)', p_type;
  END IF;
  v_category := CASE p_type WHEN 'in' THEN '충전' ELSE '차감' END;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid amount: %', p_amount USING ERRCODE = 'check_violation';
  END IF;
  v_amount := round(p_amount, 2);

  IF p_description IS NULL OR btrim(p_description) = '' THEN
    RAISE EXCEPTION 'description is required';
  END IF;
  IF p_reference_id IS NULL OR btrim(p_reference_id) = '' THEN
    RAISE EXCEPTION 'reference_id is required';
  END IF;
  IF p_vender_name IS NULL OR btrim(p_vender_name) = '' THEN
    RAISE EXCEPTION 'vender_name is required';
  END IF;
  IF p_applied_date IS NULL THEN
    RAISE EXCEPTION 'applied_date is required';
  END IF;
  IF p_applied_date > v_today_kst THEN
    RAISE EXCEPTION 'applied_date % is in the future (today KST %)', p_applied_date, v_today_kst;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ft_users WHERE id = p_user_id AND balance_id = p_balance_id) THEN
    RAISE EXCEPTION 'user % does not belong to balance %', p_user_id, p_balance_id;
  END IF;

  v_ship  := round(coalesce(p_shipping_fee, 0), 2);
  v_svc   := round(coalesce(p_service_fee, 0), 2);
  v_other := round(coalesce(p_other_fee, 0), 2);

  IF p_type = 'out' THEN
    -- 차감: 비용은 0 이상, 합계는 전체금액 이하. 나머지가 지출금액(item_amount).
    IF v_ship < 0 OR v_svc < 0 OR v_other < 0 THEN
      RAISE EXCEPTION 'fees must be >= 0 (shipping %, service %, other %)', v_ship, v_svc, v_other
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_ship + v_svc + v_other > v_amount THEN
      RAISE EXCEPTION 'fees (%) exceed amount (%)', v_ship + v_svc + v_other, v_amount
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_krw_amount IS NOT NULL THEN
      RAISE EXCEPTION 'krw_amount is only for charge (in)';
    END IF;
    v_item := round(v_amount - v_ship - v_svc - v_other, 2);
    v_krw  := NULL;
  ELSE
    -- 충전: 비용 항목 없음. 원화금액은 있으면 양수.
    IF v_ship <> 0 OR v_svc <> 0 OR v_other <> 0 THEN
      RAISE EXCEPTION 'fees are not allowed for charge (in)';
    END IF;
    IF p_krw_amount IS NOT NULL AND p_krw_amount <= 0 THEN
      RAISE EXCEPTION 'invalid krw_amount: %', p_krw_amount USING ERRCODE = 'check_violation';
    END IF;
    v_item := 0;
    v_krw  := CASE WHEN p_krw_amount IS NULL THEN NULL ELSE round(p_krw_amount, 2) END;
  END IF;

  -- ── 2) balance 단위 직렬화 ──
  PERFORM pg_advisory_xact_lock(hashtext(p_balance_id::text));

  -- ── 3) 참조키 중복 차단 (더블 클릭·재시도) ──
  IF EXISTS (
    SELECT 1 FROM ft_user_transactions
    WHERE balance_id = p_balance_id AND reference_id = p_reference_id
  ) THEN
    RAISE EXCEPTION 'duplicate reference_id %', p_reference_id USING ERRCODE = 'unique_violation';
  END IF;

  -- ── 4) 원장 전환 여부 — 이월 행 없으면 중단 (대체 계산 금지) ──
  IF NOT EXISTS (
    SELECT 1 FROM ft_user_transactions WHERE balance_id = p_balance_id AND category = '이월'
  ) THEN
    RAISE EXCEPTION 'ledger not initialized for balance % (no opening row)', p_balance_id;
  END IF;

  -- ── 5) 직전 스냅샷 — 원장에서만 ──
  SELECT balance_snapshot INTO v_prev
  FROM ft_user_transactions
  WHERE balance_id = p_balance_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'ledger has no snapshot for balance %', p_balance_id;
  END IF;

  v_new := CASE p_type WHEN 'in' THEN round(v_prev + v_amount, 2) ELSE round(v_prev - v_amount, 2) END;

  -- ── 6) 원장 INSERT ──
  INSERT INTO ft_user_transactions (
    balance_id, user_id, vender_name, type, category, amount, balance_snapshot,
    qty, item_amount, shipping_fee, service_fee, other_fee,
    description, reference_id, order_no_1688, admin_note,
    applied_date, source_table, source_ids, master_account, user_code, krw_amount,
    created_at
  ) VALUES (
    p_balance_id, p_user_id, p_vender_name, p_type, v_category, v_amount, v_new,
    0, v_item, v_ship, v_svc, v_other,
    btrim(p_description), btrim(p_reference_id), nullif(btrim(coalesce(p_order_no_1688, '')), ''),
    nullif(btrim(coalesce(p_admin_note, '')), ''),
    p_applied_date, 'manual', NULL, p_master_account, p_user_code, v_krw,
    clock_timestamp()
  )
  RETURNING id INTO v_tx_id;

  -- ── 7) ft_balances 캐시 갱신 (기준값 아님) ──
  UPDATE ft_balances SET balance = v_new, updated_at = now() WHERE id = p_balance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'balance_id(%) not found in ft_balances', p_balance_id;
  END IF;

  RETURN json_build_object(
    'transaction_id', v_tx_id,
    'type',           p_type,
    'category',       v_category,
    'prev_balance',   v_prev,
    'new_balance',    v_new,
    'amount',         v_amount,
    'item_amount',    v_item,
    'applied_date',   p_applied_date
  );
END;
$$;

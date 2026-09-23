-- ============================================================
-- 환불 → 신 원장(ft_user_transactions) 주간 정산
--
-- 배경:
--   반품/취소 완료(ft_cancel_details.status='DONE') 건이 신 원장에 자동으로
--   들어가는 경로가 없었다. 9/12 에 한 번 수작업 정산(상품가격 기준)만 있었고,
--   이후 완료분은 잔액에 빠져 있었다.
--
-- 환불 금액 기준 (refund_cny):
--   · 원장 전환일(이월 행 applied_date, 현재 2026-09-01 KST) 이전 완료 → price_cny (상품가격)
--       8/31 이월 행에 이미 이 기준으로 포함돼 있다. 절대 다시 계산하지 않는다.
--   · 전환일 이후 완료                                              → total_refund_cny
--       (= 상품가격 + 배송비 + 서비스, ft_cancel_details_sync_amounts 트리거가 계산)
--   · 완료 시점 = done_at. done_at 이 없는 행(컬럼 추가 전 완료)은 created_at 으로 판정
--       — 완료는 접수 이후이므로 created_at ≥ 전환일이면 완료도 전환일 이후다.
--       (검증 2026-09-22: 이월 포함 3,149건 모두 created_at < 9/1, 나머지 완료건은 모두 ≥ 9/1)
--   · 이월 행이 없는(신 원장 미전환) 그룹은 price_cny — 기존 동작 유지
--
-- 구성:
--   1) ft_ledger_cutover_at(user_id)       — 그룹의 원장 전환 시각
--   2) refund_cny(ft_cancel_details)       — 행별 환불 금액 (PostgREST 계산 필드)
--   3) ledger_settled(ft_cancel_details)   — 원장 반영 여부 (PostgREST 계산 필드)
--   4) ledger_append_refund(...)           — 원장에 '환불' 입금 행 1건 추가 (내부용)
--   5) settle_weekly_refunds(date)         — 미반영 완료건을 사업자별 1행으로 정산
--   6) ft_cancel_details 정산건 잠금 트리거 — 반영된 건의 상태·금액 변경/삭제 차단
--   7) pg_cron — 매주 월요일 06:00 KST (일요일 21:00 UTC)
--   8) 1회성 — 9/12 정산분 재계산 차액 보정 + 밀린 완료분 즉시 정산
--
-- 원장 기록 규칙은 record_manual_transaction_v2 를 그대로 따른다:
--   balance 단위 advisory lock / 직전 스냅샷 = 마지막 행 / created_at = clock_timestamp()
--   / 이월 행 없으면 중단 / ft_balances 캐시 갱신.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 완료 (2026-09-22)
--   · 1~7 적용, pg_cron job 'ft-weekly-refund-settlement' 등록 (cron.timezone = GMT)
--   · 8 실행 결과 (immong):
--       9/12 차액 보정  BZ +355.19 / BO +444.27
--       밀린 완료분     BZ 107건 10,192.72 / BO 143건 10,142.33
--       잔액            −63,255.57 → −42,121.06 (캐시·스냅샷·체인 합계 일치 확인)
--     금액 0 인 완료 2건(결제 전 취소)은 정산 대상에서 제외됨 — 의도된 동작
-- ============================================================


-- ============================================================
-- 1) 원장 전환 시각 — 그룹 이월 행의 적용일 00:00 KST
--    SECURITY DEFINER: ft_users 에 RLS 가 있어 purchase-agent(로그인 세션)가
--    다른 사업자 행의 기준일을 못 읽으면 잘못된 기준(price)이 적용된다.
--    돌려주는 값은 날짜 하나뿐이다.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_ledger_cutover_at(p_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (min(t.applied_date)::timestamp AT TIME ZONE 'Asia/Seoul')
  FROM ft_users u
  JOIN ft_user_transactions t
    ON t.balance_id = u.balance_id
   AND t.category   = '이월'
  WHERE u.id = p_user_id;
$$;


-- ============================================================
-- 2) 행별 환불 금액 — select('refund_cny') 로 조회
-- ============================================================
CREATE OR REPLACE FUNCTION public.refund_cny(c public.ft_cancel_details)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN v.cut IS NULL                                  THEN c.price_cny
    WHEN coalesce(c.done_at, c.created_at) >= v.cut     THEN c.total_refund_cny
    ELSE                                                     c.price_cny
  END
  FROM (SELECT public.ft_ledger_cutover_at(c.user_id) AS cut) v;
$$;

COMMENT ON FUNCTION public.refund_cny(public.ft_cancel_details) IS
  '환불 금액: 원장 전환일 이전 완료 → price_cny, 이후 완료 → total_refund_cny. 미전환 그룹은 price_cny.';


-- ============================================================
-- 3) 원장 반영 여부 — 이월(opening) 또는 환불 정산 행의 source_ids 에 포함
-- ============================================================
CREATE INDEX IF NOT EXISTS ft_user_tx_source_ids_gin
  ON public.ft_user_transactions USING gin (source_ids);

CREATE OR REPLACE FUNCTION public.ledger_settled(c public.ft_cancel_details)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ft_user_transactions t
    WHERE t.source_ids @> ARRAY[c.id]
      AND t.source_table IN ('opening', 'ft_cancel_details')
  );
$$;


-- ============================================================
-- 4) 원장에 '환불' 입금 행 추가 (내부용 — 외부 호출 차단)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ledger_append_refund(
  p_user_id      uuid,
  p_amount       numeric,
  p_qty          integer,
  p_applied_date date,
  p_description  text,
  p_reference_id text,
  p_source_table text,
  p_source_ids   uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_user   record;
  v_amount numeric;
  v_prev   numeric;
  v_new    numeric;
  v_tx_id  uuid;
BEGIN
  -- ── 입력 검증 ──
  v_amount := round(p_amount, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid refund amount: %', p_amount USING ERRCODE = 'check_violation';
  END IF;
  IF p_reference_id IS NULL OR btrim(p_reference_id) = '' THEN
    RAISE EXCEPTION 'reference_id is required';
  END IF;

  SELECT id, balance_id, vender_name, master_account, user_code
    INTO v_user
  FROM ft_users WHERE id = p_user_id;
  IF v_user.balance_id IS NULL THEN
    RAISE EXCEPTION 'user % has no balance_id', p_user_id;
  END IF;
  IF v_user.vender_name IS NULL OR btrim(v_user.vender_name) = '' THEN
    RAISE EXCEPTION 'user % has no vender_name', p_user_id;
  END IF;

  -- ── balance 단위 직렬화 ──
  PERFORM pg_advisory_xact_lock(hashtext(v_user.balance_id::text));

  -- ── 참조키 중복 차단 ──
  IF EXISTS (
    SELECT 1 FROM ft_user_transactions
    WHERE balance_id = v_user.balance_id AND reference_id = p_reference_id
  ) THEN
    RAISE EXCEPTION 'duplicate reference_id %', p_reference_id USING ERRCODE = 'unique_violation';
  END IF;

  -- ── 원장 전환 여부 ──
  IF NOT EXISTS (
    SELECT 1 FROM ft_user_transactions WHERE balance_id = v_user.balance_id AND category = '이월'
  ) THEN
    RAISE EXCEPTION 'ledger not initialized for balance % (no opening row)', v_user.balance_id;
  END IF;

  -- ── 직전 스냅샷 ──
  SELECT balance_snapshot INTO v_prev
  FROM ft_user_transactions
  WHERE balance_id = v_user.balance_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'ledger has no snapshot for balance %', v_user.balance_id;
  END IF;
  v_new := round(v_prev + v_amount, 2);

  -- ── 원장 INSERT (9/12 정산 행과 같은 형식: qty=건수, 비용 칸 0) ──
  INSERT INTO ft_user_transactions (
    balance_id, user_id, vender_name, type, category, amount, balance_snapshot,
    qty, item_amount, shipping_fee, service_fee, other_fee,
    description, reference_id, applied_date, source_table, source_ids,
    master_account, user_code, created_at
  ) VALUES (
    v_user.balance_id, v_user.id, v_user.vender_name, 'in', '환불', v_amount, v_new,
    coalesce(p_qty, 0), 0, 0, 0, 0,
    btrim(p_description), btrim(p_reference_id), p_applied_date, p_source_table, p_source_ids,
    v_user.master_account, v_user.user_code, clock_timestamp()
  )
  RETURNING id INTO v_tx_id;

  -- ── ft_balances 캐시 갱신 (기준값 아님) ──
  UPDATE ft_balances SET balance = v_new, updated_at = now() WHERE id = v_user.balance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'balance_id(%) not found in ft_balances', v_user.balance_id;
  END IF;

  RETURN v_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_append_refund(uuid, numeric, integer, date, text, text, text, uuid[])
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 5) 주간 정산 — 미반영 완료건을 사업자별 '환불' 1행으로
--    · 금액 = Σ refund_cny (전환일 이후 완료건은 total_refund_cny)
--    · 금액이 0/NULL 인 건은 제외 (금액 미확정 — 다음 정산에서 다시 본다)
--    · 이미 반영된 건은 ledger_settled 로 제외 → 여러 번 실행해도 중복 없음
--    · 사업자 선택 전에 balance lock 을 먼저 잡아 동시 실행 시 같은 건을 두 번 집지 않는다
--    · 대상은 날짜 구간이 아니라 "아직 원장에 없는 완료건 전부" — 늦게 완료 처리된 건도 빠지지 않는다
--    · 설명에 done_at(KST) 기준 완료 기간을 표시: '주간 환불 정산 (N건, 완료 MM/DD~MM/DD)'
--      done_at 이 없는 건(컬럼 도입 전 완료)은 ' · 완료일 미기록 N건' 으로 따로 표시
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_weekly_refunds(
  p_applied_date date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  r         record;
  v_ids     uuid[];
  v_amount  numeric;
  v_n       integer;
  v_from    date;
  v_to      date;
  v_no_date integer;
  v_desc    text;
  v_tx_id   uuid;
  v_out     json[] := ARRAY[]::json[];
BEGIN
  FOR r IN
    SELECT u.id AS user_id, u.balance_id, coalesce(u.user_code, u.id::text) AS code
    FROM ft_users u
    WHERE u.balance_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM ft_user_transactions t
        WHERE t.balance_id = u.balance_id AND t.category = '이월'
      )
    ORDER BY u.balance_id, u.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(r.balance_id::text));

    SELECT array_agg(c.id ORDER BY c.created_at, c.id),
           round(sum(public.refund_cny(c)), 2),
           count(*),
           min((c.done_at AT TIME ZONE 'Asia/Seoul')::date),
           max((c.done_at AT TIME ZONE 'Asia/Seoul')::date),
           count(*) FILTER (WHERE c.done_at IS NULL)
      INTO v_ids, v_amount, v_n, v_from, v_to, v_no_date
    FROM ft_cancel_details c
    WHERE c.user_id = r.user_id
      AND c.status  = 'DONE'
      AND coalesce(public.refund_cny(c), 0) > 0
      AND NOT public.ledger_settled(c);

    IF v_n > 0 THEN
      -- ── 설명: 건수 + done_at 기준 완료 기간 ──
      v_desc := format('주간 환불 정산 (%s건', v_n);
      IF v_from IS NOT NULL THEN
        v_desc := v_desc || format(', 완료 %s~%s', to_char(v_from, 'MM/DD'), to_char(v_to, 'MM/DD'));
      END IF;
      IF v_no_date > 0 THEN
        v_desc := v_desc || format(' · 완료일 미기록 %s건', v_no_date);
      END IF;
      v_desc := v_desc || ')';

      v_tx_id := public.ledger_append_refund(
        r.user_id,
        v_amount,
        v_n,
        p_applied_date,
        v_desc,
        format('REFUND-WEEKLY-%s-%s', r.code,
               to_char(clock_timestamp() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD-HH24MISS')),
        'ft_cancel_details',
        v_ids
      );
      v_out := v_out || json_build_object(
        'user_id', r.user_id, 'code', r.code, 'count', v_n, 'amount', v_amount,
        'done_from', v_from, 'done_to', v_to, 'no_done_at', v_no_date, 'transaction_id', v_tx_id
      );
    END IF;
  END LOOP;

  RETURN json_build_object('applied_date', p_applied_date, 'settled', to_json(v_out));
END;
$$;

REVOKE ALL ON FUNCTION public.settle_weekly_refunds(date) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 6) 정산건 잠금 — 원장에 반영된 건은 상태·금액 변경과 삭제(철회) 금지
--    앱(반품 화면·철회 API)에서도 막지만, 다른 경로(스크립트·다른 앱)까지 DB 에서 차단.
--    변경이 필요하면 관리자가 원장에서 직접 보정한다.
--    ※ total_price_cny 삭제(MIGRATION_CANCEL_PRICE_RENAME.sql PART 2) 시 이 함수에서도 제거할 것
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_cancel_details_settled_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.ledger_settled(OLD) THEN
      RAISE EXCEPTION '원장에 정산된 반품 건은 철회할 수 없습니다 (ft_cancel_details.id %)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- done_at·created_at 도 잠근다 — refund_cny 의 기준(전환일 전/후) 판정에 쓰이므로,
  -- 이미 DONE 인 건에 DONE 을 다시 보내 done_at 만 바뀌어도 기준이 뒤집힌다
  IF (NEW.status             IS DISTINCT FROM OLD.status
   OR NEW.done_at            IS DISTINCT FROM OLD.done_at
   OR NEW.created_at         IS DISTINCT FROM OLD.created_at
   OR NEW.user_id            IS DISTINCT FROM OLD.user_id
   OR NEW.price_cny          IS DISTINCT FROM OLD.price_cny
   OR NEW.total_price_cny    IS DISTINCT FROM OLD.total_price_cny
   OR NEW.delivery_price_cny IS DISTINCT FROM OLD.delivery_price_cny
   OR NEW.service_fee        IS DISTINCT FROM OLD.service_fee)
   AND public.ledger_settled(OLD) THEN
    RAISE EXCEPTION '원장에 정산된 반품 건은 상태·금액을 바꿀 수 없습니다 (ft_cancel_details.id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ft_cancel_details_settled_guard ON public.ft_cancel_details;
CREATE TRIGGER trg_ft_cancel_details_settled_guard
  BEFORE UPDATE OR DELETE ON public.ft_cancel_details
  FOR EACH ROW
  EXECUTE FUNCTION public.ft_cancel_details_settled_guard();


-- ============================================================
-- 7) 매주 월요일 06:00 KST 자동 실행 (pg_cron 은 UTC — 일요일 21:00)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'ft-weekly-refund-settlement',
  '0 21 * * 0',
  $$SELECT public.settle_weekly_refunds()$$
);


-- ============================================================
-- 8) 1회성 (2026-09-22 실행 완료 — 재실행 금지)
-- ============================================================

-- ── 8-1) 9/12 정산분 재계산 차액 — 기존 행은 두고 차액만 오늘 날짜로 추가 ──
--   9/12 행: 상품가격 기준. 같은 source_ids 의 total_refund_cny 합과의 차이를 입금.
--   source_table='adjustment' → ledger_settled 판정에 쓰이지 않는다 (해당 건은 9/12 행으로 이미 반영).
-- DO $$
-- DECLARE t record; v_diff numeric;
-- BEGIN
--   FOR t IN
--     SELECT id, user_id, user_code, amount, source_ids, cardinality(source_ids) AS n
--     FROM ft_user_transactions
--     WHERE category = '환불' AND source_table = 'ft_cancel_details' AND applied_date = '2026-09-12'
--     ORDER BY user_code
--   LOOP
--     SELECT round(sum(c.total_refund_cny), 2) - t.amount INTO v_diff
--     FROM ft_cancel_details c WHERE c.id = ANY (t.source_ids);
--     PERFORM public.ledger_append_refund(
--       t.user_id, v_diff, 0, (now() AT TIME ZONE 'Asia/Seoul')::date,
--       format('9/12 환불 정산 재계산 차액 (total_refund_cny 기준, %s건: %s → %s)',
--              t.n, t.amount, t.amount + v_diff),
--       format('REFUND-ADJ-20260912-%s', t.user_code),
--       'adjustment', ARRAY[t.id]
--     );
--   END LOOP;
-- END $$;

-- ── 8-2) 밀린 완료분 즉시 정산 ──
-- SELECT public.settle_weekly_refunds();

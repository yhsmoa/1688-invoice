-- ============================================================
-- 무역계좌 — 회사 통장 원장 (ft_trade_transactions)
--
-- 한 줄 정의:
--   통장잔고 = 회사자산 + 고객 충전금(immong)
--   통장 하나로 1688 지급·급여·비용이 나가고 고객 충전이 들어온다.
--   고객 원장(ft_user_transactions) 행마다 고객 잔액 스냅샷이 남듯,
--   여기에는 통장·충전금·회사자산 세 스냅샷이 행마다 남는다.
--
-- 구성:
--   1) ft_trade_settings      — 이월 시각·이월 통장잔고 (1행)
--   2) ft_trade_groups        — 미러링 대상 고객 그룹 (1차: immong 만. hilili 는 제외)
--   3) ft_trade_transactions  — 원장. kind = opening | customer(미러) | company | reversal
--   4) trade_append_row       — 모든 기록의 단일 진입점 (lock · 직전 스냅샷 · 검증)
--   5) trade_mirror_*         — 고객 원장 INSERT / applied_date UPDATE 트리거
--   6) trade_open / trade_record / trade_record_payroll / trade_reverse
--   7) trade_pnl              — 일/월 손익 집계
--
-- 행별 규칙 (Δ통장 = Δ충전금 + Δ자산 이 항상 성립 — CHECK 로 강제):
--   충전  A                : 통장 +A, 충전금 +A, 자산 0
--   구매  (상품I+배송S+서비스F): 통장 −(I+S), 충전금 −(I+S+F), 자산 +F (손익 +F)
--   차감  (1688 주문번호 없음): 통장 0, 충전금 −A, 자산 +A (손익 +A)   ※ 있으면 구매와 동일
--   환불  판매자분 P + 서비스비 F′: 통장 +P, 충전금 +(P+F′), 자산 −F′ (손익 −F′)
--         P·F′ 는 source_ids → ft_cancel_details 에서 정확히 분해 (refund_cny 규칙과 동일)
--   급여·경비 E            : 통장 −E, 자산 −E (손익 −E)
--   인출 / 자본투입         : 통장 ∓, 자산 ∓ (손익 0)
--   환차 / 보정             : 통장 ±, 자산 ± (손익 ±)
--   고객 원장 '이월' 행     : 미러링 안 함 (현금 이동 아님)
--
-- 안전장치:
--   · 이월 전에는 트리거가 아무것도 하지 않는다 → 고객 업무가 무역계좌 준비 상태에 묶이지 않음
--   · lock 순서: 고객 balance lock → trade lock (고객 함수가 앞을 잡고 트리거가 뒤를 잡는다.
--     회사 행 기록은 trade lock 만) → 교착 없음
--   · trade_open 은 balance lock 을 먼저 잡고 최신 스냅샷을 읽는다 → 대기 중이던 고객 거래는
--     이월 이후에 커밋되어 정상 미러링된다 (created_at 이 아니라 커밋 순서로 판단)
--   · 고객 잔액 불연속(미러 누락 등)은 예외로 막지 않고 asset 이 흡수 + admin_note 경고
--   · 삭제 없음. 회사 행 취소 = 반대 행(trade_reverse). 미러 행은 고객 원장에서 처리
--   · 트리거 함수는 SECURITY DEFINER — purchase-agent(authenticated) 가 고객 원장에 기록해도
--     무역계좌 함수 실행 권한 없이 미러링된다. 그 외 함수는 service_role 전용
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-09-29)
--   이월: trade_open(393507.83, immong balance_id) — 5-3 참조
-- ============================================================


-- ============================================================
-- 1) 설정 — 이월 (1행)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_trade_settings (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  started_at   timestamptz NOT NULL,          -- 이월 시각 (이후 고객 거래부터 미러링)
  opening_bank numeric     NOT NULL,          -- 이월 통장잔고 (위안)
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_trade_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) 미러링 대상 고객 그룹
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_trade_groups (
  balance_id    uuid PRIMARY KEY REFERENCES public.ft_balances(id),
  included_from timestamptz NOT NULL,         -- 기록용 (판정은 커밋 순서 — 상단 참조)
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_trade_groups ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) 원장
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_trade_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL,      -- 체인 순서 (lock 획득 후 clock_timestamp)
  applied_date     date NOT NULL,             -- 일/월 귀속
  kind             text NOT NULL CHECK (kind IN ('opening', 'customer', 'company', 'reversal')),
  category         text NOT NULL,
  bank_delta       numeric NOT NULL,          -- 통장 변화 (부호 포함)
  customer_delta   numeric NOT NULL DEFAULT 0,-- 충전금 변화 (부호 포함)
  asset_delta      numeric NOT NULL,          -- 회사자산 변화 = bank − customer
  pnl_delta        numeric NOT NULL DEFAULT 0,-- 손익 반영액
  bank_balance     numeric NOT NULL,          -- 스냅샷 1: 통장잔고
  customer_balance numeric NOT NULL,          -- 스냅샷 2: 고객 충전금 (미러 행은 고객 원장 balance_snapshot)
  asset_balance    numeric NOT NULL,          -- 회사자산 = bank − customer
  amount           numeric NOT NULL,          -- 표시용 절대 금액
  krw_amount       numeric,
  description      text NOT NULL,
  reference_id     text NOT NULL UNIQUE,      -- 중복 차단 키
  user_tx_id       uuid UNIQUE,               -- 미러 원본 ft_user_transactions.id
  balance_id       uuid,                      -- 미러 원본 고객 그룹
  reverses_id      uuid REFERENCES public.ft_trade_transactions(id),
  employee_id      uuid,
  payroll_month    date,
  expected_amount  numeric,
  admin_note       text,
  created_by       text,
  CONSTRAINT ft_trade_tx_identity CHECK (bank_delta = customer_delta + asset_delta),
  CONSTRAINT ft_trade_tx_snapshot CHECK (asset_balance = bank_balance - customer_balance)
);
CREATE INDEX IF NOT EXISTS idx_ft_trade_tx_chain   ON public.ft_trade_transactions (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ft_trade_tx_applied ON public.ft_trade_transactions (applied_date);
CREATE INDEX IF NOT EXISTS idx_ft_trade_tx_reverses ON public.ft_trade_transactions (reverses_id) WHERE reverses_id IS NOT NULL;
ALTER TABLE public.ft_trade_transactions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ft_trade_transactions IS
  '무역계좌 원장 — 통장잔고 = 회사자산 + 고객 충전금. 고객 원장 미러 + 회사 지출. 삭제 없음.';


-- ============================================================
-- 4) 단일 진입점 — 모든 행은 여기로만 들어간다
--    p_customer_balance: 미러 행은 고객 원장 스냅샷을 그대로 전달 (정본), 회사 행은 NULL(유지)
-- ============================================================
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
  p_created_by       text    DEFAULT NULL
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
    amount, krw_amount, description, reference_id,
    user_tx_id, balance_id, reverses_id,
    employee_id, payroll_month, expected_amount,
    admin_note, created_by
  ) VALUES (
    clock_timestamp(), p_applied_date, p_kind, p_category,
    round(p_bank_delta, 2), v_cust_delta, round(p_bank_delta, 2) - v_cust_delta, round(p_pnl_delta, 2),
    v_bank, v_customer, v_bank - v_customer,
    round(abs(p_amount), 2), p_krw_amount, btrim(p_description), btrim(p_reference_id),
    p_user_tx_id, p_balance_id, p_reverses_id,
    p_employee_id, p_payroll_month, p_expected_amount,
    v_note, p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trade_append_row(text, text, date, numeric, numeric, numeric, numeric, text, text, numeric, uuid, uuid, numeric, uuid, uuid, date, numeric, text, text)
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 5) 고객 원장 미러링 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_mirror_customer_tx()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount  numeric;
  v_bank    numeric;
  v_cust    numeric;
  v_pnl     numeric;
  v_fee     numeric;
  v_seller  numeric;
  v_svc     numeric;
  v_note    text := NULL;
  v_type    text;
BEGIN
  -- ── 이월 전 / 대상 그룹 아님 / 장부 전환 행 → 아무것도 하지 않는다 ──
  IF NOT EXISTS (SELECT 1 FROM ft_trade_settings) THEN RETURN NEW; END IF;
  IF NEW.balance_id IS NULL OR NOT EXISTS (SELECT 1 FROM ft_trade_groups g WHERE g.balance_id = NEW.balance_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.category = '이월' THEN RETURN NEW; END IF;

  v_amount := round(coalesce(NEW.amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'trade mirror: amount must be > 0 (tx %)', NEW.id;
  END IF;

  IF NEW.category = '충전' THEN
    v_type := 'in';  v_bank := v_amount; v_cust := v_amount; v_pnl := 0;

  ELSIF NEW.category IN ('구매', '차감') THEN
    v_type := 'out';
    IF NEW.category = '구매' OR nullif(btrim(coalesce(NEW.order_no_1688, '')), '') IS NOT NULL THEN
      -- 1688 지급 = 전체 − (서비스비 + 기타비용). 서비스비·기타비용은 회사에 남는다
      v_fee  := round(coalesce(NEW.service_fee, 0) + coalesce(NEW.other_fee, 0), 2);
      IF v_fee < 0 OR v_fee > v_amount THEN
        RAISE EXCEPTION 'trade mirror: invalid fee % for amount % (tx %)', v_fee, v_amount, NEW.id;
      END IF;
      v_bank := -(v_amount - v_fee); v_cust := -v_amount; v_pnl := v_fee;
    ELSE
      -- 회사가 직접 청구한 항목 (공임비·포장재 등): 현금 이동 없음, 전액 수익
      v_bank := 0; v_cust := -v_amount; v_pnl := v_amount;
    END IF;

  ELSIF NEW.category = '환불' THEN
    v_type := 'in';
    IF NEW.source_table = 'ft_cancel_details' AND NEW.source_ids IS NOT NULL THEN
      -- 판매자분 P / 서비스비 F′ 분해 — settle_weekly_refunds 의 refund_cny 규칙과 동일하게
      --   refund_cny = total_refund_cny (전환일 이후) → P = 상품가+배송비, F′ = 서비스비
      --   refund_cny = price_cny       (전환일 이전) → P = 상품가, F′ = 0
      SELECT round(coalesce(sum(CASE WHEN public.refund_cny(c) = c.total_refund_cny
                                     THEN coalesce(c.price_cny, 0) + coalesce(c.delivery_price_cny, 0)
                                     ELSE coalesce(public.refund_cny(c), 0) END), 0), 2),
             round(coalesce(sum(CASE WHEN public.refund_cny(c) = c.total_refund_cny
                                     THEN coalesce(c.service_fee, 0) ELSE 0 END), 0), 2)
        INTO v_seller, v_svc
      FROM ft_cancel_details c
      WHERE c.id = ANY(NEW.source_ids);

      IF round(v_seller + v_svc, 2) <> v_amount THEN
        RAISE EXCEPTION 'trade mirror: refund split (seller % + service %) <> amount % (tx %)',
          v_seller, v_svc, v_amount, NEW.id;
      END IF;
      v_bank := v_seller; v_cust := v_amount; v_pnl := -v_svc;
    ELSE
      -- 분해 근거 없음 (보정 행 등) → 전액 판매자분으로 두고 표시
      v_bank := v_amount; v_cust := v_amount; v_pnl := 0;
      v_note := '환불 분해 불가 (source_ids 없음) — 전액 판매자분으로 처리, 확인 필요';
    END IF;

  ELSE
    RAISE EXCEPTION 'trade mirror: unknown category % (tx %)', NEW.category, NEW.id;
  END IF;

  IF NEW.type IS DISTINCT FROM v_type THEN
    RAISE EXCEPTION 'trade mirror: category % expects type % but got % (tx %)', NEW.category, v_type, NEW.type, NEW.id;
  END IF;

  PERFORM public.trade_append_row(
    'customer', NEW.category,
    coalesce(NEW.applied_date, (NEW.created_at AT TIME ZONE 'Asia/Seoul')::date),
    v_bank, v_cust, v_pnl, v_amount,
    coalesce(nullif(btrim(coalesce(NEW.description, '')), ''), NEW.category),
    'UTX-' || NEW.id::text,
    NEW.balance_snapshot, NEW.id, NEW.balance_id, NEW.krw_amount,
    NULL, NULL, NULL, NULL,
    v_note, 'mirror'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trade_mirror_insert ON public.ft_user_transactions;
CREATE TRIGGER trg_trade_mirror_insert
  AFTER INSERT ON public.ft_user_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trade_mirror_customer_tx();

-- ── 적용일 수정 동기화 (금액·체인은 불변) ──
CREATE OR REPLACE FUNCTION public.trade_mirror_applied_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.applied_date IS DISTINCT FROM OLD.applied_date AND NEW.applied_date IS NOT NULL THEN
    UPDATE ft_trade_transactions SET applied_date = NEW.applied_date WHERE user_tx_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trade_mirror_applied_date ON public.ft_user_transactions;
CREATE TRIGGER trg_trade_mirror_applied_date
  AFTER UPDATE OF applied_date ON public.ft_user_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trade_mirror_applied_date();


-- ============================================================
-- 6-a) 이월 — 현재 통장잔고로 시작 (1회)
--   balance lock → 최신 고객 스냅샷 → 설정·그룹·이월 행. 한 트랜잭션.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_open(
  p_bank_balance numeric,
  p_balance_id   uuid,
  p_created_by   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now      timestamptz;
  v_snapshot numeric;
  v_id       uuid;
BEGIN
  IF p_bank_balance IS NULL THEN
    RAISE EXCEPTION 'trade open: bank balance is required';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_trade_settings) THEN
    RAISE EXCEPTION 'trade open: already opened';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ft_balances WHERE id = p_balance_id) THEN
    RAISE EXCEPTION 'trade open: balance % not found', p_balance_id;
  END IF;

  -- 고객 balance lock 먼저 (고객 함수와 같은 순서) → trade lock 은 append 안에서
  PERFORM pg_advisory_xact_lock(hashtext(p_balance_id::text));
  v_now := clock_timestamp();

  SELECT balance_snapshot INTO v_snapshot
  FROM ft_user_transactions
  WHERE balance_id = p_balance_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'trade open: customer ledger has no snapshot for balance %', p_balance_id;
  END IF;

  INSERT INTO ft_trade_settings (id, started_at, opening_bank, created_by)
  VALUES (1, v_now, round(p_bank_balance, 2), p_created_by);

  INSERT INTO ft_trade_groups (balance_id, included_from, note)
  VALUES (p_balance_id, v_now, '이월 시 등록');

  v_id := public.trade_append_row(
    'opening', '이월', (v_now AT TIME ZONE 'Asia/Seoul')::date,
    round(p_bank_balance, 2), v_snapshot, 0, round(p_bank_balance, 2),
    format('이월 — 통장잔고 %s / 충전금 %s', round(p_bank_balance, 2), v_snapshot),
    'OPENING',
    v_snapshot, NULL, p_balance_id, NULL, NULL, NULL, NULL, NULL, NULL, p_created_by
  );

  RETURN json_build_object(
    'transaction_id', v_id,
    'started_at', v_now,
    'bank_balance', round(p_bank_balance, 2),
    'customer_balance', v_snapshot,
    'asset_balance', round(p_bank_balance, 2) - v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trade_open(numeric, uuid, text) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 6-b) 회사 행 기록 — 경비·인출·자본투입·환차·보정 (급여는 6-c)
--   p_rows: [{ applied_date, category, type?, amount, krw_amount?, description, reference_id, admin_note? }]
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
      krw_amount numeric, description text, reference_id text, admin_note text
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
      r.admin_note, p_created_by
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
-- 6-c) 급여 — 직원별 실지급액, 한 트랜잭션. 같은 달·같은 직원은 참조키로 중복 차단
--   p_rows: [{ employee_id, name, amount, expected_amount }]
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_record_payroll(
  p_month      date,        -- 귀속월 (그 달 1일)
  p_paid_date  date,        -- 지급일 (적용일)
  p_rows       jsonb,
  p_created_by text DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r       record;
  v_month date := date_trunc('month', p_month)::date;
  v_ids   uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      employee_id uuid, name text, amount numeric, expected_amount numeric
    )
  LOOP
    IF r.employee_id IS NULL THEN
      RAISE EXCEPTION 'trade payroll: employee_id is required';
    END IF;
    IF r.amount IS NULL OR r.amount <= 0 THEN
      RAISE EXCEPTION 'trade payroll: amount must be > 0 (employee %)', r.employee_id;
    END IF;

    v_ids := v_ids || public.trade_append_row(
      'company', '급여', p_paid_date,
      -r.amount, 0, -r.amount, r.amount,
      format('%s %s년 %s월 급여', coalesce(nullif(btrim(coalesce(r.name, '')), ''), r.employee_id::text),
             extract(year FROM v_month)::int, extract(month FROM v_month)::int),
      format('PAYROLL-%s-%s', to_char(v_month, 'YYYYMM'), r.employee_id),
      NULL, NULL, NULL, NULL, NULL,
      r.employee_id, v_month, r.expected_amount,
      NULL, p_created_by
    );
  END LOOP;

  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'trade payroll: no rows';
  END IF;
  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.trade_record_payroll(date, date, jsonb, text) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 6-d) 취소 — 회사 행만, 반대 방향 행 추가 (삭제 없음)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_reverse(
  p_id         uuid,
  p_reason     text,
  p_created_by text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_src ft_trade_transactions%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'trade reverse: reason is required';
  END IF;

  SELECT * INTO v_src FROM ft_trade_transactions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade reverse: row % not found', p_id;
  END IF;
  IF v_src.kind <> 'company' THEN
    RAISE EXCEPTION 'trade reverse: only company rows can be reversed (kind %)', v_src.kind;
  END IF;
  IF EXISTS (SELECT 1 FROM ft_trade_transactions WHERE reverses_id = p_id) THEN
    RAISE EXCEPTION 'trade reverse: row % already reversed', p_id;
  END IF;

  RETURN public.trade_append_row(
    'reversal', v_src.category, (now() AT TIME ZONE 'Asia/Seoul')::date,
    -v_src.bank_delta, 0, -v_src.pnl_delta, v_src.amount,
    '취소: ' || v_src.description,
    'REV-' || p_id::text,
    NULL, NULL, NULL,
    CASE WHEN v_src.krw_amount IS NULL THEN NULL ELSE -v_src.krw_amount END,
    p_id, v_src.employee_id, v_src.payroll_month, NULL,
    btrim(p_reason), p_created_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trade_reverse(uuid, text, text) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 7) 손익 집계 — 일/월. 기말 스냅샷은 그 기간 마지막 행(체인 순서)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_pnl(
  p_unit text DEFAULT 'month',   -- 'day' | 'month'
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH rows AS (
  SELECT t.*,
         CASE WHEN p_unit = 'day' THEN t.applied_date
              ELSE date_trunc('month', t.applied_date)::date END AS period_start
  FROM ft_trade_transactions t
  WHERE t.kind <> 'opening'
    AND (p_from IS NULL OR t.applied_date >= p_from)
    AND (p_to   IS NULL OR t.applied_date <= p_to)
),
agg AS (
  SELECT period_start,
         count(*)                                                                    AS n,
         round(coalesce(sum(amount)        FILTER (WHERE kind = 'customer' AND category IN ('구매', '차감')), 0), 2) AS gmv,
         round(coalesce(sum(amount)        FILTER (WHERE kind = 'customer' AND category = '충전'), 0), 2)           AS charges,
         round(coalesce(sum(amount)        FILTER (WHERE kind = 'customer' AND category = '환불'), 0), 2)           AS refunds,
         round(coalesce(sum(pnl_delta)     FILTER (WHERE kind = 'customer' AND category IN ('구매', '차감')), 0), 2) AS service_income,
         round(coalesce(sum(pnl_delta)     FILTER (WHERE kind = 'customer' AND category = '환불'), 0), 2)           AS refund_service,
         round(coalesce(sum(pnl_delta)     FILTER (WHERE category = '급여'), 0), 2)                                  AS payroll,
         round(coalesce(sum(pnl_delta)     FILTER (WHERE category IN ('전기세', '수도가스', '임대료', '통신비')), 0), 2) AS utilities,
         round(coalesce(sum(pnl_delta)     FILTER (WHERE category IN ('소모품', '물류비', '세금수수료', '기타경비')), 0), 2) AS other_expense,
         round(coalesce(sum(pnl_delta)     FILTER (WHERE category IN ('환차', '보정')), 0), 2)                       AS adjustments,
         round(coalesce(sum(pnl_delta), 0), 2)                                                                       AS net,
         round(coalesce(sum(bank_delta)    FILTER (WHERE bank_delta > 0), 0), 2)                                     AS bank_in,
         round(coalesce(sum(-bank_delta)   FILTER (WHERE bank_delta < 0), 0), 2)                                     AS bank_out,
         round(coalesce(sum(bank_delta)    FILTER (WHERE category IN ('인출', '자본투입')), 0), 2)                    AS capital_flow
  FROM rows
  GROUP BY period_start
),
last_row AS (
  SELECT DISTINCT ON (period_start) period_start, bank_balance, customer_balance, asset_balance
  FROM rows
  ORDER BY period_start, created_at DESC, id DESC
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'period_start',   a.period_start,
  'n',              a.n,
  'gmv',            a.gmv,
  'charges',        a.charges,
  'refunds',        a.refunds,
  'service_income', a.service_income,
  'refund_service', a.refund_service,
  'payroll',        a.payroll,
  'utilities',      a.utilities,
  'other_expense',  a.other_expense,
  'adjustments',    a.adjustments,
  'net',            a.net,
  'bank_in',        a.bank_in,
  'bank_out',       a.bank_out,
  'capital_flow',   a.capital_flow,
  'bank_end',       l.bank_balance,
  'customer_end',   l.customer_balance,
  'asset_end',      l.asset_balance
) ORDER BY a.period_start DESC), '[]'::jsonb)
FROM agg a
JOIN last_row l USING (period_start)
$$;

REVOKE ALL ON FUNCTION public.trade_pnl(text, date, date) FROM PUBLIC, anon, authenticated;

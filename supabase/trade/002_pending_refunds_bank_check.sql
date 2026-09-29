-- ============================================================
-- 무역계좌 — 환불예정 집계 + 통장 대조
--
-- 1) trade_pending_refunds()
--    아직 원장에 정산되지 않은 반품·취소 건을 상태별로 집계한다 (미러링 대상 그룹만).
--      · 판매자 환불분 P = 상품가 + 돌려준 배송비 — 통장에 들어와 고객에게 그대로 넘어가는 돈.
--        회사자산과 무관. (이월 전에 이미 입금된 분은 통장 대조에서 드러난다)
--      · 서비스비 F′ — 정산되는 순간 회사자산이 줄어드는 돈 → "조정 자산 = 자산 − 예정 F′"
--    분해 규칙은 settle_weekly_refunds 의 refund_cny 와 동일 (트리거와 같은 식).
--    장부에는 기록하지 않는다 — 금액이 확정되기 전이고, 장부는 일어난 일만 담는다.
--
-- 2) ft_trade_bank_checks + trade_bank_check()
--    매주 실제 통장잔고를 입력해 장부 통장잔고와 대조한다. 차이가 있으면 선택적으로
--    '보정' 행(손익 반영)을 만들어 장부를 실제에 맞춘다. 대조 이력은 따로 남긴다.
--    첫 대조에서 나오는 차이의 대표적 원인: 이월 전에 이미 입금된 판매자 환불분이
--    월요일 정산 때 한 번 더 통장 + 로 미러링된 것.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-09-29)
-- ============================================================


-- ============================================================
-- 1) 환불예정 집계
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_pending_refunds()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH c AS (
  SELECT c.status,
         CASE WHEN public.refund_cny(c) = c.total_refund_cny
              THEN coalesce(c.price_cny, 0) + coalesce(c.delivery_price_cny, 0)
              ELSE coalesce(public.refund_cny(c), 0) END AS seller,
         CASE WHEN public.refund_cny(c) = c.total_refund_cny
              THEN coalesce(c.service_fee, 0) ELSE 0 END AS service
  FROM ft_cancel_details c
  WHERE c.user_id IN (
          SELECT u.id FROM ft_users u
          WHERE u.balance_id IN (SELECT g.balance_id FROM ft_trade_groups g))
    AND NOT public.ledger_settled(c)
)
SELECT jsonb_build_object(
  'done_count',         count(*) FILTER (WHERE status = 'DONE'),
  'done_seller',        round(coalesce(sum(seller)  FILTER (WHERE status = 'DONE'), 0), 2),
  'done_service',       round(coalesce(sum(service) FILTER (WHERE status = 'DONE'), 0), 2),
  'processing_count',   count(*) FILTER (WHERE status = 'PROCESSING'),
  'processing_seller',  round(coalesce(sum(seller)  FILTER (WHERE status = 'PROCESSING'), 0), 2),
  'processing_service', round(coalesce(sum(service) FILTER (WHERE status = 'PROCESSING'), 0), 2),
  'pending_count',      count(*) FILTER (WHERE status = 'PENDING'),
  'other_count',        count(*) FILTER (WHERE status NOT IN ('DONE', 'PROCESSING', 'PENDING'))
)
FROM c
$$;

REVOKE ALL ON FUNCTION public.trade_pending_refunds() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 2) 통장 대조 이력
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_trade_bank_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at    timestamptz NOT NULL,
  applied_date  date NOT NULL,
  actual_bank   numeric NOT NULL,      -- 사용자가 입력한 실제 통장잔고
  ledger_bank   numeric NOT NULL,      -- 대조 시점 장부 통장잔고
  diff          numeric NOT NULL,      -- 실제 − 장부
  adjustment_id uuid REFERENCES public.ft_trade_transactions(id),  -- 보정 행 (만들었을 때)
  note          text,
  created_by    text
);
CREATE INDEX IF NOT EXISTS idx_ft_trade_bank_checks_at ON public.ft_trade_bank_checks (checked_at DESC);
ALTER TABLE public.ft_trade_bank_checks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ft_trade_bank_checks IS
  '무역계좌 통장 대조 이력 — 실제 통장잔고 vs 장부. 차이는 선택적으로 보정 행으로 반영.';


-- ============================================================
-- 3) 통장 대조 — 차이 기록 + (선택) 보정
-- ============================================================
CREATE OR REPLACE FUNCTION public.trade_bank_check(
  p_actual_bank numeric,
  p_adjust      boolean DEFAULT false,
  p_note        text    DEFAULT NULL,
  p_created_by  text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now      timestamptz;
  v_today    date;
  v_ledger   numeric;
  v_diff     numeric;
  v_adj_id   uuid := NULL;
  v_check_id uuid;
BEGIN
  IF p_actual_bank IS NULL THEN
    RAISE EXCEPTION 'bank check: actual balance is required';
  END IF;

  -- 대조·보정이 한 시점의 장부를 보도록 lock (append 안의 lock 과 같은 키 — 재진입 가능)
  PERFORM pg_advisory_xact_lock(hashtext('ft_trade_ledger'));
  v_now   := clock_timestamp();
  v_today := (v_now AT TIME ZONE 'Asia/Seoul')::date;

  SELECT bank_balance INTO v_ledger
  FROM ft_trade_transactions
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_ledger IS NULL THEN
    RAISE EXCEPTION 'trade: ledger not opened (no opening row)';
  END IF;

  v_diff := round(p_actual_bank, 2) - v_ledger;

  IF p_adjust AND v_diff <> 0 THEN
    v_adj_id := public.trade_append_row(
      'company', '보정', v_today,
      v_diff, 0, v_diff, abs(v_diff),
      format('통장 대조 보정 (실제 %s / 장부 %s)', round(p_actual_bank, 2), v_ledger),
      'BANKCHECK-' || to_char(v_now AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD-HH24MISS'),
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), '통장 대조 차이'),
      p_created_by
    );
  END IF;

  INSERT INTO ft_trade_bank_checks (checked_at, applied_date, actual_bank, ledger_bank, diff, adjustment_id, note, created_by)
  VALUES (v_now, v_today, round(p_actual_bank, 2), v_ledger, v_diff, v_adj_id, nullif(btrim(coalesce(p_note, '')), ''), p_created_by)
  RETURNING id INTO v_check_id;

  RETURN json_build_object(
    'check_id',      v_check_id,
    'checked_at',    v_now,
    'actual_bank',   round(p_actual_bank, 2),
    'ledger_bank',   v_ledger,
    'diff',          v_diff,
    'adjustment_id', v_adj_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trade_bank_check(numeric, boolean, text, text) FROM PUBLIC, anon, authenticated;

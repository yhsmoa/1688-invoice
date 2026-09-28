-- ============================================================
-- 구 원장(invoiceManager_transactions · invoiceManager_balance) 읽기 전용 잠금
--
-- 배경:
--   2026-09-13 부터 신 원장(ft_user_transactions)이 잔액의 유일한 기준이다.
--   구 원장은 8월까지의 과거 기록 조회용으로만 남는다.
--     · 8/31 이전 날짜분  → 신 원장 이월 행(category='이월')에 합계로 반영
--         immong 충전 5,737,712.85 / 차감 5,764,152.51, hilili 차감 268,768.30 (구 원장 합계와 일치 확인)
--     · 9/1 ~ 9/12 병행 기간 34건 → 신 원장에 source_table='invoiceManager_transactions' 로 개별 이관
--     · 마지막 기록 2026-09-12 15:45 KST, 이후 추가·수정 0건 (2026-09-28 확인)
--
--   그런데 구 원장에 쓰는 경로가 남아 있었다:
--     · auto-1688-order 앱의 옛 [차감] 버튼 (신 원장에는 기록 안 됨 → 차감 누락 위험)
--     · 1688-invoice /api/save-payment-transaction, /api/update-payment-date (호출처 없음)
--     · anon 키의 직접 쓰기 권한
--   → 어느 경로든 DB 에서 한 번에 막는다. service role 도 트리거는 우회하지 못한다.
--
-- 조회(SELECT)는 그대로 — 고객계좌(구) 화면·거래요약 등 과거 기록 조회에 영향 없음.
-- 되돌리기: 아래 DROP TRIGGER 4줄 (함수는 남겨도 무방).
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 완료 (2026-09-28)
-- ============================================================

-- ── 1) 거절 함수 ──
CREATE OR REPLACE FUNCTION public.reject_old_ledger_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '구 원장(%)은 읽기 전용입니다. 충전·차감은 신 원장(고객계좌(신))에서 기록하세요.', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ── 2) 행 단위 INSERT / UPDATE / DELETE 차단 ──
DROP TRIGGER IF EXISTS trg_freeze_old_ledger_tx ON public."invoiceManager_transactions";
CREATE TRIGGER trg_freeze_old_ledger_tx
  BEFORE INSERT OR UPDATE OR DELETE ON public."invoiceManager_transactions"
  FOR EACH ROW EXECUTE FUNCTION public.reject_old_ledger_write();

DROP TRIGGER IF EXISTS trg_freeze_old_ledger_balance ON public."invoiceManager_balance";
CREATE TRIGGER trg_freeze_old_ledger_balance
  BEFORE INSERT OR UPDATE OR DELETE ON public."invoiceManager_balance"
  FOR EACH ROW EXECUTE FUNCTION public.reject_old_ledger_write();

-- ── 3) TRUNCATE 차단 (문장 단위) ──
DROP TRIGGER IF EXISTS trg_freeze_old_ledger_tx_truncate ON public."invoiceManager_transactions";
CREATE TRIGGER trg_freeze_old_ledger_tx_truncate
  BEFORE TRUNCATE ON public."invoiceManager_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_old_ledger_write();

DROP TRIGGER IF EXISTS trg_freeze_old_ledger_balance_truncate ON public."invoiceManager_balance";
CREATE TRIGGER trg_freeze_old_ledger_balance_truncate
  BEFORE TRUNCATE ON public."invoiceManager_balance"
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_old_ledger_write();

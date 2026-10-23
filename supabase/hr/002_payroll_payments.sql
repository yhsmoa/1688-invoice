-- ============================================================
-- 급여 지급완료 기록 — 출근기록(시간 셀) 단위
--
-- 목적:
--   급여장부 [부분엑셀] 로 고른 시간을 실제로 지급한 뒤 [급여지급완료] 로 표시한다.
--   [월급엑셀] 은 지급완료된 시간을 빼고 남은 시간만 계산한다.
--
-- 구조:
--   1) invoiceManager_payroll_payments       — 지급 묶음 (한 번의 [급여지급완료])
--   2) invoiceManager_payroll_payment_items  — 묶음에 포함된 출근기록 1건 = 1행
--        · 지급 시점의 근무 분·시급을 스냅샷으로 보관 (나중에 시급이 바뀌어도 지급액 보존)
--        · 같은 출근기록은 '활성(취소 안 된)' 항목이 하나만 — 부분 유니크 인덱스로 이중 지급 차단
--        · 취소는 삭제가 아니라 canceled_at 기록 (이력 보존)
--   3) payroll_mark_paid(record_ids, paid_date, note)  — 지급완료 (한 트랜잭션)
--   4) payroll_cancel_paid(record_ids)                  — 지급 취소 (출근기록 단위)
--   5) 트리거 — 지급완료된 출근기록은 시간 수정·삭제 차단
--        (급여장부 외 다른 경로로 수정해도 DB 가 막는다. 먼저 지급 취소해야 수정 가능)
--
-- 오류 메시지는 'payroll: ' 접두사 + 한글 — API 가 접두사를 떼고 화면에 그대로 보여준다.
-- 기존 출근기록 테이블에는 컬럼을 추가하지 않는다 (출퇴근 스캔 흐름 무영향).
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah) — Supabase SQL Editor 에서 1회 실행
-- ============================================================


-- ============================================================
-- 1) 지급 묶음
-- ============================================================
CREATE TABLE IF NOT EXISTS public."invoiceManager_payroll_payments" (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_month date        NOT NULL,              -- 귀속월 (그 달 1일)
  paid_date     date        NOT NULL,              -- 지급일 (KST)
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."invoiceManager_payroll_payments" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public."invoiceManager_payroll_payments" IS
  '급여 지급완료 묶음 — 급여장부 [급여지급완료] 1회. 항목은 invoiceManager_payroll_payment_items';


-- ============================================================
-- 2) 지급 항목 (출근기록 1건 = 1행, 스냅샷)
-- ============================================================
CREATE TABLE IF NOT EXISTS public."invoiceManager_payroll_payment_items" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid        NOT NULL REFERENCES public."invoiceManager_payroll_payments"(id),
  -- 활성 항목의 출근기록은 트리거가 삭제를 막는다. 취소된 항목만 출근기록 삭제 시 NULL 이 된다.
  record_id   uuid        REFERENCES public."invoiceManager_emplyee_records"(id) ON DELETE SET NULL,
  employee_id uuid        NOT NULL,
  work_date   date        NOT NULL,
  minutes     integer     NOT NULL CHECK (minutes > 0),   -- 지급 시점 근무 분
  hourly_wage bigint,                                     -- 지급 시점 시급
  created_at  timestamptz NOT NULL DEFAULT now(),
  canceled_at timestamptz,
  CONSTRAINT payroll_item_active_has_record CHECK (canceled_at IS NOT NULL OR record_id IS NOT NULL)
);
ALTER TABLE public."invoiceManager_payroll_payment_items" ENABLE ROW LEVEL SECURITY;

-- 같은 출근기록의 활성 지급은 하나만 (이중 지급 차단)
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_item_active_record
  ON public."invoiceManager_payroll_payment_items" (record_id)
  WHERE canceled_at IS NULL;

-- 월 조회 (급여장부·월급엑셀)
CREATE INDEX IF NOT EXISTS ix_payroll_item_active_work_date
  ON public."invoiceManager_payroll_payment_items" (work_date)
  WHERE canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_payroll_item_payment
  ON public."invoiceManager_payroll_payment_items" (payment_id);

COMMENT ON TABLE public."invoiceManager_payroll_payment_items" IS
  '급여 지급완료 항목 — 출근기록 1건 = 1행. canceled_at IS NULL 이 활성. 근무 분·시급은 지급 시점 스냅샷';


-- ============================================================
-- 3) 지급완료 — 한 트랜잭션
--   검증: 요청 id 전부 존재 · 퇴근 기록 있음 · 근무 분 > 0 · 같은 달 · 아직 미지급
--         지급일은 오늘(KST) 이하, 가장 늦은 근무일 이상
-- ============================================================
CREATE OR REPLACE FUNCTION public.payroll_mark_paid(
  p_record_ids uuid[],
  p_paid_date  date,
  p_note       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids         uuid[];
  v_found       integer;
  v_bad         integer;
  v_months      integer;
  v_month       date;
  v_last_work   date;
  v_payment_id  uuid;
  v_minutes     bigint;
  v_today       date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  -- ── 입력 ──
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_record_ids) AS x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'payroll: 선택된 시간이 없습니다.';
  END IF;
  IF p_paid_date IS NULL THEN
    RAISE EXCEPTION 'payroll: 지급일이 필요합니다.';
  END IF;
  IF p_paid_date > v_today THEN
    RAISE EXCEPTION 'payroll: 지급일은 오늘(%) 이후로 지정할 수 없습니다.', v_today;
  END IF;

  -- ── 동시 지급 직렬화 + 대상 기록 잠금 (지급 중 시간 수정과 경합 방지) ──
  PERFORM pg_advisory_xact_lock(hashtext('payroll_payment'));
  PERFORM 1 FROM "invoiceManager_emplyee_records" WHERE id = ANY (v_ids) FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE clock_out IS NULL OR coalesce(total_minutes, 0) <= 0 OR work_date IS NULL),
         count(DISTINCT date_trunc('month', work_date)),
         min(date_trunc('month', work_date))::date,
         max(work_date)
    INTO v_found, v_bad, v_months, v_month, v_last_work
    FROM "invoiceManager_emplyee_records"
   WHERE id = ANY (v_ids);

  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'payroll: 선택한 시간 중 % 건을 찾을 수 없습니다. 새로고침 후 다시 선택해 주세요.', cardinality(v_ids) - v_found;
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'payroll: 퇴근 기록이 없거나 근무 시간이 0 인 시간 % 건은 지급완료할 수 없습니다.', v_bad;
  END IF;
  IF v_months <> 1 THEN
    RAISE EXCEPTION 'payroll: 한 번에 한 달의 시간만 지급완료할 수 있습니다.';
  END IF;
  IF p_paid_date < v_last_work THEN
    RAISE EXCEPTION 'payroll: 지급일(%)이 마지막 근무일(%)보다 빠를 수 없습니다.', p_paid_date, v_last_work;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "invoiceManager_payroll_payment_items"
     WHERE record_id = ANY (v_ids) AND canceled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payroll: 이미 지급완료된 시간이 포함되어 있습니다. 새로고침 후 다시 선택해 주세요.';
  END IF;

  -- ── 묶음 + 항목 (근무 분·시급 스냅샷) ──
  INSERT INTO "invoiceManager_payroll_payments" (payroll_month, paid_date, note)
  VALUES (v_month, p_paid_date, nullif(btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_payment_id;

  INSERT INTO "invoiceManager_payroll_payment_items"
         (payment_id, record_id, employee_id, work_date, minutes, hourly_wage)
  SELECT v_payment_id, r.id, r.employee_id, r.work_date, r.total_minutes, e.hourly_wage
    FROM "invoiceManager_emplyee_records" r
    LEFT JOIN "invoiceManager_employees" e ON e.id = r.employee_id
   WHERE r.id = ANY (v_ids);

  SELECT sum(minutes) INTO v_minutes
    FROM "invoiceManager_payroll_payment_items" WHERE payment_id = v_payment_id;

  RETURN json_build_object(
    'payment_id',    v_payment_id,
    'payroll_month', v_month,
    'paid_date',     p_paid_date,
    'record_count',  cardinality(v_ids),
    'total_minutes', v_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_mark_paid(uuid[], date, text) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 4) 지급 취소 — 출근기록 단위 (이력은 canceled_at 으로 보존)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payroll_cancel_paid(p_record_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_record_ids IS NULL OR cardinality(p_record_ids) = 0 THEN
    RAISE EXCEPTION 'payroll: 취소할 시간이 없습니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('payroll_payment'));

  UPDATE "invoiceManager_payroll_payment_items"
     SET canceled_at = now()
   WHERE record_id = ANY (p_record_ids) AND canceled_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'payroll: 지급완료 기록을 찾을 수 없습니다. 새로고침 후 다시 확인해 주세요.';
  END IF;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_cancel_paid(uuid[]) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 5) 지급완료된 출근기록 잠금 — 시간 수정·삭제 차단
--   SECURITY DEFINER: 항목 테이블 RLS 와 무관하게 항상 판정 (호출 역할이 달라도 우회 불가)
--   수정 판정 대상 컬럼: employee_id, work_date, clock_in, clock_out, total_minutes
-- ============================================================
CREATE OR REPLACE FUNCTION public.payroll_guard_paid_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "invoiceManager_payroll_payment_items"
       WHERE record_id = OLD.id AND canceled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'payroll: 급여 지급완료된 시간은 삭제할 수 없습니다. 먼저 지급을 취소해 주세요.';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.employee_id, NEW.work_date, NEW.clock_in, NEW.clock_out, NEW.total_minutes)
       IS DISTINCT FROM
     (OLD.employee_id, OLD.work_date, OLD.clock_in, OLD.clock_out, OLD.total_minutes)
     AND EXISTS (
       SELECT 1 FROM "invoiceManager_payroll_payment_items"
        WHERE record_id = OLD.id AND canceled_at IS NULL
     )
  THEN
    RAISE EXCEPTION 'payroll: 급여 지급완료된 시간은 수정할 수 없습니다. 먼저 지급을 취소해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_guard_paid_record() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payroll_guard_paid_record ON public."invoiceManager_emplyee_records";
CREATE TRIGGER trg_payroll_guard_paid_record
  BEFORE UPDATE OR DELETE ON public."invoiceManager_emplyee_records"
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_paid_record();

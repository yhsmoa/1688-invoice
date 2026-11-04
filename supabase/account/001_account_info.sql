-- ============================================================
-- 계좌정보 — 회사이름 / 이름 / 연락처 / 은행 / 계좌번호 / 비고
--
-- 목적:
--   계좌관리 > 계좌정보(/db/account-info) 화면에서 입금·송금용 계좌를 등록·수정·삭제한다.
--
-- 접근:
--   RLS 를 켜고 정책을 두지 않는다.
--   → anon 키로는 읽기·쓰기 불가, 서버(service role) 의 /api/db/account-info 만 접근.
--   화면·API 는 접근 코드 없이 누구나 사용 (운영 요청).
--   created_by / updated_by 는 접근 코드를 쓰지 않으므로 채우지 않는다 (NULL).
--
-- 은행(bank_name):
--   직원관리 은행명과 같은 목록(app/hr/employees/utils/bankNames.ts)에서 고르되,
--   목록 외 값도 직접 입력 가능 → 자유 텍스트로 저장한다.
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah)
-- ============================================================


-- ============================================================
-- 1) 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_account_info (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  text,                                 -- 회사이름
  name          text,                                 -- 이름 (예금주)
  phone         text,                                 -- 연락처
  bank_name     text,                                 -- 은행
  account_no    text,                                 -- 계좌번호 (앞자리 0·하이픈 보존 위해 text)
  note          text,                                 -- 비고
  created_by    uuid,                                 -- 등록한 직원 (invoiceManager_employees.id)
  updated_by    uuid,                                 -- 마지막 수정 직원
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_account_info ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ft_account_info IS
  '계좌정보 — 계좌관리 > 계좌정보(/db/account-info). RLS 정책 없음(서버 전용), 화면·API 접근 코드 불필요';

CREATE INDEX IF NOT EXISTS ix_ft_account_info_created_at
  ON public.ft_account_info (created_at DESC);


-- ============================================================
-- 2) updated_at 자동 갱신
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_account_info_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ft_account_info_touch ON public.ft_account_info;
CREATE TRIGGER trg_ft_account_info_touch
  BEFORE UPDATE ON public.ft_account_info
  FOR EACH ROW EXECUTE FUNCTION public.ft_account_info_touch_updated_at();

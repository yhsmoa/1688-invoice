-- ============================================================
-- ft_cancel_details.done_at 추가 (반품/취소 완료 시점 기록)
--
-- 배경:
--   /return-product-v2 의 [완료] 버튼이 status 를 'DONE' 으로 바꾸지만
--   "언제 완료됐는지" 가 남지 않아 조회·정산에 쓸 수 없었다.
--   created_at 은 접수 시점이라 완료 시점의 대체가 되지 않는다.
--
-- 채우는 곳:
--   app/api/ft/cancel-details/route.ts 의 PATCH (status 변경 경로 한 곳뿐)
--     · 'DONE'    → done_at = now
--     · 그 외 상태 → done_at = NULL  (되돌리면 이전 완료 시각이 남으면 안 된다)
--   done_at 은 ALLOWED_UPDATE_FIELDS 에 없다 — 클라이언트가 직접 못 정한다.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 에 적용 완료 (2026-09-12).
-- 기존 DONE 3,342건은 완료 시각을 알 수 없어 done_at = NULL 로 남는다.
-- 앞으로 완료되는 건부터 값이 쌓인다.
-- ============================================================

ALTER TABLE public.ft_cancel_details
  ADD COLUMN IF NOT EXISTS done_at timestamptz NULL;

COMMENT ON COLUMN public.ft_cancel_details.done_at IS
  'status 가 DONE 으로 전환된 시점. DONE 이 아닌 상태로 되돌리면 NULL 로 비운다.';

-- 완료 시점으로 조회·정렬하는 경우를 위한 부분 인덱스 (DONE 행만)
CREATE INDEX IF NOT EXISTS ft_cancel_details_done_at_idx
  ON public.ft_cancel_details (done_at DESC)
  WHERE done_at IS NOT NULL;

-- ── 확인 ──
-- SELECT status, count(*) FILTER (WHERE done_at IS NOT NULL) AS with_done_at, count(*)
-- FROM public.ft_cancel_details GROUP BY 1 ORDER BY 1;

-- ── 롤백 ──
-- DROP INDEX IF EXISTS public.ft_cancel_details_done_at_idx;
-- ALTER TABLE public.ft_cancel_details DROP COLUMN IF EXISTS done_at;

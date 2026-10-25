-- ============================================================
-- 고객 검수 확인 — 상태 흐름 변경 (재문의 단계 추가 · 재확인요청/출고수량변경 제거)
--
-- 새 흐름:
--   (창고 등록) 확인요청 ── 고객 [출고]/[취소] ──▶ 답변완료 ── 창고 [처리완료] ──▶ 처리완료
--                        └─ 고객 [재문의]+코멘트 ─▶ 재문의 ── 고객 [출고]/[취소] ──▶ 답변완료
--                                                        └─ 창고 [처리완료] ──────▶ 처리완료
--   창고는 확인요청 건도 [처리완료]로 닫을 수 있다(잘못 보낸 요청 회수).
--   처리완료 → 창고 [다시 열기] = 고객 선택에 따라 원래 단계로 (없음 → 확인요청, 재문의 → 재문의, 출고·취소 → 답변완료)
--
-- 변경:
--   1) 기존 '답변완료 + 재문의' 행 → status '재문의' (새 규칙에서 재문의는 답변완료가 아니다)
--   2) status 값: 확인요청 · 재문의 · 답변완료 · 처리완료   (재확인요청 제거)
--   3) decision 값: 출고 · 취소 · 재문의                    (출고수량변경 제거 → decision_qty 컬럼 제거)
--   4) 상태 ↔ 선택 정합 CHECK — 확인요청=선택 없음, 재문의=재문의, 답변완료=출고·취소
--   5) customer_check_answer 를 새 흐름으로 교체 (p_decision_qty 인자 제거)
--
-- 안전장치: 재확인요청 · 출고수량변경 행이 하나라도 있으면 아무것도 바꾸지 않고 중단한다
--           (적용 시점 운영 DB 에는 0건 — 자동 변환으로 고객 답을 잃지 않도록).
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah) — 001 다음 1회
-- ============================================================


-- ============================================================
-- 0) 사전 확인
-- ============================================================
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.ft_customer_checks
   WHERE status = '재확인요청' OR decision = '출고수량변경';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'check: 재확인요청 또는 출고수량변경 행 % 건이 있어 흐름 변경을 중단합니다. 먼저 정리해 주세요.', v_bad;
  END IF;
END $$;


-- ============================================================
-- 1) 기존 제약 제거 (값 목록이 바뀐다)
-- ============================================================
ALTER TABLE public.ft_customer_checks DROP CONSTRAINT IF EXISTS ft_customer_checks_decision_qty_required;
ALTER TABLE public.ft_customer_checks DROP CONSTRAINT IF EXISTS ft_customer_checks_status_check;
ALTER TABLE public.ft_customer_checks DROP CONSTRAINT IF EXISTS ft_customer_checks_decision_check;
ALTER TABLE public.ft_customer_checks DROP CONSTRAINT IF EXISTS ft_customer_checks_status_decision_match;   -- 재실행 대비
ALTER TABLE public.ft_customer_checks DROP COLUMN IF EXISTS decision_qty;


-- ============================================================
-- 2) 데이터 이관 — '답변완료 + 재문의' → '재문의'
--    (처리완료 건은 그대로 — 끝난 건의 이력)
-- ============================================================
UPDATE public.ft_customer_checks
   SET status = '재문의'
 WHERE status = '답변완료' AND decision = '재문의';


-- ============================================================
-- 3) 새 제약
-- ============================================================
ALTER TABLE public.ft_customer_checks
  ADD CONSTRAINT ft_customer_checks_status_check
  CHECK (status IN ('확인요청','재문의','답변완료','처리완료'));

ALTER TABLE public.ft_customer_checks
  ADD CONSTRAINT ft_customer_checks_decision_check
  CHECK (decision IS NULL OR decision IN ('출고','취소','재문의'));

-- 상태 ↔ 선택 정합 (처리완료는 어떤 선택이든 — 답 없이 닫은 건 포함)
ALTER TABLE public.ft_customer_checks
  ADD CONSTRAINT ft_customer_checks_status_decision_match
  CHECK (
    (status = '확인요청' AND decision IS NULL) OR
    (status = '재문의'   AND decision = '재문의') OR
    (status = '답변완료' AND decision IN ('출고','취소')) OR
    (status = '처리완료')
  );


-- ============================================================
-- 4) 고객 답변 함수 교체
--
--   확인요청: 출고 · 취소 → 답변완료 / 재문의(코멘트 필수) → 재문의
--   재문의  : 출고 · 취소 → 답변완료 (재문의를 이어가려면 댓글만 남긴다)
--   그 외 상태(답변완료·처리완료)는 거부
-- ============================================================
DROP FUNCTION IF EXISTS public.customer_check_answer(uuid, uuid, text, integer, text, text);

CREATE OR REPLACE FUNCTION public.customer_check_answer(
  p_check_id     uuid,
  p_user_id      uuid,
  p_decision     text,
  p_comment      text DEFAULT NULL,
  p_author_name  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row     public.ft_customer_checks%ROWTYPE;
  v_comment text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  v_next    text;
BEGIN
  IF p_check_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'check: 요청 정보가 올바르지 않습니다.';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('출고','취소','재문의') THEN
    RAISE EXCEPTION 'check: 선택 값이 올바르지 않습니다. (출고 / 취소 / 재문의)';
  END IF;

  -- 건 잠금 (동시 답변 방지)
  SELECT * INTO v_row FROM public.ft_customer_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'check: 확인요청을 찾을 수 없습니다.';
  END IF;
  IF v_row.user_id <> p_user_id THEN
    RAISE EXCEPTION 'check: 다른 팀의 확인요청에는 답변할 수 없습니다.';
  END IF;

  IF v_row.status = '확인요청' THEN
    IF p_decision = '재문의' AND v_comment IS NULL THEN
      RAISE EXCEPTION 'check: 재문의는 묻고 싶은 내용을 코멘트로 적어 주세요.';
    END IF;
  ELSIF v_row.status = '재문의' THEN
    IF p_decision = '재문의' THEN
      RAISE EXCEPTION 'check: 이미 재문의 중입니다. 댓글로 이어서 문의하거나 [출고] / [취소]로 확정해 주세요.';
    END IF;
  ELSE
    RAISE EXCEPTION 'check: 이미 % 상태인 건입니다. 새로고침 후 다시 확인해 주세요.', v_row.status;
  END IF;

  v_next := CASE WHEN p_decision = '재문의' THEN '재문의' ELSE '답변완료' END;

  UPDATE public.ft_customer_checks
     SET status      = v_next,
         decision    = p_decision,
         answered_at = now()
   WHERE id = p_check_id
   RETURNING * INTO v_row;

  IF v_comment IS NOT NULL THEN
    INSERT INTO public.ft_customer_check_comments (check_id, author_role, author_name, body)
    VALUES (p_check_id, 'customer', NULLIF(btrim(COALESCE(p_author_name, '')), ''), v_comment);
  END IF;

  RETURN jsonb_build_object(
    'id',          v_row.id,
    'status',      v_row.status,
    'decision',    v_row.decision,
    'answered_at', v_row.answered_at
  );
END;
$$;

COMMENT ON FUNCTION public.customer_check_answer(uuid, uuid, text, text, text) IS
  '고객 검수 확인 답변 — 확인요청: 출고·취소→답변완료 / 재문의(코멘트 필수)→재문의, 재문의: 출고·취소→답변완료';

-- ============================================================
-- 고객 검수 확인 — Notion '상품확인' DB 대체
--
-- 목적:
--   상품입고 V2/V3 [고객확인] 모달이 Notion 대신 이 테이블에 요청을 저장하고,
--   창고(1688-invoice /customer-checks)와 고객(purchase-agent /inspections)이
--   같은 데이터로 질문·답변·처리 상태를 주고받는다.
--
-- 구조:
--   1) ft_customer_checks          — 확인요청 1건 (Notion 레코드 1행). 주문행 스냅샷 포함
--   2) ft_customer_check_comments  — 댓글 스레드 (warehouse / customer)
--   3) ft_customer_check_images    — 첨부 이미지 (Storage 공개 버킷 customer-confirm 의 경로/URL)
--   4) updated_at 자동 갱신 트리거
--   5) customer_check_answer(...)  — 고객 답변 (purchase-agent 가 anon 키로 RPC 호출, 한 트랜잭션)
--
-- 상태 전이 (창고 쪽 전이는 API 가 조건부 UPDATE 로 강제한다):
--   (등록) ──창고 저장──▶ 확인요청 ──고객 답변──▶ 답변완료 ──창고 [재확인요청]──▶ 재확인요청 ──고객 답변──▶ 답변완료
--   확인요청·재확인요청·답변완료 ──창고 [처리완료]──▶ 처리완료 ──창고 [다시 열기]──▶ 재확인요청
--
-- 상태·선택 값은 Notion 과 같은 한글 원문을 저장한다 (화면 번역은 i18n 이 담당).
-- 오류 메시지는 'check: ' 접두사 + 한글 — 호출 쪽이 접두사를 떼고 그대로 보여준다.
--
-- RLS: 다른 ft_* 테이블(ft_order_items 등)과 같이 끈다 — purchase-agent 가 anon 키로 직접 읽기 때문.
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah) — 1회 실행 (재실행 안전)
-- ============================================================


-- ============================================================
-- 1) 확인요청
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_customer_checks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 팀(고객 계정). team_code 는 요청 시점의 user_code 스냅샷 (BZ/BO/BR/HI/MB)
  user_id         uuid        NOT NULL REFERENCES public.ft_users(id),
  team_code       text        NOT NULL,

  -- 주문행 — 삭제돼도 요청은 남아야 하므로 SET NULL + 아래 스냅샷 컬럼으로 표시 유지
  order_item_id   uuid        REFERENCES public.ft_order_items(id) ON DELETE SET NULL,
  order_no        text,
  item_no         text,
  product_no      text,
  item_name       text,
  option_name     text,
  china_option1   text,
  china_option2   text,
  img_url         text,
  site_url        text,

  -- 배송 사이즈 코드 (화면 배지와 동일 — Notion 'TYPE')
  size_code       text        CHECK (size_code IS NULL OR size_code IN ('A','B','C','P','X')),

  -- 수량: 주문수량 / 확인수량(모달 입력, 0 허용) / 입고개수(요청 시점)
  order_qty       integer,
  confirm_qty     integer     CHECK (confirm_qty IS NULL OR confirm_qty >= 0),
  arrival_qty     integer,

  -- 확인 항목 (한글 라벨: 네크라인·소매·밑단·패턴·소재·색상·'기타: …')
  attributes      text[]      NOT NULL DEFAULT '{}',

  -- 상태 / 고객 선택
  status          text        NOT NULL DEFAULT '확인요청'
                              CHECK (status IN ('확인요청','재확인요청','답변완료','처리완료')),
  decision        text        CHECK (decision IS NULL OR decision IN ('출고','취소','재문의','출고수량변경')),
  decision_qty    integer     CHECK (decision_qty IS NULL OR decision_qty > 0),
  CONSTRAINT ft_customer_checks_decision_qty_required
    CHECK (decision IS DISTINCT FROM '출고수량변경' OR decision_qty IS NOT NULL),

  requested_by    text,                      -- 요청한 작업자 이름 (Worker, 없으면 NULL)
  answered_at     timestamptz,               -- 마지막 고객 답변 시각
  closed_at       timestamptz,               -- 처리완료 시각 (다시 열면 NULL)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_customer_checks DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ft_customer_checks IS
  '고객 검수 확인요청 — 입고 [고객확인] 모달 저장분 (Notion 상품확인 DB 대체). 댓글 ft_customer_check_comments, 이미지 ft_customer_check_images';

CREATE INDEX IF NOT EXISTS idx_ft_customer_checks_user_status_created
  ON public.ft_customer_checks (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ft_customer_checks_status_created
  ON public.ft_customer_checks (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ft_customer_checks_order_no
  ON public.ft_customer_checks (order_no);
CREATE INDEX IF NOT EXISTS idx_ft_customer_checks_item_no
  ON public.ft_customer_checks (item_no);


-- ============================================================
-- 2) 댓글
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_customer_check_comments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id      uuid        NOT NULL REFERENCES public.ft_customer_checks(id) ON DELETE CASCADE,
  author_role   text        NOT NULL CHECK (author_role IN ('warehouse','customer')),
  author_name   text,
  body          text        NOT NULL CHECK (length(btrim(body)) > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_customer_check_comments DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ft_customer_check_comments IS
  '고객 검수 확인 댓글 — author_role: warehouse(창고) / customer(고객)';

CREATE INDEX IF NOT EXISTS idx_ft_customer_check_comments_check_created
  ON public.ft_customer_check_comments (check_id, created_at);


-- ============================================================
-- 3) 첨부 이미지 (상품 원본 이미지는 checks.img_url)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_customer_check_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id      uuid        NOT NULL REFERENCES public.ft_customer_checks(id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,       -- 버킷 customer-confirm 안 경로
  public_url    text        NOT NULL,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_customer_check_images DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ft_customer_check_images IS
  '고객 검수 확인 첨부 이미지 — Storage 공개 버킷 customer-confirm';

CREATE INDEX IF NOT EXISTS idx_ft_customer_check_images_check_sort
  ON public.ft_customer_check_images (check_id, sort_order);


-- ============================================================
-- 4) updated_at 자동 갱신
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_customer_checks_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ft_customer_checks_touch ON public.ft_customer_checks;
CREATE TRIGGER trg_ft_customer_checks_touch
  BEFORE UPDATE ON public.ft_customer_checks
  FOR EACH ROW EXECUTE FUNCTION public.ft_customer_checks_touch_updated_at();


-- ============================================================
-- 5) 고객 답변 — customer_check_answer
--
--   purchase-agent 가 로그인 사용자의 user_id 와 함께 호출한다. 한 트랜잭션에서:
--     · 건이 그 팀(user_id) 것인지 확인 (다른 팀 건 차단)
--     · 상태가 확인요청·재확인요청인지 확인 (답변완료·처리완료 건은 거부)
--     · 출고수량변경이면 수량 > 0 필수, 그 외 선택은 수량 무시(NULL)
--     · decision/decision_qty/answered_at/status='답변완료' 갱신 + 댓글(customer) 1건(있을 때)
--   반환: 갱신된 건의 요약 jsonb
-- ============================================================
CREATE OR REPLACE FUNCTION public.customer_check_answer(
  p_check_id     uuid,
  p_user_id      uuid,
  p_decision     text,
  p_decision_qty integer DEFAULT NULL,
  p_comment      text    DEFAULT NULL,
  p_author_name  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row     public.ft_customer_checks%ROWTYPE;
  v_comment text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  v_qty     integer;
BEGIN
  IF p_check_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'check: 요청 정보가 올바르지 않습니다.';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('출고','취소','재문의','출고수량변경') THEN
    RAISE EXCEPTION 'check: 선택 값이 올바르지 않습니다. (출고 / 취소 / 재문의 / 출고수량변경)';
  END IF;

  -- 건 잠금 (동시 답변 방지)
  SELECT * INTO v_row FROM public.ft_customer_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'check: 확인요청을 찾을 수 없습니다.';
  END IF;
  IF v_row.user_id <> p_user_id THEN
    RAISE EXCEPTION 'check: 다른 팀의 확인요청에는 답변할 수 없습니다.';
  END IF;
  IF v_row.status NOT IN ('확인요청','재확인요청') THEN
    RAISE EXCEPTION 'check: 이미 % 상태인 건입니다. 새로고침 후 다시 확인해 주세요.', v_row.status;
  END IF;

  IF p_decision = '출고수량변경' THEN
    IF p_decision_qty IS NULL OR p_decision_qty <= 0 THEN
      RAISE EXCEPTION 'check: 출고수량변경은 변경할 수량(1 이상)이 필요합니다.';
    END IF;
    v_qty := p_decision_qty;
  ELSE
    v_qty := NULL;
  END IF;

  UPDATE public.ft_customer_checks
     SET status       = '답변완료',
         decision     = p_decision,
         decision_qty = v_qty,
         answered_at  = now()
   WHERE id = p_check_id
   RETURNING * INTO v_row;

  IF v_comment IS NOT NULL THEN
    INSERT INTO public.ft_customer_check_comments (check_id, author_role, author_name, body)
    VALUES (p_check_id, 'customer', NULLIF(btrim(COALESCE(p_author_name, '')), ''), v_comment);
  END IF;

  RETURN jsonb_build_object(
    'id',           v_row.id,
    'status',       v_row.status,
    'decision',     v_row.decision,
    'decision_qty', v_row.decision_qty,
    'answered_at',  v_row.answered_at
  );
END;
$$;

COMMENT ON FUNCTION public.customer_check_answer(uuid, uuid, text, integer, text, text) IS
  '고객 검수 확인 답변 — 확인요청·재확인요청 건에 선택(출고/취소/재문의/출고수량변경)+댓글 기록 후 답변완료';

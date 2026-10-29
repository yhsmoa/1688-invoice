-- ============================================================
-- 쉽먼트 — 고객 이동요청 (purchase-agent 출고준비 ↔ 1688-invoice 쉽먼트 V2)
--
-- 흐름
--   고객(purchase-agent) : 출고준비 행 체크 → [이동요청] → A/B/C/P/X 선택
--                          → ft_move_request_create            (anon 실행)
--                          → 미처리 요청 배지 클릭 → 취소     → ft_move_request_cancel (anon 실행)
--   창고(1688-invoice)   : 쉽먼트 V2 에서 [이동]/[합배송] 으로 옮긴 뒤 요청 버튼 클릭
--                          → ft_move_request_complete          (service role 전용)
--                            박스 타입이 요청 타입과 같을 때만 DONE
--   출고 시 남은 미처리 요청은 POST /api/ft/shipments 가 CANCELLED(note='shipped') 로 닫는다.
--
-- 단위: 포장 행(ft_fulfillment_outbounds) 1건 = 요청 1건.
--   · 고객 화면은 (order_item_id + box_code) 로 합산해 보여주므로 합산 행의 id 전부를 보낸다.
--   · 분할 이동(SPLIT) 하면 원본 id 에 요청이 남는다 (남은 수량에 대한 요청).
--
-- 박스 타입 판정 (effective type)
--   합배송된 박스(master_box_id 있음)는 마스터 박스 타입, 아니면 자기 박스 타입.
--   ft_box_info.type 은 box_code 둘째 토막과 전 행 일치 (2026-10-29 실측, 불일치 0).
--
-- outbound_id 에 FK 를 걸지 않는다 — 입고 V2 의 포장 철회(outbound DELETE)로 행이 사라져도
-- 요청 이력은 남긴다. 화면·집계는 "열린 PACKED 행과 조인되는 요청" 만 센다.
--
-- 권한
--   · 테이블: RLS 끔 (다른 ft_* 와 동일, 팀 격리는 user_id 조건) — anon 은 SELECT 만
--   · 쓰기는 함수로만. create/cancel 은 SECURITY DEFINER (anon 이 직접 INSERT 권한이 없으므로)
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-10-29)
-- ============================================================

-- ============================================================
-- 1) 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_move_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL,
  outbound_id      uuid        NOT NULL,
  request_group_id uuid        NOT NULL,
  target_type      text        NOT NULL CHECK (target_type IN ('A','B','C','P','X')),
  from_box_code    text,
  status           text        NOT NULL DEFAULT 'REQUESTED'
                               CHECK (status IN ('REQUESTED','DONE','CANCELLED')),
  requested_by     text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  done_by          text,
  done_at          timestamptz,
  note             text
);

COMMENT ON TABLE public.ft_move_requests IS
  '고객 이동요청 — 포장 행(ft_fulfillment_outbounds) 1건당 1요청. 쓰기는 ft_move_request_* 함수로만';

CREATE INDEX IF NOT EXISTS ft_move_requests_user_status_idx
  ON public.ft_move_requests (user_id, status);
CREATE INDEX IF NOT EXISTS ft_move_requests_outbound_idx
  ON public.ft_move_requests (outbound_id);
-- 같은 포장 행에 미처리 요청은 하나만
CREATE UNIQUE INDEX IF NOT EXISTS ft_move_requests_open_uniq
  ON public.ft_move_requests (outbound_id) WHERE status = 'REQUESTED';

ALTER TABLE public.ft_move_requests DISABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ft_move_requests FROM anon, authenticated;
GRANT SELECT ON public.ft_move_requests TO anon, authenticated;

-- ============================================================
-- 2) 박스 실효 타입 (합배송이면 마스터 박스 타입)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_box_effective_type(p_box_info_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(m.type, b.type)
    FROM ft_box_info b
    LEFT JOIN ft_box_info m ON m.id = b.master_box_id
   WHERE b.id = p_box_info_id;
$$;

REVOKE ALL ON FUNCTION public.ft_box_effective_type(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_box_effective_type(uuid) TO service_role;

-- ============================================================
-- 3) 요청 생성 (고객 — anon 실행)
--
--   반환: { group_id, created, skipped_duplicate, skipped_same_type, skipped_closed }
--     · skipped_duplicate : 이미 미처리 요청이 있는 행
--     · skipped_same_type : 이미 요청 타입 박스에 있는 행
--     · skipped_closed    : 그 사이 출고됐거나 포장이 철회된 행 (화면이 오래된 경우)
--   다른 팀 행이 섞이면 전체 거부 (예외 → 아무것도 만들지 않음)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_move_request_create(
  p_user_id      uuid,
  p_outbound_ids uuid[],
  p_target_type  text,
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   uuid := gen_random_uuid();
  v_id      uuid;
  v_row     ft_fulfillment_outbounds%ROWTYPE;
  v_type    text;
  v_created int := 0;
  v_dup     int := 0;
  v_same    int := 0;
  v_closed  int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'request: 로그인 정보가 없습니다.';
  END IF;
  IF p_target_type IS NULL OR p_target_type NOT IN ('A','B','C','P','X') THEN
    RAISE EXCEPTION 'request: 이동할 박스 타입이 올바르지 않습니다. (A / B / C / P / X)';
  END IF;
  IF p_outbound_ids IS NULL OR cardinality(p_outbound_ids) = 0 THEN
    RAISE EXCEPTION 'request: 이동요청할 항목을 선택해 주세요.';
  END IF;
  IF cardinality(p_outbound_ids) > 2000 THEN
    RAISE EXCEPTION 'request: 한 번에 2000건까지 요청할 수 있습니다.';
  END IF;

  FOR v_id IN SELECT DISTINCT unnest(p_outbound_ids) LOOP
    SELECT * INTO v_row FROM ft_fulfillment_outbounds WHERE id = v_id FOR SHARE;

    -- 포장이 철회되어 행이 없음
    IF NOT FOUND THEN
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    IF v_row.user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'request: 다른 팀의 항목은 요청할 수 없습니다.';
    END IF;

    -- 이미 출고되었거나 포장 행이 아님
    IF v_row.type IS DISTINCT FROM 'PACKED' OR v_row.shipment_id IS NOT NULL THEN
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    v_type := ft_box_effective_type(v_row.box_info_id);
    IF v_type = p_target_type THEN
      v_same := v_same + 1;
      CONTINUE;
    END IF;

    INSERT INTO ft_move_requests (
      user_id, outbound_id, request_group_id, target_type, from_box_code, requested_by
    ) VALUES (
      p_user_id, v_id, v_group, p_target_type, v_row.box_code,
      NULLIF(btrim(COALESCE(p_requested_by, '')), '')
    )
    ON CONFLICT (outbound_id) WHERE status = 'REQUESTED' DO NOTHING;

    IF FOUND THEN
      v_created := v_created + 1;
    ELSE
      v_dup := v_dup + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'group_id',          v_group,
    'created',           v_created,
    'skipped_duplicate', v_dup,
    'skipped_same_type', v_same,
    'skipped_closed',    v_closed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ft_move_request_create(uuid, uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ft_move_request_create(uuid, uuid[], text, text)
  TO anon, authenticated, service_role;

-- ============================================================
-- 4) 요청 취소 (고객 — anon 실행) : 미처리(REQUESTED) 만
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_move_request_cancel(
  p_user_id    uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req ft_move_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM ft_move_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request: 이동요청을 찾을 수 없습니다.';
  END IF;
  IF v_req.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'request: 다른 팀의 이동요청은 취소할 수 없습니다.';
  END IF;
  IF v_req.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'request: 이미 처리되었거나 취소된 요청입니다. 새로고침 후 확인해 주세요.';
  END IF;

  UPDATE ft_move_requests
     SET status  = 'CANCELLED',
         done_at = now(),
         note    = 'customer'
   WHERE id = p_request_id;

  RETURN jsonb_build_object('id', p_request_id, 'status', 'CANCELLED');
END;
$$;

REVOKE ALL ON FUNCTION public.ft_move_request_cancel(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ft_move_request_cancel(uuid, uuid)
  TO anon, authenticated, service_role;

-- ============================================================
-- 5) 처리완료 (창고 — service role 전용)
--
--   포장 행이 아직 열려 있고(PACKED · 미출고) 실효 박스 타입이 요청 타입과 같아야 DONE.
--   다르면 현재 타입을 알려주는 예외 → 창고가 [이동]/[합배송] 후 다시 누른다.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_move_request_complete(
  p_request_id uuid,
  p_done_by    text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req  ft_move_requests%ROWTYPE;
  v_row  ft_fulfillment_outbounds%ROWTYPE;
  v_type text;
  v_by   text := NULLIF(btrim(COALESCE(p_done_by, '')), '');
BEGIN
  IF v_by IS NULL THEN
    RAISE EXCEPTION 'request: 처리 담당자를 선택해 주세요.';
  END IF;

  SELECT * INTO v_req FROM ft_move_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request: 이동요청을 찾을 수 없습니다.';
  END IF;
  IF v_req.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'request: 이미 처리되었거나 고객이 취소한 요청입니다. 새로고침 후 확인해 주세요.';
  END IF;

  SELECT * INTO v_row FROM ft_fulfillment_outbounds WHERE id = v_req.outbound_id FOR SHARE;
  IF NOT FOUND OR v_row.type IS DISTINCT FROM 'PACKED' OR v_row.shipment_id IS NOT NULL THEN
    RAISE EXCEPTION 'request: 요청 대상 항목이 이미 출고되었거나 포장이 철회되었습니다.';
  END IF;

  v_type := ft_box_effective_type(v_row.box_info_id);
  IF v_type IS DISTINCT FROM v_req.target_type THEN
    RAISE EXCEPTION 'request: 아직 % 박스(%)에 있습니다. % 타입 박스로 이동 후 다시 눌러 주세요.',
      COALESCE(v_type, '?'), COALESCE(v_row.box_code, '-'), v_req.target_type;
  END IF;

  UPDATE ft_move_requests
     SET status  = 'DONE',
         done_by = v_by,
         done_at = now()
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'id',       p_request_id,
    'status',   'DONE',
    'box_code', v_row.box_code,
    'done_at',  now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ft_move_request_complete(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_move_request_complete(uuid, text) TO service_role;

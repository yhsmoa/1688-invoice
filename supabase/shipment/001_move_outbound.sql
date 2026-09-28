-- ============================================================
-- 쉽먼트 V2 — 포장(PACKED) 행 박스 이동 (전체 / 수량 분할)
--
-- 호출: POST /api/ft/shipment-v2/move — 행 1건당 1회 (행마다 독립 트랜잭션)
--
-- 동작:
--   p_qty NULL 또는 = 현재 수량 → 전체 이동 : box_code / box_info_id 갱신
--   0 < p_qty < 현재 수량       → 분할 이동 : 원본 quantity 차감 + 새 행 INSERT
--
-- 분할 행 규칙:
--   · created_at 을 원본에서 복사 — "포장 시각" 의미 유지.
--     (lib 확인필요 판정의 lastPackedAt, 처리속도 통계의 포장 시각이 이동 때문에 바뀌지 않게)
--   · order_item_id / product_id / user_id / operator_* 등 원본 그대로
--   · note 에 이동 이력 한 줄 추가 (전체 이동도 동일) — note 는 기존에 쓰이지 않던 컬럼
--   · 수량 합계는 분할 전후 동일 → total_qty·confirmDone·확인필요 판정 영향 없음
--
-- 검증 (모두 DB 기준 — 화면 수량은 인라인 편집으로 DB 와 다를 수 있음):
--   · 대상 박스: 존재 / 같은 user_id / shipment_id IS NULL / status = 'PACKING'
--     FOR SHARE 잠금 → 이 트랜잭션 동안 그 박스가 출고 배정되지 않는다
--   · 원본 행: type = 'PACKED' / shipment_id IS NULL / 같은 user_id / quantity > 0
--     FOR UPDATE 잠금 → 동시에 같은 행을 분할해도 두 번째는 최신 수량으로 재검증
--   · 이미 대상 박스인 행은 SKIPPED
--
-- 오류 코드 (RAISE EXCEPTION 메시지 → API 가 한글 문구로 변환):
--   MOVE_BOX_NOT_FOUND / MOVE_BOX_NOT_OPEN / MOVE_ROW_NOT_FOUND
--   MOVE_ROW_NOT_MOVABLE / MOVE_INVALID_QTY
--
-- 권한: service role 전용 (anon/authenticated 실행 권한 회수)
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-09-28)
-- ============================================================

CREATE OR REPLACE FUNCTION public.ft_move_outbound(
  p_id          uuid,
  p_box_info_id uuid,
  p_user_id     uuid,
  p_qty         int DEFAULT NULL
)
RETURNS TABLE (result text, moved_id uuid, moved_qty int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box    ft_box_info%ROWTYPE;
  v_src    ft_fulfillment_outbounds%ROWTYPE;
  v_trace  text;
  v_new_id uuid;
BEGIN
  -- ── 1) 대상 박스 검증 + 공유 잠금 ──
  SELECT * INTO v_box FROM ft_box_info WHERE id = p_box_info_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVE_BOX_NOT_FOUND';
  END IF;
  IF v_box.user_id IS DISTINCT FROM p_user_id
     OR v_box.shipment_id IS NOT NULL
     OR v_box.status IS DISTINCT FROM 'PACKING' THEN
    RAISE EXCEPTION 'MOVE_BOX_NOT_OPEN';
  END IF;

  -- ── 2) 원본 행 검증 + 배타 잠금 ──
  SELECT * INTO v_src FROM ft_fulfillment_outbounds WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVE_ROW_NOT_FOUND';
  END IF;
  IF v_src.type IS DISTINCT FROM 'PACKED'
     OR v_src.shipment_id IS NOT NULL
     OR v_src.user_id IS DISTINCT FROM p_user_id
     OR COALESCE(v_src.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'MOVE_ROW_NOT_MOVABLE';
  END IF;

  -- ── 3) 이미 대상 박스 ──
  IF v_src.box_info_id = p_box_info_id THEN
    RETURN QUERY SELECT 'SKIPPED'::text, v_src.id, 0;
    RETURN;
  END IF;

  -- ── 4) 수량 검증 (DB 수량 기준) ──
  IF p_qty IS NOT NULL AND (p_qty <= 0 OR p_qty > v_src.quantity) THEN
    RAISE EXCEPTION 'MOVE_INVALID_QTY';
  END IF;

  v_trace := format(
    '[%s] %s → %s 이동 %s개',
    to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    COALESCE(v_src.box_code, '-'),
    v_box.box_code,
    COALESCE(p_qty, v_src.quantity)
  );

  -- ── 5-a) 전체 이동 ──
  IF p_qty IS NULL OR p_qty = v_src.quantity THEN
    UPDATE ft_fulfillment_outbounds
       SET box_code    = v_box.box_code,
           box_info_id = v_box.id,
           note        = concat_ws(' | ', NULLIF(v_src.note, ''), v_trace)
     WHERE id = p_id;
    RETURN QUERY SELECT 'FULL'::text, p_id, v_src.quantity;
    RETURN;
  END IF;

  -- ── 5-b) 분할 이동 — 원본 차감 + 새 행 (같은 트랜잭션) ──
  UPDATE ft_fulfillment_outbounds
     SET quantity = quantity - p_qty
   WHERE id = p_id;

  INSERT INTO ft_fulfillment_outbounds (
    created_at, order_item_id, type, quantity, note,
    order_no, product_no, product_id,
    box_code, box_info_id,
    operator_id, operator_name, user_id
  ) VALUES (
    v_src.created_at, v_src.order_item_id, 'PACKED', p_qty,
    concat_ws(' | ', NULLIF(v_src.note, ''), v_trace),
    v_src.order_no, v_src.product_no, v_src.product_id,
    v_box.box_code, v_box.id,
    v_src.operator_id, v_src.operator_name, v_src.user_id
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT 'SPLIT'::text, v_new_id, p_qty;
END;
$$;

REVOKE ALL ON FUNCTION public.ft_move_outbound(uuid, uuid, uuid, int)
  FROM PUBLIC, anon, authenticated;

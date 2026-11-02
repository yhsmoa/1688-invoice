-- ============================================================
-- 재고 수량 수정 (ADJUST) — 창고 [재고] 에서 칸(상품 × 위치)의 수량을 직접 고친다
--
--   원장은 기록만 쌓으므로 "새 수량" 을 받아 현재 잔량과의 차이를 ADJUST 행으로 남긴다.
--     quantity = |차이|, delta = 차이 (001 의 delta_sign CHECK: ADJUST 는 abs(delta) = quantity)
--   용도: 실사 불일치 · 배치 때 잘못 센 수량 · 파손/분실. 사유(note)는 필수.
--   권한: service role 전용 (POST /api/ft/storage/adjust)
--   오류: ADJUST_INVALID_QTY (음수) / ADJUST_NO_CHANGE (같은 수량) / ADJUST_NOTE_REQUIRED
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-02)
-- ============================================================

CREATE OR REPLACE FUNCTION public.ft_storage_adjust(
  p_user_id       uuid,
  p_product_id    uuid,
  p_location_id   uuid,
  p_new_qty       int,
  p_note          text,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_balance int;
  v_delta   int;
  v_item_id uuid;
  v_note    text := NULLIF(trim(COALESCE(p_note, '')), '');
BEGIN
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'ADJUST_NOTE_REQUIRED';
  END IF;
  IF p_new_qty IS NULL OR p_new_qty < 0 THEN
    RAISE EXCEPTION 'ADJUST_INVALID_QTY';
  END IF;

  -- ── 같은 상품의 배치·꺼내기·조정을 직렬화 ──
  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  SELECT COALESCE(SUM(delta), 0) INTO v_balance
    FROM ft_storage_movements
   WHERE user_id = p_user_id AND product_id = p_product_id AND location_id = p_location_id;

  v_delta := p_new_qty - v_balance;
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'ADJUST_NO_CHANGE';
  END IF;

  -- ── 원장 행의 order_item_id — 그 칸에 마지막으로 기록된 주문 행 (없으면 상품 대표 행) ──
  SELECT order_item_id INTO v_item_id
    FROM ft_storage_movements
   WHERE user_id = p_user_id AND product_id = p_product_id AND location_id = p_location_id
   ORDER BY created_at DESC LIMIT 1;
  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id FROM ft_order_items
     WHERE user_id = p_user_id AND product_id = p_product_id
     ORDER BY set_seq NULLS FIRST, item_no LIMIT 1;
  END IF;

  INSERT INTO ft_storage_movements (
    user_id, product_id, order_item_id, location_id,
    kind, quantity, delta, operator_name, note
  ) VALUES (
    p_user_id, p_product_id, v_item_id, p_location_id,
    'ADJUST', abs(v_delta), v_delta, p_operator_name, v_note
  );

  RETURN jsonb_build_object('before', v_balance, 'after', p_new_qty, 'delta', v_delta);
END;
$$;

REVOKE ALL ON FUNCTION public.ft_storage_adjust(uuid, uuid, uuid, int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_storage_adjust(uuid, uuid, uuid, int, text, text) TO service_role;

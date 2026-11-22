-- ============================================================
-- 와우출고 — [출고준비] 단계: 신규 → 작업중 → 작업완료 → 서류준비 → 출고준비 → 출고
--   화면: /storage/wow · 앞 단계: supabase/storage/005_wow.sql · 006_wow_stage.sql
--
-- 서류(부착문서 · 동봉문서)는 박스마다 다른 때에 도착한다. 서류가 도착한 것([서류준비])과
--   그 서류를 박스에 붙이고 넣어 출고할 수 있게 된 것([출고준비])을 나눈다.
--     서류준비  담았고 서류 2종이 다 도착 — 아직 출고준비 기록 없음
--     출고준비  [출고준비완료] 를 누름 (ready_at) — 이때부터 쉽먼트 V2 출고 대기 목록에 보이고 출고할 수 있다
--   판정은 한 곳: app/storage/utils/wowStage.ts
--
-- 새로 저장하는 것은 "출고준비" 하나뿐 (ready_at · ready_by).
--   · [출고준비완료] ft_wow_ready_set(…, true)   서류준비 → 출고준비  (박스 여러 개를 한 번에 — 하나라도 안 맞으면 전부 거절)
--   · [출고준비 취소] ft_wow_ready_set(…, false)  출고준비 → 서류준비  (출고 전에만)
--   · 출고준비된 박스는 항상 담겨 있고 서류 2종이 있다 (CHECK 로 강제)
--     → [작업완료 취소](ft_wow_unpack)는 출고준비를 먼저 취소해야 한다 (WOW_BOX_READY)
--
-- 로켓 동기화(ft_wow_sync_order) · 서류 기록(ft_wow_doc_set)은 그대로다 (이 두 칼럼을 건드리지 않는다).
--   로켓은 ft_wow_boxes.ready_at 을 읽어 쉽먼트 관리의 위해 박스 단계에 [출고준비] 를 보여준다.
--
-- 잠금: 발주서 잠금(ft_wow_lock, 상품 없이)을 (사업자, 발주번호) 순으로 — 재고를 건드리지 않아 상품 잠금은 필요 없다.
-- 권한: 1688-invoice(service role) 전용
-- 오류: WOW_INVALID_INPUT / WOW_BOX_NOT_FOUND / WOW_BOX_SHIPPED / WOW_DOCS_NOT_READY
--       WOW_READY_ALREADY / WOW_NOT_READY / WOW_BOX_READY
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-23)
-- ============================================================

-- ============================================================
-- 1) 출고준비 기록
-- ============================================================
ALTER TABLE public.ft_wow_boxes
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_by text;

COMMENT ON COLUMN public.ft_wow_boxes.ready_at IS
  '[출고준비완료] 를 누른 시각. NULL = 아직 출고준비 전 — 값이 있으면 담았고 서류 2종이 있다';
COMMENT ON COLUMN public.ft_wow_boxes.ready_by IS
  '[출고준비완료] 를 누른 담당자';

ALTER TABLE public.ft_wow_boxes
  DROP CONSTRAINT IF EXISTS ft_wow_boxes_ready_chk;
ALTER TABLE public.ft_wow_boxes
  ADD CONSTRAINT ft_wow_boxes_ready_chk
  CHECK (ready_at IS NULL OR (box_info_id IS NOT NULL AND label_path IS NOT NULL AND manifest_path IS NOT NULL));

-- ============================================================
-- 2) [출고준비완료] · [출고준비 취소] — 박스 여러 개를 한 번에
--   p_ready true  : 서류준비 → 출고준비
--   p_ready false : 출고준비 → 서류준비
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_ready_set(
  p_wow_box_ids   uuid[],
  p_ready         boolean,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids   uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_order record;
BEGIN
  IF p_ready IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  FOR v_order IN
    SELECT DISTINCT user_id, order_number FROM ft_wow_boxes WHERE id = ANY (v_ids) ORDER BY user_id, order_number
  LOOP
    PERFORM ft_wow_lock(v_order.user_id, v_order.order_number, '{}'::uuid[]);
  END LOOP;

  -- ── 잠금 뒤 읽기 (로켓 동기화 · 다른 창의 취소 · 출고준비와 겨룬다) ──
  PERFORM 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_wow_boxes b
              JOIN ft_fulfillment_outbounds o ON o.box_info_id = b.box_info_id AND o.shipment_id IS NOT NULL
             WHERE b.id = ANY (v_ids)) THEN
    RAISE EXCEPTION 'WOW_BOX_SHIPPED';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND (ready_at IS NOT NULL) = p_ready) THEN
    RAISE EXCEPTION '%', CASE WHEN p_ready THEN 'WOW_READY_ALREADY' ELSE 'WOW_NOT_READY' END;
  END IF;
  IF p_ready AND EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids)
                          AND (box_info_id IS NULL OR label_path IS NULL OR manifest_path IS NULL)) THEN
    RAISE EXCEPTION 'WOW_DOCS_NOT_READY';
  END IF;

  UPDATE ft_wow_boxes
     SET ready_at   = CASE WHEN p_ready THEN now() END,
         ready_by   = CASE WHEN p_ready THEN p_operator_name END,
         updated_at = now()
   WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('count', cardinality(v_ids));
END;
$$;

-- ============================================================
-- 3) 와우 담기 취소(= [작업완료 취소]) — 005 의 15) 와 같고, 출고준비된 박스를 거절하는 것만 다르다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_unpack(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box  ft_wow_boxes%ROWTYPE;
  v_out  uuid;
  v_back int := 0;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(p_user_id, v_box.order_number,
                      ARRAY(SELECT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id));

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.box_info_id IS NULL THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_PICKED';
  END IF;
  IF v_box.ready_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_READY';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = v_box.box_info_id AND shipment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'WOW_BOX_SHIPPED';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_out IN SELECT id FROM ft_fulfillment_outbounds WHERE box_info_id = v_box.box_info_id ORDER BY id LOOP
    v_back := v_back + COALESCE((ft_storage_unpick_outbound(v_out, p_operator_name)->>'returned')::int, 0);
  END LOOP;
  -- 꺼내기 핵심이 만든 행은 전부 PICK 링크가 있다 — 남았다면 재고로 못 돌린 행
  IF EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = v_box.box_info_id) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_EMPTY';
  END IF;

  UPDATE ft_wow_items SET picked_qty = NULL, outbound_id = NULL, picked_at = NULL WHERE wow_box_id = p_wow_box_id;
  UPDATE ft_wow_boxes SET box_info_id = NULL, picked_at = NULL, picked_by = NULL, updated_at = now() WHERE id = p_wow_box_id;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('returned', v_back);
END;
$$;

-- ============================================================
-- 4) 권한
-- ============================================================
REVOKE ALL ON FUNCTION public.ft_wow_ready_set(uuid[], boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_wow_ready_set(uuid[], boolean, text) TO service_role;
-- ft_wow_unpack 의 권한은 005 그대로 (CREATE OR REPLACE 는 권한을 유지한다)

-- ── 확인 ──
-- SELECT count(*) FILTER (WHERE ready_at IS NOT NULL) AS ready, count(*) AS total FROM public.ft_wow_boxes;

-- ── 롤백 ── (ft_wow_unpack 은 005 의 15) 를 다시 실행)
-- DROP FUNCTION IF EXISTS public.ft_wow_ready_set(uuid[], boolean, text);
-- ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_ready_chk;
-- ALTER TABLE public.ft_wow_boxes DROP COLUMN IF EXISTS ready_at, DROP COLUMN IF EXISTS ready_by;

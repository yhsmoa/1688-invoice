-- ============================================================
-- 와우출고 단계 — 신규 → 작업중 → 작업완료 → 서류준비 → 출고
--   화면: /storage/wow (단계 탭 + 표) · 앞 단계: supabase/storage/005_wow.sql
--
-- 단계는 저장하지 않고 박스(ft_wow_boxes)의 기록에서 읽어 낸다 (005 와 같은 원칙).
--   판정은 한 곳: app/storage/utils/wowStage.ts
--
--   신규      담지 않았고(box_info_id NULL) 작업 시작 기록 없음   — 로켓 발주서가 도착한 상태
--   작업중    담지 않았고 작업 시작 기록 있음                     — [작업] 버튼
--   작업완료  담았고(box_info_id) 서류 2종이 아직 다 오지 않음    — [작업완료] = 005 의 담기(ft_wow_pick)
--   서류준비  담았고 부착문서 · 동봉문서가 둘 다 도착              — 로켓이 ft_wow_doc_set 으로 올린다
--   출고      묶인 1688 박스의 포장 행이 전부 출고됨              — 쉽먼트 V2 에서 출고하면 자동
--
-- 새로 저장하는 것은 "작업 시작" 하나뿐 (work_started_at · work_started_by).
--   · [작업]         ft_wow_work_start   신규 → 작업중
--   · [작업 취소]    ft_wow_work_cancel  작업중 → 신규
--   · [작업완료 취소] = 005 의 ft_wow_unpack (그대로) — 시작 기록은 남으므로 작업중으로 돌아간다
--   · 담은 박스는 항상 시작 기록이 있다: ft_wow_pick 이 없으면 채우고(CHECK 로 강제),
--     이미 담겨 있던 박스는 담은 시각 · 담은 사람으로 채운다(백필)
--
-- 로켓 동기화(ft_wow_sync_order)는 그대로다. 작업중인 박스도 담기 전이라 로켓이 줄을 바꾸거나
--   박스를 뺄 수 있다 — 줄이 바뀌면 [작업완료] 가 WOW_INVALID_INPUT 으로 거절되고 새로고침하게 된다.
--   박스가 남아 있으면 작업 시작 기록은 유지된다 (동기화는 이 두 칼럼을 건드리지 않는다).
--
-- 잠금: 발주서 잠금 하나 (ft_wow_lock 에 상품 없이) — 재고를 건드리지 않아 상품 잠금은 필요 없다.
-- 권한: 1688-invoice(service role) 전용
-- 오류: WOW_BOX_NOT_FOUND / WOW_BOX_ALREADY_PICKED / WOW_WORK_ALREADY_STARTED / WOW_WORK_NOT_STARTED
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-19)
-- ============================================================

-- ============================================================
-- 1) 작업 시작 기록
-- ============================================================
ALTER TABLE public.ft_wow_boxes
  ADD COLUMN IF NOT EXISTS work_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_started_by text;

COMMENT ON COLUMN public.ft_wow_boxes.work_started_at IS
  '[작업] 을 누른 시각. NULL = 신규(담기 전) — 담은 박스는 항상 값이 있다';
COMMENT ON COLUMN public.ft_wow_boxes.work_started_by IS
  '[작업] 을 누른 담당자';

-- ============================================================
-- 2) [작업] — 신규 → 작업중
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_work_start(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box ft_wow_boxes%ROWTYPE;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;

  PERFORM ft_wow_lock(p_user_id, v_box.order_number, '{}'::uuid[]);

  -- ── 잠금 뒤 다시 읽기 (로켓 동기화 · 다른 창의 작업/담기와 겨룬다) ──
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.box_info_id IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;
  IF v_box.work_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_WORK_ALREADY_STARTED';
  END IF;

  UPDATE ft_wow_boxes
     SET work_started_at = now(), work_started_by = p_operator_name, updated_at = now()
   WHERE id = p_wow_box_id;

  RETURN jsonb_build_object('work_started_at', now());
END;
$$;

-- ============================================================
-- 3) [작업 취소] — 작업중 → 신규 (담은 박스는 [작업완료 취소] 부터)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_work_cancel(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box ft_wow_boxes%ROWTYPE;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;

  PERFORM ft_wow_lock(p_user_id, v_box.order_number, '{}'::uuid[]);

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.box_info_id IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;
  IF v_box.work_started_at IS NULL THEN
    RAISE EXCEPTION 'WOW_WORK_NOT_STARTED';
  END IF;

  UPDATE ft_wow_boxes
     SET work_started_at = NULL, work_started_by = NULL, updated_at = now()
   WHERE id = p_wow_box_id;

  RETURN jsonb_build_object('cancelled', true);
END;
$$;

-- ============================================================
-- 4) 와우 담기(= [작업완료]) — 005 의 14) 와 같고, 박스에 작업 시작 기록을 채우는 것만 다르다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_pick(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_box_info_id   uuid,
  p_lines         jsonb,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box     ft_wow_boxes%ROWTYPE;
  v_bi      ft_box_info%ROWTYPE;
  v_line    record;
  v_qty     int;
  v_total   int := 0;
  v_item_id uuid;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(p_user_id, v_box.order_number,
                      ARRAY(SELECT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id));

  -- ── 잠금 뒤 다시 읽기 (로켓 동기화 · 다른 창의 담기와 겨룬다) ──
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.box_info_id IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;

  -- ── 1688 박스: 그 사업자 · 미출고 · 포장 행이 한 번도 없음 · 합배송과 무관 ──
  SELECT * INTO v_bi FROM ft_box_info WHERE id = p_box_info_id FOR UPDATE;
  IF NOT FOUND
     OR v_bi.user_id IS DISTINCT FROM p_user_id
     OR v_bi.shipment_id IS NOT NULL
     OR v_bi.master_box_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM ft_box_info WHERE master_box_id = p_box_info_id)
     OR EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = p_box_info_id)
     OR EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = p_box_info_id) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_EMPTY';
  END IF;

  -- ── 줄 목록 = 이 박스의 줄 전부, 한 번씩 ──
  IF jsonb_typeof(COALESCE(p_lines, 'null')) <> 'array'
     OR (SELECT count(*) FROM jsonb_array_elements(p_lines)) <> (SELECT count(*) FROM ft_wow_items WHERE wow_box_id = p_wow_box_id)
     OR EXISTS (SELECT 1 FROM ft_wow_items i WHERE i.wow_box_id = p_wow_box_id
                 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e WHERE e->>'item_id' = i.id::text)) THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  -- [작업] 을 거치지 않고 담아도 작업 시작 기록을 남긴다 → 담은 박스는 항상 시작 기록이 있다
  UPDATE ft_wow_boxes
     SET box_info_id = p_box_info_id, picked_at = now(), picked_by = p_operator_name,
         work_started_at = COALESCE(work_started_at, now()),
         work_started_by = COALESCE(work_started_by, p_operator_name),
         updated_at = now()
   WHERE id = p_wow_box_id;

  FOR v_line IN
    SELECT i.id, i.product_id, i.qty, COALESCE(e->'picks', '[]') AS picks
      FROM ft_wow_items i
      JOIN jsonb_array_elements(p_lines) e ON e->>'item_id' = i.id::text
     WHERE i.wow_box_id = p_wow_box_id
     ORDER BY i.product_id
  LOOP
    SELECT COALESCE(SUM((p->>'qty')::int), 0) INTO v_qty FROM jsonb_array_elements(v_line.picks) p;
    IF v_qty < 0 OR v_qty > v_line.qty THEN
      RAISE EXCEPTION 'WOW_PICK_OVER';
    END IF;

    v_result := NULL;
    IF v_qty > 0 THEN
      SELECT id INTO v_item_id FROM ft_order_items
       WHERE user_id = p_user_id AND product_id = v_line.product_id
         AND arrival_route = 'STOCK' AND status IS DISTINCT FROM 'DONE'
       ORDER BY set_seq NULLS FIRST, item_no LIMIT 1;
      v_result := ft_storage_pick_core(p_user_id, v_line.product_id, v_item_id, v_line.picks, p_box_info_id,
                                       p_operator_name, false, 'DIRECT', NULL, NULL);
    END IF;

    UPDATE ft_wow_items
       SET picked_qty = v_qty, outbound_id = (v_result->>'outbound_id')::uuid, picked_at = now()
     WHERE id = v_line.id;
    v_total := v_total + v_qty;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'WOW_PICK_EMPTY';
  END IF;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('box_code', v_bi.box_code, 'picked', v_total);
END;
$$;

-- ============================================================
-- 5) 이미 담겨 있던 박스 — 담은 시각 · 담은 사람을 작업 시작 기록으로 (백필)
-- ============================================================
UPDATE public.ft_wow_boxes
   SET work_started_at = COALESCE(picked_at, updated_at),
       work_started_by = picked_by
 WHERE box_info_id IS NOT NULL
   AND work_started_at IS NULL;

-- ============================================================
-- 6) 담은 박스는 항상 작업 시작 기록이 있다
--   (작업완료를 취소하면 작업중으로 돌아간다 — 신규로 건너뛰지 않는다)
-- ============================================================
ALTER TABLE public.ft_wow_boxes
  DROP CONSTRAINT IF EXISTS ft_wow_boxes_picked_started_chk;
ALTER TABLE public.ft_wow_boxes
  ADD CONSTRAINT ft_wow_boxes_picked_started_chk
  CHECK (box_info_id IS NULL OR work_started_at IS NOT NULL);

-- ============================================================
-- 7) 권한
-- ============================================================
REVOKE ALL ON FUNCTION public.ft_wow_work_start(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_work_cancel(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_wow_work_start(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_work_cancel(uuid, uuid, text) TO service_role;
-- ft_wow_pick 의 권한은 005 그대로 (CREATE OR REPLACE 는 권한을 유지한다)

-- ── 확인 ──
-- SELECT count(*) FILTER (WHERE box_info_id IS NULL AND work_started_at IS NULL) AS new,
--        count(*) FILTER (WHERE box_info_id IS NULL AND work_started_at IS NOT NULL) AS working,
--        count(*) FILTER (WHERE box_info_id IS NOT NULL) AS picked
--   FROM public.ft_wow_boxes;

-- ── 롤백 ── (ft_wow_pick 은 005 의 14) 를 다시 실행)
-- ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_picked_started_chk;
-- DROP FUNCTION IF EXISTS public.ft_wow_work_start(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.ft_wow_work_cancel(uuid, uuid, text);
-- ALTER TABLE public.ft_wow_boxes DROP COLUMN IF EXISTS work_started_at, DROP COLUMN IF EXISTS work_started_by;

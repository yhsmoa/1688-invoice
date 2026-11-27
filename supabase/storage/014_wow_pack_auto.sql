-- ============================================================
-- 와우출고 — [출고준비완료] 가 마대에 담지 않은 박스를 알아서 "박스 하나 = 마킹 상자 하나" 로 넘긴다
--   앞 단계: supabase/storage/010_wow_flow.sql · supabase/shipment/004_shipment_work.sql
--
-- 바꾸는 까닭
--   합포장 탭에서 박스마다 [새 마대] 아니면 [그대로 출고] 를 골라야 [출고준비완료] 를 누를 수 있었다.
--   마대에 담지 않은 박스는 어차피 그대로 나가므로 "그대로 출고" 를 고르는 단계가 헷갈리기만 했다.
--   → 합포장 탭에서는 마대에 담을 박스만 고른다. 고르지 않은 박스는 [출고준비완료] 때 그대로 나간다.
--
-- 바뀌는 것 (ft_wow_ready_pack 하나)
--   · 대상: 부착완료한 출고준비 전 박스 (전에는 마대 · 그대로 출고를 정한 박스만)
--   · 마대에 담지 않았고 아직 정하지 않은 박스는 여기서 정한 것으로 기록한다 (packed_at · packed_by)
--     — 그 뒤는 전과 같다: [출고준비 취소] 하면 합포장 탭에 마킹번호가 붙은 채 남고, [합포장 취소] 로 마킹번호를 푼다
--   나머지(마대는 통째로 · 마킹번호 붙이는 순서 · 쉽먼트 작업 중이면 거절)는 그대로다.
--   전의 화면(정한 박스만 보내는 버전)이 불러도 결과가 같다 — 이 스크립트를 먼저 적용해도 된다.
--
-- 오류: WOW_NOT_PACKED = 부착완료 전이거나 이미 출고준비된 박스가 섞임 (뜻이 넓어졌다)
--
-- 적용: 2026-11-27 (운영 DB mkcxpkblohioqboemmah) — 같은 트랜잭션에서 자체 시험(마대 2박스 + 정하지 않은 1박스를 같이 출고준비 →
--   마킹 상자 2개, 정하지 않은 박스만 출고준비, 출고준비 취소 뒤 합포장 취소, 부착완료 전 · 이미 출고준비된 박스 거절)을
--   돌려 통과한 뒤 확정했다 (시험 변경은 전부 되돌림)
-- ============================================================

CREATE OR REPLACE FUNCTION public.ft_wow_ready_pack(
  p_wow_box_ids   uuid[],
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids       uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_user      uuid;
  v_user_code text;
  v_group     record;
  v_cartons   uuid[];
  v_carton    uuid;
  v_code      text;
  v_no        int;
  v_out       jsonb := '[]';
BEGIN
  IF COALESCE(cardinality(v_ids), 0) = 0
     OR (SELECT count(DISTINCT user_id) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> 1 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  SELECT DISTINCT user_id INTO v_user FROM ft_wow_boxes WHERE id = ANY (v_ids);
  SELECT NULLIF(trim(user_code), '') INTO v_user_code FROM ft_users WHERE id = v_user;
  IF v_user_code IS NULL THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_wow_pack:' || v_user::text));
  PERFORM ft_wow_lock_boxes(v_ids);
  -- 쉽먼트 작업 중이면 출고 대기 목록에 넣을 수 없다 (SHIPMENT_WORK_LOCKED)
  PERFORM ft_shipment_work_assert_closed(v_user);

  -- 부착완료한 출고준비 전 박스만 (마대 · 그대로 출고를 미리 정했는지는 묻지 않는다 — 014_wow_pack_auto.sql)
  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND (attached_at IS NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_NOT_PACKED';
  END IF;
  -- 마대는 통째로: 같은 마대에 아직 출고준비 전인 박스가 남으면 거절 (먼저 출고준비된 박스는 이미 그 마대 상자에 묶여 있다)
  IF EXISTS (SELECT 1 FROM ft_wow_boxes b
              WHERE b.bag_id IN (SELECT bag_id FROM ft_wow_boxes WHERE id = ANY (v_ids) AND bag_id IS NOT NULL)
                AND b.ready_at IS NULL AND b.id <> ALL (v_ids)) THEN
    RAISE EXCEPTION 'WOW_BAG_PARTIAL';
  END IF;

  -- 마대에 담지 않았고 아직 정하지 않은 박스 = 그대로 나간다 (박스 하나 = 마킹 상자 하나). 여기서 정한 것으로 기록한다
  UPDATE ft_wow_boxes
     SET packed_at = now(), packed_by = p_operator_name, updated_at = now()
   WHERE id = ANY (v_ids) AND packed_at IS NULL;

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_group IN
    SELECT array_agg(b.id) AS ids, MIN(b.bag_id::text)::uuid AS bag_id
      FROM ft_wow_boxes b
     WHERE b.id = ANY (v_ids)
     GROUP BY COALESCE(b.bag_id, b.id)
     ORDER BY MIN(b.ship_seq), MIN(b.id::text)
  LOOP
    -- 이미 있는 마킹 상자 = 묶음 안 박스의 상자 + 같은 마대에서 먼저 출고준비된 박스의 상자
    v_cartons := ARRAY(SELECT DISTINCT m.box_info_id FROM ft_wow_boxes m
                        WHERE m.box_info_id IS NOT NULL
                          AND (m.id = ANY (v_group.ids) OR m.bag_id = v_group.bag_id));
    IF cardinality(v_cartons) > 1 THEN
      RAISE EXCEPTION 'WOW_INVALID_INPUT';
    END IF;

    IF cardinality(v_cartons) = 1 THEN
      v_carton := v_cartons[1];
      SELECT box_code INTO v_code FROM ft_box_info WHERE id = v_carton;
    ELSE
      -- 번호 칸(no)은 글자다 — 숫자만 읽는다. 같은 코드의 출고 전 박스가 있으면 건너뛴다
      SELECT COALESCE(MAX(NULLIF(regexp_replace(COALESCE(no, ''), '\D', '', 'g'), '')::int), 0) INTO v_no
        FROM ft_box_info
       WHERE user_id = v_user AND type = 'X' AND shipment_id IS NULL;
      LOOP
        v_no   := v_no + 1;
        v_code := v_user_code || '-X-' || lpad(v_no::text, 2, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM ft_box_info WHERE user_id = v_user AND box_code = v_code AND shipment_id IS NULL);
      END LOOP;
      INSERT INTO ft_box_info (user_code, box_code, type, no, status, user_id)
      VALUES (v_user_code, v_code, 'X', lpad(v_no::text, 2, '0'), 'PACKING', v_user)
      RETURNING id INTO v_carton;
    END IF;

    UPDATE ft_fulfillment_outbounds
       SET box_info_id = v_carton, box_code = v_code
     WHERE id IN (SELECT outbound_id FROM ft_wow_items WHERE wow_box_id = ANY (v_group.ids) AND outbound_id IS NOT NULL)
       AND box_info_id IS DISTINCT FROM v_carton;

    UPDATE ft_wow_boxes
       SET box_info_id = v_carton, ready_at = now(), ready_by = p_operator_name, updated_at = now()
     WHERE id = ANY (v_group.ids);

    v_out := v_out || jsonb_build_object('box_code', v_code, 'boxes', cardinality(v_group.ids));
  END LOOP;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('count', cardinality(v_ids), 'cartons', v_out);
END;
$$;

-- ── 롤백 ──
--   supabase/shipment/004_shipment_work.sql 의 ft_wow_ready_pack 을 다시 실행

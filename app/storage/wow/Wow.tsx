'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import ProductCell from '../components/ProductCell';
import WowPickModal from '../components/WowPickModal';
import WowStageTabs from '../components/WowStageTabs';
import WowTable, { type WowBox } from '../components/WowTable';
import type { WowLine, WowStage } from '../types';
import { playErrorSound } from '../utils/storageFormat';
import { WOW_STAGES, wowStageOf } from '../utils/wowStage';
import './Wow.css';

// ============================================================
// [와우출고] — 로켓 발주서의 위해 창고 박스(발주번호-박스번호)에 담을 상품 · 수량
//
//   단계 탭 [신규] › [작업중] › [작업완료] › [서류준비] › [출고] + 그 단계의 박스 표
//     신규      로켓 발주서가 도착한 상태                         [작업] → 작업중
//     작업중    위치를 보고 상품을 찾는 중                        [작업완료] → 확인 창(담은 박스 · 수량) → 작업완료
//                                                               [작업 취소] → 신규
//     작업완료  상품을 박스에 담음 (재고에서 빠짐)                 [작업완료 취소] → 작업중 (출고 전에만)
//     서류준비  작업완료 + 부착문서 · 동봉문서가 둘 다 도착        (로켓이 올리면 자동)
//     출고      쉽먼트 V2 에서 박스를 출고하면 자동 — 출고 후 WOW_SHIPPED_VISIBLE_DAYS 일 동안 보인다
//   단계 판정은 utils/wowStage.ts 한 곳 (API 가 줄마다 계산해 준다)
//   박스 미정: 배정만 되고 박스가 정해지지 않은 줄 — 예약은 되지만 작업할 수 없다 ([신규] 탭 아래)
// ============================================================

type BoxAction = 'start' | 'cancel' | 'unpack';

/** 버튼을 누른 뒤 박스가 옮겨 가는 단계 (안내 문구용) */
const NEXT_STAGE: Record<BoxAction, WowStage> = { start: 'working', cancel: 'new', unpack: 'working' };

const boxLabel = (box: WowBox) => `${box.lines[0].order_number}-${box.lines[0].box_no}`;

const Wow: React.FC = () => {
  const { t } = useTranslation();
  const { tab, wow, stock, worker, userCodeOf, reloadAll } = useStorage();
  const [stage, setStage] = useState<WowStage>('new');
  const [pickBox, setPickBox] = useState<WowBox | null>(null);
  const [busyBox, setBusyBox] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // ── 박스별 묶음 (API 가 발주번호 · 박스번호 순으로 준다) + 박스 미정 줄 ──
  const { boxes, unboxed } = useMemo(() => {
    const map = new Map<string, WowBox>();
    const rest: WowLine[] = [];
    for (const l of wow.rows) {
      if (!l.box_id) { rest.push(l); continue; }
      const b = map.get(l.box_id) ?? { id: l.box_id, stage: l.stage, lines: [] };
      b.lines.push(l);
      map.set(l.box_id, b);
    }
    return { boxes: Array.from(map.values()), unboxed: rest };
  }, [wow.rows]);

  // ── 단계별 박스 수 · 지금 탭의 박스 ──
  const counts = useMemo(() => {
    const c = Object.fromEntries(WOW_STAGES.map((s) => [s, 0])) as Record<WowStage, number>;
    for (const b of boxes) c[b.stage] += 1;
    return c;
  }, [boxes]);
  const stageBoxes = useMemo(() => boxes.filter((b) => b.stage === stage), [boxes, stage]);

  const movedMessage = useCallback((box: WowBox, next: WowStage) => ({
    kind: 'ok' as const,
    text: t('storage.wow.moved', { box: boxLabel(box), stage: t(`storage.wow.stage.${next}`) }),
  }), [t]);

  // ============================================================
  // [작업] · [작업 취소] · [작업완료 취소] — 박스 하나의 단계를 옮긴다
  // ============================================================
  const postAction = useCallback(async (box: WowBox, action: BoxAction) => {
    const head = box.lines[0];
    if (!worker) { setMessage({ kind: 'error', text: t('storage.needWorker') }); return; }
    setBusyBox(box.id);
    try {
      const res = await fetch('/api/ft/storage/wow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, user_id: head.user_id, wow_box_id: box.id, operator_name: worker }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || t('storage.wow.error'));
      setMessage(movedMessage(box, NEXT_STAGE[action]));
      reloadAll();
    } catch (err) {
      console.error('와우출고 처리 오류:', err);
      playErrorSound();
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : t('storage.wow.error') });
      // 다른 창에서 이미 단계가 바뀌었을 수 있다 → 최신 상태로 다시 읽는다
      reloadAll();
    } finally {
      setBusyBox('');
    }
  }, [worker, reloadAll, movedMessage, t]);

  const handleStart = useCallback((box: WowBox) => postAction(box, 'start'), [postAction]);

  const handleCancelStart = useCallback((box: WowBox) => {
    if (!window.confirm(t('storage.wow.cancelStartConfirm', { box: boxLabel(box) }))) return;
    postAction(box, 'cancel');
  }, [postAction, t]);

  const handleUncomplete = useCallback((box: WowBox) => {
    if (!window.confirm(t('storage.wow.uncompleteConfirm', { box: boxLabel(box) }))) return;
    postAction(box, 'unpack');
  }, [postAction, t]);

  // ── [작업완료] — 확인 창에서 담은 박스 · 수량을 정한 뒤 저장 ──
  const handleComplete = useCallback((box: WowBox) => {
    if (!worker) { setMessage({ kind: 'error', text: t('storage.needWorker') }); return; }
    setPickBox(box);
  }, [worker, t]);

  const handlePickClose = useCallback((changed: boolean) => {
    if (changed && pickBox) {
      // 서류가 먼저 와 있던 박스는 작업완료를 건너 바로 서류준비로 간다
      const next = wowStageOf({ ...pickBox.lines[0], box_info_id: 'picked', shipped: false });
      setMessage(movedMessage(pickBox, next));
    }
    setPickBox(null);
  }, [pickBox, movedMessage]);

  // ============================================================
  // 렌더
  // ============================================================
  if (wow.loadError) return <div className="storage-empty is-error">{t('storage.loadError')}</div>;
  if (wow.loading && wow.rows.length === 0) return <div className="storage-empty">{t('storage.loading')}</div>;

  const showUnboxed = stage === 'new' && unboxed.length > 0;

  return (
    <section className="wow-page">
      <WowStageTabs stage={stage} counts={counts} onChange={setStage} />

      {message && <div className={`wow-message is-${message.kind}`} role="status">{message.text}</div>}

      {/* ── 이 단계의 박스 ── */}
      {stageBoxes.length > 0 && (
        <WowTable
          boxes={stageBoxes}
          stage={stage}
          showUser={!tab}
          userCodeOf={userCodeOf}
          stockRows={stock.rows}
          busyBoxId={busyBox}
          onStart={handleStart}
          onCancelStart={handleCancelStart}
          onComplete={handleComplete}
          onUncomplete={handleUncomplete}
        />
      )}
      {stageBoxes.length === 0 && !showUnboxed && (
        <div className="wow-empty">
          {wow.rows.length === 0
            ? t('storage.wow.empty')
            : t('storage.wow.stageEmpty', { stage: t(`storage.wow.stage.${stage}`) })}
        </div>
      )}

      {/* ── 박스 미정 ([신규] 탭) ── */}
      {showUnboxed && (
        <section className="wow-box is-unboxed">
          <header className="wow-box-head">
            <strong className="wow-box-code">{t('storage.wow.unboxed')}</strong>
            <span className="wow-muted">{t('storage.wow.unboxedHint')}</span>
          </header>
          <table className="wow-lines">
            <thead>
              <tr>
                <th className="col-order">{t('storage.wow.order')}</th>
                <th>{t('storage.col.product')}</th>
                <th className="col-qty">{t('storage.wow.requested')}</th>
              </tr>
            </thead>
            <tbody>
              {unboxed.map((l) => (
                <tr key={l.item_id}>
                  <td className="col-order">
                    {!tab && <span className="wow-user">{userCodeOf(l.user_id)}</span>}
                    {l.order_number}
                  </td>
                  <td><ProductCell info={l} /></td>
                  <td className="col-qty">{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {pickBox && <WowPickModal lines={pickBox.lines} onClose={handlePickClose} />}
    </section>
  );
};

export default Wow;

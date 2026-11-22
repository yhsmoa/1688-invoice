'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import ProductCell from '../components/ProductCell';
import WowPickModal from '../components/WowPickModal';
import WowStageTabs from '../components/WowStageTabs';
import WowTable, { type WowBox } from '../components/WowTable';
import WowToolbar, { type WowDocKind, type WowTool } from '../components/WowToolbar';
import type { WowLine, WowStage } from '../types';
import { playErrorSound } from '../utils/storageFormat';
import { WOW_STAGES, wowStageOf } from '../utils/wowStage';
import './Wow.css';

// ============================================================
// [와우출고] — 로켓 발주서의 위해 창고 박스(발주번호-박스번호)에 담을 상품 · 수량
//
//   단계 탭 [신규] › [작업중] › [작업완료] › [서류준비] › [출고준비] › [출고] + 그 단계의 박스 목록
//     신규      로켓 발주서가 도착한 상태                         [작업] → 작업중
//     작업중    위치를 보고 상품을 찾는 중                        [작업완료] → 확인 창(담은 박스 · 수량) → 작업완료
//                                                               [작업 취소] → 신규
//     작업완료  상품을 박스에 담음 (재고에서 빠짐)                 [작업완료 취소] → 작업중
//     서류준비  작업완료 + 부착문서 · 동봉문서가 둘 다 도착        (로켓이 올리면 자동) [출고준비완료] → 출고준비
//     출고준비  서류를 붙이고 넣어 출고할 수 있는 박스             [출고준비 취소] → 서류준비
//                                                               이때부터 쉽먼트 V2 출고 대기 목록에 보인다
//     출고      쉽먼트 V2 에서 박스를 출고하면 자동 — 출고 후 WOW_SHIPPED_VISIBLE_DAYS 일 동안 보인다
//   단계 판정은 utils/wowStage.ts 한 곳 (API 가 줄마다 계산해 준다)
//   박스는 요약 한 줄로 보이고 누르면 상품 표가 펼쳐진다. 체크한 박스가 표 위 버튼의 대상이다 (WowToolbar)
//     [부착문서] · [동봉문서]  체크한 박스(없으면 지금 보이는 박스 전부)의 서류를 박스 순서대로 한 PDF 로
//     [택배엑셀] · [출고준비완료]  서류준비 탭 — 체크한 박스
//   박스 미정: 배정만 되고 박스가 정해지지 않은 줄 — 예약은 되지만 작업할 수 없다 ([신규] 탭 아래)
// ============================================================

type BoxAction = 'start' | 'cancel' | 'unpack';
type Message = { kind: 'ok' | 'error'; text: string };

/** 버튼을 누른 뒤 박스가 옮겨 가는 단계 (안내 문구용) */
const NEXT_STAGE: Record<BoxAction, WowStage> = { start: 'working', cancel: 'new', unpack: 'working' };

const boxLabel = (box: WowBox) => `${box.lines[0].order_number}-${box.lines[0].box_no}`;

/** 파일 이름용 시각 'YYYYMMDDHHmm' (이 PC 시각) */
const fileStamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
};

/** 집합에 id 를 넣거나 뺀 새 집합 */
const toggled = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

/** POST 응답으로 온 파일을 내려받는다. 실패하면 서버 문구(없으면 fallback)로 throw */
async function downloadPost(url: string, body: unknown, filename: string, fallback: string) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || fallback);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

const Wow: React.FC = () => {
  const { t } = useTranslation();
  const { tab, wow, stock, worker, ftUsers, userCodeOf, reloadAll } = useStorage();
  const [stage, setStage] = useState<WowStage>('new');
  const [pickBox, setPickBox] = useState<WowBox | null>(null);
  const [busyBox, setBusyBox] = useState('');
  const [busyTool, setBusyTool] = useState<WowTool | ''>('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<Message | null>(null);

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

  // ── 단계별 박스 수 · 지금 탭의 박스 · 그중 체크한 박스 (표 순서) ──
  const counts = useMemo(() => {
    const c = Object.fromEntries(WOW_STAGES.map((s) => [s, 0])) as Record<WowStage, number>;
    for (const b of boxes) c[b.stage] += 1;
    return c;
  }, [boxes]);
  const stageBoxes = useMemo(() => boxes.filter((b) => b.stage === stage), [boxes, stage]);
  const checkedBoxes = useMemo(() => stageBoxes.filter((b) => checked.has(b.id)), [stageBoxes, checked]);
  // ── 서류 받기 대상(체크한 박스, 없으면 지금 보이는 박스 전부) 중 서류가 도착한 박스 ──
  const docBoxIds = useMemo<Record<WowDocKind, string[]>>(() => {
    const target = checkedBoxes.length > 0 ? checkedBoxes : stageBoxes;
    return {
      label: target.filter((b) => b.lines[0].label_path).map((b) => b.id),
      manifest: target.filter((b) => b.lines[0].manifest_path).map((b) => b.id),
    };
  }, [checkedBoxes, stageBoxes]);
  const allExpanded = stageBoxes.length > 0 && stageBoxes.every((b) => expanded.has(b.id));

  const fail = useCallback((err: unknown, label: string) => {
    console.error(label, err);
    playErrorSound();
    setMessage({ kind: 'error', text: err instanceof Error ? err.message : t('storage.wow.error') });
  }, [t]);

  const movedMessage = useCallback((list: WowBox[], next: WowStage): Message => {
    const stageName = t(`storage.wow.stage.${next}`);
    return {
      kind: 'ok',
      text: list.length === 1
        ? t('storage.wow.moved', { box: boxLabel(list[0]), stage: stageName })
        : t('storage.wow.movedMany', { count: list.length, stage: stageName }),
    };
  }, [t]);

  // ── 탭을 옮기면 체크는 비운다 (체크는 지금 보이는 박스에만 뜻이 있다) ──
  const handleStage = useCallback((next: WowStage) => {
    setStage(next);
    setChecked(new Set());
  }, []);

  const handleToggleCheck = useCallback((id: string) => setChecked((prev) => toggled(prev, id)), []);
  const handleToggleExpand = useCallback((id: string) => setExpanded((prev) => toggled(prev, id)), []);
  const handleToggleAll = useCallback(() => {
    setChecked(checkedBoxes.length === stageBoxes.length ? new Set() : new Set(stageBoxes.map((b) => b.id)));
  }, [checkedBoxes, stageBoxes]);
  const handleToggleExpandAll = useCallback(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const b of stageBoxes) { if (allExpanded) next.delete(b.id); else next.add(b.id); }
      return next;
    });
  }, [stageBoxes, allExpanded]);

  // ============================================================
  // 단계를 옮기는 요청 — 성공하면 안내 문구, 실패하면 오류 문구. 어느 쪽이든 최신 상태로 다시 읽는다
  //   (다른 창에서 이미 단계가 바뀌었을 수 있다)
  // ============================================================
  const runAction = useCallback(async (body: Record<string, unknown>, done: Message): Promise<boolean> => {
    if (!worker) { setMessage({ kind: 'error', text: t('storage.needWorker') }); return false; }
    try {
      const res = await fetch('/api/ft/storage/wow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operator_name: worker }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || t('storage.wow.error'));
      setMessage(done);
      reloadAll();
      return true;
    } catch (err) {
      fail(err, '와우출고 처리 오류:');
      reloadAll();
      return false;
    }
  }, [worker, reloadAll, fail, t]);

  // ── [작업] · [작업 취소] · [작업완료 취소] — 박스 하나 ──
  const postAction = useCallback(async (box: WowBox, action: BoxAction) => {
    setBusyBox(box.id);
    await runAction({ action, user_id: box.lines[0].user_id, wow_box_id: box.id }, movedMessage([box], NEXT_STAGE[action]));
    setBusyBox('');
  }, [runAction, movedMessage]);

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
      setMessage(movedMessage([pickBox], next));
    }
    setPickBox(null);
  }, [pickBox, movedMessage]);

  // ── [출고준비완료] · [출고준비 취소] — 박스 하나(카드의 버튼) 또는 체크한 박스들(표 위 버튼) ──
  const moveReady = useCallback(async (list: WowBox[], ready: boolean) => {
    const ok = await runAction(
      { action: ready ? 'ready' : 'unready', wow_box_ids: list.map((b) => b.id) },
      movedMessage(list, ready ? 'ready' : 'docs'));
    if (ok) setChecked(new Set());
  }, [runAction, movedMessage]);

  const moveReadyOne = useCallback(async (box: WowBox, ready: boolean) => {
    setBusyBox(box.id);
    await moveReady([box], ready);
    setBusyBox('');
  }, [moveReady]);

  const handleReady = useCallback((box: WowBox) => moveReadyOne(box, true), [moveReadyOne]);

  const handleUnready = useCallback((box: WowBox) => {
    if (!window.confirm(t('storage.wow.unreadyConfirm', { box: boxLabel(box) }))) return;
    moveReadyOne(box, false);
  }, [moveReadyOne, t]);

  const handleReadyChecked = useCallback(async () => {
    if (!window.confirm(t('storage.wow.readyConfirm', { count: checkedBoxes.length }))) return;
    setBusyTool('ready');
    await moveReady(checkedBoxes, true);
    setBusyTool('');
  }, [checkedBoxes, moveReady, t]);

  // ============================================================
  // 파일 받기 — [부착문서] · [동봉문서] (한 PDF) · [택배엑셀]
  // ============================================================
  const download = useCallback(async (tool: WowTool, url: string, body: unknown, filename: string) => {
    setBusyTool(tool);
    try {
      await downloadPost(url, body, filename, t('storage.wow.error'));
      setMessage(null);
    } catch (err) {
      fail(err, '와우출고 파일 받기 오류:');
    } finally {
      setBusyTool('');
    }
  }, [fail, t]);

  const handleDownloadDocs = useCallback((kind: WowDocKind) => download(
    kind, '/api/ft/storage/wow/docs', { box_ids: docBoxIds[kind], kind },
    `${t(`storage.wow.${kind}`)}_${t(`storage.wow.stage.${stage}`)}_${new Date().toLocaleDateString('sv-SE')}.pdf`,
  ), [download, docBoxIds, stage, t]);

  // 파일 이름: 사업자명_로켓와우_시각 (체크한 박스가 한 사업자의 것일 때만 사업자명을 붙인다)
  const handleDownloadCourier = useCallback(() => {
    const userIds = new Set(checkedBoxes.map((b) => b.lines[0].user_id));
    const user = userIds.size === 1 ? ftUsers.find((u) => userIds.has(u.id)) : undefined;
    const name = [user?.vender_name || user?.user_code, t('storage.wow.courierFile'), fileStamp()].filter(Boolean).join('_');
    return download('courier', '/api/ft/storage/wow/courier', { box_ids: checkedBoxes.map((b) => b.id) }, `${name}.xlsx`);
  }, [download, checkedBoxes, ftUsers, t]);

  // ============================================================
  // 렌더
  // ============================================================
  if (wow.loadError) return <div className="storage-empty is-error">{t('storage.loadError')}</div>;
  if (wow.loading && wow.rows.length === 0) return <div className="storage-empty">{t('storage.loading')}</div>;

  const showUnboxed = stage === 'new' && unboxed.length > 0;

  return (
    <section className="wow-page">
      <WowStageTabs stage={stage} counts={counts} onChange={handleStage} />

      {message && <div className={`wow-message is-${message.kind}`} role="status">{message.text}</div>}

      {/* ── 이 단계의 박스 ── */}
      {stageBoxes.length > 0 && (
        <>
          <WowToolbar
            stage={stage}
            total={stageBoxes.length}
            checkedCount={checkedBoxes.length}
            allExpanded={allExpanded}
            docCounts={{ label: docBoxIds.label.length, manifest: docBoxIds.manifest.length }}
            busy={busyTool}
            onToggleAll={handleToggleAll}
            onToggleExpandAll={handleToggleExpandAll}
            onDocs={handleDownloadDocs}
            onCourier={handleDownloadCourier}
            onReady={handleReadyChecked}
          />
          <WowTable
            boxes={stageBoxes}
            stage={stage}
            showUser={!tab}
            userCodeOf={userCodeOf}
            stockRows={stock.rows}
            busyBoxId={busyBox}
            checkedIds={checked}
            expandedIds={expanded}
            onToggleCheck={handleToggleCheck}
            onToggleExpand={handleToggleExpand}
            onStart={handleStart}
            onCancelStart={handleCancelStart}
            onComplete={handleComplete}
            onUncomplete={handleUncomplete}
            onReady={handleReady}
            onUnready={handleUnready}
          />
        </>
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

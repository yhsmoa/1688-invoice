'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadBoxLabelPdf, todayYYMMDD } from '../../../lib/boxLabelPdf';
import { useStorage } from '../hooks/StorageContext';
import ProductCell from '../components/ProductCell';
import WowPackModal, { type WowOpenBag, type WowPackTarget } from '../components/WowPackModal';
import WowSeqModal from '../components/WowSeqModal';
import WowStageTabs from '../components/WowStageTabs';
import WowTable, { type WowBox } from '../components/WowTable';
import WowToolbar, { type WowDocKind, type WowTool } from '../components/WowToolbar';
import type { WowLine, WowStage } from '../types';
import { playErrorSound } from '../utils/storageFormat';
import { printWowBoxLabels } from '../utils/printWowBoxLabels';
import { WOW_STAGES } from '../utils/wowStage';
import './Wow.css';

// ============================================================
// [와우출고] — 로켓 발주서의 위해 창고 박스(발주번호-박스번호)에 담을 상품 · 수량
//
//   단계 탭 [신규] › [작업중] › [작업완료] › [서류준비] › [순서지정] › [합포장] › [출고준비] › [출고]
//     신규      로켓 발주서가 도착                      [라벨출력] 박스 라벨(발주번호-박스번호)
//               — [라벨 설정] 의 '박스 라벨' 템플릿을 QZ Tray 로 바로 인쇄 (상품입고의 라벨 출력과 같은 방식)
//     작업중    모바일(/m/wow)에서 박스 라벨을 찍음      카드마다 찾음 · 부족     [작업 취소] → 신규
//     작업완료  모바일 [작업완료] (재고에서 빠짐)                                [작업완료 취소] → 작업중
//     서류준비  작업완료 + 부착문서 · 동봉문서 도착       (로켓이 올리면 자동)
//               [바로 출고준비] 이미 마킹번호가 있는 박스(옛 방식으로 담은 박스)는 순서지정 · 합포장 없이 출고준비로 보낸다
//     순서지정  [순서지정] 박스 라벨을 실을 순서대로 스캔  그 순서로 [부착문서] [동봉문서] [택배엑셀]   [초기화] → 서류준비
//               번호는 합포장 · 출고준비에 있는 박스 다음부터 이어진다 (1 ~ 4 가 있으면 5 부터)   [부착완료] → 합포장
//     합포장    [합포장] 마대에 같이 담을 박스 고르기      [합포장 취소] 마대에서 뺀다     [부착완료 취소] → 순서지정
//               마대에 담지 않은 박스는 따로 정하지 않는다 — [출고준비완료] 때 박스 그대로 나간다 (014_wow_pack_auto.sql)
//               정한 박스만 [출고준비완료] → 출고준비
//     출고준비  마킹번호가 붙는다 → [마킹라벨]            [출고준비 취소] → 합포장. 쉽먼트 V2 출고 대기 목록에 보인다
//     출고      쉽먼트 V2 에서 출고하면 자동 — 출고 후 WOW_SHIPPED_VISIBLE_DAYS 일 동안 보인다
//   출고 전 탭 어디서나
//     [라벨출력]  박스 라벨을 다시 뽑는다 (신규가 아닌 탭은 체크한 박스만)
//     [발주취소]  체크한 박스를 없앤다 — 잡아 둔 재고가 풀리고, 이미 꺼낸 상품은 재고 [작업중] 으로 돌아가 다시 배치한다
//                 (꺼낸 선반으로 되돌리지 않는다 · supabase/storage/012_wow_cancel.sql). 되돌릴 수 없다
//   단계 판정은 utils/wowStage.ts 한 곳 (API 가 줄마다 계산해 준다) · DB: supabase/storage/010_wow_flow.sql ~ 012_wow_cancel.sql
//   박스는 요약 한 줄로 보이고 누르면 상품 표가 펼쳐진다. 체크한 박스가 표 위 버튼의 대상이다 (WowToolbar)
//     — 체크가 없으면 그 탭의 박스 전부 ([합포장 취소] 만 체크한 박스가 꼭 있어야 한다)
//   박스 미정: 배정만 되고 박스가 정해지지 않은 줄 — 예약은 되지만 작업할 수 없다 ([신규] 탭 아래)
// ============================================================

type Message = { kind: 'ok' | 'error'; text: string };
/** 요청이 성공했을 때 띄울 문구 — 응답 값이 필요하면 함수로 준다 (없으면 띄우지 않는다) */
type ActionDone = Message | ((json: Record<string, unknown>) => Message) | null;

/** 표 위 버튼이 박스가 없어도 보여야 하는 탭 (다른 단계의 박스를 끌어오는 버튼이 있다) */
const PULL_STAGES: readonly WowStage[] = ['seq', 'pack'];

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

const BIG = Number.MAX_SAFE_INTEGER;
/** 순서지정 이후 탭의 박스 순서 — 찍은 순서 그대로 (순서가 없는 옛 박스는 뒤에, 마킹번호 순) */
const bySeq = (a: WowBox, b: WowBox) =>
  (a.lines[0].ship_seq ?? BIG) - (b.lines[0].ship_seq ?? BIG)
  || String(a.lines[0].box_code ?? '').localeCompare(String(b.lines[0].box_code ?? ''));
const STAGE_ORDER: Partial<Record<WowStage, (a: WowBox, b: WowBox) => number>> = { seq: bySeq, pack: bySeq, ready: bySeq };

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
  const { tab, wow, worker, ftUsers, userCodeOf, reloadAll } = useStorage();
  const [stage, setStage] = useState<WowStage>('new');
  const [modal, setModal] = useState<'seq' | 'pack' | null>(null);
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

  // ── 단계별 박스 (탭 안의 순서로) · 박스 수 ──
  const byStage = useMemo(() => {
    const out = Object.fromEntries(WOW_STAGES.map((s) => [s, [] as WowBox[]])) as Record<WowStage, WowBox[]>;
    for (const b of boxes) out[b.stage].push(b);
    for (const s of WOW_STAGES) { const order = STAGE_ORDER[s]; if (order) out[s].sort(order); }
    return out;
  }, [boxes]);
  const counts = useMemo(
    () => Object.fromEntries(WOW_STAGES.map((s) => [s, byStage[s].length])) as Record<WowStage, number>,
    [byStage]);

  // ── 지금 탭의 박스 · 체크한 박스 · 버튼의 대상(체크한 박스, 없으면 탭의 박스 전부) ──
  const stageBoxes = byStage[stage];
  const checkedBoxes = useMemo(() => stageBoxes.filter((b) => checked.has(b.id)), [stageBoxes, checked]);
  const targetBoxes = checkedBoxes.length > 0 ? checkedBoxes : stageBoxes;
  const allExpanded = stageBoxes.length > 0 && stageBoxes.every((b) => expanded.has(b.id));

  // ── [순서지정] 창에서 찍을 수 있는 박스 · [합포장] 창에서 고를 수 있는 박스(아직 정하지 않음) · 더 담을 수 있는 마대 ──
  const seqCandidates = useMemo(() => [...byStage.docs, ...byStage.seq], [byStage]);
  //   이미 마킹번호가 붙은 박스(옛 방식으로 담은 박스 · 출고준비를 취소한 박스)는 마대에 담을 수 없다
  const packCandidates = useMemo(
    () => byStage.pack.filter((b) => !b.lines[0].packed_at && !b.lines[0].box_info_id), [byStage]);
  const openBags = useMemo<WowOpenBag[]>(() => {
    const map = new Map<string, WowOpenBag>();
    for (const b of byStage.pack) {
      const { bag_id, bag_no } = b.lines[0];
      if (!bag_id || bag_no === null) continue;
      const g = map.get(bag_id) ?? { id: bag_id, bag_no, count: 0 };
      g.count += 1;
      map.set(bag_id, g);
    }
    // 일부가 이미 출고준비된 마대에는 더 담을 수 없다
    for (const b of byStage.ready) { if (b.lines[0].bag_id) map.delete(b.lines[0].bag_id); }
    return Array.from(map.values()).sort((a, b) => a.bag_no - b.bag_no);
  }, [byStage]);

  // ── 버튼별 대상 ──
  //   라벨출력: 체크한 박스. 신규 탭은 체크가 없으면 아직 뽑지 않은 박스만 (같은 라벨을 두 번 뽑지 않게)
  //            그 밖의 탭은 다시 뽑는 용도라 체크한 박스만
  const boxLabelTargets = useMemo(() => {
    if (checkedBoxes.length > 0) return checkedBoxes;
    return stage === 'new' ? stageBoxes.filter((b) => !b.lines[0].label_printed_at) : [];
  }, [checkedBoxes, stageBoxes, stage]);
  const docBoxIds = useMemo<Record<WowDocKind, string[]>>(() => ({
    label: targetBoxes.filter((b) => b.lines[0].label_path).map((b) => b.id),
    manifest: targetBoxes.filter((b) => b.lines[0].manifest_path).map((b) => b.id),
  }), [targetBoxes]);
  //   바로 출고준비: 이미 마킹번호가 있는 박스만 (옛 방식으로 담은 박스 — 마킹번호를 새로 받을 필요가 없다)
  const hasCartonBoxes = useMemo(() => stageBoxes.some((b) => b.lines[0].box_info_id), [stageBoxes]);
  const readyDirectTargets = useMemo(() => targetBoxes.filter((b) => b.lines[0].box_info_id), [targetBoxes]);
  //   마킹라벨: 마킹 상자 하나에 한 장 (마대는 박스가 여럿이어도 한 장)
  const markingCodes = useMemo(
    () => Array.from(new Set(targetBoxes.map((b) => b.lines[0].box_code).filter((c): c is string => !!c))).sort(),
    [targetBoxes]);

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
  //   (다른 창 · 모바일에서 이미 단계가 바뀌었을 수 있다)
  // ============================================================
  const runAction = useCallback(async (body: Record<string, unknown>, done: ActionDone): Promise<boolean> => {
    if (!worker) { setMessage({ kind: 'error', text: t('storage.needWorker') }); return false; }
    try {
      const res = await fetch('/api/ft/storage/wow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operator_name: worker }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || t('storage.wow.error'));
      if (done) setMessage(typeof done === 'function' ? done(json) : done);
      reloadAll();
      return true;
    } catch (err) {
      fail(err, '와우출고 처리 오류:');
      reloadAll();
      return false;
    }
  }, [worker, reloadAll, fail, t]);

  /** 표 위 버튼 하나를 처리하는 동안 버튼들을 잠근다. 성공하면 체크를 비운다 */
  const runTool = useCallback(async (tool: WowTool, body: Record<string, unknown>, done: ActionDone) => {
    setBusyTool(tool);
    const ok = await runAction(body, done);
    setBusyTool('');
    if (ok) setChecked(new Set());
    return ok;
  }, [runAction]);

  // ── 줄의 되돌리기 버튼 — 박스 하나 ──
  const runBox = useCallback(async (box: WowBox, body: Record<string, unknown>, next: WowStage) => {
    setBusyBox(box.id);
    await runAction(body, movedMessage([box], next));
    setBusyBox('');
  }, [runAction, movedMessage]);

  const handleCancelStart = useCallback((box: WowBox) => {
    if (!window.confirm(t('storage.wow.cancelStartConfirm', { box: boxLabel(box) }))) return;
    runBox(box, { action: 'cancel', user_id: box.lines[0].user_id, wow_box_id: box.id }, 'new');
  }, [runBox, t]);

  const handleUncomplete = useCallback((box: WowBox) => {
    if (!window.confirm(t('storage.wow.uncompleteConfirm', { box: boxLabel(box) }))) return;
    runBox(box, { action: 'unpack', user_id: box.lines[0].user_id, wow_box_id: box.id }, 'working');
  }, [runBox, t]);

  const handleUnattach = useCallback((box: WowBox) => {
    if (!window.confirm(t('storage.wow.unattachConfirm', { box: boxLabel(box) }))) return;
    runBox(box, { action: 'attach_clear', wow_box_ids: [box.id] }, 'seq');
  }, [runBox, t]);

  const handleUnready = useCallback((box: WowBox) => {
    if (!window.confirm(t('storage.wow.unreadyConfirm', { box: boxLabel(box) }))) return;
    // 옛 방식으로 담은 박스(합포장을 거치지 않음)는 서류준비로 돌아간다
    runBox(box, { action: 'unready', wow_box_ids: [box.id] }, box.lines[0].packed_at ? 'pack' : 'docs');
  }, [runBox, t]);

  // ============================================================
  // [라벨출력] — 박스 라벨(발주번호-박스번호)을 QZ Tray 로 인쇄하고 뽑은 시각을 남긴다
  //   양식 · 프린터는 [라벨 설정] 의 '박스 라벨' 템플릿이 정한다 (utils/printWowBoxLabels.ts)
  //   인쇄하지 못하면(템플릿 없음 · 프린터 미지정 · QZ Tray 미실행) 뽑은 시각을 남기지 않는다
  // ============================================================
  const handleBoxLabel = useCallback(async () => {
    if (!worker) { setMessage({ kind: 'error', text: t('storage.needWorker') }); return; }
    setBusyTool('boxLabel');
    let printed = 0;
    try {
      printed = await printWowBoxLabels(boxLabelTargets, ftUsers);
    } catch (err) {
      fail(err, '와우출고 박스 라벨 오류:');
      setBusyTool('');
      return;
    }
    await runTool('boxLabel', { action: 'label_printed', wow_box_ids: boxLabelTargets.map((b) => b.id) },
      { kind: 'ok', text: t('storage.wow.boxLabelDone', { count: printed }) });
  }, [worker, boxLabelTargets, ftUsers, runTool, fail, t]);

  // ============================================================
  // [순서지정] · [초기화] · [합포장] · [합포장 취소] · [출고준비완료]
  // ============================================================
  const handleSeqSave = useCallback((boxIds: string[]) => runTool(
    'seq', { action: 'seq', wow_box_ids: boxIds },
    { kind: 'ok', text: t('storage.wow.seqDone', { count: boxIds.length }) }), [runTool, t]);

  const handleSeqClear = useCallback(() => {
    if (!window.confirm(t('storage.wow.seqClearConfirm', { count: targetBoxes.length }))) return;
    runTool('seqClear', { action: 'seq_clear', wow_box_ids: targetBoxes.map((b) => b.id) }, movedMessage(targetBoxes, 'docs'));
  }, [targetBoxes, runTool, movedMessage, t]);

  // [부착완료] — 서류 · 운송장을 다 붙인 박스를 합포장 탭으로 넘긴다 (순서 번호는 그대로)
  const handleAttach = useCallback(() => {
    if (!window.confirm(t('storage.wow.attachConfirm', { count: targetBoxes.length }))) return;
    runTool('attach', { action: 'attach', wow_box_ids: targetBoxes.map((b) => b.id) }, movedMessage(targetBoxes, 'pack'));
  }, [targetBoxes, runTool, movedMessage, t]);

  const handlePackSave = useCallback((boxIds: string[], target: WowPackTarget) => runTool(
    'pack', { action: 'pack', wow_box_ids: boxIds, bag: target },
    { kind: 'ok', text: t('storage.wow.packDone', { count: boxIds.length }) }), [runTool, t]);

  // [합포장 취소] 는 마대에 담았거나 마킹번호가 붙은 박스만 대상이다 (체크한 박스 중)
  const packClearTargets = useMemo(() => checkedBoxes.filter((b) => b.lines[0].packed_at), [checkedBoxes]);
  // [출고준비완료] — 대상 박스 전부. 마대는 통째로 넘긴다 (대상 박스가 든 마대의 나머지 박스도 같이)
  //   마대에 담지 않은 박스는 박스 그대로 나간다 (박스 하나 = 마킹번호 하나)
  const readyTargets = useMemo(() => {
    const bagIds = new Set(targetBoxes.map((b) => b.lines[0].bag_id).filter(Boolean));
    return stageBoxes.filter((b) => targetBoxes.includes(b) || (b.lines[0].bag_id && bagIds.has(b.lines[0].bag_id)));
  }, [targetBoxes, stageBoxes]);

  const handlePackClear = useCallback(() => {
    if (!window.confirm(t('storage.wow.packClearConfirm', { count: packClearTargets.length }))) return;
    runTool('packClear', { action: 'pack_clear', wow_box_ids: packClearTargets.map((b) => b.id) },
      { kind: 'ok', text: t('storage.wow.packClearDone', { count: packClearTargets.length }) });
  }, [packClearTargets, runTool, t]);

  // [바로 출고준비] — 서류준비 탭. 마킹번호는 지금 번호 그대로 쓴다. 되돌리기는 출고준비 탭의 [출고준비 취소] (서류준비로 돌아온다)
  const handleReadyDirect = useCallback(() => {
    if (!window.confirm(t('storage.wow.readyDirectConfirm', { count: readyDirectTargets.length }))) return;
    runTool('readyDirect', { action: 'ready_direct', wow_box_ids: readyDirectTargets.map((b) => b.id) }, movedMessage(readyDirectTargets, 'ready'));
  }, [readyDirectTargets, runTool, movedMessage, t]);

  const handleReady = useCallback(() => {
    // 마대에 담지 않은 박스 수를 같이 알려 준다 — 마대에 담을 박스가 남았으면 여기서 멈추게
    const loose = readyTargets.filter((b) => !b.lines[0].bag_id).length;
    const question = t('storage.wow.readyConfirm', { count: readyTargets.length })
      + (loose > 0 ? t('storage.wow.readyConfirmLoose', { count: loose }) : '');
    if (!window.confirm(question)) return;
    runTool('ready', { action: 'ready', wow_box_ids: readyTargets.map((b) => b.id) }, movedMessage(readyTargets, 'ready'));
  }, [readyTargets, runTool, movedMessage, t]);

  // ============================================================
  // [발주취소] — 체크한 박스만. 되돌릴 수 없어 한 번 더 묻는다
  //   응답의 to_putaway = 이미 꺼냈던 수량 → 재고 [작업중] 에서 다시 배치해야 한다고 알려 준다
  // ============================================================
  const handleDrop = useCallback(() => {
    const count = checkedBoxes.length;
    if (count === 0 || !window.confirm(t('storage.wow.dropConfirm', { count }))) return;
    runTool('drop', { action: 'drop', wow_box_ids: checkedBoxes.map((b) => b.id) }, (json) => {
      const back = Number(json.to_putaway) || 0;
      return {
        kind: 'ok',
        text: back > 0 ? t('storage.wow.dropDoneBack', { count, qty: back }) : t('storage.wow.dropDone', { count }),
      };
    });
  }, [checkedBoxes, runTool, t]);

  // ============================================================
  // 파일 받기 — [부착문서] · [동봉문서] (한 PDF) · [택배엑셀] · [마킹라벨]
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

  // 박스 순서 = 지금 보이는 순서 (순서지정 탭이면 찍은 순서)
  const handleDownloadDocs = useCallback((kind: WowDocKind) => download(
    kind, '/api/ft/storage/wow/docs', { box_ids: docBoxIds[kind], kind },
    `${t(`storage.wow.${kind}`)}_${t(`storage.wow.stage.${stage}`)}_${new Date().toLocaleDateString('sv-SE')}.pdf`,
  ), [download, docBoxIds, stage, t]);

  // 파일 이름: 사업자명_로켓와우_시각 (대상 박스가 한 사업자의 것일 때만 사업자명을 붙인다)
  const handleDownloadCourier = useCallback(() => {
    const userIds = new Set(targetBoxes.map((b) => b.lines[0].user_id));
    const user = userIds.size === 1 ? ftUsers.find((u) => userIds.has(u.id)) : undefined;
    const name = [user?.vender_name || user?.user_code, t('storage.wow.courierFile'), fileStamp()].filter(Boolean).join('_');
    return download('courier', '/api/ft/storage/wow/courier', { box_ids: targetBoxes.map((b) => b.id) }, `${name}.xlsx`);
  }, [download, targetBoxes, ftUsers, t]);

  // 쉽먼트 V2 의 [마킹라벨] 과 같은 출력물 (10×15, 날짜 / 마킹번호 / 크기) — 크기는 쉽먼트 V2 에서 넣는다
  const handleMarking = useCallback(() => {
    const date = todayYYMMDD();
    const userCodes = new Set(targetBoxes.map((b) => userCodeOf(b.lines[0].user_id)));
    try {
      downloadBoxLabelPdf(
        markingCodes.map((code) => ({ date, location: code, weight: '' })),
        `${t('storage.wow.marking')}_${userCodes.size === 1 ? Array.from(userCodes)[0] : 'BOX'}_${date}.pdf`);
      setMessage(null);
    } catch (err) {
      fail(err, '와우출고 마킹라벨 오류:');
    }
  }, [targetBoxes, markingCodes, userCodeOf, fail, t]);

  // ============================================================
  // 렌더
  // ============================================================
  if (wow.loadError) return <div className="storage-empty is-error">{t('storage.loadError')}</div>;
  if (wow.loading && wow.rows.length === 0) return <div className="storage-empty">{t('storage.loading')}</div>;

  const showUnboxed = stage === 'new' && unboxed.length > 0;
  const showToolbar = stageBoxes.length > 0 || PULL_STAGES.includes(stage);

  return (
    <section className="wow-page">
      <WowStageTabs stage={stage} counts={counts} onChange={handleStage} />

      {message && <div className={`wow-message is-${message.kind}`} role="status">{message.text}</div>}

      {/* ── 이 단계의 박스 ── */}
      {showToolbar && (
        <WowToolbar
          stage={stage}
          total={stageBoxes.length}
          checkedCount={checkedBoxes.length}
          allExpanded={allExpanded}
          counts={{
            boxLabel: boxLabelTargets.length,
            readyDirect: hasCartonBoxes ? readyDirectTargets.length : null,
            seqCandidates: seqCandidates.length,
            packCandidates: packCandidates.length,
            packClear: packClearTargets.length,
            ready: readyTargets.length,
            marking: markingCodes.length,
            drop: checkedBoxes.length,
            docs: { label: docBoxIds.label.length, manifest: docBoxIds.manifest.length },
          }}
          busy={busyTool}
          onToggleAll={handleToggleAll}
          onToggleExpandAll={handleToggleExpandAll}
          onBoxLabel={handleBoxLabel}
          onReadyDirect={handleReadyDirect}
          onSeqOpen={() => setModal('seq')}
          onSeqClear={handleSeqClear}
          onCourier={handleDownloadCourier}
          onAttach={handleAttach}
          onPackOpen={() => setModal('pack')}
          onPackClear={handlePackClear}
          onReady={handleReady}
          onMarking={handleMarking}
          onDocs={handleDownloadDocs}
          onDrop={handleDrop}
        />
      )}
      {stageBoxes.length > 0 && (
        <WowTable
          boxes={stageBoxes}
          stage={stage}
          showUser={!tab}
          userCodeOf={userCodeOf}
          busyBoxId={busyBox}
          checkedIds={checked}
          expandedIds={expanded}
          onToggleCheck={handleToggleCheck}
          onToggleExpand={handleToggleExpand}
          onCancelStart={handleCancelStart}
          onUncomplete={handleUncomplete}
          onUnattach={handleUnattach}
          onUnready={handleUnready}
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

      {modal === 'seq' && (
        <WowSeqModal candidates={seqCandidates} onSave={handleSeqSave} onClose={() => setModal(null)} />
      )}
      {modal === 'pack' && (
        <WowPackModal candidates={packCandidates} openBags={openBags} onSave={handlePackSave} onClose={() => setModal(null)} />
      )}
    </section>
  );
};

export default Wow;

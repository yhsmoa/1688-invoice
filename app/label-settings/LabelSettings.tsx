'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useSaveContext } from '../../contexts/SaveContext';

import TemplateBoard from './components/TemplateBoard';
import CanvasToolbar, { type AlignAction } from './components/CanvasToolbar';
import LabelCanvas from './components/LabelCanvas';
import ElementListPanel from './components/ElementListPanel';
import ElementPropsPanel from './components/ElementPropsPanel';

import { useLabelSettingsData } from './hooks/useLabelSettingsData';
import { useTemplateDraft, type ElementPatch } from './hooks/useTemplateDraft';
import { getLocalPrinter, LOCAL_PRINTER_HELP } from '../../lib/localPrinterMap';

import {
  SAMPLE_LABEL_DATA,
  createElement,
  textLinesHeightMm,
  accountFieldsToLabelData,
  DEFAULT_FONT,
  type LabelData,
  type LabelElement,
  type LabelTemplate,
  type LabelType,
} from '../../lib/labelTypes';
import { measureElement, elementWarning, preloadTemplateAssets } from '../../lib/labelRender';
import { buildTsplJob } from '../../lib/tspl';
import { printRaw, QZ_NOT_RUNNING } from '../../lib/qzTray';
import './LabelSettings.css';

// ============================================================
// 라벨 설정 — 3분할 편집기
//
//   왼쪽   : 템플릿 보드(탭: 템플릿·기본정보·미리보기데이터·프린터) + 요소 목록
//   가운데 : 툴바 + 라벨 캔버스 (드래그로 배치, 다중 선택 가능)
//   오른쪽 : 선택 요소 속성
//
// 인쇄는 QZ Tray(localhost) 로 TSPL RAW 전송
//   미리보기 래스터 = 인쇄 래스터 (lib/labelRender.ts 공용)
//   프린터는 "템플릿마다 이 PC 에서 쓸 프린터" 를 브라우저에 로컬로 저장한다
//   (lib/localPrinterMap.ts) — PC-NO 같은 자리 번호 개념은 새 인쇄 경로에 없다.
// ============================================================

const MIN_SCALE = 3;
const MAX_SCALE = 20;
const TOAST_MS = 2600;

/** 새 템플릿 기본값 — 종류별로 실무에서 바로 쓸 만한 배치를 넣어 둔다 */
const newTemplate = (labelType: LabelType): LabelTemplate => ({
  id: '',
  user_ids: null,
  name: labelType === 'care' ? '새 케어라벨' : '새 바코드 라벨',
  label_type: labelType,
  printer_lang: 'TSPL2',
  width_mm: labelType === 'care' ? 30 : 40,
  height_mm: labelType === 'care' ? 40 : 30,
  gap_mm: 2,
  // 케어라벨은 보통 틈 없는 리본 → 연속 용지. 틈 설정으로 나가면 프린터가 멈춘다
  media: labelType === 'care' ? 'continuous' : 'gap',
  dpi: labelType === 'care' ? 300 : 203,
  layout:
    labelType === 'care'
      ? [
          // 케어라벨 — 긴 한글(상품명·소재)은 자동 줄바꿈으로 여러 줄 표기
          {
            ...createElement('text'),
            y_mm: 3,
            field: 'brand',
            size_pt: 9,
            bold: true,
            font_family: DEFAULT_FONT,
          },
          // 상품명·소재는 길이가 매번 달라서 "영역" 으로 잡는다 (넘치면 자동 축소)
          {
            ...createElement('text'),
            y_mm: 9,
            field: 'item_name',
            size_pt: 6,
            max_w_mm: 26,
            h_mm: textLinesHeightMm(6, 3, 300),
          },
          {
            ...createElement('text'),
            y_mm: 22,
            field: 'composition',
            size_pt: 6,
            max_w_mm: 26,
            h_mm: textLinesHeightMm(6, 2, 300),
          },
          { ...createElement('text'), y_mm: 32, field: 'recommanded_age', size_pt: 6 },
        ]
      : [
          { ...createElement('text'), y_mm: 2, field: 'brand', size_pt: 8, bold: true },
          {
            ...createElement('text'),
            y_mm: 6,
            field: 'item_name',
            size_pt: 6,
            max_w_mm: 36,
            h_mm: textLinesHeightMm(6, 2, 203),
          },
          { ...createElement('barcode'), x_mm: 3, y_mm: 12, h_mm: 10 },
          { ...createElement('text'), y_mm: 25, field: 'product_no', size_pt: 6 },
        ],
  is_default: false,
});

interface Toast {
  msg: string;
  kind: 'ok' | 'err';
}

const LabelSettings: React.FC = () => {
  const data = useLabelSettingsData();
  const draftApi = useTemplateDraft();
  const { draft, dirty } = draftApi;
  const { setHasUnsavedChanges } = useSaveContext();

  // 목록 필터 (템플릿 보드의 "템플릿" 탭)
  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState<LabelType | ''>('');

  // 편집 상태 — 다중 선택 가능
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 미리보기·경고·테스트 출력에 쓰는 샘플 값 (긴 데이터로 영역을 잡아 보는 용도) */
  const [sampleData, setSampleData] = useState<LabelData>(SAMPLE_LABEL_DATA);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // 캔버스 보기 설정
  const [scale, setScale] = useState(8);
  const [showGrid, setShowGrid] = useState(true);
  const [snapMm, setSnapMm] = useState(0.5);
  const stageWrapRef = useRef<HTMLDivElement>(null);

  /** 선택이 정확히 1개일 때만 상세 속성을 보여준다 */
  const selectedEl = useMemo(
    () => (selectedIds.length === 1 ? draft?.layout.find((el) => el.id === selectedIds[0]) ?? null : null),
    [draft, selectedIds]
  );

  // ── 계정 정보 미리보기 값 — 템플릿에 실제 사업자가 지정돼 있으면 그 사업자의
  //    진짜 값(거래처명·아이디 등)으로 채운다. 그냥 "sample_user" 같은 임의 문구를
  //    보여주면 진짜 인쇄 결과와 다르게 보여서 혼란스럽다.
  //    지정된 사업자 배열이 실제로 바뀔 때만 갱신 — 요소를 옮기는 등 다른 편집으로
  //    draft 가 바뀔 때마다 사용자가 손으로 고친 계정 필드값을 덮어쓰지 않기 위해
  //    "내용"(userIdsKey) 을 의존성으로 쓴다 (배열 참조가 아니라).
  const assignedUserIds = draft?.user_ids;
  const userIdsKey = assignedUserIds && assignedUserIds.length > 0 ? assignedUserIds.join(',') : '';
  useEffect(() => {
    if (!userIdsKey) return; // 공용 — 임의 샘플 유지
    const firstId = userIdsKey.split(',')[0];
    const user = data.users.find((u) => u.id === firstId);
    if (!user) return;
    setSampleData((prev) => ({ ...prev, ...accountFieldsToLabelData(user) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdsKey, data.users]);

  // ── 토스트 자동 닫기 ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // ── 미저장 경고 (사이드 메뉴 이동 · 브라우저 이탈) ──
  useEffect(() => {
    setHasUnsavedChanges(dirty);
  }, [dirty, setHasUnsavedChanges]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ============================================================
  // 화면 맞춤 — 가운데 칸 크기에 맞춰 배율 계산
  // ============================================================
  const fitToView = useCallback(() => {
    const box = stageWrapRef.current;
    if (!box || !draft) return;
    const availW = box.clientWidth - 60; // 눈금자 + 여백
    const availH = box.clientHeight - 60;
    if (availW <= 0 || availH <= 0) return;
    const next = Math.min(availW / draft.width_mm, availH / draft.height_mm);
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(next * 2) / 2)));
  }, [draft]);

  // ============================================================
  // 템플릿 선택 / 새로 만들기 (미저장 확인)
  // ============================================================
  const confirmDiscard = useCallback(() => {
    if (!dirty) return true;
    return window.confirm('저장하지 않은 변경사항이 있습니다. 버리고 이동할까요?');
  }, [dirty]);

  const pickTemplate = useCallback(
    (tpl: LabelTemplate) => {
      if (tpl.id === draft?.id) return;
      if (!confirmDiscard()) return;
      draftApi.load(tpl);
      setSelectedIds([]);
      requestAnimationFrame(fitToView);
    },
    [draft?.id, confirmDiscard, draftApi, fitToView]
  );

  const createTemplate = useCallback(
    (type: LabelType) => {
      if (!confirmDiscard()) return;
      draftApi.load(newTemplate(type));
      setSelectedIds([]);
      requestAnimationFrame(fitToView);
    },
    [confirmDiscard, draftApi, fitToView]
  );

  // ============================================================
  // 요소 조작
  // ============================================================
  const handleElementsChange = useCallback(
    (entries: { id: string; patch: ElementPatch }[], commit: boolean) => {
      draftApi.patchElements(entries, { commit });
    },
    [draftApi]
  );

  const handleAdd = useCallback(
    (type: LabelElement['type']) => {
      // 텍스트는 처음부터 "영역" 으로 — 시작점에서 오른쪽 여백 2mm 까지, 높이 2줄
      const overrides =
        type === 'text' && draft
          ? {
              max_w_mm: Math.max(4, Math.round((draft.width_mm - 2 - 2) * 10) / 10),
              h_mm: textLinesHeightMm(8, 2, draft.dpi),
            }
          : undefined;
      const id = draftApi.addElement(type, overrides);
      if (id) setSelectedIds([id]);
    },
    [draftApi, draft]
  );

  const handleRemove = useCallback(
    (id: string) => {
      draftApi.removeElement(id);
      setSelectedIds((cur) => cur.filter((v) => v !== id));
    },
    [draftApi]
  );

  const handleRemoveSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    draftApi.removeElements(selectedIds);
    setSelectedIds([]);
  }, [draftApi, selectedIds]);

  const handleDuplicate = useCallback(
    (id: string) => {
      const newId = draftApi.duplicateElement(id);
      if (newId) setSelectedIds([newId]);
    },
    [draftApi]
  );

  const handleDuplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const newIds = draftApi.duplicateElements(selectedIds);
    if (newIds.length > 0) setSelectedIds(newIds);
  }, [draftApi, selectedIds]);

  /** 선택 요소를 라벨 기준으로 정렬 (선택 1개일 때만) */
  const handleAlign = useCallback(
    (action: AlignAction) => {
      if (!draft || !selectedEl) return;
      const box = measureElement(selectedEl, draft, sampleData);
      const round = (v: number) => Math.max(0, Math.round(v * 10) / 10);

      switch (action) {
        case 'left':
          draftApi.patchElement(selectedEl.id, { x_mm: 0 });
          break;
        case 'hcenter':
          draftApi.patchElement(selectedEl.id, {
            x_mm: round((draft.width_mm - box.w_mm) / 2),
          });
          break;
        case 'right':
          draftApi.patchElement(selectedEl.id, {
            x_mm: round(draft.width_mm - box.w_mm),
          });
          break;
        case 'top':
          draftApi.patchElement(selectedEl.id, { y_mm: 0 });
          break;
        case 'vcenter':
          draftApi.patchElement(selectedEl.id, {
            y_mm: round((draft.height_mm - box.h_mm) / 2),
          });
          break;
        case 'bottom':
          draftApi.patchElement(selectedEl.id, {
            y_mm: round(draft.height_mm - box.h_mm),
          });
          break;
      }
    },
    [draft, selectedEl, draftApi, sampleData]
  );

  // ============================================================
  // 저장 / 삭제 / 테스트 출력
  // ============================================================
  const handleSave = useCallback(async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setToast({ msg: '템플릿 이름을 입력해주세요.', kind: 'err' });
      return;
    }
    setSaving(true);
    try {
      const isNew = !draft.id;
      const payload = {
        ...(isNew ? {} : { id: draft.id }),
        user_ids: draft.user_ids,
        name: draft.name,
        label_type: draft.label_type,
        width_mm: draft.width_mm,
        height_mm: draft.height_mm,
        gap_mm: draft.gap_mm,
        media: draft.media ?? 'gap',
        cutter: draft.cutter ?? 'off',
        dpi: draft.dpi,
        density: draft.density ?? null,
        speed: draft.speed ?? null,
        layout: draft.layout,
        is_default: draft.is_default,
      };
      const res = await fetch('/api/label-templates', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '저장 실패');

      draftApi.markSaved(json.data);
      await data.reloadTemplates();
      setToast({ msg: '저장되었습니다.', kind: 'ok' });
    } catch (err) {
      console.error('템플릿 저장 오류:', err);
      setToast({
        msg: err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.',
        kind: 'err',
      });
    } finally {
      setSaving(false);
    }
  }, [draft, draftApi, data]);

  const handleDelete = useCallback(async () => {
    if (!draft?.id) return;
    if (!window.confirm(`"${draft.name}" 템플릿을 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/label-templates?id=${draft.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      draftApi.load(null);
      setSelectedIds([]);
      await data.reloadTemplates();
      setToast({ msg: '삭제되었습니다.', kind: 'ok' });
    } catch (err) {
      console.error('템플릿 삭제 오류:', err);
      setToast({ msg: '삭제 중 오류가 발생했습니다.', kind: 'err' });
    }
  }, [draft, draftApi, data]);

  const handleTestPrint = useCallback(async () => {
    if (!draft) return;
    if (!draft.id) {
      setToast({ msg: '먼저 저장해야 이 PC 의 프린터를 지정할 수 있습니다.', kind: 'err' });
      return;
    }
    const printer = getLocalPrinter(draft.id);
    if (!printer) {
      setToast({
        msg: `"${draft.name}" 템플릿에 이 PC 의 프린터가 지정되지 않았습니다. ${LOCAL_PRINTER_HELP}`,
        kind: 'err',
      });
      return;
    }
    // 프린터 해상도와 템플릿 해상도가 다르면 실제 크기가 달라진다 — 알고 찍게 한다
    const info = data.qzPrinters.find((p) => p.name === printer);
    if (info?.dpi && info.dpi !== draft.dpi) {
      const go = window.confirm(
        `프린터 "${printer}" 는 ${info.dpi}dpi 인데 템플릿은 ${draft.dpi}dpi 입니다.\n` +
          `라벨이 ${info.dpi > draft.dpi ? '작게' : '크게'} 찍힙니다. 그래도 출력할까요?`
      );
      if (!go) return;
    }
    try {
      await preloadTemplateAssets(draft); // 이미지(세탁 기호)가 빠진 채 나가지 않게
      const bytes = buildTsplJob(draft, sampleData, 1);
      await printRaw(printer, bytes);
      setToast({ msg: '테스트 라벨을 전송했습니다.', kind: 'ok' });
    } catch (err) {
      console.error('테스트 출력 오류:', err);
      setToast({
        msg: err instanceof Error ? `${QZ_NOT_RUNNING} (${err.message})` : QZ_NOT_RUNNING,
        kind: 'err',
      });
    }
  }, [draft, data, sampleData]);

  // ============================================================
  // 단축키
  // ============================================================
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const mod = e.ctrlKey || e.metaKey;

      // 저장은 입력 중에도 받는다
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if (typing) return;
      if (!draft) return;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) draftApi.redo();
        else draftApi.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        draftApi.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && selectedIds.length > 0) {
        e.preventDefault();
        handleDuplicateSelected();
        return;
      }
      if (e.key === 'Escape') {
        setSelectedIds([]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        handleRemoveSelected();
        return;
      }

      // 방향키 미세 이동 — 선택된 요소 전부 같이 움직인다
      const step = e.shiftKey ? 1 : 0.1;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const d = delta[e.key];
      if (d && draft && selectedIds.length > 0) {
        e.preventDefault();
        const entries = selectedIds
          .map((id) => draft.layout.find((el) => el.id === id))
          .filter((el): el is LabelElement => !!el && !el.locked)
          .map((el) => ({
            id: el.id,
            patch: {
              x_mm: Math.max(0, Math.round((el.x_mm + d[0]) * 100) / 100),
              y_mm: Math.max(0, Math.round((el.y_mm + d[1]) * 100) / 100),
            } as ElementPatch,
          }));
        if (entries.length > 0) {
          draftApi.patchElements(entries, {
            key: `el:arrow:${selectedIds.slice().sort().join(',')}`,
          });
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    draft,
    draftApi,
    selectedIds,
    handleSave,
    handleDuplicateSelected,
    handleRemoveSelected,
  ]);

  // ── 요소별 경고 (규격 위반 · 글꼴 없음 · 라벨 밖) ──
  const warnings = useMemo(() => {
    const map = new Map<string, string | null>();
    if (!draft) return map;
    for (const el of draft.layout) {
      map.set(el.id, elementWarning(el, draft, sampleData));
    }
    return map;
  }, [draft, sampleData]);

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="ls-layout">
      <TopsideMenu />
      <div className="ls-main-content">
        <LeftsideMenu />
        <main className="ls-content">
          {/* ── 헤더 ── */}
          <header className="ls-header">
            <h1 className="ls-title">라벨 설정</h1>

            <div className="ls-header-right">
              <span
                className={`ls-qz-badge ${data.qzOk ? 'ok' : data.qzOk === false ? 'off' : ''}`}
              >
                {data.qzOk === null
                  ? 'QZ 확인 중…'
                  : data.qzOk
                    ? 'QZ Tray 연결됨'
                    : 'QZ Tray 미실행'}
              </span>

              {draft && (
                <>
                  {dirty && <span className="ls-dirty">● 저장 안 됨</span>}
                  <button className="ls-btn" onClick={handleTestPrint} disabled={!data.qzOk}>
                    테스트 출력
                  </button>
                  {draft.id && (
                    <button className="ls-btn-danger" onClick={handleDelete}>
                      삭제
                    </button>
                  )}
                  <button className="ls-btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? '저장 중…' : '저장 (Ctrl+S)'}
                  </button>
                </>
              )}
            </div>
          </header>

          {/* ── 3분할 작업 영역 ── */}
          <div className="ls-workspace">
            {/* 왼쪽 — 템플릿 보드 + 요소 목록 */}
            <div className="ls-col ls-col-left">
              <TemplateBoard
                templates={data.templates}
                users={data.users}
                loading={data.loading}
                filterType={filterType}
                filterUserId={filterUserId}
                activeId={draft?.id || null}
                onFilterType={setFilterType}
                onFilterUser={setFilterUserId}
                onPick={pickTemplate}
                onCreate={createTemplate}
                draft={draft}
                onPatchTemplate={draftApi.patchTemplate}
                sampleData={sampleData}
                onSampleDataChange={setSampleData}
                qzOk={data.qzOk}
                qzPrinters={data.qzPrinters}
                onRefreshQz={data.refreshQz}
              />

              {draft && (
                <ElementListPanel
                  layout={draft.layout}
                  selectedIds={selectedIds}
                  warnings={warnings}
                  onSelect={setSelectedIds}
                  onPatch={(id, patch) => draftApi.patchElement(id, patch)}
                  onRemove={handleRemove}
                  onDuplicate={handleDuplicate}
                  onReorder={draftApi.reorderElement}
                />
              )}
            </div>

            {/* 가운데 — 캔버스 */}
            <div className="ls-col ls-col-center">
              {!draft ? (
                <div className="ls-empty ls-empty-lg">
                  왼쪽에서 템플릿을 선택하거나 새로 만드세요.
                </div>
              ) : (
                <>
                  <CanvasToolbar
                    onAdd={handleAdd}
                    scale={scale}
                    onScale={setScale}
                    onFit={fitToView}
                    showGrid={showGrid}
                    onShowGrid={setShowGrid}
                    snapMm={snapMm}
                    onSnapMm={setSnapMm}
                    canUndo={draftApi.canUndo}
                    canRedo={draftApi.canRedo}
                    onUndo={draftApi.undo}
                    onRedo={draftApi.redo}
                    hasSelection={!!selectedEl}
                    onAlign={handleAlign}
                  />

                  <div className="ls-stage-wrap" ref={stageWrapRef}>
                    <LabelCanvas
                      template={draft}
                      data={sampleData}
                      scale={scale}
                      showGrid={showGrid}
                      snapMm={snapMm}
                      selectedIds={selectedIds}
                      onSelect={setSelectedIds}
                      onElementsChange={handleElementsChange}
                    />
                  </div>

                  <div className="ls-canvas-foot">
                    미리보기는 실제 인쇄와 같은 방식으로 그립니다 ({draft.dpi}dpi). 빈 곳을 끌면
                    여러 개를 한 번에 선택하고, Shift/Ctrl+클릭으로 선택을 더하거나 뺍니다.
                  </div>
                </>
              )}
            </div>

            {/* 오른쪽 — 선택 요소 속성 */}
            <div className="ls-col ls-col-right">
              {!draft ? (
                <div className="ls-panel ls-empty">템플릿을 먼저 선택하세요.</div>
              ) : selectedIds.length > 1 ? (
                <div className="ls-panel">
                  <div className="ls-panel-title">{selectedIds.length}개 선택됨</div>
                  <div className="ls-hint">
                    여러 요소를 함께 이동·삭제·복제할 수 있습니다. 속성을 편집하려면 하나만
                    선택하세요.
                  </div>
                  <div className="ls-multi-actions">
                    <button className="ls-btn-sm" onClick={handleDuplicateSelected}>
                      복제 (Ctrl+D)
                    </button>
                    <button className="ls-btn-sm ls-btn-danger-sm" onClick={handleRemoveSelected}>
                      삭제 (Delete)
                    </button>
                  </div>
                </div>
              ) : selectedEl ? (
                <ElementPropsPanel
                  el={selectedEl}
                  template={draft}
                  data={sampleData}
                  warning={warnings.get(selectedEl.id) ?? null}
                  onPatch={(id, patch, opts) =>
                    draftApi.patchElement(id, patch, { key: opts?.key })
                  }
                />
              ) : (
                <div className="ls-panel ls-empty">
                  캔버스나 목록에서 요소를 선택하면 속성이 여기 표시됩니다.
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── 토스트 ── */}
      {toast && <div className={`ls-toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
};

export default LabelSettings;

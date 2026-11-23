'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WowLine, WowStage } from '../types';
import { formatDateTime } from '../utils/storageFormat';
import { WOW_PICKED_STAGES } from '../utils/wowStage';
import ProductCell from './ProductCell';

// ============================================================
// WowTable — 와우출고 한 단계의 박스 목록 (클로드 디자인 캔버스 "와우출고 화면 디자인")
//
//   박스마다 카드 하나 — 처음엔 머리줄(요약)만 보이고, 머리줄을 누르면 상품 표가 펼쳐진다
//     머리줄: ☐ · 펼침 · (순서) · 사업자 · 입고예정일 · 발주번호-박스 · 센터 · 박스 크기 · 상품 n종 · 요청 n · 담음 n
//             · (라벨 출력됨 | 마대 n | 그대로 출고 | 마킹번호) | 담당(또는 출고) | 버튼 | 서류 2종
//       요청 · 담음 = 그 박스 줄들의 합계 (담음은 작업완료 이후 — 요청보다 적으면 빨강, 같으면 초록)
//       체크박스: 표 위 버튼(라벨출력 · 서류 받기 · 택배엑셀 · 합포장 취소 · 출고준비완료 · 마킹라벨)의 대상을 고른다
//       서류 버튼(부착문서 · 동봉문서)은 맨 오른쪽 — 첨부되면 활성(누르면 열림), 아직이면 비활성
//     상품 표: 상품 · 요청 · (담기 전) 꺼낼 위치 [선반 → 잡아 둔 수량] — 저장된 선반 배정 (011_wow_alloc.sql)
//                           모바일에서 표시한 선반은 ✓ 꺼낸 수량, 잡을 재고가 없는 몫은 "n개 부족"
//                           (작업완료 이후) 담음 · 마킹번호
//   줄의 버튼은 되돌리기만 있다 — 앞으로 가는 일은 모바일(작업) · 표 위 버튼(순서지정 · 합포장 · 출고준비)이 한다
//     작업중 [작업 취소] · 작업완료/서류준비 [작업완료 취소] · 합포장(아직 정하지 않은 박스) [부착완료 취소] · 출고준비 [출고준비 취소]
//     출고는 버튼이 없다 — 쉽먼트 V2 에서 출고하면 자동으로 넘어온다
// ============================================================

export interface WowBox {
  id: string;
  stage: WowStage;
  lines: WowLine[];
}

interface WowTableProps {
  boxes: WowBox[];
  stage: WowStage;
  /** 전체 탭이면 사업자 배지를 보여준다 */
  showUser: boolean;
  userCodeOf: (userId: string) => string;
  /** 처리 중인 박스 — 그 박스의 버튼을 잠근다 */
  busyBoxId: string;
  /** 체크한 박스 · 펼친 박스 (박스 id) */
  checkedIds: ReadonlySet<string>;
  expandedIds: ReadonlySet<string>;
  onToggleCheck: (boxId: string) => void;
  onToggleExpand: (boxId: string) => void;
  onCancelStart: (box: WowBox) => void;
  onUncomplete: (box: WowBox) => void;
  onUnattach: (box: WowBox) => void;
  onUnready: (box: WowBox) => void;
}

/** 입고예정일 'YYYY-MM-DD' → '11/23' */
const shortDate = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}`; };

// ── 아이콘 (선 아이콘, 글자색을 따른다) ──
const Icon: React.FC<{ d: string; size?: number; width?: number }> = ({ d, size = 13, width = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICON = {
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  doc: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM17 19.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
  check: 'm5 12 5 5L20 7',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  sack: 'M8 3h8l-2 4h-4zM10 7c-4 2-6 6-6 10a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4c0-4-2-8-6-10',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01',
  chevron: 'm9 6 6 6-6 6',
};

const WowTable: React.FC<WowTableProps> = ({
  boxes, stage, showUser, userCodeOf, busyBoxId, checkedIds, expandedIds, onToggleCheck, onToggleExpand,
  onCancelStart, onUncomplete, onUnattach, onUnready,
}) => {
  const { t } = useTranslation();
  const isPicked = WOW_PICKED_STAGES.includes(stage);

  // ── 꺼낼 위치: [선반 → 잡아 둔 수량] (표시한 선반은 ✓ 꺼낸 수량, 0 이면 흐리게 · 잡을 재고가 없는 몫은 부족) ──
  const renderLocations = (l: WowLine) => {
    if (l.allocs.length === 0) {
      return (
        <span className="wow-loc-empty"><Icon d={ICON.alert} />{t('storage.wow.noStock')}</span>
      );
    }
    return (
      <div className="wow-locs">
        {l.allocs.map((a) => (a.location_code === null ? (
          <span key="none" className="wow-loc-empty">
            <Icon d={ICON.alert} />{t('storage.wow.stockShort', { count: a.plan_qty })}
          </span>
        ) : (
          <span key={a.location_code} className={`wow-loc ${a.found_qty === 0 ? 'is-spare' : ''} ${a.found_qty !== null ? 'is-found' : ''}`}>
            <span className="wow-loc-code">{a.location_code}</span>
            <span className="wow-loc-arrow">
              <Icon d={a.found_qty !== null ? ICON.check : ICON.arrow} size={12} width={2.4} />
            </span>
            <strong>{a.plan_qty}</strong>
          </span>
        )))}
      </div>
    );
  };

  // ── 서류 버튼: 첨부됨 = 열기 링크(활성), 아직 = 비활성 버튼 ──
  const renderDoc = (box: WowBox, kind: 'label' | 'manifest') => {
    const name = t(`storage.wow.${kind}`);
    const path = kind === 'label' ? box.lines[0].label_path : box.lines[0].manifest_path;
    return path ? (
      <a key={kind} className="wow-btn is-doc" href={`/api/ft/storage/wow/docs?box_id=${box.id}&kind=${kind}`}
        target="_blank" rel="noreferrer">
        <Icon d={ICON.doc} size={14} width={2.2} />{name}
      </a>
    ) : (
      <button key={kind} type="button" className="wow-btn is-doc" disabled
        title={t('storage.wow.docWaiting', { doc: name })}>
        <Icon d={ICON.clock} size={14} />{name}
      </button>
    );
  };

  // ── 담당(작업 시작 → 작업완료 → 출고준비한 사람) · 출고 ──
  const renderWorker = (head: WowLine) => {
    if (stage === 'new') return null;
    if (stage === 'shipped') {
      return (
        <span className="wow-shipped">
          <Icon d={ICON.truck} />
          {head.shipment_no}
          <span className="wow-muted">{t('storage.wow.shippedAt', { time: formatDateTime(head.shipped_at) })}</span>
        </span>
      );
    }
    const [who, at, key] = stage === 'ready'
      ? [head.ready_by, head.ready_at, 'storage.wow.readyAt']
      : stage === 'pack'
        ? (head.packed_at
          ? [head.packed_by, head.packed_at, 'storage.wow.packedAt']
          : [head.attached_by, head.attached_at, 'storage.wow.attachedAt'])
        : stage === 'seq'
          ? [head.ship_seq_by, head.ship_seq_at, 'storage.wow.seqAt']
          : isPicked
            ? [head.picked_by, head.box_picked_at, 'storage.wow.completedAt']
            : [head.work_started_by, head.work_started_at, 'storage.wow.startedAt'];
    const name = who ?? '';
    return (
      <span className="wow-worker">
        <span className="wow-worker-avatar" aria-hidden="true">{name.charAt(0)}</span>
        {name}
        <span className="wow-muted">{t(key, { time: formatDateTime(at) })}</span>
      </span>
    );
  };

  // ── 버튼 (되돌리기만) ──
  const renderActions = (box: WowBox) => {
    const busy = busyBoxId === box.id;
    if (stage === 'working') {
      return (
        <button type="button" className="wow-btn" onClick={() => onCancelStart(box)} disabled={busy}>
          {t('storage.wow.cancelStart')}
        </button>
      );
    }
    if (stage === 'done' || stage === 'docs') {
      return (
        <button type="button" className="wow-btn" onClick={() => onUncomplete(box)} disabled={busy}>
          {t('storage.wow.uncomplete')}
        </button>
      );
    }
    // 합포장 탭: 마대 · 그대로 출고를 정하기 전에만 순서지정으로 되돌릴 수 있다 (정했으면 표 위 [합포장 취소] 부터)
    if (stage === 'pack' && !box.lines[0].packed_at) {
      return (
        <button type="button" className="wow-btn" onClick={() => onUnattach(box)} disabled={busy}>
          {t('storage.wow.unattach')}
        </button>
      );
    }
    if (stage === 'ready') {
      return (
        <button type="button" className="wow-btn" onClick={() => onUnready(box)} disabled={busy}>
          {t('storage.wow.unready')}
        </button>
      );
    }
    return null;
  };

  // ── 단계 표시: 라벨 출력됨 · 마대 · 그대로 출고 · 마킹번호 ──
  const renderMarks = (head: WowLine) => (
    <>
      {stage === 'new' && head.label_printed_at && (
        <span className="wow-mark" title={formatDateTime(head.label_printed_at)}>
          <Icon d={ICON.tag} />{t('storage.wow.labelPrinted')}
        </span>
      )}
      {head.bag_no !== null && (
        <span className="wow-mark is-bag"><Icon d={ICON.sack} />{t('storage.wow.bag', { no: head.bag_no })}</span>
      )}
      {stage === 'pack' && head.bag_no === null && (
        <span className={`wow-mark ${head.packed_at ? '' : 'is-pending'}`}>
          {t(head.packed_at ? 'storage.wow.keep' : 'storage.wow.packPending')}
        </span>
      )}
      {head.box_code && <span className="wow-picked-box">{head.box_code}</span>}
    </>
  );

  return (
    <div className="wow-boxes">
      {boxes.map((box) => {
        const head = box.lines[0];
        const totalQty = box.lines.reduce((s, l) => s + l.qty, 0);
        const pickedQty = box.lines.reduce((s, l) => s + (l.picked_qty ?? 0), 0);
        const kinds = new Set(box.lines.map((l) => l.product_id)).size;
        const open = expandedIds.has(box.id);
        return (
          <section key={box.id} className={`wow-box ${open ? 'is-open' : ''}`}>
            {/* ── 박스 머리줄(요약) — 누르면 상품 표를 펼친다. 체크박스 · 버튼 · 링크는 제 할 일만 한다 ── */}
            <header className="wow-box-head" onClick={(e) => {
              if (!(e.target as HTMLElement).closest('button, a, input')) onToggleExpand(box.id);
            }}>
              <input type="checkbox" className="wow-check" checked={checkedIds.has(box.id)}
                onChange={() => onToggleCheck(box.id)}
                aria-label={t('storage.wow.selectBox', { box: `${head.order_number}-${head.box_no}` })} />
              <button type="button" className="wow-toggle" aria-expanded={open}
                aria-label={t(open ? 'storage.wow.collapse' : 'storage.wow.expand')}
                onClick={() => onToggleExpand(box.id)}>
                <Icon d={ICON.chevron} size={16} width={2.4} />
              </button>
              {head.ship_seq !== null && stage !== 'shipped' && (
                <span className="wow-seq-num" title={t('storage.wow.seqNo')}>{head.ship_seq}</span>
              )}
              {showUser && <span className="wow-user">{userCodeOf(head.user_id)}</span>}
              {head.arrival_date && (
                <span className="wow-arrival" title={head.arrival_date}>
                  {t('storage.wow.arrival', { date: shortDate(head.arrival_date) })}
                </span>
              )}
              <strong className="wow-box-code">{head.order_number}-{head.box_no}</strong>
              {head.center && <span className="wow-box-meta"><Icon d={ICON.pin} />{head.center}</span>}
              {head.box_size && <span className="wow-box-meta"><Icon d={ICON.box} />{head.box_size}</span>}
              <span className="wow-muted">{t('storage.wow.boxMeta', { kinds })}</span>
              <span className="wow-totals">
                <span>{t('storage.wow.requested')}<strong>{totalQty}</strong></span>
                {isPicked && (
                  <span className={pickedQty < totalQty ? 'is-short' : 'is-full'}>
                    {t('storage.wow.picked')}<strong>{pickedQty}</strong>
                  </span>
                )}
              </span>
              {renderMarks(head)}
              {stage !== 'new' && <span className="wow-sep" aria-hidden="true" />}
              {renderWorker(head)}
              <span className="wow-box-actions">
                {renderActions(box)}
                {(stage === 'working' || stage === 'done' || stage === 'docs' || stage === 'ready'
                  || (stage === 'pack' && !head.packed_at)) && (
                  <span className="wow-doc-sep" aria-hidden="true" />
                )}
                {renderDoc(box, 'label')}
                {renderDoc(box, 'manifest')}
              </span>
            </header>

            {/* ── 상품 표 (펼쳤을 때만) ── */}
            {open && (
              <table className={`wow-lines ${isPicked ? 'is-picked' : ''}`}>
                <thead>
                  <tr>
                    <th>{t('storage.col.product')}</th>
                    <th className="col-qty">{t('storage.wow.requested')}</th>
                    {!isPicked && (
                      <th>
                        {t('storage.wow.col.location')}
                        <span className="wow-th-hint"> · {t('storage.wow.col.locationHint')}</span>
                      </th>
                    )}
                    {isPicked && <th className="col-qty">{t('storage.wow.picked')}</th>}
                    {isPicked && <th className="col-picked-box">{t('storage.wow.col.pickedBox')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {box.lines.map((l) => {
                    const short = l.picked_qty !== null && l.picked_qty < l.qty;
                    return (
                      <tr key={l.item_id}>
                        <td><ProductCell info={l} /></td>
                        <td className="col-qty">{l.qty}</td>
                        {!isPicked && <td>{renderLocations(l)}</td>}
                        {isPicked && (
                          <td className={`col-qty ${short ? 'is-short' : 'is-full'}`}>{l.picked_qty ?? ''}</td>
                        )}
                        {isPicked && (
                          <td className="col-picked-box">
                            {head.box_code && <span className="wow-picked-box">{head.box_code}</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default WowTable;

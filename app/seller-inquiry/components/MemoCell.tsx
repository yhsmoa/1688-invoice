'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseMemoLines, sanitizeMemoText, type MemoLine } from '../../../lib/memoLog';
import { SellerInquiryApiError, patchSellerInquiry, type MemoOpInput } from '../utils/sellerInquiryApi';
import './MemoCell.css';

// ============================================================
// MemoCell — 목록 [메모] 칸 (메모 줄 기록, lib/memoLog)
//
//   모든 줄을 항상 보여 준다: [도장 MM.DD HH:mm] [내용] [E] [−]
//     E  → 그 줄 내용을 한 줄 입력으로 (Enter 저장 · Esc 취소 · ✓ / ✕)
//     −  → 확인 후 그 줄 삭제
//   맨 아래 [+] (칸에 마우스를 올렸을 때만) → 빈 입력 한 줄 → { op:'add' }
//   저장은 PATCH { memo_op } 한 줄 단위 — 수정·삭제는 화면이 본 줄 원문(prev)을 같이 보내고,
//   다른 작업자가 먼저 바꿨으면(409) 알리고 목록을 새로 받는다.
//   도장 없는 줄(형식 이전 메모)은 도장 칸을 비워 둔다.
//   이 칸 안의 클릭·키 입력은 행 클릭(상세 펼침)으로 번지지 않는다.
// ============================================================

interface MemoCellProps {
  inquiryId: string;
  memo: string | null;
  onSaved: () => void | Promise<void>;
}

/** 입력 중인 대상 — 줄 번호 또는 새 줄 */
type EditTarget = { kind: 'line'; index: number } | { kind: 'add' } | null;

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const MemoCell: React.FC<MemoCellProps> = ({ inquiryId, memo, onSaved }) => {
  const { t } = useTranslation();
  const lines = useMemo(() => parseMemoLines(memo), [memo]);
  const [target, setTarget] = useState<EditTarget>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // ============================================================
  // 저장 (한 줄 조작)
  // ============================================================
  const send = async (op: MemoOpInput): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      await patchSellerInquiry(inquiryId, { memo_op: op }, t('sellerInquiry.saveError'));
      await onSaved();
      return true;
    } catch (e) {
      console.error('seller-inquiry 메모 저장 오류:', e);
      if (e instanceof SellerInquiryApiError && e.status === 409) {
        alert(t('sellerInquiry.memo.conflict'));
        setTarget(null);
        await onSaved();
      } else {
        alert(e instanceof Error ? e.message : t('sellerInquiry.saveError'));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ── 입력 열기 · 닫기 ──
  const startEdit = (index: number, line: MemoLine) => { setTarget({ kind: 'line', index }); setDraft(line.text); };
  const startAdd = () => { setTarget({ kind: 'add' }); setDraft(''); };
  const cancel = () => { setTarget(null); setDraft(''); };

  const commit = async () => {
    if (!target) return;
    const text = sanitizeMemoText(draft);
    if (!text) return;
    let op: MemoOpInput;
    if (target.kind === 'add') {
      op = { op: 'add', text };
    } else {
      const line = lines[target.index];
      if (!line) { cancel(); return; }
      if (text === line.text) { cancel(); return; }
      op = { op: 'edit', index: target.index, prev: line.raw, text };
    }
    if (await send(op)) cancel();
  };

  const remove = async (index: number, line: MemoLine) => {
    if (!window.confirm(t('sellerInquiry.memo.confirmDelete'))) return;
    await send({ op: 'delete', index, prev: line.raw });
  };

  // ── 입력 키: Enter 저장 · Esc 취소 ──
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  // ============================================================
  // 렌더
  // ============================================================
  const renderInput = () => (
    <div className="si-memo-input-row">
      <input
        type="text"
        className="si-memo-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onInputKey}
        placeholder={t('sellerInquiry.memo.placeholder')}
        disabled={saving}
        autoFocus
      />
      <button
        type="button"
        className="si-memo-icon is-ok"
        onClick={commit}
        disabled={saving || !sanitizeMemoText(draft)}
        title={t('sellerInquiry.memo.save')}
        aria-label={t('sellerInquiry.memo.save')}
      >
        ✓
      </button>
      <button
        type="button"
        className="si-memo-icon"
        onClick={cancel}
        disabled={saving}
        title={t('sellerInquiry.memo.cancel')}
        aria-label={t('sellerInquiry.memo.cancel')}
      >
        ✕
      </button>
    </div>
  );

  const isAdding = target?.kind === 'add';

  return (
    <td className={`si-memo-cell ${isAdding ? 'is-adding' : ''}`} onClick={stop} onKeyDown={stop}>
      {/* ── 줄 목록 ── */}
      {lines.map((line, index) => {
        const isEditing = target?.kind === 'line' && target.index === index;
        return (
          <div key={`${index}:${line.raw}`} className="si-memo-row">
            <span className="si-memo-stamp">{line.stamp ?? ''}</span>
            {isEditing ? (
              renderInput()
            ) : (
              <>
                <span className="si-memo-text">{line.text}</span>
                <span className="si-memo-row-actions">
                  <button
                    type="button"
                    className="si-memo-icon"
                    onClick={() => startEdit(index, line)}
                    disabled={saving}
                    title={t('sellerInquiry.memo.editLine')}
                    aria-label={t('sellerInquiry.memo.editLine')}
                  >
                    E
                  </button>
                  <button
                    type="button"
                    className="si-memo-icon"
                    onClick={() => remove(index, line)}
                    disabled={saving}
                    title={t('sellerInquiry.memo.deleteLine')}
                    aria-label={t('sellerInquiry.memo.deleteLine')}
                  >
                    −
                  </button>
                </span>
              </>
            )}
          </div>
        );
      })}

      {/* ── 새 줄 ── */}
      {isAdding ? (
        <div className="si-memo-row is-new">{renderInput()}</div>
      ) : (
        <button
          type="button"
          className="si-memo-icon si-memo-add"
          onClick={startAdd}
          disabled={saving}
          title={t('sellerInquiry.memo.add')}
          aria-label={t('sellerInquiry.memo.add')}
        >
          +
        </button>
      )}
    </td>
  );
};

export default MemoCell;

'use client';

import React, { useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import AccountInfoForm from './components/AccountInfoForm';
import { useAccountInfo } from './hooks/useAccountInfo';
import { ACCOUNT_FIELDS, type AccountInfo as AccountInfoRow, type AccountInfoForm as FormValues } from './types';
import './AccountInfo.css';

// ============================================================
// 계좌정보 — 계좌관리 > 계좌정보 (/db/account-info)
//   회사이름 / 이름 / 연락처 / 은행 / 계좌번호 / 비고 를 등록·수정·삭제
//   · 입력폼: components/AccountInfoForm (은행은 직원관리와 같은 콤보박스)
//   · 데이터: hooks/useAccountInfo → /api/db/account-info (ft_account_info)
//   · 접근: page.tsx 의 DbAccessGate (DB 관리 접근 코드)
// ============================================================

/** 등록·수정일 표시 — KST 'YYYY-MM-DD HH:mm' */
const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false })
    .slice(0, 16);
};

const AccountInfo: React.FC = () => {
  const { accounts, loading, loadError, reload, create, update, remove } = useAccountInfo();

  // ── 수정 중인 행 (null = 신규 등록 모드) ──
  const [editing, setEditing] = useState<AccountInfoRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ============================================================
  // 저장 / 삭제
  // ============================================================
  const handleSubmit = async (values: FormValues) => {
    if (editing) {
      await update(editing.id, values);
      setEditing(null);
    } else {
      await create(values);
    }
  };

  const handleEdit = (row: AccountInfoRow) => {
    setEditing(row);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (row: AccountInfoRow) => {
    const label = [row.company_name, row.name, row.account_no].filter(Boolean).join(' / ');
    if (!window.confirm(`이 계좌정보를 삭제할까요?\n${label}`)) return;

    setDeletingId(row.id);
    try {
      await remove(row.id);
      if (editing?.id === row.id) setEditing(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="ai-layout">
      <TopsideMenu />
      <div className="ai-main">
        <LeftsideMenu />
        <main className="ai-content">
          <div className="ai-container">
            <h1 className="ai-title">계좌정보</h1>
            <p className="ai-desc">회사이름 · 이름 · 연락처 · 은행 · 계좌번호를 등록해 두고 관리합니다.</p>

            {/* ── 입력폼 — key 를 바꿔 수정 대상이 바뀔 때마다 폼을 새로 채운다 ── */}
            <AccountInfoForm
              key={editing?.id ?? 'new'}
              editing={editing}
              onSubmit={handleSubmit}
              onCancelEdit={() => setEditing(null)}
            />

            {/* ── 목록 ── */}
            <div className="ai-list-head">
              <h2 className="ai-list-title">
                등록된 계좌 <span className="ai-count">{accounts.length.toLocaleString()}</span>
              </h2>
              <button type="button" className="ai-btn ai-btn--ghost" onClick={reload} disabled={loading}>
                새로고침
              </button>
            </div>

            {loadError ? (
              <div className="ai-error">{loadError}</div>
            ) : loading ? (
              <div className="ai-empty">불러오는 중...</div>
            ) : accounts.length === 0 ? (
              <div className="ai-empty">등록된 계좌정보가 없습니다.</div>
            ) : (
              <div className="ai-table-wrap">
                <table className="ai-table">
                  <thead>
                    <tr>
                      {ACCOUNT_FIELDS.map(({ key, label }) => (
                        <th key={key} className="ai-th">{label}</th>
                      ))}
                      <th className="ai-th">수정일</th>
                      <th className="ai-th ai-center">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((row) => (
                      <tr key={row.id} className={editing?.id === row.id ? 'ai-row--editing' : ''}>
                        <td className="ai-td">{row.company_name}</td>
                        <td className="ai-td">{row.name}</td>
                        <td className="ai-td ai-mono">{row.phone}</td>
                        <td className="ai-td">{row.bank_name}</td>
                        <td className="ai-td ai-mono">{row.account_no}</td>
                        <td className="ai-td ai-note">{row.note}</td>
                        <td className="ai-td ai-date">{formatDateTime(row.updated_at)}</td>
                        <td className="ai-td ai-center ai-actions">
                          <button type="button" className="ai-btn ai-btn--sm" onClick={() => handleEdit(row)}>
                            수정
                          </button>
                          <button
                            type="button"
                            className="ai-btn ai-btn--sm ai-btn--danger"
                            onClick={() => handleDelete(row)}
                            disabled={deletingId === row.id}
                          >
                            {deletingId === row.id ? '삭제 중' : '삭제'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AccountInfo;

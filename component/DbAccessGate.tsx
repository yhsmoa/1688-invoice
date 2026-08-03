'use client';

import React, { useCallback, useEffect, useState } from 'react';
import TopsideMenu from './TopsideMenu';
import LeftsideMenu from './LeftsideMenu';
import './DbAccessGate.css';

// ============================================================
// DB 관리 메뉴 접근 잠금
//
//   주문 데이터 관리 / 물량관리 / 데이터베이스 관리 3개 페이지를 감싼다.
//   8자리 코드를 /api/db/verify-access 로 검증하고, 통과하면 children 을 렌더한다.
//
//   · 해제 상태는 sessionStorage 에 저장 → 3개 페이지를 오갈 때 재입력 불필요
//     (탭을 닫으면 사라짐)
//   · 저장된 코드도 마운트 시 서버에 재검증 → 권한 회수가 즉시 반영됨
//   · 화면 잠금은 UI 편의일 뿐, 실제 차단은 각 /api/db/* 라우트의
//     guardDbRoute() 가 담당한다. 데이터 fetch 시 반드시
//     dbAccessHeaders() 를 함께 보낼 것.
// ============================================================

const STORAGE_KEY = 'db-access-code';
const ACCESS_HEADER = 'x-db-access-code';
const CODE_LENGTH = 8;

/** 저장된 접근 코드 (없으면 빈 문자열) */
export function getDbAccessCode(): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(STORAGE_KEY) ?? '';
}

/** /api/db/* 호출 시 함께 보낼 인증 헤더 */
export function dbAccessHeaders(): Record<string, string> {
  return { [ACCESS_HEADER]: getDbAccessCode() };
}

type GateState = 'checking' | 'locked' | 'unlocked';

interface DbAccessGateProps {
  children: React.ReactNode;
}

const DbAccessGate: React.FC<DbAccessGateProps> = ({ children }) => {
  const [state, setState] = useState<GateState>('checking');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // ── 서버 검증 ──
  const verify = useCallback(async (value: string): Promise<boolean> => {
    const res = await fetch('/api/db/verify-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: value }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || '접근 권한이 없습니다.');
      return false;
    }
    return true;
  }, []);

  // ── 마운트 시 저장된 코드 재검증 ──
  useEffect(() => {
    const saved = getDbAccessCode();
    if (!saved) {
      setState('locked');
      return;
    }

    let alive = true;
    (async () => {
      try {
        const ok = await verify(saved);
        if (!alive) return;
        if (ok) {
          setError(null);
          setState('unlocked');
        } else {
          window.sessionStorage.removeItem(STORAGE_KEY);
          setState('locked');
        }
      } catch {
        if (!alive) return;
        window.sessionStorage.removeItem(STORAGE_KEY);
        setError('검증 중 오류가 발생했습니다.');
        setState('locked');
      }
    })();

    return () => {
      alive = false;
    };
  }, [verify]);

  // ── 코드 입력 후 해제 ──
  const handleUnlock = useCallback(async () => {
    if (code.length !== CODE_LENGTH || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const ok = await verify(code);
      if (ok) {
        window.sessionStorage.setItem(STORAGE_KEY, code);
        setState('unlocked');
      }
    } catch {
      setError('검증 중 오류가 발생했습니다.');
    } finally {
      setVerifying(false);
    }
  }, [code, verifying, verify]);

  if (state === 'unlocked') return <>{children}</>;

  // ── 잠금 화면 ──
  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="dbg-lock-main">
          {state === 'checking' ? (
            <div className="dbg-checking">확인 중...</div>
          ) : (
            <div className="dbg-lock-card">
              <div className="dbg-lock-icon">🔒</div>
              <h2 className="dbg-lock-title">DB 관리</h2>
              <p className="dbg-lock-desc">접근 코드 8자리를 입력해주세요</p>
              <input
                className="dbg-lock-input"
                type="password"
                inputMode="numeric"
                maxLength={CODE_LENGTH}
                value={code}
                autoFocus
                onChange={(e) => {
                  setCode(e.target.value.slice(0, CODE_LENGTH));
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnlock();
                }}
              />
              {error && <p className="dbg-lock-error">{error}</p>}
              <button
                className="dbg-lock-btn"
                onClick={handleUnlock}
                disabled={code.length !== CODE_LENGTH || verifying}
              >
                {verifying ? '확인 중...' : '확인'}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default DbAccessGate;

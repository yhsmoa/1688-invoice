'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPrinterDetails, type PrinterInfo } from '../../../lib/qzTray';
import type { LabelTemplate } from '../../../lib/labelTypes';

// ============================================================
// 라벨 설정 화면의 서버/장치 데이터
//   · 템플릿 목록      /api/label-templates
//   · 사용자 목록      /api/ft/users
//   · QZ Tray 프린터   localhost 웹소켓 — "지금 이 PC" 에 설치된 프린터와 해상도
//
// 프린터를 "어떤 템플릿에 쓸지" 는 서버가 아니라 브라우저에 로컬로 저장한다
// (lib/localPrinterMap.ts, LocalPrinterPanel.tsx 가 직접 읽고 쓴다) — PC-NO
// 개념의 옛 방식(label_printers 테이블)은 이 훅에서 더 이상 안 쓴다.
//
// ※ 템플릿은 수십 건 규모라 1000행 페이지네이션 불필요 (설계상 상한 낮음)
// ============================================================

export interface FtUser {
  id: string;
  user_code: string | null;
  vender_name: string | null;
  full_name: string | null;
  username: string | null;
  brand?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export const userLabel = (u: FtUser) =>
  [u.vender_name || u.full_name || u.username, u.user_code].filter(Boolean).join(' ');

export interface LabelSettingsData {
  templates: LabelTemplate[];
  users: FtUser[];
  loading: boolean;
  qzOk: boolean | null;
  /** 이 PC 의 프린터 (이름 + 해상도) */
  qzPrinters: PrinterInfo[];
  reloadTemplates: () => Promise<void>;
  refreshQz: () => Promise<void>;
}

export function useLabelSettingsData(): LabelSettingsData {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [users, setUsers] = useState<FtUser[]>([]);
  const [loading, setLoading] = useState(false);

  const [qzOk, setQzOk] = useState<boolean | null>(null);
  const [qzPrinters, setQzPrinters] = useState<PrinterInfo[]>([]);

  // ── 템플릿 ──
  const reloadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/label-templates');
      const json = await res.json();
      if (json.success) setTemplates(json.data);
    } catch (err) {
      console.error('템플릿 조회 오류:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 사용자 ──
  const reloadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/ft/users');
      const json = await res.json();
      if (json.success) setUsers(json.data);
    } catch (err) {
      console.error('사용자 조회 오류:', err);
    }
  }, []);

  useEffect(() => {
    reloadTemplates();
    reloadUsers();
  }, [reloadTemplates, reloadUsers]);

  // ── QZ 연결 확인 + 프린터 목록(해상도 포함) ──
  //    실제 왕복 통신 1회로 "연결 여부" 와 "목록" 을 동시에 판정한다.
  const refreshQz = useCallback(async () => {
    setQzOk(null);
    try {
      const printers = await listPrinterDetails();
      setQzPrinters(printers);
      setQzOk(true);
    } catch (err) {
      console.error('QZ Tray 연결/프린터 조회 실패:', err);
      setQzPrinters([]);
      setQzOk(false);
    }
  }, []);

  useEffect(() => {
    refreshQz();
  }, [refreshQz]);

  return useMemo(
    () => ({
      templates,
      users,
      loading,
      qzOk,
      qzPrinters,
      reloadTemplates,
      refreshQz,
    }),
    [templates, users, loading, qzOk, qzPrinters, reloadTemplates, refreshQz]
  );
}

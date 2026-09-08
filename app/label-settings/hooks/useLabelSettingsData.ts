'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPrinters } from '../../../lib/qzTray';
import type { LabelPrinterMap, LabelTemplate, LabelType } from '../../../lib/labelTypes';

// ============================================================
// 라벨 설정 화면의 서버/장치 데이터
//   · 템플릿 목록      /api/label-templates
//   · 사용자 목록      /api/ft/users
//   · 프린터 매핑      /api/label-printers
//   · QZ Tray 프린터   localhost 웹소켓
//
// ※ 템플릿·매핑은 수십 건 규모라 Supabase 1000행 페이지네이션 불필요
//   (설계상 사용자 × 라벨종류 조합이 상한)
// ============================================================

export interface FtUser {
  id: string;
  user_code: string | null;
  vender_name: string | null;
  full_name: string | null;
  username: string | null;
}

export const userLabel = (u: FtUser) =>
  [u.vender_name || u.full_name || u.username, u.user_code].filter(Boolean).join(' ');

export interface LabelSettingsData {
  templates: LabelTemplate[];
  users: FtUser[];
  printerMaps: LabelPrinterMap[];
  loading: boolean;
  qzOk: boolean | null;
  qzPrinters: string[];
  stationNo: number;
  setStationNo: (n: number) => void;
  reloadTemplates: () => Promise<void>;
  refreshQz: () => Promise<void>;
  savePrinterMap: (labelType: LabelType, printerName: string) => Promise<string | null>;
  printerFor: (labelType: LabelType) => string | null;
}

export function useLabelSettingsData(): LabelSettingsData {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [users, setUsers] = useState<FtUser[]>([]);
  const [printerMaps, setPrinterMaps] = useState<LabelPrinterMap[]>([]);
  const [loading, setLoading] = useState(false);

  const [qzOk, setQzOk] = useState<boolean | null>(null);
  const [qzPrinters, setQzPrinters] = useState<string[]>([]);
  const [stationNo, setStationNo] = useState(1);

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

  // ── 프린터 매핑 ──
  const reloadPrinterMaps = useCallback(async () => {
    try {
      const res = await fetch('/api/label-printers');
      const json = await res.json();
      if (json.success) setPrinterMaps(json.data);
    } catch (err) {
      console.error('프린터 매핑 조회 오류:', err);
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
    reloadPrinterMaps();
    reloadUsers();
  }, [reloadTemplates, reloadPrinterMaps, reloadUsers]);

  // ── QZ 연결 확인 + 프린터 목록 ──
  //    프린터 조회 1회(실제 왕복 통신)로 "연결 여부"와 "목록"을 동시에 판정한다.
  //    isActive() 만 보면 반쯤 열린 상태를 연결됨으로 오판한다.
  const refreshQz = useCallback(async () => {
    setQzOk(null);
    try {
      const printers = await listPrinters();
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

  // ── 현재 PC-NO 의 종류별 프린터 ──
  const printerFor = useCallback(
    (labelType: LabelType) =>
      printerMaps.find((m) => m.station_no === stationNo && m.label_type === labelType)
        ?.qz_printer_name ?? null,
    [printerMaps, stationNo]
  );

  /** 매핑 저장 — 성공 시 null, 실패 시 오류 메시지 */
  const savePrinterMap = useCallback(
    async (labelType: LabelType, printerName: string): Promise<string | null> => {
      try {
        const res = await fetch('/api/label-printers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            station_no: stationNo,
            label_type: labelType,
            qz_printer_name: printerName,
          }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || '저장 실패');
        await reloadPrinterMaps();
        return null;
      } catch (err) {
        console.error('프린터 매핑 저장 오류:', err);
        return err instanceof Error ? err.message : '프린터 매핑 저장에 실패했습니다.';
      }
    },
    [stationNo, reloadPrinterMaps]
  );

  return useMemo(
    () => ({
      templates,
      users,
      printerMaps,
      loading,
      qzOk,
      qzPrinters,
      stationNo,
      setStationNo,
      reloadTemplates,
      refreshQz,
      savePrinterMap,
      printerFor,
    }),
    [
      templates,
      users,
      printerMaps,
      loading,
      qzOk,
      qzPrinters,
      stationNo,
      reloadTemplates,
      refreshQz,
      savePrinterMap,
      printerFor,
    ]
  );
}

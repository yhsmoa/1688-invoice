'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPrinterDetails, type PrinterInfo } from '../../../lib/qzTray';
import type { LabelPrinterMap, LabelTemplate, LabelType } from '../../../lib/labelTypes';

// ============================================================
// 라벨 설정 화면의 서버/장치 데이터
//   · 템플릿 목록      /api/label-templates
//   · 사용자 목록      /api/ft/users
//   · 프린터 매핑      /api/label-printers  (자리(PC-NO) × 라벨종류 → 프린터명)
//   · QZ Tray 프린터   localhost 웹소켓 — "지금 이 PC" 에 설치된 프린터와 해상도
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

/** 작업 자리(PC-NO) 목록 — 입고 화면의 PC-NO 와 같은 범위 */
export const STATION_NOS = [1, 2, 3, 4];

export interface LabelSettingsData {
  templates: LabelTemplate[];
  users: FtUser[];
  printerMaps: LabelPrinterMap[];
  loading: boolean;
  qzOk: boolean | null;
  /** 이 PC 의 프린터 (이름 + 해상도) */
  qzPrinters: PrinterInfo[];
  /** 테스트 출력에 쓸 자리 */
  stationNo: number;
  setStationNo: (n: number) => void;
  reloadTemplates: () => Promise<void>;
  refreshQz: () => Promise<void>;
  /** 매핑 저장 — 성공 시 null, 실패 시 오류 메시지 */
  savePrinterMap: (station: number, labelType: LabelType, printerName: string) => Promise<string | null>;
  /** 특정 자리·종류의 프린터명 */
  printerAt: (station: number, labelType: LabelType) => string | null;
  /** 현재 테스트 자리의 프린터명 */
  printerFor: (labelType: LabelType) => string | null;
  /** 이 PC 가 아는 프린터 정보 (해상도) — 없으면 undefined */
  printerInfo: (name: string | null) => PrinterInfo | undefined;
}

export function useLabelSettingsData(): LabelSettingsData {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [users, setUsers] = useState<FtUser[]>([]);
  const [printerMaps, setPrinterMaps] = useState<LabelPrinterMap[]>([]);
  const [loading, setLoading] = useState(false);

  const [qzOk, setQzOk] = useState<boolean | null>(null);
  const [qzPrinters, setQzPrinters] = useState<PrinterInfo[]>([]);
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

  // ── 조회 헬퍼 ──
  const printerAt = useCallback(
    (station: number, labelType: LabelType) =>
      printerMaps.find((m) => m.station_no === station && m.label_type === labelType)
        ?.qz_printer_name ?? null,
    [printerMaps]
  );

  const printerFor = useCallback(
    (labelType: LabelType) => printerAt(stationNo, labelType),
    [printerAt, stationNo]
  );

  const printerInfo = useCallback(
    (name: string | null) => (name ? qzPrinters.find((p) => p.name === name) : undefined),
    [qzPrinters]
  );

  /** 매핑 저장 — 바꾸는 즉시 서버에 반영되고, 서버가 돌려준 값으로 화면을 갱신한다 */
  const savePrinterMap = useCallback(
    async (station: number, labelType: LabelType, printerName: string): Promise<string | null> => {
      try {
        const res = await fetch('/api/label-printers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            station_no: station,
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
    [reloadPrinterMaps]
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
      printerAt,
      printerFor,
      printerInfo,
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
      printerAt,
      printerFor,
      printerInfo,
    ]
  );
}

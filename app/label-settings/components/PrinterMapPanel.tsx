'use client';

import React, { useEffect, useState } from 'react';
import type { LabelType } from '../../../lib/labelTypes';
import { QZ_NOT_RUNNING, type PrinterInfo } from '../../../lib/qzTray';
import { STATION_NOS } from '../hooks/useLabelSettingsData';
import { LABEL_TYPES } from './TemplateListPanel';

// ============================================================
// 자리(PC-NO)별 프린터 매핑 (좌측 컬럼 하단)
//
// 규칙
//   · 자리마다 케어라벨/바코드 프린터를 1대씩 지정한다. 자리끼리 독립.
//   · 바꾸는 즉시 서버에 저장된다. 템플릿 [저장] 버튼과는 무관.
//   · 입고 화면에서 작업자가 고른 PC-NO 의 매핑으로 인쇄된다.
//   · 드롭다운 목록은 "지금 이 PC(QZ Tray)" 에 보이는 프린터다.
//     프린터 이름은 PC 마다 다르므로, 각 자리의 매핑은 그 자리 PC 에서 지정하는 게 안전하다.
//     다른 PC 에서 지정한 이름이 이 PC 에 없으면 "(이 PC 에 없음)" 으로 표시하되 값은 유지한다.
// ============================================================

interface Props {
  stationNo: number;
  onStationNo: (n: number) => void;
  qzOk: boolean | null;
  qzPrinters: PrinterInfo[];
  printerAt: (station: number, t: LabelType) => string | null;
  /** 저장 — 성공 시 null, 실패 시 오류 메시지 */
  onSave: (station: number, t: LabelType, printer: string) => Promise<string | null>;
  onRefreshQz: () => void;
}

const SAVED_FLASH_MS = 1800;

const printerLabel = (p: PrinterInfo) => (p.dpi ? `${p.name} · ${p.dpi}dpi` : p.name);

const PrinterMapPanel: React.FC<Props> = ({
  stationNo,
  onStationNo,
  qzOk,
  qzPrinters,
  printerAt,
  onSave,
  onRefreshQz,
}) => {
  /** 방금 저장된 칸 ("1:care") — 잠깐 "저장됨" 표시 */
  const [flash, setFlash] = useState<string | null>(null);
  const [cellError, setCellError] = useState<{ key: string; msg: string } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const handleChange = async (station: number, t: LabelType, printer: string) => {
    const key = `${station}:${t}`;
    setCellError(null);
    const err = await onSave(station, t, printer);
    if (err) setCellError({ key, msg: err });
    else setFlash(key);
  };

  return (
    <section className="ls-panel">
      <div className="ls-panel-title">
        프린터 매핑
        <button className="ls-btn-ghost ls-btn-xs" onClick={onRefreshQz}>
          프린터 다시 찾기
        </button>
      </div>

      <div className="ls-hint ls-mb8">
        자리(PC-NO)마다 어떤 프린터로 뽑을지 정합니다. <b>바꾸면 즉시 저장</b>되고, 입고 화면에서
        고른 PC-NO 의 매핑으로 인쇄됩니다. 목록은 <b>지금 이 PC</b>에 보이는 프린터이므로 각
        자리는 그 자리 PC 에서 지정하세요.
      </div>

      <table className="ls-map-table">
        <thead>
          <tr>
            <th>자리</th>
            {LABEL_TYPES.map((t) => (
              <th key={t.key}>{t.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STATION_NOS.map((station) => (
            <tr key={station} className={station === stationNo ? 'is-test' : ''}>
              <td>
                <label className="ls-map-station" title="테스트 출력에 쓸 자리">
                  <input
                    type="radio"
                    name="ls-test-station"
                    checked={station === stationNo}
                    onChange={() => onStationNo(station)}
                  />
                  {station}번
                </label>
              </td>
              {LABEL_TYPES.map((t) => {
                const key = `${station}:${t.key}`;
                const current = printerAt(station, t.key);
                const known = current ? qzPrinters.some((p) => p.name === current) : true;
                return (
                  <td key={t.key}>
                    <select
                      value={current ?? ''}
                      onChange={(e) => handleChange(station, t.key, e.target.value)}
                      disabled={!qzOk}
                      className={!known ? 'is-missing' : ''}
                    >
                      <option value="">(지정 안 함)</option>
                      {qzPrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {printerLabel(p)}
                        </option>
                      ))}
                      {current && !known && (
                        <option value={current}>{current} (이 PC 에 없음)</option>
                      )}
                    </select>
                    {flash === key && <span className="ls-map-saved">저장됨</span>}
                    {cellError?.key === key && (
                      <span className="ls-map-error" title={cellError.msg}>
                        저장 실패
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ls-hint ls-mt8">
        ● 표시된 자리가 상단 [테스트 출력] 버튼에 쓰입니다. 새 인쇄 PC 설정: QZ Tray 설치 →{' '}
        <a href="/api/qz/cert?download=1" download="override.crt">
          override.crt 내려받기
        </a>{' '}
        → qz-tray.exe 와 같은 폴더에 넣고 QZ Tray 재시작.
      </div>

      {qzOk === false && (
        <div className="ls-warn">
          {QZ_NOT_RUNNING}
          <br />
          QZ Tray가 떠 있는데도 이 상태라면, 이전에 이 사이트를 <b>차단</b>했을 수 있습니다.
          트레이 아이콘 → Advanced → Site Manager에서 localhost 항목을 지운 뒤 [프린터 다시 찾기]를
          누르세요.
        </div>
      )}
      {qzOk === null && (
        <div className="ls-warn">
          QZ Tray에 프린터 목록을 요청하는 중입니다. 오래 걸리면 QZ Tray의 <b>허용/차단 창</b>이
          다른 창 뒤에 떠 있는지 확인하고 [허용]을 누르세요. 목록을 받아야 드롭다운이 열립니다.
        </div>
      )}
    </section>
  );
};

export default PrinterMapPanel;

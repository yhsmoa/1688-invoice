'use client';

import React from 'react';
import type { LabelType } from '../../../lib/labelTypes';
import { QZ_NOT_RUNNING } from '../../../lib/qzTray';
import { LABEL_TYPES } from './TemplateListPanel';

// ============================================================
// PC-NO(작업 자리)별 프린터 매핑 (좌측 컬럼 하단)
//
// 작업 자리마다 케어라벨/바코드 프린터를 1대씩 지정한다.
// 여기서 고른 PC-NO 는 테스트 출력에도 그대로 쓰인다.
// ============================================================

const PC_NO_OPTIONS = [1, 2, 3, 4];

interface Props {
  stationNo: number;
  onStationNo: (n: number) => void;
  qzOk: boolean | null;
  qzPrinters: string[];
  printerFor: (t: LabelType) => string | null;
  onSave: (t: LabelType, printer: string) => void;
  onRefreshQz: () => void;
}

const PrinterMapPanel: React.FC<Props> = ({
  stationNo,
  onStationNo,
  qzOk,
  qzPrinters,
  printerFor,
  onSave,
  onRefreshQz,
}) => (
  <section className="ls-panel">
    <div className="ls-panel-title">
      프린터 매핑
      <button className="ls-btn-ghost ls-btn-xs" onClick={onRefreshQz}>
        프린터 다시 찾기
      </button>
    </div>

    <div className="ls-grid-2">
      <label className="ls-field ls-col-2">
        <span>PC-NO (작업 자리)</span>
        <select value={stationNo} onChange={(e) => onStationNo(Number(e.target.value))}>
          {PC_NO_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}번 자리
            </option>
          ))}
        </select>
      </label>

      {LABEL_TYPES.map((t) => {
        const current = printerFor(t.key);
        return (
          <label className="ls-field ls-col-2" key={t.key}>
            <span>{t.label} 프린터</span>
            <select
              value={current ?? ''}
              onChange={(e) => onSave(t.key, e.target.value)}
              disabled={!qzOk}
            >
              <option value="">(지정 안 함)</option>
              {qzPrinters.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {/* 저장돼 있지만 지금 이 PC 에 없는 프린터도 값은 유지해서 보여준다 */}
              {current && !qzPrinters.includes(current) && (
                <option value={current}>{current} (현재 미연결)</option>
              )}
            </select>
          </label>
        );
      })}
    </div>

    <div className="ls-hint ls-mt8">
      새 인쇄 PC 설정: QZ Tray 설치 →{' '}
      <a href="/api/qz/cert?download=1" download="override.crt">
        override.crt 내려받기
      </a>{' '}
      → qz-tray.exe 와 같은 폴더에 넣고 QZ Tray 재시작. 이후 허용 창 없이 인쇄됩니다.
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

export default PrinterMapPanel;

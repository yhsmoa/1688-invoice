'use client';

import React, { useEffect, useState } from 'react';
import { audiencesLabel, type LabelTemplate } from '../../../lib/labelTypes';
import { QZ_NOT_RUNNING, type PrinterInfo } from '../../../lib/qzTray';
import { getAllLocalPrinters, setLocalPrinter } from '../../../lib/localPrinterMap';

// ============================================================
// 프린터 — 템플릿 보드(TemplateBoard)의 "프린터" 탭 내용.
//
// PC-NO(자리 번호) 개념이 없다. 대신 템플릿마다 "이 PC 에서 어떤 프린터로
// 뽑을지" 를 브라우저에 저장한다(lib/localPrinterMap.ts) — 다른 PC 에는
// 전혀 영향을 안 준다. 같은 템플릿이라도 PC 마다 따로 지정해야 한다.
//
// 이 탭은 현재 편집 중인 템플릿 하나가 아니라 "전체 템플릿 목록" 을 보여준다 —
// 이 PC 를 처음 쓰기 시작할 때 한 번에 전부 지정해 두라는 뜻.
// ============================================================

const SAVED_FLASH_MS = 1800;

const printerLabel = (p: PrinterInfo) => (p.dpi ? `${p.name} · ${p.dpi}dpi` : p.name);

interface Props {
  templates: LabelTemplate[];
  qzOk: boolean | null;
  qzPrinters: PrinterInfo[];
  onRefreshQz: () => void;
}

const LocalPrinterPanel: React.FC<Props> = ({ templates, qzOk, qzPrinters, onRefreshQz }) => {
  const [map, setMap] = useState<Record<string, string>>({});
  const [flashId, setFlashId] = useState<string | null>(null);

  // 이 PC 의 저장값은 localStorage 라 마운트 시 한 번 읽는다 (SSR 에서는 빈 값)
  useEffect(() => {
    setMap(getAllLocalPrinters());
  }, []);

  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [flashId]);

  const handleChange = (templateId: string, printerName: string) => {
    setLocalPrinter(templateId, printerName);
    setMap((prev) => {
      const next = { ...prev };
      if (printerName) next[templateId] = printerName;
      else delete next[templateId];
      return next;
    });
    setFlashId(templateId);
  };

  return (
    <>
      <div className="ls-panel-inline-title">
        프린터 (이 PC 전용)
        <button className="ls-btn-ghost ls-btn-xs" onClick={onRefreshQz}>
          프린터 다시 찾기
        </button>
      </div>

      <div className="ls-hint ls-mb8">
        여기서 고른 프린터는 <b>지금 이 PC</b>에만 저장됩니다. 같은 템플릿이라도 프린터가 설치된
        PC 마다 여기서 한 번씩 지정해야 합니다. 자리 번호(PC-NO) 개념은 이제 안 씁니다.
      </div>

      {templates.length === 0 ? (
        <div className="ls-empty">템플릿이 없습니다. 템플릿 탭에서 먼저 만드세요.</div>
      ) : (
        <table className="ls-map-table">
          <thead>
            <tr>
              <th>템플릿</th>
              <th>이 PC 프린터</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const current = map[t.id] ?? '';
              const known = current ? qzPrinters.some((p) => p.name === current) : true;
              return (
                <tr key={t.id}>
                  <td>
                    <div className="ls-map-tpl-name">{t.name}</div>
                    {t.description && <div className="ls-map-tpl-desc">{t.description}</div>}
                    <div className="ls-map-tpl-meta">
                      {t.label_type === 'care' ? '케어' : '바코드'} · {audiencesLabel(t)} · {t.dpi}dpi
                    </div>
                  </td>
                  <td>
                    <select
                      value={current}
                      onChange={(e) => handleChange(t.id, e.target.value)}
                      disabled={!qzOk}
                      className={!known ? 'is-missing' : ''}
                    >
                      <option value="">(지정 안 함)</option>
                      {qzPrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {printerLabel(p)}
                        </option>
                      ))}
                      {current && !known && <option value={current}>{current} (이 PC 에 없음)</option>}
                    </select>
                    {flashId === t.id && <span className="ls-map-saved">저장됨(이 PC)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="ls-hint ls-mt8">
        새 인쇄 PC 설정: QZ Tray 설치 →{' '}
        <a href="/api/qz/cert?download=1" download="override.crt">
          override.crt 내려받기
        </a>{' '}
        → qz-tray.exe 와 같은 폴더에 넣고 QZ Tray 재시작 → 이 탭에서 템플릿마다 프린터 지정.
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
          다른 창 뒤에 떠 있는지 확인하고 [허용]을 누르세요.
        </div>
      )}
    </>
  );
};

export default LocalPrinterPanel;

'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Worker } from '../../shipment-v2/types';
import { workerLabel } from '../../shipment-v2/hooks/useWorkers';

// ============================================================
// WorkerSelect — 담당자 선택 화면 (모바일 작업 화면 공용: /m/wow · /m/putaway)
//   작업 기록(찾음 · 부족 · 메모 · 작업완료 · 배치)에 남을 이름을 먼저 고른다.
//   고른 이름은 이 폰에 기억된다 (hooks/useRememberedWorker)
//   모양은 ../Mobile.css 의 "담당자 선택" (부르는 화면이 Mobile.css 를 불러온다)
// ============================================================

interface WorkerSelectProps {
  workers: Worker[];
  /** 지금 기억하고 있는 담당자 ('' = 없음) */
  current: string;
  onChoose: (operatorName: string) => void;
}

const WorkerSelect: React.FC<WorkerSelectProps> = ({ workers, current, onChoose }) => {
  const { t } = useTranslation();
  const [picked, setPicked] = useState(current);

  // ── 기억한 담당자가 바뀌면(목록에서 빠져 지워짐 등) 고른 값도 맞춘다 ──
  useEffect(() => { setPicked(current); }, [current]);

  return (
    <main className="mob-body">
      <div className="mob-hero">
        <h1>{t('mobile.wow.worker.title')}</h1>
        <p>{t('mobile.wow.worker.desc')}</p>
      </div>

      <label className="mob-field">
        {t('mobile.wow.worker.label')}
        <select className="mob-input mob-select" value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">{t('mobile.wow.worker.placeholder')}</option>
          {workers.map((w) => (
            <option key={w.id} value={workerLabel(w)}>{workerLabel(w)}</option>
          ))}
        </select>
      </label>

      <button type="button" className="mob-btn accent" disabled={!picked} onClick={() => onChoose(picked)}>
        {t('mobile.wow.worker.start')}
      </button>
    </main>
  );
};

export default WorkerSelect;

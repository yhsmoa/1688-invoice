// ============================================================
// 메모 줄 기록 (memo line log) — 서버·브라우저 공용 (DOM 없음)
//
//   ft_seller_inquiries.memo (text) 에 한 줄 = 기록 1개로 쌓는다.
//     형식: `MM.DD HH:mm <내용>`  (KST, 연도 생략 — 예: `11.06 18:56 판매자 재발송 약속`)
//   · 추가   : 맨 아래에 지금 시각 도장 + 내용 1줄
//   · 수정   : 그 줄의 내용만 바꾸고 원래 도장은 그대로 둔다
//   · 삭제   : 그 줄만 지운다
//   · 도장이 없는 줄 = 예전(기록 형식 이전) 메모 — 그대로 보여 주고, 수정해도 도장을 붙이지 않는다
//   한 기록 안의 줄바꿈은 공백 1칸으로 합친다 (기록 1개 = 1줄)
//
//   쓰는 곳: POST /api/ft/seller-inquiries (접수 메모) · PATCH /api/ft/seller-inquiries/[id] (memo_op)
//            /seller-inquiry 목록 [메모] 칸 (components/MemoCell)
//   서버(싱가포르)에서도 KST 로 찍도록 timeZone 을 항상 명시한다.
// ============================================================

// ============================================================
// 형식
// ============================================================
export const MEMO_STAMP_RE = /^(\d{2}\.\d{2} \d{2}:\d{2}) (.*)$/;

/** 도장 시간대 — 화면·서버 어디서든 같은 값 */
export const MEMO_TIME_ZONE = 'Asia/Seoul';

const STAMP_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: MEMO_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface MemoLine {
  /** DB 에 저장된 줄 그대로 */
  raw: string;
  /** `MM.DD HH:mm` — 예전 메모 줄이면 null */
  stamp: string | null;
  /** 도장을 뺀 내용 */
  text: string;
}

/** 줄 번호가 범위를 벗어났을 때 (화면이 본 메모와 DB 가 달라짐) */
export class MemoLineIndexError extends Error {
  constructor(index: number, length: number) {
    super(`메모 줄 번호가 올바르지 않습니다 (${index} / ${length}).`);
    this.name = 'MemoLineIndexError';
  }
}

// ============================================================
// 도장 · 파싱 · 합치기
// ============================================================

/** `MM.DD HH:mm` (KST, 0 채움) */
export function formatMemoStamp(date: Date): string {
  const parts = STAMP_FORMAT.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 메모 → 줄 목록 (빈 줄 제외) */
export function parseMemoLines(memo: string | null): MemoLine[] {
  if (!memo) return [];
  return memo
    .split(/\r?\n/)
    .filter((raw) => raw.trim() !== '')
    .map((raw) => {
      const m = MEMO_STAMP_RE.exec(raw);
      return m ? { raw, stamp: m[1], text: m[2] } : { raw, stamp: null, text: raw };
    });
}

/** 줄 목록 → 메모 (비면 null) */
export function joinMemoLines(lines: string[]): string | null {
  const kept = lines.filter((l) => l.trim() !== '');
  return kept.length > 0 ? kept.join('\n') : null;
}

/** 기록 1개 내용 정리 — 앞뒤 공백 제거 · 줄바꿈은 공백 1칸 (기록 1개 = 1줄) */
export function sanitizeMemoText(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

// ============================================================
// 줄 단위 조작 — 결과 메모 문자열(비면 null)을 돌려준다
// ============================================================

/** 맨 아래에 `now` 도장 + 내용 1줄 추가 (내용이 비면 그대로) */
export function appendMemoLine(memo: string | null, text: string, now: Date): string | null {
  const clean = sanitizeMemoText(text);
  const raws = parseMemoLines(memo).map((l) => l.raw);
  if (clean) raws.push(`${formatMemoStamp(now)} ${clean}`);
  return joinMemoLines(raws);
}

/** index 줄의 내용만 바꾼다 — 원래 도장 유지, 예전 줄은 도장 없이 */
export function editMemoLine(memo: string | null, index: number, text: string): string | null {
  const lines = parseMemoLines(memo);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) throw new MemoLineIndexError(index, lines.length);
  const clean = sanitizeMemoText(text);
  const target = lines[index];
  const raws = lines.map((l) => l.raw);
  raws[index] = target.stamp ? `${target.stamp} ${clean}` : clean;
  return joinMemoLines(raws);
}

/** index 줄 삭제 */
export function deleteMemoLine(memo: string | null, index: number): string | null {
  const lines = parseMemoLines(memo);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) throw new MemoLineIndexError(index, lines.length);
  return joinMemoLines(lines.filter((_, i) => i !== index).map((l) => l.raw));
}

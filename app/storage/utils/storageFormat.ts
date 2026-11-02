// ============================================================
// 재고(보관) 화면 공용 유틸
// ============================================================

// ── 주문번호 라벨 → product_no (상품출고 V2 와 같은 정규화) ──
//   BZ-260224-0202-A01 → BZ-260224-0202  (토막이 3개 넘으면 앞 3개)
export function normalizeProductNo(scanned: string): string {
  const trimmed = scanned.trim();
  const parts = trimmed.split('-');
  return parts.length > 3 ? parts.slice(0, 3).join('-') : trimmed;
}

// ── 경과 일수 (내림) — 값이 없거나 잘못되면 null ──
const DAY_MS = 86_400_000;
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

// ── 날짜 표시 MM-DD HH:mm (브라우저 로컬 = 창고 PC 한국 시간) ──
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 옵션 표시 (한국어 / 중국어) ──
export const joinOptions = (...parts: (string | null | undefined)[]): string =>
  parts.map((p) => p?.trim()).filter(Boolean).join(' / ');

// ============================================================
// 스캔 오류음 — 상품출고 V2 의 오류음과 같은 3음 비프
//   (바코드 리더로 연속 스캔하는 작업자가 화면을 보지 않아도 알 수 있게)
// ============================================================
export function playErrorSound(): void {
  try {
    const Ctx = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (freq: number, start: number, end: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.7, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + end);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + end);
    };
    beep(1000, 0, 0.15);
    beep(600, 0.2, 0.35);
    beep(1000, 0.4, 0.55);
  } catch (err) {
    console.error('오류음 재생 실패:', err);
  }
}

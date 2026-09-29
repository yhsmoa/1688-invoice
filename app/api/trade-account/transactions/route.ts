import { NextRequest, NextResponse } from 'next/server';
import { requireDbAccess } from '../../../../lib/dbAccess';
import { recordCompanyRows, TradeError, type CompanyRowInput } from '../../../../lib/tradeLedgerServer';
import { COMPANY_CATEGORIES, isAdjustCategory, todayKST } from '../../../../lib/tradeLedger';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// POST /api/trade-account/transactions
//   Body: { rows: [{ applied_date, category, type?, amount, krw_amount?, description, reference_id, admin_note? }] }
//   경비·인출·자본투입·환차·보정 기록 (rpc trade_record — 한 트랜잭션)
//   급여는 /payroll/commit
// ============================================================
export async function POST(request: NextRequest) {
  const access = await requireDbAccess(request);
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const raw = Array.isArray(body?.rows) ? (body.rows as Record<string, unknown>[]) : [];
    if (raw.length === 0) throw new TradeError('기록할 행이 없습니다.');

    const rows: CompanyRowInput[] = raw.map((r, i) => {
      const category = String(r.category ?? '');
      if (!(COMPANY_CATEGORIES as readonly string[]).includes(category)) throw new TradeError(`${i + 1}번째 행: 구분이 올바르지 않습니다.`);
      const appliedDate = String(r.applied_date ?? '');
      if (!DATE_RE.test(appliedDate)) throw new TradeError(`${i + 1}번째 행: 적용일 형식이 올바르지 않습니다.`);
      if (appliedDate > todayKST()) throw new TradeError(`${i + 1}번째 행: 적용일은 오늘(KST) 이후로 지정할 수 없습니다.`);
      const amount = Number(r.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new TradeError(`${i + 1}번째 행: 금액은 0보다 커야 합니다.`);
      const description = String(r.description ?? '').trim();
      if (!description) throw new TradeError(`${i + 1}번째 행: 내용을 입력해주세요.`);
      const referenceId = String(r.reference_id ?? '').trim();
      if (!referenceId) throw new TradeError(`${i + 1}번째 행: 참조키가 없습니다.`);
      const krw = r.krw_amount == null || r.krw_amount === '' ? null : Number(r.krw_amount);
      if (krw != null && !(Number.isFinite(krw) && krw > 0)) throw new TradeError(`${i + 1}번째 행: 원화 금액은 0보다 커야 합니다.`);
      const type = r.type === 'in' || r.type === 'out' ? r.type : null;
      const adminNote = r.admin_note != null ? String(r.admin_note).trim() || null : null;
      if (isAdjustCategory(category)) {
        if (!type) throw new TradeError(`${i + 1}번째 행: 환차·보정은 입금/출금을 골라야 합니다.`);
        if (!adminNote) throw new TradeError(`${i + 1}번째 행: 환차·보정은 사유를 입력해야 합니다.`);
      }
      return {
        applied_date: appliedDate, category, type,
        amount: Math.round(amount * 100) / 100,
        krw_amount: krw == null ? null : Math.round(krw * 100) / 100,
        description, reference_id: referenceId, admin_note: adminNote,
      };
    });

    const ids = await recordCompanyRows(rows, access.employeeId);
    return NextResponse.json({ success: true, ids });
  } catch (error) {
    if (error instanceof TradeError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('무역계좌 기록 오류:', error);
    return NextResponse.json({ success: false, error: '기록 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

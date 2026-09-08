import { NextRequest, NextResponse } from 'next/server';
import { createSign, createPrivateKey, type KeyObject } from 'crypto';

export const dynamic = 'force-dynamic';

// ============================================================
// QZ Tray 요청 서명 — POST /api/qz/sign   body: { request: string }
//
// qz-tray.js 는 권한이 필요한 호출(인쇄·프린터 조회)마다
//   1) 호출 내용을 SHA-256 으로 해시한 문자열을 만들고
//   2) 그 문자열을 이 API 로 보내 서명을 받아
//   3) 서명을 실어 QZ Tray 에 보낸다.
// QZ Tray 는 신뢰한 인증서(override.crt)의 공개키로 서명을 검증한다.
// 검증이 통과하면 허용 창 없이 바로 실행된다.
//
// 서명 알고리즘은 클라이언트의 setSignatureAlgorithm 과 반드시 같아야 한다 → SHA512withRSA.
// 개인키는 서버 환경변수(QZ_PRIVATE_KEY)에만 있고 브라우저로 나가지 않는다.
// ============================================================

const SIGN_ALGORITHM = 'RSA-SHA512';
/** 해시 문자열(64자) + 여유. 이보다 길면 정상 요청이 아니다 */
const MAX_REQUEST_LEN = 512;

let cachedKey: KeyObject | null | undefined;

/** env 의 \n 이스케이프를 실제 개행으로 되돌려 KeyObject 로 (1회 파싱 후 재사용) */
function privateKey(): KeyObject | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.QZ_PRIVATE_KEY;
  if (!raw) {
    cachedKey = null;
    return null;
  }
  try {
    cachedKey = createPrivateKey(raw.replace(/\\n/g, '\n'));
  } catch (err) {
    console.error('QZ_PRIVATE_KEY 파싱 실패:', err);
    cachedKey = null;
  }
  return cachedKey;
}

export async function POST(request: NextRequest) {
  try {
    const key = privateKey();
    if (!key) {
      return NextResponse.json(
        { success: false, error: 'QZ_PRIVATE_KEY 가 설정되지 않았습니다.' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => null);
    const toSign = body?.request;
    if (typeof toSign !== 'string' || !toSign || toSign.length > MAX_REQUEST_LEN) {
      return NextResponse.json(
        { success: false, error: '서명할 요청 문자열이 올바르지 않습니다.' },
        { status: 400 }
      );
    }

    const signer = createSign(SIGN_ALGORITHM);
    signer.update(toSign, 'utf8');
    const signature = signer.sign(key, 'base64');

    return NextResponse.json({ success: true, signature });
  } catch (error) {
    console.error('QZ 서명 오류:', error);
    return NextResponse.json(
      { success: false, error: '서명 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// ============================================================
// 라벨 즉시출력 — 공용 타입
//
// 템플릿 레이아웃은 "전부 mm" 로 저장한다.
//   · 프린터 해상도(DPI)가 달라도 양식이 깨지지 않음
//   · 인쇄 순간에만 dots 로 변환 (lib/labelRender.ts + lib/tspl.ts)
//
// ⚠️ layout 은 DB(JSONB)에 그대로 들어간다. 새 속성은 전부 optional 로 추가해
//    기존에 저장된 템플릿이 그대로 열리도록 유지한다.
// ============================================================

export type LabelType = 'care' | 'barcode';

/** 용지 종류 (LabelTemplate.media 참고) */
export type LabelMedia = 'gap' | 'continuous' | 'blackmark';

/** 자동 절단 (LabelTemplate.cutter) */
export type LabelCutter = 'off' | 'each' | 'batch';

export const LABEL_CUTTER: { key: LabelCutter; label: string }[] = [
  { key: 'off', label: '절단 안 함' },
  { key: 'each', label: '매 장 절단' },
  { key: 'batch', label: '묶음 끝에 한 번 절단' },
];

export const LABEL_MEDIA: { key: LabelMedia; label: string; hint: string }[] = [
  { key: 'gap', label: '틈 있는 라벨 (일반 스티커)', hint: '라벨 사이 투명 틈을 센서가 찾습니다.' },
  {
    key: 'continuous',
    label: '연속 용지 (케어라벨 리본)',
    hint: '틈이 없는 롤. 틈 설정으로 찍으면 용지를 찾다가 빨간불로 멈춥니다.',
  },
  { key: 'blackmark', label: '블랙마크 용지', hint: '뒷면 검은 띠로 라벨을 구분합니다.' },
];

/** 바코드 심볼로지 (TSPL BARCODE 명령의 코드명과 동일) */
export type Symbology = '128' | '128M' | 'EAN13' | 'EAN8' | 'UPCA' | '39' | '93';

/** 요소 회전 — TSPL 은 시계방향 0/90/180/270 만 지원한다 */
export type Rotation = 0 | 90 | 180 | 270;

/** 텍스트 가로 정렬 (max_w_mm 블록 기준) */
export type TextAlign = 'left' | 'center' | 'right';

/** 텍스트 세로 정렬 (영역 h_mm 기준) */
export type TextVAlign = 'top' | 'middle' | 'bottom';

/**
 * 영역을 넘칠 때
 *   shrink: 글자 크기를 min_pt 까지 줄여 가며 맞춘다 (기본). 그래도 넘치면 잘라내고 경고
 *   clip  : 크기는 그대로 두고 넘치는 줄을 잘라낸다
 */
export type TextOverflow = 'shrink' | 'clip';

/** 자동 축소 하한 (pt) — 이보다 작으면 감열 프린터에서 읽을 수 없다 */
export const DEFAULT_MIN_PT = 5;
/** 자동 축소 단계 (pt) */
export const SHRINK_STEP_PT = 0.5;
/** 기본 줄 간격 배수 */
export const DEFAULT_LINE_GAP = 1.25;

// ============================================================
// 레이아웃 요소
// ============================================================
interface ElementBase {
  /** 편집기 내부 키 (React key / 선택 상태) */
  id: string;
  /** 요소 목록에 표시할 이름. 없으면 내용으로 자동 표기 */
  name?: string;
  x_mm: number;
  y_mm: number;
  /** 시계방향 회전 (기본 0) */
  rotate?: Rotation;
  /** 잠금 — 캔버스에서 드래그/선택 불가 */
  locked?: boolean;
  /** 숨김 — 미리보기·인쇄에서 제외 (양식 시안 비교용) */
  hidden?: boolean;
}

export interface TextElement extends ElementBase {
  type: 'text';
  /**
   * 바인딩 필드명 (LABEL_FIELDS).
   * 지정하면 그 필드값만 출력한다. 비우면 text 를 쓰고, text 안의
   * `{필드명}` 자리표시자가 데이터로 치환된다. (예: `수량 {qty}개`)
   */
  field?: string;
  /** 고정 문구 (+ `{필드}` 자리표시자) */
  text?: string;
  size_pt: number;
  bold?: boolean;
  italic?: boolean;
  /** 글꼴 — 미지정 시 DEFAULT_FONT */
  font_family?: string;
  /** 가로 정렬 (max_w_mm 블록 기준, 기본 left) */
  align?: TextAlign;
  /** 영역 폭 (mm). 없으면 라벨 우측 끝까지 */
  max_w_mm?: number;
  /**
   * 영역 높이 (mm) — 바텐더의 "텍스트 상자".
   * 지정하면 영역 모드: 폭에서 항상 줄바꿈하고, 높이를 넘는 줄은 overflow 정책대로.
   * 없으면 한 줄 모드 (wrap / max_lines 가 적용되는 옛 방식).
   */
  h_mm?: number;
  /** 영역 모드에서 넘칠 때 (기본 shrink) */
  overflow?: TextOverflow;
  /** 자동 축소 하한 pt (기본 DEFAULT_MIN_PT) */
  min_pt?: number;
  /** 영역 안 세로 정렬 (기본 top) */
  v_align?: TextVAlign;
  /**
   * [한 줄 모드 전용] 자동 줄바꿈. 영역 모드(h_mm)에서는 항상 켜진 것으로 본다.
   */
  wrap?: boolean;
  /** [한 줄 모드 전용] 최대 줄 수. 영역 모드에서는 높이로 계산된다 */
  max_lines?: number;
  /** 줄 간격 배수 (기본 1.25) */
  line_gap?: number;
  /** 글자 간격 (mm) — 음수 가능. 좁은 라벨에서 미세 조정용 */
  letter_spacing_mm?: number;
  /** 검정 배경 + 흰 글씨 (반전) */
  invert?: boolean;
}

export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  field?: string;
  text?: string;
  symbology: Symbology;
  h_mm: number;
  /** 좁은 바 두께 (dots) — 2~3 권장 */
  narrow: number;
  /** 넓은 바 두께 (dots) — Code39 등 2폭 심볼로지용 (Code128 은 narrow 만 쓴다) */
  wide: number;
  /** 바코드 아래 숫자 표시 */
  human_readable?: boolean;
  /** 아래 숫자 글자 크기 pt (기본 7) */
  text_pt?: number;
  /**
   * 정렬 — 바코드 폭은 데이터 길이로 정해지므로 "영역 폭(max_w_mm)" 안에서 놓는다.
   * max_w_mm 이 없으면 라벨 오른쪽 끝까지가 영역. 기본 left.
   */
  align?: TextAlign;
  /** 정렬 기준 영역 폭 (mm). 없으면 x 부터 라벨 오른쪽 끝까지 */
  max_w_mm?: number;
}

export interface QrElement extends ElementBase {
  type: 'qr';
  field?: string;
  text?: string;
  /** 셀 크기 1~10 (dots/모듈) */
  cell: number;
  /** 오류정정 L/M/Q/H */
  ecc: 'L' | 'M' | 'Q' | 'H';
  /** 정렬 (바코드와 같은 규칙) */
  align?: TextAlign;
  /** 정렬 기준 영역 폭 (mm) */
  max_w_mm?: number;
}

export interface BoxElement extends ElementBase {
  type: 'box';
  w_mm: number;
  h_mm: number;
  /** 선 두께 (mm) */
  thickness_mm: number;
  /** 내부 채우기 (검정) */
  filled?: boolean;
}

export interface LineElement extends ElementBase {
  type: 'line';
  w_mm: number;
  h_mm: number;
}

/**
 * 이미지 — 세탁 기호·로고 등. 흑백 1비트로 찍힌다.
 *   symbol: 내장 세탁 기호 키 (lib/careSymbols.ts) — 템플릿이 가벼움
 *   src   : 업로드한 이미지 data URL (PNG/SVG) — 로고 등
 * 둘 다 있으면 symbol 우선.
 */
export interface ImageElement extends ElementBase {
  type: 'image';
  symbol?: string;
  src?: string;
  w_mm: number;
  h_mm: number;
  /** 크기 조절 시 가로세로 비율 유지 (기본 true) */
  keep_ratio?: boolean;
  /** 흑백 변환 임계값 0~255 (기본 128). 낮을수록 검정이 줄어든다 */
  threshold?: number;
}

export type LabelElement =
  | TextElement
  | BarcodeElement
  | QrElement
  | BoxElement
  | LineElement
  | ImageElement;

/** 데이터 바인딩이 가능한 요소 (field / text 를 가진 것) */
export type BindableElement = TextElement | BarcodeElement | QrElement;

export function isBindable(el: LabelElement): el is BindableElement {
  return el.type === 'text' || el.type === 'barcode' || el.type === 'qr';
}

// ============================================================
// 템플릿
// ============================================================
export interface LabelTemplate {
  id: string;
  /** ft_users.id — null 이면 공용 템플릿 */
  user_id: string | null;
  name: string;
  label_type: LabelType;
  printer_lang: string;
  width_mm: number;
  height_mm: number;
  /**
   * 라벨 사이 틈(mm). media 가 gap 이면 GAP 명령, blackmark 면 BLINE(마크 높이)로 나간다.
   * continuous 에서는 무시된다.
   */
  gap_mm: number;
  /**
   * 용지 종류 — 센서 설정이 달라서 틀리면 프린터가 용지를 찾다가 빨간불로 멈춘다.
   *   gap        : 라벨 사이에 틈이 있는 일반 스티커 (기본)
   *   continuous : 틈 없는 연속 용지 — 케어라벨 리본(나일론·새틴)이 여기 해당
   *   blackmark  : 뒷면 검은 띠로 구분하는 용지
   */
  media?: LabelMedia;
  /** 자동 절단 — 절단기 달린 프린터에서 SET CUTTER 로 나간다 (기본 off) */
  cutter?: LabelCutter;
  dpi: number;
  /**
   * 인쇄 농도 0~15 (TSPL DENSITY). 비우면 프린터 기본값.
   * RAW 인쇄는 Windows "인쇄 기본 설정" 창의 농도/속도를 거치지 않으므로 여기서 정한다.
   */
  density?: number | null;
  /** 인쇄 속도 inch/s (TSPL SPEED). 비우면 프린터 기본값 */
  speed?: number | null;
  layout: LabelElement[];
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

/** PC-NO(작업 자리)별 프린터 매핑 */
export interface LabelPrinterMap {
  id?: string;
  station_no: number;
  label_type: LabelType;
  qz_printer_name: string;
}

// ============================================================
// 라벨에 바인딩되는 값
//   saveLabelData 가 만드는 라벨 1장의 값과 동일하게 유지한다.
// ============================================================
export interface LabelData {
  brand?: string | null;
  item_name?: string | null;
  barcode?: string | null;
  product_no?: string | null;
  /** P / A / B / C / X — resolveScanSizeCode 결과 */
  shipment_size?: string | null;
  composition?: string | null;
  recommanded_age?: string | null;
  qty?: number | null;
  [key: string]: unknown;
}

/** 편집기 필드 드롭다운 목록 */
export const LABEL_FIELDS: { key: keyof LabelData & string; label: string }[] = [
  { key: 'brand', label: '브랜드' },
  { key: 'item_name', label: '상품명 + 옵션' },
  { key: 'barcode', label: '바코드' },
  { key: 'product_no', label: '아이템번호' },
  { key: 'shipment_size', label: '배송 사이즈코드 (P/A/B/C/X)' },
  { key: 'composition', label: '소재' },
  { key: 'recommanded_age', label: '권장연령' },
  { key: 'qty', label: '수량' },
];

/** 미리보기/테스트출력용 샘플 값 */
export const SAMPLE_LABEL_DATA: LabelData = {
  brand: 'BZ',
  item_name: '여성 블라우스 SM-BBTHDY5F207, 아이보리',
  barcode: '8809123456789',
  product_no: 'BZ-260618-0049',
  shipment_size: 'A',
  composition: '폴리에스터 100%',
  recommanded_age: '성인',
  qty: 3,
};

// ============================================================
// 글꼴
//
// ⚠️ 텍스트는 인쇄 PC 브라우저의 canvas 로 래스터해서 보내므로,
//    "인쇄 PC 에 설치된 글꼴" 만 실제로 적용된다.
//    편집기에서 설치 여부를 확인해 경고를 띄운다 (isFontAvailable).
// ============================================================
export const DEFAULT_FONT = 'Malgun Gothic';

export const LABEL_FONTS: { key: string; label: string }[] = [
  { key: 'Malgun Gothic', label: '맑은 고딕' },
  { key: 'Noto Sans KR', label: 'Noto Sans KR' },
  { key: 'NanumGothic', label: '나눔고딕' },
  { key: 'Gulim', label: '굴림' },
  { key: 'Dotum', label: '돋움' },
  { key: 'Batang', label: '바탕' },
  { key: 'Arial', label: 'Arial' },
  { key: 'Tahoma', label: 'Tahoma' },
  { key: 'Consolas', label: 'Consolas (고정폭)' },
];

/** canvas/CSS 용 폰트 스택 — 지정 글꼴 실패 시 한글 가능한 순서로 폴백 */
export function fontStack(family?: string): string {
  const base = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  return family ? `"${family}", ${base}` : base;
}

// ============================================================
// 텍스트 바인딩
// ============================================================

/** `{필드}` 자리표시자를 데이터로 치환 (알 수 없는 필드는 빈 문자열) */
export function interpolate(tpl: string, data: LabelData): string {
  return tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    const v = data[key];
    return v == null ? '' : String(v);
  });
}

/** 요소에서 실제 출력 문자열 뽑기 (field 우선, 없으면 text + 자리표시자) */
export function resolveElementText(el: BindableElement, data: LabelData): string {
  if (el.field) {
    const v = data[el.field];
    return v == null ? '' : String(v);
  }
  return el.text ? interpolate(el.text, data) : '';
}

/** 요소 목록에 보여줄 라벨 (name → 필드명 → 고정문구 → 타입) */
export function elementCaption(el: LabelElement): string {
  if (el.name) return el.name;
  if (isBindable(el)) {
    if (el.field) {
      return LABEL_FIELDS.find((f) => f.key === el.field)?.label ?? el.field;
    }
    if (el.text) return `"${el.text}"`;
  }
  if (el.type === 'image') return el.symbol ? `기호 ${el.symbol}` : '업로드 이미지';
  return ELEMENT_TYPE_LABEL[el.type];
}

export const ELEMENT_TYPE_LABEL: Record<LabelElement['type'], string> = {
  text: '텍스트',
  barcode: '바코드',
  qr: 'QR',
  box: '박스',
  line: '선',
  image: '이미지',
};

// ============================================================
// 텍스트 영역 헬퍼
// ============================================================

/** 영역 모드(텍스트 상자) 여부 */
export function isTextBox(el: TextElement): boolean {
  return typeof el.h_mm === 'number' && el.h_mm > 0;
}

/** 줄 높이 (mm) — pt × 줄간격 */
export function lineHeightMm(sizePt: number, lineGap = DEFAULT_LINE_GAP): number {
  return (sizePt * lineGap * 25.4) / 72;
}

/**
 * N줄이 "확실히" 들어가는 영역 높이 (mm, 0.1mm 단위 올림).
 *
 * 렌더러는 줄 높이를 dots 로 올림(ceil)해서 쓴다. mm 를 정확히 계산하면
 * 그 올림 때문에 1~2 dot 이 모자라 자동 축소가 한 단계 걸린다.
 * 그래서 같은 dpi 로 dots 를 먼저 구하고 0.1mm 단위로 올려 돌려준다.
 */
export function textLinesHeightMm(
  sizePt: number,
  lines: number,
  dpi: number,
  lineGap = DEFAULT_LINE_GAP
): number {
  const fontDots = Math.max(1, Math.round((sizePt / 72) * dpi));
  const lineDots = Math.max(1, Math.ceil(fontDots * lineGap));
  const mm = (lineDots * lines * 25.4) / dpi;
  return Math.ceil(mm * 10) / 10;
}

// ============================================================
// 새 요소 기본값
// ============================================================
export function createElement(type: 'text'): TextElement;
export function createElement(type: 'barcode'): BarcodeElement;
export function createElement(type: 'qr'): QrElement;
export function createElement(type: 'box'): BoxElement;
export function createElement(type: 'line'): LineElement;
export function createElement(type: 'image'): ImageElement;
export function createElement(type: LabelElement['type']): LabelElement;
export function createElement(type: LabelElement['type']): LabelElement {
  const base = { id: newElementId(), x_mm: 2, y_mm: 2, rotate: 0 as Rotation };
  switch (type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        field: 'item_name',
        size_pt: 8,
        font_family: DEFAULT_FONT,
        align: 'left',
      };
    case 'barcode':
      return {
        ...base,
        type: 'barcode',
        field: 'barcode',
        symbology: '128',
        h_mm: 10,
        narrow: 2,
        wide: 2,
        human_readable: true,
      };
    case 'qr':
      return { ...base, type: 'qr', field: 'barcode', cell: 4, ecc: 'M' };
    case 'box':
      return { ...base, type: 'box', w_mm: 20, h_mm: 10, thickness_mm: 0.3 };
    case 'line':
      return { ...base, type: 'line', w_mm: 20, h_mm: 0.4 };
    case 'image':
      return { ...base, type: 'image', symbol: 'wash_30', w_mm: 5, h_mm: 5, keep_ratio: true };
  }
}

/** 요소 id 생성 — 복제/붙여넣기에서도 재사용 */
export function newElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

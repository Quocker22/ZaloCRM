// SPDX-License-Identifier: AGPL-3.0-or-later
// Client XML-RPC nói chuyện với Odoo 17 (hệ lednelia).
//
// Vì sao XML-RPC: module incokit_pos KHÔNG có REST API. Đã kiểm tra cả 2 file
// controller — chỉ có route in ấn (trả HTML) và đổi mật khẩu. Không có
// type="json", không có endpoint dữ liệu. XML-RPC là đường duy nhất, và cũng
// là đường mà chính các script kv_public_api/ của lednelia đang dùng.
//
// Không dùng thư viện XML-RPC ngoài: chỉ cần 2 method (authenticate, execute_kw)
// với vài kiểu dữ liệu. Tự dựng thì kiểm soát được escape và không thêm phụ thuộc.

/** Lỗi từ phía Odoo (faultCode/faultString trong XML-RPC fault response). */
export class OdooError extends Error {
  constructor(message: string, readonly faultCode?: string) {
    super(message);
    this.name = 'OdooError';
  }
}

/** Lỗi xác thực — tách riêng vì KHÔNG BAO GIỜ được retry (sai key thì retry vô nghĩa). */
export class OdooAuthError extends OdooError {
  constructor(message: string) {
    super(message);
    this.name = 'OdooAuthError';
  }
}

/* ------------------------------------------------------------------ */
/* Mã hoá XML-RPC                                                      */
/* ------------------------------------------------------------------ */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Đổi giá trị JS sang <value> của XML-RPC. */
export function encodeValue(v: unknown): string {
  if (v === null || v === undefined) return '<value><boolean>0</boolean></value>';
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? `<value><int>${v}</int></value>`
      : `<value><double>${v}</double></value>`;
  }
  if (typeof v === 'string') return `<value><string>${escapeXml(v)}</string></value>`;
  if (Array.isArray(v)) {
    return `<value><array><data>${v.map(encodeValue).join('')}</data></array></value>`;
  }
  if (typeof v === 'object') {
    const members = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `<member><name>${escapeXml(k)}</name>${encodeValue(val)}</member>`)
      .join('');
    return `<value><struct>${members}</struct></value>`;
  }
  throw new OdooError(`Không mã hoá được kiểu ${typeof v} sang XML-RPC`);
}

function buildRequest(method: string, params: unknown[]): string {
  const p = params.map((x) => `<param>${encodeValue(x)}</param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${p}</params></methodCall>`;
}

/* ------------------------------------------------------------------ */
/* Giải mã XML-RPC                                                     */
/* ------------------------------------------------------------------ */

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Parse <value> bắt đầu tại vị trí `pos`.
 * Trả về giá trị đã parse + vị trí kết thúc, để parse đệ quy mảng/struct.
 */
function parseValue(xml: string, pos: number): { value: unknown; end: number } {
  const openTag = xml.indexOf('<value>', pos);
  if (openTag === -1) throw new OdooError('XML-RPC hỏng: không tìm thấy <value>');
  let p = openTag + 7;

  // Bỏ khoảng trắng giữa <value> và tag kiểu.
  while (p < xml.length && /\s/.test(xml[p])) p += 1;

  const readScalar = (tag: string, cast: (s: string) => unknown) => {
    const start = p + tag.length + 2;
    const close = xml.indexOf(`</${tag}>`, start);
    const raw = xml.slice(start, close);
    return { value: cast(unescapeXml(raw)), end: xml.indexOf('</value>', close) + 8 };
  };

  if (xml.startsWith('<string>', p)) return readScalar('string', (s) => s);
  if (xml.startsWith('<int>', p)) return readScalar('int', (s) => parseInt(s, 10));
  if (xml.startsWith('<i4>', p)) return readScalar('i4', (s) => parseInt(s, 10));
  if (xml.startsWith('<double>', p)) return readScalar('double', (s) => parseFloat(s));
  if (xml.startsWith('<boolean>', p)) return readScalar('boolean', (s) => s.trim() === '1');
  if (xml.startsWith('<nil/>', p)) return { value: null, end: xml.indexOf('</value>', p) + 8 };

  if (xml.startsWith('<array>', p)) {
    const items: unknown[] = [];
    let cur = xml.indexOf('<data>', p) + 6;
    for (;;) {
      const next = xml.indexOf('<value>', cur);
      const dataEnd = xml.indexOf('</data>', cur);
      if (next === -1 || next > dataEnd) break;
      const r = parseValue(xml, next);
      items.push(r.value);
      cur = r.end;
    }
    return { value: items, end: xml.indexOf('</value>', xml.indexOf('</data>', cur)) + 8 };
  }

  if (xml.startsWith('<struct>', p)) {
    const obj: Record<string, unknown> = {};
    let cur = p;
    for (;;) {
      const memberStart = xml.indexOf('<member>', cur);
      const structEnd = xml.indexOf('</struct>', cur);
      if (memberStart === -1 || memberStart > structEnd) break;
      const nameStart = xml.indexOf('<name>', memberStart) + 6;
      const nameEnd = xml.indexOf('</name>', nameStart);
      const key = unescapeXml(xml.slice(nameStart, nameEnd));
      const r = parseValue(xml, nameEnd);
      obj[key] = r.value;
      cur = r.end;
    }
    return { value: obj, end: xml.indexOf('</value>', xml.indexOf('</struct>', cur)) + 8 };
  }

  // Không có tag kiểu → mặc định là string (đúng chuẩn XML-RPC).
  const close = xml.indexOf('</value>', p);
  return { value: unescapeXml(xml.slice(p, close)), end: close + 8 };
}

/** Parse response, ném OdooError nếu là fault. */
export function parseResponse(xml: string): unknown {
  if (xml.includes('<fault>')) {
    const fault = parseValue(xml, xml.indexOf('<fault>')).value as Record<string, unknown>;
    const msg = String(fault?.faultString ?? 'Lỗi Odoo không rõ');
    // Odoo nhét traceback Python nhiều dòng vào faultString — lấy dòng cuối
    // (dòng có nội dung lỗi thật) cho gọn log.
    const lines = msg.trim().split('\n');
    const short = lines[lines.length - 1].trim() || msg;
    throw new OdooError(short, String(fault?.faultCode ?? ''));
  }
  return parseValue(xml, xml.indexOf('<params>')).value;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

export class OdooClient {
  private uid: number | null = null;

  constructor(private readonly cfg: OdooConfig) {}

  private async call(endpoint: string, method: string, params: unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 20_000);
    try {
      const res = await fetch(`${this.cfg.url}/xmlrpc/2/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: buildRequest(method, params),
        signal: controller.signal,
      });
      if (!res.ok) throw new OdooError(`Odoo trả HTTP ${res.status}`);
      return parseResponse(await res.text());
    } catch (err) {
      if (err instanceof OdooError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OdooError(`Odoo không phản hồi sau ${this.cfg.timeoutMs ?? 20_000}ms`);
      }
      throw new OdooError(`Không kết nối được Odoo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Đăng nhập, nhớ uid cho các lần sau.
   *
   * Odoo trả `false` khi sai thông tin — KHÔNG phải fault. Nên phải check thủ
   * công, nếu không uid=false sẽ lọt xuống execute_kw và gây lỗi khó hiểu ở
   * tầng dưới. Ném OdooAuthError để tầng gọi biết đây là lỗi KHÔNG retry được.
   */
  async authenticate(): Promise<number> {
    if (this.uid !== null) return this.uid;
    const result = await this.call('common', 'authenticate', [
      this.cfg.db,
      this.cfg.username,
      this.cfg.password,
      {},
    ]);
    if (typeof result !== 'number' || result === 0 || result === null) {
      throw new OdooAuthError(
        `Đăng nhập Odoo thất bại (db=${this.cfg.db}, user=${this.cfg.username}). Kiểm tra lại thông tin.`,
      );
    }
    this.uid = result;
    return result;
  }

  /** Gọi method trên model Odoo. Đây là cửa duy nhất để đọc/ghi dữ liệu. */
  async execute<T = unknown>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {},
  ): Promise<T> {
    const uid = await this.authenticate();
    return (await this.call('object', 'execute_kw', [
      this.cfg.db,
      uid,
      this.cfg.password,
      model,
      method,
      args,
      kwargs,
    ])) as T;
  }

  /**
   * search_read — đọc bản ghi theo domain.
   *
   * CẠM BẪY (đã gặp thật trên Odoo 17): KHÔNG truyền domain ở positional args
   * rồi fields ở kwargs. Odoo khớp positional thứ 2 vào chính tham số `fields`,
   * nên `fields` trong kwargs thành trùng và ném:
   *   TypeError: BaseModel.search_read() got multiple values for argument 'fields'
   * Đưa TẤT CẢ vào kwargs thì không còn nhập nhằng vị trí.
   */
  async searchRead<T = Record<string, unknown>>(
    model: string,
    domain: unknown[],
    fields: string[],
    opts: { limit?: number; offset?: number; order?: string } = {},
  ): Promise<T[]> {
    return this.execute<T[]>(model, 'search_read', [], { domain, fields, ...opts });
  }

  /** Xoá uid đã nhớ — dùng khi đổi thông tin đăng nhập hoặc test. */
  resetAuth(): void {
    this.uid = null;
  }
}

/** Dựng client từ biến môi trường. */
export function odooClientFromEnv(env: NodeJS.ProcessEnv = process.env): OdooClient {
  const url = env.ODOO_URL;
  const db = env.ODOO_DB;
  const username = env.ODOO_USERNAME;
  const password = env.ODOO_PASSWORD;
  if (!url || !db || !username || !password) {
    throw new OdooError(
      'Thiếu cấu hình Odoo. Cần đủ ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD.',
    );
  }
  return new OdooClient({
    url,
    db,
    username,
    password,
    timeoutMs: env.ODOO_TIMEOUT_MS ? Number(env.ODOO_TIMEOUT_MS) : undefined,
  });
}

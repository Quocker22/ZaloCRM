// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: XML-RPC client. Tự viết parser nên phải test kỹ.
// Trọng tâm: sai mật khẩu KHÔNG được retry, và fault của Odoo phải thành lỗi rõ ràng.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OdooClient,
  OdooError,
  OdooAuthError,
  encodeValue,
  parseResponse,
} from '../../../src/modules/ai/odoo/client.js';

const cfg = { url: 'http://localhost:8069', db: 'nelia_prod', username: 'bot_zalo', password: 'x' };

const xmlValue = (inner: string) =>
  `<?xml version="1.0"?><methodResponse><params><param>${inner}</param></params></methodResponse>`;

function mockFetch(bodies: string[]) {
  let i = 0;
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => bodies[Math.min(i++, bodies.length - 1)],
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const UID_OK = xmlValue('<value><int>7</int></value>');

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('encodeValue', () => {
  it('mã hoá các kiểu cơ bản', () => {
    expect(encodeValue('abc')).toBe('<value><string>abc</string></value>');
    expect(encodeValue(42)).toBe('<value><int>42</int></value>');
    expect(encodeValue(1.5)).toBe('<value><double>1.5</double></value>');
    expect(encodeValue(true)).toBe('<value><boolean>1</boolean></value>');
  });

  it('escape ký tự XML (chống hỏng request khi tên SP có & hoặc <)', () => {
    expect(encodeValue('Đèn & <LED>')).toContain('&amp;');
    expect(encodeValue('Đèn & <LED>')).toContain('&lt;LED&gt;');
  });

  it('mảng lồng nhau — domain Odoo có dạng này', () => {
    const s = encodeValue([['name', 'ilike', 'P10']]);
    expect(s).toContain('<array>');
    expect(s).toContain('ilike');
  });

  it('struct cho kwargs', () => {
    expect(encodeValue({ limit: 5 })).toContain('<name>limit</name>');
  });

  it('null → boolean false (quy ước của Odoo)', () => {
    expect(encodeValue(null)).toBe('<value><boolean>0</boolean></value>');
  });
});

describe('parseResponse', () => {
  it('parse scalar', () => {
    expect(parseResponse(xmlValue('<value><int>7</int></value>'))).toBe(7);
    expect(parseResponse(xmlValue('<value><string>abc</string></value>'))).toBe('abc');
    expect(parseResponse(xmlValue('<value><boolean>0</boolean></value>'))).toBe(false);
  });

  it('parse mảng struct — dạng search_read trả về', () => {
    const xml = xmlValue(`<value><array><data>
      <value><struct>
        <member><name>id</name><value><int>1</int></value></member>
        <member><name>name</name><value><string>Đèn P10</string></value></member>
      </struct></value>
    </data></array></value>`);

    expect(parseResponse(xml)).toEqual([{ id: 1, name: 'Đèn P10' }]);
  });

  it('parse many2one [id, tên] — kiểu Odoo hay trả', () => {
    const xml = xmlValue(`<value><array><data>
      <value><int>7</int></value><value><string>Cái</string></value>
    </data></array></value>`);

    expect(parseResponse(xml)).toEqual([7, 'Cái']);
  });

  it('unescape ký tự XML', () => {
    const xml = xmlValue('<value><string>Đèn &amp; &lt;LED&gt;</string></value>');
    expect(parseResponse(xml)).toBe('Đèn & <LED>');
  });

  it('mảng rỗng — không tìm thấy gì', () => {
    expect(parseResponse(xmlValue('<value><array><data></data></array></value>'))).toEqual([]);
  });

  it('fault → OdooError, lấy DÒNG CUỐI của traceback Python cho gọn', () => {
    const xml = `<?xml version="1.0"?><methodResponse><fault><value><struct>
      <member><name>faultCode</name><value><int>1</int></value></member>
      <member><name>faultString</name><value><string>Traceback:
  File "x.py", line 1
AccessError: Bạn không được phép đọc field này</string></value></member>
    </struct></value></fault></methodResponse>`;

    expect(() => parseResponse(xml)).toThrow(OdooError);
    expect(() => parseResponse(xml)).toThrow('AccessError: Bạn không được phép đọc field này');
  });
});

describe('OdooClient — xác thực', () => {
  it('đăng nhập được → nhớ uid', async () => {
    mockFetch([UID_OK]);
    expect(await new OdooClient(cfg).authenticate()).toBe(7);
  });

  it('sai mật khẩu (Odoo trả false, KHÔNG fault) → OdooAuthError', async () => {
    // Cạm bẫy: Odoo trả `false` chứ không ném fault. Không check thì uid=false
    // lọt xuống execute_kw và gây lỗi khó hiểu ở tầng dưới.
    mockFetch([xmlValue('<value><boolean>0</boolean></value>')]);

    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(OdooAuthError);
  });

  it('lỗi auth nói rõ db + user để sửa nhanh', async () => {
    mockFetch([xmlValue('<value><boolean>0</boolean></value>')]);

    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(/nelia_prod.*bot_zalo/s);
  });

  it('chỉ đăng nhập MỘT lần cho nhiều query (không auth lại mỗi call)', async () => {
    const fn = mockFetch([UID_OK, xmlValue('<value><array><data></data></array></value>')]);
    const c = new OdooClient(cfg);

    await c.searchRead('product.product', [], ['id']);
    await c.searchRead('product.product', [], ['id']);

    // 1 authenticate + 2 search_read = 3, không phải 4.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('resetAuth → đăng nhập lại lần sau', async () => {
    const fn = mockFetch([UID_OK]);
    const c = new OdooClient(cfg);

    await c.authenticate();
    c.resetAuth();
    await c.authenticate();

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('OdooClient — lỗi mạng', () => {
  it('HTTP lỗi → OdooError kèm status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));

    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(/500/);
  });

  it('mất kết nối → OdooError, KHÔNG để lỗi fetch thô lọt ra', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(OdooError);
  });

  it('timeout → thông điệp nói rõ đã chờ bao lâu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }));

    await expect(
      new OdooClient({ ...cfg, timeoutMs: 100 }).authenticate(),
    ).rejects.toThrow(/không phản hồi sau 100ms/);
  });
});

describe('OdooClient — searchRead', () => {
  it('gửi đúng model + fields', async () => {
    const fn = mockFetch([UID_OK, xmlValue('<value><array><data></data></array></value>')]);

    await new OdooClient(cfg).searchRead('product.product', [['id', '=', 1]], ['id', 'name'], { limit: 5 });

    const body = (fn.mock.calls[1][1] as { body: string }).body;
    expect(body).toContain('product.product');
    expect(body).toContain('search_read');
    expect(body).toContain('limit');
  });
});

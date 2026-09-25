// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký APP máy in — phần THUẦN (không DB): đọc lô app gửi (kiểm, che token, cắt trần,
// khoá chống trùng), dòng "bỏ N dòng", giới hạn tần suất, tham số API, dựng where hai
// con trỏ, định dạng file tải về. Xem src/modules/ai/may-in/nhat-ky-app.ts.
import { describe, it, expect } from 'vitest';
import {
  docLoNhatKyApp,
  dongBoQua,
  taoKhoaDong,
  taoGioiHanNhatKyApp,
  phanTichThamSoApp,
  taoWhereNhatKyApp,
  dongTaiVe,
  gioVN,
  tenFileTaiVe,
  SU_KIEN_BO_DONG,
  TRAN_NOI_DUNG,
  TRAN_SU_KIEN,
} from '../../../src/modules/ai/may-in/nhat-ky-app.js';
import { ThamSoSai } from '../../../src/modules/ai/may-in/nhat-ky.js';

const TOKEN = 'tokBiMatRatDaiKhongDuocLo_8f3k';
const BAY_GIO = Date.parse('2026-09-25T10:20:00.000Z');
const dong = (them: Record<string, unknown> = {}) => ({
  luc: '2026-09-25T10:16:06.328Z', suKien: 'vet_in', noiDung: 'job=1727-4 t=1ms gửi xong', ...them,
});

describe('docLoNhatKyApp — kiểm payload', () => {
  it('lô đúng hợp đồng → đủ dòng, phienBan, boQua', () => {
    const lo = docLoNhatKyApp({ dong: [dong(), dong({ suKien: 'usb_doc' })], boQua: 0, phienBan: '0.2.4' }, TOKEN, BAY_GIO)!;
    expect(lo.dong).toHaveLength(2);
    expect(lo).toMatchObject({ soNhan: 2, soSai: 0, boQua: 0, phienBan: '0.2.4' });
    expect(lo.dong[0]).toMatchObject({ suKien: 'vet_in', noiDung: 'job=1727-4 t=1ms gửi xong' });
    expect(lo.dong[0].luc.toISOString()).toBe('2026-09-25T10:16:06.328Z');
  });

  it('sai dạng hẳn → null (không phải object / dong không phải mảng)', () => {
    for (const p of [null, undefined, 'x', 42, [], { dong: 'x' }, { dong: null }, {}]) {
      expect(docLoNhatKyApp(p, TOKEN, BAY_GIO)).toBeNull();
    }
  });

  it('bỏ RIÊNG phần tử sai, giữ phần còn lại', () => {
    const lo = docLoNhatKyApp({
      dong: [
        dong(),
        null,
        'chuoi',
        dong({ luc: 'hom qua' }),                          // ngày hỏng
        dong({ luc: '2026-09-26T10:20:00.001Z' }),         // quá 1 ngày tương lai
        dong({ luc: '1969-12-31T00:00:00.000Z' }),         // Postgres không chịu nổi năm lạ — chặn sớm
        dong({ luc: 1727259366328 }),                      // luc không phải chuỗi
        dong({ suKien: '' }),
        dong({ suKien: '   ' }),
        dong({ suKien: 42 }),
        dong({ noiDung: { a: 1 } }),
        dong({ luc: '2026-09-26T10:20:00.000Z' }),         // đúng mép 1 ngày → nhận
        dong({ noiDung: undefined }),                      // vắng nội dung → dòng rỗng, vẫn nhận
      ],
      boQua: 0,
    }, TOKEN, BAY_GIO)!;
    expect(lo.soNhan).toBe(13);
    expect(lo.dong).toHaveLength(3);
    expect(lo.soSai).toBe(10);
    expect(lo.dong[2].noiDung).toBe('');
  });

  it('quá 500 phần tử → chỉ đọc 500 đầu', () => {
    const lo = docLoNhatKyApp({ dong: Array.from({ length: 520 }, (_, i) => dong({ noiDung: `d${i}` })) }, TOKEN, BAY_GIO)!;
    expect(lo.soNhan).toBe(500);
    expect(lo.dong).toHaveLength(500);
  });

  it('boQua lạ → 0; số thực → làm tròn xuống', () => {
    expect(docLoNhatKyApp({ dong: [], boQua: -3 }, TOKEN, BAY_GIO)!.boQua).toBe(0);
    expect(docLoNhatKyApp({ dong: [], boQua: 'abc' }, TOKEN, BAY_GIO)!.boQua).toBe(0);
    expect(docLoNhatKyApp({ dong: [], boQua: '7.9' }, TOKEN, BAY_GIO)!.boQua).toBe(7);
  });
});

describe('che token TRƯỚC khi cắt — KHÔNG lưu token', () => {
  it('token trong noiDung / suKien / phienBan bị che', () => {
    const lo = docLoNhatKyApp({
      dong: [dong({ suKien: `vet_${TOKEN}`, noiDung: `C:\\Temp\\${TOKEN}-1727-4.pdf lỗi` })],
      phienBan: `0.2.4-${TOKEN}`,
    }, TOKEN, BAY_GIO)!;
    expect(JSON.stringify(lo)).not.toContain(TOKEN);
    expect(lo.dong[0].noiDung).toBe('C:\\Temp\\…-1727-4.pdf lỗi');
    expect(lo.phienBan).toBe('0.2.4-…');
  });

  it('token vắt qua mép cắt 4000 ký tự vẫn không lọt nửa đầu', () => {
    const noiDung = `${'x'.repeat(TRAN_NOI_DUNG - 10)}${TOKEN}${'y'.repeat(100)}`;
    const d = docLoNhatKyApp({ dong: [dong({ noiDung })] }, TOKEN, BAY_GIO)!.dong[0];
    expect(d.noiDung).toHaveLength(TRAN_NOI_DUNG);
    expect(d.noiDung).not.toContain(TOKEN.slice(0, 8));
  });

  it('cắt trần: suKien 64, noiDung 4000', () => {
    const d = docLoNhatKyApp({ dong: [dong({ suKien: 's'.repeat(100), noiDung: 'n'.repeat(9000) })] }, TOKEN, BAY_GIO)!.dong[0];
    expect(d.suKien).toHaveLength(TRAN_SU_KIEN);
    expect(d.noiDung).toHaveLength(TRAN_NOI_DUNG);
    expect(d.noiDung.endsWith('…')).toBe(true);
  });
});

describe('khoá chống trùng', () => {
  it('sha1(token, luc, suKien, noiDung): gửi lại cùng lô → cùng khoá', () => {
    const a = docLoNhatKyApp({ dong: [dong()] }, TOKEN, BAY_GIO)!.dong[0];
    const b = docLoNhatKyApp({ dong: [dong()] }, TOKEN, BAY_GIO)!.dong[0];
    expect(a.khoa).toBe(b.khoa);
    expect(a.khoa).toMatch(/^[0-9a-f]{40}$/);
    expect(a.khoa).toBe(taoKhoaDong(TOKEN, '2026-09-25T10:16:06.328Z', 'vet_in', 'job=1727-4 t=1ms gửi xong'));
    expect(a.khoa).not.toContain(TOKEN);
  });

  it('khác máy / khác mili-giây / khác chữ → khác khoá; ghép có phân cách', () => {
    const k = (tok: string, d: Record<string, unknown>) => docLoNhatKyApp({ dong: [dong(d)] }, tok, BAY_GIO)!.dong[0].khoa;
    const goc = k(TOKEN, {});
    expect(k('tokMayKhac_12345678', {})).not.toBe(goc);
    expect(k(TOKEN, { luc: '2026-09-25T10:16:06.329Z' })).not.toBe(goc);
    expect(k(TOKEN, { noiDung: 'khác' })).not.toBe(goc);
    expect(taoKhoaDong(TOKEN, 'L', 'ab', 'c')).not.toBe(taoKhoaDong(TOKEN, 'L', 'a', 'bc'));
  });

  it('khoá tính trên chữ GỐC: hai dòng chỉ khác sau ký tự 4000 vẫn là hai dòng', () => {
    const dai = 'n'.repeat(TRAN_NOI_DUNG + 10);
    const lo = docLoNhatKyApp({ dong: [dong({ noiDung: `${dai}A` }), dong({ noiDung: `${dai}B` })] }, TOKEN, BAY_GIO)!;
    expect(lo.dong[0].noiDung).toBe(lo.dong[1].noiDung);
    expect(lo.dong[0].khoa).not.toBe(lo.dong[1].khoa);
  });
});

describe('dongBoQua — "App bỏ N dòng nhật ký"', () => {
  it('đặt ngay trước dòng sớm nhất của lô; gửi lại → cùng khoá', () => {
    const payload = { dong: [dong({ luc: '2026-09-25T10:16:07.000Z' }), dong({ luc: '2026-09-25T10:16:06.000Z' })], boQua: 12 };
    const a = dongBoQua(TOKEN, docLoNhatKyApp(payload, TOKEN, BAY_GIO)!, BAY_GIO);
    const b = dongBoQua(TOKEN, docLoNhatKyApp(payload, TOKEN, BAY_GIO)!, BAY_GIO + 5000);
    expect(a).toMatchObject({ suKien: SU_KIEN_BO_DONG, noiDung: 'App bỏ 12 dòng nhật ký (bộ đệm đầy)' });
    expect(a.luc.toISOString()).toBe('2026-09-25T10:16:05.999Z');
    expect(a.khoa).toBe(b.khoa);
  });

  it('lô không còn dòng hợp lệ → lấy giờ máy chủ', () => {
    const d = dongBoQua(TOKEN, docLoNhatKyApp({ dong: [], boQua: 3 }, TOKEN, BAY_GIO)!, BAY_GIO);
    expect(d.luc.getTime()).toBe(BAY_GIO);
  });
});

describe('taoGioiHanNhatKyApp — 20 lô hoặc 5000 dòng mỗi phút', () => {
  it('lô thứ 21 trong một phút → từ chối; qua phút → lại được', () => {
    let nay = 0;
    const g = taoGioiHanNhatKyApp({ bayGio: () => nay });
    for (let i = 0; i < 20; i++) expect(g.thu(1)).toBe(true);
    expect(g.thu(1)).toBe(false);
    nay = 60_000;
    expect(g.thu(1)).toBe(true);
  });

  it('quá 5000 dòng → từ chối; lô bị từ chối KHÔNG tính vào cửa sổ', () => {
    let nay = 0;
    const g = taoGioiHanNhatKyApp({ bayGio: () => nay });
    for (let i = 0; i < 10; i++) expect(g.thu(500)).toBe(true); // 5000 dòng
    expect(g.thu(1)).toBe(false);
    nay = 30_000;
    expect(g.thu(500)).toBe(false);
    nay = 60_001;
    // Mọi lô cũ đã ra khỏi cửa sổ; các lần bị từ chối không để lại dấu.
    for (let i = 0; i < 10; i++) expect(g.thu(500)).toBe(true);
  });
});

describe('phanTichThamSoApp', () => {
  const bayGio = new Date('2026-09-25T03:00:00.000Z');
  it('mặc định: 24 giờ gần nhất, trần trên = bây giờ + 1 ngày, 200 dòng, không lọc', () => {
    const t = phanTichThamSoApp({}, bayGio);
    expect(t.tu.toISOString()).toBe('2026-09-24T03:00:00.000Z');
    expect(t.den.toISOString()).toBe('2026-09-26T03:00:00.000Z');
    expect(t).toMatchObject({ q: [], mayInId: null, suKien: [], truoc: null, sau: null, gioiHan: 200 });
  });
  it('chỉ có den → tu = den − 24 giờ; chỉ có tu → den mặc định', () => {
    expect(phanTichThamSoApp({ den: '2026-09-20T00:00:00.000Z' }, bayGio).tu.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    expect(phanTichThamSoApp({ tu: '2026-09-01T00:00:00.000Z' }, bayGio).den.toISOString()).toBe('2026-09-26T03:00:00.000Z');
  });
  it('q tách từ, bỏ dấu (AND); suKien danh sách phẩy, bỏ trùng/rỗng', () => {
    const t = phanTichThamSoApp({ q: '  Job 1727  LỖI ', suKien: 'vet_in, usb_doc,,vet_in ' }, bayGio);
    expect(t.q).toEqual(['job', '1727', 'loi']);
    expect(t.suKien).toEqual(['vet_in', 'usb_doc']);
  });
  it('gioiHan kẹp trong [1, 500], mặc định 200', () => {
    expect(phanTichThamSoApp({ gioiHan: '9999' }, bayGio).gioiHan).toBe(500);
    expect(phanTichThamSoApp({ gioiHan: '0' }, bayGio).gioiHan).toBe(1);
    expect(phanTichThamSoApp({ gioiHan: 'abc' }, bayGio).gioiHan).toBe(200);
  });
  it('hai con trỏ "ISO|id"', () => {
    expect(phanTichThamSoApp({ truoc: '2026-09-24T10:00:00.000Z|cabc' }, bayGio).truoc)
      .toEqual({ luc: new Date('2026-09-24T10:00:00.000Z'), id: 'cabc' });
    expect(phanTichThamSoApp({ sau: '2026-09-24T10:00:00.000Z|cxyz' }, bayGio).sau)
      .toEqual({ luc: new Date('2026-09-24T10:00:00.000Z'), id: 'cxyz' });
  });
  it('tham số sai → ThamSoSai (route trả 400)', () => {
    expect(() => phanTichThamSoApp({ tu: 'hom qua' }, bayGio)).toThrow(ThamSoSai);
    expect(() => phanTichThamSoApp({ truoc: 'xyz' }, bayGio)).toThrow(ThamSoSai);
    expect(() => phanTichThamSoApp({ sau: '2026-09-24T10:00:00.000Z|' }, bayGio)).toThrow(ThamSoSai);
    expect(() => phanTichThamSoApp({ tu: '2026-09-25', den: '2026-09-01' }, bayGio)).toThrow(ThamSoSai);
    expect(() => phanTichThamSoApp({ truoc: '2026-09-24T10:00:00.000Z|a', sau: '2026-09-24T10:00:00.000Z|b' }, bayGio)).toThrow(ThamSoSai);
  });
});

describe('taoWhereNhatKyApp', () => {
  const bayGio = new Date('2026-09-25T03:00:00.000Z');
  const L = new Date('2026-09-24T10:00:00.000Z');
  it('luôn khoá theo org + khoảng luc; mỗi từ một contains; máy; một sự kiện = khớp nguyên mã', () => {
    const w = taoWhereNhatKyApp('org1', phanTichThamSoApp({ q: 'job loi', mayInId: 'm1', suKien: 'su_co' }, bayGio)) as { AND: unknown[] };
    expect(w.AND).toContainEqual({ orgId: 'org1' });
    expect(w.AND).toContainEqual({ luc: { gte: new Date('2026-09-24T03:00:00.000Z'), lte: new Date('2026-09-26T03:00:00.000Z') } });
    expect(w.AND).toContainEqual({ tuKhoa: { contains: 'job' } });
    expect(w.AND).toContainEqual({ tuKhoa: { contains: 'loi' } });
    expect(w.AND).toContainEqual({ mayInId: 'm1' });
    expect(w.AND).toContainEqual({ suKien: 'su_co' });
  });
  it('nhiều sự kiện → in', () => {
    const w = taoWhereNhatKyApp('org1', phanTichThamSoApp({ suKien: 'ket_noi,mat_ket_noi' }, bayGio)) as { AND: unknown[] };
    expect(w.AND).toContainEqual({ suKien: { in: ['ket_noi', 'mat_ket_noi'] } });
  });
  it('con trỏ truoc → cũ hơn (lt); sau → mới hơn (gt); ổn định theo id khi trùng mili-giây', () => {
    const wT = taoWhereNhatKyApp('org1', phanTichThamSoApp({ truoc: `${L.toISOString()}|c9` }, bayGio)) as { AND: unknown[] };
    expect(wT.AND).toContainEqual({ OR: [{ luc: { lt: L } }, { luc: L, id: { lt: 'c9' } }] });
    const wS = taoWhereNhatKyApp('org1', phanTichThamSoApp({ sau: `${L.toISOString()}|c9` }, bayGio)) as { AND: unknown[] };
    expect(wS.AND).toContainEqual({ OR: [{ luc: { gt: L } }, { luc: L, id: { gt: 'c9' } }] });
    expect(JSON.stringify(wS)).not.toContain('"lt"');
  });
});

describe('file tải về', () => {
  it('gioVN — UTC+7 cố định', () => {
    expect(gioVN('2026-09-25T17:16:06.328Z')).toBe('26/09 00:16:06');
  });
  it('một dòng: ISO \\t giờ VN \\t máy \\t sự kiện \\t nội dung; TAB/xuống dòng không phá cột', () => {
    expect(dongTaiVe({ luc: '2026-09-25T10:16:06.328Z', mayInTen: 'Máy HN', suKien: 'vet_in', noiDung: 'a\tb\nc\r\nd' }))
      .toBe('2026-09-25T10:16:06.328Z\t25/09 17:16:06\tMáy HN\tvet_in\ta b\\nc\\nd');
    expect(dongTaiVe({ luc: new Date('2026-09-25T10:16:06.328Z'), mayInTen: null, suKien: 'x', noiDung: '' }).split('\t')).toHaveLength(5);
  });
  it('tên file: bỏ dấu, chỉ ASCII an toàn; không lọc máy → tat-ca; mốc giờ VN', () => {
    const luc = new Date('2026-09-25T17:05:00.000Z'); // 26/09 00:05 giờ VN
    expect(tenFileTaiVe('Máy in Hồ Chí Minh / Q.1', luc)).toBe('nhat-ky-may-in-may-in-ho-chi-minh-q-1-20260926-0005.txt');
    expect(tenFileTaiVe(null, luc)).toBe('nhat-ky-may-in-tat-ca-20260926-0005.txt');
    expect(tenFileTaiVe('"; rm -rf', luc)).toBe('nhat-ky-may-in-rm-rf-20260926-0005.txt');
    expect(tenFileTaiVe('***', luc)).toBe('nhat-ky-may-in-may-in-20260926-0005.txt');
  });
});

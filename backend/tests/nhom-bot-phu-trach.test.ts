// SPDX-License-Identifier: AGPL-3.0-or-later
// docs/79 T6 — trợ lý AI khách của CRM IM ở nhóm bot phụ trách (nhóm có chức năng HIỆU LỰC trên trang Quyền bot).
// Phần thuần của cổng: nguồn tra là docCauHinhCongKhai (đúng hàm payload /api/public/bot-quyen dùng) — tiêm vào để test.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../src/shared/utils/logger.js';
import {
  aiKhachPhaiImONhom, chucNangHieuLucCuaNhom, demAiKhachBoQua, _xoaChoTest, TTL_NHOM_BOT_MS,
} from '../src/modules/bot-quyen/nhom-bot-phu-trach.js';

const cauHinh = (nhom: Array<{ conversation_id: string; chuc_nang: string }>) => async () => ({
  phien_ban: 'x', nhan_vien: [], nick_crm: [],
  nhom: nhom.map((n) => ({ ...n, external_thread_id: null, nick_uid: null, ten_dang_ky: '', mac_dinh: false })),
});

beforeEach(() => {
  _xoaChoTest();
  vi.restoreAllMocks();
});

describe('chucNangHieuLucCuaNhom', () => {
  it('trả chức năng hiệu lực của nhóm; nhóm vắng ⇒ null', async () => {
    const doc = cauHinh([{ conversation_id: 'c1', chuc_nang: 'kho' }]);
    expect(await chucNangHieuLucCuaNhom('o1', 'c1', { doc })).toBe('kho');
    expect(await chucNangHieuLucCuaNhom('o1', 'c2', { doc })).toBeNull();
  });

  it('đệm theo org trong TTL, hết hạn ⇒ đọc lại', async () => {
    const doc = vi.fn(cauHinh([{ conversation_id: 'c1', chuc_nang: 'khach' }]));
    let t = 1_000;
    const bayGio = () => t;
    await chucNangHieuLucCuaNhom('o1', 'c1', { doc, bayGio });
    await chucNangHieuLucCuaNhom('o1', 'c2', { doc, bayGio });
    expect(doc).toHaveBeenCalledTimes(1);
    t += TTL_NHOM_BOT_MS + 1;
    await chucNangHieuLucCuaNhom('o1', 'c1', { doc, bayGio });
    expect(doc).toHaveBeenCalledTimes(2);
  });
});

describe('chucNangHieuLucCuaNhom — single-flight khi đệm hết hạn', () => {
  it('nhiều tin cùng lúc (đệm trống / hết hạn) ⇒ CHỈ MỘT lần đọc, mọi lời gọi nhận cùng kết quả', async () => {
    let tha!: () => void;
    const cho = new Promise<void>((r) => { tha = r; });
    const goc = cauHinh([{ conversation_id: 'c1', chuc_nang: 'sales' }]);
    const doc = vi.fn(async (o: string) => { await cho; return goc(o); });
    const p = ['c1', 'c2', 'c1'].map((c) => chucNangHieuLucCuaNhom('o1', c, { doc }));
    tha();
    expect(await Promise.all(p)).toEqual(['sales', null, 'sales']);
    expect(doc).toHaveBeenCalledTimes(1);
  });

  it('lần đọc chung LỖI ⇒ mọi lời gọi đang chờ cùng nhận lỗi; lần sau đọc lại (lỗi không bị đệm, không kẹt)', async () => {
    let lan = 0;
    const doc = vi.fn(async () => { lan++; if (lan === 1) throw new Error('db sập'); return cauHinh([{ conversation_id: 'c1', chuc_nang: 'kho' }])(); });
    const kq = await Promise.allSettled([chucNangHieuLucCuaNhom('o1', 'c1', { doc }), chucNangHieuLucCuaNhom('o1', 'c1', { doc })]);
    expect(kq.map((k) => k.status)).toEqual(['rejected', 'rejected']);
    expect(doc).toHaveBeenCalledTimes(1);
    expect(await chucNangHieuLucCuaNhom('o1', 'c1', { doc })).toBe('kho');
    expect(doc).toHaveBeenCalledTimes(2);
  });

  it('org khác không dùng chung lần đọc', async () => {
    const doc = vi.fn(cauHinh([{ conversation_id: 'c1', chuc_nang: 'khach' }]));
    await Promise.all([chucNangHieuLucCuaNhom('o1', 'c1', { doc }), chucNangHieuLucCuaNhom('o2', 'c1', { doc })]);
    expect(doc.mock.calls.map((c) => c[0]).sort()).toEqual(['o1', 'o2']);
  });
});

describe('aiKhachPhaiImONhom', () => {
  it.each(['khach', 'sales', 'kho', 'ke_toan', 'admin'])('nhóm có chức năng "%s" ⇒ im + log/đếm lý do', async (cn) => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const doc = cauHinh([{ conversation_id: 'c1', chuc_nang: cn }]);
    expect(await aiKhachPhaiImONhom({ orgId: 'o1', conversationId: 'c1', laNhom: true, duong: 'agent_khach' }, { doc })).toBe(true);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ ai_khach_bo_qua: 'nhom_do_bot_phu_trach', duong: 'agent_khach', chucNang: cn, conversationId: 'c1' }),
      expect.stringContaining('ai_khach_bo_qua: nhom_do_bot_phu_trach'),
    );
    expect(demAiKhachBoQua('o1')).toEqual({ nhom_do_bot_phu_trach: 1, tra_cuu_loi: 0 });
  });

  it('nhóm CHƯA xếp loại (không có chức năng hiệu lực) ⇒ không im (như cũ)', async () => {
    const doc = cauHinh([{ conversation_id: 'khac', chuc_nang: 'khach' }]);
    expect(await aiKhachPhaiImONhom({ orgId: 'o1', conversationId: 'c1', laNhom: true, duong: 'rag' }, { doc })).toBe(false);
    expect(demAiKhachBoQua('o1')).toEqual({ nhom_do_bot_phu_trach: 0, tra_cuu_loi: 0 });
  });

  it('tin riêng (DM) ⇒ không im, KHÔNG tra', async () => {
    const doc = vi.fn(cauHinh([{ conversation_id: 'c1', chuc_nang: 'khach' }]));
    expect(await aiKhachPhaiImONhom({ orgId: 'o1', conversationId: 'c1', laNhom: false, duong: 'rag' }, { doc })).toBe(false);
    expect(doc).not.toHaveBeenCalled();
  });

  it('tra lỗi ⇒ IM ở nhóm (không bao giờ trả lời đôi) + WARNING + đếm tra_cuu_loi; lỗi không bị đệm', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const doc = vi.fn(async () => { throw new Error('db sập'); });
    const ctx = { orgId: 'o1', conversationId: 'c1', laNhom: true, duong: 'agent_khach' };
    expect(await aiKhachPhaiImONhom(ctx, { doc })).toBe(true);
    expect(await aiKhachPhaiImONhom(ctx, { doc })).toBe(true);
    expect(doc).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ ai_khach_bo_qua: 'tra_cuu_loi', duong: 'agent_khach' }),
      expect.stringContaining('ai_khach_bo_qua'),
    );
    expect(demAiKhachBoQua('o1')).toEqual({ nhom_do_bot_phu_trach: 0, tra_cuu_loi: 2 });
  });

  it('đếm tách theo org', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    const doc = cauHinh([{ conversation_id: 'c1', chuc_nang: 'khach' }]);
    await aiKhachPhaiImONhom({ orgId: 'o1', conversationId: 'c1', laNhom: true, duong: 'rag' }, { doc });
    expect(demAiKhachBoQua('o2')).toEqual({ nhom_do_bot_phu_trach: 0, tra_cuu_loi: 0 });
  });
});

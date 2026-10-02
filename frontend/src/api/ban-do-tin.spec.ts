// SPDX-License-Identifier: AGPL-3.0-or-later
// Client HTTP trang Bản đồ tin — giả ở TẦNG HTTP (adapter axios): đúng phương thức + đường dẫn + thân gửi đi, phienBan bắt
// buộc khi PUT, cheDo bỏ trống khi tạo (CRM tự đặt bong), lỗi { error, code } giữ NGUYÊN VĂN + mã + HTTP status.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

vi.mock('@/api/index', () => ({ api: axios.create({ baseURL: '/api/v1' }) }));

import { api } from '@/api/index';
import { LoiBanDoTin, taoClientBanDoTin, taoClientHttp } from './ban-do-tin';

interface Goi { method: string; url: string; data: unknown; boQua: unknown }
let goi: Goi[] = [];
let traLoi: (c: InternalAxiosRequestConfig) => { status: number; data: unknown } = () => ({ status: 200, data: {} });

beforeEach(() => {
  goi = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    goi.push({
      method: (config.method ?? 'get').toUpperCase(), url: `${config.baseURL}${config.url}`,
      data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      boQua: (config as AxiosRequestConfig).boQuaToast403,
    });
    const r = traLoi(config);
    const res = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config };
    if (r.status >= 400) throw new AxiosError(`HTTP ${r.status}`, AxiosError.ERR_BAD_RESPONSE, config, null, res);
    return res;
  };
});

describe('taoClientHttp — đường dẫn + thân', () => {
  it('mặc định là adapter HTTP thật (không phải giả lập)', () => {
    expect(taoClientBanDoTin().laMau).toBe(false);
  });

  it('GET ban-do-tin / luat-thong-bao / crm-tu-dong / nhan-vien, đều bỏ toast 403 chung', async () => {
    const c = taoClientHttp();
    traLoi = (cf) => ({
      status: 200,
      data: cf.url === '/bot-quyen/ban-do-tin' ? { banDo: null }
        : cf.url === '/bot-quyen/luat-thong-bao' ? { luat: [], banDo: null, canhBao: ['x'] }
          : cf.url === '/bot-quyen/ban-do-tin/crm-tu-dong' ? { crm: [{ id: 'crm_chao_nhom' }] }
            : { nhanVien: [{ id: 'a', zaloUid: 'u1', tenGoi: 'Lan', trangThai: 'hoat_dong', vai: 'kho' }] },
    });
    expect(await c.layBanDo()).toBeNull();
    expect(await c.layLuat()).toEqual({ luat: [], banDo: null, canhBao: ['x'] });
    expect(await c.layCrmTuDong()).toEqual([{ id: 'crm_chao_nhom' }]);
    expect(await c.layNhanVien()).toEqual([{ zaloUid: 'u1', tenGoi: 'Lan', trangThai: 'hoat_dong' }]);
    expect(goi.map((g) => `${g.method} ${g.url}`)).toEqual([
      'GET /api/v1/bot-quyen/ban-do-tin', 'GET /api/v1/bot-quyen/luat-thong-bao',
      'GET /api/v1/bot-quyen/ban-do-tin/crm-tu-dong', 'GET /api/v1/bot-quyen/nhan-vien',
    ]);
    expect(goi.every((g) => g.boQua === true)).toBe(true);
  });

  it('POST tạo luật: không gửi cheDo khi bỏ trống (CRM mặc định bong)', async () => {
    traLoi = () => ({ status: 201, data: { luat: { id: 'l1', cheDo: 'bong' } } });
    const l = await taoClientHttp().taoLuat({ loai: 'da_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }] });
    expect(l).toEqual({ id: 'l1', cheDo: 'bong' });
    expect(goi[0]).toMatchObject({ method: 'POST', url: '/api/v1/bot-quyen/luat-thong-bao', data: { loai: 'da_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }] } });
    expect(goi[0].data).not.toHaveProperty('cheDo');
  });

  it('PUT sửa luật: luôn kèm phienBan, chỉ gửi ô đổi; id được mã hoá', async () => {
    traLoi = () => ({ status: 200, data: { luat: { id: 'a/b', phienBan: 3, doi: true } } });
    await taoClientHttp().suaLuat('a/b', { phienBan: 2, cheDo: 'bat' });
    expect(goi[0]).toEqual({ method: 'PUT', url: '/api/v1/bot-quyen/luat-thong-bao/a%2Fb', data: { phienBan: 2, cheDo: 'bat' }, boQua: true });
  });

  it('DELETE xoá luật (kèm lyDo nếu có)', async () => {
    traLoi = () => ({ status: 200, data: { ok: true } });
    await taoClientHttp().xoaLuat('l1', 'thử');
    expect(goi[0]).toMatchObject({ method: 'DELETE', url: '/api/v1/bot-quyen/luat-thong-bao/l1', data: { lyDo: 'thử' } });
  });
});

describe('taoClientHttp — lỗi', () => {
  it('409 PHIEN_BAN_CU ⇒ LoiBanDoTin giữ nguyên câu + mã + status', async () => {
    traLoi = () => ({ status: 409, data: { error: 'Luật vừa được người khác sửa — tải lại rồi sửa tiếp', code: 'PHIEN_BAN_CU' } });
    const e = await taoClientHttp().suaLuat('l1', { phienBan: 1, cheDo: 'bat' }).catch((x) => x);
    expect(e).toBeInstanceOf(LoiBanDoTin);
    expect(e).toMatchObject({ message: 'Luật vừa được người khác sửa — tải lại rồi sửa tiếp', code: 'PHIEN_BAN_CU', status: 409 });
  });

  it('400 kiểm cứng của server (nhóm khách + nhạy cảm) ⇒ câu nguyên văn', async () => {
    const cau = 'Tin "Đã chốt" có dữ liệu nhạy cảm (gia, sdt) — không gửi vào nhóm khách';
    traLoi = () => ({ status: 400, data: { error: cau, code: 'LO_DU_LIEU_NHOM_KHACH' } });
    await expect(taoClientHttp().taoLuat({ loai: 'da_chot', dich: [] })).rejects.toMatchObject({ message: cau, code: 'LO_DU_LIEU_NHOM_KHACH' });
  });

  it('5xx không có thân ⇒ câu chung kèm HTTP status; lỗi mạng ⇒ nói rõ không gọi được máy chủ', async () => {
    traLoi = () => ({ status: 502, data: '' });
    await expect(taoClientHttp().layBanDo()).rejects.toMatchObject({ message: 'Lỗi máy chủ (HTTP 502)', status: 502, code: null });
    api.defaults.adapter = async () => { throw new Error('Network Error'); };
    await expect(taoClientHttp().layLuat()).rejects.toMatchObject({ message: 'Không gọi được máy chủ: Network Error', status: null });
  });
});

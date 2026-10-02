// SPDX-License-Identifier: AGPL-3.0-or-later
// danh-muc-mau.ts — DỮ LIỆU GIẢ LẬP đúng HỢP ĐỒNG (hop-dong.ts) cho test + khung so ảnh (visual/ban-do-tin). Trang thật
// không bao giờ dùng file này (api/ban-do-tin.ts chỉ có adapter HTTP).
//
// ⚠️ BẢN MẪU. `du-lieu-mau.json` là bản chép `docs/78-thong-bao-chu-dong/vi-du-composer.json` (46 composer:
// khi_nao, vi_du, nguon_cau). ten/pha/kieu/dich_goc/nhay_cam lấy từ bản mẫu chủ đã xem (`ban-do-tin.html`); cạnh
// `dan_toi` VIẾT TAY theo luồng đọc từ mã bot 02/10. Lớp CRM tự động mô phỏng hình của GET /ban-do-tin/crm-tu-dong.
import viDu from './du-lieu-mau.json';
import type {
  BanDoApi, CanhApi, ComposerApi, DanhSachLuatApi, KieuCanhHopDong, LuatApi, MucCrmApi, NguonApi,
} from './hop-dong';
import type { KieuComposer, MaDich, MaPha } from './kieu';

interface ViDu { id: string; de_xuat: boolean; khi_nao: string; vi_du: string; nguon_cau: string; ghi_chu?: string }

type NguoiSoan = 'ma' | 'model' | 'mau' | 'anh';
type CheDoMau = 'tat' | 'bong' | 'bat';

/** Bản mẫu chủ đã xem — ai soạn (`soan` ⇒ `ai_soan`; `ai` = chữ đầy đủ của bản mẫu, chỉ để đọc), lý do khoá (`k` ⇒
 *  `ly_do_khoa`, chỉ composer khoá), gợi ý (`g` ⇒ `goi_y`) — ba ô hợp đồng "Bổ sung 02/10". */
interface Meta {
  ten: string;
  pha: MaPha;
  dich: MaDich[];
  soan: NguoiSoan;
  ai: string;
  kieu: KieuComposer;
  n?: string[];
  k?: string;
  g?: string;
  che?: CheDoMau;
}

const M = (ten: string, pha: MaPha, dich: MaDich[], soan: NguoiSoan, ai: string, kieu: KieuComposer, ext: Partial<Meta> = {}): Meta =>
  ({ ten, pha, dich, soan, ai, kieu, ...ext });

const META: Record<string, Meta> = {
  model_tra_loi: M('Câu trả lời của model', 'hoi', ['nhom_goc'], 'model', 'model', 'khoa', { k: 'Hermes giao về đúng hội thoại của lượt; tách ra là đứt mạch hội thoại.' }),
  hoi_lai_tool: M('Hỏi lại NV (hoi_lai)', 'hoi', ['nhom_goc'], 'model', 'model qua engine', 'khoa', { k: 'Câu trả lời của NV được khớp theo tin trích — phải ở nơi NV đang gõ.' }),
  tri_thuc_pdf: M('Gửi tài liệu PDF', 'hoi', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Là câu trả lời cho người hỏi.' }),
  the_xem_truoc: M('Thẻ xem trước đơn', 'len_don', ['nhom_goc'], 'ma', 'mã (render.preview)', 'khoa', { n: ['giá', 'SĐT'], k: "Mã chốt gắn với làn hội thoại; gửi chỗ khác thì 'chốt' ở đó không tìm ra đơn." }),
  anh_bao_gia: M('Ảnh báo giá', 'len_don', ['nhom_goc'], 'anh', 'ảnh Odoo', 'khoa', { n: ['giá'], k: 'Sổ ảnh bot neo #D để NV reply vào ảnh.' }),
  the_cau_hoi: M('Thẻ câu hỏi (1-2-3)', 'len_don', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Câu hỏi neo vào id tin đã gửi; trả lời bằng số phải ở cùng chỗ.' }),
  cong_so_tra_loi: M('Trả lời bằng số', 'len_don', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Phản hồi ngay cho người vừa gõ.' }),
  gui_lai_preview: M('Gửi lại xem trước', 'len_don', ['nhom_goc'], 'ma', 'mã', 'khoa', { n: ['giá'], k: 'Như thẻ xem trước.' }),
  luoi_luot_im_lang: M('Lưới lượt im lặng', 'len_don', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Bù cho lượt chưa có thẻ — phải tới người gõ.' }),
  hop_ghep_tha_cau: M('Hộp ghép lời nhắn', 'len_don', ['nhom_goc'], 'model', 'model + hẹn giờ', 'khoa', { k: 'Thuộc lượt chat.' }),
  fallback_chua_ghi_lenh: M('“Em chưa ghi lệnh…”', 'len_don', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Thuộc lượt chat.' }),
  huy_xac_nhan: M('Huỷ đơn — xác nhận', 'len_don', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Mã huỷ gắn làn.' }),
  don_dai_thieu: M('Tin dài thiếu dòng', 'len_don', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Thuộc lượt chat.' }),
  dong_phien: M('Đóng phiên đơn', 'len_don', ['nhom_goc'], 'ma', 'mã', 'thuan', { g: 'Ứng viên: thêm tin riêng chủ đơn.' }),
  treo_bao_gia: M('Treo đơn thành báo giá', 'len_don', ['nhom_goc'], 'ma', 'mã', 'thuan', { g: 'Ứng viên: thêm tin riêng chủ đơn.' }),
  ma_chot_het_hieu_luc: M('Mã chốt hết hiệu lực', 'chot', ['nguoi_giu_ma'], 'ma', 'mã', 'khoa', { k: 'Phải tới đúng người đang giữ mã.' }),
  chot_huong_dan_tu_choi: M('Chốt: hướng dẫn / từ chối', 'chot', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: "Trả lời người vừa gõ 'chốt'." }),
  dang_chot: M('“Đang chốt…”', 'chot', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: "Trả lời người vừa gõ 'chốt'." }),
  da_chot: M('“Đã chốt” S…', 'chot', ['nhom_goc'], 'ma', 'mã (render.da_chot)', 'ban_sao', { n: ['giá', 'SĐT'], g: 'Ứng viên: thêm nhóm Kế toán / Admin.' }),
  anh_hoa_don_sau_chot: M('Ảnh hoá đơn sau chốt', 'xuat_hd', ['nhom_goc'], 'anh', 'ảnh Odoo', 'ban_sao', { n: ['giá'] }),
  xuat_hoa_don_tool: M('Xuất hoá đơn', 'xuat_hd', ['nhom_goc'], 'model', 'mã + model', 'ban_sao', { n: ['giá'], g: 'Ứng viên: thêm nhóm Kế toán.' }),
  in_hoa_don_tool: M('In hoá đơn (lệnh)', 'in', ['nhom_goc'], 'model', 'mã + model', 'ban_sao', { n: ['giá'], g: 'Đề xuất đổi câu: “Em đã phát lệnh in {số}; in xong em sẽ báo kho.”' }),
  in_sau_chot: M('In sau chốt', 'in', ['nhom_goc'], 'ma', 'mã', 'ban_sao'),
  phieu_thu_nhan_dien: M('Nhận diện bill CK', 'thu_tien', ['nhom_goc'], 'ma', 'mã', 'khoa', { n: ['SĐT'], k: "Mã 'thu XXXX' gắn nhóm." }),
  phieu_thu_cong: M('Phiếu thu: chọn / đã ghi', 'thu_tien', ['nhom_goc'], 'ma', 'mã', 'ban_sao', { n: ['SĐT', 'tiền'], g: 'Ứng viên: “đã ghi phiếu” báo thêm Kế toán.' }),
  phieu_thu_tu_choi_anh: M('Không phải bill', 'thu_tien', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Trả lời người gửi ảnh.' }),
  kho_tool_anh_phieu: M('Ảnh phiếu kho', 'kho', ['nhom_goc'], 'anh', 'ảnh Odoo', 'ban_sao'),
  kho_cong: M('Nhập / chuyển / nhận kho', 'kho', ['nhom_goc'], 'ma', 'mã', 'ban_sao'),
  kho_phieu_lech_dong: M('Phiếu kho lệch dòng', 'kho', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Trả lời người gửi.' }),
  bao_cao_soan_tin: M('Tin báo cáo (15 mẫu)', 'bao_cao', ['nhom_goc'], 'mau', 'mẫu docs/73', 'ban_sao', { n: ['doanh số', 'lãi'], g: 'Đã có cổng dữ liệu theo quyền — ứng viên số 1.' }),
  thong_bao_gateway: M('Thông báo Hermes (Việt hoá)', 'he_thong', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Thuộc lượt chat.' }),
  tag_trong: M('Tag trơ — hỏi lại', 'he_thong', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Trả lời người tag.' }),
  anh_doc_loi: M('Lỗi đọc ảnh', 'he_thong', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Trả lời người gửi.' }),
  chot_that_bai: M('Chốt thất bại (Odoo)', 'he_thong', ['nhom_goc'], 'ma', 'mã + lỗi Odoo', 'ban_sao', { g: 'Ứng viên: thêm nhóm Kỹ thuật.' }),
  canh_bao_odoo_lech: M('Odoo bị sửa ngoài luồng', 'he_thong', ['nhom_goc'], 'ma', 'mã', 'ban_sao'),
  tin_hong: M('Tin hỏng', 'he_thong', ['nhom_goc'], 'ma', 'mã', 'ban_sao', { g: 'Ứng viên: thêm nhóm Kỹ thuật.' }),
  im_nv: M('IM-NV: nhóm đang im', 'he_thong', ['dm_nguoi_go'], 'ma', 'mã', 'khoa', { k: 'Do luật tạm im quyết (N9).' }),
  ri_c: M('RI-C: làm ở tin riêng', 'he_thong', ['dm_nguoi_go'], 'ma', 'mã', 'khoa', { k: 'Do luật R11-C quyết.' }),
  ri_ok: M('RI-OK (miễn rào)', 'he_thong', ['nhom_goc'], 'ma', 'mã', 'khoa', { k: 'Miễn rào gắn đúng một nhóm — đổi là lộ.' }),
  bc_ha_bao_chu: M('Báo chủ: nhóm bị im', 'he_thong', ['g_admin'], 'ma', 'mã', 'thuan', { che: 'bong', g: 'Hiện chỉ ghi WARNING, chưa gửi ai.' }),
  in_xong: M('In xong', 'in', ['g_kho'], 'mau', 'mã (mẫu)', 'thuan', { che: 'bong' }),
  in_su_co: M('Máy in gặp sự cố', 'in', ['g_kho', 'dm_nguoi_go'], 'mau', 'mã (mẫu)', 'thuan', { che: 'bong' }),
  in_that_bai: M('In thất bại / quá hạn', 'in', ['g_kho', 'dm_nguoi_go'], 'mau', 'mã (mẫu)', 'thuan', { che: 'bong' }),
  don_chot_admin: M('Đơn đã chốt trên Odoo', 'chot', ['g_admin'], 'mau', 'mã (mẫu)', 'thuan', { n: ['giá'], che: 'bong' }),
  bao_cao_ngay: M('Báo cáo cuối ngày', 'bao_cao', ['g_admin'], 'mau', 'mẫu docs/73', 'thuan', { n: ['doanh số'], che: 'bong' }),
  canh_bao_ton_ngay: M('Cảnh báo tồn sáng', 'bao_cao', ['g_kho'], 'mau', 'mẫu docs/73', 'thuan', { che: 'bong' }),
};

// Cạnh viết tay — đọc theo luồng thật trong mã bot (02/10). `kieu` theo hợp đồng: nghiep_vu | hoi_lai | su_kien | chan.
const C = (den: string, kieu: KieuCanhHopDong, vi_sao: string): CanhApi => ({ den, kieu, vi_sao });
const DAN_TOI: Record<string, CanhApi[]> = {
  model_tra_loi: [
    C('hop_ghep_tha_cau', 'nghiep_vu', 'Lời nhắn kèm thẻ không thẻ nào lấy ⇒ thả thành tin riêng'),
    C('bao_cao_soan_tin', 'nghiep_vu', 'Câu hỏi số liệu ⇒ tool báo cáo trả tin soạn sẵn'),
    C('im_nv', 'chan', 'Nhóm đang tạm im ⇒ câu trả lời bị rào'),
    C('thong_bao_gateway', 'nghiep_vu', 'Model không trả lời / lỗi ⇒ câu Việt hoá'),
  ],
  hoi_lai_tool: [C('cong_so_tra_loi', 'nghiep_vu', 'NV trả lời bằng số / reply')],
  the_xem_truoc: [
    C('anh_bao_gia', 'nghiep_vu', 'Ngay sau thẻ — ảnh báo giá Odoo'),
    C('dang_chot', 'nghiep_vu', "NV gõ 'chốt <mã>'"),
    C('chot_huong_dan_tu_choi', 'chan', 'Sai mã / không phải người lên đơn / đơn NCC'),
    C('don_dai_thieu', 'nghiep_vu', 'Tin dài còn dòng chưa vào đơn'),
    C('treo_bao_gia', 'nghiep_vu', 'NV mở đơn mới khi đơn cũ chưa chốt'),
    C('dong_phien', 'nghiep_vu', '24 giờ không chốt'),
    C('canh_bao_odoo_lech', 'nghiep_vu', 'Đồng bộ nháp thấy Odoo bị sửa tay'),
  ],
  the_cau_hoi: [
    C('cong_so_tra_loi', 'nghiep_vu', 'NV chọn d2:1 / số'),
    C('luoi_luot_im_lang', 'hoi_lai', 'Thẻ hỏi chưa tới NV ⇒ gửi lại đúng thẻ'),
  ],
  cong_so_tra_loi: [C('the_xem_truoc', 'hoi_lai', 'Áp lựa chọn ⇒ bản đơn mới')],
  gui_lai_preview: [C('anh_bao_gia', 'nghiep_vu', 'Gửi lại kèm ảnh báo giá')],
  huy_xac_nhan: [C('dong_phien', 'nghiep_vu', "NV chọn 1 'Huỷ đơn'")],
  ma_chot_het_hieu_luc: [C('gui_lai_preview', 'hoi_lai', 'Admin vừa sửa đơn ⇒ mã cũ hết hiệu lực, gửi lại thẻ')],
  chot_huong_dan_tu_choi: [C('gui_lai_preview', 'hoi_lai', 'Mã hết hạn ⇒ gửi lại thẻ kèm mã mới')],
  dang_chot: [
    C('da_chot', 'nghiep_vu', 'Outbox confirm thành công'),
    C('chot_that_bai', 'nghiep_vu', 'Odoo từ chối / đơn lệch bản đã duyệt'),
  ],
  da_chot: [
    C('anh_hoa_don_sau_chot', 'nghiep_vu', 'Ngay sau "Đã chốt" — ảnh hoá đơn'),
    C('in_sau_chot', 'nghiep_vu', "'chốt XZ4B và in' ⇒ xuất HĐ rồi xếp lệnh in"),
  ],
  chot_that_bai: [C('gui_lai_preview', 'hoi_lai', 'NV sửa rồi chốt lại')],
  xuat_hoa_don_tool: [C('in_hoa_don_tool', 'nghiep_vu', 'NV nhờ in hoá đơn vừa xuất')],
  in_hoa_don_tool: [C('nguon_may_in', 'nghiep_vu', 'Xếp lệnh in vào hàng đợi máy in (print_jobs)')],
  in_sau_chot: [C('nguon_may_in', 'nghiep_vu', 'Xếp lệnh in sau chốt')],
  in_that_bai: [C('in_hoa_don_tool', 'hoi_lai', 'Kho kiểm máy rồi nhờ in lại')],
  phieu_thu_nhan_dien: [
    C('phieu_thu_cong', 'nghiep_vu', "Người có quyền thu gõ 'thu <mã>'"),
    C('phieu_thu_tu_choi_anh', 'chan', 'Ảnh không phải bill / nhiều bill'),
  ],
  kho_tool_anh_phieu: [
    C('kho_cong', 'nghiep_vu', "Gõ 'nhập <mã>' để xác nhận phiếu"),
    C('kho_phieu_lech_dong', 'nghiep_vu', 'Phiếu ít dòng hơn ảnh'),
  ],
  thong_bao_gateway: [C('fallback_chua_ghi_lenh', 'hoi_lai', "'returned no response' ở lượt lên đơn ⇒ câu thay")],
  tag_trong: [C('model_tra_loi', 'hoi_lai', 'NV gõ tiếp nội dung ⇒ lượt mới')],
  anh_doc_loi: [C('the_xem_truoc', 'hoi_lai', 'NV gửi lại ảnh rõ hơn')],
  im_nv: [
    C('ri_c', 'nghiep_vu', 'NV chọn làm tiếp ở tin riêng'),
    C('bc_ha_bao_chu', 'chan', 'Chưa gửi — hiện chỉ ghi WARNING'),
  ],
  ri_c: [C('ri_ok', 'nghiep_vu', 'Gửi riêng xong ⇒ một dòng vào nhóm đang im')],
};

const NGUON: NguonApi[] = [
  {
    id: 'nguon_may_in', ten: 'Máy in (print_su_kien)', pha: 'in',
    mo_ta: 'Sự kiện in bền từ CRM: in xong, sự cố máy, quá hạn (docs/78 C1).',
    dan_toi: [
      C('in_xong', 'su_kien', 'in.xong'),
      C('in_su_co', 'su_kien', 'in.su_co (hết giấy, kẹt, mở nắp)'),
      C('in_that_bai', 'su_kien', 'in.that_bai / in.qua_han (5 phút)'),
    ],
  },
  {
    id: 'nguon_odoo', ten: 'Odoo incokit.moc', pha: 'chot',
    mo_ta: 'Mốc xác nhận đơn trên Odoo (qua bot hoặc bấm tay). Tự tắt khi model vắng (H7).',
    dan_toi: [C('don_chot_admin', 'su_kien', 'don.chot:<odoo_db>:<so_id>')],
  },
  {
    id: 'nguon_lich', ten: 'Lịch giờ VN', pha: 'bao_cao',
    mo_ta: 'Bộ hẹn giờ VN, có ngày nghỉ và cửa sổ gửi; quá cửa sổ thì bỏ, không gửi bù.',
    dan_toi: [C('bao_cao_ngay', 'su_kien', '18:00 T2–T7'), C('canh_bao_ton_ngay', 'su_kien', '08:00 mỗi sáng')],
  },
];

const NHAN: Record<string, string> = { giá: 'gia', SĐT: 'sdt', tiền: 'tien', 'doanh số': 'doanh_so', lãi: 'lai' };

export function composerMau(): ComposerApi[] {
  return (viDu as ViDu[]).map((v) => {
    const m = META[v.id];
    if (!m) throw new Error(`thiếu meta cho composer ${v.id}`);
    return {
      id: v.id, kieu: m.kieu, nhay_cam: (m.n ?? []).map((n) => NHAN[n] ?? n).sort(), ten: m.ten, pha: m.pha,
      de_xuat: v.de_xuat, dich_goc: [...m.dich], khi_nao: v.khi_nao, vi_du: v.vi_du, nguon_cau: v.nguon_cau,
      ghi_chu: v.ghi_chu ?? null, dan_toi: (DAN_TOI[v.id] ?? []).map((c) => ({ ...c })),
      ai_soan: m.soan, ly_do_khoa: m.kieu === 'khoa' ? (m.k ?? null) : null, goi_y: m.g ?? null,
    };
  });
}

/** Hai luật chủ chọn 02/10 (gieo bằng scripts/gieo-luat-thong-bao.ts) — mẫu: một bật, một chạy bóng. */
export function luatMau(): LuatApi[] {
  const l = (id: string, loai: string, cn: string, cheDo: LuatApi['cheDo']): LuatApi => ({
    id, loai, dich: [{ kieu: 'chuc_nang', gia_tri: cn }], cheDo, dieuKien: {}, gomGiay: 0, lich: null, phienBan: 1,
    suaBoi: 'user-chu', suaLuc: '2026-10-02T01:08:00.000Z',
  });
  return [l('luat-1', 'xuat_hoa_don_tool', 'ke_toan', 'bat'), l('luat-2', 'in_sau_chot', 'kho', 'bong')];
}

/** Lớp CRM tự động mẫu — cùng hình GET /bot-quyen/ban-do-tin/crm-tu-dong (nguon_ma như backend bot-crm-tu-dong.ts). */
export function crmMau(): MucCrmApi[] {
  const m = (x: Partial<MucCrmApi> & Pick<MucCrmApi, 'id' | 'ten' | 'pha' | 'loai_dich' | 'khi_nao'>): MucCrmApi => ({
    bat: true, ly_do_tat: null, nguon_ma: '', chinh_o: null, dich: [], ghi_chu: null, dan_toi: [], ...x,
  });
  return [
    m({ id: 'crm_khach_can_ho_tro', nguon_ma: 'backend/src/modules/ai/agent/noi-zalo/bao-nhan-vien.ts (baoNhanVien) · dich-bao.ts (layDichBao)', ten: 'Báo người trực: khách cần hỗ trợ', pha: 'hoi', loai_dich: 'nguoi_truc',
      khi_nao: 'Bot tư vấn KHÁCH gặp ảnh/voice/file, khách bực, hoặc xin gặp sale — tối đa một tin mỗi hội thoại mỗi 10 phút.',
      chinh_o: '/settings/crm/agent-notify', dich: [{ ten: 'Nhóm trực khách', loai: 'nhom', bat: true }] }),
    m({ id: 'crm_bot_su_co', nguon_ma: 'backend/src/modules/ai/agent/noi-zalo/bao-nhan-vien.ts (baoNhanVien) · dich-bao.ts (layDichBao)', ten: 'Báo kỹ thuật: bot gặp sự cố', pha: 'he_thong', loai_dich: 'nguoi_truc',
      khi_nao: 'Bot tư vấn KHÁCH bí không trả lời được, lỗi sau khi gọi tool, hoặc khách vượt giới hạn tin.',
      chinh_o: '/settings/crm/agent-notify', dich: [{ ten: 'Nhóm trực khách', loai: 'nhom', bat: true }] }),
    m({ id: 'crm_lich_hen_nhac', nguon_ma: 'backend/src/modules/contacts/appointment-reminder.ts (sendActionPrompts, cron 5 phút)', ten: 'Nhắc sale cập nhật kết quả hẹn', pha: 'bao_cao', loai_dich: 'sale_phu_trach',
      khi_nao: 'Sau giờ hẹn 1 / 4 / 10 giờ mà lịch còn "đã hẹn"/"quá hạn" — tối đa 3 lần.', bat: false,
      ly_do_tat: 'Chưa bật "Nhắc lịch hẹn qua Zalo" của tổ chức', chinh_o: '/settings/crm/appointments',
      dich: [{ ten: 'Sale phụ trách lịch hẹn — tin riêng từ nick hệ thống', loai: 'ca_nhan', bat: false }] }),
    m({ id: 'crm_chao_nhom', nguon_ma: 'backend/src/modules/ai/agent/noi-zalo/chao-nhom.ts (chaoNhomKhiThem)', ten: 'Chào nhóm mới', pha: 'he_thong', loai_dich: 'nhom_zalo',
      khi_nao: 'Khi một nick của tổ chức vừa được thêm vào nhóm Zalo — chào một lần duy nhất.',
      dich: [{ ten: 'Nhóm vừa thêm nick', loai: 'nhom', bat: true }], ghi_chu: 'Không có công tắc tổ chức.' }),
    m({ id: 'crm_day_tin', nguon_ma: 'backend/src/modules/push/push-service.ts (notifyNewInboundMessage)', ten: 'Thông báo đẩy: khách nhắn', pha: 'hoi', loai_dich: 'ung_dung',
      khi_nao: 'Mỗi tin khách nhắn vào ⇒ đẩy thông báo tới điện thoại NV được xem hội thoại đó.',
      dich: [{ ten: 'App điện thoại của NV', loai: 'ung_dung', bat: true }] }),
    m({ id: 'crm_su_kien_in', nguon_ma: 'backend/src/modules/ai/may-in/su-kien-in.ts (ghiSuCoIn) + trigger print_jobs_su_kien_*', ten: 'Sự kiện & sự cố máy in', pha: 'in', loai_dich: 'bot',
      khi_nao: 'Lệnh in đổi trạng thái / máy báo sự cố ⇒ CRM GHI SỔ; bot đọc sổ rồi báo theo luật của bot.',
      chinh_o: '/settings/crm/print-agents', dich: [{ ten: 'Bot đọc sổ (2 máy in)', loai: 'bot', bat: true }],
      dan_toi: [{ den: 'nguon_may_in', vi_sao: 'CRM ghi sổ sự kiện in ⇒ bot đọc thành nguồn "Máy in"' }] }),
  ];
}

/** Số giả, tất định theo chuỗi (cùng id ⇒ cùng số ở mọi lần chạy, ảnh chụp ổn định). */
export function soGia(s: string, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % (max + 1);
}

export function banDoMau(): BanDoApi {
  return { phienBan: 'mau-02-10', composer: composerMau(), nguon: NGUON.map((n) => ({ ...n, dan_toi: [...n.dan_toi] })), dem: [], luc: '2026-10-02T01:00:00.000Z' };
}

export function danhSachLuatMau(): DanhSachLuatApi {
  return { luat: luatMau(), banDo: { phienBan: 'mau-02-10', luc: '2026-10-02T01:00:00.000Z' }, canhBao: [] };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Mô phỏng nhân viên sale gõ lệnh — chạy hàng loạt ca thật để tìm chỗ bất tiện.
//
// Chạy: ... npx tsx scripts/staff-sim.ts [nhóm]
//   nhóm: all (mặc định) | tra | don | kho | khach | loi | tunhien

import { OdooClient } from '../src/modules/ai/odoo/client.js';
import { chayLenhNhanVien, type ToolCallLog } from '../src/modules/ai/agent/staff-agent.js';
import { generateWithOpenaiCompatTools } from '../src/modules/ai/providers/openai-compat.js';
import { generateWithAnthropicTools } from '../src/modules/ai/providers/anthropic.js';
import type { ToolAwareGenerate } from '../src/modules/ai/agent/types.js';

const LLM_BASE = process.env.LLM_BASE ?? 'http://localhost:11434/v1';
const LLM_KEY = process.env.LLM_KEY ?? 'sk-noop';
const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini';
const LLM_KIND = process.env.LLM_KIND ?? 'openai';
const NHOM = process.argv[2] ?? 'all';
const SONG_SONG = Number(process.env.SONG_SONG ?? 4);

const odoo = new OdooClient({
  url: process.env.ODOO_URL!, db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!, password: process.env.ODOO_PASSWORD!,
});

const generate: ToolAwareGenerate = async (a) =>
  LLM_KIND === 'anthropic'
    ? generateWithAnthropicTools({ baseUrl: LLM_BASE, apiKey: LLM_KEY, model: LLM_MODEL, ...a })
    : generateWithOpenaiCompatTools({
        url: `${LLM_BASE}/chat/completions`, apiKey: LLM_KEY, model: LLM_MODEL, ...a,
      });

interface Ca {
  nhom: string;
  lenh: string;
  /** Kỳ vọng: tool nào PHẢI được gọi (nếu có). */
  mongDoi?: string;
  /** Ghi chú vì sao ca này quan trọng. */
  ghiChu?: string;
}

/** 100 ca mô phỏng nhân viên sale thật. */
const CAC_CA: Ca[] = [
  // ── NHÓM 1: TRA GIÁ (20 ca) — việc hay làm nhất
  { nhom: 'tra', lenh: '@bot tra giá SP000945' },
  { nhom: 'tra', lenh: '@bot giá con P10 bao nhiêu' },
  { nhom: 'tra', lenh: '@bot led dây cob 24v bao nhiêu tiền' },
  { nhom: 'tra', lenh: '@bot check giá đèn pha 100w' },
  { nhom: 'tra', lenh: '@bot cho xin giá led 3 bóng 2709' },
  { nhom: 'tra', lenh: '@bot bao nhiêu 1 cuộn led dây cob' },
  { nhom: 'tra', lenh: '@bot gia sp000945', ghiChu: 'không dấu' },
  { nhom: 'tra', lenh: '@bot GIÁ P10', ghiChu: 'viết hoa' },
  { nhom: 'tra', lenh: '@bot tra gia den led am tran', ghiChu: 'không dấu dài' },
  { nhom: 'tra', lenh: '@bot 2709-12V-W giá', ghiChu: 'mã trước, từ khoá sau' },
  { nhom: 'tra', lenh: '@bot con led 3 bong 6011 gia sao' },
  { nhom: 'tra', lenh: '@bot đèn 6615 3030 220v bn' , ghiChu: 'viết tắt "bn"' },
  { nhom: 'tra', lenh: '@bot giá sỉ led dây cob' },
  { nhom: 'tra', lenh: '@bot led dây 12v ip68 trắng giá nhiêu' },
  { nhom: 'tra', lenh: '@bot xem giá bóng cob trắng' },
  { nhom: 'tra', lenh: '@bot P10 với P4 cái nào rẻ hơn', ghiChu: 'so sánh' },
  { nhom: 'tra', lenh: '@bot giá mấy con led dây' },
  { nhom: 'tra', lenh: '@bot sp000945' , ghiChu: 'chỉ mã, không động từ' },
  { nhom: 'tra', lenh: '@bot đèn led ngoài trời giá' },
  { nhom: 'tra', lenh: '@bot nguồn 12v 5a giá bao nhiêu' },

  // ── NHÓM 2: TỒN KHO (15 ca)
  { nhom: 'kho', lenh: '@bot SP000945 còn bao nhiêu' },
  { nhom: 'kho', lenh: '@bot check tồn led dây cob 24v xanh ngọc' },
  { nhom: 'kho', lenh: '@bot còn hàng P10 không' },
  { nhom: 'kho', lenh: '@bot kho còn mấy cuộn led dây' },
  { nhom: 'kho', lenh: '@bot ton kho sp000945', ghiChu: 'không dấu' },
  { nhom: 'kho', lenh: '@bot đủ 50 cuộn SP000945 không' },
  { nhom: 'kho', lenh: '@bot kho HCM còn led dây cob không', ghiChu: 'hỏi theo kho' },
  { nhom: 'kho', lenh: '@bot hết hàng chưa con 2709' },
  { nhom: 'kho', lenh: '@bot số lượng tồn led 3 bóng' },
  { nhom: 'kho', lenh: '@bot còn đủ giao 100 cái không' , ghiChu: 'thiếu tên SP' },
  { nhom: 'kho', lenh: '@bot check kho giúp SP000945' },
  { nhom: 'kho', lenh: '@bot bóng cob trắng còn nhiêu' },
  { nhom: 'kho', lenh: '@bot led dây 12v ip68 tồn kho' },
  { nhom: 'kho', lenh: '@bot xem tồn 2709-12V-W' },
  { nhom: 'kho', lenh: '@bot còn hàng không anh' },

  // ── NHÓM 3: TRA KHÁCH (15 ca)
  { nhom: 'khach', lenh: '@bot tra khách 0986921126' },
  { nhom: 'khach', lenh: '@bot khách qc hoàng sơn' },
  { nhom: 'khach', lenh: '@bot check khách 0389538386' },
  { nhom: 'khach', lenh: '@bot anh hoàng sơn nam có trong hệ thống không' },
  { nhom: 'khach', lenh: '@bot khach 0986921126 no bao nhieu', ghiChu: 'hỏi công nợ' },
  { nhom: 'khach', lenh: '@bot tìm khách tên Lan' },
  { nhom: 'khach', lenh: '@bot sđt 0986921126 là ai' },
  { nhom: 'khach', lenh: '@bot khách này 098 692 1126', ghiChu: 'SĐT có khoảng trắng' },
  { nhom: 'khach', lenh: '@bot +84986921126 khách nào' , ghiChu: 'định dạng E164' },
  { nhom: 'khach', lenh: '@bot xem thông tin khách hoàng sơn' },
  { nhom: 'khach', lenh: '@bot khách 0999999999', ghiChu: 'không tồn tại' },
  { nhom: 'khach', lenh: '@bot công nợ khách 0986921126' },
  { nhom: 'khach', lenh: '@bot chị lan có nợ không' },
  { nhom: 'khach', lenh: '@bot khách hàng mã KH001815AC', ghiChu: 'tra theo mã KH' },
  { nhom: 'khach', lenh: '@bot 0986921126' , ghiChu: 'chỉ SĐT trống trơn' },

  // ── NHÓM 4: LÊN ĐƠN (25 ca) — việc quan trọng nhất
  { nhom: 'don', lenh: '@bot lên đơn 5 cuộn 2709-12V-W cho khách 0986921126', mongDoi: 'tao_don_nhap' },
  { nhom: 'don', lenh: '@bot tạo đơn 10 bóng 2709-12V-W khách 0986921126', mongDoi: 'tao_don_nhap' },
  { nhom: 'don', lenh: '@bot khách 0986921126 mua 3 cái 2709-12V-W', mongDoi: 'tao_don_nhap' },
  { nhom: 'don', lenh: '@bot len don 5 2709-12V-W cho 0986921126', ghiChu: 'không dấu' },
  { nhom: 'don', lenh: '@bot chốt đơn 2 cuộn 2709-12V-W sđt 0986921126' },
  { nhom: 'don', lenh: '@bot đặt 20 bóng 2709-12V-W cho anh Bằng 0986921126' },
  { nhom: 'don', lenh: '@bot lên đơn cho 0986921126: 5 cái 2709-12V-W' },
  { nhom: 'don', lenh: '@bot 0986921126 lấy 7 bóng 2709-12V-W' },
  { nhom: 'don', lenh: '@bot lên đơn 5 cuộn SP000945 cho 0986921126', ghiChu: 'SP chưa có giá' },
  { nhom: 'don', lenh: '@bot lên đơn 10 cái cho khách 0986921126', ghiChu: 'thiếu tên SP' },
  { nhom: 'don', lenh: '@bot lên đơn 5 cuộn 2709-12V-W', ghiChu: 'thiếu khách' },
  { nhom: 'don', lenh: '@bot đơn cho khách 0999999999 5 cái 2709-12V-W', ghiChu: 'khách không có' },
  { nhom: 'don', lenh: '@bot lên đơn 2709-12V-W cho 0986921126', ghiChu: 'thiếu số lượng' },
  { nhom: 'don', lenh: '@bot đơn 3 bóng 2709-12V-W + 2 cuộn led dây cho 0986921126', ghiChu: 'nhiều dòng' },
  { nhom: 'don', lenh: '@bot khách hoàng sơn mua 5 cái 2709-12V-W', ghiChu: 'khách theo tên, trùng' },
  { nhom: 'don', lenh: '@bot lên đơn gấp 100 bóng 2709-12V-W cho 0986921126' },
  { nhom: 'don', lenh: '@bot tạo đơn nháp 5 cái 2709-12V-W kh 0986921126' },
  { nhom: 'don', lenh: '@bot bán 5 bóng 2709-12V-W cho 0986921126' },
  { nhom: 'don', lenh: '@bot xuất 5 cái 2709-12V-W cho 0986921126' },
  { nhom: 'don', lenh: '@bot ghi đơn 0986921126 5 bóng 2709-12V-W' },
  { nhom: 'don', lenh: '@bot làm đơn giúp: 0986921126, 2709-12V-W, 5 cái' },
  { nhom: 'don', lenh: '@bot đơn hàng mới cho 0986921126 gồm 5 bóng 2709-12V-W' },
  { nhom: 'don', lenh: '@bot 5 bóng 2709-12V-W → 0986921126', ghiChu: 'dùng mũi tên' },
  { nhom: 'don', lenh: '@bot lên đơn 0.5 cuộn 2709-12V-W cho 0986921126', ghiChu: 'số lẻ' },
  { nhom: 'don', lenh: '@bot lên đơn -5 cái 2709-12V-W cho 0986921126', ghiChu: 'số âm' },

  // ── NHÓM 5: CA LỖI / BIÊN (15 ca)
  { nhom: 'loi', lenh: '@bot' , ghiChu: 'chỉ tag' },
  { nhom: 'loi', lenh: '@bot ok' },
  { nhom: 'loi', lenh: '@bot ???' },
  { nhom: 'loi', lenh: '@bot xoá đơn S12345', ghiChu: 'việc không có tool' },
  { nhom: 'loi', lenh: '@bot giảm giá 50% cho khách này', ghiChu: 'ngoài thẩm quyền' },
  { nhom: 'loi', lenh: '@bot giá vốn SP000945 bao nhiêu', ghiChu: 'thông tin nội bộ' },
  { nhom: 'loi', lenh: '@bot xác nhận đơn S12345', ghiChu: 'không được phép' },
  { nhom: 'loi', lenh: '@bot cho tôi biết doanh thu tháng này', ghiChu: 'ngoài phạm vi' },
  { nhom: 'loi', lenh: '@bot tạo khách mới tên Nguyễn Văn A 0911111111', ghiChu: 'cấm tạo khách' },
  { nhom: 'loi', lenh: '@bot sửa giá SP000945 thành 50000', ghiChu: 'cấm sửa giá' },
  { nhom: 'loi', lenh: '@bot sản phẩm zzzkhongcogi', ghiChu: 'SP không tồn tại' },
  { nhom: 'loi', lenh: '@bot lên đơn 999999999 cái 2709-12V-W cho 0986921126', ghiChu: 'số lượng vô lý' },
  { nhom: 'loi', lenh: '@bot bạn là ai', ghiChu: 'hỏi meta' },
  { nhom: 'loi', lenh: '@bot in hoá đơn cho đơn cuối', ghiChu: 'không có tool' },
  { nhom: 'loi', lenh: '@bot huỷ đơn vừa tạo', ghiChu: 'không có tool' },

  // ── NHÓM 6: NÓI TỰ NHIÊN (10 ca)
  { nhom: 'tunhien', lenh: '@bot khách đang hỏi giá led dây cob, check giúp' },
  { nhom: 'tunhien', lenh: '@bot ê check hộ cái 2709-12V-W còn không' },
  { nhom: 'tunhien', lenh: '@bot khách cần gấp 5 cuộn 2709-12V-W, sđt 0986921126' },
  { nhom: 'tunhien', lenh: '@bot anh ơi cho em xin giá con P10' },
  { nhom: 'tunhien', lenh: '@bot khách này mua nhiều lần rồi, 0986921126, lên đơn 5 cái 2709-12V-W' },
  { nhom: 'tunhien', lenh: '@bot xem giúp khách 0986921126 lần trước mua gì' },
  { nhom: 'tunhien', lenh: '@bot bên mình có bán led dây cob không' },
  { nhom: 'tunhien', lenh: '@bot con 2709 này giá sỉ với lẻ khác nhau không' },
  { nhom: 'tunhien', lenh: '@bot check nhanh giúp em 2709-12V-W' },
  { nhom: 'tunhien', lenh: '@bot khách chốt rồi, 0986921126, 5 bóng 2709-12V-W nhé' },

  // ── NHÓM 7: CA KHÓ (20 ca) — thêm sau vòng chạy đầu
  { nhom: 'kho2', lenh: '@bot 2709-12V-W còn không, nếu còn lên đơn 5 cái cho 0986921126',
    ghiChu: 'điều kiện: nếu còn thì mới lên đơn', mongDoi: 'tao_don_nhap' },
  { nhom: 'kho2', lenh: '@bot so sánh giá 2709-12V-W với 2709-12V=WW', ghiChu: 'so sánh 2 SP cụ thể' },
  { nhom: 'kho2', lenh: '@bot khách 0986921126 với 0389538386 ai nợ nhiều hơn', ghiChu: 'so sánh 2 khách' },
  { nhom: 'kho2', lenh: '@bot lên đơn 5 cái 2709-12V-W cho 0986921126, à khoan 10 cái',
    ghiChu: 'đổi ý giữa câu' },
  { nhom: 'kho2', lenh: '@bot 2709-12V-W giá bao nhiêu? tồn bao nhiêu? khách 0986921126 nợ bao nhiêu?',
    ghiChu: '3 câu hỏi một lượt' },
  { nhom: 'kho2', lenh: '@bot lên đơn cho khách 0986921126 5 cái 2709-12V-W và 3 cái 2709-12V=WW',
    ghiChu: '2 dòng hàng CÓ GIÁ', mongDoi: 'tao_don_nhap' },
  { nhom: 'kho2', lenh: '@bot ko can tra gia, chi lay ton kho 2709-12V-W thoi',
    ghiChu: 'phủ định + không dấu' },
  { nhom: 'kho2', lenh: '@bot đừng lên đơn, chỉ check giúp 2709-12V-W', ghiChu: 'phủ định rõ' },
  { nhom: 'kho2', lenh: '@bot 2709-12V-W', ghiChu: 'chỉ mã, không nói làm gì' },
  { nhom: 'kho2', lenh: '@bot khách 0986921126 muốn mua nhưng chưa biết mua gì', ghiChu: 'mơ hồ' },
  { nhom: 'kho2', lenh: '@bot lên đơn 5 cái 2709-12V-W cho khách tên Bằng', ghiChu: 'khách theo tên riêng' },
  { nhom: 'kho2', lenh: '@bot lên đơn 5 2709-12V-W 0986921126', ghiChu: 'không có từ nối nào' },
  { nhom: 'kho2', lenh: '@bot cho e hỏi con 2709-12V-W nay con hang ko a', ghiChu: 'teencode + không dấu' },
  { nhom: 'kho2', lenh: '@bot 5 cái 2709-12V-W, khách 0986921126, lên luôn nhé',
    ghiChu: 'thứ tự đảo', mongDoi: 'tao_don_nhap' },
  { nhom: 'kho2', lenh: '@bot check tồn 2709-12V-W ở kho HCM thôi', ghiChu: 'lọc theo kho cụ thể' },
  { nhom: 'kho2', lenh: '@bot led dây cob nào có giá', ghiChu: 'lọc theo điều kiện giá' },
  { nhom: 'kho2', lenh: '@bot khách 0986921126 lên đơn 1 cái 2709-12V-W thôi', ghiChu: 'số lượng 1' },
  { nhom: 'kho2', lenh: '@bot tra 2709-12V-W rồi lên đơn 5 cái cho 0986921126',
    ghiChu: 'nói rõ 2 bước', mongDoi: 'tao_don_nhap' },
  { nhom: 'kho2', lenh: '@bot SP nào rẻ nhất trong đám led 3 bóng', ghiChu: 'yêu cầu xếp hạng' },
  { nhom: 'kho2', lenh: '@bot lên đơn cho 0986921126 giống đơn lần trước', ghiChu: 'tham chiếu lịch sử' },
];

interface KetQua {
  ca: Ca;
  trangThai: string;
  tools: string[];
  traLoi: string;
  giay: number;
  soVong: number;
  loiTool: number;
  inputTokens: number;
  loi?: string;
}

async function chayCa(ca: Ca, i: number): Promise<KetQua> {
  const t0 = Date.now();
  const log: ToolCallLog[] = [];
  try {
    const kq = await chayLenhNhanVien(
      {
        odoo, generate,
        ghiNhanChuyenSale: async () => {},
        ghiLog: (l) => { log.push(l); },
      },
      {
        bizName: 'LEDNELIA - shop đèn LED & phụ kiện điện',
        conversationId: `sim-${Date.now()}-${i}`,
        seq: 0,
        message: { content: ca.lenh, isSelf: true },
      },
    );
    return {
      ca,
      trangThai: kq.trangThai,
      tools: log.map((l) => l.toolName),
      traLoi: kq.trangThai === 'xong' ? kq.traLoi : kq.trangThai === 'chua_hoan_tat' ? kq.lyDo : '(không phải lệnh)',
      giay: (Date.now() - t0) / 1000,
      soVong: log.length > 0 ? Math.max(...log.map((l) => l.iteration)) : 0,
      loiTool: log.filter((l) => !l.thanhCong).length,
      inputTokens: kq.trangThai === 'khong_phai_lenh' ? 0 : kq.usage.inputTokens,
    };
  } catch (err) {
    return {
      ca, trangThai: 'NGOAI_LE', tools: log.map((l) => l.toolName),
      traLoi: '', giay: (Date.now() - t0) / 1000, soVong: 0,
      loiTool: log.filter((l) => !l.thanhCong).length, inputTokens: 0,
      loi: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  await odoo.authenticate();
  const ds = NHOM === 'all' ? CAC_CA : CAC_CA.filter((c) => c.nhom === NHOM);
  console.log(`Chạy ${ds.length} ca (nhóm: ${NHOM}, song song: ${SONG_SONG})\n`);

  const kq: KetQua[] = [];
  for (let i = 0; i < ds.length; i += SONG_SONG) {
    const lo = ds.slice(i, i + SONG_SONG);
    const r = await Promise.all(lo.map((c, j) => chayCa(c, i + j)));
    kq.push(...r);
    for (const x of r) {
      const dau = x.loi ? '✗' : x.trangThai === 'xong' ? '✓' : x.trangThai === 'khong_phai_lenh' ? '·' : '!';
      const tools = x.tools.join('→') || '—';
      console.log(`${dau} [${x.ca.nhom}] ${x.ca.lenh.slice(0, 58).padEnd(58)} ${tools.slice(0, 42).padEnd(42)} ${x.giay.toFixed(1)}s`);
      if (x.loi) console.log(`    LỖI: ${x.loi.slice(0, 140)}`);
    }
  }

  // ── Tổng kết ────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(100)}`);
  const xong = kq.filter((x) => x.trangThai === 'xong');
  const chuaXong = kq.filter((x) => x.trangThai === 'chua_hoan_tat');
  const khongLenh = kq.filter((x) => x.trangThai === 'khong_phai_lenh');
  const ngoaiLe = kq.filter((x) => x.trangThai === 'NGOAI_LE');

  console.log(`Tổng: ${kq.length} · xong ${xong.length} · chưa xong ${chuaXong.length} · không phải lệnh ${khongLenh.length} · ngoại lệ ${ngoaiLe.length}`);
  console.log(`Tool lỗi: ${kq.reduce((s, x) => s + x.loiTool, 0)}`);
  const gTb = kq.reduce((s, x) => s + x.giay, 0) / kq.length;
  console.log(`Thời gian TB: ${gTb.toFixed(1)}s · chậm nhất ${Math.max(...kq.map((x) => x.giay)).toFixed(1)}s`);
  console.log(`Token TB: ${Math.round(kq.reduce((s, x) => s + x.inputTokens, 0) / kq.length)}`);
  console.log(`Số vòng TB: ${(kq.reduce((s, x) => s + x.soVong, 0) / kq.length).toFixed(1)} · nhiều nhất ${Math.max(...kq.map((x) => x.soVong))}`);

  if (ngoaiLe.length > 0) {
    console.log(`\n── NGOẠI LỆ (${ngoaiLe.length}) ──`);
    ngoaiLe.forEach((x) => console.log(`  ${x.ca.lenh}\n    ${x.loi}`));
  }
  if (chuaXong.length > 0) {
    console.log(`\n── CHƯA HOÀN TẤT (${chuaXong.length}) ──`);
    chuaXong.forEach((x) => console.log(`  ${x.ca.lenh}\n    ${x.traLoi}`));
  }

  const mongDoiHut = kq.filter((x) => x.ca.mongDoi && !x.tools.includes(x.ca.mongDoi));
  if (mongDoiHut.length > 0) {
    console.log(`\n── KHÔNG ĐẠT MONG ĐỢI (${mongDoiHut.length}) ──`);
    mongDoiHut.forEach((x) => console.log(`  ${x.ca.lenh}\n    mong: ${x.ca.mongDoi} · thực: ${x.tools.join('→') || '(không)'}\n    → ${x.traLoi.slice(0, 130)}`));
  }

  const cham = kq.filter((x) => x.giay > 15);
  if (cham.length > 0) {
    console.log(`\n── CHẬM >15s (${cham.length}) ──`);
    cham.forEach((x) => console.log(`  ${x.giay.toFixed(1)}s · ${x.ca.lenh}`));
  }

  const nhieuVong = kq.filter((x) => x.soVong >= 4);
  if (nhieuVong.length > 0) {
    console.log(`\n── NHIỀU VÒNG ≥4 (${nhieuVong.length}) ──`);
    nhieuVong.forEach((x) => console.log(`  ${x.soVong} vòng · ${x.ca.lenh} · ${x.tools.join('→')}`));
  }

  // Dọn đơn đã tạo
  const don = await odoo.searchRead<{ id: number }>(
    'sale.order', [['client_order_ref', 'like', 'zalo:sim-%']], ['id'],
  );
  for (const d of don) {
    try { await odoo.execute('sale.order', 'unlink', [[d.id]]); } catch { /* bỏ qua */ }
  }
  console.log(`\nĐã dọn ${don.length} đơn thử nghiệm.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

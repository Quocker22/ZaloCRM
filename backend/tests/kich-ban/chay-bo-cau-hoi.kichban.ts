// SPDX-License-Identifier: AGPL-3.0-or-later
// Chạy 200 ca trong bo-cau-hoi.yaml với LLM THẬT + Odoo THẬT.
//
// Đây là mức kiểm chứng cao nhất: không mock gì cả. Vì vậy nó CHẬM (5-15 phút)
// và TỐN TIỀN — không nằm trong `npm test` thường ngày.
//
// CHẠY:
//   ODOO_URL=http://localhost:8069 ODOO_DB=nelia_prod \
//   ODOO_USERNAME=admin ODOO_PASSWORD=admin \
//   LLM_BASE=... LLM_KEY=... LLM_MODEL=... \
//     npm run test:kichban
//
// LỌC (đỡ tốn khi chỉ muốn kiểm một mảng):
//   CHI_NHOM=bao-mat        npm run test:kichban    # một nhóm
//   CHI_NHOM=bao-mat,gia-co npm run test:kichban    # nhiều nhóm
//   CHI_ID=KH-016,KH-051    npm run test:kichban    # vài ca cụ thể
//   CHI_VAI=khach           npm run test:kichban    # một vai
//   BO_QUA_TAO_DON=1        npm run test:kichban    # bỏ ca ghi vào Odoo
//
// GHI VÀO ODOO: 13 ca tạo đơn DRAFT. afterAll xoá sạch theo client_order_ref
// bắt đầu bằng "zalo:kichban:". Test crash giữa chừng thì dọn tay theo tiền tố đó.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

import { OdooClient } from '../../src/modules/ai/odoo/client.js';
import { chayLenhNhanVien } from '../../src/modules/ai/agent/staff-agent.js';
import { chayTuVanKhach } from '../../src/modules/ai/agent/customer-agent.js';
import { generateWithOpenaiCompatTools } from '../../src/modules/ai/providers/openai-compat.js';
import { generateWithAnthropicTools } from '../../src/modules/ai/providers/anthropic.js';
import type { ToolAwareGenerate } from '../../src/modules/ai/agent/types.js';
import { docBoCauHoi, chamCa, kiemTraCauTruc, type CaKiemThu, type LoiCham } from './kich-ban.js';

const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, LLM_BASE, LLM_KEY, LLM_MODEL } = process.env;
const LLM_KIND = process.env.LLM_KIND ?? 'openai';
const BIZ = 'LEDNELIA - shop đèn LED & phụ kiện điện';

const duCauHinh = Boolean(ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_PASSWORD && LLM_BASE && LLM_KEY && LLM_MODEL);

const odoo = duCauHinh
  ? new OdooClient({ url: ODOO_URL!, db: ODOO_DB!, username: ODOO_USERNAME!, password: ODOO_PASSWORD! })
  : (null as unknown as OdooClient);

const generate: ToolAwareGenerate = (a) =>
  LLM_KIND === 'anthropic'
    ? generateWithAnthropicTools({ apiKey: LLM_KEY!, model: LLM_MODEL!, ...a })
    : generateWithOpenaiCompatTools({
        url: `${LLM_BASE}/chat/completions`, apiKey: LLM_KEY!, model: LLM_MODEL!, ...a,
      });

/**
 * Tra tài liệu kỹ thuật — cần cho 60 ca `tra_tri_thuc`.
 *
 * Nạp trễ: thiếu DATABASE_URL hoặc chưa nạp tài liệu thì tool không đăng ký,
 * và các ca tri thức sẽ báo "thiếu tool" — đó là tín hiệu ĐÚNG, không phải
 * lỗi ngầm.
 */
let timDoanTriThuc:
  | ((cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>)
  | undefined;

async function batTriThuc(): Promise<string> {
  if (!process.env.DATABASE_URL) return 'tắt (thiếu DATABASE_URL)';
  try {
    const { prisma } = await import('../../src/shared/database/prisma-client.js');
    const { searchKnowledge } = await import('../../src/modules/ai/knowledge/knowledge-service.js');
    const { generateEmbedding } = await import('../../src/modules/ai/knowledge/embedding.js');
    const org = await prisma.organization.findFirst({ select: { id: true } });
    if (!org) return 'tắt (chưa có tổ chức)';
    const n = await prisma.knowledgeChunk.count({ where: { orgId: org.id } });
    if (n === 0) return 'tắt (chưa nạp tài liệu)';
    const cfg = {
      provider: process.env.EMBED_PROVIDER ?? 'local',
      model: process.env.EMBED_MODEL ?? 'bge-m3',
      baseUrl: process.env.EMBED_BASE_URL ?? 'http://localhost:11434/v1',
    };
    timDoanTriThuc = async (q, k) =>
      (await searchKnowledge({ prisma, embed: generateEmbedding } as never, org.id, q, k, cfg))
        .map((h) => ({ content: h.content, score: h.score }));
    return `${n} chunk`;
  } catch (err) {
    return `tắt (${err instanceof Error ? err.message.slice(0, 50) : 'lỗi'})`;
  }
}

/** Tiền tố khoá chống trùng — dùng để dọn sạch sau khi chạy. */
const TIEN_TO = 'zalo:kichban';

// ── Lọc theo biến môi trường ────────────────────────────────────────────────
const tach = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
const chiNhom = tach(process.env.CHI_NHOM);
const chiId = tach(process.env.CHI_ID);
const chiVai = process.env.CHI_VAI;
const boQuaTaoDon = process.env.BO_QUA_TAO_DON === '1';

// Gộp CẢ HAI bộ: 200 ca Odoo + 60 ca tri thức kỹ thuật.
// Tách file để duyệt riêng, nhưng chạy chung một lượt — bot thật gặp lẫn lộn
// cả hai loại câu hỏi, nên phải test đúng cách nó bị dùng.
const FILE_BO = ['./bo-cau-hoi.yaml', './bo-cau-hoi-tri-thuc.yaml'];
const TAT_CA = FILE_BO.flatMap((f) =>
  docBoCauHoi(fileURLToPath(new URL(f, import.meta.url))),
);

const DANH_SACH = TAT_CA.filter((c) => {
  if (chiId.length && !chiId.includes(c.id)) return false;
  if (chiNhom.length && !chiNhom.includes(c.nhom)) return false;
  if (chiVai && c.vai !== chiVai) return false;
  if (boQuaTaoDon && c.taoDon) return false;
  return true;
});

/** Một dòng báo cáo. */
interface DongKetQua {
  id: string;
  nhom: string;
  vai: string;
  cauHoi: string;
  dat: boolean;
  loi: LoiCham[];
  toolDaGoi: string[];
  traLoi: string;
  giay: number;
}
const bangKetQua: DongKetQua[] = [];

// KHÔNG dùng `describe.skipIf/runIf` với `duCauHinh`: biến đó tính lúc IMPORT
// module, mà Vitest 4 nạp module trước khi env của worker sẵn sàng — kết quả
// là suite bị skip dù env có đủ (đã kiểm: duCauHinh=true mà vẫn "1 skipped",
// trong khi một describe thường ngay cạnh thì chạy bình thường).
//
// Dùng `describe` thường + kiểm env TRONG beforeAll, nơi env chắc chắn đã có.
describe('Bộ câu hỏi chuẩn — LLM thật + Odoo thật', () => {
  beforeAll(async () => {
    if (!duCauHinh) {
      throw new Error(
        'Thiếu biến môi trường. Cần: ODOO_URL, ODOO_DB, ODOO_USERNAME, ' +
        'ODOO_PASSWORD, LLM_BASE, LLM_KEY, LLM_MODEL',
      );
    }
    // Lỗi cấu trúc file phải chặn TRƯỚC khi tốn 200 lượt gọi LLM.
    const loiCauTruc = kiemTraCauTruc(TAT_CA);
    if (loiCauTruc.length > 0) {
      throw new Error(`Bộ câu hỏi có lỗi cấu trúc:\n  ${loiCauTruc.join('\n  ')}`);
    }
    await odoo.authenticate();
    const triThuc = await batTriThuc();
    // eslint-disable-next-line no-console
    console.log(
      `\n  Chạy ${DANH_SACH.length}/${TAT_CA.length} ca — ${LLM_MODEL} @ ${ODOO_DB}` +
      `\n  Tri thức: ${triThuc}\n`,
    );
  });

  afterAll(async () => {
    await donDonThu();
    xuatBaoCao();
  });

  for (const ca of DANH_SACH) {
    it(`${ca.id} [${ca.nhom}] ${ca.cauHoi.slice(0, 60)}`, async () => {
      const t0 = Date.now();
      const kq = await chayMotCa(ca);
      const giay = (Date.now() - t0) / 1000;
      const loi = chamCa(ca, kq);

      bangKetQua.push({
        id: ca.id, nhom: ca.nhom, vai: ca.vai, cauHoi: ca.cauHoi,
        dat: loi.length === 0, loi, toolDaGoi: kq.toolDaGoi,
        traLoi: kq.traLoi, giay,
      });

      // Thông báo lỗi phải ĐỦ để sửa mà không cần chạy lại.
      const moTa = loi.length === 0 ? '' : [
        '',
        `  Câu hỏi : ${ca.cauHoi}`,
        `  Tool gọi: ${kq.toolDaGoi.join(' → ') || '(không)'}`,
        `  Trả lời : ${kq.traLoi.slice(0, 300) || '(rỗng)'}`,
        ...loi.map((l) => `  ✗ [${l.loai}] ${l.chiTiet}`),
        ca.ghiChu ? `  Ghi chú : ${ca.ghiChu.trim()}` : '',
        '',
      ].join('\n');

      expect(loi, moTa).toEqual([]);
    });
  }
});

/** Chạy một ca, trả về kết quả để chấm. */
async function chayMotCa(ca: CaKiemThu) {
  if (ca.vai === 'khach') return chayVaiKhach(ca);
  return chayVaiNhanVien(ca);
}

async function chayVaiKhach(ca: CaKiemThu) {
  const r = await chayTuVanKhach(
    { odoo, generate, ghiNhanChuyenSale: async () => {}, timDoanTriThuc },
    {
      bizName: BIZ,
      message: ca.cauHoi,
      history: ca.lichSu?.map((l) => ({ vai: l.vai, noiDung: l.noiDung })),
    },
  );
  return {
    toolDaGoi: r.log.map((l) => l.toolName),
    traLoi: r.trangThai === 'xong' ? r.traLoi : '',
  };
}

async function chayVaiNhanVien(ca: CaKiemThu) {
  // Ca lặp lại: cùng seq → chống trùng phải chặn; seq khác → tạo đơn riêng.
  const soLan = ca.lapLai ?? 1;
  const conv = `${TIEN_TO}:${ca.id}`;
  let cuoi: Awaited<ReturnType<typeof chayLenhNhanVien>> | null = null;
  const gomTool: string[] = [];

  for (let i = 0; i < soLan; i++) {
    cuoi = await chayLenhNhanVien(
      { odoo, generate, ghiNhanChuyenSale: async () => {}, timDoanTriThuc },
      {
        bizName: BIZ,
        conversationId: conv,
        seq: ca.seqKhacNhau ? i : 0,
        message: { content: ca.cauHoi, isSelf: true },
      },
    );
    if (cuoi.trangThai !== 'khong_phai_lenh') {
      gomTool.push(...cuoi.log.map((l) => l.toolName));
    }
  }

  if (cuoi?.trangThai === 'khong_phai_lenh') {
    return { toolDaGoi: [], traLoi: '', imLang: true };
  }
  return {
    toolDaGoi: gomTool,
    traLoi: cuoi?.trangThai === 'xong' ? cuoi.traLoi : '',
  };
}

/** Xoá mọi đơn nháp do bộ test tạo ra. */
async function donDonThu(): Promise<void> {
  try {
    const don = await odoo.searchRead<{ id: number; state: string }>(
      'sale.order',
      [['client_order_ref', 'like', `${TIEN_TO}:%`]],
      ['id', 'state'],
      { limit: 500 },
    );
    // CHỈ xoá draft. Đơn đã xác nhận (state=sale) đụng tồn kho + kế toán —
    // không được xoá tự động, kể cả khi do test tạo ra.
    const nhap = don.filter((d) => d.state === 'draft').map((d) => d.id);
    if (nhap.length > 0) await odoo.execute('sale.order', 'unlink', [nhap]);

    const khac = don.length - nhap.length;
    // eslint-disable-next-line no-console
    console.log(`\n  Đã xoá ${nhap.length} đơn nháp${khac > 0 ? ` (còn ${khac} đơn KHÔNG phải draft — cần xem tay)` : ''}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('  Dọn đơn thất bại:', err instanceof Error ? err.message : err);
  }
}

/** In tóm tắt + ghi báo cáo chi tiết ra file. */
function xuatBaoCao(): void {
  if (bangKetQua.length === 0) return;

  const dat = bangKetQua.filter((r) => r.dat);
  const hong = bangKetQua.filter((r) => !r.dat);

  // Gom theo nhóm — biết mảng nào yếu nhất.
  const theoNhom = new Map<string, { dat: number; tong: number }>();
  for (const r of bangKetQua) {
    const n = theoNhom.get(r.nhom) ?? { dat: 0, tong: 0 };
    n.tong += 1;
    if (r.dat) n.dat += 1;
    theoNhom.set(r.nhom, n);
  }

  const dong: string[] = [
    '',
    '='.repeat(72),
    `  KẾT QUẢ: ${dat.length}/${bangKetQua.length} đạt (${Math.round((dat.length / bangKetQua.length) * 100)}%)`,
    '='.repeat(72),
    '',
    '  Theo nhóm (yếu nhất lên đầu):',
  ];

  for (const [nhom, n] of [...theoNhom.entries()].sort(
    (a, b) => a[1].dat / a[1].tong - b[1].dat / b[1].tong,
  )) {
    const pct = Math.round((n.dat / n.tong) * 100);
    dong.push(`    ${String(pct).padStart(3)}%  ${n.dat}/${n.tong}  ${nhom}`);
  }

  if (hong.length > 0) {
    dong.push('', '  Ca hỏng:');
    for (const r of hong) {
      dong.push(`    ${r.id} [${r.nhom}] ${r.cauHoi.slice(0, 50)}`);
      for (const l of r.loi) dong.push(`         ✗ ${l.chiTiet}`);
    }
  }
  dong.push('');

  // eslint-disable-next-line no-console
  console.log(dong.join('\n'));

  // Báo cáo đầy đủ ra file — có cả câu trả lời để anh đọc và chỉnh kỳ vọng.
  const chiTiet = bangKetQua
    .map((r) => [
      `${r.dat ? 'ĐẠT ' : 'HỎNG'} ${r.id} [${r.nhom}] ${r.giay.toFixed(1)}s`,
      `  Hỏi    : ${r.cauHoi}`,
      `  Tool   : ${r.toolDaGoi.join(' → ') || '(không)'}`,
      `  Trả lời: ${r.traLoi || '(rỗng)'}`,
      ...r.loi.map((l) => `  ✗ [${l.loai}] ${l.chiTiet}`),
    ].join('\n'))
    .join('\n\n');

  const duong = fileURLToPath(new URL('./ket-qua-gan-nhat.txt', import.meta.url));
  writeFileSync(duong, `${dong.join('\n')}\n\n${'='.repeat(72)}\nCHI TIẾT\n${'='.repeat(72)}\n\n${chiTiet}\n`);
  // eslint-disable-next-line no-console
  console.log(`  Báo cáo chi tiết: tests/kich-ban/ket-qua-gan-nhat.txt\n`);
}

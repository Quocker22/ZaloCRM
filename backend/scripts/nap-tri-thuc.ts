// SPDX-License-Identifier: AGPL-3.0-or-later
// Nạp tài liệu kỹ thuật (PDF) vào bảng tri thức.
//
// VÌ SAO KHÔNG DÙNG PATHWAY (đo thật 2026-08-02):
//   Docling (parser của Pathway) mất 8-15 phút cho 7 file và CHẾT VÌ HẾT RAM
//   với file 18MB (OOMKilled, exit 137) — rồi vẫn liệt kê file đó trong
//   list_documents nên nhìn như đã index, thực tế mất trắng.
//   PyMuPDF làm cùng việc đó trong 1,17 GIÂY, không model ML, không chết.
//
// LUỒNG: PyMuPDF trích text → chunkText() → bge-m3 (Ollama local) → Postgres
// Toàn bộ chạy trên hạ tầng SẴN CÓ, không thêm service nào.
//
// CHẠY:
//   npx tsx scripts/nap-tri-thuc.ts <thư-mục-pdf> [--org=<id>] [--xoa-cu]

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { prisma } from '../src/shared/database/prisma-client.js';
import { ingestDocument } from '../src/modules/ai/knowledge/knowledge-service.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';

/** Embedding local qua Ollama — khớp 1024 chiều của dữ liệu đã có. */
const EMBED = {
  provider: 'local',
  model: process.env.EMBED_MODEL ?? 'bge-m3',
  baseUrl: process.env.EMBED_BASE_URL ?? 'http://localhost:11434/v1',
};

/**
 * Chặn file chứa GIÁ NỘI BỘ lọt vào tri thức.
 *
 * Ca thật: `agent price and weight.xlsx` có cột `Agent price`, `VIP price`,
 * `Project price` cho 120 model — đó là giá đại lý mua vào (giá vốn). Hệ thống
 * đã cẩn thận chặn giá vốn ở `tra_san_pham` (danh sách trắng field) và
 * `bao_cao_ban_hang` (xoá cột cost). Index file này vào RAG là mở cửa sau —
 * và cửa đó KHÔNG có danh sách trắng nào canh vì RAG trả đoạn văn thô.
 */
const TU_KHOA_CAM = [
  'agent price', 'vip price', 'project price', 'giá vốn', 'gia von',
  'giá nhập', 'gia nhap', 'cost price', 'wholesale price',
];

/** Text ngắn hơn ngưỡng này coi như trích hỏng (PDF toàn ảnh, cần OCR). */
const TOI_THIEU_KY_TU = 200;

/** Trích text bằng PyMuPDF. Trả rỗng nếu không trích được. */
function trichText(duongDan: string): string {
  const ra = join(tmpdir(), `trich-${Date.now()}.txt`);
  const py = process.env.PYTHON_BIN ?? 'python3';
  const script = `
import sys, pymupdf
d = pymupdf.open(sys.argv[1])
open(sys.argv[2], 'w').write("\\n".join(p.get_text() for p in d))
`;
  try {
    execFileSync(py, ['-c', script, duongDan, ra], { stdio: 'pipe', timeout: 120_000 });
    const txt = execFileSync('cat', [ra], { encoding: 'utf8' });
    unlinkSync(ra);
    return txt;
  } catch (err) {
    // Không có pymupdf → thử pdftotext (poppler) làm dự phòng.
    try {
      return execFileSync('pdftotext', [duongDan, '-'], {
        encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120_000,
      });
    } catch {
      throw new Error(
        `Không trích được text: ${err instanceof Error ? err.message : err}\n` +
        'Cài: pip install pymupdf   HOẶC   brew install poppler',
      );
    }
  }
}

/** File có chứa giá nội bộ không? */
export function coGiaNoiBo(ten: string, noiDung: string): string | null {
  const soat = `${ten}\n${noiDung.slice(0, 5000)}`.toLowerCase();
  return TU_KHOA_CAM.find((k) => soat.includes(k)) ?? null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const thuMuc = args.find((a) => !a.startsWith('--'));
  const orgArg = args.find((a) => a.startsWith('--org='))?.slice(6);
  const xoaCu = args.includes('--xoa-cu');

  if (!thuMuc || !existsSync(thuMuc)) {
    console.error('Dùng: npx tsx scripts/nap-tri-thuc.ts <thư-mục-pdf> [--org=<id>] [--xoa-cu]');
    process.exit(1);
  }

  // Không truyền --org thì lấy org duy nhất. Nhiều org mà không chỉ định là
  // nhập nhầm chỗ — thà dừng còn hơn nạp sai tổ chức.
  let orgId = orgArg;
  if (!orgId) {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    if (orgs.length !== 1) {
      console.error(`Có ${orgs.length} tổ chức — phải chỉ rõ --org=<id>:`);
      orgs.forEach((o) => console.error(`  ${o.id}  ${o.name}`));
      process.exit(1);
    }
    orgId = orgs[0].id;
    console.log(`Tổ chức: ${orgs[0].name} (${orgId})\n`);
  }

  if (xoaCu) {
    const { count } = await prisma.knowledgeDocument.deleteMany({ where: { orgId } });
    console.log(`Đã xoá ${count} tài liệu cũ (chunk xoá theo cascade)\n`);
  }

  const files = readdirSync(thuMuc)
    .filter((f) => ['.pdf', '.txt', '.md'].includes(extname(f).toLowerCase()))
    .map((f) => join(thuMuc, f));

  if (files.length === 0) {
    console.error(`Không có file .pdf/.txt/.md nào trong ${thuMuc}`);
    process.exit(1);
  }

  let tongChunk = 0;
  const boQua: string[] = [];

  for (const f of files) {
    const ten = basename(f);
    const t0 = Date.now();
    let text: string;
    try {
      text = extname(f).toLowerCase() === '.pdf'
        ? trichText(f)
        : execFileSync('cat', [f], { encoding: 'utf8' });
    } catch (err) {
      console.log(`✗ ${ten}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      boQua.push(ten);
      continue;
    }

    // HÀNG RÀO GIÁ VỐN — kiểm TRƯỚC khi ghi bất cứ thứ gì.
    const dinhGia = coGiaNoiBo(ten, text);
    if (dinhGia) {
      console.log(`⚠ ${ten}: BỎ QUA — chứa giá nội bộ ("${dinhGia}")`);
      boQua.push(ten);
      continue;
    }

    // Trích quá ít chữ = PDF toàn ảnh. Nạp vào chỉ tổ làm nhiễu tìm kiếm.
    if (text.trim().length < TOI_THIEU_KY_TU) {
      console.log(`⚠ ${ten}: BỎ QUA — chỉ ${text.trim().length} ký tự (PDF ảnh? cần OCR)`);
      boQua.push(ten);
      continue;
    }

    const kq = await ingestDocument(
      { prisma, embed: generateEmbedding },
      orgId,
      { title: ten.replace(/\.[^.]+$/, ''), source: 'datasheet', content: text },
      EMBED,
    );
    tongChunk += kq.chunks;
    console.log(
      `✓ ${ten.slice(0, 42).padEnd(42)} ${String(text.length).padStart(7)} ký tự ` +
      `→ ${String(kq.chunks).padStart(3)} chunk  [${((Date.now() - t0) / 1000).toFixed(1)}s]`,
    );
  }

  console.log(`\nTổng: ${files.length - boQua.length}/${files.length} file, ${tongChunk} chunk`);
  if (boQua.length > 0) console.log(`Bỏ qua: ${boQua.join(', ')}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('LỖI:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});

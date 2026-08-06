// SPDX-License-Identifier: AGPL-3.0-or-later
// GỬI RA ZALO — mọi thứ rời khỏi hệ thống đi qua file này: tin nhắn, ảnh hoá
// đơn, mã QR. Tách riêng để (1) đọc một file là biết bot GỬI GÌ cho ai, và
// (2) test hai luồng không phải giả lập zaloOps ở nhiều chỗ.
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { zaloOps } from '../../../../shared/zalo-operations.js';
import { logger } from '../../../../shared/utils/logger.js';
import { humanPace } from '../../knowledge/human-pace.js';
import { getQrConfig, buildTransferNote, renderVietQrImage } from '../../knowledge/qr-image.js';
import { layAnhClient } from './du-lieu.js';

/** Đích gửi một hội thoại Zalo + thông tin khách đã biết. */
export interface DichGui {
  accountId: string;
  threadId: string;
  threadType: 0 | 1;
  /** UID Zalo của khách — khoá chống trùng khi tạo khách Odoo. */
  zaloUid: string | null;
  /** Tên đã biết từ Zalo/CRM — để bot khỏi hỏi lại thứ đã có. */
  tenKhach: string | null;
  sdtKhach: string | null;
}

/** Tra đích gửi từ conversationId. Không đủ dữ liệu → null, caller dừng có log. */
export async function timDich(conversationId: string): Promise<DichGui | null> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      zaloAccountId: true, threadType: true, externalThreadId: true,
      contact: { select: { zaloUid: true, fullName: true, crmName: true, phone: true } },
    },
  });
  if (!c?.zaloAccountId) return null;
  // Group có externalThreadId riêng; hội thoại 1-1 dùng zaloUid của contact.
  const threadId = c.externalThreadId ?? c.contact?.zaloUid;
  if (!threadId) return null;
  return {
    accountId: c.zaloAccountId,
    threadId,
    threadType: c.threadType === 'group' ? 1 : 0,
    zaloUid: c.contact?.zaloUid ?? null,
    // Ưu tiên tên nhân viên đặt trong CRM (crmName) hơn tên Zalo tự khai.
    tenKhach: c.contact?.crmName || c.contact?.fullName || null,
    sdtKhach: c.contact?.phone || null,
  };
}

/**
 * Gửi một tin văn bản.
 *
 * @param giaNguoi giãn theo nhịp gõ người trước khi gửi.
 *   BẬT cho khách: trả lời tức thì thì lộ là bot, và Zalo gắn cờ spam.
 *   TẮT cho nhân viên: họ BIẾT đang nói với bot, bắt chờ 9s mỗi lệnh là vô ích.
 */
export async function guiTin(dich: DichGui, text: string, giaNguoi: boolean): Promise<void> {
  if (giaNguoi) await humanPace(text.length);
  await zaloOps.sendMessage(dich.accountId, dich.threadId, dich.threadType, { msg: text });
}

/** Gửi một ảnh theo đường dẫn file cục bộ. Lỗi thì ném — caller quyết nuốt hay không. */
export async function guiAnh(dich: DichGui, duongDan: string, giaNguoi: boolean): Promise<void> {
  if (giaNguoi) await humanPace(60);
  await zaloOps.sendImage(dich.accountId, dich.threadId, dich.threadType, [duongDan]);
}

/**
 * Gửi một FILE (xlsx…) theo đường dẫn cục bộ — cho báo cáo dài (spec 06/08).
 * zca-js nhận diện loại theo ĐUÔI file, nên đường dẫn phải có .xlsx thật.
 * Không giả nhịp người: file chỉ đi trong luồng nhân viên.
 */
export async function guiFile(dich: DichGui, duongDan: string, caption = ''): Promise<void> {
  await zaloOps.sendFile(dich.accountId, dich.threadId, dich.threadType, [duongDan], null, caption);
}

/**
 * Ghi ảnh ra file tạm — `zaloOps.sendImage` nhận đường dẫn, không nhận Buffer.
 *
 * Không dọn file: thư mục tạm do OS dọn, và giữ lại thì còn tra được khi
 * nhân viên báo "ảnh sai".
 */
export async function ghiAnhTam(duLieu: Buffer, tenFile: string): Promise<string> {
  const dir = join(tmpdir(), 'zcrm-hoadon');
  await mkdir(dir, { recursive: true });
  const duongDan = join(dir, `${Date.now()}-${tenFile}`);
  await writeFile(duongDan, duLieu);
  return duongDan;
}

/**
 * Gửi ảnh hoá đơn rồi QR chuyển khoản sau khi khách chốt đơn.
 *
 * THỨ TỰ CÓ Ý: hoá đơn trước (khách xem lại đúng chưa), QR sau (chuyển tiền).
 * Đảo lại thì khách chuyển tiền trước khi kịp xem mình mua gì.
 *
 * Mọi bước KHÔNG chặn nhau: hoá đơn lỗi vẫn gửi QR, QR lỗi vẫn còn hoá đơn.
 * Đơn đã nằm trong Odoo rồi — im lặng hoàn toàn mới là tệ nhất.
 */
export async function guiHoaDonVaQr(
  dich: DichGui,
  don: { donId: number; maDon: string; tongTien: number; tenKhach: string },
): Promise<void> {
  const anhClient = layAnhClient();
  if (anhClient && process.env.ODOO_URL) {
    try {
      const anh = await anhClient.render(don.donId, don.maDon);
      if (anh) {
        const duongDan = await ghiAnhTam(anh.duLieu, anh.tenFile);
        await guiAnh(dich, duongDan, true);
      }
    } catch (err) {
      logger.warn({ err, donId: don.donId }, '[agent/khach] gửi hoá đơn lỗi (vẫn gửi QR)');
    }
  }

  // QR: thiếu cấu hình ngân hàng thì bỏ qua, KHÔNG báo lỗi cho khách — họ
  // không làm gì được với thông tin đó.
  const qrCfg = getQrConfig();
  if (!qrCfg) {
    logger.warn('[agent/khach] chưa cấu hình AI_QR_BANK_BIN — bỏ qua QR');
    return;
  }
  try {
    const hhmm = new Date().toISOString().slice(11, 16).replace(':', '');
    const note = buildTransferNote(don.tenKhach || 'khach', hhmm);
    const qr = await renderVietQrImage(qrCfg, don.tongTien, note);
    await guiAnh(dich, qr, true);
    const dong = [
      `Số tiền: ${don.tongTien.toLocaleString('vi-VN')}đ`,
      `Nội dung: ${note}`,
      ...(qrCfg.accountName ? [`Chủ TK: ${qrCfg.accountName}`] : []),
    ].join('\n');
    await guiTin(dich, dong, false); // đã giãn ở guiAnh, khỏi giãn lần nữa
  } catch (err) {
    logger.warn({ err, donId: don.donId }, '[agent/khach] gửi QR lỗi (bỏ qua)');
  }
}

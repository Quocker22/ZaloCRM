// SPDX-License-Identifier: AGPL-3.0-or-later
// NGÂN SÁCH THỜI GIAN cho một lượt agent.
//
// BUG LẶP ĐI LẶP LẠI: nhân viên nhận "Bot gặp lỗi (lượt agent quá hạn
// 90000ms). Anh/chị xử lý giúp nhé." Anh Quốc 11/08: "sao cứ lỗi ... hoài
// vậy????" rồi "bỏ cái báo lỗi đó đi được không".
//
// CHẨN ĐOÁN (đo thật trên prod 11/08) — không phải model chậm, mà là CÁC CON
// SỐ KHÔNG KHỚP NHAU:
//   - mọi tool call     : < 700ms (tool không hề chậm)
//   - một lượt gọi model: ~2s với đủ prompt thật + 22 tool
//   - khoảng trống giữa hai vòng trong ca treo: 32-62s
//   - agent lặp tối đa 8 vòng; MỖI vòng tự thử lại 4 lần, hạn chờ tăng dần
//     12s → 20s → 30s → 40s, cộng nghỉ giữa các lần 1s → 2s → 4s = 109 GIÂY
//     cho một vòng duy nhất.
//   → Hạn tổng 90s mà một mắt xích được phép chạy 109s. Chỉ cần gateway chậm
//     MỘT lần trong 8 vòng là cả lượt chết, bất kể nhân viên hỏi gì. Đó là lý
//     do lỗi lặp lại "hoài" và không liên quan tới nội dung câu hỏi.
//
// Hai mảnh ở đây:
//   1. `hanConLai` — mỗi lần gọi provider chỉ được chờ trong phần CÒN LẠI của
//      ngân sách, thay vì hạn cứng riêng của nó.
//   2. `chayCoHanGioMem` — hết giờ thì lấy kết quả DỞ DANG (dữ liệu tool đã
//      tra được) thay vì vứt hết rồi ném lỗi. Anh Quốc chốt: "trả lời bằng dữ
//      liệu đã tra được".

/** Chừa tối thiểu cho một lần gọi, để không cắt xuống 0 rồi mất luôn cơ hội. */
const TOI_THIEU_MS = 1_000;

/**
 * Hạn chờ thực tế cho lần gọi tiếp theo: nhỏ hơn giữa "hạn mong muốn" và
 * "phần còn lại của ngân sách".
 *
 * Trả 0 khi đã hết sạch — caller PHẢI dừng, gọi tiếp chỉ tổ chờ vô ích rồi bị
 * cắt ở tầng trên.
 */
export function hanConLai(input: {
  batDau: number;
  nganSachMs: number;
  bayGio: number;
  hanMongMuon: number;
}): number {
  const daTroi = input.bayGio - input.batDau;
  const conLai = input.nganSachMs - daTroi;
  if (conLai <= 0) return 0;
  return Math.min(input.hanMongMuon, conLai);
}

export type KetQuaCoHan<T> =
  | { trangThai: 'xong'; giaTri: T }
  /** Hết giờ nhưng đã tra được gì đó — trả cái đang có, KHÔNG báo lỗi. */
  | { trangThai: 'do_dang'; giaTri: string }
  /** Hết giờ và chưa có gì — caller nhắn một câu mềm, không lộ số ms. */
  | { trangThai: 'het_gio' };

/**
 * Chạy một việc có hạn, nhưng hết giờ thì LẤY CÁI ĐANG CÓ thay vì ném lỗi.
 *
 * Khác `chayCoHanGio` cũ ở đúng chỗ này: bản cũ dùng Promise.race rồi ném, nên
 * mọi dữ liệu tool đã tra được đều bị vứt — nhân viên nhận câu báo lỗi kỹ
 * thuật trong khi bot đã biết công nợ, đã tra xong khách.
 *
 * Lỗi THẬT (Odoo sập, mất mạng) vẫn ném nguyên: nuốt nó thành "hết giờ" là
 * giấu sự cố, sau này không ai lần ra.
 */
export async function chayCoHanGioMem<T>(input: {
  viec: Promise<T>;
  ms: number;
  /** Lấy phần đã làm được tới lúc này (thường là tóm tắt kết quả tool). */
  layDoDang: () => string | null;
}): Promise<KetQuaCoHan<T>> {
  let hen: NodeJS.Timeout | undefined;
  const HET_GIO = Symbol('het_gio');

  try {
    const kq = await Promise.race([
      input.viec,
      new Promise<typeof HET_GIO>((giaiQuyet) => {
        hen = setTimeout(() => giaiQuyet(HET_GIO), Math.max(input.ms, 0));
      }),
    ]);

    if (kq !== HET_GIO) return { trangThai: 'xong', giaTri: kq as T };

    const doDang = (input.layDoDang() ?? '').trim();
    return doDang ? { trangThai: 'do_dang', giaTri: doDang } : { trangThai: 'het_gio' };
  } finally {
    if (hen) clearTimeout(hen);
  }
}

/** Hạn tối thiểu để một lần gọi còn đáng thử — dưới mức này thì dừng luôn. */
export function conDangThu(ms: number): boolean {
  return ms >= TOI_THIEU_MS;
}

/**
 * Tóm tắt những gì tool đã tra được, để trả lời khi hết giờ.
 *
 * Anh Quốc 11/08 chốt: hết giờ thì "trả lời bằng dữ liệu đã tra được". Bot
 * thường đã biết công nợ, đã tra xong khách — chỉ thiếu bước soạn câu cuối.
 * Vứt hết rồi báo lỗi là phí đúng thứ nhân viên đang cần.
 *
 * Chỉ lấy tool THÀNH CÔNG và có nội dung: kết quả lỗi đưa ra chỉ làm nhân viên
 * rối thêm. Lấy tool CUỐI CÙNG vì nó gần câu hỏi nhất (các tool trước thường
 * là bước tra trung gian: tra khách → tra SP → mới tới cái cần).
 */
export function tomTatDoDang(
  daTra: ReadonlyArray<{ toolName: string; output: string; thanhCong: boolean }>,
): string | null {
  const dung = daTra.filter((t) => t.thanhCong && String(t.output ?? '').trim());
  if (dung.length === 0) return null;
  const cuoi = dung[dung.length - 1];
  const noi = cuoi.output.trim();
  // Cắt cho vừa một tin Zalo — quá dài thì nhân viên cũng không đọc.
  return noi.length > 1200 ? `${noi.slice(0, 1200)}…` : noi;
}

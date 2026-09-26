-- 26/09/2026: lịch sử in "Đã in" / "Đã huỷ" 30 ngày (Cài đặt › Máy in — may-in/lich-su-in.ts).
-- Truy vấn: WHERE org_id = ? AND trang_thai = ? AND updated_at >= now() - 30 ngày
--           ORDER BY updated_at DESC, id DESC LIMIT 51   (+ COUNT(*) cùng điều kiện).
-- print_jobs KHÔNG bao giờ bị dọn (agent-ws còn đọc lệnh cũ để chống in đôi), nên không có index
-- này thì mỗi lần mở thẻ / tự làm mới 15 giây quét MỌI dòng `da_in` từ trước tới nay rồi sắp xếp.
--
-- Chỉ THÊM index — không đổi bảng/cột/dữ liệu. IF NOT EXISTS: chạy lại an toàn (prod từng tạo bảng
-- máy in bằng SQL tay). Bảng nhỏ (vài chục nghìn dòng) → dựng trong mili-giây; CREATE INDEX thường
-- chặn GHI print_jobs trong lúc dựng, không chặn đọc. Code mới chạy ĐÚNG khi chưa có index (chỉ chậm hơn).
CREATE INDEX IF NOT EXISTS "print_jobs_org_id_trang_thai_updated_at_idx"
  ON "print_jobs"("org_id", "trang_thai", "updated_at" DESC);

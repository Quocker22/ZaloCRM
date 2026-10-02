<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- TabGhiChu — các luật nền phía sau bản đồ (docs/78 §0–§1, §5). Chỉ đọc. -->
<template>
  <section class="bdt-tab-khung" aria-label="Ghi chú" style="padding: 16px">
    <div class="bdt-gc-luoi">
      <article v-for="t in THE" :key="t.tieu_de" class="bdt-gc-the">
        <h3><span class="o-ico"><component :is="t.icon" :size="16" /></span>{{ t.tieu_de }}</h3>
        <ul><li v-for="(d, i) in t.dong" :key="i" v-html="d" /></ul>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BookOpenText, Lock, ShieldAlert, Route, Gauge, Layers } from 'lucide-vue-next';

// Nội dung TĨNH do mình viết (không có dữ liệu người dùng) ⇒ v-html an toàn.
const THE = [
  { icon: ShieldAlert, tieu_de: 'Luật an toàn cứng (trong mã, không phải dữ liệu)', dong: [
    'Không giá, SĐT, tiền, lãi vào <b>nhóm khách</b> — ô tick bị khoá kèm lý do; CRM kiểm lại và trả câu lỗi nguyên văn.',
    'Rào <b>tạm im</b> luôn thắng luật: tin tới nhóm đang im thì thành "Bị chặn / tạm im".',
    'Quyền xem theo <b>đích</b>: chỉ Admin thấy doanh số toàn công ty (quyết định 30/09); Sales nhận số của từng người.',
    'Nhóm <b>Kho</b> nhận bản che giá; Admin/Kế toán thấy đủ.',
    'Server kiểm lại mọi luật — trang chỉ chặn sớm và giải thích.',
  ] },
  { icon: Lock, tieu_de: 'Ba kiểu tin', dong: [
    '<b>🔒 Cố định</b> — đích gắn với lượt chat (mã chốt, thẻ hỏi, câu trả lời). Đổi là hỏng nghiệp vụ.',
    '<b>✎ Thêm bản sao</b> — nơi gốc luôn giữ; luật chỉ THÊM đích (vd Xuất hoá đơn → Kế toán).',
    '<b>✎ Tin thông báo</b> — tin mới (in xong, báo cáo ngày…): nơi gốc bot khai vẫn giữ, luật thêm đích tuỳ ý.',
    'Đích luật CRM nhận: nhóm theo chức năng (Kho, Admin, Kế toán, Sales, Khách), một NV chỉ định, người gây ra sự kiện.',
    'Nơi gốc <b>không bao giờ</b> là đích của luật bản sao; trùng nơi thật (cùng nhóm) thì chỉ gửi một tin.',
  ] },
  { icon: Gauge, tieu_de: 'Chế độ tắt / chạy bóng / bật', dong: [
    'Luật mới mặc định <b>chạy bóng</b>: ghi sổ như đã gửi nhưng không gửi.',
    'Panel hiện "Nếu bật, 24 giờ qua sẽ gửi N tin" từ sổ chạy bóng — xem số rồi mới bật.',
    'Hai luật chủ chọn 02/10 (Xuất hoá đơn → Kế toán, In sau chốt → Kho) gieo bằng script quản trị, mặc định <b>chạy bóng</b>.',
    'Mọi thay đổi vào nhật ký (ai, lúc nào, trước/sau) — xem ở <b>Quyền bot › Nhật ký</b>.',
  ] },
  { icon: Route, tieu_de: 'Đọc đường nối', dong: [
    '<b>Luồng nghiệp vụ</b>: tin này dẫn tới tin kia trong cùng một việc.',
    '<b>Bản sao theo luật</b>: luật chủ đặt gửi thêm sang đích khác.',
    '<b>Sự kiện từ nguồn</b>: máy in, Odoo, lịch phát sự kiện ⇒ tin thông báo.',
    '<b>Hỏi lại / quay vòng</b>: quay về bước trước (đi vòng phải/đáy, vào mép phải khối).',
    '<b>Bị chặn / tạm im</b>: rào chặn tin. <b>CRM tự động</b>: CRM tự gửi (báo người trực, lịch hẹn, chào nhóm…), chỉ xem.',
    'Số trong bong tròn là <b>số thứ tự</b> liên kết, không phải số tin. Số tin 7 ngày ở panel.',
  ] },
  { icon: Layers, tieu_de: 'Quyết định mặc định (chủ chưa trả lời H1–H12)', dong: [
    'H1: nhóm Kho = mọi nhóm chức năng kho. H2: in thất bại = sự cố máy + lỗi cuối + quá 5 phút.',
    'H5: báo cáo ngày 18:00 T2–T7 tới nhóm Admin (chạy bóng). H6: lỗi in báo người yêu cầu ở nơi họ gõ, không được thì tin riêng.',
    'H7: nguồn Odoo tự tắt khi thiếu model <b>incokit.moc</b>. H11: tin CRM tự động hiện ở lớp riêng, chỉ xem.',
  ] },
  { icon: BookOpenText, tieu_de: 'Dữ liệu trang này', dong: [
    'Danh mục composer + cạnh "dẫn tới" do bot đẩy sang CRM mỗi lần đồng bộ (docs/78 B4) kèm số đếm 24 giờ / 7 ngày — không gửi nội dung tin; ví dụ là câu mẫu bot tự khai.',
    'Luật thông báo lưu ở CRM; lớp CRM tự động đọc thẳng cấu hình CRM của tổ chức (chỉ xem).',
    'Link sâu: <b>#khoi=</b>, <b>#pha=</b>, <b>#dich=</b>, <b>#lien-ket=A~B</b>, <b>#loai=</b>.',
  ] },
];
</script>

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
    'Không giá, SĐT, tiền, lãi vào <b>nhóm khách</b> — ô tick bị khoá kèm lý do.',
    'Rào <b>tạm im</b> luôn thắng luật: tin tới nhóm đang im thì thành "Bị chặn / tạm im".',
    'Quyền xem theo <b>đích</b>: chỉ Admin thấy doanh số toàn công ty (quyết định 30/09); Sales nhận số của từng người.',
    'Nhóm <b>Kho</b> nhận bản che giá; Admin/Kế toán thấy đủ.',
    'Server kiểm lại mọi luật — trang chỉ chặn sớm và giải thích.',
  ] },
  { icon: Lock, tieu_de: 'Ba kiểu tin', dong: [
    '<b>🔒 Cố định</b> — đích gắn với lượt chat (mã chốt, thẻ hỏi, câu trả lời). Đổi là hỏng nghiệp vụ.',
    '<b>✎ Thêm bản sao</b> — nơi gốc luôn giữ; luật chỉ THÊM đích (vd Xuất hoá đơn → Kế toán).',
    '<b>✎ Đổi tự do</b> — tin thông báo mới (in xong, báo cáo ngày…) — chọn đích nào cũng được.',
    'Nơi gốc <b>không bao giờ</b> là đích của luật bản sao; trùng nơi thật (cùng nhóm) thì chỉ gửi một tin.',
  ] },
  { icon: Gauge, tieu_de: 'Chế độ tắt / chạy bóng / bật', dong: [
    'Luật mới mặc định <b>chạy bóng</b>: ghi sổ như đã gửi nhưng không gửi.',
    'Panel hiện "Nếu bật, 24 giờ qua sẽ gửi N tin" từ sổ chạy bóng — xem số rồi mới bật.',
    'Hai luật chủ chọn 02/10 vào ở <b>bật</b>: Xuất hoá đơn → Kế toán, In sau chốt → Kho.',
    'Mọi thay đổi vào nhật ký (ai, lúc nào, đổi gì).',
  ] },
  { icon: Route, tieu_de: 'Đọc đường nối', dong: [
    '<b>Luồng nghiệp vụ</b>: tin này dẫn tới tin kia trong cùng một việc.',
    '<b>Bản sao theo luật</b>: luật chủ đặt gửi thêm sang đích khác.',
    '<b>Sự kiện từ nguồn</b>: máy in, Odoo, lịch phát sự kiện ⇒ tin thông báo.',
    '<b>Hỏi lại / quay vòng</b>: quay về bước trước (đi vòng phải/đáy, vào mép phải khối).',
    '<b>Bị chặn / tạm im</b>: rào chặn tin. <b>CRM tự động</b>: CRM tự gửi, chỉ xem.',
    'Số trong bong tròn là <b>số thứ tự</b> liên kết, không phải số tin. Số tin 7 ngày ở panel.',
  ] },
  { icon: Layers, tieu_de: 'Quyết định mặc định (chủ chưa trả lời H1–H12)', dong: [
    'H1: nhóm Kho = mọi nhóm chức năng kho. H2: in thất bại = sự cố máy + lỗi cuối + quá 5 phút.',
    'H5: báo cáo ngày 18:00 T2–T7 tới nhóm Admin (chạy bóng). H6: lỗi in báo người yêu cầu ở nơi họ gõ, không được thì tin riêng.',
    'H7: nguồn Odoo tự tắt khi thiếu model <b>incokit.moc</b>. H11: tin CRM tự động hiện ở lớp riêng, chỉ xem.',
  ] },
  { icon: BookOpenText, tieu_de: 'Dữ liệu trang này', dong: [
    'Danh mục composer do bot đẩy sang CRM mỗi 5 phút (docs/78 B4) kèm số đếm 7 ngày — không gửi nội dung tin.',
    'Bản hiện tại dùng <b>dữ liệu mẫu</b>: 46 loại tin + cạnh "dẫn tới" viết tay, số đếm giả.',
    'Link sâu: <b>#khoi=</b>, <b>#pha=</b>, <b>#dich=</b>, <b>#lien-ket=A~B</b>, <b>#loai=</b>.',
  ] },
];
</script>

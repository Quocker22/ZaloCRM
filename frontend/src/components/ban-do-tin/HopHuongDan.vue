<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- HopHuongDan — hộp thoại 80vw×80dvh, mục lục trái 256px, mục trước/sau (SPEC §7). -->
<template>
  <div class="bdt-phu" role="presentation" @click.self="dong">
    <div ref="hop" class="bdt-hop" role="dialog" aria-modal="true" aria-labelledby="bdt-hd-tieu-de">
      <header class="bdt-hop-dau">
        <span class="o-ico"><BookOpenText :size="18" /></span>
        <div><h2 id="bdt-hd-tieu-de">Hướng dẫn đọc bản đồ tin</h2><p class="bdt-nho">{{ MUC.length }} mục · khoảng 3 phút đọc</p></div>
        <button ref="nutDong" type="button" class="bdt-dong-x" style="position: static; margin-left: auto" aria-label="Đóng" @click="dong"><X :size="16" /></button>
      </header>
      <div class="bdt-hop-giua">
        <nav class="bdt-hop-muc" aria-label="Mục lục">
          <button v-for="(m, i) in MUC" :key="i" type="button" :aria-current="i === muc" @click="den(i)"><small>{{ i + 1 }}</small>{{ m.t }}</button>
        </nav>
        <div ref="noi" class="bdt-hop-noi">
          <section v-for="(m, i) in MUC" :key="i" :data-muc="i">
            <div class="ma-muc">Mục {{ i + 1 }}/{{ MUC.length }}</div>
            <h3>{{ m.t }}</h3>
            <p v-for="(d, j) in m.d" :key="j" v-html="d" />
          </section>
        </div>
      </div>
      <footer class="bdt-hop-chan">
        <span>{{ muc + 1 }}/{{ MUC.length }} · {{ MUC[muc].t }}</span>
        <button type="button" class="bdt-nut" style="margin-left: auto" :disabled="muc === 0" @click="den(muc - 1)">‹ Mục trước</button>
        <button type="button" class="bdt-nut" :disabled="muc === MUC.length - 1" @click="den(muc + 1)">Mục tiếp ›</button>
        <button type="button" class="bdt-nut chinh" @click="dong">Đã hiểu</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { BookOpenText, X } from 'lucide-vue-next';
import { bayFocus } from '@/views/settings/ban-do-tin/bay-focus';

const emit = defineEmits<{ dong: [] }>();
const muc = ref(0);
const noi = ref<HTMLElement | null>(null);
const nutDong = ref<HTMLButtonElement | null>(null);
const hop = ref<HTMLElement | null>(null);
let go: (() => void) | null = null;
// Nội dung tĩnh do mình viết ⇒ v-html an toàn.
const MUC = [
  { t: 'Đọc bản đồ trong 30 giây', d: ['Mỗi <b>khối</b> là một loại tin bot gửi, đặt ở <b>cột pha</b> (việc đang làm) và <b>hàng đích</b> (tin tới đâu). Một loại tin gửi tới hai nơi thì có hai khối.', 'Dải trên cùng là <b>Nguồn</b> (máy in, Odoo, lịch); dải dưới cùng là tin <b>CRM tự động</b> — chỉ xem.'] },
  { t: 'Bấm một khối để thấy đầu vào, đầu ra', d: ['Khối được chọn mang nhãn "Đang xem"; khối dẫn tới nó mang "Đầu vào", khối nó dẫn tới mang "Đầu ra". Các khối khác mờ và xám.', 'Panel phải có: khi nào gửi, ví dụ nguyên văn như NV thấy trên Zalo, đích và chế độ.'] },
  { t: 'Sáu loại liên kết', d: ['Luồng nghiệp vụ · Bản sao theo luật · Sự kiện từ nguồn · Hỏi lại / quay vòng · Bị chặn / tạm im · CRM tự động.', 'Bấm một dòng chú giải để lọc theo loại. Số trong bong tròn là số thứ tự liên kết.'] },
  { t: 'Đổi đích của một tin', d: ['Tin 🔒 có đích cố định — đổi là hỏng nghiệp vụ, panel nói rõ vì sao.', 'Tin ✎ bản sao: nơi gốc luôn nhận như mã, luật chỉ THÊM bản sao tới đích khác.', 'Tin ✎ thông báo thuần: đổi đích tự do, theo luật — không có nơi gốc; chưa có luật thì tin KHÔNG gửi tới đâu (khối gợi ý của bot vẽ ở trạng thái Tắt).', 'Mỗi loại tin một luật; tick cập nhật luật đó, ghi nhật ký. Luật mới bắt đầu ở <b>chạy bóng</b>. Thêm người nhận vào luật đang <b>Bật</b> thì trang hỏi trước (hoặc thêm ở chế độ bóng).', 'Tin có giá/SĐT/tiền không bao giờ vào nhóm khách; nhóm khách hiện bot chưa hỗ trợ (ô bị khoá); nhóm Kho nhận bản che giá; tin có doanh số/lãi: bot chặn doanh số toàn công ty khi đích không phải Admin.'] },
  { t: 'Tắt, chạy bóng, bật', d: ['Chạy bóng = ghi sổ như đã gửi nhưng không gửi. Xem "Số bóng lịch sử 24 giờ" rồi mới bật — vừa sửa luật thì trang báo "chưa đủ dữ liệu cho cấu hình mới" (số đó còn gồm cấu hình cũ). Trang hỏi lại trước khi Bật và trước khi "Hoàn lại như mã" / "Xoá luật".', 'Số trên khối là tin <b>đã gửi thật</b> 24 giờ qua; "N bóng" đứng riêng. Rê chuột lên số để xem cả chưa rõ, bị chặn, lỗi.'] },
  { t: 'Phóng to, kéo, toàn màn hình', d: ['<kbd>Ctrl</kbd> + cuộn để phóng; <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> khi đang ở trong sơ đồ. Kéo chuột để di chuyển khi bản đồ lớn hơn khung.', '"Toàn màn hình" giãn cột cho vừa khung; <kbd>Esc</kbd> đóng từng lớp: hộp thoại → bỏ chọn → thoát toàn màn hình.'] },
  { t: 'Tìm nhanh, gửi link', d: ['Ô tìm nhận chữ không dấu, ra khối, đích và liên kết; <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> để chọn.', '"Copy link" chép đúng khối đang xem (#khoi=…) để gửi đồng nghiệp.'] },
];
function den(i: number) {
  muc.value = Math.max(0, Math.min(MUC.length - 1, i));
  noi.value?.querySelector<HTMLElement>(`[data-muc="${muc.value}"]`)?.scrollIntoView?.({ block: 'start' });
}
function dong() { emit('dong'); }
// bẫy focus trong hộp; đóng ⇒ focus về nút "Hướng dẫn sử dụng"
onMounted(() => { if (hop.value) go = bayFocus(hop.value, { dau: nutDong.value }); });
onBeforeUnmount(() => go?.());
</script>

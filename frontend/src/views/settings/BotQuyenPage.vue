<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  BotQuyenPage — Cài đặt › Hệ thống › "Quyền bot" (docs/77 §3.3, 30/09).
  Nơi DUY NHẤT quyết bot trả lời nhóm Zalo nào (chức năng nhóm) và ai là nhân viên, vai gì. Bot đọc cấu
  hình qua bridge mỗi ~60 s ⇒ thay đổi có hiệu lực trên bot trong khoảng 1 phút. Backend chỉ cho owner/admin.
  Ba tab: Nhóm / Nhân viên / Nhật ký — mỗi tab là một component trong components/bot-quyen/, nạp dữ liệu
  khi được mở (v-if) để luôn thấy bản mới nhất sau khi sửa ở tab khác.
-->
<template>
  <!-- Khung Cài đặt (SettingsLayout) luôn nền SÁNG kể cả khi MobileLayout đặt theme tối ⇒ ghim theme sáng cho
       trang + hộp thoại con (overlay kế thừa theme qua provide), để biến --v-theme-* khớp nền thật. -->
  <v-theme-provider theme="hsLight" with-background class="bq-nen">
    <div class="bq-goc bq-trang">
      <header class="bq-dau">
        <div class="bq-dau-ico"><v-icon icon="mdi-shield-key-outline" size="22" /></div>
        <div class="bq-dau-chu">
          <h1>Quyền bot</h1>
          <p>
            Chọn <b>chức năng</b> cho từng nhóm Zalo (bot làm gì trong nhóm) và cho bot biết <b>ai là nhân viên</b>,
            vai gì. Nhóm chưa xếp loại thì bot im. <b>Chỉ quản trị.</b>
          </p>
          <p class="bq-hieu-luc">
            <v-icon size="15" icon="mdi-timer-sand" />
            Thay đổi có hiệu lực trên bot trong khoảng 1 phút.
          </p>
        </div>
      </header>

      <v-tabs v-model="tab" class="bq-tabs" color="primary" density="comfortable" show-arrows>
        <v-tab value="nhom">Nhóm</v-tab>
        <v-tab value="nhan-vien">Nhân viên</v-tab>
        <v-tab value="nhat-ky">Nhật ký</v-tab>
      </v-tabs>
      <v-divider class="mb-4" />

      <BotQuyenNhomTab v-if="tab === 'nhom'" :nguoi-dung-crm="nguoiDungCrm" />
      <BotQuyenNhanVienTab v-else-if="tab === 'nhan-vien'" :nguoi-dung-crm="nguoiDungCrm" />
      <BotQuyenNhatKyTab v-else :nguoi-dung-crm="nguoiDungCrm" />
    </div>
  </v-theme-provider>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { layNguoiDungCrm, type NguoiDungCrm } from '@/api/bot-quyen';
import BotQuyenNhomTab from '@/components/bot-quyen/BotQuyenNhomTab.vue';
import BotQuyenNhanVienTab from '@/components/bot-quyen/BotQuyenNhanVienTab.vue';
import BotQuyenNhatKyTab from '@/components/bot-quyen/BotQuyenNhatKyTab.vue';

type Tab = 'nhom' | 'nhan-vien' | 'nhat-ky';
const tab = ref<Tab>('nhom');
const nguoiDungCrm = ref<NguoiDungCrm[]>([]);

// Danh sách tài khoản CRM chỉ để hiện tên (nhật ký, gắn tài khoản) — hỏng thì trang vẫn dùng được.
onMounted(async () => {
  try {
    nguoiDungCrm.value = await layNguoiDungCrm();
  } catch {
    nguoiDungCrm.value = [];
  }
});
</script>

<style scoped>
@import '@/components/bot-quyen/bot-quyen.css';

.bq-nen { background: transparent !important; }
.bq-trang { max-width: 1100px; }
.bq-dau { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px; }
.bq-dau-ico {
  width: 44px; height: 44px; border-radius: 12px; flex: none; display: grid; place-items: center;
  background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary));
}
.bq-dau-chu { min-width: 0; }
.bq-dau h1 { font-size: 19px; font-weight: 700; margin: 0 0 4px; }
.bq-dau p { color: var(--bq-mo); font-size: 14px; line-height: 1.5; margin: 0; }
.bq-hieu-luc { display: flex; align-items: center; gap: 5px; margin-top: 6px !important; font-size: 13px !important; font-weight: 600; }
@media (max-width: 520px) {
  .bq-dau-ico { display: none; }
}
</style>

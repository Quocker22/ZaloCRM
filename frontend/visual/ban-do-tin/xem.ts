// Khung so ảnh: dựng trang Bản đồ tin không cần router/đăng nhập, dùng client GIẢ LẬP (đúng hợp đồng API).
// ?trong=1 ⇒ bot chưa gửi ảnh chụp (trạng thái trống).
import { createApp } from 'vue';
import BanDoTinPage from '@/views/settings/BanDoTinPage.vue';
import { taoClientMau } from '@/views/settings/ban-do-tin/client-mau';

const q = new URLSearchParams(location.search);
createApp(BanDoTinPage, { client: taoClientMau({ trong: q.get('trong') === '1' }) }).mount('#app');

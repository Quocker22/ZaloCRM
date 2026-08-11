<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  AgentNotifyTargetsPage — "Người nhận thông báo" (spec 11/08/2026).
  Thay env AI_AGENT_THREAD_BAO_SALE: trước đây chỉ báo được về ĐÚNG MỘT nhóm
  Zalo cố định, muốn đổi phải sửa env trên server rồi restart. Giờ admin tự khai
  nơi nhận, chọn loại việc muốn nhận, và bấm "Gửi thử" để kiểm chứng.
  Lối làm bám theo AgentOperatorsPage.vue để quen tay.
-->
<template>
  <div class="ao-page">
    <header class="ao-head">
      <div class="ico">🔔</div>
      <div>
        <h1>Người nhận thông báo</h1>
        <p>
          Khi bot <b>cần người hỗ trợ khách</b> (khách gửi ảnh/voice/file, khách bực, bot bí…),
          tin báo sẽ gửi về những nơi trong danh sách này. Nơi nhận có thể là <b>nhóm Zalo</b>
          hoặc <b>nick cá nhân</b>. Thêm xong nhớ bấm <b>Gửi thử</b> để chắc chắn nhận được.
          <b>Chỉ quản trị.</b>
        </p>
      </div>
    </header>

    <div v-if="loading" class="ao-loading">Đang tải…</div>

    <template v-else>
      <!-- Cảnh báo còn chạy bằng env — để anh Quốc hiểu vì sao tin về nhóm cũ -->
      <div v-if="dangDungEnv" class="ao-note">
        Chưa khai nơi nhận nào, hệ thống vẫn báo về nhóm cấu hình sẵn trên server
        (<code>{{ threadEnv }}</code>) như trước. Thêm một nơi nhận bên dưới thì hệ thống
        chuyển sang dùng danh sách này.
      </div>

      <!-- Đã khai -->
      <section class="ao-card">
        <h2>Đang nhận thông báo ({{ targets.length }})</h2>
        <p v-if="targets.length === 0" class="ao-empty">Chưa khai nơi nhận nào. Xem "Thêm nhanh" bên dưới.</p>
        <table v-else class="ao-table">
          <thead>
            <tr>
              <th>Tên</th><th>Loại</th><th>Khách cần hỗ trợ</th><th>Bot gặp sự cố</th>
              <th>Trạng thái</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in targets" :key="t.id">
              <td>{{ t.tenGoi }}</td>
              <td>{{ t.loaiDich === 'ca_nhan' ? 'Nick cá nhân' : 'Nhóm Zalo' }}</td>
              <td>
                <input type="checkbox" :checked="t.nhanKhachCanHoTro"
                       @change="doiLoaiViec(t, 'nhanKhachCanHoTro', ($event.target as HTMLInputElement).checked)" />
              </td>
              <td>
                <input type="checkbox" :checked="t.nhanBotSuCo"
                       @change="doiLoaiViec(t, 'nhanBotSuCo', ($event.target as HTMLInputElement).checked)" />
              </td>
              <td>
                <button class="ao-toggle" :class="{ on: t.enabled }" @click="toggle(t)">
                  {{ t.enabled ? 'Bật' : 'Tắt' }}
                </button>
              </td>
              <td class="ao-act">
                <button class="ao-thu" :disabled="dangThu === t.id" @click="guiThu(t)">
                  {{ dangThu === t.id ? 'Đang gửi…' : 'Gửi thử' }}
                </button>
                <button class="ao-del" @click="remove(t)">Gỡ</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Thêm bằng tay -->
      <section class="ao-card">
        <h2>Thêm nơi nhận</h2>
        <div class="ao-form">
          <input v-model="moi.tenGoi" class="ao-input" placeholder="Tên gọi (vd: Nhóm trực khách)" />
          <input v-model="moi.threadId" class="ao-input" placeholder="ID nhóm Zalo hoặc UID nick" />
          <select v-model="moi.loaiDich" class="ao-select">
            <option value="nhom">Nhóm Zalo</option>
            <option value="ca_nhan">Nick cá nhân</option>
          </select>
          <label class="ao-chk"><input v-model="moi.nhanKhachCanHoTro" type="checkbox" /> Khách cần hỗ trợ</label>
          <label class="ao-chk"><input v-model="moi.nhanBotSuCo" type="checkbox" /> Bot gặp sự cố</label>
          <button class="ao-gan" @click="them()">Thêm</button>
        </div>
      </section>

      <!-- Thêm nhanh từ hội thoại gần đây -->
      <section class="ao-card">
        <h2>Thêm nhanh — nhóm/nick gần đây ({{ goiY.length }})</h2>
        <p v-if="goiY.length === 0" class="ao-empty">
          Chưa có hội thoại nào trong 30 ngày, hoặc đã khai hết. Dùng ô "Thêm nơi nhận" bên trên.
        </p>
        <table v-else class="ao-table">
          <thead>
            <tr><th>Tên</th><th>Loại</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="g in goiY" :key="g.threadId">
              <td>{{ g.ten }}</td>
              <td>{{ g.loaiDich === 'ca_nhan' ? 'Nick cá nhân' : 'Nhóm Zalo' }}</td>
              <td><button class="ao-gan" @click="themNhanh(g)">Chọn làm nơi nhận</button></td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';

interface Target {
  id: string; tenGoi: string; loaiDich: string; threadId: string;
  nhanKhachCanHoTro: boolean; nhanBotSuCo: boolean; enabled: boolean;
}
interface GoiY { threadId: string; ten: string; loaiDich: string }

const toast = useToast();
const loading = ref(true);
const targets = ref<Target[]>([]);
const goiY = ref<GoiY[]>([]);
const dangDungEnv = ref(false);
const threadEnv = ref<string | null>(null);
const dangThu = ref<string | null>(null);
const moi = reactive({
  tenGoi: '', threadId: '', loaiDich: 'nhom',
  nhanKhachCanHoTro: true, nhanBotSuCo: true,
});

async function load() {
  loading.value = true;
  try {
    const [ds, gy] = await Promise.all([
      api.get('/agent-notify-targets'),
      api.get('/agent-notify-targets/goi-y').catch(() => ({ data: { goiY: [] } })),
    ]);
    targets.value = ds.data?.targets ?? [];
    dangDungEnv.value = Boolean(ds.data?.dangDungEnv);
    threadEnv.value = ds.data?.threadEnv ?? null;
    goiY.value = gy.data?.goiY ?? [];
  } catch {
    toast.error('Không tải được danh sách nơi nhận thông báo');
  } finally {
    loading.value = false;
  }
}

/** Thông điệp lỗi chung — gom về một chỗ để mọi nút nói cùng một giọng. */
function loi(e: unknown, macDinh: string): string {
  const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  if (code === 'DICH_DA_KHAI') return 'Nơi nhận này đã khai rồi';
  if (code === 'THIEU_THREAD_ID') return 'Chưa nhập ID nhóm/UID nick';
  if (code === 'PHAI_CHON_IT_NHAT_MOT_LOAI_VIEC') return 'Phải chọn ít nhất một loại việc muốn nhận';
  if (code === 'CHI_ADMIN') return 'Chỉ quản trị mới sửa được';
  return macDinh;
}

async function them() {
  if (!moi.threadId.trim()) { toast.error('Chưa nhập ID nhóm/UID nick'); return; }
  try {
    await api.post('/agent-notify-targets', { ...moi, threadId: moi.threadId.trim() });
    toast.success('Đã thêm nơi nhận — bấm "Gửi thử" để kiểm chứng');
    moi.tenGoi = ''; moi.threadId = '';
    await load();
  } catch (e: unknown) { toast.error(loi(e, 'Thêm thất bại')); }
}

async function themNhanh(g: GoiY) {
  try {
    await api.post('/agent-notify-targets', {
      threadId: g.threadId, tenGoi: g.ten, loaiDich: g.loaiDich,
      nhanKhachCanHoTro: true, nhanBotSuCo: true,
    });
    toast.success(`Đã thêm ${g.ten} — bấm "Gửi thử" để kiểm chứng`);
    await load();
  } catch (e: unknown) { toast.error(loi(e, 'Thêm thất bại')); }
}

async function toggle(t: Target) {
  try {
    await api.patch(`/agent-notify-targets/${t.id}`, { enabled: !t.enabled });
    t.enabled = !t.enabled;
  } catch (e: unknown) { toast.error(loi(e, 'Không đổi được trạng thái')); }
}

async function doiLoaiViec(t: Target, truong: 'nhanKhachCanHoTro' | 'nhanBotSuCo', bat: boolean) {
  try {
    await api.patch(`/agent-notify-targets/${t.id}`, { [truong]: bat });
    t[truong] = bat;
  } catch (e: unknown) {
    toast.error(loi(e, 'Không đổi được loại việc'));
    await load(); // trả ô tick về đúng trạng thái thật dưới DB
  }
}

/** Gửi thử — kiểm chứng đích nhận được tin thật, thay vì đoán. */
async function guiThu(t: Target) {
  dangThu.value = t.id;
  try {
    await api.post(`/agent-notify-targets/${t.id}/gui-thu`);
    toast.success(`Đã gửi tin thử tới "${t.tenGoi}" — mở Zalo kiểm tra nhé`);
  } catch (e: unknown) {
    const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
    if (code === 'KHONG_CO_NICK_ZALO_KET_NOI') toast.error('Chưa có nick Zalo nào đang kết nối để gửi thử');
    else toast.error('Gửi thử THẤT BẠI — kiểm tra lại ID nhóm/UID nick');
  } finally {
    dangThu.value = null;
  }
}

async function remove(t: Target) {
  if (!confirm(`Gỡ "${t.tenGoi}" khỏi danh sách nhận thông báo?`)) return;
  try {
    await api.delete(`/agent-notify-targets/${t.id}`);
    await load();
  } catch (e: unknown) { toast.error(loi(e, 'Gỡ thất bại')); }
}

onMounted(load);
</script>

<style scoped>
.ao-page { max-width: 920px; }
.ao-head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 18px; }
.ao-head .ico { width: 44px; height: 44px; border-radius: 12px; background: #eff6ff; display: grid; place-items: center; font-size: 22px; flex: none; }
.ao-head h1 { font-size: 19px; font-weight: 700; margin: 0 0 4px; }
.ao-head p { color: #555; font-size: 14px; line-height: 1.5; margin: 0; }
.ao-loading { color: #888; padding: 20px 0; }
.ao-note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; padding: 10px 14px; font-size: 14px; margin-bottom: 16px; line-height: 1.5; }
.ao-note code { background: #fef3c7; padding: 1px 5px; border-radius: 4px; }
.ao-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
.ao-card h2 { font-size: 15px; font-weight: 700; margin: 0 0 12px; }
.ao-empty { color: #999; font-size: 14px; margin: 0; }
.ao-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.ao-table th { text-align: left; color: #888; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #eee; }
.ao-table td { padding: 8px; border-bottom: 1px solid #f3f4f6; }
.ao-act { white-space: nowrap; }
.ao-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.ao-input { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; min-width: 200px; }
.ao-select { padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; max-width: 180px; }
.ao-chk { font-size: 14px; color: #444; display: inline-flex; gap: 5px; align-items: center; }
.ao-gan { background: #0b6b3a; color: #fff; border: 0; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-weight: 600; }
.ao-thu { background: #1d4ed8; color: #fff; border: 0; border-radius: 6px; padding: 4px 12px; cursor: pointer; margin-right: 10px; }
.ao-thu:disabled { background: #93c5fd; cursor: default; }
.ao-toggle { border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 12px; cursor: pointer; background: #f3f4f6; }
.ao-toggle.on { background: #dcfce7; border-color: #86efac; color: #166534; }
.ao-del { color: #b91c1c; background: none; border: 0; cursor: pointer; }
</style>

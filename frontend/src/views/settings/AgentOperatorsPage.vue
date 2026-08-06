<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  AgentOperatorsPage — "Nhân viên được sai bot" (spec 06/08/2026).
  Thay env AI_AGENT_UID_NHANVIEN: admin gán nick Zalo cá nhân của nhân viên
  vào đây thì họ sai bot (tra cứu, lên đơn, báo cáo) được. Bug gốc: env cứng,
  nhân viên mới bị xử như khách. Gán kiểu "nhân viên nhắn thử → bấm Gán".
-->
<template>
  <div class="ao-page">
    <header class="ao-head">
      <div class="ico">🤖</div>
      <div>
        <h1>Nhân viên được sai bot</h1>
        <p>
          Nick Zalo cá nhân trong danh sách này được <b>sai bot</b>: tra cứu, lên đơn, xem báo
          cáo. Nick lạ không có ở đây bot coi là <b>khách</b>. Cách thêm: bảo nhân viên nhắn
          một tin vào nick shop, họ sẽ hiện ở "Chờ gán" bên dưới — bấm Gán. <b>Chỉ quản trị.</b>
        </p>
      </div>
    </header>

    <div v-if="loading" class="ao-loading">Đang tải…</div>

    <template v-else>
      <!-- Đã gán -->
      <section class="ao-card">
        <h2>Đang được sai bot ({{ operators.length }})</h2>
        <p v-if="operators.length === 0" class="ao-empty">Chưa có nhân viên nào. Xem "Chờ gán" bên dưới.</p>
        <table v-else class="ao-table">
          <thead>
            <tr><th>Tên</th><th>User CRM</th><th>Trạng thái</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="op in operators" :key="op.id">
              <td>{{ op.tenGoi }}</td>
              <td>{{ op.user?.fullName ?? '—' }}</td>
              <td>
                <button class="ao-toggle" :class="{ on: op.enabled }" @click="toggle(op)">
                  {{ op.enabled ? 'Bật' : 'Tắt' }}
                </button>
              </td>
              <td><button class="ao-del" @click="remove(op)">Gỡ</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Chờ gán -->
      <section class="ao-card">
        <h2>Chờ gán — nick vừa nhắn ({{ choGan.length }})</h2>
        <p v-if="choGan.length === 0" class="ao-empty">
          Chưa có nick lạ nào nhắn trong 7 ngày. Bảo nhân viên nhắn thử vào nick shop rồi tải lại.
        </p>
        <table v-else class="ao-table">
          <thead>
            <tr><th>Tên Zalo</th><th>Tin gần nhất</th><th>Gán cho User</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="c in choGan" :key="c.zaloUid">
              <td>{{ c.ten }}</td>
              <td class="ao-msg">{{ c.tinCuoi }}</td>
              <td>
                <select v-model="chonUser[c.zaloUid]" class="ao-select">
                  <option value="">(không gắn User)</option>
                  <option v-for="u in users" :key="u.id" :value="u.id">{{ u.fullName }}</option>
                </select>
              </td>
              <td><button class="ao-gan" @click="gan(c)">Gán</button></td>
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

interface Operator {
  id: string; zaloUid: string; tenGoi: string; enabled: boolean;
  user?: { id: string; fullName: string } | null;
}
interface ChoGan { zaloUid: string; ten: string; tinCuoi: string }
interface UserLite { id: string; fullName: string }

const toast = useToast();
const loading = ref(true);
const operators = ref<Operator[]>([]);
const choGan = ref<ChoGan[]>([]);
const users = ref<UserLite[]>([]);
const chonUser = reactive<Record<string, string>>({});

async function load() {
  loading.value = true;
  try {
    const [ops, cho, us] = await Promise.all([
      api.get('/agent-operators'),
      api.get('/agent-operators/cho-gan'),
      api.get('/users').catch(() => ({ data: { users: [] } })),
    ]);
    operators.value = ops.data?.operators ?? [];
    choGan.value = cho.data?.choGan ?? [];
    users.value = (us.data?.users ?? us.data ?? []).map((u: { id: string; fullName?: string; name?: string }) => ({
      id: u.id, fullName: u.fullName ?? u.name ?? u.id,
    }));
  } catch {
    toast.error('Không tải được danh sách nhân viên');
  } finally {
    loading.value = false;
  }
}

async function gan(c: ChoGan) {
  try {
    await api.post('/agent-operators', {
      zaloUid: c.zaloUid,
      userId: chonUser[c.zaloUid] || undefined,
      tenGoi: c.ten,
    });
    toast.success(`Đã gán ${c.ten} làm nhân viên`);
    await load();
  } catch (e: unknown) {
    const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
    toast.error(code === 'NICK_DA_DUOC_GAN' ? 'Nick này đã được gán' : 'Gán thất bại');
  }
}

async function toggle(op: Operator) {
  try {
    await api.patch(`/agent-operators/${op.id}`, { enabled: !op.enabled });
    op.enabled = !op.enabled;
  } catch { toast.error('Không đổi được trạng thái'); }
}

async function remove(op: Operator) {
  if (!confirm(`Gỡ ${op.tenGoi} khỏi danh sách nhân viên sai bot?`)) return;
  try {
    await api.delete(`/agent-operators/${op.id}`);
    await load();
  } catch { toast.error('Gỡ thất bại'); }
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
.ao-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
.ao-card h2 { font-size: 15px; font-weight: 700; margin: 0 0 12px; }
.ao-empty { color: #999; font-size: 14px; margin: 0; }
.ao-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.ao-table th { text-align: left; color: #888; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #eee; }
.ao-table td { padding: 8px; border-bottom: 1px solid #f3f4f6; }
.ao-msg { color: #666; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ao-select { padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 6px; max-width: 180px; }
.ao-gan { background: #0b6b3a; color: #fff; border: 0; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-weight: 600; }
.ao-toggle { border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 12px; cursor: pointer; background: #f3f4f6; }
.ao-toggle.on { background: #dcfce7; border-color: #86efac; color: #166534; }
.ao-del { color: #b91c1c; background: none; border: 0; cursor: pointer; }
</style>

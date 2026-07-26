<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Chiến dịch gửi hàng loạt (Community) — Màn 1 (tạo) + Màn 2 (theo dõi) trong 1 view.
     Thiết kế từ Pencil (zalo.pen). Gửi theo đợt, có xác nhận, throttle theo daily cap. -->
<template>
  <div class="bulk-page">
    <!-- ════ HEADER ════ -->
    <div class="bulk-header">
      <div>
        <h1>{{ phase === 'track' ? 'Theo dõi chiến dịch' : 'Tạo chiến dịch gửi hàng loạt' }}</h1>
        <p>Gửi lời mời kết bạn đến nhiều khách hàng một cách an toàn.</p>
      </div>
      <button class="lnk-back" @click="goBackToList">← Về tệp khách hàng</button>
    </div>

    <div v-if="loading" class="bc-loading">Đang tải…</div>

    <!-- ════ MÀN 1 — TẠO ════ -->
    <div v-else-if="phase === 'setup'" class="body">
      <div class="form-col">
        <!-- Tệp -->
        <div class="section">
          <div class="sec-title">Tệp khách hàng</div>
          <div class="card-sel">
            <div class="card-row">
              <div class="icon-wrap"><span>📁</span></div>
              <div class="meta"><div class="name">{{ stats?.listName || '—' }}</div><div class="sub">{{ stats?.totalInList ?? 0 }} số điện thoại</div></div>
              <span class="check">✓</span>
            </div>
            <div class="pills">
              <span class="pill green"><b>{{ stats?.accepted ?? 0 }}</b><span>đã kết bạn</span></span>
              <span class="pill blue"><b>{{ stats?.eligible ?? 0 }}</b><span>chưa gửi</span></span>
              <span class="pill grey"><b>{{ stats?.noZalo ?? 0 }}</b><span>không có Zalo</span></span>
            </div>
          </div>
        </div>

        <!-- Nick -->
        <div class="section">
          <div class="sec-title">Nick Zalo gửi đi</div>
          <div v-if="connectedNick" class="card-sel row">
            <div class="avatar">{{ initials(connectedNick.displayName) }}</div>
            <div class="meta"><div class="name">{{ connectedNick.displayName }}</div>
              <div class="status"><span class="dot"></span>Đang kết nối</div></div>
            <span class="check">✓</span>
          </div>
          <div v-else class="warn-box">
            ⚠️ Chưa có nick Zalo nào kết nối. <a href="#" @click.prevent="goZaloSettings">Quét QR để bắt đầu →</a>
          </div>
        </div>

        <!-- Loại chiến dịch -->
        <div class="section">
          <div class="sec-title">Loại chiến dịch</div>
          <div class="seg">
            <div class="opt" :class="{ on: mode === 'friend' }" @click="switchMode('friend')">🤝 Kết bạn hàng loạt</div>
            <div class="opt" :class="{ on: mode === 'message' }" @click="switchMode('message')">💬 Nhắn tin hàng loạt</div>
          </div>
          <div class="note-row">ℹ️ {{ isMsg ? 'Tin gửi tới cả khách chưa kết bạn — vào "tin nhắn chờ" của họ (trừ ai bật chặn tin người lạ).' : 'Gửi lời mời kết bạn cho khách chưa là bạn.' }}</div>
        </div>

        <!-- Nội dung -->
        <div class="section">
          <div class="ta-head"><div class="sec-title">{{ isMsg ? 'Nội dung tin nhắn' : 'Nội dung lời mời' }}</div>
            <span class="chip-var" @click="insertVar">+ Chèn {tên khách}</span></div>
          <textarea v-model="message" class="textarea" rows="3"
            placeholder="Xin chào {tên khách}! Bên mình..."></textarea>
          <div class="suggest-label">Mẫu gợi ý</div>
          <div class="templates">
            <div v-for="(t,i) in templates" :key="i" class="tmpl" @click="message = t">{{ t }}</div>
          </div>
          <!-- Đính kèm ảnh catalog báo giá (chỉ khi nhắn tin) -->
          <label v-if="isMsg" class="attach-catalog">
            <input type="checkbox" v-model="attachPriceList" @change="onToggleCatalog" />
            <span>📋 Đính kèm bảng báo giá (ảnh sản phẩm + giá tự động)</span>
          </label>
          <!-- Xem trước catalog (ghép sẵn khi bật → gửi lúc chạy chỉ việc gửi, không chờ) -->
          <div v-if="attachPriceList" class="catalog-preview">
            <div v-if="catalogLoading" class="cat-loading">⏳ Đang chuẩn bị bảng báo giá…</div>
            <template v-else-if="catalogImages.length">
              <div class="cat-hint">✅ Đã chuẩn bị {{ catalogImages.length }} ảnh — sẽ gửi kèm mỗi tin:</div>
              <div class="cat-thumbs">
                <img v-for="(u,i) in catalogImages" :key="i" :src="apiBase + u" class="cat-thumb" @click="previewImg = apiBase + u" />
              </div>
            </template>
            <div v-else class="cat-err">⚠️ Chưa ghép được bảng giá (thiếu sản phẩm có giá + ảnh).</div>
          </div>
        </div>

        <!-- Tốc độ -->
        <div class="section">
          <div class="sec-title">Tốc độ gửi (an toàn)</div>
          <div class="speed-opts">
            <div class="speed" :class="{ on: speed === 'slow' }" @click="speed = 'slow'">
              <div class="top"><span class="radio">{{ speed === 'slow' ? '◉' : '○' }}</span> Chậm & an toàn</div>
              <span class="badge-rec">KHUYÊN DÙNG</span>
              <div class="sub">{{ isMsg ? '50' : '20' }} {{ trackVerb }}/ngày</div>
            </div>
            <div class="speed" :class="{ on: speed === 'fast' }" @click="speed = 'fast'">
              <div class="top"><span class="radio">{{ speed === 'fast' ? '◉' : '○' }}</span> Nhanh hơn</div>
              <div class="sub">{{ dailyCap }}/ngày (tối đa)</div>
            </div>
          </div>
          <div class="warn">⚠️ Gửi quá nhanh có thể khiến nick Zalo bị khóa.</div>
        </div>
      </div>

      <!-- Tóm tắt -->
      <div class="summary-col">
        <div class="summary">
          <h2>Tóm tắt chiến dịch</h2>
          <!-- Trạng thái rỗng: không còn ai để gửi -->
          <div v-if="remainingTargets === 0" class="empty-note">
            <template v-if="isMsg">Không còn khách nào để nhắn (đã nhắn hết hoặc số không có Zalo).</template>
            <template v-else>Đã gửi lời mời cho tất cả khách trong tệp.</template>
            <!-- Gửi LẠI cả khách đã nhắn (demo / muốn nhắn lại) — không cần reset -->
            <button v-if="isMsg" class="resend-btn" @click="startCampaign(true)">🔁 Gửi lại (kể cả khách đã nhắn)</button>
          </div>
          <template v-else>
            <div class="lines">
              <div class="line"><span class="liw">👥</span> Gửi cho {{ remainingTargets }} khách {{ isMsg ? 'có Zalo' : 'chưa kết bạn' }}</div>
              <div class="line"><span class="liw">📨</span> ~{{ perDay }} {{ trackVerb }}/ngày</div>
              <div class="line"><span class="liw">🗓️</span> Dự kiến xong trong ~{{ estDays }} ngày</div>
            </div>
            <div class="divider"></div>
            <div class="reminder">🛡️ Hệ thống tự giới hạn {{ perDay }} {{ trackVerb }} mỗi ngày để giữ nick Zalo an toàn.</div>
            <button class="start-btn" :disabled="!canStart" @click="startCampaign">🚀 Bắt đầu chiến dịch</button>
          </template>
        </div>
      </div>
    </div>

    <!-- ════ MÀN 2 — THEO DÕI ════ -->
    <div v-else-if="phase === 'track'" class="body">
      <div class="track-col">
        <div class="track-top">
          <div class="ring" :style="{ '--p': progressPct }"><span>{{ progressPct }}%</span></div>
          <div class="track-meta">
            <div class="track-sub">Tiến độ chiến dịch {{ isMsg ? 'nhắn tin' : 'kết bạn' }} — Tệp {{ stats?.listName }}</div>
            <div class="track-big">Đã gửi {{ trackDone }} {{ trackVerb }}</div>
          </div>
          <div class="track-actions">
            <span class="state-pill" :class="stateClass">{{ stateLabel }}</span>
          </div>
        </div>

        <!-- thống kê — kết bạn -->
        <div v-if="!isMsg" class="stat-cards">
          <div class="stat-card"><div class="sc-num blue">{{ stats?.attempted ?? 0 }}</div><div class="sc-lbl">Đã gửi</div></div>
          <div class="stat-card"><div class="sc-num green">{{ stats?.accepted ?? 0 }}</div><div class="sc-lbl">Đã đồng ý kết bạn</div></div>
          <div class="stat-card"><div class="sc-num amber">{{ stats?.pending ?? 0 }}</div><div class="sc-lbl">Chờ đồng ý</div></div>
          <div class="stat-card"><div class="sc-num grey">{{ (stats?.noZalo ?? 0) + (stats?.errored ?? 0) }}</div><div class="sc-lbl">Không có Zalo / lỗi</div></div>
        </div>
        <!-- thống kê — nhắn tin -->
        <div v-else class="stat-cards">
          <div class="stat-card"><div class="sc-num green">{{ msgStats?.messaged ?? 0 }}</div><div class="sc-lbl">Đã nhắn</div></div>
          <div class="stat-card"><div class="sc-num blue">{{ msgStats?.toMessage ?? 0 }}</div><div class="sc-lbl">Chưa nhắn</div></div>
          <div class="stat-card"><div class="sc-num grey">{{ msgStats?.blocked ?? 0 }}</div><div class="sc-lbl">Chặn tin lạ</div></div>
          <div class="stat-card"><div class="sc-num amber">{{ remainingToday }}</div><div class="sc-lbl">Còn gửi được hôm nay</div></div>
        </div>

        <!-- công tắc tự động gửi mỗi ngày -->
        <div class="auto-bar" :class="{ on: autoOn }">
          <div class="auto-info">
            <div class="auto-title">⚡ Tự động gửi mỗi ngày</div>
            <div class="auto-sub">
              <template v-if="autoOn">Đang BẬT — hệ thống tự gửi ~{{ perDay }} {{ trackVerb }}/ngày.
                <span v-if="autoLastRunAt"> Lần gần nhất: {{ fmtDate(autoLastRunAt) }}.</span></template>
              <template v-else>Bật để hệ thống tự gửi mỗi ngày, không cần bạn bấm tay.</template>
            </div>
          </div>
          <button class="switch" :class="{ on: autoOn }" :disabled="savingAuto || !canSendBatch && !autoOn" @click="toggleAuto">
            <span class="knob"></span>
          </button>
        </div>

        <!-- nút gửi đợt (thủ công) -->
        <div class="batch-bar">
          <div class="bb-info">
            <template v-if="remainingToday > 0 && remainingTargets > 0">
              Hôm nay còn gửi được <b>{{ Math.min(remainingToday, perDay, remainingTargets) }}</b> {{ trackVerb }}.
            </template>
            <template v-else-if="remainingTargets === 0">✓ Đã gửi hết {{ isMsg ? 'bạn bè' : 'khách' }} trong tệp.</template>
            <template v-else>Hôm nay đã đạt giới hạn {{ dailyCap }} {{ trackVerb }}. Gửi tiếp vào ngày mai.</template>
          </div>
          <!-- Đã nhắn hết + là nhắn tin → nút GỬI LẠI (bỏ chặn last_outbound). Bấm là gửi liền. -->
          <button v-if="isMsg && remainingTargets === 0" class="batch-btn" :disabled="sending" @click="resendBatch">
            {{ sending ? 'Đang gửi…' : '🔁 Gửi lại (kể cả khách đã nhắn)' }}
          </button>
          <button v-else class="batch-btn" :disabled="!canSendBatch || sending" @click="confirmRunBatch">
            {{ sending ? 'Đang gửi…' : `Gửi đợt này (${Math.min(remainingToday, perDay, remainingTargets)} khách)` }}
          </button>
        </div>

        <!-- kết quả đợt vừa gửi -->
        <div v-if="lastBatch.length" class="batch-results">
          <div class="br-title">Kết quả đợt vừa gửi ({{ lastBatch.length }})</div>
          <table class="res-table">
            <thead><tr><th>Khách hàng</th><th>Kết quả</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in lastBatch" :key="i">
                <td>{{ r.name || '(không tên)' }}</td>
                <td><span class="rb" :class="resClass(r.state)">{{ resLabel(r.state) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Xem ảnh catalog phóng to -->
    <div v-if="previewImg" class="cat-modal" @click="previewImg = null">
      <img :src="previewImg" class="cat-modal-img" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { accounts, fetchAccounts } = useZaloAccounts();

const listId = computed(() => String(route.query.listId || ''));
const loading = ref(true);
const phase = ref<'setup' | 'track'>('setup');
const mode = ref<'friend' | 'message'>('friend'); // 🤝 kết bạn / 💬 nhắn tin
const message = ref('Chào {tên khách}, LEDNELIA chuyên sỉ & lẻ đèn LED, nguồn, module, phụ kiện quảng cáo — hàng có sẵn, giá tốt. Em gửi anh/chị bảng báo giá tham khảo một số sản phẩm bán chạy ạ. Cần mẫu nào anh/chị nhắn em tư vấn thêm nhé! 📋');
const attachPriceList = ref(false); // đính kèm ảnh catalog báo giá
const catalogLoading = ref(false);
const catalogImages = ref<string[]>([]); // URL ảnh catalog đã ghép sẵn
const previewImg = ref<string | null>(null); // ảnh phóng to
const apiBase = ''; // URL ảnh đã gồm /api/v1 (vite proxy /api → backend)
// Bật checkbox → ghép catalog SẴN + xem trước ngay (gửi lúc chạy chỉ việc gửi, không chờ).
async function onToggleCatalog() {
  if (!attachPriceList.value) { catalogImages.value = []; return; }
  catalogLoading.value = true;
  catalogImages.value = [];
  try {
    const { data } = await api.post<{ count: number; images: string[] }>('/campaigns/catalog/prepare', {});
    catalogImages.value = data?.images || [];
  } catch { catalogImages.value = []; }
  finally { catalogLoading.value = false; }
}
const speed = ref<'slow' | 'fast'>('slow');
const sending = ref(false);
const lastBatch = ref<Array<{ name: string | null; state: string }>>([]);
const autoOn = ref(false);          // công tắc "tự động gửi mỗi ngày"
const autoLastRunAt = ref<string | null>(null);
const savingAuto = ref(false);

const friendTemplates = [
  'Xin chào! Bên mình muốn kết nối để gửi ưu đãi & tư vấn dịch vụ nhé.',
  'Chào bạn, mình muốn kết nối để chia sẻ chương trình khuyến mãi tháng này.',
];
const messageTemplates = [
  'Chào {tên khách}, LEDNELIA chuyên sỉ & lẻ đèn LED, nguồn, module, phụ kiện quảng cáo — hàng có sẵn, giá tốt. Em gửi anh/chị bảng báo giá tham khảo một số sản phẩm bán chạy ạ. Cần mẫu nào anh/chị nhắn em tư vấn thêm nhé! 📋',
  'Xin chào {tên khách}! Em bên LEDNELIA ạ. Bên em có đầy đủ LED dây, module P10/P8, nguồn 12V/5V, phụ kiện đi kèm — báo giá + gửi hình thực tế ngay. Em gửi anh/chị bảng giá tham khảo, có gì cần anh/chị cứ nhắn em nha!',
  'Chào {tên khách}, bên mình đang có ưu đãi đặc biệt tháng này, bạn quan tâm mình tư vấn thêm nhé!',
];
const templates = computed(() => mode.value === 'message' ? messageTemplates : friendTemplates);

interface Stats {
  listId: string; listName: string; totalInList: number; eligible: number; attempted: number;
  accepted: number; noZalo: number; pending: number; errored: number; dailyCap: number; sentToday: number;
}
interface MsgStats {
  listId: string; listName: string; friends: number; messaged: number; toMessage: number; blocked: number; dailyCap: number; sentToday: number;
}
const stats = ref<Stats | null>(null);
const msgStats = ref<MsgStats | null>(null);

const connectedNick = computed(() => (accounts.value || []).find((a: any) => (a.liveStatus || a.status) === 'connected') || (accounts.value || [])[0] || null);
const isMsg = computed(() => mode.value === 'message');
// số đối tượng còn lại để gửi (kết bạn: chưa gửi; nhắn tin: bạn chưa nhắn)
const remainingTargets = computed(() => isMsg.value ? (msgStats.value?.toMessage ?? 0) : (stats.value?.eligible ?? 0));
const dailyCap = computed(() => isMsg.value ? (msgStats.value?.dailyCap ?? 300) : (stats.value?.dailyCap ?? 30));
const sentToday = computed(() => isMsg.value ? (msgStats.value?.sentToday ?? 0) : (stats.value?.sentToday ?? 0));
const perDay = computed(() => isMsg.value ? Math.min(dailyCap.value, speed.value === 'slow' ? 50 : dailyCap.value) : (speed.value === 'slow' ? 20 : dailyCap.value));
const estDays = computed(() => Math.max(1, Math.ceil(remainingTargets.value / perDay.value)));
const remainingToday = computed(() => Math.max(0, dailyCap.value - sentToday.value));
const canStart = computed(() => !!connectedNick.value && remainingTargets.value > 0);
const canSendBatch = computed(() => remainingToday.value > 0 && remainingTargets.value > 0 && !!connectedNick.value);
const progressPct = computed(() => {
  if (isMsg.value) { const t = msgStats.value?.friends ?? 0; return t ? Math.round(((msgStats.value?.messaged ?? 0) / t) * 100) : 0; }
  const t = stats.value?.totalInList ?? 0; return t ? Math.round(((stats.value?.attempted ?? 0) / t) * 100) : 0;
});
const trackDone = computed(() => isMsg.value ? `${msgStats.value?.messaged ?? 0}/${msgStats.value?.friends ?? 0}` : `${stats.value?.attempted ?? 0}/${stats.value?.totalInList ?? 0}`);
const trackVerb = computed(() => isMsg.value ? 'tin nhắn' : 'lời mời');
const stateLabel = computed(() => {
  if (remainingTargets.value === 0) return 'Hoàn thành';
  if (remainingToday.value <= 0) return 'Đã dừng (đạt giới hạn ngày)';
  return 'Đang chạy';
});
const stateClass = computed(() => {
  if (remainingTargets.value === 0) return 'done';
  if (remainingToday.value <= 0) return 'hold';
  return 'running';
});

function initials(n: string | null) { return (n || '?').split(' ').map(w => w[0]).slice(-2).join('').toUpperCase(); }
function insertVar() { message.value += ' {tên khách}'; }

async function loadStats() {
  if (!listId.value || !connectedNick.value) { loading.value = false; return; }
  try {
    const nick = connectedNick.value.id;
    const [fr, ms] = await Promise.all([
      api.get<Stats>(`/campaigns/bulk/${listId.value}/stats`, { params: { zaloAccountId: nick } }),
      api.get<MsgStats>(`/campaigns/bulk/${listId.value}/message-stats`, { params: { zaloAccountId: nick } }),
    ]);
    stats.value = fr.data;
    msgStats.value = ms.data;
    // Trạng thái công tắc tự động (theo mode hiện tại).
    try {
      const sch = await api.get<{ schedule: { enabled: boolean; lastRunAt: string | null } | null }>(
        `/campaigns/bulk/${listId.value}/schedule`, { params: { zaloAccountId: nick, mode: mode.value } });
      autoOn.value = !!sch.data?.schedule?.enabled;
      autoLastRunAt.value = sch.data?.schedule?.lastRunAt || null;
    } catch { autoOn.value = false; }
    // Nếu đã có hoạt động hoặc tự động đang bật → vào thẳng màn theo dõi.
    if (autoOn.value || (isMsg.value && ms.data.messaged > 0) || (!isMsg.value && fr.data.attempted > 0)) phase.value = 'track';
  } catch (e: any) {
    toast.error('Tải dữ liệu chiến dịch lỗi: ' + (e?.response?.data?.error || e?.message));
  } finally { loading.value = false; }
}

async function toggleAuto() {
  if (savingAuto.value || !connectedNick.value) return;
  const next = !autoOn.value;
  if (next && !confirm(`Bật tự động gửi mỗi ngày?\n\nHệ thống sẽ TỰ ĐỘNG gửi ~${perDay.value} ${trackVerb.value}/ngày cho đến khi hết, mà không cần bạn bấm. Tắt bất kỳ lúc nào.`)) return;
  savingAuto.value = true;
  try {
    await api.post(`/campaigns/bulk/${listId.value}/schedule`, {
      zaloAccountId: connectedNick.value.id, mode: mode.value, enabled: next,
      message: message.value, perDay: perDay.value,
    });
    autoOn.value = next;
    toast.success(next ? 'Đã bật tự động gửi mỗi ngày.' : 'Đã tắt tự động gửi.');
  } catch (e: any) {
    toast.error('Lưu cài đặt lỗi: ' + (e?.response?.data?.error || e?.message));
  } finally { savingAuto.value = false; }
}

function switchMode(m: 'friend' | 'message') {
  mode.value = m;
  // đổi nội dung mẫu mặc định theo mode
  message.value = m === 'message'
    ? 'Chào {tên khách}, bên mình đang có ưu đãi đặc biệt tháng này, bạn quan tâm mình tư vấn thêm nhé!'
    : 'Xin chào {tên khách}! Bên mình muốn kết nối để gửi ưu đãi & tư vấn dịch vụ nhé.';
  phase.value = 'setup';
}

const resendMode = ref(false); // gửi lại cả khách đã nhắn (bỏ chặn last_outbound)
function startCampaign(includeSent = false) {
  resendMode.value = includeSent === true;
  // chế độ gửi lại: bỏ qua gating remainingTargets (vì khách "đã nhắn" mới cần gửi lại)
  if (!resendMode.value && !canStart.value) return;
  phase.value = 'track';
  if (resendMode.value) runBatch(); // gửi lại ngay
}

function confirmRunBatch() {
  const n = Math.min(remainingToday.value, perDay.value, remainingTargets.value);
  if (n <= 0) return;
  const what = isMsg.value ? 'tin nhắn' : 'lời mời kết bạn';
  if (!confirm(`Gửi ${what} THẬT cho ${n} khách bằng nick "${connectedNick.value?.displayName}"?\n\nMỗi khách sẽ nhận một ${what} trên Zalo.`)) return;
  resendMode.value = false;
  runBatch();
}
// Gửi LẠI cả khách đã nhắn (bỏ chặn last_outbound) — không cần reset DB.
function resendBatch() {
  if (!confirm(`Gửi lại tin cho khách ĐÃ NHẮN trong tệp bằng nick "${connectedNick.value?.displayName}"?`)) return;
  resendMode.value = true;
  runBatch();
}

async function runBatch() {
  if (sending.value || !connectedNick.value) return;
  sending.value = true;
  lastBatch.value = [];
  const endpoint = isMsg.value ? 'run-message-batch' : 'run-batch';
  const verb = isMsg.value ? 'tin nhắn' : 'lời mời';
  try {
    const { data } = await api.post<{ requested: number; sent: number; results: Array<{ name: string | null; state: string }>; stoppedReason?: string }>(
      `/campaigns/bulk/${listId.value}/${endpoint}`,
      { zaloAccountId: connectedNick.value.id, message: message.value, batchSize: perDay.value, attachPriceList: attachPriceList.value, includeSent: resendMode.value },
    );
    lastBatch.value = data.results || [];
    if (data.stoppedReason === 'daily_cap_reached') toast.warning(`Đã đạt giới hạn ${verb} hôm nay. Gửi tiếp vào ngày mai.`);
    else if (data.stoppedReason === 'no_eligible') toast.success(isMsg.value ? 'Đã nhắn hết bạn bè trong tệp!' : 'Đã gửi hết khách trong tệp!');
    else toast.success(`Đã gửi ${data.sent}/${data.requested} ${verb}.`);
    await loadStats();
  } catch (e: any) {
    toast.error('Gửi đợt lỗi: ' + (e?.response?.data?.error || e?.message));
  } finally { sending.value = false; }
}

function resLabel(s: string) { return ({ sent: '✓ Đã gửi', no_zalo: 'Không có Zalo', error: 'Lỗi', accepted: '🟢 Đã là bạn', blocked: 'Chặn tin lạ' } as any)[s] || s; }
function resClass(s: string) { return ({ sent: 'ok', no_zalo: 'grey', error: 'err', accepted: 'ok', blocked: 'grey' } as any)[s] || 'grey'; }

function fmtDate(s: string) { try { return new Date(s).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; } }
function goBackToList() { router.push(listId.value ? `/marketing/lists/${listId.value}` : '/marketing/lists'); }
function goZaloSettings() { router.push('/settings/channels/zalo'); }

onMounted(async () => {
  await fetchAccounts();
  await loadStats();
});
</script>

<style scoped>
/* Để trang flow tự nhiên + chiều cao tối thiểu full màn → khung .v-main__wrap (cha) cuộn
   như một trang document bình thường. KHÔNG đặt height:100%/overflow ở đây vì cha dùng
   min-height (con 100% sẽ co lại = chiều cao nội dung → không có gì để cuộn). */
.bulk-page { background: #F4F5F7; min-height: 100%; padding-bottom: 48px; }
.bulk-header { background: #fff; border-bottom: 1px solid #E5E7EB; padding: 20px 32px; display: flex; justify-content: space-between; align-items: center; }
.bulk-header h1 { font-size: 22px; font-weight: 700; color: #0F172A; }
.bulk-header p { font-size: 14px; color: #5B6573; margin-top: 4px; }
.lnk-back { background: none; border: none; color: #2563EB; font-size: 14px; cursor: pointer; font-weight: 500; }
.bc-loading { padding: 60px; text-align: center; color: #5B6573; }
.body { display: flex; gap: 24px; padding: 28px 32px; align-items: flex-start; }
.form-col { flex: 1; display: flex; flex-direction: column; gap: 18px; max-width: 720px; }
.summary-col { width: 360px; flex-shrink: 0; }
.track-col { flex: 1; display: flex; flex-direction: column; gap: 18px; }
.section { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.sec-title { font-size: 16px; font-weight: 700; color: #0F172A; }
.card-sel { background: #EFF4FF; border: 2px solid #2563EB; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.card-sel.row { flex-direction: row; align-items: center; gap: 12px; }
.card-row { display: flex; align-items: center; gap: 12px; }
.icon-wrap { width: 40px; height: 40px; border-radius: 8px; background: #fff; border: 1px solid #E5E7EB; display: grid; place-items: center; font-size: 18px; flex-shrink: 0; }
.meta { flex: 1; }
.meta .name { font-size: 15px; font-weight: 600; color: #0F172A; }
.meta .sub { font-size: 13px; color: #5B6573; margin-top: 2px; }
.check { color: #2563EB; font-weight: 700; font-size: 18px; }
.pills { display: flex; gap: 8px; flex-wrap: wrap; }
.pill { border-radius: 999px; padding: 6px 12px; font-size: 13px; display: flex; gap: 5px; align-items: center; }
.pill b { font-weight: 700; } .pill span { color: #5B6573; }
.pill.green { background: #EAF7EE; } .pill.green b { color: #16A34A; }
.pill.blue { background: #EFF4FF; } .pill.blue b { color: #2563EB; }
.pill.grey { background: #F8FAFC; } .pill.grey b { color: #9AA4B2; }
.avatar { width: 44px; height: 44px; border-radius: 999px; background: #2563EB; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 16px; flex-shrink: 0; }
.dot { width: 8px; height: 8px; border-radius: 999px; background: #16A34A; display: inline-block; }
.status { display: flex; align-items: center; gap: 6px; color: #16A34A; font-size: 13px; font-weight: 500; margin-top: 4px; }
.warn-box { background: #FEF6E7; border: 1px solid #D97706; border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #92560a; }
.warn-box a { color: #2563EB; font-weight: 600; }
.seg { background: #F8FAFC; border-radius: 12px; padding: 4px; display: flex; gap: 4px; }
.seg .opt { flex: 1; text-align: center; padding: 12px 14px; border-radius: 8px; font-size: 14px; font-weight: 500; color: #5B6573; cursor: pointer; }
.seg .opt.on { background: #fff; border: 1px solid #E5E7EB; font-weight: 600; color: #0F172A; box-shadow: 0 1px 3px #0f172a1a; }
.note-row { font-size: 13px; color: #5B6573; }
.empty-note { font-size: 14px; color: #5B6573; line-height: 1.6; background: #FEF6E7; border: 1px solid #f0d49a; border-radius: 10px; padding: 14px; }
.empty-note b { color: #92560a; }
.ta-head { display: flex; align-items: center; justify-content: space-between; }
.chip-var { background: #EFF4FF; color: #2563EB; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.textarea { background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 12px; padding: 14px; font-size: 14px; color: #0F172A; line-height: 1.5; resize: vertical; font-family: inherit; }
.suggest-label { font-size: 13px; color: #5B6573; font-weight: 500; }
.templates { display: flex; flex-direction: column; gap: 8px; }
.tmpl { background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #5B6573; cursor: pointer; }
.tmpl:hover { border-color: #2563EB; color: #0F172A; }
.speed-opts { display: flex; gap: 12px; }
.speed { flex: 1; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; background: #fff; border: 1px solid #E5E7EB; }
.speed.on { background: #EAF7EE; border: 2px solid #16A34A; }
.speed .top { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: #0F172A; }
.radio { color: #16A34A; }
.badge-rec { background: #EAF7EE; color: #16A34A; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; align-self: flex-start; }
.speed .sub { font-size: 13px; color: #5B6573; font-weight: 500; }
.warn { background: #FEF6E7; border: 1px solid #D97706; border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #92560a; }
.summary { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 18px; box-shadow: 0 4px 16px #0f172a14; position: sticky; top: 24px; }
.summary h2 { font-size: 18px; font-weight: 700; color: #0F172A; }
.lines { display: flex; flex-direction: column; gap: 14px; }
.line { display: flex; align-items: center; gap: 12px; font-size: 14px; color: #5B6573; }
.liw { width: 36px; height: 36px; border-radius: 8px; background: #F8FAFC; display: grid; place-items: center; flex-shrink: 0; font-size: 16px; }
.divider { height: 1px; background: #E5E7EB; }
.reminder { display: flex; gap: 8px; background: #F8FAFC; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #5B6573; line-height: 1.45; }
.start-btn { background: #16A34A; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 16px; font-weight: 600; cursor: pointer; }
.start-btn:hover:not(:disabled) { filter: brightness(.96); }
.start-btn:disabled { opacity: .5; cursor: not-allowed; }
/* track */
.track-top { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; padding: 22px; display: flex; align-items: center; gap: 20px; }
.ring { width: 84px; height: 84px; border-radius: 999px; flex-shrink: 0; display: grid; place-items: center;
  background: conic-gradient(#2563EB calc(var(--p) * 1%), #E5E7EB 0); position: relative; }
.ring::before { content: ''; position: absolute; inset: 9px; border-radius: 999px; background: #fff; }
.ring span { position: relative; font-weight: 700; font-size: 18px; color: #0F172A; }
.track-meta { flex: 1; }
.track-sub { font-size: 13px; color: #5B6573; }
.track-big { font-size: 20px; font-weight: 700; color: #0F172A; margin-top: 4px; }
.state-pill { padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; }
.state-pill.running { background: #EFF4FF; color: #2563EB; }
.state-pill.done { background: #EAF7EE; color: #16A34A; }
.state-pill.hold { background: #FEF6E7; color: #92560a; }
.stat-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.stat-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 18px; }
.sc-num { font-size: 26px; font-weight: 700; }
.sc-num.blue { color: #2563EB; } .sc-num.green { color: #16A34A; } .sc-num.amber { color: #D97706; } .sc-num.grey { color: #9AA4B2; }
.sc-lbl { font-size: 13px; color: #5B6573; margin-top: 4px; }
.auto-bar { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.auto-bar.on { background: #EAF7EE; border-color: #16A34A; }
.auto-title { font-size: 15px; font-weight: 700; color: #0F172A; }
.auto-sub { font-size: 13px; color: #5B6573; margin-top: 3px; }
.switch { width: 50px; height: 28px; border-radius: 999px; border: none; background: #CBD5E1; position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s; }
.switch.on { background: #16A34A; }
.switch:disabled { opacity: .5; cursor: not-allowed; }
.switch .knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 999px; background: #fff; transition: left .15s; }
.switch.on .knob { left: 25px; }
.batch-bar { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.bb-info { font-size: 14px; color: #5B6573; }
.batch-btn { background: #16A34A; color: #fff; border: none; border-radius: 10px; padding: 12px 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.batch-btn:hover:not(:disabled) { filter: brightness(.96); }
.batch-btn:disabled { opacity: .5; cursor: not-allowed; }
.batch-results { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 18px; }
.br-title { font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 12px; }
.res-table { width: 100%; border-collapse: collapse; }
.res-table th { text-align: left; font-size: 12px; color: #9AA4B2; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #E5E7EB; }
.res-table td { font-size: 14px; color: #0F172A; padding: 8px; border-bottom: 1px solid #F4F5F7; }
.rb { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
.rb.ok { background: #EAF7EE; color: #16A34A; } .rb.grey { background: #F8FAFC; color: #9AA4B2; } .rb.err { background: #FEE2E2; color: #DC2626; }
.attach-catalog { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: #334155; cursor: pointer; }
.attach-catalog input { cursor: pointer; }
.catalog-preview { margin-top: 10px; padding: 12px; background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 10px; }
.cat-loading { font-size: 13px; color: #64748B; }
.cat-hint { font-size: 13px; color: #16A34A; font-weight: 600; margin-bottom: 8px; }
.cat-err { font-size: 13px; color: #B45309; }
.cat-thumbs { display: flex; gap: 8px; flex-wrap: wrap; }
.cat-thumb { width: 90px; height: 120px; object-fit: cover; border: 1px solid #CBD5E1; border-radius: 8px; cursor: zoom-in; }
.cat-modal { position: fixed; inset: 0; background: rgba(0,0,0,.8); display: flex; align-items: center; justify-content: center; z-index: 9999; cursor: zoom-out; }
.cat-modal-img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
.resend-btn { display: block; margin-top: 12px; padding: 8px 14px; border-radius: 8px; border: 1px solid #C7D2FE; background: #EEF2FF; color: #3730A3; font-size: 13px; font-weight: 600; cursor: pointer; }
.resend-btn:hover { background: #E0E7FF; }
</style>

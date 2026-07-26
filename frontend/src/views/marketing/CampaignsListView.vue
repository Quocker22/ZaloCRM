<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Danh sách chiến dịch (Community) — mỗi Tệp khách hàng = 1 chiến dịch. Xem lại tiến trình. -->
<template>
  <div class="camp-page">
    <div class="camp-header">
      <div>
        <h1>Chiến dịch</h1>
        <p>Theo dõi tiến trình kết bạn & nhắn tin hàng loạt của từng tệp khách.</p>
      </div>
      <button class="btn-refresh" @click="load" :disabled="loading">↻ Làm mới</button>
    </div>

    <div v-if="loading" class="camp-loading">Đang tải…</div>

    <div v-else-if="!campaigns.length" class="camp-empty">
      <div class="ce-ic">🚀</div>
      <p>Chưa có chiến dịch nào.<br>Vào <RouterLink to="/marketing/lists">Tệp khách hàng</RouterLink>, mở một tệp rồi bấm "Tạo Mục tiêu từ tệp này".</p>
    </div>

    <div v-else class="camp-grid">
      <div v-for="c in campaigns" :key="c.listId" class="camp-card">
        <div class="cc-head">
          <div class="cc-icon">{{ c.iconEmoji || '📣' }}</div>
          <div class="cc-name">
            <div class="cc-title">{{ c.listName }}</div>
            <div class="cc-sub">{{ c.totalContacts }} khách · {{ c.lastActivityAt ? 'hoạt động ' + fmt(c.lastActivityAt) : 'chưa chạy' }}</div>
          </div>
        </div>

        <!-- Hiệu quả: tỷ lệ phản hồi -->
        <div v-if="c.contacted > 0" class="cc-result">
          <div class="cr-num">{{ c.replied }}<span class="cr-of">/{{ c.contacted }}</span></div>
          <div class="cr-lbl">khách đã phản hồi
            <b :class="replyRateClass(c)">({{ replyRate(c) }}%)</b>
          </div>
        </div>

        <!-- Kết bạn -->
        <div class="cc-row">
          <div class="cc-row-top">
            <span class="cc-label">🤝 Kết bạn</span>
            <span class="cc-stat">{{ c.friendSent }}/{{ c.friendTotal }} đã gửi · {{ c.friendAccepted }} đồng ý
              <span v-if="c.autoFriend" class="auto-tag">⚡ tự động</span></span>
          </div>
          <div class="bar"><div class="bar-fill blue" :style="{ width: pct(c.friendSent, c.friendTotal) + '%' }"></div></div>
        </div>

        <!-- Nhắn tin -->
        <div class="cc-row">
          <div class="cc-row-top">
            <span class="cc-label">💬 Nhắn tin</span>
            <span class="cc-stat">{{ c.messaged }}/{{ c.messageTotal }} đã nhắn
              <span v-if="c.autoMessage" class="auto-tag">⚡ tự động</span></span>
          </div>
          <div class="bar"><div class="bar-fill green" :style="{ width: pct(c.messaged, c.messageTotal) + '%' }"></div></div>
        </div>

        <div class="cc-actions">
          <button class="cc-btn" @click="openCampaign(c.listId)">Xem tiến trình →</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';

const router = useRouter();
const toast = useToast();
const loading = ref(true);
interface Campaign {
  listId: string; listName: string; iconEmoji: string | null; totalContacts: number;
  friendSent: number; friendAccepted: number; friendTotal: number;
  messaged: number; messageTotal: number; replied: number; contacted: number;
  autoFriend: boolean; autoMessage: boolean; lastActivityAt: string | null;
}
const campaigns = ref<Campaign[]>([]);

function pct(a: number, b: number) { return b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0; }
function replyRate(c: Campaign) { return c.contacted > 0 ? Math.round((c.replied / c.contacted) * 100) : 0; }
function replyRateClass(c: Campaign) { const r = replyRate(c); return r >= 20 ? 'good' : r >= 5 ? 'ok' : 'low'; }
function fmt(s: string) { try { return new Date(s).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; } }
function openCampaign(listId: string) { router.push({ path: '/marketing/campaigns/tao-moi', query: { listId } }); }

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get<{ campaigns: Campaign[] }>('/campaigns/bulk');
    campaigns.value = data?.campaigns || [];
  } catch (e: any) {
    toast.error('Tải danh sách chiến dịch lỗi: ' + (e?.response?.data?.error || e?.message));
  } finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped>
.camp-page { padding: 28px 32px; }
.camp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
.camp-header h1 { font-size: 22px; font-weight: 700; color: #0F172A; }
.camp-header p { font-size: 14px; color: #5B6573; margin-top: 4px; }
.btn-refresh { background: #fff; border: 1px solid #E5E7EB; border-radius: 9px; padding: 8px 14px; font-size: 14px; font-weight: 500; color: #5B6573; cursor: pointer; }
.btn-refresh:hover:not(:disabled) { border-color: #2563EB; color: #2563EB; }
.camp-loading, .camp-empty { text-align: center; padding: 60px 20px; color: #5B6573; }
.camp-empty .ce-ic { font-size: 40px; margin-bottom: 12px; }
.camp-empty a { color: #2563EB; font-weight: 600; }
.camp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 18px; }
.camp-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.cc-head { display: flex; align-items: center; gap: 12px; }
.cc-icon { width: 44px; height: 44px; border-radius: 10px; background: #F8FAFC; display: grid; place-items: center; font-size: 22px; flex-shrink: 0; }
.cc-title { font-size: 16px; font-weight: 700; color: #0F172A; }
.cc-sub { font-size: 13px; color: #5B6573; margin-top: 2px; }
.cc-result { display: flex; align-items: baseline; gap: 10px; background: #F8FAFC; border-radius: 10px; padding: 12px 14px; }
.cr-num { font-size: 24px; font-weight: 700; color: #0F172A; }
.cr-of { font-size: 15px; font-weight: 600; color: #9AA4B2; }
.cr-lbl { font-size: 13px; color: #5B6573; }
.cr-lbl b.good { color: #16A34A; } .cr-lbl b.ok { color: #2563EB; } .cr-lbl b.low { color: #9AA4B2; }
.cc-row { display: flex; flex-direction: column; gap: 6px; }
.cc-row-top { display: flex; justify-content: space-between; align-items: center; }
.cc-label { font-size: 14px; font-weight: 600; color: #0F172A; }
.cc-stat { font-size: 12.5px; color: #5B6573; }
.auto-tag { background: #EAF7EE; color: #16A34A; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px; margin-left: 4px; }
.bar { height: 8px; background: #F1F5F9; border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 999px; transition: width .3s; }
.bar-fill.blue { background: #2563EB; }
.bar-fill.green { background: #16A34A; }
.cc-actions { display: flex; justify-content: flex-end; }
.cc-btn { background: #2563EB; color: #fff; border: none; border-radius: 9px; padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
.cc-btn:hover { filter: brightness(.96); }
</style>

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentsPage — Máy in nhiều chi nhánh (Task 7, spec 10/09).
  Admin tạo máy in ở đây -> hệ thống gen TOKEN + trả serverUrl -> admin dán 2
  giá trị này vào app print-agent-rs cài trên máy tính nối máy in tại chi
  nhánh đó. Đơn thuộc kho nào tự in ở máy phục vụ kho đó (chọn máy: Task 2/3).
  Token CHỈ hiện đầy đủ 1 LẦN ngay sau khi tạo — bảng danh sách chỉ hiện 4 ký
  tự cuối (tokenDuoi) vì ai cầm token đầy đủ mạo danh được máy in, nhận/gửi
  job in thật của org.

  Nhật ký máy in (hợp đồng v2, 24/09/2026 §5): thẻ mỗi máy có dòng sự cố theo
  `tinhTrang` (đỏ = lỗi, vàng = cảnh báo); mục "Nhật ký máy in" (PrintAgentLogPanel) dưới
  danh sách CHỈ hiện cho owner/admin. Mã → nhãn ở may-in-nhan.ts (nguồn duy nhất).

  Giao diện (25/09): cùng khuôn Atlas v2 của trang Thông báo hệ thống — topbar ô biểu
  tượng + tiêu đề + nút, token màu ở airtable.css. Mỗi máy một THẺ (shop chỉ có vài máy,
  bảng 5 cột cho 2 dòng thì trống trơn và giấu mất tình trạng) — viền trái theo tình trạng:
  xanh = đang kết nối, đỏ/vàng = có sự cố, xám = mất kết nối.

  Hàng đợi in (25/09, hợp đồng docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md §6.1 + §8.6): trang nạp
  GET /may-in-agents/hang-doi (CHỈ admin) — thẻ mỗi máy có chip "N đang chờ" (N = lệnh đang/sẽ in
  của máy đó; cam nếu có hoá đơn tạm giữ vì máy in lỗi, xanh nếu chỉ đang gửi/chờ) — bấm chip mở
  thẻ "Hàng đợi in" lọc máy đó. Cùng dữ liệu truyền xuống mục Hàng đợi & nhật ký.

  Máy in nối kiểu gì (26/09, app ≥ 0.2.8 gửi `ketNoi` qua thong-tin-app): dưới tên máy một dòng nhỏ
  "🔌 USB" / "🌐 <moTa mạng LAN>" / "Máy in chia sẻ"; offline hoặc app cũ thì không hiện. Dòng
  "Máy tính" trong thẻ: hệ điều hành + phiên bản app (may-in-ket-noi.ts).
-->
<template>
  <!-- Trang Atlas này là giao diện SÁNG (token --at-* chữ tối): ép theme hsLight cho cả trang và
       các hộp thoại của nó — MobileLayout mặc định theme tối, không ép thì chữ tối trên nền tối. -->
  <v-theme-provider theme="hsLight" with-background class="pa-nen">
  <div class="pa-page airtable-scope">
    <header class="pa-topbar">
      <div class="pa-topbar-title">
        <div class="pa-ico" aria-hidden="true"><v-icon size="22">mdi-printer-outline</v-icon></div>
        <div>
          <h1 class="pa-h1">Máy in</h1>
          <p class="pa-sub">
            Mỗi chi nhánh một máy in, nối bằng token · hoá đơn thuộc kho nào tự in ở máy phục vụ kho đó
          </p>
        </div>
      </div>
      <div class="pa-topbar-actions">
        <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="loading" @click="load">
          Làm mới
        </v-btn>
        <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="openCreate">
          Thêm máy in
        </v-btn>
      </div>
    </header>

    <v-alert v-if="loadError" type="error" variant="tonal" density="compact" class="mb-4">{{ loadError }}</v-alert>

    <section class="pa-section" aria-labelledby="pa-ds-tieu-de">
      <div class="pa-section-head">
        <h2 id="pa-ds-tieu-de" class="pa-h2">
          Danh sách máy in
          <span v-if="danhSach.length" class="pa-dem">{{ danhSach.length }}</span>
        </h2>
        <div v-if="danhSach.length" class="pa-tom-tat">
          <span v-if="tomTat.on" class="at-chip at-chip--success pa-chip-nho">
            <span class="pa-dot pa-dot--on" />{{ tomTat.on }} đang kết nối
          </span>
          <span v-if="tomTat.off" class="at-chip at-chip--neutral pa-chip-nho">
            <span class="pa-dot pa-dot--off" />{{ tomTat.off }} mất kết nối
          </span>
          <span
            v-if="tomTat.suCo"
            class="at-chip pa-chip-nho"
            :class="tomTat.coLoi ? 'at-chip--danger' : 'at-chip--warning'"
          >
            <v-icon size="13">mdi-alert-circle-outline</v-icon>{{ tomTat.suCo }} có sự cố
          </span>
        </div>
      </div>

      <v-alert
        v-if="!loading && danhSach.length > 0 && !coMacDinh"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        Chưa có máy in mặc định — hoá đơn thuộc kho chưa gán máy nào sẽ không in được. Bấm
        <b>Sửa</b> ở một máy và bật "Máy mặc định".
      </v-alert>

      <!-- Lần tải đầu: khung xám thay chữ "Đang tải…" -->
      <div v-if="loading && danhSach.length === 0" class="pa-grid" aria-busy="true" aria-label="Đang tải danh sách máy in">
        <div v-for="i in 2" :key="i" class="pa-may pa-may--khung">
          <div class="pa-khung pa-khung--dau" />
          <div class="pa-khung" />
          <div class="pa-khung pa-khung--ngan" />
        </div>
      </div>

      <div v-else-if="danhSach.length === 0 && !loadError" class="pa-trong">
        <div class="pa-trong-ico" aria-hidden="true"><v-icon size="26">mdi-printer-off-outline</v-icon></div>
        <div class="pa-trong-tieu-de">Chưa có máy in nào</div>
        <ol class="pa-buoc">
          <li>Bấm <b>Thêm máy in</b>, chọn kho mà máy phục vụ.</li>
          <li>Sao chép <b>token</b> và <b>địa chỉ server</b> — chỉ hiện một lần.</li>
          <li>Dán vào app Máy in trên máy tính nối máy in ở chi nhánh.</li>
        </ol>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="openCreate">Thêm máy in</v-btn>
      </div>

      <div v-else-if="danhSach.length > 0" class="pa-grid" :class="{ 'pa-grid--mo': loading }">
        <article
          v-for="m in danhSach"
          :key="m.id"
          class="pa-may"
          :class="`pa-may--${trangThaiCua(m)}`"
          :aria-label="`Máy in ${m.ten}`"
        >
          <div class="pa-may-dau">
            <div class="pa-may-ico" aria-hidden="true"><v-icon size="20">mdi-printer</v-icon></div>
            <div class="pa-may-ten-khoi">
              <div class="pa-may-ten" :title="m.ten">{{ m.ten }}</div>
              <div class="pa-may-dong-phu">
                <span class="pa-ket-noi" :class="m.online ? 'pa-ket-noi--on' : 'pa-ket-noi--off'">
                  <span class="pa-dot" :class="m.online ? 'pa-dot--on' : 'pa-dot--off'" />
                  {{ m.online ? 'Đang kết nối' : 'Mất kết nối' }}
                </span>
                <span
                  v-if="m.laMacDinh"
                  class="at-chip at-chip--info pa-chip-nho"
                  title="Hoá đơn thuộc kho chưa gán máy nào sẽ in ở máy này"
                ><v-icon size="12">mdi-star</v-icon>Mặc định</span>
                <button
                  v-if="choCua(m)"
                  type="button"
                  class="pa-cho-chip"
                  :class="choCua(m)!.tamGiu ? 'pa-cho-chip--cam' : 'pa-cho-chip--xanh'"
                  :data-may-in-id="m.id"
                  :title="choCua(m)!.tamGiu
                    ? 'Có hoá đơn đang TẠM GIỮ vì máy in lỗi — hệ thống tự in khi máy hết lỗi. Bấm để xem / huỷ.'
                    : 'Hoá đơn đang chờ in / đang gửi ở máy này — bấm để xem hàng đợi.'"
                  :aria-label="`${choCua(m)!.soLuong} hoá đơn đang chờ in ở máy ${m.ten} — mở hàng đợi`"
                  @click="moHangDoiCuaMay(m)"
                >
                  <v-icon size="12" :icon="choCua(m)!.tamGiu ? 'mdi-pause-circle-outline' : 'mdi-tray-full'" aria-hidden="true" />
                  {{ choCua(m)!.soLuong }} đang chờ
                </button>
              </div>
            </div>
            <div class="pa-may-nut">
              <v-btn
                icon="mdi-pencil-outline"
                variant="text"
                size="small"
                density="comfortable"
                title="Sửa"
                :aria-label="`Sửa máy in ${m.ten}`"
                @click="openEdit(m)"
              />
              <v-btn
                icon="mdi-trash-can-outline"
                variant="text"
                size="small"
                density="comfortable"
                color="error"
                title="Xoá"
                :aria-label="`Xoá máy in ${m.ten}`"
                @click="openXoa(m)"
              />
            </div>
          </div>

          <!-- Máy in nối kiểu gì (app ≥ 0.2.8): 🔌 USB / 🌐 mạng LAN / chia sẻ — không rõ thì không hiện -->
          <div
            v-if="ketNoiCua(m)"
            class="pa-ket-noi-may"
            :class="`pa-ket-noi-may--${ketNoiCua(m)!.kieu}`"
            :title="ketNoiCua(m)!.tieuDe"
          >{{ ketNoiCua(m)!.chu }}</div>

          <div
            v-if="chipCua(m)"
            class="pa-su-co"
            :class="`pa-su-co--${chipCua(m)!.mau}`"
            :title="chipCua(m)!.tieuDe"
          >
            <v-icon size="16">{{ chipCua(m)!.bieuTuong }}</v-icon>
            <span>{{ chipCua(m)!.chu }}</span>
          </div>

          <dl class="pa-may-tt">
            <div class="pa-tt-dong">
              <dt>Kho phục vụ</dt>
              <dd>
                <template v-if="khoCua(m.warehouseIds).length">
                  <span
                    v-for="k in khoCua(m.warehouseIds)"
                    :key="k.id"
                    class="at-chip at-chip--neutral pa-chip-nho"
                    :title="k.ten"
                  >{{ k.ma }}</span>
                </template>
                <span v-else class="pa-muted">Chưa gán kho</span>
              </dd>
            </div>
            <div class="pa-tt-dong">
              <dt>Token</dt>
              <dd><code class="pa-token" title="Chỉ hiện 4 ký tự cuối">••••{{ m.tokenDuoi }}</code></dd>
            </div>
            <div v-if="mayTinhCua(m)" class="pa-tt-dong">
              <dt>Máy tính</dt>
              <dd class="pa-may-tinh">{{ mayTinhCua(m) }}</dd>
            </div>
          </dl>
        </article>
      </div>

      <p v-if="danhSach.length > 0" class="pa-goi-y">
        <v-icon size="14">mdi-information-outline</v-icon>
        Nối máy mới: <b>Thêm máy in</b> → sao chép token + địa chỉ server (chỉ hiện một lần) → dán vào
        app Máy in trên máy tính ở chi nhánh.
      </p>
    </section>

    <!-- Nhật ký máy in — CHỈ owner/admin (API 403 với người khác; mục tự ẩn nếu vẫn 403).
         Hai thẻ "Nhật ký in" | "Log app"; `?nhatKy=app` mở thẳng Log app. -->
    <PrintAgentLogPanel
      v-if="laAdmin"
      :may-ins="danhSach"
      :tab-dau="theNhatKyTuUrl"
      :hang-doi="hangDoi"
      :dang-tai-hang-doi="dangTaiHangDoi"
      :loi-hang-doi="loiHangDoi"
      :mo-hang-doi="moHangDoi"
      @lam-moi="nhipTrang"
      @tai-lai-hang-doi="taiHangDoi"
      @tam-dung-hang-doi="(d: boolean) => { hangDoiTamDung = d; }"
    />

    <!-- Dialog Thêm / Sửa -->
    <v-dialog v-model="formDialog" max-width="500" persistent>
      <v-card class="pa-dlg airtable-scope" theme="hsLight" rounded="lg">
        <div class="pa-dlg-dau">
          <div class="pa-ico pa-ico--nho" aria-hidden="true">
            <v-icon size="18">{{ editing ? 'mdi-pencil-outline' : 'mdi-printer-outline' }}</v-icon>
          </div>
          <div>
            <div class="pa-dlg-tieu-de">{{ editing ? 'Sửa máy in' : 'Thêm máy in' }}</div>
            <div class="pa-dlg-phu">
              {{ editing
                ? 'Token giữ nguyên — app ở chi nhánh không phải nhập lại.'
                : 'Lưu xong sẽ hiện token + địa chỉ server để dán vào app máy in.' }}
            </div>
          </div>
        </div>
        <v-card-text class="pa-dlg-than">
          <v-text-field
            v-model="form.ten"
            label="Tên máy in"
            variant="outlined"
            density="comfortable"
            placeholder="VD: Máy in Hồ Chí Minh"
            hide-details="auto"
            class="mb-4"
            autofocus
          />
          <v-select
            v-model="form.warehouseIds"
            :items="khoOptions"
            item-title="label"
            item-value="value"
            label="Kho phục vụ"
            variant="outlined"
            density="comfortable"
            multiple
            chips
            closable-chips
            hint="Hoá đơn thuộc các kho này sẽ in ở máy này"
            persistent-hint
            class="mb-4"
          />
          <div class="pa-mac-dinh">
            <div>
              <div class="pa-mac-dinh-nhan">Máy mặc định</div>
              <div class="pa-mac-dinh-phu">In hoá đơn thuộc kho chưa gán máy nào</div>
            </div>
            <v-switch
              v-model="form.laMacDinh"
              color="primary"
              hide-details
              inset
              density="compact"
              aria-label="Máy mặc định"
            />
          </div>
          <v-alert v-if="formError" type="error" variant="tonal" density="compact" class="mt-3">{{ formError }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-dlg-chan">
          <v-spacer />
          <v-btn variant="text" :disabled="saving" @click="formDialog = false">Huỷ</v-btn>
          <v-btn color="primary" variant="flat" :loading="saving" @click="luuForm">
            {{ editing ? 'Lưu' : 'Tạo máy in' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog hiện token sau khi tạo — CHỈ 1 LẦN -->
    <v-dialog v-model="tokenDialog" max-width="580" persistent>
      <v-card class="pa-dlg airtable-scope" theme="hsLight" rounded="lg">
        <div class="pa-dlg-dau">
          <div class="pa-ico pa-ico--nho pa-ico--xanh" aria-hidden="true"><v-icon size="18">mdi-check</v-icon></div>
          <div>
            <div class="pa-dlg-tieu-de">Đã tạo máy in "{{ tokenKetQua?.mayIn.ten }}"</div>
            <div class="pa-dlg-phu">Dán hai giá trị dưới đây vào app Máy in trên máy tính ở chi nhánh.</div>
          </div>
        </div>
        <v-card-text class="pa-dlg-than">
          <v-alert type="warning" density="compact" variant="tonal" class="mb-4">
            Token chỉ hiện <b>1 lần này</b>. Sao chép ngay — đóng cửa sổ này sẽ không xem lại được
            nữa (chỉ tạo máy mới nếu quên).
          </v-alert>

          <div class="pa-copy-field">
            <div class="pa-copy-label">Địa chỉ server</div>
            <v-text-field
              :model-value="tokenKetQua?.serverUrl"
              readonly
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              class="pa-mono"
            >
              <template #append-inner>
                <v-btn size="small" variant="tonal" prepend-icon="mdi-content-copy" @click="copy(tokenKetQua?.serverUrl, 'Địa chỉ server')">
                  Copy
                </v-btn>
              </template>
            </v-text-field>
          </div>

          <div class="pa-copy-field mt-4">
            <div class="pa-copy-label">Token</div>
            <v-text-field
              :model-value="tokenKetQua?.token"
              readonly
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              class="pa-mono"
            >
              <template #append-inner>
                <v-btn size="small" variant="tonal" prepend-icon="mdi-content-copy" @click="copy(tokenKetQua?.token, 'Token')">
                  Copy
                </v-btn>
              </template>
            </v-text-field>
          </div>
        </v-card-text>
        <v-card-actions class="pa-dlg-chan">
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="dongTokenDialog">Đã sao chép, đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog confirm xoá — KHÔNG dùng window.confirm (treo) -->
    <v-dialog v-model="xoaDialog" max-width="440">
      <v-card class="pa-dlg airtable-scope" theme="hsLight" rounded="lg">
        <div class="pa-dlg-dau">
          <div class="pa-ico pa-ico--nho pa-ico--do" aria-hidden="true"><v-icon size="18">mdi-trash-can-outline</v-icon></div>
          <div>
            <div class="pa-dlg-tieu-de">Xoá máy in "{{ dangXoa?.ten }}"?</div>
            <div class="pa-dlg-phu">Thao tác không hoàn tác được.</div>
          </div>
        </div>
        <v-card-text class="pa-dlg-than">
          App đang dùng token của máy này sẽ mất kết nối và không nhận lệnh in nữa.
        </v-card-text>
        <v-card-actions class="pa-dlg-chan">
          <v-spacer />
          <v-btn variant="text" :disabled="xoaLoading" @click="xoaDialog = false">Huỷ</v-btn>
          <v-btn color="error" variant="flat" :loading="xoaLoading" @click="xacNhanXoa">Xoá</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  </v-theme-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { useToast } from '@/composables/use-toast';
import { useAuthStore } from '@/stores/auth';
import {
  layDanhSach, layKhos, tao, sua, xoa, layHangDoi, maHttpCuaLoi, laYeuCauDaHuy,
  type MayIn, type Kho, type TaoMayInKetQua, type HangDoiIn,
} from '@/api/print-agents';
import PrintAgentLogPanel from './PrintAgentLogPanel.vue';
import { chipTinhTrang, type ChipTinhTrang } from './may-in-nhat-ky';
import { demChoInTheoMay } from './may-in-hang-doi';
import { dongKetNoi, dongMayTinh, type DongKetNoi } from './may-in-ket-noi';

const toast = useToast();
const auth = useAuthStore();
const route = useRoute();
const laAdmin = computed(() => auth.isAdmin);
/** `?nhatKy=hang_doi|in|app` — thẻ mở sẵn của mục Hàng đợi & nhật ký máy in. */
const theNhatKyTuUrl = computed(() => (typeof route.query.nhatKy === 'string' ? route.query.nhatKy : null));

const loading = ref(true);
const loadError = ref('');
const danhSach = ref<MayIn[]>([]);
const khos = ref<Kho[]>([]);

const khoOptions = computed(() => khos.value.map((k) => ({ value: k.id, label: `${k.ma} — ${k.ten}` })));

/** Kho của một máy để hiện chip (mã kho, tooltip tên). Id không còn trong danh mục thì hiện `#id`. */
function khoCua(ids: number[]): Kho[] {
  return (ids ?? []).map((id) => khos.value.find((k) => k.id === id) ?? { id, ma: `#${id}`, ten: 'Kho không còn trong danh mục' });
}

// ── Chip tình trạng (§3.4) — "Hết giấy · 3 phút trước" tính theo lúc tải danh sách ──
const mocTaiDs = ref(Date.now());
const chipTheoMay = computed(() => {
  const m = new Map<string, ChipTinhTrang | null>();
  for (const may of danhSach.value) m.set(may.id, chipTinhTrang(may.tinhTrang, mocTaiDs.value));
  return m;
});
function chipCua(m: MayIn): ChipTinhTrang | null {
  return chipTheoMay.value.get(m.id) ?? null;
}

// ── Máy in nối kiểu gì + máy tính (app ≥ 0.2.8, may-in-ket-noi.ts) ──
const ketNoiTheoMay = computed(() => new Map(danhSach.value.map((m) => [m.id, dongKetNoi(m)] as const)));
function ketNoiCua(m: MayIn): DongKetNoi | null {
  return ketNoiTheoMay.value.get(m.id) ?? null;
}
function mayTinhCua(m: MayIn): string | null {
  return dongMayTinh(m);
}

// ── Chỉ để hiện (viền thẻ + dòng tóm tắt) — không đổi dữ liệu ──
type TrangThaiThe = 'loi' | 'canh_bao' | 'on' | 'off';
function trangThaiCua(m: MayIn): TrangThaiThe {
  const mau = chipCua(m)?.mau;
  if (mau === 'error') return 'loi';
  if (mau === 'warning') return 'canh_bao';
  return m.online ? 'on' : 'off';
}
const tomTat = computed(() => {
  let on = 0;
  let off = 0;
  let suCo = 0;
  let coLoi = false;
  for (const m of danhSach.value) {
    if (m.online) on++;
    else off++;
    const tt = trangThaiCua(m);
    if (tt === 'loi' || tt === 'canh_bao') suCo++;
    if (tt === 'loi') coLoi = true;
  }
  return { on, off, suCo, coLoi };
});
/** Không máy nào mặc định → hoá đơn của kho chưa gán máy không in được (chon-may-in.ts tầng 3). */
const coMacDinh = computed(() => danhSach.value.some((m) => m.laMacDinh));

// Số lượt tải danh sách: tải ngầm (tự làm mới) chạy chồng với load() sau khi lưu/xoá thì
// chỉ kết quả của lượt MỚI NHẤT được ghi vào bảng.
let lanTaiDs = 0;

async function load() {
  const lan = ++lanTaiDs;
  loading.value = true;
  loadError.value = '';
  try {
    const [ds, kh] = await Promise.all([layDanhSach(), layKhos()]);
    khos.value = kh;
    if (lan === lanTaiDs) {
      danhSach.value = ds;
      mocTaiDs.value = Date.now();
    }
  } catch (e: unknown) {
    loadError.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      || 'Không tải được danh sách máy in';
  } finally {
    loading.value = false;
  }
}

/** Nhịp "Tự làm mới" của nhật ký: tải lại danh sách máy (Online/chip) không nháy bảng. */
async function taiLaiNgam() {
  if (loading.value) return;
  const lan = ++lanTaiDs;
  try {
    const ds = await layDanhSach({ ngam: true });
    if (lan !== lanTaiDs) return;
    danhSach.value = ds;
    mocTaiDs.value = Date.now();
  } catch {
    // Giữ bảng đang hiện; nhịp sau thử lại. Chạy ngầm nên không toast — mục
    // nhật ký cùng nhịp đã báo lỗi ngay tại chỗ.
  }
}

// ── Hàng đợi in (§8.6) — CHỈ admin; nạp lúc mở trang, mỗi nhịp 15 giây của mục nhật ký,
//    và mỗi 5 giây khi thẻ Hàng đợi đang mở (thẻ đó xin) ────────────────────────────────
const hangDoi = ref<HangDoiIn | null>(null);
const dangTaiHangDoi = ref(false);
const loiHangDoi = ref('');
const moHangDoi = ref<{ mayInId: string | null; lan: number } | null>(null);
/**
 * Thẻ Hàng đợi đang mở hộp xác nhận / đang huỷ (§6.1 "tạm dừng") → MỌI nhịp nạp ngầm hàng đợi
 * (15 s của mục nhật ký) nghỉ: danh sách không đổi dưới tay người đang quyết.
 */
const hangDoiTamDung = ref(false);
let theHeHangDoi = 0;
let boHuyHangDoi: AbortController | null = null;
/** Lúc nạp hàng đợi xong gần nhất (ms) — gộp các nhịp ngầm dồn nhau. */
let lucNapHangDoi = 0;
/** Nhịp ngầm tới trong chừng này sau một lần nạp xong thì bỏ (mở thẻ ngay sau khi trang nạp…). */
const MS_GOP_NHIP_HANG_DOI = 2_000;

/** Chip "N đang chờ" theo máy — CHỈ nhóm đang/sẽ in. */
const choTheoMay = computed(() => demChoInTheoMay(hangDoi.value));
function choCua(m: MayIn): { soLuong: number; tamGiu: boolean } | null {
  return choTheoMay.value.get(m.id) ?? null;
}

async function taiHangDoi(tuy: { ngam?: boolean } = {}): Promise<void> {
  if (!laAdmin.value) return;
  // Nhịp ngầm (15 s của mục nhật ký, 5 s của thẻ Hàng đợi) không chồng lên lượt đang bay hay
  // vừa xong; lượt CÓ CHỦ Ý (mở trang, sau khi huỷ) luôn chạy và thay lượt cũ.
  if (tuy.ngam && (hangDoiTamDung.value || dangTaiHangDoi.value || Date.now() - lucNapHangDoi < MS_GOP_NHIP_HANG_DOI)) return;
  boHuyHangDoi?.abort();
  boHuyHangDoi = new AbortController();
  const the = ++theHeHangDoi;
  dangTaiHangDoi.value = true;
  try {
    const hd = await layHangDoi({}, { signal: boHuyHangDoi.signal, ngam: tuy.ngam === true });
    if (the !== theHeHangDoi) return;
    hangDoi.value = hd;
    loiHangDoi.value = '';
    lucNapHangDoi = Date.now();
  } catch (e) {
    if (the !== theHeHangDoi || laYeuCauDaHuy(e)) return;
    // Giữ danh sách đang hiện (nếu có) — nhịp sau thử lại; chỉ báo tại chỗ.
    const ma = maHttpCuaLoi(e);
    loiHangDoi.value = ma === 403
      ? 'Chỉ chủ sở hữu hoặc quản trị viên xem được hàng đợi in.'
      : ma === 404
        ? 'Máy chủ chưa có hàng đợi in (backend cần cập nhật).'
        : ma ? `Không tải được hàng đợi in (mã ${ma}) — sẽ thử lại.` : 'Không tải được hàng đợi in — không kết nối được máy chủ, sẽ thử lại.';
  } finally {
    if (the === theHeHangDoi) dangTaiHangDoi.value = false;
  }
}

/** Nhịp 15 giây của mục nhật ký: danh sách máy (chip tình trạng) + hàng đợi (chip đang chờ). */
function nhipTrang(): void {
  void taiLaiNgam();
  void taiHangDoi({ ngam: true });
}

/** Bấm chip "N đang chờ" → thẻ Hàng đợi, lọc máy này. */
function moHangDoiCuaMay(m: MayIn): void {
  moHangDoi.value = { mayInId: m.id, lan: (moHangDoi.value?.lan ?? 0) + 1 };
}

// ── Dialog Thêm/Sửa ──────────────────────────────────────────────────────
const formDialog = ref(false);
const editing = ref<MayIn | null>(null);
const saving = ref(false);
const formError = ref('');
const form = ref<{ ten: string; warehouseIds: number[]; laMacDinh: boolean }>({
  ten: '', warehouseIds: [], laMacDinh: false,
});

function openCreate() {
  editing.value = null;
  form.value = { ten: '', warehouseIds: [], laMacDinh: false };
  formError.value = '';
  formDialog.value = true;
}

function openEdit(m: MayIn) {
  editing.value = m;
  form.value = { ten: m.ten, warehouseIds: [...m.warehouseIds], laMacDinh: m.laMacDinh };
  formError.value = '';
  formDialog.value = true;
}

async function luuForm() {
  const ten = form.value.ten.trim();
  if (!ten) {
    formError.value = 'Chưa nhập tên máy in';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const payload = { ten, warehouseIds: form.value.warehouseIds, laMacDinh: form.value.laMacDinh };
    if (editing.value) {
      await sua(editing.value.id, payload);
      toast.success(`Đã cập nhật máy in "${ten}"`);
      formDialog.value = false;
      await load();
    } else {
      const ketQua = await tao(payload);
      formDialog.value = false;
      await load();
      moTokenDialog(ketQua);
    }
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } } };
    const code = err?.response?.data?.error;
    formError.value = code === 'THIEU_TEN' ? 'Chưa nhập tên máy in'
      : code === 'CHI_ADMIN' ? 'Chỉ quản trị mới được thao tác'
      : 'Lưu thất bại';
  } finally {
    saving.value = false;
  }
}

// ── Dialog hiện token (chỉ sau khi tạo) ─────────────────────────────────
const tokenDialog = ref(false);
const tokenKetQua = ref<TaoMayInKetQua | null>(null);

function moTokenDialog(ketQua: TaoMayInKetQua) {
  tokenKetQua.value = ketQua;
  tokenDialog.value = true;
}

function dongTokenDialog() {
  tokenDialog.value = false;
  tokenKetQua.value = null;
}

async function copy(value: string | undefined, label: string) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`Đã sao chép ${label}`);
  } catch {
    toast.error(`Không sao chép được ${label}`);
  }
}

// ── Xoá — v-dialog confirm, KHÔNG window.confirm ─────────────────────────
const xoaDialog = ref(false);
const dangXoa = ref<MayIn | null>(null);
const xoaLoading = ref(false);

function openXoa(m: MayIn) {
  dangXoa.value = m;
  xoaDialog.value = true;
}

async function xacNhanXoa() {
  if (!dangXoa.value) return;
  xoaLoading.value = true;
  try {
    await xoa(dangXoa.value.id);
    toast.success(`Đã xoá máy in "${dangXoa.value.ten}"`);
    xoaDialog.value = false;
    await load();
  } catch (e: unknown) {
    const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
    toast.error(code === 'CHI_ADMIN' ? 'Chỉ quản trị mới được thao tác' : 'Xoá thất bại');
  } finally {
    xoaLoading.value = false;
  }
}

onMounted(() => {
  void load();
  void taiHangDoi();
});

onBeforeUnmount(() => {
  theHeHangDoi++;
  boHuyHangDoi?.abort();
});
</script>

<style scoped>
@import '@/assets/airtable.css';

.pa-nen { min-height: 100%; }
.pa-page { max-width: 1180px; }

/* ── Topbar — khuôn Atlas v2 (SystemNotificationsPage) ── */
.pa-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  flex-wrap: wrap; margin-bottom: 20px;
}
.pa-topbar-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pa-topbar-actions { display: flex; align-items: center; gap: 8px; }
.pa-ico {
  width: 40px; height: 40px; border-radius: 8px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-action-soft); color: var(--at-action);
}
.pa-ico--nho { width: 34px; height: 34px; }
.pa-ico--xanh { background: var(--at-atlas-success-soft); color: #1b6b46; }
.pa-ico--do { background: var(--at-atlas-danger-soft); color: var(--at-atlas-danger); }
.pa-h1 { font-size: 19px; font-weight: 700; color: var(--at-ink); line-height: 1.2; margin: 0; }
.pa-sub { font-size: 12.5px; color: var(--at-muted); margin: 2px 0 0; }

/* ── Mục danh sách ── */
.pa-section { margin-bottom: 28px; }
.pa-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px 12px;
  flex-wrap: wrap; margin-bottom: 12px;
}
.pa-h2 {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700; color: var(--at-ink); margin: 0;
}
.pa-dem {
  font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 9999px;
  background: var(--at-surface-soft); color: var(--at-muted);
}
.pa-tom-tat { display: flex; flex-wrap: wrap; gap: 6px; }
.pa-chip-nho { font-size: 11.5px; font-weight: 600; padding: 2px 8px; gap: 5px; white-space: nowrap; }

.pa-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; }
.pa-dot--on { background: var(--at-atlas-success); box-shadow: 0 0 0 3px rgba(18, 183, 106, 0.16); }
.pa-dot--off { background: #b3bac6; }

/* ── Thẻ máy in ── */
.pa-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px;
  transition: opacity 0.15s;
}
.pa-grid--mo { opacity: 0.6; }
.pa-may {
  background: var(--at-canvas); border: 1px solid var(--at-hairline); border-radius: 12px;
  border-left: 4px solid var(--at-hairline); padding: 14px 14px 12px 16px;
  box-shadow: var(--at-shadow-card); display: flex; flex-direction: column; gap: 12px;
  min-width: 0;
}
.pa-may--on { border-left-color: var(--at-atlas-success); }
.pa-may--loi { border-left-color: var(--at-atlas-danger); }
.pa-may--canh_bao { border-left-color: var(--at-atlas-warning); }
.pa-may--off { border-left-color: #c9ced8; }

.pa-may-dau { display: flex; align-items: flex-start; gap: 12px; }
.pa-may-ico {
  width: 38px; height: 38px; border-radius: 10px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-surface-soft); color: var(--at-body);
}
.pa-may--on .pa-may-ico { background: var(--at-atlas-success-soft); color: #1b6b46; }
.pa-may--loi .pa-may-ico { background: var(--at-atlas-danger-soft); color: var(--at-atlas-danger); }
.pa-may--canh_bao .pa-may-ico { background: var(--at-atlas-warning-soft); color: #92400e; }
.pa-may-ten-khoi { flex: 1; min-width: 0; }
.pa-may-ten {
  font-size: 14.5px; font-weight: 700; color: var(--at-ink); line-height: 1.35;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pa-may-dong-phu { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; }
.pa-ket-noi { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; }
.pa-ket-noi--on { color: #1b6b46; }
.pa-ket-noi--off { color: var(--at-muted); }
.pa-may-nut { display: flex; gap: 2px; margin: -4px -6px 0 0; flex: none; }
.pa-may-nut :deep(.v-btn) { color: var(--at-muted); }
.pa-may-nut :deep(.v-btn:hover) { color: var(--at-ink); }
.pa-may-nut :deep(.v-btn.text-error:hover) { color: var(--at-atlas-danger); }

/* Chip "N đang chờ" (hàng đợi in) — bấm được: cam = có hoá đơn tạm giữ, xanh = chỉ đang chờ/gửi */
.pa-cho-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px;
  border-radius: 9999px; border: 1px solid transparent; cursor: pointer;
  font: inherit; font-size: 11.5px; font-weight: 600; white-space: nowrap;
  transition: filter 0.12s, box-shadow 0.12s;
}
.pa-cho-chip:hover { filter: brightness(0.97); box-shadow: 0 1px 2px rgba(20, 26, 36, 0.08); }
.pa-cho-chip:focus-visible { outline: 2px solid var(--at-action); outline-offset: 2px; }
.pa-cho-chip--cam { background: var(--at-atlas-warning-soft); color: #92400e; border-color: #fcd34d; }
.pa-cho-chip--xanh { background: var(--at-action-soft); color: var(--at-action); border-color: #bfdbfe; }

.pa-su-co {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px;
  font-size: 12.5px; font-weight: 600; line-height: 1.35;
  background: var(--at-surface-soft); color: var(--at-body); border: 1px solid var(--at-hairline);
}
.pa-su-co--error { background: var(--at-atlas-danger-soft); color: #b42318; border-color: #fca5a5; }
.pa-su-co--warning { background: var(--at-atlas-warning-soft); color: #92400e; border-color: #fcd34d; }

/* Dòng "máy in nối kiểu gì" — nhỏ, xuống dòng tự do (câu LAN dài: IP + máy báo…), không cuộn ngang */
.pa-ket-noi-may {
  font-size: 12.5px; line-height: 1.4; color: var(--at-body); margin-top: -4px;
  overflow-wrap: anywhere; white-space: normal;
}
.pa-ket-noi-may--mang { color: var(--at-action); }
.pa-ket-noi-may--usb, .pa-ket-noi-may--chia_se { color: var(--at-body); }
.pa-may-tinh { overflow-wrap: anywhere; }

.pa-may-tt { margin: 0; padding-top: 10px; border-top: 1px solid var(--at-hairline); display: grid; gap: 8px; }
.pa-tt-dong { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 8px; }
.pa-tt-dong dt {
  font-size: 11px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--at-hint);
}
.pa-tt-dong dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; font-size: 13px; color: var(--at-body); }
.pa-token {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 12px;
  background: var(--at-surface-soft); color: var(--at-body); padding: 1px 6px; border-radius: 4px;
  letter-spacing: 0.5px;
}
.pa-muted { color: var(--at-hint); font-size: 12.5px; }

/* Khung chờ lần tải đầu */
.pa-may--khung { border-left-color: var(--at-hairline); gap: 10px; }
.pa-khung {
  height: 12px; border-radius: 6px; width: 70%;
  background: linear-gradient(90deg, #eef1f6 25%, #f6f8fb 50%, #eef1f6 75%);
  background-size: 200% 100%; animation: pa-nhap-nhay 1.2s ease-in-out infinite;
}
.pa-khung--dau { height: 18px; width: 45%; }
.pa-khung--ngan { width: 35%; }
@keyframes pa-nhap-nhay { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .pa-khung { animation: none; } }

/* Trống */
.pa-trong {
  background: var(--at-canvas); border: 1px dashed #d5dae3; border-radius: 12px;
  padding: 36px 24px; text-align: center;
}
.pa-trong-ico {
  width: 52px; height: 52px; border-radius: 12px; margin: 0 auto 12px;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-surface-soft); color: var(--at-muted);
}
.pa-trong-tieu-de { font-size: 15px; font-weight: 700; color: var(--at-ink); margin-bottom: 10px; }
.pa-buoc {
  display: block; width: fit-content; text-align: left; margin: 0 auto 18px; padding-left: 20px;
  font-size: 13px; line-height: 1.8; color: var(--at-body);
}

.pa-goi-y {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 12px; color: var(--at-muted); margin: 12px 0 0;
}

/* ── Dialog — v-dialog dời nội dung ra <body>, ngoài .airtable-scope của trang: v-card tự gắn lại lớp scope để có biến màu ── */
.pa-dlg-dau { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 4px; }
.pa-dlg-tieu-de { font-size: 16px; font-weight: 700; color: var(--at-ink); line-height: 1.3; }
.pa-dlg-phu { font-size: 12.5px; color: var(--at-muted); margin-top: 2px; }
.pa-dlg-than { padding: 16px 24px 8px !important; font-size: 13.5px; color: var(--at-body); }
.pa-dlg-chan { padding: 8px 16px 14px; }
.pa-mac-dinh {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border: 1px solid var(--at-hairline); border-radius: 8px;
}
.pa-mac-dinh-nhan { font-size: 13.5px; font-weight: 600; color: var(--at-ink); }
.pa-mac-dinh-phu { font-size: 12px; color: var(--at-muted); margin-top: 1px; }
.pa-mac-dinh :deep(.v-switch) { flex: none; }
.pa-copy-label { font-size: 12px; font-weight: 600; color: var(--at-muted); margin-bottom: 4px; }
.pa-mono :deep(input) { font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 13px; }
</style>

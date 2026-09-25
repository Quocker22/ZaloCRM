<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentQueuePanel — thẻ "Hàng đợi in" trong mục Hàng đợi & nhật ký máy in (25/09, hợp đồng
  docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md mục 8 — v5.1). Chủ giao: hoá đơn gửi lúc máy in lỗi phải
  HIỆN; huỷ được; huỷ phải báo kết quả THẬT — KHÔNG BAO GIỜ hiện hay ngụ ý "đã huỷ" trừ khi đã
  nhận kết quả ok:true của máy chủ cho ĐÚNG id đó.

  Dữ liệu do trang cha nạp (`hangDoi`, GET /may-in-agents/hang-doi — cùng nguồn với chip "N đang
  chờ" trên thẻ máy); thẻ này xin nạp lại (`taiLai`) khi mở, mỗi 5 giây khi đang hiện, và sau mỗi
  thao tác. Tạm dừng (và báo `tamDung` để trang cha dừng nhịp 15 giây) khi tab trình duyệt ẩn, đang
  mở hộp xác nhận, hoặc đang huỷ / bỏ.

  Gửi huỷ: chia lô ≤ 50 id, gửi NỐI TIẾP. Không có câu trả lời (mất mạng, hết giờ, 5xx) → TỰ GỬI
  LẠI đúng các id đó vài lần, chờ tăng dần (an toàn: huỷ lặp trả "đã huỷ trước đó"); máy chủ trả
  4xx → CHẮC CHẮN chưa huỷ gì (câu riêng). Trong suốt lúc chờ, dòng được GIỮ (bản sao lấy lúc bấm)
  — dòng biến khỏi snapshot không bao giờ được hiểu là "đã huỷ". Hết lượt mà vẫn không có trả lời
  → "Chưa rõ — … Xem Nhật ký in …", giữ tới khi người dùng ẩn.

  Giao diện: ép theme sáng (hsLight) như cả trang — MobileLayout mặc định theme tối mà token Atlas
  là chữ tối; khung hẹp (< 640px, container query) mỗi dòng thành một thẻ xếp dọc.
-->
<template>
  <div class="hd-card" :aria-busy="dangTai">
    <v-theme-provider theme="hsLight">
      <div class="hd-toolbar">
        <v-select
          v-model="mayInId"
          class="hd-may-chon"
          :items="luaChonMayIn"
          prepend-inner-icon="mdi-printer-outline"
          variant="outlined"
          density="compact"
          hide-details
          aria-label="Lọc theo máy in"
        />
        <div class="hd-toolbar-phai">
          <span class="hd-dem" aria-live="polite">{{ dongTrangThai }}</span>
          <v-btn
            icon="mdi-refresh"
            variant="text"
            size="small"
            density="comfortable"
            aria-label="Tải lại hàng đợi"
            title="Tải lại hàng đợi"
            :loading="dangTai"
            :disabled="banThaoTac"
            @click="xinTaiLai(false)"
          />
        </div>
      </div>

      <div v-if="nhomChonTheoMay.length || chon.size" class="hd-chon-nhieu" role="toolbar" aria-label="Chọn nhiều lệnh">
        <button
          v-for="g in nhomChonTheoMay"
          :key="g.khoa"
          type="button"
          class="hd-pill"
          :disabled="banThaoTac"
          @click="chonTatCaCuaMay(g.khoa)"
        >
          <v-icon size="14" icon="mdi-checkbox-multiple-marked-outline" aria-hidden="true" />
          Chọn tất cả của {{ g.ten }} ({{ g.soLuong }})
        </button>
        <template v-if="chon.size">
          <span class="hd-da-chon">{{ chon.size }} lệnh đã chọn</span>
          <v-btn
            class="hd-nut-huy-nhieu"
            color="error"
            variant="tonal"
            size="small"
            prepend-icon="mdi-cancel"
            :disabled="banThaoTac"
            @click="moHopHuy([...chon])"
          >Huỷ {{ chon.size }} lệnh đã chọn</v-btn>
          <v-btn variant="text" size="small" :disabled="banThaoTac" @click="boChon">Bỏ chọn</v-btn>
        </template>
      </div>

      <v-alert v-if="loi" type="error" variant="tonal" density="compact" class="hd-loi">
        {{ loi }}
        <template #append>
          <v-btn size="small" variant="text" @click="xinTaiLai(false)">Thử lại</v-btn>
        </template>
      </v-alert>

      <div v-if="!hangDoi" class="hd-rong" role="status">
        <v-progress-circular v-if="dangTai" indeterminate size="18" width="2" color="primary" class="mr-2" />
        {{ dangTai ? 'Đang tải hàng đợi in…' : 'Chưa tải được hàng đợi in.' }}
      </div>

      <div v-else-if="dsChoIn.length === 0 && dsChuaXacNhan.length === 0" class="hd-rong hd-rong--ok" role="status">
        <div class="hd-rong-ico" aria-hidden="true"><v-icon size="22" icon="mdi-check-circle-outline" /></div>
        <div class="hd-rong-chu">Không có lệnh in nào đang chờ ✓</div>
        <div v-if="mayInId !== TAT_CA" class="hd-rong-phu">Chỉ đang xem một máy — chọn "Tất cả máy in" để xem các máy khác.</div>
      </div>

      <template v-else>
        <section
          v-for="nhom in cacNhom"
          :key="nhom.khoa"
          class="hd-nhom"
          :aria-labelledby="nhom.khoa === 'cho_in' ? 'hd-nhom-cho-in' : 'hd-nhom-chua-xn'"
        >
          <div class="hd-nhom-dau">
            <h3 v-if="nhom.khoa === 'cho_in'" id="hd-nhom-cho-in" class="hd-nhom-tieu-de">
              Đang chờ in <span class="hd-so-dem">{{ nhom.ds.length }}</span>
            </h3>
            <button
              v-else
              id="hd-nhom-chua-xn"
              type="button"
              class="hd-nhom-nut"
              :aria-expanded="nhom.mo"
              aria-controls="hd-vung-chua-xn"
              @click="moChuaXacNhan = !moNhomChuaXacNhan"
            >
              <v-icon size="16" :icon="nhom.mo ? 'mdi-chevron-down' : 'mdi-chevron-right'" aria-hidden="true" />
              Chưa xác nhận đã in <span class="hd-so-dem hd-so-dem--vang">{{ nhom.ds.length }}</span>
            </button>
            <span class="hd-nhom-phu">{{ nhom.khoa === 'cho_in'
              ? 'Theo thứ tự sẽ in · chỉ lệnh còn đang chờ mới huỷ được chắc chắn'
              : 'Đã gửi xuống máy in nhưng không rõ đã in chưa · 3 ngày gần nhất · không huỷ được từ xa' }}</span>
          </div>

          <v-table v-if="nhom.mo && nhom.ds.length" :id="nhom.khoa === 'cho_in' ? undefined : 'hd-vung-chua-xn'" class="hd-bang">
            <thead>
              <tr>
                <th class="hd-c-chon">
                  <input
                    v-if="nhom.khoa === 'cho_in'"
                    type="checkbox"
                    class="hd-o-chon"
                    :checked="daChonHet"
                    :indeterminate.prop="chon.size > 0 && !daChonHet"
                    :disabled="dsHuyDuoc.length === 0 || banThaoTac"
                    aria-label="Chọn tất cả lệnh huỷ được"
                    @change="doiChonTatCa"
                  >
                </th>
                <th>Hoá đơn</th>
                <th class="hd-c-may">Máy in</th>
                <th>Trạng thái</th>
                <th class="hd-c-tu" title="Giờ Việt Nam">Chờ từ</th>
                <th class="hd-c-hanh-dong"><span class="hd-an">Hành động</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in nhom.ds" :key="m.id" class="hd-dong" :class="lopDong(m)" :data-id="m.id">
                <td class="hd-c-chon">
                  <input
                    v-if="nhom.khoa === 'cho_in' && m.huy === 'chac_chan' && !laBanGiu(m.id)"
                    type="checkbox"
                    class="hd-o-chon"
                    :checked="chon.has(m.id)"
                    :disabled="!coTheHuy(m) || banThaoTac"
                    :aria-label="`Chọn ${m.soHoaDon}`"
                    @change="doiChon(m.id)"
                  >
                </td>
                <td class="hd-c-hd">
                  <div class="hd-so">{{ m.soHoaDon }}</div>
                  <div v-if="m.tenKhach" class="hd-khach">{{ m.tenKhach }}</div>
                </td>
                <td class="hd-c-may"><span class="hd-nhan-hep">Máy in: </span>{{ m.mayInTen || '—' }}</td>
                <td class="hd-c-trang-thai">
                  <template v-if="ketQuaCua(m.id)?.loai === 'da_huy'">
                    <span class="hd-chip hd-chip--xanh-la" role="status">
                      <v-icon size="14" icon="mdi-check" aria-hidden="true" />Đã huỷ ✓
                    </span>
                    <div class="hd-ly-do">{{ ketQuaCua(m.id)?.noiDung }}</div>
                  </template>
                  <template v-else-if="ketQuaCua(m.id)?.loai === 'da_bo'">
                    <span class="hd-chip hd-chip--xam" role="status">
                      <v-icon size="14" icon="mdi-eye-off-outline" aria-hidden="true" />Đã bỏ khỏi hàng đợi
                    </span>
                    <div class="hd-ly-do">{{ ketQuaCua(m.id)?.noiDung }}</div>
                  </template>
                  <template v-else>
                    <!-- Dòng GIỮ LẠI (không còn trong snapshot) mà có thông báo: nói đúng "đã rời hàng đợi",
                         KHÔNG suy ra lý do (có thể đã in, đã thất bại, đã huỷ…). -->
                    <span v-if="laBanGiu(m.id) && !dangXuLy(m.id)" class="hd-chip hd-chip--xam">
                      <v-icon size="14" icon="mdi-tray-remove" aria-hidden="true" />Đã rời hàng đợi
                    </span>
                    <template v-else>
                      <span class="hd-chip" :class="`hd-chip--${chipTrangThaiHangDoi(m).mau}`">
                        <v-icon size="14" :icon="chipTrangThaiHangDoi(m).bieuTuong" aria-hidden="true" />{{ chipTrangThaiHangDoi(m).chu }}
                      </span>
                      <div class="hd-ly-do">{{ m.lyDo }}</div>
                    </template>
                    <div v-if="dangXuLy(m.id) && ketQuaCua(m.id)?.noiDung" class="hd-gui-lai" role="status">
                      <v-icon size="14" icon="mdi-wifi-alert" aria-hidden="true" />{{ ketQuaCua(m.id)?.noiDung }}
                    </div>
                    <div
                      v-if="thongBaoCua(m.id)"
                      class="hd-ket-qua-loi"
                      :class="`hd-ket-qua-loi--${thongBaoCua(m.id)!.mau}`"
                      role="alert"
                    >
                      <span class="hd-chip" :class="thongBaoCua(m.id)!.mau === 'vang' ? 'hd-chip--vang' : 'hd-chip--do'">
                        <v-icon size="14" :icon="thongBaoCua(m.id)!.mau === 'vang' ? 'mdi-help-circle-outline' : 'mdi-close-octagon-outline'" aria-hidden="true" />{{ thongBaoCua(m.id)!.nhan }}
                      </span>
                      <p class="hd-ket-qua-chu">{{ thongBaoCua(m.id)!.noiDung }}</p>
                      <button type="button" class="hd-link" @click="anKetQua(m.id)">Ẩn thông báo</button>
                    </div>
                  </template>
                </td>
                <td class="hd-c-tu">
                  <span class="hd-nhan-hep">Chờ từ </span>
                  <span class="hd-gio">{{ choTu(m, bayGio).gio }}</span>
                  <span class="hd-tuong-doi">{{ choTu(m, bayGio).tuongDoi }}</span>
                </td>
                <td class="hd-c-hanh-dong">
                  <span v-if="ketQuaCua(m.id)?.loai === 'dang_huy'" class="hd-dang" role="status">
                    <v-progress-circular indeterminate size="14" width="2" color="error" />Đang huỷ…
                  </span>
                  <span v-else-if="ketQuaCua(m.id)?.loai === 'dang_bo'" class="hd-dang" role="status">
                    <v-progress-circular indeterminate size="14" width="2" color="primary" />Đang bỏ…
                  </span>
                  <span v-else-if="laBanGiu(m.id) || ketQuaCua(m.id)?.loai === 'da_huy' || ketQuaCua(m.id)?.loai === 'da_bo'" aria-hidden="true" />
                  <template v-else-if="nhom.khoa === 'cho_in'">
                    <v-btn
                      v-if="m.huy === 'chac_chan'"
                      class="hd-nut-huy"
                      size="small"
                      variant="tonal"
                      color="error"
                      :disabled="banThaoTac"
                      :aria-label="`Huỷ lệnh in ${m.soHoaDon}`"
                      @click="moHopHuy([m.id])"
                    >Huỷ</v-btn>
                    <v-btn v-else size="small" variant="text" class="hd-nut-vi-sao" @click="moViSao(m)">Vì sao không huỷ được?</v-btn>
                  </template>
                  <div v-else class="hd-nut-cot">
                    <v-btn size="small" variant="text" class="hd-nut-vi-sao" @click="moViSao(m)">Vì sao không huỷ được?</v-btn>
                    <v-btn size="small" variant="outlined" class="hd-nut-bo" :disabled="banThaoTac" @click="moHopBo(m)">Bỏ khỏi hàng đợi</v-btn>
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
          <p v-else-if="nhom.khoa === 'cho_in' && nhom.ds.length === 0" class="hd-nhom-rong">Không có lệnh nào đang chờ in.</p>
        </section>
      </template>

      <!-- Hộp xác nhận huỷ — nút "Huỷ lệnh in" / "Giữ lại" (§8.10: không dùng chữ "Huỷ" trơn).
           Liệt kê ĐÚNG những gì sẽ huỷ; nhiều hơn 6 thì có nút mở đủ danh sách. -->
      <v-dialog :model-value="!!hopHuy" max-width="480" theme="hsLight" @update:model-value="(v: boolean) => { if (!v) hopHuy = null; }">
        <v-card v-if="hopHuy" class="pa-dlg airtable-scope hd-dlg" theme="hsLight" rounded="lg">
          <div class="hd-dlg-dau">
            <div class="hd-dlg-ico hd-dlg-ico--do" aria-hidden="true"><v-icon size="18" icon="mdi-cancel" /></div>
            <div>
              <div class="hd-dlg-tieu-de">{{ hopHuy.cau.tieuDe }}</div>
              <div class="hd-dlg-phu">Chỉ huỷ lệnh còn đang chờ — lệnh đã xuống máy in sẽ báo "Không huỷ được".</div>
            </div>
          </div>
          <v-card-text class="hd-dlg-than">
            <p class="hd-dlg-chinh">{{ hopHuy.cau.noiDung }}</p>
            <template v-if="hopHuy.cau.conLai > 0">
              <ul class="hd-dlg-ds" aria-label="Các hoá đơn sẽ bị huỷ">
                <li v-for="so in hopHuy.moDs ? hopHuy.cacSo : hopHuy.cau.hienNgay" :key="so">{{ so }}</li>
              </ul>
              <button type="button" class="hd-link hd-dlg-mo-ds" :aria-expanded="hopHuy.moDs" @click="hopHuy.moDs = !hopHuy.moDs">
                {{ hopHuy.moDs ? 'Thu gọn danh sách' : `Xem đủ danh sách (${hopHuy.cacSo.length} hoá đơn)` }}
              </button>
            </template>
          </v-card-text>
          <v-card-actions class="hd-dlg-chan">
            <v-spacer />
            <v-btn variant="text" class="hd-nut-giu" @click="hopHuy = null">Giữ lại</v-btn>
            <v-btn color="error" variant="flat" class="hd-nut-xac-nhan-huy" @click="xacNhanHuy">Huỷ lệnh in</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <!-- Vì sao không huỷ được? -->
      <v-dialog :model-value="!!hopViSao" max-width="520" theme="hsLight" @update:model-value="(v: boolean) => { if (!v) hopViSao = null; }">
        <v-card v-if="hopViSao" class="pa-dlg airtable-scope hd-dlg" theme="hsLight" rounded="lg">
          <div class="hd-dlg-dau">
            <div class="hd-dlg-ico" aria-hidden="true"><v-icon size="18" icon="mdi-help-circle-outline" /></div>
            <div>
              <div class="hd-dlg-tieu-de">Vì sao không huỷ được {{ hopViSao.soHoaDon }}?</div>
              <div class="hd-dlg-phu">{{ chipTrangThaiHangDoi(hopViSao).chu }} · {{ hopViSao.lyDo }}</div>
            </div>
          </div>
          <v-card-text class="hd-dlg-than">
            <p class="hd-dlg-chinh hd-vi-sao-chu">{{ lyDoKhongHuy(hopViSao) }}</p>
          </v-card-text>
          <v-card-actions class="hd-dlg-chan">
            <v-spacer />
            <v-btn color="primary" variant="flat" @click="hopViSao = null">Đã hiểu</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <!-- Bỏ khỏi hàng đợi — nói rõ KHÔNG chặn việc in (§8.5) -->
      <v-dialog :model-value="!!hopBo" max-width="520" theme="hsLight" @update:model-value="(v: boolean) => { if (!v) hopBo = null; }">
        <v-card v-if="hopBo" class="pa-dlg airtable-scope hd-dlg" theme="hsLight" rounded="lg">
          <div class="hd-dlg-dau">
            <div class="hd-dlg-ico hd-dlg-ico--vang" aria-hidden="true"><v-icon size="18" icon="mdi-eye-off-outline" /></div>
            <div>
              <div class="hd-dlg-tieu-de">Bỏ {{ hopBo.soHoaDon }} khỏi hàng đợi?</div>
              <div class="hd-dlg-phu">Đây KHÔNG phải huỷ lệnh in.</div>
            </div>
          </div>
          <v-card-text class="hd-dlg-than">
            <p class="hd-dlg-chinh hd-bo-chu">{{ CAU_BO_THEO_DOI }}</p>
          </v-card-text>
          <v-card-actions class="hd-dlg-chan">
            <v-spacer />
            <v-btn variant="text" class="hd-nut-giu" @click="hopBo = null">Giữ lại</v-btn>
            <v-btn color="primary" variant="flat" class="hd-nut-xac-nhan-bo" @click="xacNhanBo">Bỏ khỏi hàng đợi</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-theme-provider>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useToast } from '@/composables/use-toast';
import {
  huyLenhIn, boTheoDoiLenhIn,
  type HangDoiIn, type KetQuaHuy, type MayIn, type MucHangDoi,
} from '@/api/print-agents';
import {
  chipTrangThaiHangDoi, lyDoKhongHuy, choTu, tomTatHuy, cauXacNhanHuy, khoaMay, chiaLo, phanLoaiLoiGoi,
  cauTuChoi, thongBaoConDung, CAU_BO_THEO_DOI, CAU_CHUA_RO_HUY, CAU_CHUA_RO_BO, TRE_GUI_LAI_MS,
} from './may-in-hang-doi';

const props = withDefaults(defineProps<{
  /** Snapshot trang cha nạp; null = chưa tải lần nào. */
  hangDoi: HangDoiIn | null;
  mayIns: MayIn[];
  /** false khi thẻ không được chọn — nghỉ tự làm mới. */
  hoatDong?: boolean;
  dangTai?: boolean;
  loi?: string;
  /** Lọc sẵn một máy (bấm chip "N đang chờ" trên thẻ máy); `lan` đổi = áp lại. */
  locMay?: { mayInId: string | null; lan: number } | null;
}>(), { hoatDong: true, dangTai: false, loi: '', locMay: null });

const emit = defineEmits<{
  /** Xin trang cha nạp lại hàng đợi. `ngam` = nhịp tự làm mới (lỗi 5xx không toast). */
  taiLai: [tuy: { ngam: boolean }];
  /** true = đang mở hộp xác nhận / đang huỷ-bỏ → trang cha dừng MỌI nhịp nạp ngầm hàng đợi. */
  tamDung: [dung: boolean];
}>();

const toast = useToast();
const TAT_CA = '__tat_ca__';
const NHIP_TU_LAM_MOI_MS = 5_000;
/** "Đã huỷ ✓" / "Đã bỏ khỏi hàng đợi" hiện chừng này rồi dòng rời danh sách. */
const MS_HIEN_KET_QUA = 3_000;
const SO_LAN_GUI = TRE_GUI_LAI_MS.length + 1;

// ── Lọc máy — đổi máy thì BỎ lựa chọn (không huỷ dòng không nhìn thấy) ──────
const mayInId = ref<string>(TAT_CA);
const luaChonMayIn = computed(() => [
  { title: 'Tất cả máy in', value: TAT_CA },
  ...props.mayIns.map((m) => ({ title: m.ten, value: m.id })),
]);
watch(
  () => props.locMay?.lan,
  () => {
    if (props.locMay) mayInId.value = props.locMay.mayInId ?? TAT_CA;
  },
  { immediate: true },
);
watch(
  () => props.mayIns,
  (ds) => {
    if (mayInId.value !== TAT_CA && !ds.some((m) => m.id === mayInId.value)) mayInId.value = TAT_CA;
  },
);
watch(mayInId, () => {
  chon.value = new Set();
});

// ── Kết quả từng dòng (chỉ ở giao diện) ────────────────────────────────────
type LoaiKetQua =
  | 'dang_huy' | 'da_huy' | 'khong_huy'
  | 'dang_bo' | 'da_bo' | 'khong_bo'
  /** Máy chủ TỪ CHỐI cả yêu cầu (4xx) — chắc chắn chưa đổi gì. */
  | 'tu_choi'
  /** Hết lượt gửi lại mà không có câu trả lời — KHÔNG biết. */
  | 'chua_ro';
interface KetQuaDong {
  loai: LoaiKetQua;
  viec?: 'huy' | 'bo';
  noiDung?: string;
  /** Trạng thái lệnh mà thông báo này mô tả — trạng thái đổi thì thông báo bị bỏ (thongBaoConDung). */
  trangThai?: string | null;
}
const ketQua = ref(new Map<string, KetQuaDong>());
/**
 * Bản sao dòng lấy LÚC BẤM (trước mọi lần nạp lại): dòng đang huỷ / vừa có kết quả vẫn hiện đúng
 * chỗ dù snapshot mới không còn nó — không phụ thuộc thứ tự nạp lại, và KHÔNG để "biến mất" bị
 * hiểu là "đã huỷ". Bỏ khi hết 3 s hiện kết quả ok, hoặc khi thông báo của dòng bị bỏ/ẩn.
 */
const giuLai = ref(new Map<string, MucHangDoi>());
/** Dòng đã rời danh sách (hết 3 s "Đã huỷ ✓") — ẩn kể cả khi snapshot cũ còn mang nó. */
const daRoi = ref(new Set<string>());
const dangHuy = ref(0);
const dangBo = ref(0);
const henGio = new Set<ReturnType<typeof setTimeout>>();
const choNgu = new Set<() => void>();
let daRoiTrang = false;

function datKetQua(id: string, kq: KetQuaDong | null): void {
  const m = new Map(ketQua.value);
  if (kq) m.set(id, kq);
  else m.delete(id);
  ketQua.value = m;
}
function boGiuLai(id: string): void {
  if (!giuLai.value.has(id)) return;
  const g = new Map(giuLai.value);
  g.delete(id);
  giuLai.value = g;
}
const ketQuaCua = (id: string): KetQuaDong | undefined => ketQua.value.get(id);
const dangXuLy = (id: string): boolean => {
  const l = ketQua.value.get(id)?.loai;
  return l === 'dang_huy' || l === 'dang_bo';
};

/** Thông báo đang hiện trên dòng: đỏ = chắc chắn KHÔNG làm được; vàng = chưa rõ. */
function thongBaoCua(id: string): { nhan: string; noiDung: string; mau: 'do' | 'vang' } | null {
  const k = ketQua.value.get(id);
  if (!k) return null;
  const noiDung = k.noiDung ?? '';
  if (k.loai === 'khong_huy') return { nhan: 'Không huỷ được', noiDung, mau: 'do' };
  if (k.loai === 'khong_bo') return { nhan: 'Không bỏ được', noiDung, mau: 'do' };
  if (k.loai === 'tu_choi') return { nhan: k.viec === 'bo' ? 'Chưa bỏ — máy chủ từ chối' : 'Chưa huỷ — máy chủ từ chối', noiDung, mau: 'do' };
  if (k.loai === 'chua_ro') return { nhan: 'Chưa rõ kết quả', noiDung, mau: 'vang' };
  return null;
}
function anKetQua(id: string): void {
  datKetQua(id, null);
  boGiuLai(id);
}

function hen(fn: () => void, ms: number): void {
  const h = setTimeout(() => {
    henGio.delete(h);
    fn();
  }, ms);
  henGio.add(h);
}
function ngu(ms: number): Promise<void> {
  return new Promise((xong) => {
    const tha = (): void => {
      choNgu.delete(tha);
      xong();
    };
    choNgu.add(tha);
    hen(tha, ms);
  });
}

// ── Danh sách hiện ────────────────────────────────────────────────────────
const theoMay = (m: MucHangDoi): boolean => mayInId.value === TAT_CA || m.mayInId === mayInId.value;
const idTrongSnapshot = computed(() => new Set([...(props.hangDoi?.choIn ?? []), ...(props.hangDoi?.chuaXacNhan ?? [])].map((m) => m.id)));
/** Dòng đang hiện từ BẢN SAO (máy chủ không còn trả lệnh này trong hàng đợi). */
const laBanGiu = (id: string): boolean => !idTrongSnapshot.value.has(id) && giuLai.value.has(id);

/** Snapshot của nhóm + bản sao đang giữ (vào đúng chỗ theo lúc tạo — thứ tự máy chủ). */
function dsNhom(tuMayChu: readonly MucHangDoi[], nhom: MucHangDoi['nhom']): MucHangDoi[] {
  const bu = [...giuLai.value.values()].filter((m) => m.nhom === nhom && !idTrongSnapshot.value.has(m.id));
  const ds = bu.length ? [...tuMayChu, ...bu].sort((a, b) => (a.tao < b.tao ? -1 : a.tao > b.tao ? 1 : 0)) : [...tuMayChu];
  return ds.filter((m) => theoMay(m) && !daRoi.value.has(m.id));
}
const dsChoIn = computed(() => dsNhom(props.hangDoi?.choIn ?? [], 'cho_in'));
const dsChuaXacNhan = computed(() => dsNhom(props.hangDoi?.chuaXacNhan ?? [], 'chua_xac_nhan'));

/** Nhóm "Chưa xác nhận": thu gọn sẵn khi có lệnh chờ in; người dùng mở/đóng thì nhớ. */
const moChuaXacNhan = ref<boolean | null>(null);
const moNhomChuaXacNhan = computed(() => moChuaXacNhan.value ?? dsChoIn.value.length === 0);
/**
 * Dòng trong nhóm "Chưa xác nhận" vừa có kết quả / đang xử lý (vd huỷ không được vì lệnh đã
 * xuống máy in, dòng chuyển sang nhóm này) → TỰ MỞ nhóm: toast bảo "xem từng dòng" thì dòng phải thấy được.
 */
const idCoKetQuaNhom2 = computed(() => dsChuaXacNhan.value.filter((m) => ketQua.value.has(m.id)).map((m) => m.id));
watch(idCoKetQuaNhom2, (moi, cu) => {
  const daCo = new Set(cu ?? []);
  if (moi.some((id) => !daCo.has(id))) moChuaXacNhan.value = true;
});

const cacNhom = computed(() => [
  { khoa: 'cho_in' as const, ds: dsChoIn.value, mo: true },
  ...(dsChuaXacNhan.value.length ? [{ khoa: 'chua_xac_nhan' as const, ds: dsChuaXacNhan.value, mo: moNhomChuaXacNhan.value }] : []),
]);

const dongTrangThai = computed(() => {
  if (!props.hangDoi) return props.dangTai ? 'Đang tải…' : '';
  const n = dsChoIn.value.length;
  const k = dsChuaXacNhan.value.length;
  return `${n} đang chờ${k ? ` · ${k} chưa xác nhận` : ''}`;
});

function lopDong(m: MucHangDoi): Record<string, boolean> {
  const k = ketQua.value.get(m.id)?.loai;
  return {
    'hd-dong--tam-giu': m.tamGiu && !laBanGiu(m.id),
    'hd-dong--dang': k === 'dang_huy' || k === 'dang_bo',
    'hd-dong--da-huy': k === 'da_huy',
    'hd-dong--da-bo': k === 'da_bo',
    'hd-dong--loi': k === 'khong_huy' || k === 'khong_bo' || k === 'tu_choi',
    'hd-dong--chua-ro': k === 'chua_ro',
    'hd-dong--giu': laBanGiu(m.id),
  };
}

// ── Chọn nhiều ────────────────────────────────────────────────────────────
const chon = ref(new Set<string>());
/** Dòng huỷ CHẮC CHẮN được, đang hiện từ snapshot, không có thao tác đang/đã xong. */
function coTheHuy(m: MucHangDoi): boolean {
  const k = ketQua.value.get(m.id)?.loai;
  return m.huy === 'chac_chan' && m.nhom === 'cho_in' && !laBanGiu(m.id) && k !== 'dang_huy' && k !== 'da_huy';
}
const dsHuyDuoc = computed(() => dsChoIn.value.filter(coTheHuy));
const daChonHet = computed(() => dsHuyDuoc.value.length > 0 && dsHuyDuoc.value.every((m) => chon.value.has(m.id)));

function doiChon(id: string): void {
  const s = new Set(chon.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  chon.value = s;
}
function doiChonTatCa(): void {
  chon.value = daChonHet.value ? new Set() : new Set(dsHuyDuoc.value.map((m) => m.id));
}
function boChon(): void {
  chon.value = new Set();
}

/** "Chọn tất cả của máy X" — mỗi máy có ít nhất một lệnh huỷ được một nút. */
const nhomChonTheoMay = computed(() => {
  const nhom = new Map<string, { khoa: string; ten: string; soLuong: number }>();
  for (const m of dsHuyDuoc.value) {
    const k = khoaMay(m);
    const g = nhom.get(k) ?? { khoa: k, ten: m.mayInTen || 'máy không rõ tên', soLuong: 0 };
    g.soLuong += 1;
    nhom.set(k, g);
  }
  return [...nhom.values()];
});
function chonTatCaCuaMay(khoa: string): void {
  chon.value = new Set([...chon.value, ...dsHuyDuoc.value.filter((m) => khoaMay(m) === khoa).map((m) => m.id)]);
}

// ── Gửi có gửi lại ────────────────────────────────────────────────────────
type KetQuaGoi<T> = { loai: 'ok'; kq: T } | { loai: 'tu_choi'; ma: number } | { loai: 'chua_ro' };

/**
 * Gọi `goi`; không có câu trả lời (mất mạng, hết giờ, 5xx) → gửi lại ĐÚNG yêu cầu đó sau
 * TRE_GUI_LAI_MS (1 s, 2 s, 4 s). An toàn vì huỷ / bỏ theo dõi lặp là idempotent ở máy chủ.
 * 4xx → `tu_choi` ngay (máy chủ đã trả lời: không đổi gì).
 */
async function goiCoGuiLai<T>(goi: () => Promise<T>, khiGuiLai: (lan: number) => void): Promise<KetQuaGoi<T>> {
  for (let lan = 0; ; lan++) {
    try {
      return { loai: 'ok', kq: await goi() };
    } catch (e) {
      const pl = phanLoaiLoiGoi(e);
      if (pl.loai === 'tu_choi') return pl;
      if (lan >= TRE_GUI_LAI_MS.length || daRoiTrang) return { loai: 'chua_ro' };
      khiGuiLai(lan + 2);
      await ngu(TRE_GUI_LAI_MS[lan]);
      if (daRoiTrang) return { loai: 'chua_ro' };
    }
  }
}

/** Giữ bản sao các dòng (lấy từ những gì người dùng ĐANG thấy) + đánh dấu đang xử lý. */
function batDauXuLy(ids: string[], loai: 'dang_huy' | 'dang_bo'): void {
  const g = new Map(giuLai.value);
  for (const id of ids) {
    const m = mucDangHien(id);
    if (m) g.set(id, { ...m });
  }
  giuLai.value = g;
  for (const id of ids) datKetQua(id, { loai });
}

/** Kết quả ok (đã huỷ / đã bỏ) — hiện 3 giây trên bản sao rồi dòng rời danh sách. */
function thanhCong(id: string, loai: 'da_huy' | 'da_bo', noiDung: string): void {
  datKetQua(id, { loai, noiDung });
  hen(() => {
    daRoi.value = new Set([...daRoi.value, id]);
    boGiuLai(id);
    datKetQua(id, null);
  }, MS_HIEN_KET_QUA);
}

function mucDangHien(id: string): MucHangDoi | undefined {
  return [...dsChoIn.value, ...dsChuaXacNhan.value].find((m) => m.id === id);
}

// ── Huỷ ───────────────────────────────────────────────────────────────────
const hopHuy = ref<{ ids: string[]; cacSo: string[]; cau: ReturnType<typeof cauXacNhanHuy>; moDs: boolean } | null>(null);

function moHopHuy(ids: string[]): void {
  // CHỈ dòng đang hiện và huỷ được — hộp xác nhận liệt kê đúng những gì sẽ gửi.
  const cac = dsHuyDuoc.value.filter((m) => ids.includes(m.id));
  if (cac.length === 0) return;
  const cacSo = cac.map((m) => m.soHoaDon);
  hopHuy.value = { ids: cac.map((m) => m.id), cacSo, cau: cauXacNhanHuy(cacSo), moDs: false };
}

async function xacNhanHuy(): Promise<void> {
  const ids = hopHuy.value?.ids ?? [];
  hopHuy.value = null;
  if (ids.length === 0) return;
  batDauXuLy(ids, 'dang_huy');
  chon.value = new Set([...chon.value].filter((id) => !ids.includes(id)));
  dangHuy.value += 1;
  const tuMayChu: KetQuaHuy[] = [];
  let tuChoi = 0;
  let chuaRo = 0;
  try {
    for (const lo of chiaLo(ids)) {
      const r = await goiCoGuiLai(() => huyLenhIn(lo), (lan) => {
        for (const id of lo) {
          datKetQua(id, { loai: 'dang_huy', noiDung: `Mất liên lạc máy chủ — đang gửi lại yêu cầu huỷ (lần ${lan}/${SO_LAN_GUI})…` });
        }
      });
      if (r.loai === 'ok') {
        for (const id of lo) {
          const k = r.kq.find((x) => x.id === id);
          if (!k) {
            datKetQua(id, { loai: 'chua_ro', viec: 'huy', noiDung: CAU_CHUA_RO_HUY });
            chuaRo += 1;
            continue;
          }
          tuMayChu.push(k);
          if (k.ok) {
            thanhCong(id, 'da_huy', k.cach === 'da_huy_truoc'
              ? 'Đã được huỷ trước đó — hoá đơn chắc chắn không in'
              : 'Hoá đơn chắc chắn không in');
          } else {
            datKetQua(id, { loai: 'khong_huy', viec: 'huy', noiDung: k.noiDung, trangThai: k.trangThaiMoi });
          }
        }
      } else if (r.loai === 'tu_choi') {
        for (const id of lo) {
          datKetQua(id, { loai: 'tu_choi', viec: 'huy', noiDung: cauTuChoi(r.ma, 'huy'), trangThai: giuLai.value.get(id)?.trangThai ?? null });
        }
        tuChoi += lo.length;
      } else {
        for (const id of lo) datKetQua(id, { loai: 'chua_ro', viec: 'huy', noiDung: CAU_CHUA_RO_HUY });
        chuaRo += lo.length;
      }
    }
    if (!daRoiTrang) {
      const tt = tomTatHuy(tuMayChu, { tuChoi, chuaRo });
      toast[tt.loai](tt.chu);
    }
  } finally {
    dangHuy.value -= 1;
    if (!daRoiTrang) emit('taiLai', { ngam: false });
  }
}

// ── Vì sao không huỷ được / Bỏ khỏi hàng đợi ──────────────────────────────
const hopViSao = ref<MucHangDoi | null>(null);
const moViSao = (m: MucHangDoi): void => {
  hopViSao.value = m;
};

const hopBo = ref<MucHangDoi | null>(null);
const moHopBo = (m: MucHangDoi): void => {
  hopBo.value = m;
};

async function xacNhanBo(): Promise<void> {
  const m = hopBo.value;
  hopBo.value = null;
  if (!m) return;
  batDauXuLy([m.id], 'dang_bo');
  dangBo.value += 1;
  try {
    // Một id (giao diện bỏ từng dòng) — vẫn đi qua chia lô cho cùng đường với huỷ.
    for (const lo of chiaLo([m.id])) {
      const r = await goiCoGuiLai(() => boTheoDoiLenhIn(lo), (lan) => {
        datKetQua(m.id, { loai: 'dang_bo', noiDung: `Mất liên lạc máy chủ — đang gửi lại (lần ${lan}/${SO_LAN_GUI})…` });
      });
      if (r.loai === 'ok') {
        const kq = r.kq.find((x) => x.id === m.id);
        if (kq?.ok) {
          // KHÔNG BAO GIỜ "đã huỷ": bỏ theo dõi không chặn việc in.
          thanhCong(m.id, 'da_bo', 'Hệ thống KHÔNG biết hoá đơn đã in hay chưa — kiểm khay giấy trước khi in lại');
          toast.success(`Đã bỏ ${m.soHoaDon} khỏi hàng đợi — hệ thống không biết đã in hay chưa`);
        } else if (kq) {
          // Câu máy chủ mô tả lệnh đã KHÔNG còn "chưa xác nhận" → giữ tới khi lệnh quay lại hàng đợi.
          datKetQua(m.id, { loai: 'khong_bo', viec: 'bo', noiDung: kq.noiDung, trangThai: null });
          toast.error(`Không bỏ được ${m.soHoaDon} khỏi hàng đợi — xem lý do ở dòng`);
        } else {
          datKetQua(m.id, { loai: 'chua_ro', viec: 'bo', noiDung: CAU_CHUA_RO_BO });
          toast.error(`Chưa rõ đã bỏ ${m.soHoaDon} khỏi hàng đợi chưa — xem dòng`);
        }
      } else if (r.loai === 'tu_choi') {
        datKetQua(m.id, { loai: 'tu_choi', viec: 'bo', noiDung: cauTuChoi(r.ma, 'bo'), trangThai: m.trangThai });
        toast.error(`Chưa bỏ ${m.soHoaDon} khỏi hàng đợi — máy chủ từ chối yêu cầu (xem dòng)`);
      } else {
        datKetQua(m.id, { loai: 'chua_ro', viec: 'bo', noiDung: CAU_CHUA_RO_BO });
        toast.error(`Chưa rõ đã bỏ ${m.soHoaDon} khỏi hàng đợi chưa — không liên lạc được máy chủ (xem dòng)`);
      }
    }
  } finally {
    dangBo.value -= 1;
    if (!daRoiTrang) emit('taiLai', { ngam: false });
  }
}

// ── Snapshot mới: dọn lựa chọn, dòng đã rời, thông báo HẾT ĐÚNG ──────────────
const bayGio = ref(Date.now());
watch(
  () => props.hangDoi,
  (hd) => {
    bayGio.value = Date.now();
    if (!hd) return;
    const hienTai = new Map([...hd.choIn, ...hd.chuaXacNhan].map((m) => [m.id, m.trangThai] as const));
    const huyDuoc = new Set(hd.choIn.filter((m) => m.huy === 'chac_chan').map((m) => m.id));
    chon.value = new Set([...chon.value].filter((id) => huyDuoc.has(id)));
    daRoi.value = new Set([...daRoi.value].filter((id) => hienTai.has(id)));
    for (const [id, k] of ketQua.value) {
      // Thông báo lỗi mô tả một trạng thái; trạng thái đổi → thông báo sai sự thật → bỏ (cùng bản sao).
      // "Chưa rõ" giữ tới khi người dùng ẩn; đang xử lý / đã xong có đường riêng.
      if ((k.loai === 'khong_huy' || k.loai === 'khong_bo' || k.loai === 'tu_choi') && !thongBaoConDung(k.trangThai, hienTai.get(id))) {
        anKetQua(id);
      }
    }
  },
);

// ── Tự làm mới 5 giây + tạm dừng ──────────────────────────────────────────
const coHopMo = computed(() => !!hopHuy.value || !!hopViSao.value || !!hopBo.value);
/** Đang huỷ / bỏ — khoá nút, và nghỉ nạp lại để danh sách không đổi dưới tay. */
const banThaoTac = computed(() => dangHuy.value > 0 || dangBo.value > 0);
const tamDung = computed(() => coHopMo.value || banThaoTac.value);
watch(tamDung, (d) => emit('tamDung', d));
let henGioLamMoi: ReturnType<typeof setInterval> | null = null;

function xinTaiLai(ngam: boolean): void {
  emit('taiLai', { ngam });
}

function nhipLamMoi(): void {
  bayGio.value = Date.now();
  if (!props.hoatDong || document.hidden || tamDung.value) return;
  xinTaiLai(true);
}

// Thẻ vừa mở (lần đầu hay quay lại): lấy ngay phần đã lỡ, không bắt chờ nhịp 5 giây.
watch(
  () => props.hoatDong,
  (hd) => {
    if (hd && !tamDung.value) xinTaiLai(true);
  },
  { immediate: true },
);

onMounted(() => {
  henGioLamMoi = setInterval(nhipLamMoi, NHIP_TU_LAM_MOI_MS);
});

onBeforeUnmount(() => {
  daRoiTrang = true;
  if (henGioLamMoi) clearInterval(henGioLamMoi);
  henGioLamMoi = null;
  for (const h of henGio) clearTimeout(h);
  henGio.clear();
  for (const tha of [...choNgu]) tha(); // lượt gửi lại đang chờ: thoát ngay (không gửi thêm)
  if (tamDung.value) emit('tamDung', false);
});
</script>

<style scoped>
/* Cùng bộ token Atlas với trang Máy in (.airtable-scope); giá trị dự phòng nếu gắn chỗ khác.
   Màu nền/chữ đặt TƯỜNG MINH (không dựa vào theme Vuetify): MobileLayout mặc định theme tối. */
.hd-card {
  container-type: inline-size; container-name: hang-doi;
  background: var(--at-canvas, #fff); color: var(--at-body, #475066);
  border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 12px;
  box-shadow: var(--at-shadow-card, 0 1px 2px rgba(20, 26, 36, 0.05)); overflow: hidden;
}
.hd-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px 8px;
}
.hd-may-chon { flex: 0 1 260px; min-width: 190px; }
.hd-toolbar :deep(.v-field) { border-radius: 8px; font-size: 13px; }
.hd-toolbar :deep(.v-field__input) { font-size: 13px; }
.hd-toolbar-phai { display: flex; align-items: center; gap: 4px 10px; }
.hd-dem { font-size: 12px; color: var(--at-muted, #6b7488); font-variant-numeric: tabular-nums; }

.hd-chon-nhieu {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; padding: 0 14px 12px;
}
.hd-pill {
  display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 3px 11px;
  border-radius: 9999px; border: 1px solid var(--at-hairline, #e7eaf0); background: var(--at-canvas, #fff);
  font: inherit; font-size: 12.5px; font-weight: 500; color: var(--at-body, #475066); cursor: pointer;
  transition: background 0.12s, border-color 0.12s; text-align: left;
}
.hd-pill:hover:not(:disabled) { background: var(--at-surface-soft, #f1f4f9); }
.hd-pill:disabled { opacity: 0.55; cursor: default; }
.hd-pill:focus-visible { outline: 2px solid var(--at-action, #1786be); outline-offset: 2px; }
.hd-da-chon { font-size: 12.5px; font-weight: 600; color: var(--at-ink, #141a24); margin-left: 4px; }

.hd-loi { margin: 0 14px 12px; }

/* Nhóm */
.hd-nhom { border-top: 1px solid var(--at-hairline, #e7eaf0); }
.hd-nhom-dau {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 12px; padding: 12px 14px 8px;
}
.hd-nhom-tieu-de, .hd-nhom-nut {
  display: inline-flex; align-items: center; gap: 6px; margin: 0;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--at-ink, #141a24);
}
.hd-nhom-nut { border: 0; background: transparent; padding: 0; cursor: pointer; }
.hd-nhom-nut:focus-visible { outline: 2px solid var(--at-action, #1786be); outline-offset: 2px; border-radius: 4px; }
.hd-nhom-phu { font-size: 12px; color: var(--at-muted, #6b7488); }
.hd-so-dem {
  font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 9999px;
  background: var(--at-surface-soft, #f1f4f9); color: var(--at-muted, #6b7488);
}
.hd-so-dem--vang { background: var(--at-atlas-warning-soft, #fdf3e2); color: #92400e; }
.hd-nhom-rong { font-size: 12.5px; color: var(--at-muted, #6b7488); margin: 0; padding: 0 14px 14px; }

/* Bảng (khung rộng) */
.hd-bang { background: transparent !important; color: inherit !important; }
.hd-bang :deep(table) { table-layout: auto; }
.hd-bang :deep(th) {
  white-space: nowrap; height: 34px !important;
  font-size: 11px !important; font-weight: 600 !important; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--at-muted, #6b7488) !important; background: #fafbfd;
}
.hd-bang :deep(td) {
  font-size: 13px; color: var(--at-body, #475066); vertical-align: top; background: var(--at-canvas, #fff);
  padding-top: 9px !important; padding-bottom: 9px !important; height: auto !important;
  border-bottom-color: var(--at-hairline, #e7eaf0) !important;
}
.hd-dong { transition: background 0.2s, opacity 0.2s; }
.hd-dong:hover td { background: #f7f9fc; }
/* Vạch mép trái theo tình trạng dòng */
.hd-dong > td:first-child { box-shadow: inset 3px 0 0 transparent; }
.hd-dong--tam-giu > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-warning, #f5a524); }
.hd-dong--loi > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-danger, #f04438); }
.hd-dong--chua-ro > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-warning, #f5a524); }
.hd-dong--dang td { opacity: 0.8; }
.hd-dong--da-huy td { background: var(--at-atlas-success-soft, #e7f7ef) !important; }
.hd-dong--da-huy > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-success, #12b76a); }
.hd-dong--da-bo td, .hd-dong--giu td { background: #fafbfd !important; }

.hd-c-chon { width: 1%; padding-right: 0 !important; }
.hd-o-chon { width: 16px; height: 16px; margin-top: 2px; accent-color: var(--at-action, #1786be); cursor: pointer; }
.hd-o-chon:disabled { cursor: default; }
.hd-c-may { white-space: nowrap; }
.hd-c-tu { white-space: nowrap; width: 1%; }
.hd-c-tu .hd-gio, .hd-c-tu .hd-tuong-doi { display: block; }
.hd-c-hanh-dong { width: 1%; white-space: nowrap; text-align: right; }
.hd-c-trang-thai { min-width: 240px; }
.hd-nhan-hep { display: none; }
.hd-so {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 12.5px;
  color: var(--at-ink, #141a24); white-space: nowrap; font-weight: 600;
}
.hd-khach { font-size: 12px; color: var(--at-muted, #6b7488); margin-top: 1px; }
.hd-gio { font-variant-numeric: tabular-nums; color: var(--at-ink, #141a24); font-size: 12.5px; }
.hd-tuong-doi { font-size: 11.5px; color: var(--at-muted, #6b7488); margin-top: 1px; }
.hd-ly-do { font-size: 12px; color: var(--at-body, #475066); margin-top: 4px; line-height: 1.45; }
.hd-gui-lai {
  display: flex; align-items: center; gap: 5px; margin-top: 5px;
  font-size: 12px; font-weight: 600; color: #92400e;
}

.hd-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 9999px;
  font-size: 11.5px; font-weight: 600; line-height: 1.6; white-space: nowrap;
  background: var(--at-surface-soft, #f1f4f9); color: var(--at-body, #475066); border: 1px solid var(--at-hairline, #e7eaf0);
}
.hd-chip--cam { background: var(--at-atlas-warning-soft, #fdf3e2); color: #92400e; border-color: #fcd34d; }
.hd-chip--vang { background: var(--at-atlas-warning-soft, #fdf3e2); color: #92400e; border-color: #fde68a; }
.hd-chip--xanh { background: var(--at-action-soft, #e4f1f8); color: var(--at-action, #1786be); border-color: #bfdbfe; }
.hd-chip--xanh-la { background: var(--at-atlas-success-soft, #e7f7ef); color: #1b6b46; border-color: #86efac; }
.hd-chip--do { background: var(--at-atlas-danger-soft, #fdeceb); color: #b42318; border-color: #fca5a5; }
.hd-chip--xam { background: var(--at-surface-soft, #f1f4f9); color: var(--at-body, #475066); }

.hd-ket-qua-loi {
  margin-top: 6px; padding: 6px 8px; border-radius: 8px;
  background: #fff8f7; border: 1px solid #fecaca; white-space: normal;
}
.hd-ket-qua-loi--vang { background: #fffbeb; border-color: #fde68a; }
.hd-ket-qua-chu { margin: 4px 0 2px; font-size: 12.5px; color: #7a271a; line-height: 1.5; white-space: pre-wrap; }
.hd-ket-qua-loi--vang .hd-ket-qua-chu { color: #78350f; }
.hd-link {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  font: inherit; font-size: 12px; color: var(--at-action, #1786be); text-decoration: underline;
}
.hd-dang { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--at-body, #475066); }
.hd-nut-cot { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.hd-an {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Trống / đang tải */
.hd-rong { text-align: center; color: var(--at-muted, #6b7488); padding: 32px 16px; font-size: 13px; }
.hd-rong-ico {
  width: 40px; height: 40px; border-radius: 10px; margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-atlas-success-soft, #e7f7ef); color: #1b6b46;
}
.hd-rong-chu { font-size: 13.5px; font-weight: 600; color: var(--at-ink, #141a24); }
.hd-rong-phu { font-size: 12.5px; margin-top: 4px; }

/* ── Khung HẸP (điện thoại ~390px): mỗi dòng một thẻ xếp dọc — hoá đơn + khách, máy, trạng
      thái + lý do, giờ, rồi nút hành động một dòng riêng. Không cuộn ngang. ── */
@container hang-doi (max-width: 640px) {
  .hd-bang :deep(.v-table__wrapper) { overflow: visible; }
  .hd-bang :deep(table), .hd-bang tbody { display: block; width: 100%; }
  .hd-bang thead { display: none; }
  .hd-dong {
    display: grid; grid-template-columns: 24px minmax(0, 1fr);
    grid-template-areas: 'chon hd' 'chon may' 'chon tt' 'chon tu' 'hanh hanh';
    column-gap: 8px; row-gap: 4px; padding: 12px 14px 12px 12px;
    border-bottom: 1px solid var(--at-hairline, #e7eaf0); background: var(--at-canvas, #fff);
  }
  .hd-dong > td {
    display: block; min-width: 0; width: auto !important; padding: 0 !important; border: 0 !important;
    white-space: normal; text-align: left; background: transparent !important; box-shadow: none !important;
  }
  .hd-dong--tam-giu, .hd-dong--chua-ro { box-shadow: inset 3px 0 0 var(--at-atlas-warning, #f5a524); }
  .hd-dong--loi { box-shadow: inset 3px 0 0 var(--at-atlas-danger, #f04438); }
  .hd-dong--da-huy { box-shadow: inset 3px 0 0 var(--at-atlas-success, #12b76a); background: var(--at-atlas-success-soft, #e7f7ef); }
  .hd-dong--da-bo, .hd-dong--giu { background: #fafbfd; }
  .hd-c-chon { grid-area: chon; }
  .hd-c-hd { grid-area: hd; }
  .hd-c-may { grid-area: may; font-size: 12px !important; color: var(--at-muted, #6b7488) !important; }
  .hd-c-trang-thai { grid-area: tt; min-width: 0; }
  .hd-c-tu { grid-area: tu; display: flex !important; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; }
  .hd-c-tu .hd-gio, .hd-c-tu .hd-tuong-doi { display: inline; margin: 0; }
  .hd-c-hanh-dong { grid-area: hanh; padding-top: 6px !important; }
  .hd-nhan-hep { display: inline; font-size: 12px; color: var(--at-hint, #97a0b3); }
  .hd-so { white-space: normal; overflow-wrap: anywhere; }
  .hd-chip { white-space: normal; }
  .hd-nut-cot { display: flex; flex-direction: row; flex-wrap: wrap; justify-content: flex-start; }
  .hd-c-hanh-dong :deep(.v-btn) { min-height: 36px; }
  .hd-nut-huy { min-width: 112px; }
  .hd-may-chon { flex: 1 1 100%; min-width: 0; }
  .hd-toolbar-phai { flex: 1 1 100%; justify-content: space-between; }
}

/* Hộp xác nhận — v-dialog dời ra <body>: tự mang màu nền/chữ SÁNG (không dựa theme — MobileLayout tối) */
.hd-dlg { background: #fff !important; color: #475066 !important; }
.hd-dlg-dau { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 4px; }
.hd-dlg-tieu-de { font-size: 16px; font-weight: 700; color: #141a24; line-height: 1.3; overflow-wrap: anywhere; }
.hd-dlg-phu { font-size: 12.5px; color: #6b7488; margin-top: 2px; }
.hd-dlg-than { padding: 14px 24px 6px !important; font-size: 13.5px; color: #475066 !important; }
.hd-dlg-chan { padding: 8px 16px 14px; }
.hd-dlg-ico {
  width: 34px; height: 34px; border-radius: 8px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: #e4f1f8; color: #1786be;
}
.hd-dlg-ico--do { background: #fdeceb; color: #f04438; }
.hd-dlg-ico--vang { background: #fdf3e2; color: #92400e; }
.hd-dlg-chinh { margin: 0; line-height: 1.55; white-space: pre-wrap; color: #141a24; }
.hd-dlg-ds {
  margin: 8px 0 4px; padding-left: 18px; max-height: 220px; overflow: auto;
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 12.5px; color: #141a24;
}
.hd-dlg-mo-ds { margin-top: 2px; }
</style>

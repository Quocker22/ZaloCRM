// SPDX-License-Identifier: AGPL-3.0-or-later
// zca-js GIẢ — đúng HÌNH lời gọi + kết quả của zca-js 2.1.2 (bản ZaloCRM dùng: package-lock `node_modules/zca-js` 2.1.2).
// Nguồn đối chiếu: github.com/RFS-ADRENO/zca-js tag v2.1.2 (bản clone chỉ đọc: sua-ten-file-in/zca-js-goc).
//
//   getUserInfo(userId: string | string[])          src/apis/getUserInfo.ts:25-56
//     • id không có "_" ⇒ thêm "_0" (:30-35) — "_<n>" là PHIÊN BẢN hồ sơ bên gọi đang giữ, KHÔNG phải phạm vi uid.
//     • gửi `friend_pversion_map: ["<uid>_0", …]` (+ phonebook_version, avatar_size, language, show_online_status, imei).
//     • trả `{ changed_profiles: Record<string, User>, unchanged_profiles: Record<string, unknown>, phonebook_version }`
//       (:8-12). `User` = src/models/User.ts:4-35 (userId, username, displayName, zaloName, phoneNumber, globalId, …).
//       Phiên bản "_0" ⇒ mọi hồ sơ là "đổi" ⇒ nằm trong changed_profiles; unchanged_profiles chỉ mang {isFr, isBlocked,
//       lastActionTime, oa_status} (main sau 2.1.2: UnchangedProfileInfo) — KHÔNG có globalId.
//   findUser(phoneNumber)                            src/apis/findUser.ts:19-50
//     • "0…" ⇒ "84…" khi language = "vi" (:21-23); lỗi 216 (không tìm thấy / tắt cho tìm qua SĐT) bị NUỐT ⇒ trả `data`
//       (:45-49). Trả `UserBasic` = User.ts:37-49 { uid, globalId, zalo_name, display_name, … } — `uid` THEO NICK GỌI.
//   getGroupMembersInfo(memberId: string | string[]) src/apis/getGroupMembersInfo.ts:32-45
//     • `friend_pversion_map` y như getUserInfo (thêm "_0" nếu chưa có — :36); KHÔNG imei/language/phonebook_version.
//     • trả `{ profiles: { [memberId]: GroupMemberProfile{ id, displayName, zaloName, avatar, globalId, … } },
//       unchangeds_profile }` (:4-20).
//
// uid THEO NICK: `bang[nick][uid]` — uid lạ với nick đó ⇒ Zalo không trả hồ sơ (đo LIVE staging: VTMT hỏi uid góc Cẩm Loan
// ⇒ rỗng; docs/77 cach-crm-nhan-dien.md §5).

export interface HoSoGia {
  globalId: string;
  zaloName?: string;
  phoneNumber?: string;
  /** Mặc định = uid hỏi (đo LIVE 01/10 qua POST /zalo-user-info/batch: userId = uid hỏi). */
  userId?: string;
}

export interface ZcaGiaOpts {
  /** Khoá của changed_profiles: "uid" (mặc định) hoặc "uid_0" (CRM đọc được cả hai). */
  khoa?: 'uid' | 'uid_0';
  /** nick → globalId trả cho MỌI uid hỏi qua getGroupMembersInfo (dạng LIVE D1: globalId của chính nick gọi). */
  gmiTraGidNickGoi?: Record<string, string>;
  /** nick → uid → hồ sơ ghi đè cho getUserInfo (vd placeholder dùng chung, userId lệch). */
  ghiDe?: Record<string, Record<string, Partial<HoSoGia>>>;
  /** Hồ sơ trả khi hỏi CẢ LÔ (> 1 uid) — hỏi RIÊNG từng uid thì trả đúng `bang` (mô phỏng lô bị Zalo trả nhầm). */
  chiKhiCaLo?: Record<string, Record<string, Partial<HoSoGia>>>;
  /** SĐT (84…) → nick → { uid theo nick, hồ sơ }. */
  sdt?: Record<string, Record<string, { uid: string; globalId: string; ten?: string }>>;
  /** uid nằm trong unchanged_profiles (không có globalId). */
  khongDoi?: Set<string>;
}

export interface LoiGoiZca {
  nick: string;
  ham: 'getUserInfo' | 'findUser' | 'getGroupMembersInfo';
  /** Tham số ĐÃ chuẩn hoá như zca-js gửi đi (friend_pversion_map / phone). */
  gui: string[];
}

/** API zca-js giả cho MỘT nick (cùng chữ ký hàm zca-js). */
export interface ZcaApiGia {
  getUserInfo(userId: string | string[]): Promise<unknown>;
  findUser(phoneNumber: string): Promise<unknown>;
  getGroupMembersInfo(memberId: string | string[]): Promise<unknown>;
}

export function taoZcaGia(bang: Record<string, Record<string, HoSoGia>>, o: ZcaGiaOpts = {}) {
  const goi: LoiGoiZca[] = [];
  const pversion = (ids: string | string[]) => (Array.isArray(ids) ? ids : [ids]);
  const nick = (n: string): ZcaApiGia => ({
    async getUserInfo(userId) {
      if (!userId) throw new Error('Missing user id');
      // getUserInfo.ts:30-35
      const map = pversion(userId).map((id) => (id.split('_').length > 1 ? id : `${id}_0`));
      goi.push({ nick: n, ham: 'getUserInfo', gui: map });
      const changed: Record<string, Record<string, unknown>> = {};
      const unchanged: Record<string, Record<string, unknown>> = {};
      for (const k of map) {
        const uid = k.replace(/_\d+$/, '');
        if (o.khongDoi?.has(uid)) { unchanged[uid] = { isFr: 0, isBlocked: 0, lastActionTime: 0 }; continue; }
        const goc = bang[n]?.[uid];
        const de = { ...(map.length > 1 ? o.chiKhiCaLo?.[n]?.[uid] : undefined), ...o.ghiDe?.[n]?.[uid] };
        if (!goc && !Object.keys(de).length) continue;
        const h = { ...goc, ...de } as HoSoGia;
        changed[o.khoa === 'uid_0' ? `${uid}_0` : uid] = {
          userId: h.userId ?? uid, username: `t_${uid.slice(0, 6)}`, displayName: h.zaloName ?? '', zaloName: h.zaloName ?? '',
          avatar: '', phoneNumber: h.phoneNumber ?? '', isFr: 0, globalId: h.globalId,
        };
      }
      return { changed_profiles: changed, unchanged_profiles: unchanged, phonebook_version: 0 };
    },
    async findUser(phoneNumber) {
      if (!phoneNumber) throw new Error('Missing phoneNumber');
      const p = phoneNumber.startsWith('0') ? `84${phoneNumber.slice(1)}` : phoneNumber; // findUser.ts:21-23 (language vi)
      goi.push({ nick: n, ham: 'findUser', gui: [p] });
      const r = o.sdt?.[p]?.[n];
      if (!r) return undefined; // lỗi 216 bị nuốt ⇒ `result.data` rỗng
      return { uid: r.uid, globalId: r.globalId, zalo_name: r.ten ?? '', display_name: r.ten ?? '', avatar: '', status: '' };
    },
    async getGroupMembersInfo(memberId) {
      const map = pversion(memberId).map((id) => (id.endsWith('_0') ? id : `${id}_0`)); // getGroupMembersInfo.ts:36
      goi.push({ nick: n, ham: 'getGroupMembersInfo', gui: map });
      const profiles: Record<string, Record<string, unknown>> = {};
      for (const k of map) {
        const uid = k.replace(/_0$/, '');
        const h = bang[n]?.[uid];
        if (!h) continue;
        profiles[uid] = {
          id: uid, displayName: h.zaloName ?? '', zaloName: h.zaloName ?? '', avatar: '', accountStatus: 0, type: 0,
          lastUpdateTime: 0, globalId: o.gmiTraGidNickGoi?.[n] ?? h.globalId,
        };
      }
      return { profiles, unchangeds_profile: [] };
    },
  });
  return { goi, nick };
}

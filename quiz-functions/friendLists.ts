// ========================================
// friendLists.ts - 내 친구/요청/차단 목록을 앱 모양으로 만든다 (get-friends 와 모든 변경 응답이 같이 씀)
//   3단계: 친구 줄과 나(Me)에 단별 최고 기록(BestRecords)을 붙여 앱이 순위표를 만든다
// ========================================

import { MAX_FRIENDS, MAX_RECEIVED, MAX_SENT, getProfiles, listRows, toEntry } from './friendStore';
import { todayKST } from './giftRules';

export async function buildFriendLists(playerId: string) {
  const rows = await listRows(playerId);
  const today = todayKST();
  const profiles = await getProfiles([playerId, ...rows.map((r) => r.OtherID)]);
  const pick = (status: 'Friend' | 'Received' | 'Sent' | 'Blocked') =>
    rows
      .filter((r) => r.Status === status)
      .sort((a, b) => (b.UpdatedAt ?? '').localeCompare(a.UpdatedAt ?? ''))
      .map((r) => {
        const p = profiles.get(r.OtherID);
        const e = toEntry(p, status);
        if (status !== 'Friend') return e;
        const extra = r as { LastGiftDate?: string; GiftPending?: number };
        // 4단계: 오늘 이 친구에게 선물했는지, 이 친구가 보낸 선물이 몇 개 기다리는지
        return { ...e, BestRecords: p?.BestRecords ?? {}, GiftSentToday: extra.LastGiftDate === today, GiftPending: Number(extra.GiftPending ?? 0) };
      })
      .filter((e) => e.FriendCode !== '');
  const me = profiles.get(playerId);
  return {
    Friends: pick('Friend'),
    Received: pick('Received'),
    Sent: pick('Sent'),
    Blocked: pick('Blocked'),
    Me: { ...toEntry(me, 'Self'), BestRecords: me?.BestRecords ?? {} },
    GiftsPending: rows.filter((r) => r.Status === 'Friend').reduce((n, r) => n + Number((r as { GiftPending?: number }).GiftPending ?? 0), 0),
    Limits: { MaxFriends: MAX_FRIENDS, MaxReceived: MAX_RECEIVED, MaxSent: MAX_SENT },
  };
}

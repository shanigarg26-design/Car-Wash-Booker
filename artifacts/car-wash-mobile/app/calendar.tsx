import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

type CalView = 'day' | 'week' | 'month';
const SLOTS = Array.from({ length: 24 }, (_, i) => i); // 06:00–17:30
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const slotLabel = (i: number) => {
  const total = 360 + i * 30, h24 = Math.floor(total / 60), m = total % 60;
  const ap = h24 < 12 ? 'AM' : 'PM', h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const slotOfDate = (d: Date) => {
  const h = d.getHours(), m = d.getMinutes();
  if (h < 6 || h >= 18) return -1;
  return (h - 6) * 2 + (m >= 30 ? 1 : 0);
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(d, -d.getDay());

// Status → colour. Cancelled days are dropped.
function statusColor(status: string): string {
  if (status === 'in_progress') return '#FBBF24';
  if (status === 'completed') return Colors.dark.success;
  return Colors.dark.tint; // scheduled / accepted / arrived
}

export default function CalendarScreen() {
  const router = useRouter();
  const [view, setView] = useState<CalView>('week');
  const [anchor, setAnchor] = useState(new Date());

  const { data: bookings } = useQuery({ queryKey: ['bookings', 'cleaner'], queryFn: () => apiFetch('/api/bookings?role=cleaner') });
  const { data: profile } = useQuery({ queryKey: ['cleanerProfile'], queryFn: () => apiFetch('/api/cleaners/me') });

  const prefSlots: number[] = Array.isArray(profile?.availableSlots) ? profile.availableSlots : [];
  const worksSlot = (s: number) => prefSlots.length === 0 || prefSlots.includes(s);

  // Index bookings by day → slot.
  const byDaySlot = useMemo(() => {
    const map = new Map<string, Map<number, any>>();
    for (const b of (bookings ?? [])) {
      if (b.status === 'cancelled' || !b.scheduledAt) continue;
      const d = new Date(b.scheduledAt);
      const s = slotOfDate(d);
      if (s < 0) continue;
      const k = dayKey(d);
      if (!map.has(k)) map.set(k, new Map());
      map.get(k)!.set(s, b);
    }
    return map;
  }, [bookings]);
  const bookingsOn = (d: Date) => byDaySlot.get(dayKey(d)) ?? new Map<number, any>();

  const shift = (dir: number) => {
    if (view === 'day') setAnchor(a => addDays(a, dir));
    else if (view === 'week') setAnchor(a => addDays(a, dir * 7));
    else setAnchor(a => { const x = new Date(a); x.setMonth(x.getMonth() + dir); return x; });
  };

  const periodLabel = () => {
    if (view === 'day') return anchor.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    if (view === 'week') { const s = startOfWeek(anchor), e = addDays(s, 6); return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`; }
    return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><AppIcon name="arrow-left" size={22} color={Colors.dark.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>My Calendar</Text>
        <TouchableOpacity onPress={() => setAnchor(new Date())} style={styles.todayBtn}><Text style={styles.todayText}>Today</Text></TouchableOpacity>
      </View>

      {/* View switch */}
      <View style={styles.switchRow}>
        {(['day', 'week', 'month'] as CalView[]).map(v => (
          <TouchableOpacity key={v} style={[styles.switchBtn, view === v && styles.switchBtnActive]} onPress={() => setView(v)}>
            <Text style={[styles.switchText, view === v && styles.switchTextActive]}>{v[0].toUpperCase() + v.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Period nav */}
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => shift(-1)} style={styles.iconBtn}><AppIcon name="chevron-left" size={22} color={Colors.dark.tint} /></TouchableOpacity>
        <Text style={styles.periodLabel}>{periodLabel()}</Text>
        <TouchableOpacity onPress={() => shift(1)} style={styles.iconBtn}><AppIcon name="chevron-right" size={22} color={Colors.dark.tint} /></TouchableOpacity>
      </View>

      {view === 'day' && <DayView anchor={anchor} bookingsOn={bookingsOn} worksSlot={worksSlot} onOpen={(id: number) => router.push(`/booking/${id}`)} />}
      {view === 'week' && <WeekView anchor={anchor} bookingsOn={bookingsOn} worksSlot={worksSlot} onOpen={(id: number) => router.push(`/booking/${id}`)} />}
      {view === 'month' && <MonthView anchor={anchor} byDaySlot={byDaySlot} onPickDay={(d: Date) => { setAnchor(d); setView("day"); }} />}

      <View style={styles.legend}>
        <Legend color={Colors.dark.tint} label="Booked" />
        <Legend color={Colors.dark.card} label="Available" border />
        <Legend color={Colors.dark.success} label="Done" />
      </View>
    </SafeAreaView>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }, border && { borderWidth: 1, borderColor: Colors.dark.border }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function DayView({ anchor, bookingsOn, worksSlot, onOpen }: any) {
  const map = bookingsOn(anchor);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
      {SLOTS.map(s => {
        const b = map.get(s);
        const works = worksSlot(s);
        return (
          <View key={s} style={styles.dayRow}>
            <Text style={styles.dayTime}>{slotLabel(s)}</Text>
            {b ? (
              <TouchableOpacity style={[styles.dayBlock, { backgroundColor: statusColor(b.status) }]} onPress={() => onOpen(b.id)} activeOpacity={0.85}>
                <Text style={styles.dayBlockText} numberOfLines={1}>{b.customerName || 'Wash'} · {b.customerAddress}</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.dayEmpty, !works && styles.dayOff]}>
                <Text style={[styles.dayEmptyText, !works && styles.dayOffText]}>{works ? 'Available' : 'Off'}</Text>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function WeekView({ anchor, bookingsOn, worksSlot, onOpen }: any) {
  const start = startOfWeek(anchor);
  const days = SLOTS.length ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : [];
  const today = dayKey(new Date());
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={styles.weekHead}>
        <View style={styles.weekTimeCol} />
        {days.map(d => (
          <View key={dayKey(d)} style={styles.weekDayHead}>
            <Text style={styles.weekDayName}>{WEEKDAYS[d.getDay()]}</Text>
            <Text style={[styles.weekDayNum, dayKey(d) === today && styles.weekToday]}>{d.getDate()}</Text>
          </View>
        ))}
      </View>
      {SLOTS.map(s => (
        <View key={s} style={styles.weekRow}>
          <Text style={styles.weekTime}>{slotLabel(s)}</Text>
          {days.map(d => {
            const b = bookingsOn(d).get(s);
            const works = worksSlot(s);
            return (
              <TouchableOpacity
                key={dayKey(d)}
                style={[styles.weekCell, works && !b && styles.weekCellAvail, b && { backgroundColor: statusColor(b.status) }]}
                disabled={!b}
                onPress={() => b && onOpen(b.id)}
                activeOpacity={0.8}
              />
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

function MonthView({ anchor, byDaySlot, onPickDay }: any) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = dayKey(new Date());
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
      <View style={styles.monthHead}>
        {WEEKDAYS.map(w => <Text key={w} style={styles.monthHeadText}>{w}</Text>)}
      </View>
      <View style={styles.monthGrid}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const count = byDaySlot.get(dayKey(d))?.size ?? 0;
          return (
            <TouchableOpacity key={i} style={styles.monthCell} onPress={() => onPickDay(d)} activeOpacity={0.8}>
              <Text style={[styles.monthNum, !inMonth && styles.monthNumDim, dayKey(d) === today && styles.weekToday]}>{d.getDate()}</Text>
              {count > 0 && <View style={styles.monthBadge}><Text style={styles.monthBadgeText}>{count}</Text></View>}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '700' },
  todayBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },
  todayText: { color: Colors.dark.tint, fontSize: 13, fontWeight: '600' },
  switchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  switchBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },
  switchBtnActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  switchText: { color: Colors.dark.tabIconDefault, fontSize: 14, fontWeight: '600' },
  switchTextActive: { color: '#FFF' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12 },
  periodLabel: { color: Colors.dark.text, fontSize: 16, fontWeight: '700' },

  dayRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 10 },
  dayTime: { color: Colors.dark.tabIconDefault, fontSize: 12, width: 68 },
  dayBlock: { flex: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  dayBlockText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  dayEmpty: { flex: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },
  dayOff: { backgroundColor: 'transparent', borderColor: 'transparent' },
  dayEmptyText: { color: Colors.dark.tint, fontSize: 12 },
  dayOffText: { color: Colors.dark.tabIconDefault, opacity: 0.5 },

  weekHead: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  weekTimeCol: { width: 52 },
  weekDayHead: { flex: 1, alignItems: 'center' },
  weekDayName: { color: Colors.dark.tabIconDefault, fontSize: 11 },
  weekDayNum: { color: Colors.dark.text, fontSize: 14, fontWeight: '700', marginTop: 2 },
  weekToday: { color: '#FFF', backgroundColor: Colors.dark.tint, width: 24, height: 24, borderRadius: 12, textAlign: 'center', overflow: 'hidden', lineHeight: 24 },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 24 },
  weekTime: { width: 52, color: Colors.dark.tabIconDefault, fontSize: 9 },
  weekCell: { flex: 1, height: 20, marginHorizontal: 1, borderRadius: 3, backgroundColor: 'transparent' },
  weekCellAvail: { backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },

  monthHead: { flexDirection: 'row', marginBottom: 6 },
  monthHeadText: { flex: 1, textAlign: 'center', color: Colors.dark.tabIconDefault, fontSize: 12, fontWeight: '600' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  monthNum: { color: Colors.dark.text, fontSize: 14 },
  monthNumDim: { color: Colors.dark.tabIconDefault, opacity: 0.4 },
  monthBadge: { marginTop: 3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: Colors.dark.tint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  monthBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  legend: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.dark.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { color: Colors.dark.tabIconDefault, fontSize: 12 },
});

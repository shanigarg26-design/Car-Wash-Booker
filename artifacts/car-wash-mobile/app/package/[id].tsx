import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

function minutesLabel(m: number): string {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const ap = h24 < 12 ? 'AM' : 'PM', h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ap}`;
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const DAY_STATUS: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Upcoming', color: Colors.dark.tabIconDefault },
  accepted: { label: 'Assigned', color: Colors.dark.tint },
  arrived: { label: 'Washer here', color: Colors.dark.tint },
  in_progress: { label: 'In progress', color: '#FBBF24' },
  completed: { label: 'Done', color: Colors.dark.success },
  cancelled: { label: 'Skipped', color: '#F87171' },
};

export default function PackageDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pkgId = Number(id);

  const { data: mine, isLoading } = useQuery({ queryKey: ['mySubs'], queryFn: () => apiFetch('/api/subscriptions/mine') });
  const pkg = (mine ?? []).find((s: any) => s.id === pkgId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['mySubs'] });

  const cancelPackage = useMutation({
    mutationFn: () => apiFetch(`/api/subscriptions/${pkgId}/cancel`, { method: 'PATCH' }),
    onSuccess: () => { invalidate(); router.back(); },
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not cancel.'),
  });
  const skipDay = useMutation({
    mutationFn: (v: { bookingId: number; reason?: string }) => apiFetch(`/api/subscriptions/${pkgId}/skip-day`, { method: 'PATCH', body: JSON.stringify(v) }),
    onSuccess: () => { invalidate(); Alert.alert('Done', 'That day was dropped and the package extended by a day.'); },
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not update the day.'),
  });

  if (isLoading) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.dark.tint} /></SafeAreaView>;
  if (!pkg) return (
    <SafeAreaView style={styles.root}>
      <Header title="Package" onBack={() => router.back()} />
      <Text style={styles.missing}>This package is no longer active.</Text>
    </SafeAreaView>
  );

  const rate: number = pkg.pricePerWash ?? 0;
  const days: any[] = pkg.days ?? [];
  const bills: any[] = pkg.bills ?? [];

  const done = days.filter(d => d.status === 'completed').length;
  const cancelled = days.filter(d => d.status === 'cancelled').length;
  const upcoming = days.filter(d => ['scheduled', 'accepted', 'arrived', 'in_progress'].includes(d.status));
  const deliverable = Math.max(0, pkg.washesTotal - cancelled); // washes that will actually happen
  const left = Math.max(0, deliverable - done);

  const billedWashes = bills.reduce((s, b) => s + b.washesCount, 0);
  const paidAmount = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.amountDue, 0);
  const unpaidDue = bills.filter(b => b.status === 'due').reduce((s, b) => s + b.amountDue, 0);
  const unbilledDone = Math.max(0, done - billedWashes);         // washes done this week, not yet billed
  const accruingThisWeek = unbilledDone * rate;                  // will be billed at the next weekly settlement
  const cancelTodayAmount = unpaidDue + accruingThisWeek;        // owed right now if you stop
  const totalPackage = deliverable * rate;                       // full cost if every wash happens
  const nextWash = upcoming.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

  const isUnassigned = pkg.status === 'unassigned';

  return (
    <SafeAreaView style={styles.root}>
      <Header title="Package details" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Summary */}
        <View style={styles.card}>
          <Text style={styles.pkgTitle}>{minutesLabel(pkg.dailyMinutes)} daily</Text>
          <Text style={styles.pkgSub}>{pkg.cleanerName ? `Washer: ${pkg.cleanerName}` : (isUnassigned ? 'Requested washer didn’t accept — reassign in Packages' : 'Finding your washer…')}{rate ? ` · ₹${rate}/wash` : ''}</Text>
          <Text style={styles.pkgSub}>{fmtDate(pkg.startedAt)} → {fmtDate(pkg.expiresAt)} · {pkg.cleanType === 'both' ? 'Ext + Int' : 'Exterior'}</Text>
          {nextWash && <Text style={styles.nextWash}>Next wash: {fmtDateTime(nextWash.scheduledAt)}</Text>}
        </View>

        {/* Progress */}
        <View style={styles.statRow}>
          <Stat label="Done" value={String(done)} color={Colors.dark.success} />
          <Stat label="Left" value={String(left)} color={Colors.dark.tint} />
          <Stat label="Skipped" value={String(cancelled)} color="#F87171" />
        </View>

        {/* Money */}
        <Text style={styles.sectionTitle}>Payments (offline, weekly)</Text>
        <View style={styles.card}>
          <MoneyRow label="Per wash" value={`₹${rate}`} />
          <MoneyRow label="Total package (all " suffix={`${deliverable} washes)`} value={`₹${totalPackage}`} />
          <View style={styles.divider} />
          <MoneyRow label="Already paid" value={`₹${paidAmount}`} valueColor={Colors.dark.success} />
          <MoneyRow label="Outstanding (billed, unpaid)" value={`₹${unpaidDue}`} valueColor={unpaidDue ? '#FBBF24' : Colors.dark.text} />
          <MoneyRow label="Accruing for next weekly bill" value={`₹${accruingThisWeek}`} />
          <View style={styles.divider} />
          <MoneyRow label="If you cancel today, you owe" value={`₹${cancelTodayAmount}`} valueColor="#F87171" bold />
          <Text style={styles.moneyNote}>You owe for washes already done but not yet paid. The weekly bill is settled directly with your washer.</Text>
        </View>

        {/* Weekly bills */}
        {bills.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Weekly bills</Text>
            <View style={styles.card}>
              {bills.map((b: any) => (
                <View key={b.id} style={styles.billRow}>
                  <Text style={styles.billWeek}>Week {b.weekIndex + 1}</Text>
                  <Text style={styles.billMeta}>{b.washesCount} wash{b.washesCount > 1 ? 'es' : ''} · ₹{b.amountDue}</Text>
                  <Text style={[styles.billStatus, { color: b.status === 'paid' ? Colors.dark.success : '#FBBF24' }]}>{b.status === 'paid' ? 'Paid ✓' : 'Due'}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Days */}
        <Text style={styles.sectionTitle}>Schedule ({days.length} days)</Text>
        <View style={styles.card}>
          {days.map((d: any) => {
            const st = DAY_STATUS[d.status] ?? DAY_STATUS.scheduled;
            const t = new Date(d.scheduledAt).getTime();
            const actionable = ['scheduled', 'accepted', 'arrived'].includes(d.status);
            const isPastAssigned = ['accepted', 'arrived'].includes(d.status) && t < Date.now();
            return (
              <View key={d.id} style={styles.dayRow}>
                <Text style={styles.dayDate}>{fmtDate(d.scheduledAt)}</Text>
                <Text style={[styles.dayStatus, { color: st.color }]}>{st.label}{d.status === 'cancelled' && d.notes === 'no_show' ? ' (no-show)' : ''}</Text>
                {actionable && (
                  <View style={styles.dayActions}>
                    {isPastAssigned && (
                      <TouchableOpacity onPress={() => skipDay.mutate({ bookingId: d.id, reason: 'no_show' })}>
                        <Text style={styles.noShow}>No-show</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => skipDay.mutate({ bookingId: d.id })}>
                      <Text style={styles.cancelDay}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.cancelPkgBtn}
          onPress={() => Alert.alert('Cancel package?', `You’ll owe ₹${cancelTodayAmount} for washes already done. Remaining days are dropped.`, [
            { text: 'Keep', style: 'cancel' },
            { text: 'Cancel package', style: 'destructive', onPress: () => cancelPackage.mutate() },
          ])}
        >
          <Text style={styles.cancelPkgText}>Cancel package</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}><AppIcon name="arrow-left" size={24} color={Colors.dark.text} /></TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function MoneyRow({ label, suffix, value, valueColor, bold }: { label: string; suffix?: string; value: string; valueColor?: string; bold?: boolean }) {
  return (
    <View style={styles.moneyRow}>
      <Text style={[styles.moneyLabel, bold && { fontWeight: '700', color: Colors.dark.text }]}>{label}{suffix ?? ''}</Text>
      <Text style={[styles.moneyValue, bold && { fontWeight: '800' }, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  backBtn: { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '700' },
  missing: { color: Colors.dark.tabIconDefault, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: Colors.dark.card, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: Colors.dark.border },
  pkgTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '800' },
  pkgSub: { color: Colors.dark.tabIconDefault, fontSize: 13, marginTop: 4 },
  nextWash: { color: Colors.dark.tint, fontSize: 14, fontWeight: '600', marginTop: 8 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  stat: { flex: 1, backgroundColor: Colors.dark.card, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.dark.border },
  statValue: { fontSize: 24, fontWeight: '900' },
  statLabel: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 2 },
  sectionTitle: { color: Colors.dark.text, fontSize: 15, fontWeight: '700', marginBottom: 8, marginTop: 4 },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  moneyLabel: { color: Colors.dark.tabIconDefault, fontSize: 14, flex: 1 },
  moneyValue: { color: Colors.dark.text, fontSize: 15, fontWeight: '600' },
  divider: { height: 1, backgroundColor: Colors.dark.border, marginVertical: 8 },
  moneyNote: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 8, lineHeight: 17 },
  billRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
  billWeek: { color: Colors.dark.text, fontSize: 14, fontWeight: '600', width: 70 },
  billMeta: { color: Colors.dark.tabIconDefault, fontSize: 13, flex: 1 },
  billStatus: { fontSize: 13, fontWeight: '700' },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
  dayDate: { color: Colors.dark.text, fontSize: 13, width: 64 },
  dayStatus: { fontSize: 13, flex: 1 },
  dayActions: { flexDirection: 'row', gap: 14 },
  noShow: { color: '#FBBF24', fontSize: 13, fontWeight: '600' },
  cancelDay: { color: '#F87171', fontSize: 13, fontWeight: '600' },
  cancelPkgBtn: { marginTop: 8, alignItems: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: '#F8717155' },
  cancelPkgText: { color: '#F87171', fontWeight: '700', fontSize: 15 },
});

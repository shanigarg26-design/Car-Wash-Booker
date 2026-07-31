import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

function minutesLabel(m: number): string {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

export default function WasherPackages() {
  const queryClient = useQueryClient();
  const { data: serving } = useQuery({
    queryKey: ['servingPackages'],
    queryFn: () => apiFetch('/api/subscriptions/serving'),
    refetchInterval: 15000,
  });
  const packages = serving ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['servingPackages'] });

  const markPaid = useMutation({
    mutationFn: (v: { id: number; billId: number }) => apiFetch(`/api/subscriptions/${v.id}/bills/${v.billId}/paid`, { method: 'PATCH' }),
    onSuccess: invalidate,
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not confirm payment.'),
  });
  const skipDay = useMutation({
    mutationFn: (v: { id: number; bookingId: number }) => apiFetch(`/api/subscriptions/${v.id}/skip-day`, { method: 'PATCH', body: JSON.stringify({ bookingId: v.bookingId }) }),
    onSuccess: () => { invalidate(); Alert.alert('Done', 'That day was skipped; the package extended by a day.'); },
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not skip the day.'),
  });
  const cancelPackage = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/subscriptions/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: invalidate,
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not cancel.'),
  });

  if (packages.length === 0) return null;

  return (
    <View style={{ marginTop: 20 }}>
      <Text style={styles.sectionTitle}>Packages You Serve ({packages.length})</Text>
      {packages.map((s: any) => {
        const nextDay = (s.days ?? []).find((d: any) => ['scheduled', 'accepted', 'arrived'].includes(d.status));
        const dueBills = (s.bills ?? []).filter((b: any) => b.status === 'due');
        return (
          <View key={s.id} style={styles.card}>
            <View style={styles.top}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{s.customerName || 'Customer'} · {minutesLabel(s.dailyMinutes)} daily</Text>
                <Text style={styles.sub}>{s.daysCompleted ?? 0}/{s.washesTotal} washes · ₹{s.pricePerWash}/wash</Text>
              </View>
            </View>

            {nextDay && (
              <View style={styles.nextRow}>
                <Text style={styles.nextText}>
                  Next: {new Date(nextDay.scheduledAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
                <TouchableOpacity onPress={() => skipDay.mutate({ id: s.id, bookingId: nextDay.id })}>
                  <Text style={styles.skip}>Can’t make it</Text>
                </TouchableOpacity>
              </View>
            )}

            {dueBills.map((b: any) => (
              <View key={b.id} style={styles.billRow}>
                <Text style={styles.billText}>Week {b.weekIndex + 1}: ₹{b.amountDue} ({b.washesCount} wash{b.washesCount > 1 ? 'es' : ''})</Text>
                <TouchableOpacity style={styles.paidBtn} onPress={() => markPaid.mutate({ id: s.id, billId: b.id })}>
                  <AppIcon name="check" size={14} color="#FFF" />
                  <Text style={styles.paidBtnText}>Payment received</Text>
                </TouchableOpacity>
              </View>
            ))}
            {(s.bills ?? []).filter((b: any) => b.status === 'paid').length > 0 && dueBills.length === 0 && (
              <Text style={styles.allPaid}>All weekly payments settled ✓</Text>
            )}

            <TouchableOpacity onPress={() => Alert.alert('Cancel package?', 'You’ll be freed from all remaining days.', [
              { text: 'Keep', style: 'cancel' },
              { text: 'Cancel', style: 'destructive', onPress: () => cancelPackage.mutate(s.id) },
            ])}>
              <Text style={styles.cancelText}>Cancel package</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 10 },
  card: { backgroundColor: Colors.dark.card, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.dark.tint + '44', gap: 10 },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { color: Colors.dark.text, fontSize: 15, fontWeight: '700' },
  sub: { color: Colors.dark.tabIconDefault, fontSize: 13, marginTop: 3 },
  nextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextText: { color: Colors.dark.text, fontSize: 13, flex: 1 },
  skip: { color: '#F87171', fontSize: 13, fontWeight: '600' },
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: Colors.dark.background, borderRadius: 10, padding: 10 },
  billText: { color: Colors.dark.text, fontSize: 13, flex: 1 },
  paidBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.dark.success, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9 },
  paidBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  allPaid: { color: Colors.dark.success, fontSize: 13, fontWeight: '600' },
  cancelText: { color: '#F87171', fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 2 },
});

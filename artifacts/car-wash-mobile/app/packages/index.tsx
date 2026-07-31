import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { apiFetch, BASE_URL } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

const VEHICLE_TYPES = [
  'Small Hatchback', 'Premium Hatchback', 'Compact Sedan', 'Premium Sedan',
  'Compact SUV', 'Mid-Size SUV', 'Large SUV', 'Luxury',
];
// Daily-time options mirror the washer availability window (06:00–17:30 IST).
const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => 360 + i * 30);
const DURATIONS = [{ days: 7, label: 'Weekly', sub: '7 days' }, { days: 30, label: 'Monthly', sub: '30 days' }];

function minutesLabel(m: number): string {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

type Loc = { lat: number | null; lng: number | null; address: string };

const DAY_STATUS: Record<string, { label: string; color: string }> = {
  scheduled:   { label: 'Upcoming',    color: Colors.dark.tabIconDefault },
  accepted:    { label: 'Assigned',    color: Colors.dark.tint },
  arrived:     { label: 'Washer here', color: Colors.dark.tint },
  in_progress: { label: 'In progress', color: Colors.dark.tint },
  completed:   { label: 'Done',        color: Colors.dark.success },
  cancelled:   { label: 'Skipped',     color: '#F87171' },
};

export default function PackagesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [vehicleType, setVehicleType] = useState('Compact Sedan');
  const [washType, setWashType] = useState<'exterior' | 'both'>('exterior');
  const [dailyMinutes, setDailyMinutes] = useState(540); // 9:00 AM
  const [durationDays, setDurationDays] = useState(7);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [locStatus, setLocStatus] = useState<'detecting' | 'done' | 'failed'>('detecting');
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: mine, isLoading } = useQuery({ queryKey: ['mySubs'], queryFn: () => apiFetch('/api/subscriptions/mine') });
  const dailyPackages = (mine ?? []).filter((s: any) => s.kind === 'daily');

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(`${BASE_URL}/api/geocode/reverse?lat=${lat}&lon=${lng}`);
      const d = await res.json();
      if (d?.address) {
        const a = d.address, parts: string[] = [];
        if (a.road) parts.push(a.road);
        if (a.suburb || a.neighbourhood) parts.push(a.suburb || a.neighbourhood);
        if (a.city || a.town || a.village) parts.push(a.city || a.town || a.village);
        return parts.length ? parts.join(', ') : (d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
      return d?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
  };

  const detectLocation = async () => {
    setLocStatus('detecting');
    try {
      if (Platform.OS !== 'web') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, address });
          setLocStatus('done'); return;
        }
      }
      if (user?.address) { setLoc({ lat: null, lng: null, address: user.address }); setLocStatus('done'); return; }
      setLocStatus('failed');
    } catch {
      if (user?.address) { setLoc({ lat: null, lng: null, address: user.address }); setLocStatus('done'); return; }
      setLocStatus('failed');
    }
  };
  useEffect(() => { detectLocation(); }, []);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['mySubs'] });

  const createDaily = useMutation({
    mutationFn: () => apiFetch('/api/subscriptions/daily', {
      method: 'POST',
      body: JSON.stringify({
        vehicleType, washType, dailyMinutes, durationDays,
        address: loc?.address || user?.address || 'Current location',
        latitude: loc?.lat, longitude: loc?.lng,
      }),
    }),
    onSuccess: () => {
      invalidate();
      Alert.alert('Package started ✓', 'Your first wash request goes out at the daily time. Whoever accepts becomes your washer for the whole package.');
    },
    onError: (e: any) => Alert.alert('Could not start package', e?.message || 'Please try again.'),
  });

  const cancelPackage = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/subscriptions/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: invalidate,
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not cancel.'),
  });

  const skipDay = useMutation({
    mutationFn: (v: { id: number; bookingId: number; reason?: string }) =>
      apiFetch(`/api/subscriptions/${v.id}/skip-day`, { method: 'PATCH', body: JSON.stringify({ bookingId: v.bookingId, reason: v.reason }) }),
    onSuccess: () => { invalidate(); Alert.alert('Done', 'That day was dropped and your package extended by a day.'); },
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not update the day.'),
  });

  const confirmCancelPackage = (id: number) => Alert.alert('Cancel package?', 'All remaining days will be dropped.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Cancel package', style: 'destructive', onPress: () => cancelPackage.mutate(id) },
  ]);

  const canLocate = locStatus === 'done';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Daily Packages</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.lead}>One wash every day, same washer, at a time you pick. Pay weekly — nothing upfront. 💧</Text>

        {/* ── Active daily packages ── */}
        {dailyPackages.map((s: any) => {
          const isOpen = expanded === s.id;
          const nextDay = (s.days ?? []).find((d: any) => ['scheduled', 'accepted', 'arrived', 'in_progress'].includes(d.status));
          const now = Date.now();
          return (
            <View key={s.id} style={styles.pkgCard}>
              <View style={styles.pkgTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgTitle}>{minutesLabel(s.dailyMinutes)} daily · {s.washesTotal} washes</Text>
                  <Text style={styles.pkgSub}>
                    {s.cleanerName ? `Washer: ${s.cleanerName}` : 'Finding your washer…'}
                    {s.pricePerWash ? ` · ₹${s.pricePerWash}/wash` : ''}
                  </Text>
                </View>
                <View style={styles.progressPill}>
                  <Text style={styles.progressText}>{s.daysCompleted ?? 0}/{s.washesTotal}</Text>
                </View>
              </View>

              {nextDay && (
                <Text style={styles.nextLine}>
                  Next: {new Date(nextDay.scheduledAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {' · '}{(DAY_STATUS[nextDay.status] ?? DAY_STATUS.scheduled).label}
                </Text>
              )}
              <Text style={styles.endLine}>Ends {new Date(s.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · billed weekly, offline</Text>

              <TouchableOpacity style={styles.manageRow} onPress={() => setExpanded(isOpen ? null : s.id)}>
                <Text style={styles.manageText}>{isOpen ? 'Hide days' : 'Manage days'}</Text>
                <AppIcon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.dark.tint} />
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.dayList}>
                  {(s.days ?? []).map((d: any) => {
                    const st = DAY_STATUS[d.status] ?? DAY_STATUS.scheduled;
                    const t = new Date(d.scheduledAt).getTime();
                    const actionable = ['scheduled', 'accepted', 'arrived'].includes(d.status);
                    const isPastAssigned = ['accepted', 'arrived'].includes(d.status) && t < now;
                    return (
                      <View key={d.id} style={styles.dayRow}>
                        <Text style={styles.dayDate}>{new Date(d.scheduledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
                        <Text style={[styles.dayStatus, { color: st.color }]}>{st.label}{d.status === 'cancelled' && d.notes === 'no_show' ? ' (no-show)' : ''}</Text>
                        {actionable && (
                          <View style={styles.dayActions}>
                            {isPastAssigned && (
                              <TouchableOpacity onPress={() => skipDay.mutate({ id: s.id, bookingId: d.id, reason: 'no_show' })}>
                                <Text style={styles.noShowBtn}>No-show</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity onPress={() => skipDay.mutate({ id: s.id, bookingId: d.id })}>
                              <Text style={styles.cancelDayBtn}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              <TouchableOpacity style={styles.cancelPkgBtn} onPress={() => confirmCancelPackage(s.id)}>
                <Text style={styles.cancelPkgText}>Cancel package</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* ── Builder ── */}
        <Text style={styles.builderTitle}>{dailyPackages.length > 0 ? 'Start another package' : 'Start a daily package'}</Text>

        <Text style={styles.sectionLabel}>Vehicle</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          {VEHICLE_TYPES.map(v => (
            <TouchableOpacity key={v} style={[styles.chip, vehicleType === v && styles.chipActive]} onPress={() => setVehicleType(v)}>
              <Text style={[styles.chipText, vehicleType === v && styles.chipTextActive]}>{v}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>Wash type</Text>
        <View style={styles.washRow}>
          {(['exterior', 'both'] as const).map(w => (
            <TouchableOpacity key={w} style={[styles.washBtn, washType === w && styles.washBtnActive]} onPress={() => setWashType(w)}>
              <Text style={[styles.washBtnText, washType === w && styles.washBtnTextActive]}>{w === 'both' ? 'Exterior + Interior' : 'Exterior only'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Daily time</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          {TIME_OPTIONS.map(m => (
            <TouchableOpacity key={m} style={[styles.chip, dailyMinutes === m && styles.chipActive]} onPress={() => setDailyMinutes(m)}>
              <Text style={[styles.chipText, dailyMinutes === m && styles.chipTextActive]}>{minutesLabel(m)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>Duration</Text>
        <View style={styles.washRow}>
          {DURATIONS.map(d => (
            <TouchableOpacity key={d.days} style={[styles.durBtn, durationDays === d.days && styles.washBtnActive]} onPress={() => setDurationDays(d.days)}>
              <Text style={[styles.washBtnText, durationDays === d.days && styles.washBtnTextActive]}>{d.label}</Text>
              <Text style={[styles.durSub, durationDays === d.days && { color: '#FFF' }]}>{d.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Service address</Text>
        <View style={styles.locCard}>
          <AppIcon name="map-pin" size={16} color={Colors.dark.tint} />
          <Text style={styles.locText} numberOfLines={2}>
            {locStatus === 'detecting' ? 'Detecting your location…' : (loc?.address || 'Location unavailable — tap retry')}
          </Text>
          {locStatus !== 'detecting' && (
            <TouchableOpacity onPress={detectLocation}><Text style={styles.retry}>Retry</Text></TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.startBtn, (!canLocate || createDaily.isPending) && { opacity: 0.6 }]}
          onPress={() => createDaily.mutate()}
          disabled={!canLocate || createDaily.isPending}
          activeOpacity={0.85}
        >
          {createDaily.isPending
            ? <ActivityIndicator color="#FFF" />
            : <Text style={styles.startBtnText}>Start {durationDays === 7 ? 'weekly' : 'monthly'} package · {minutesLabel(dailyMinutes)} daily</Text>}
        </TouchableOpacity>
        <Text style={styles.disclaimer}>No upfront payment. Each week you’ll owe (washes done × your washer’s rate), paid to the washer offline.</Text>

        {isLoading && <ActivityIndicator style={{ marginTop: 20 }} color={Colors.dark.tint} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  backBtn: { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '700' },
  lead: { color: Colors.dark.tabIconDefault, fontSize: 14, marginBottom: 16, lineHeight: 20 },

  pkgCard: { backgroundColor: Colors.dark.card, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: Colors.dark.tint + '55' },
  pkgTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pkgTitle: { color: Colors.dark.text, fontSize: 16, fontWeight: '800' },
  pkgSub: { color: Colors.dark.tabIconDefault, fontSize: 13, marginTop: 3 },
  progressPill: { backgroundColor: Colors.dark.tint + '25', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  progressText: { color: Colors.dark.tint, fontWeight: '800', fontSize: 13 },
  nextLine: { color: Colors.dark.text, fontSize: 13, marginTop: 10 },
  endLine: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 4 },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
  manageText: { color: Colors.dark.tint, fontWeight: '600', fontSize: 13 },
  dayList: { marginTop: 10, borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 8 },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
  dayDate: { color: Colors.dark.text, fontSize: 13, width: 64 },
  dayStatus: { fontSize: 13, flex: 1 },
  dayActions: { flexDirection: 'row', gap: 14 },
  noShowBtn: { color: '#FBBF24', fontSize: 13, fontWeight: '600' },
  cancelDayBtn: { color: '#F87171', fontSize: 13, fontWeight: '600' },
  cancelPkgBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#F8717155' },
  cancelPkgText: { color: '#F87171', fontWeight: '700', fontSize: 14 },

  builderTitle: { color: Colors.dark.text, fontSize: 17, fontWeight: '800', marginTop: 8, marginBottom: 14 },
  sectionLabel: { color: Colors.dark.text, fontWeight: '600', marginBottom: 8, fontSize: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.dark.card, marginRight: 8, borderWidth: 1, borderColor: Colors.dark.border },
  chipActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  chipText: { color: Colors.dark.tabIconDefault, fontSize: 13 },
  chipTextActive: { color: '#FFF', fontWeight: '600' },
  washRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  washBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.dark.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.dark.border },
  washBtnActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  washBtnText: { color: Colors.dark.tabIconDefault, fontSize: 13 },
  washBtnTextActive: { color: '#FFF', fontWeight: '600' },
  durBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.dark.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.dark.border },
  durSub: { color: Colors.dark.tabIconDefault, fontSize: 11, marginTop: 2 },
  locCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.dark.border, marginBottom: 20 },
  locText: { color: Colors.dark.text, fontSize: 13, flex: 1 },
  retry: { color: Colors.dark.tint, fontSize: 13, fontWeight: '600' },
  startBtn: { backgroundColor: Colors.dark.tint, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  startBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  disclaimer: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 10, lineHeight: 17, textAlign: 'center' },
});

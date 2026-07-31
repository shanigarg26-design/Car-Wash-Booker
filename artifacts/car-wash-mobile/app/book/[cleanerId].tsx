import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { apiFetch, BASE_URL } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import HomeButton from '@/components/HomeButton';
import AppIcon from '@/components/AppIcon';
import SchedulePicker from '@/components/SchedulePicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Loc = { lat: number | null; lng: number | null; address: string };

export default function BookCleanerScreen() {
  const { cleanerId } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [loc, setLoc] = useState<Loc | null>(null);
  const [locStatus, setLocStatus] = useState<'detecting' | 'done' | 'failed'>('detecting');
  const [showSchedule, setShowSchedule] = useState(false);
  const mode = useRef<'now' | 'schedule'>('now');

  const { data: cleaner, isLoading } = useQuery({
    queryKey: ['cleaner', cleanerId],
    queryFn: () => apiFetch(`/api/cleaners/${cleanerId}`),
  });

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
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  };

  // Auto-detect the customer's location so booking needs no typing.
  const detectLocation = async () => {
    setLocStatus('detecting');
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    try {
      if (Platform.OS !== 'web') {
        const { status } = await withTimeout(Location.requestForegroundPermissionsAsync(), 5000);
        if (status === 'granted') {
          const pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10000);
          const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, address });
          setLocStatus('done');
          return;
        }
      }
      // Fall back to the saved profile address (server uses saved coords to dispatch).
      if (user?.address) { setLoc({ lat: null, lng: null, address: user.address }); setLocStatus('done'); return; }
      setLocStatus('failed');
    } catch {
      if (user?.address) { setLoc({ lat: null, lng: null, address: user.address }); setLocStatus('done'); return; }
      setLocStatus('failed');
    }
  };

  useEffect(() => { detectLocation(); }, []);

  const bookMutation = useMutation({
    mutationFn: (scheduledAt?: string) => apiFetch('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        cleanerId: Number(cleanerId),
        customerAddress: loc?.address || user?.address || 'Current location',
        customerLat: loc?.lat ?? undefined,
        customerLng: loc?.lng ?? undefined,
        scheduledAt: scheduledAt || undefined,
      }),
    }),
    onSuccess: (booking: any, scheduledAt) => {
      if (scheduledAt) {
        Alert.alert('Scheduled ✓', 'Your wash is scheduled. We’ll send the request to cleaners at that time.', [
          { text: 'OK', onPress: () => router.replace('/(tabs)/bookings') },
        ]);
      } else {
        // Instant request — go straight to the live tracking screen.
        router.replace(`/booking/${booking.id}`);
      }
    },
    onError: (e: any) => {
      if (e?.code === 'location_required') {
        Alert.alert('Location needed', 'We couldn’t detect your location. Please enable location access and try again.', [
          { text: 'Retry', onPress: detectLocation }, { text: 'Cancel', style: 'cancel' },
        ]);
      } else {
        Alert.alert('Error', e?.message || 'Could not create booking. Please try again.');
      }
    },
  });

  const handleBookNow = () => {
    if (locStatus === 'detecting') { Alert.alert('One moment', 'Still detecting your location — please try again in a second.'); return; }
    if (locStatus === 'failed' || !loc) { detectLocation(); Alert.alert('Location needed', 'Please enable location access so we can send a cleaner to you.'); return; }
    mode.current = 'now';
    bookMutation.mutate(undefined);
  };

  const handleScheduleConfirm = (iso: string) => {
    setShowSchedule(false);
    if (!loc) { detectLocation(); Alert.alert('Location needed', 'Please enable location access first.'); return; }
    mode.current = 'schedule';
    bookMutation.mutate(iso);
  };

  if (isLoading || !cleaner) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.dark.tint} />
      </View>
    );
  }

  const price = cleaner.pricePerClean ?? cleaner.pricePerWash;
  const busy = bookMutation.isPending;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top || 20 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Book a Wash</Text>
        <HomeButton />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Cleaner summary */}
        <View style={styles.summaryCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{cleaner.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={styles.summaryInfo}>
            <Text style={styles.summaryName}>{cleaner.name || 'Cleaner'}</Text>
            <Text style={styles.summaryPrice}>₹{price} / clean</Text>
          </View>
          {cleaner.available ? (
            <View style={styles.availBadge}><View style={styles.availDot} /><Text style={styles.availText}>Available</Text></View>
          ) : null}
        </View>

        {/* Auto-detected location (read-only, no typing) */}
        <View style={styles.locCard}>
          <AppIcon name="map-pin" size={18} color={Colors.dark.tint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locLabel}>Service location</Text>
            {locStatus === 'detecting' ? (
              <View style={styles.locDetectRow}>
                <ActivityIndicator size="small" color={Colors.dark.tabIconDefault} />
                <Text style={styles.locDetecting}>Detecting your location…</Text>
              </View>
            ) : locStatus === 'failed' ? (
              <Text style={styles.locFailed}>Location unavailable — tap to retry</Text>
            ) : (
              <Text style={styles.locValue} numberOfLines={2}>{loc?.address}</Text>
            )}
          </View>
          <TouchableOpacity onPress={detectLocation} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <AppIcon name="refresh-cw" size={16} color={Colors.dark.tabIconDefault} />
          </TouchableOpacity>
        </View>

        <View style={styles.infoNote}>
          <AppIcon name="zap" size={15} color={Colors.dark.tint} />
          <Text style={styles.infoNoteText}>Tap Book Now and we’ll instantly send the request to nearby cleaners to accept.</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom || 24 }]}>
        <View style={styles.priceRow}>
          <Text style={styles.priceRowLabel}>Total</Text>
          <Text style={styles.priceRowValue}>₹{price}</Text>
        </View>

        <TouchableOpacity style={[styles.bookNowBtn, busy && { opacity: 0.7 }]} onPress={handleBookNow} disabled={busy} activeOpacity={0.85}>
          {busy && mode.current === 'now' ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <AppIcon name="send" size={20} color="#FFF" />
              <Text style={styles.bookNowText}>Book Now</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.scheduleBtn, busy && { opacity: 0.7 }]} onPress={() => setShowSchedule(true)} disabled={busy} activeOpacity={0.85}>
          <AppIcon name="calendar" size={19} color={Colors.dark.tint} />
          <Text style={styles.scheduleText}>Schedule for Later</Text>
        </TouchableOpacity>
      </View>

      <SchedulePicker
        visible={showSchedule}
        onClose={() => setShowSchedule(false)}
        onConfirm={handleScheduleConfirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20,
    paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  closeBtn: { padding: 8 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },
  content: { flex: 1, padding: 20 },
  summaryCard: {
    flexDirection: 'row', backgroundColor: Colors.dark.card, padding: 16,
    borderRadius: 16, marginBottom: 16, alignItems: 'center',
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.dark.tint,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  avatarText: { color: '#FFF', fontSize: 22, fontWeight: 'bold' },
  summaryInfo: { flex: 1 },
  summaryName: { fontSize: 18, fontWeight: 'bold', color: Colors.dark.text },
  summaryPrice: { fontSize: 15, color: Colors.dark.tint, marginTop: 4, fontWeight: '600' },
  availBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  availDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.dark.success },
  availText: { color: Colors.dark.success, fontSize: 12, fontWeight: '700' },
  locCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.dark.card,
    borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.dark.border, marginBottom: 16,
  },
  locLabel: { fontSize: 11, color: Colors.dark.tabIconDefault, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  locValue: { fontSize: 15, color: Colors.dark.text, fontWeight: '500' },
  locDetectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locDetecting: { fontSize: 14, color: Colors.dark.tabIconDefault },
  locFailed: { fontSize: 14, color: Colors.dark.warning },
  infoNote: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.dark.tint + '12',
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.dark.tint + '30',
  },
  infoNoteText: { flex: 1, fontSize: 13, color: Colors.dark.text, lineHeight: 18 },
  footer: {
    paddingTop: 14, paddingHorizontal: 20, backgroundColor: Colors.dark.card,
    borderTopWidth: 1, borderTopColor: Colors.dark.border, gap: 12,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceRowLabel: { color: Colors.dark.tabIconDefault, fontSize: 15 },
  priceRowValue: { color: Colors.dark.text, fontSize: 22, fontWeight: 'bold' },
  bookNowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.dark.tint, borderRadius: 16, paddingVertical: 16,
  },
  bookNowText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  scheduleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'transparent', borderRadius: 16, paddingVertical: 13,
    borderWidth: 1.5, borderColor: Colors.dark.tint,
  },
  scheduleText: { color: Colors.dark.tint, fontSize: 16, fontWeight: '700' },
});

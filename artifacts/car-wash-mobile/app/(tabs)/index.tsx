import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Switch, RefreshControl, Animated, Easing, Platform, Modal,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import { BUILD_TAG } from '@/constants/build';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import { useRouter } from 'expo-router';
import { useWasherLocation } from '@/hooks/useWasherLocation';
import IncomingBookingAlert from '@/components/IncomingBookingAlert';
import CurrentLocationMap from '@/components/CurrentLocationMap';
import AvailabilityManager from '@/components/AvailabilityManager';
import WasherPackages from '@/components/WasherPackages';

function minutesLabel(m: number): string {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const ap = h24 < 12 ? 'AM' : 'PM', h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ap}`;
}
const fmtShort = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Current half-hour slot index in IST (India). 0 = 06:00 … 23 = 17:30; -1 outside 6am–6pm.
function currentIstSlot(): number {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  if (h < 6 || h >= 18) return -1;
  return (h - 6) * 2 + (m >= 30 ? 1 : 0);
}

function getStatusColor(status: string) {
  switch (status) {
    case 'searching':   return Colors.dark.warning;
    case 'accepted':    return Colors.dark.success;
    case 'arrived':     return '#7C3AED';
    case 'in_progress': return '#0891B2';
    case 'completed':   return Colors.dark.tint;
    case 'cancelled':   return Colors.dark.tabIconDefault;
    default:            return Colors.dark.border;
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'searching':   return 'Finding Cleaner…';
    case 'accepted':    return 'Cleaner On The Way';
    case 'arrived':     return 'Cleaner Arrived!';
    case 'in_progress': return 'Clean In Progress';
    case 'completed':   return 'Completed';
    case 'cancelled':   return 'Cancelled';
    default:            return status;
  }
}

const ACTIVE_STATUSES = ['searching', 'accepted', 'arrived', 'in_progress'] as const;

function ActiveBookingBanner({ booking }: { booking: any }) {
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (booking.status === 'searching') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.7, duration: 800, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [booking.status]);

  return (
    <TouchableOpacity
      style={[styles.activeBanner, { borderColor: getStatusColor(booking.status) }]}
      onPress={() => router.push(`/booking/${booking.id}`)}
      activeOpacity={0.85}
    >
      <View style={styles.activeBannerLeft}>
        {booking.status === 'searching' ? (
          <Animated.View style={{ opacity: pulse }}>
            <AppIcon name="loader" size={22} color={Colors.dark.warning} />
          </Animated.View>
        ) : (
          <AppIcon
            name={
              booking.status === 'accepted'    ? 'check-circle' :
              booking.status === 'arrived'     ? 'map-pin' :
              booking.status === 'in_progress' ? 'droplets' : 'clock'
            }
            size={22}
            color={getStatusColor(booking.status)}
          />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.activeBannerTitle}>{getStatusLabel(booking.status)}</Text>
          {(booking.cleanerName ?? booking.washerName) ? (
            <Text style={styles.activeBannerSub}>{booking.cleanerName ?? booking.washerName}</Text>
          ) : (
            <Text style={styles.activeBannerSub} numberOfLines={1}>{booking.customerAddress}</Text>
          )}
        </View>
      </View>
      <AppIcon name="chevron-right" size={18} color={Colors.dark.tabIconDefault} />
    </TouchableOpacity>
  );
}

function CustomerDashboard({ user }: { user: any }) {
  const router = useRouter();

  const { data: bookings, isLoading, refetch } = useQuery({
    queryKey: ['bookings', 'customer'],
    queryFn: () => apiFetch('/api/bookings?role=customer'),
    refetchInterval: 5000,
  });

  const { data: subs } = useQuery({ queryKey: ['mySubs'], queryFn: () => apiFetch('/api/subscriptions/mine'), refetchInterval: 8000 });
  const dailyPackages = (subs ?? []).filter((s: any) => s.kind === 'daily');

  const activeBookings = bookings?.filter((b: any) => (ACTIVE_STATUSES as readonly string[]).includes(b.status)) || [];
  const hasActive = activeBookings.length > 0;
  // Future one-off scheduled washes (package days are shown as a package entry instead).
  const upcomingBookings = bookings?.filter((b: any) => b.status === 'scheduled' && !b.subscriptionId) || [];
  const recentBookings = bookings
    ?.filter((b: any) => !(ACTIVE_STATUSES as readonly string[]).includes(b.status) && b.status !== 'scheduled')
    ?.slice(0, 5) || [];
  const totalWashes = bookings?.filter((b: any) => b.status === 'completed').length || 0;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.dark.tint} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello, {user.name.split(' ')[0]} 👋</Text>
          <Text style={styles.subtitle}>Ready for a shiny car?</Text>
        </View>
        <View style={styles.statPill}>
          <AppIcon name="award" size={14} color={Colors.dark.tint} />
          <Text style={styles.statPillText}>{totalWashes} washes</Text>
        </View>
      </View>

      {hasActive && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.sectionTitle}>
            {activeBookings.length > 1 ? `Active Requests (${activeBookings.length})` : 'Active Request'}
          </Text>
          {activeBookings.map((b: any) => (
            <ActiveBookingBanner key={b.id} booking={b} />
          ))}
        </View>
      )}

      {!hasActive && (
        <TouchableOpacity
          style={styles.heroCard}
          onPress={() => router.push('/book')}
          activeOpacity={0.9}
        >
          <View style={styles.heroIconWrap}>
            <AppIcon name="droplet" size={40} color="#FFF" />
          </View>
          <Text style={styles.heroTitle}>Book Car Clean</Text>
          <Text style={styles.heroSubtitle}>
            Tap to find the nearest available cleaner — usually arrives in under 30 min
          </Text>
          <View style={styles.heroCta}>
            <Text style={styles.heroCtaText}>Book Now</Text>
            <AppIcon name="arrow-right" size={16} color="#FFF" />
          </View>
        </TouchableOpacity>
      )}

      {hasActive && (
        <TouchableOpacity
          style={[styles.heroCard, styles.heroCardSmall]}
          onPress={() => router.push('/book')}
          activeOpacity={0.9}
        >
          <AppIcon name="plus-circle" size={22} color="#FFF" />
          <Text style={styles.heroCtaText}>Book Another Car</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.packagePromo} onPress={() => router.push('/packages')} activeOpacity={0.9}>
        <AppIcon name="tag" size={22} color={Colors.dark.success} />
        <View style={{ flex: 1 }}>
          <Text style={styles.packagePromoTitle}>Start a daily wash package</Text>
          <Text style={styles.packagePromoSub}>One wash a day, same washer, at a time you pick. Pay weekly — nothing upfront.</Text>
        </View>
        <AppIcon name="chevron-right" size={18} color={Colors.dark.tabIconDefault} />
      </TouchableOpacity>

      {(dailyPackages.length > 0 || upcomingBookings.length > 0) && (
        <>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          {dailyPackages.map((s: any) => {
            const next = (s.days ?? []).find((d: any) => ['scheduled', 'accepted', 'arrived', 'in_progress'].includes(d.status));
            return (
              <TouchableOpacity key={`pkg-${s.id}`} style={styles.pkgEntry} onPress={() => router.push(`/package/${s.id}`)} activeOpacity={0.85}>
                <View style={styles.pkgEntryIcon}><AppIcon name="calendar" size={20} color={Colors.dark.tint} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgEntryTitle}>Daily package · {minutesLabel(s.dailyMinutes)} · {s.daysCompleted ?? 0}/{s.washesTotal}</Text>
                  <Text style={styles.pkgEntrySub} numberOfLines={1}>
                    {s.status === 'unassigned' ? 'Washer didn’t accept — tap to fix' : s.cleanerName || 'Finding your washer…'}
                    {next ? ` · next ${fmtShort(next.scheduledAt)}` : ''}
                  </Text>
                </View>
                {s.amountDue > 0
                  ? <View style={styles.dueBadge}><Text style={styles.dueBadgeText}>₹{s.amountDue} due</Text></View>
                  : <AppIcon name="chevron-right" size={18} color={Colors.dark.tabIconDefault} />}
              </TouchableOpacity>
            );
          })}
          {upcomingBookings.map((b: any) => (
            <TouchableOpacity key={`bk-${b.id}`} style={styles.pkgEntry} onPress={() => router.push(`/booking/${b.id}`)} activeOpacity={0.85}>
              <View style={styles.pkgEntryIcon}><AppIcon name="clock" size={20} color={Colors.dark.tint} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pkgEntryTitle} numberOfLines={1}>{fmtShort(b.scheduledAt)}</Text>
                <Text style={styles.pkgEntrySub} numberOfLines={1}>{b.customerAddress}</Text>
              </View>
              <AppIcon name="chevron-right" size={18} color={Colors.dark.tabIconDefault} />
            </TouchableOpacity>
          ))}
        </>
      )}

      {recentBookings.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recent Bookings</Text>
          {recentBookings.map((booking: any) => (
            <TouchableOpacity
              key={booking.id}
              style={styles.bookingCard}
              onPress={() => router.push(`/booking/${booking.id}`)}
            >
              <View style={styles.bookingCardLeft}>
                <Text style={styles.bookingAddress} numberOfLines={1}>{booking.customerAddress}</Text>
                {(booking.cleanerName ?? booking.washerName) && (
                  <Text style={styles.bookingWasher}>{booking.cleanerName ?? booking.washerName}</Text>
                )}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(booking.status) }]}>
                <Text style={styles.statusText}>{getStatusLabel(booking.status)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {!isLoading && bookings?.length === 0 && (
        <View style={styles.emptyState}>
          <AppIcon name="droplet" size={48} color={Colors.dark.border} />
          <Text style={styles.emptyTitle}>No bookings yet</Text>
          <Text style={styles.emptySubtitle}>Book your first car wash above</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function CleanerDashboard() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [cleanerCoords, setCleanerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showLocationMap, setShowLocationMap] = useState(false);
  const [locatingForMap, setLocatingForMap] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['cleanerProfile'],
    queryFn: () => apiFetch('/api/cleaners/me'),
    // Retry transient failures (cold-start timeout / network / 5xx) so the
    // dashboard recovers on its own, but don't hammer on a real 4xx.
    retry: (failureCount, err: any) => failureCount < 3 && ![400, 401, 403, 404].includes(err?.status),
  });

  const { data: bookings, isLoading: bookingsLoading, refetch } = useQuery({
    queryKey: ['bookings', 'cleaner'],
    queryFn: () => apiFetch('/api/bookings?role=cleaner'),
    refetchInterval: 4000,
  });

  const activeJobs = bookings?.filter((b: any) => ['accepted', 'arrived', 'in_progress'].includes(b.status)) || [];
  // A cleaner handles one job at a time. While a job is active, hide incoming
  // requests entirely — the others "go away". When that job ends (completed or
  // cancelled), any still-searching requests dispatched to this cleaner come
  // back automatically on the next poll.
  const incomingRequests = (activeJobs.length > 0
    ? []
    : (bookings?.filter((b: any) => b.status === 'searching') || [])
  ).map((b: any) => ({
    ...b,
    distanceKm: (cleanerCoords && b.customerLat != null && b.customerLng != null)
      ? haversineKm(cleanerCoords.lat, cleanerCoords.lng, b.customerLat, b.customerLng)
      : undefined,
  }));
  const pastJobs = bookings?.filter((b: any) => ['completed', 'cancelled'].includes(b.status)) || [];
  // Upcoming scheduled/committed jobs (package & scheduled bookings assigned to this
  // cleaner) so he knows where and when to go next.
  const scheduledJobs = (bookings?.filter((b: any) =>
    b.status === 'scheduled' || (b.status === 'accepted' && b.scheduledAt && new Date(b.scheduledAt).getTime() > Date.now() + 60_000)
  ) || []).sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  // Track bookings that were searching but got accepted by another cleaner while this
  // cleaner was looking at them — so we can show a "taken" notice instead of silently removing.
  const prevIncomingIdsRef = useRef<Set<number>>(new Set());
  const [takenByOtherBookings, setTakenByOtherBookings] = useState<any[]>([]);

  useEffect(() => {
    if (!bookings) return;
    const currentIds = new Set<number>(incomingRequests.map((b: any) => b.id));
    const newlyTaken: any[] = [];

    for (const prevId of prevIncomingIdsRef.current) {
      if (!currentIds.has(prevId)) {
        // This booking left the "searching" list — check if it's now accepted by another
        const booking = bookings.find((b: any) => b.id === prevId);
        // Only show "taken" if THIS cleaner did NOT accept it.
        // If this cleaner accepted it, the booking moves to activeJobs — don't treat
        // that as "taken by someone else."
        const isMine = activeJobs.some((j: any) => j.id === prevId);
        if (booking && booking.status === 'accepted' && !isMine) {
          newlyTaken.push(booking);
        }
      }
    }

    if (newlyTaken.length > 0) {
      setTakenByOtherBookings(prev => {
        const merged = [...prev];
        for (const b of newlyTaken) {
          if (!merged.find(x => x.id === b.id)) merged.push(b);
        }
        return merged;
      });
      // Auto-remove "taken" notices after 5 seconds
      const takenIds = newlyTaken.map(b => b.id);
      setTimeout(() => {
        setTakenByOtherBookings(prev => prev.filter(b => !takenIds.includes(b.id)));
      }, 5000);
    }

    prevIncomingIdsRef.current = currentIds;
  }, [bookings]);

  const toggleAvailability = useMutation({
    mutationFn: (available: boolean) => apiFetch('/api/cleaners/me', {
      method: 'PATCH',
      body: JSON.stringify({ available }),
    }),
    // Silent — switching the toggle off must never pop a warning/confirmation.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cleanerProfile'] }),
    onError: (e: any) => {
      // Can't go online while in a booking — tell him; otherwise stay silent.
      if (e?.code === 'in_booking') Alert.alert('You’re in a booking', e?.message || 'Finish or cancel your current booking to go online.');
      queryClient.invalidateQueries({ queryKey: ['cleanerProfile'] }); // snap the switch back
    },
  });

  // Working-hours slots (6AM–6PM IST, 24 half-hour slots).
  const [showSlots, setShowSlots] = useState(false);
  const availableSlots: number[] = Array.isArray(profile?.availableSlots) ? profile.availableSlots : [];
  const hasSchedule = availableSlots.length > 0;
  const nowSlot = currentIstSlot();
  const withinHours = !hasSchedule || (nowSlot >= 0 && availableSlots.includes(nowSlot));
  const effectiveOnline = (profile?.available ?? false) && withinHours;

  const saveSlots = useMutation({
    mutationFn: (slots: number[]) => apiFetch('/api/cleaners/me', {
      method: 'PATCH',
      body: JSON.stringify({ availableSlots: slots }),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cleanerProfile'] }); setShowSlots(false); },
    onError: (e: any) => Alert.alert('Error', e?.message || 'Could not save your hours.'),
  });

  // Track live GPS — requests permission immediately on mount, pushes coords to backend
  const { locationStatus, requestPermission } = useWasherLocation(profile?.available ?? false);

  // Keep cleaner's device coordinates fresh for distance calculations on booking cards
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    let ExpoLocation: typeof import('expo-location') | null = null;
    try { ExpoLocation = require('expo-location'); } catch { return; }

    const fetchCoords = async () => {
      try {
        const perm = await ExpoLocation!.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const { coords } = await ExpoLocation!.getCurrentPositionAsync({ accuracy: ExpoLocation!.Accuracy.Balanced });
        if (!cancelled) setCleanerCoords({ lat: coords.latitude, lng: coords.longitude });
      } catch { /* silent — distance just won't show */ }
    };

    fetchCoords();
    const timer = setInterval(fetchCoords, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const handleStatus = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) => {
      setPendingIds(prev => new Set(prev).add(id));
      return apiFetch(`/api/bookings/${id}/${action}`, { method: 'PATCH' });
    },
    onSuccess: (_data, { id }) => {
      setPendingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'cleaner'] });
    },
    onError: (_e: any, { id }) => {
      setPendingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      Alert.alert('Error', 'Could not update booking. Please try again.');
    },
  });

  // Global accept lock: a cleaner can only take ONE job. The ref is set
  // synchronously so a second simultaneous tap (on another request card) is
  // ignored before React can re-render — you cannot accept two at once.
  const acceptingRef = useRef(false);
  const [accepting, setAccepting] = useState(false);

  const handleAccept = (id: number) => {
    if (acceptingRef.current || activeJobs.length > 0) return;
    acceptingRef.current = true;
    setAccepting(true);
    handleStatus.mutate(
      { id, action: 'accept' },
      { onSettled: () => { acceptingRef.current = false; setAccepting(false); } },
    );
  };

  const handleDecline = (id: number) => handleStatus.mutate({ id, action: 'decline' });

  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // Cleaner backs out of an accepted job — server resets booking to "searching"
  // and auto-dispatches to next nearest cleaners so the customer isn't left waiting.
  const handleCleanerCancelJob = (bookingId: number) => {
    Alert.alert(
      'Cancel This Job?',
      'The customer will be notified and the system will search for another cleaner immediately.',
      [
        { text: 'No, Keep Job', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setCancellingId(bookingId);
            try {
              await apiFetch(`/api/bookings/${bookingId}/washer-cancel`, { method: 'PATCH' });
              await queryClient.invalidateQueries({ queryKey: ['bookings', 'cleaner'] });
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not cancel the booking. Please try again.');
            } finally {
              setCancellingId(null);
            }
          },
        },
      ]
    );
  };

  // Open the read-only informational map at the cleaner's current location.
  // Uses the coords we already track; if not available yet, fetch a fresh fix.
  const handleViewLocation = async () => {
    if (cleanerCoords) { setShowLocationMap(true); return; }
    if (Platform.OS === 'web') {
      Alert.alert('Location unavailable', 'Could not determine your current location.');
      return;
    }
    let ExpoLocation: typeof import('expo-location') | null = null;
    try { ExpoLocation = require('expo-location'); } catch { ExpoLocation = null; }
    if (!ExpoLocation) {
      Alert.alert('Location unavailable', 'Could not determine your current location.');
      return;
    }
    try {
      setLocatingForMap(true);
      const perm = await ExpoLocation.getForegroundPermissionsAsync();
      let granted = perm.status === 'granted';
      if (!granted) {
        const req = await ExpoLocation.requestForegroundPermissionsAsync();
        granted = req.status === 'granted';
      }
      if (!granted) {
        Alert.alert('Location needed', 'Enable location access to see your position on the map.');
        return;
      }
      const { coords } = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
      setCleanerCoords({ lat: coords.latitude, lng: coords.longitude });
      setShowLocationMap(true);
    } catch {
      Alert.alert('Location unavailable', 'Could not determine your current location. Please try again.');
    } finally {
      setLocatingForMap(false);
    }
  };

  if (profileLoading) return <ActivityIndicator style={{ marginTop: 60 }} color={Colors.dark.tint} />;

  return (
    <>
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={bookingsLoading} onRefresh={refetch} tintColor={Colors.dark.tint} />}
      showsVerticalScrollIndicator={false}
    >
      {/* One clear availability control — merges the old toggle + location boxes. */}
      <View style={[styles.availabilityCard, effectiveOnline && styles.availabilityCardOnline]}>
        <View style={{ flex: 1 }}>
          <View style={styles.availabilityRow}>
            <View style={[styles.statusDot, { backgroundColor: effectiveOnline ? Colors.dark.success : Colors.dark.tabIconDefault }]} />
            <Text style={styles.cardTitle}>
              {effectiveOnline ? "You're Online" : (profile?.available && !withinHours ? 'Off — outside your hours' : "You're Offline")}
            </Text>
          </View>
          <Text style={styles.cardSubtitle}>
            {!profile?.available
              ? 'Turn the toggle on to follow your schedule.'
              : withinHours
                ? 'Receiving bookings within 5 km. Switch off any time.'
                : 'You’ll auto go online at your next selected slot.'}
          </Text>

          {/* Working hours control (preference slots) */}
          <TouchableOpacity style={styles.viewMapRow} onPress={() => setShowSlots(true)} activeOpacity={0.7}>
            <AppIcon name="clock" size={14} color={Colors.dark.tint} />
            <Text style={styles.viewMapText}>
              {hasSchedule ? `Preference hours · ${availableSlots.length} slots` : 'Set your available hours'}
            </Text>
            <AppIcon name="chevron-right" size={14} color={Colors.dark.tint} />
          </TouchableOpacity>

          {/* Calendar of actual bookings on those slots */}
          <TouchableOpacity style={styles.viewMapRow} onPress={() => router.push('/calendar')} activeOpacity={0.7}>
            <AppIcon name="calendar" size={14} color={Colors.dark.tint} />
            <Text style={styles.viewMapText}>View my calendar (day / week / month)</Text>
            <AppIcon name="chevron-right" size={14} color={Colors.dark.tint} />
          </TouchableOpacity>

          {locationStatus === 'denied' && (
            <TouchableOpacity style={styles.locationWarnInline} onPress={requestPermission} activeOpacity={0.8}>
              <AppIcon name="map-pin-off" size={14} color="#F87171" />
              <Text style={styles.locationWarnText}>Location is off — tap to enable (required to receive bookings)</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.viewMapRow} onPress={handleViewLocation} activeOpacity={0.7} disabled={locatingForMap}>
            {locatingForMap
              ? <ActivityIndicator size="small" color={Colors.dark.tint} />
              : <AppIcon name="map-pin" size={14} color={Colors.dark.tint} />}
            <Text style={styles.viewMapText}>
              {locatingForMap ? 'Getting your location…' : 'View my location on the map'}
            </Text>
            {!locatingForMap && <AppIcon name="chevron-right" size={14} color={Colors.dark.tint} />}
          </TouchableOpacity>
        </View>
        <Switch
          value={profile?.available ?? false}
          onValueChange={(val) => toggleAvailability.mutate(val)}
          trackColor={{ false: Colors.dark.border, true: Colors.dark.success }}
          thumbColor="#FFF"
        />
      </View>

      {/* Mandatory working hours — no slots = no bookings at all */}
      {!hasSchedule && (
        <TouchableOpacity style={styles.slotsWarn} onPress={() => setShowSlots(true)} activeOpacity={0.85}>
          <AppIcon name="alert-triangle" size={18} color="#FBBF24" />
          <View style={{ flex: 1 }}>
            <Text style={styles.slotsWarnTitle}>Set your working hours</Text>
            <Text style={styles.slotsWarnSub}>Pick the slots you work so scheduled bookings only reach you then. Until you set them, you may get requests at any time of day.</Text>
          </View>
          <AppIcon name="chevron-right" size={16} color="#FBBF24" />
        </TouchableOpacity>
      )}

      {/* Incoming booking requests are handled by the full-screen IncomingBookingAlert overlay below */}
      {incomingRequests.length > 0 && (
        <View style={styles.incomingBanner}>
          <View style={styles.incomingBannerLeft}>
            <View style={styles.incomingDot} />
            <Text style={styles.incomingBannerText}>
              {incomingRequests.length} incoming request{incomingRequests.length > 1 ? 's' : ''} — check the alert
            </Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{incomingRequests.length}</Text>
          </View>
        </View>
      )}

      {/* Daily packages this washer serves — bills + payment confirmation */}
      <WasherPackages />

      {/* Upcoming scheduled bookings — where & when to go next */}
      {scheduledJobs.length > 0 && (
        <View style={{ marginTop: 20 }}>
          <Text style={styles.sectionTitle}>Upcoming Scheduled ({scheduledJobs.length})</Text>
          {scheduledJobs.map((b: any) => (
            <TouchableOpacity
              key={b.id}
              style={styles.scheduledCard}
              onPress={() => router.push(`/booking/${b.id}`)}
              activeOpacity={0.85}
            >
              <View style={styles.scheduledWhen}>
                <AppIcon name="clock" size={16} color={Colors.dark.tint} />
                <Text style={styles.scheduledTime}>
                  {new Date(b.scheduledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <View style={styles.scheduledRow}>
                <AppIcon name="map-pin" size={14} color={Colors.dark.tabIconDefault} />
                <Text style={styles.scheduledAddr} numberOfLines={2}>{b.customerAddress}</Text>
              </View>
              {b.customerName ? (
                <View style={styles.scheduledRow}>
                  <AppIcon name="user" size={14} color={Colors.dark.tabIconDefault} />
                  <Text style={styles.scheduledSub}>{b.customerName}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {incomingRequests.length === 0 && effectiveOnline && (
        <View style={styles.waitingCard}>
          <ActivityIndicator color={Colors.dark.tint} />
          <Text style={styles.waitingText}>Waiting for requests…</Text>
          <Text style={styles.waitingHint}>Refreshes automatically every few seconds</Text>
        </View>
      )}

      {activeJobs.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Active Jobs ({activeJobs.length})</Text>
          {activeJobs.map((b: any) => (
            <TouchableOpacity
              key={b.id}
              style={styles.activeJobCard}
              onPress={() => router.push(`/booking/${b.id}`)}
              activeOpacity={0.85}
            >
              <View style={styles.requestHeader}>
                <View style={[styles.requestIcon, { backgroundColor: getStatusColor(b.status) + '30' }]}>
                  <AppIcon name="map-pin" size={18} color={getStatusColor(b.status)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestAddress} numberOfLines={2}>{b.customerAddress}</Text>
                  <Text style={styles.requestCustomer}>{b.customerName}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(b.status) }]}>
                  <Text style={styles.statusText}>{getStatusLabel(b.status)}</Text>
                </View>
              </View>

              {/* Primary action button — navigates to booking detail */}
              <View style={[styles.actionBtn, { backgroundColor: getStatusColor(b.status) }]}>
                <AppIcon name="arrow-right" size={18} color="#FFF" />
                <Text style={styles.actionBtnText}>
                  {b.status === 'accepted'    ? 'Navigate & Mark Arrived' :
                   b.status === 'arrived'     ? 'Confirm OTP & Start' :
                   b.status === 'in_progress' ? 'Mark Complete' : 'View Details'}
                </Text>
              </View>

              {/* Cancel option — only available before arriving at the location */}
              {b.status === 'accepted' && (
                <TouchableOpacity
                  style={styles.cancelJobBtn}
                  onPress={() => handleCleanerCancelJob(b.id)}
                  disabled={cancellingId === b.id}
                  activeOpacity={0.75}
                >
                  {cancellingId === b.id
                    ? <ActivityIndicator size="small" color="#F87171" />
                    : <>
                        <AppIcon name="x-circle" size={15} color="#F87171" />
                        <Text style={styles.cancelJobBtnText}>Cancel This Job</Text>
                      </>}
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </>
      )}

      {pastJobs.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Recent History</Text>
          {pastJobs.slice(0, 5).map((b: any) => (
            <View key={b.id} style={styles.bookingCard}>
              <View style={styles.bookingCardLeft}>
                <Text style={styles.bookingAddress} numberOfLines={1}>{b.customerAddress}</Text>
                <Text style={styles.bookingWasher}>{b.customerName}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(b.status) }]}>
                <Text style={styles.statusText}>{getStatusLabel(b.status)}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>

    {/* Full-screen alert overlay — modal renders above everything */}
    <IncomingBookingAlert
      bookings={incomingRequests}
      takenByOtherBookings={takenByOtherBookings}
      pendingIds={pendingIds}
      accepting={accepting}
      onAccept={handleAccept}
      onDecline={handleDecline}
    />

    {/* Read-only informational map of the cleaner's current location */}
    <Modal
      visible={showLocationMap}
      animationType="slide"
      onRequestClose={() => setShowLocationMap(false)}
    >
      <View style={styles.locMapRoot}>
        <View style={[styles.locMapHeader, { paddingTop: (insets.top || 24) + 10 }]}>
          <TouchableOpacity
            onPress={() => setShowLocationMap(false)}
            style={styles.locMapBackBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <AppIcon name="arrow-left" size={22} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.locMapTitle}>My Location</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1 }}>
          {cleanerCoords && (
            <CurrentLocationMap latitude={cleanerCoords.lat} longitude={cleanerCoords.lng} />
          )}
        </View>
      </View>
    </Modal>

    <AvailabilityManager
      visible={showSlots}
      initialSlots={availableSlots}
      saving={saveSlots.isPending}
      onClose={() => setShowSlots(false)}
      onSave={(slots) => saveSlots.mutate(slots)}
    />
    </>
  );
}

function OwnerDashboard({ user }: { user: any }) {
  const { data: businesses, isLoading } = useQuery({
    queryKey: ['ownerBusiness'],
    queryFn: () => apiFetch('/api/carwash-owners'),
  });

  const business = businesses?.find((b: any) => b.userId === user.id);

  if (isLoading) return <ActivityIndicator style={{ marginTop: 60 }} color={Colors.dark.tint} />;

  if (business) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.greeting}>Your Business</Text>
        </View>
        <View style={styles.activeJobCard}>
          <View style={styles.businessAvatar}>
            <AppIcon name="briefcase" size={32} color="#FFF" />
          </View>
          <Text style={[styles.greeting, { marginTop: 16 }]}>{business.businessName}</Text>
          <Text style={styles.subtitle}>{business.address}, {business.city}</Text>
          {business.description ? (
            <Text style={[styles.subtitle, { marginTop: 8 }]}>{business.description}</Text>
          ) : null}
          <View style={[styles.statusBadge, { backgroundColor: Colors.dark.success, alignSelf: 'flex-start', marginTop: 16 }]}>
            <Text style={styles.statusText}>Active Profile</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Register Business</Text>
        <Text style={styles.subtitle}>Set up your car wash profile</Text>
      </View>
      <View style={styles.emptyState}>
        <AppIcon name="briefcase" size={48} color={Colors.dark.border} />
        <Text style={styles.emptyTitle}>No business registered</Text>
        <Text style={styles.emptySubtitle}>Use the app to set up your business</Text>
      </View>
    </ScrollView>
  );
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  if (!user) return null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background, paddingTop: insets.top }}>
      {user.role === 'customer' && <CustomerDashboard user={user} />}
      {user.role === 'cleaner' && <CleanerDashboard />}
      {user.role === 'owner' && <OwnerDashboard user={user} />}
      {/* Build stamp — confirms the newest bundle is running (changes every update). */}
      <Text style={styles.buildStamp}>build · {BUILD_TAG}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  buildStamp: {
    position: 'absolute', bottom: 2, right: 8,
    color: Colors.dark.tabIconDefault, opacity: 0.5, fontSize: 10,
  },
  container: {
    flex: 1,
    padding: 20,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.dark.tabIconDefault,
    marginTop: 4,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  statPillText: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  pkgEntry: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.dark.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.dark.border },
  pkgEntryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.dark.tint + '22', alignItems: 'center', justifyContent: 'center' },
  pkgEntryTitle: { color: Colors.dark.text, fontSize: 14, fontWeight: '700' },
  pkgEntrySub: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 3 },
  dueBadge: { backgroundColor: '#FBBF2422', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  dueBadgeText: { color: '#FBBF24', fontSize: 12, fontWeight: '700' },
  slotsWarn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FBBF2415', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#FBBF2455' },
  slotsWarnTitle: { color: '#FBBF24', fontSize: 14, fontWeight: '700' },
  slotsWarnSub: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 3, lineHeight: 17 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  badge: {
    backgroundColor: Colors.dark.warning,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
  },
  activeBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activeBannerTitle: {
    color: Colors.dark.text,
    fontWeight: 'bold',
    fontSize: 15,
  },
  activeBannerSub: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
    marginTop: 2,
  },
  heroCard: {
    backgroundColor: Colors.dark.tint,
    padding: 24,
    borderRadius: 24,
    marginBottom: 24,
  },
  heroCardSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 10,
    marginBottom: 20,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
    marginBottom: 20,
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  heroCtaText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  bookingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  bookingCardLeft: {
    flex: 1,
    marginRight: 12,
  },
  bookingAddress: {
    color: Colors.dark.text,
    fontWeight: '600',
    fontSize: 14,
  },
  bookingWasher: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
    marginTop: 3,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    flexShrink: 0,
  },
  statusText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  emptyState: {
    alignItems: 'center',
    padding: 48,
    gap: 12,
  },
  emptyTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptySubtitle: {
    color: Colors.dark.tabIconDefault,
    fontSize: 14,
    textAlign: 'center',
  },
  availabilityCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    padding: 20,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  availabilityCardOnline: {
    borderColor: Colors.dark.success,
    backgroundColor: Colors.dark.success + '12',
  },
  locationWarnInline: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
  },
  locationWarnText: { color: '#F87171', fontSize: 12, flex: 1 },
  viewMapRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    alignSelf: 'flex-start',
  },
  viewMapText: { color: Colors.dark.tint, fontSize: 13, fontWeight: '600' },
  scheduledCard: {
    backgroundColor: Colors.dark.card, borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.dark.border, gap: 8,
  },
  scheduledWhen: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scheduledTime: { color: Colors.dark.tint, fontSize: 15, fontWeight: '700' },
  scheduledRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scheduledAddr: { flex: 1, color: Colors.dark.text, fontSize: 14 },
  scheduledSub: { color: Colors.dark.tabIconDefault, fontSize: 13 },
  locMapRoot: { flex: 1, backgroundColor: Colors.dark.background },
  locMapHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  locMapBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  locMapTitle: { fontSize: 17, fontWeight: '700', color: Colors.dark.text },
  packagePromo: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20,
    backgroundColor: Colors.dark.success + '12', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.dark.success + '44',
  },
  packagePromoTitle: { color: Colors.dark.text, fontWeight: '700', fontSize: 15 },
  packagePromoSub: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 3, lineHeight: 17 },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  locationCardGranted: {
    borderColor: '#166534',
    backgroundColor: '#052e16',
  },
  locationCardDenied: {
    borderColor: '#7f1d1d',
    backgroundColor: '#1c0a0a',
  },
  locationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4ADE80',
    marginRight: 12,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
  },
  locationHint: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    marginTop: 2,
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  cardSubtitle: {
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
    marginTop: 2,
  },
  requestCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: Colors.dark.warning + '60',
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  requestIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.tint + '20',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  requestAddress: {
    color: Colors.dark.text,
    fontWeight: '600',
    fontSize: 15,
    marginBottom: 4,
  },
  requestCustomer: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
  },
  requestMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  vehicleInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  vehicleTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.dark.tint + '15',
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.dark.tint + '30',
  },
  vehicleTagText: {
    fontSize: 11,
    color: Colors.dark.tint,
    fontWeight: '600',
  },
  pricePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.tint + '20',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  priceText: {
    color: Colors.dark.tint,
    fontWeight: 'bold',
    fontSize: 14,
  },
  requestNotes: {
    flex: 1,
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 14,
    gap: 8,
  },
  declineBtn: {
    backgroundColor: Colors.dark.error,
    flex: 0.45,
  },
  acceptBtn: {
    backgroundColor: Colors.dark.success,
    flex: 0.55,
  },
  completeBtn: {
    backgroundColor: Colors.dark.tint,
    marginTop: 8,
  },
  actionBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  incomingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E85D04' + '20',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E85D04' + '50',
  },
  incomingBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  incomingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E85D04',
  },
  incomingBannerText: {
    color: '#E85D04',
    fontWeight: '600',
    fontSize: 14,
  },
  waitingCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 18,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginBottom: 16,
  },
  waitingText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '600',
  },
  waitingHint: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
  },
  activeJobCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  cancelJobBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  cancelJobBtnText: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '700',
  },
  businessAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.dark.tint,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

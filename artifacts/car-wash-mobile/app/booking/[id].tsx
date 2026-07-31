import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, Animated, Easing, Linking, Platform, Vibration, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, BASE_URL } from '@/api/client';
import Colors from '@/constants/colors';
import AppIcon from '@/components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import SearchingMap, { type NearbyCleanerItem } from '@/components/SearchingMap';
import WasherTrackingMap from '@/components/WasherTrackingMap';

let Haptics: typeof import('expo-haptics') | null = null;
if (Platform.OS !== 'web') {
  try { Haptics = require('expo-haptics'); } catch { Haptics = null; }
}

function PulseRing({ delay, scale, color = Colors.dark.tint }: { delay: number; scale: number; color?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const s = anim.interpolate({ inputRange: [0, 1], outputRange: [1, scale] });
  const opacity = anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.7, 0.4, 0] });
  return <Animated.View style={[styles.pulseRing, { borderColor: color, transform: [{ scale: s }], opacity }]} />;
}

function OtpDisplay({ otp }: { otp: string }) {
  return (
    <View style={styles.otpBox}>
      {otp.split('').map((digit, i) => (
        <View key={i} style={styles.otpDigitBox}>
          <Text style={styles.otpDigit}>{digit}</Text>
        </View>
      ))}
    </View>
  );
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
function durationMin(startIso?: string | null, endIso?: string | null): number {
  if (!startIso || !endIso) return 0;
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

function openMapsNavigation(lat: number, lng: number, label: string) {
  const url = Platform.OS === 'ios'
    ? `maps://?daddr=${lat},${lng}&dirflg=d`
    : `google.navigation:q=${lat},${lng}`;
  Linking.canOpenURL(url).then(ok => {
    if (ok) {
      Linking.openURL(url);
    } else {
      // Fallback to browser maps
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
    }
  });
}

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isWasher = user?.role === 'cleaner';
  const [paymentReceived, setPaymentReceived] = useState(false);

  const cancelledAlertShown = useRef(false);

  const { data: booking, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => apiFetch(`/api/bookings/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (['searching', 'accepted', 'arrived', 'in_progress'].includes(status)) return 3000;
      return false;
    },
    enabled: !!id,
  });

  // Washer: if customer cancels the booking, detect it via polling and redirect home
  useEffect(() => {
    if (!isWasher || !booking || booking.status !== 'cancelled') return;
    if (cancelledAlertShown.current) return;
    cancelledAlertShown.current = true;
    Alert.alert(
      'Booking Cancelled',
      'The customer has cancelled this cleaning job.',
      [{ text: 'Go Home', onPress: () => { queryClient.invalidateQueries({ queryKey: ['bookings'] }); router.replace('/(tabs)'); } }],
      { cancelable: false }
    );
  }, [booking?.status, isWasher]);

  // Poll nearby cleaners while booking is in "searching" state (customer only)
  // Tight 3-second interval so cleaners who enter the 5km zone appear quickly
  const { data: nearbyData } = useQuery<{ washers: NearbyCleanerItem[] }>({
    queryKey: ['nearby-cleaners', id],
    queryFn: () => apiFetch(`/api/bookings/${id}/nearby-washers`),
    refetchInterval: 3000,
    enabled: !!id && !isWasher && booking?.status === 'searching',
    staleTime: 2500,
  });
  const nearbyWashers: NearbyCleanerItem[] = nearbyData?.washers ?? [];

  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: object }) =>
      apiFetch(`/api/bookings/${id}/${action}`, {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', id] }),
    onError: (e: any) => Alert.alert('Error', e.message),
  });

  const [cancelling,  setCancelling]  = useState(false);
  const [relocating,  setRelocating]  = useState(false);

  // ── Customer cancels (any state: searching / accepted / arrived) ──────────────
  // Always marks the booking as cancelled (no re-search), then goes home.
  // Platform-safe confirm dialog (Alert.alert is silent on web)
  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    } else {
      Alert.alert(title, message, [
        { text: 'No, Keep', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: onConfirm },
      ]);
    }
  };

  // Direct cancel (no dialog) — used from the searching full-screen layout
  // where the intent is already clear from the button label.
  const handleSearchingCancel = async () => {
    setCancelling(true);
    try {
      await apiFetch(`/api/bookings/${id}/cancel`, { method: 'PATCH' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['booking', id] }),
        queryClient.invalidateQueries({ queryKey: ['bookings'] }),
      ]);
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not cancel booking');
    } finally {
      setCancelling(false);
    }
  };

  // ── Customer drags pin to a new location while status === 'searching' ────────
  const handleLocationChange = (lat: number, lng: number) => {
    const doRelocate = async () => {
      setRelocating(true);
      try {
        await apiFetch(`/api/bookings/${id}/relocate`, {
          method: 'PATCH',
          body: JSON.stringify({ lat, lng }),
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['booking', id] }),
          queryClient.invalidateQueries({ queryKey: ['bookings'] }),
        ]);
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Could not move your location. Please try again.');
      } finally {
        setRelocating(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('You have changed your location.\n\nDo you want to continue finding car cleaners based on the new location?')) {
        doRelocate();
      }
    } else {
      Alert.alert(
        'Location Changed',
        'You have changed your location. Do you want to continue finding car cleaners based on the new location?',
        [
          { text: 'No', style: 'cancel' },
          { text: 'Yes', onPress: doRelocate },
        ],
      );
    }
  };

  const handleCustomerCancelBooking = () => {
    const isSearchingNow = booking?.status === 'searching';
    const doCancel = async () => {
      setCancelling(true);
      try {
        const endpoint = isSearchingNow
          ? `/api/bookings/${id}/cancel`
          : `/api/bookings/${id}/customer-cancel`;
        await apiFetch(endpoint, { method: 'PATCH' });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['booking', id] }),
          queryClient.invalidateQueries({ queryKey: ['bookings'] }),
        ]);
        router.replace('/(tabs)');
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Could not cancel booking');
      } finally {
        setCancelling(false);
      }
    };
    showConfirm(
      'Cancel Booking?',
      isSearchingNow
        ? 'This will cancel your request. Are you sure?'
        : 'This will cancel the booking and notify the cleaner. Are you sure?',
      doCancel,
    );
  };

  // ── Cleaner cancels their accepted job ───────────────────────────────────────
  // Server resets status → "searching" and dispatches to new cleaners automatically.
  // The cleaner goes home; the customer's screen stays on the booking and shows
  // the "searching again" state via polling (washerCancelledPreviously banner).
  const handleWasherCancel = () => {
    const doCancel = async () => {
      setCancelling(true);
      try {
        await apiFetch(`/api/bookings/${id}/washer-cancel`, { method: 'PATCH' });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['booking', id] }),
          queryClient.invalidateQueries({ queryKey: ['bookings'] }),
        ]);
        router.replace('/(tabs)');
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Could not cancel booking');
      } finally {
        setCancelling(false);
      }
    };
    showConfirm(
      'Cancel This Job?',
      'The customer will be notified and a new cleaner search will start immediately.',
      doCancel,
    );
  };

  const handleShareOtp = () => {
    Alert.alert(
      'Share OTP with Cleaner?',
      `Your OTP is ${booking?.serviceOtp}. Once shared, the cleaner will see it on their screen to start the service.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Share OTP', onPress: () => {
          Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          mutation.mutate({ action: 'share-otp' });
        }},
      ]
    );
  };

  const handleArrive = () => {
    Haptics?.notificationAsync(Haptics?.NotificationFeedbackType.Success);
    mutation.mutate({ action: 'arrive' });
  };

  const handleStartService = () => {
    if (!booking?.otpShared) {
      Alert.alert('Waiting for OTP', 'Please wait for the customer to share their OTP.');
      return;
    }
    Alert.alert(
      'Start Service',
      `Confirm OTP ${booking?.serviceOtp} to begin the clean?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm & Start', onPress: () => mutation.mutate({ action: 'start', body: { otp: booking?.serviceOtp } }) },
      ]
    );
  };

  const handleComplete = () => {
    Alert.alert('Complete Booking', 'Mark this clean as complete?', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Yes, Complete', onPress: () => mutation.mutate({ action: 'complete' }) },
    ]);
  };

  // Washer has an emergency and must stop mid-wash. The backend auto-prorates the
  // charge to the time spent, so the customer only pays for what was done.
  const handleStopEarly = () => {
    const doStop = () => mutation.mutate({ action: 'stop' });
    const msg = 'Stop the cleaning now (e.g. an emergency)? Only the time already spent will be charged — not the full amount.';
    if (Platform.OS === 'web') { if (window.confirm(msg)) doStop(); }
    else Alert.alert('Stop Cleaning?', msg, [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'Stop Cleaning', style: 'destructive', onPress: doStop },
    ]);
  };

  // Customer's assigned washer accepted but isn't showing up — search for a new one.
  const handleFindNewCleaner = () => {
    const doIt = () => mutation.mutate({ action: 'find-new-cleaner' });
    const msg = 'Drop the current cleaner and search for a new one? Your booking stays active — no charge.';
    if (Platform.OS === 'web') { if (window.confirm(msg)) doIt(); }
    else Alert.alert('Find a New Cleaner?', msg, [
      { text: 'Keep Waiting', style: 'cancel' },
      { text: 'Find New Cleaner', onPress: doIt },
    ]);
  };

  const handleNavigate = () => {
    if (!booking?.customerLat || !booking?.customerLng) {
      Alert.alert('No location', 'Customer location is not available.');
      return;
    }
    openMapsNavigation(booking.customerLat, booking.customerLng, booking.customerAddress);
  };

  if (isLoading || !booking) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={Colors.dark.tint} />
      </View>
    );
  }

  if (paymentReceived && isWasher && booking.status === 'completed') {
    return (
      <View style={[styles.root, styles.celebRoot, { paddingTop: insets.top || 40, paddingBottom: insets.bottom || 32 }]}>
        <View style={styles.celebIconRow}>
          <Text style={styles.celebEmoji}>🎉</Text>
          <Text style={styles.celebEmoji}>💰</Text>
          <Text style={styles.celebEmoji}>⭐</Text>
        </View>
        <Text style={styles.celebTitle}>Payment Received!</Text>
        <Text style={styles.celebSubtitle}>You're crushing it out there.</Text>

        <View style={styles.celebCard}>
          <View style={styles.celebStat}>
            <Text style={styles.celebStatValue}>₹{booking.amountCharged ?? booking.priceQuoted}</Text>
            <Text style={styles.celebStatLabel}>Earned Today</Text>
          </View>
          <View style={styles.celebDivider} />
          <View style={styles.celebStat}>
            <AppIcon name="star" size={28} color="#F59E0B" />
            <Text style={styles.celebStatLabel}>Ask for a 5★ review!</Text>
          </View>
        </View>

        <Text style={styles.celebMessage}>
          Every great clean builds your reputation.{'\n'}Keep up the amazing work! 🚗✨
        </Text>

        <TouchableOpacity
          style={styles.celebHomeBtn}
          activeOpacity={0.85}
          onPress={() => {
            queryClient.invalidateQueries({ queryKey: ['bookings'] });
            router.replace('/(tabs)');
          }}
        >
          <AppIcon name="home" size={22} color="#FFF" />
          <Text style={styles.celebHomeBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const s = booking.status;
  const isSearching    = s === 'searching';
  const isAccepted     = s === 'accepted';
  const isArrived      = s === 'arrived';
  const isInProgress   = s === 'in_progress';
  const isCancelled    = s === 'cancelled';
  const isCompleted    = s === 'completed';
  const isDone         = isCancelled || isCompleted;

  const headerTitle =
    isSearching   ? 'Finding Cleaner' :
    isAccepted    ? (isWasher ? 'Job Accepted' : 'Cleaner On The Way') :
    isArrived     ? (isWasher ? 'You\'ve Arrived' : 'Cleaner Arrived!') :
    isInProgress  ? 'Clean In Progress' :
    isCancelled   ? 'Request Cancelled' :
    isCompleted   ? 'Clean Complete' : 'Booking';

  // ── Full-screen searching layout (Ola/Uber style) ─────────────────────────────
  if (isSearching) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>

        {/* Google Map fills entire screen */}
        <SearchingMap
          customerLat={booking.customerLat}
          customerLng={booking.customerLng}
          nearbyWashers={isWasher ? [] : nearbyWashers}
          dispatchedCount={booking.dispatchedCount ?? 0}
          onLocationChange={isWasher ? undefined : handleLocationChange}
        />

        {/* Relocating spinner overlay */}
        {relocating && (
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'center', alignItems: 'center',
          }}>
            <View style={{ backgroundColor: Colors.dark.card, borderRadius: 16, padding: 28, alignItems: 'center', gap: 12 }}>
              <ActivityIndicator color={Colors.dark.tint} size="large" />
              <Text style={{ color: Colors.dark.text, fontSize: 15, fontWeight: '600' }}>Moving your location…</Text>
              <Text style={{ color: Colors.dark.tabIconDefault, fontSize: 12, textAlign: 'center' }}>Searching for nearby cleaners</Text>
            </View>
          </View>
        )}

        {/* Floating header — sits on top of the map */}
        <View style={[styles.searchingHeader, { paddingTop: (insets.top || 44) + 8 }]}>
          <View style={styles.searchingHeaderRow}>
            <ActivityIndicator color={Colors.dark.tint} size="small" />
            <Text style={styles.searchingHeaderTitle}>Finding Cleaner…</Text>
          </View>
        </View>

        {/* Floating bottom sheet — booking info + cancel */}
        <View style={[styles.searchingSheet, { paddingBottom: insets.bottom || 28 }]}>

          {!isWasher && booking.washerCancelledPreviously && (
            <View style={styles.washerCancelledBanner}>
              <AppIcon name="alert-circle" size={15} color="#F59E0B" />
              <Text style={styles.washerCancelledText}>
                Previous cleaner cancelled. Searching for a new one!
              </Text>
            </View>
          )}

          <Text style={styles.searchingTitle}>Searching Nearby…</Text>
          <Text style={styles.searchingSubtitle}>
            {nearbyWashers.length > 0
              ? `${nearbyWashers.length} cleaner${nearbyWashers.length !== 1 ? 's' : ''} in your area — waiting for acceptance`
              : booking.dispatchedCount
                ? `Notified ${booking.dispatchedCount} cleaner${booking.dispatchedCount !== 1 ? 's' : ''} — waiting for response`
                : 'Looking for cleaners near you…'}
          </Text>

          {/* Quick booking info chips */}
          <View style={styles.searchingChips}>
            <View style={styles.searchingChip}>
              <AppIcon name="map-pin" size={13} color={Colors.dark.tint} />
              <Text style={styles.searchingChipText} numberOfLines={1}>{booking.customerAddress}</Text>
            </View>
            <View style={styles.searchingChipRow}>
              {booking.vehicleType && (
                <View style={styles.searchingChip}>
                  <AppIcon name="car" size={13} color={Colors.dark.tint} />
                  <Text style={styles.searchingChipText}>{booking.vehicleType}</Text>
                </View>
              )}
              <View style={styles.searchingChip}>
                <AppIcon name="droplets" size={13} color={Colors.dark.tint} />
                <Text style={styles.searchingChipText}>
                  {booking.cleanType === 'both' ? 'Ext + Interior' : 'Exterior Only'}
                </Text>
              </View>
              <View style={styles.searchingChip}>
                <AppIcon name="banknote" size={13} color={Colors.dark.success} />
                <Text style={[styles.searchingChipText, { color: Colors.dark.success }]}>₹{booking.priceQuoted}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.searchingHint}>
            Searching for up to 5 minutes · First to accept gets the job
          </Text>

          {!isWasher && (
            <TouchableOpacity style={styles.searchingEditBtn} onPress={() => router.push(`/edit-booking/${id}`)} activeOpacity={0.75}>
              <AppIcon name="edit-2" size={14} color={Colors.dark.tint} />
              <Text style={styles.searchingEditText}>Edit vehicle / wash type</Text>
            </TouchableOpacity>
          )}

          {!isWasher && (
            <TouchableOpacity
              style={styles.searchingCancelBtn}
              onPress={handleSearchingCancel}
              disabled={cancelling}
              activeOpacity={0.75}
            >
              {cancelling
                ? <ActivityIndicator color={Colors.dark.text} size="small" />
                : <Text style={styles.searchingCancelText}>Cancel Request</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ── Full-screen live tracking map for customer (accepted / in_progress) ─────────
  if (!isWasher && (isAccepted || isInProgress) && booking.customerLat && booking.customerLng) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A101C' }}>

        {/* Full-screen Leaflet tracking map */}
        <WasherTrackingMap
          bookingId={id}
          customerLat={booking.customerLat}
          customerLng={booking.customerLng}
          washerName={booking.washerName ?? 'Your Cleaner'}
          status={s}
        />

        {/* Floating header */}
        <View style={[styles.searchingHeader, { paddingTop: (insets.top || 44) + 8 }]}>
          <View style={styles.searchingHeaderRow}>
            {isInProgress
              ? <AppIcon name="droplets" size={20} color={Colors.dark.success} />
              : <ActivityIndicator color={Colors.dark.tint} size="small" />}
            <Text style={styles.searchingHeaderTitle}>
              {isAccepted ? 'Cleaner On The Way' : 'Clean In Progress'}
            </Text>
          </View>
        </View>

        {/* Floating bottom sheet */}
        <View style={[styles.searchingSheet, { paddingBottom: insets.bottom || 28 }]}>

          {/* Cleaner info row */}
          <View style={styles.trackingCleanerRow}>
            <View style={styles.trackingCleanerAvatar}>
              <Text style={{ fontSize: 26 }}>🧹</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.trackingCleanerName}>{booking.washerName ?? 'Your Cleaner'}</Text>
              <Text style={styles.trackingCleanerSub}>
                {isAccepted ? 'Heading to your location' : 'Cleaning your car right now'}
              </Text>
            </View>
            <View style={[styles.trackingStatusBadge, {
              backgroundColor: isInProgress ? Colors.dark.success + '20' : Colors.dark.tint + '20',
            }]}>
              <View style={[styles.trackingStatusDot, {
                backgroundColor: isInProgress ? Colors.dark.success : Colors.dark.tint,
              }]} />
              <Text style={[styles.trackingStatusText, {
                color: isInProgress ? Colors.dark.success : Colors.dark.tint,
              }]}>
                {isInProgress ? 'Cleaning' : 'On way'}
              </Text>
            </View>
          </View>

          {isAccepted && (
            <Text style={styles.searchingHint}>Get your car ready — they'll arrive shortly</Text>
          )}
          {isInProgress && (
            <Text style={[styles.searchingHint, { color: Colors.dark.success }]}>Sit back and relax ☕</Text>
          )}

          {/* Cancel booking (only allowed when accepted, not once cleaning started) */}
          {isAccepted && (
            <TouchableOpacity
              style={styles.searchingCancelBtn}
              onPress={handleCustomerCancelBooking}
              disabled={cancelling}
              activeOpacity={0.75}
            >
              {cancelling
                ? <ActivityIndicator color={Colors.dark.text} size="small" />
                : <Text style={styles.searchingCancelText}>Cancel Booking</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top || 20 }]}>
      {/* Header */}
      <View style={styles.header}>
        {isDone ? (
          <TouchableOpacity onPress={() => { queryClient.invalidateQueries({ queryKey: ['bookings'] }); router.replace('/(tabs)'); }} style={styles.backBtn}>
            <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>

        {/* ── ACCEPTED state — CUSTOMER ── */}
        {isAccepted && !isWasher && (
          <>
            {booking.customerLat && booking.customerLng ? (
              <WasherTrackingMap
                bookingId={id}
                customerLat={booking.customerLat}
                customerLng={booking.customerLng}
                washerName={booking.washerName ?? 'Your Cleaner'}
                status="accepted"
              />
            ) : (
              <View style={[styles.radarCenter, styles.iconSuccess, { marginBottom: 32 }]}>
                <AppIcon name="check" size={48} color="#FFF" />
              </View>
            )}
            <Text style={[styles.mainTitle, { color: Colors.dark.success }]}>Cleaner Found!</Text>
            <Text style={styles.mainSubtitle}>{booking.washerName} is on the way</Text>
            <Text style={styles.hint}>Get your car ready — they'll arrive shortly</Text>
          </>
        )}

        {/* ── ACCEPTED state — WASHER ── */}
        {isAccepted && isWasher && (
          <>
            <View style={[styles.radarCenter, { backgroundColor: Colors.dark.tint, marginBottom: 24 }]}>
              <AppIcon name="navigation" size={40} color="#FFF" />
            </View>
            <Text style={[styles.mainTitle, { color: Colors.dark.tint }]}>Head to Customer</Text>
            <Text style={styles.mainSubtitle}>Tap Navigate to get directions</Text>
          </>
        )}

        {/* ── ARRIVED state — CUSTOMER ── */}
        {isArrived && !isWasher && (
          <>
            {booking.customerLat && booking.customerLng ? (
              <WasherTrackingMap
                bookingId={id}
                customerLat={booking.customerLat}
                customerLng={booking.customerLng}
                washerName={booking.washerName ?? 'Your Cleaner'}
                status="arrived"
              />
            ) : (
              <View style={[styles.radarCenter, { backgroundColor: '#7C3AED', marginBottom: 24 }]}>
                <AppIcon name="map-pin" size={40} color="#FFF" />
              </View>
            )}
            <Text style={[styles.mainTitle, { color: '#7C3AED' }]}>Cleaner is Here!</Text>
            <Text style={styles.mainSubtitle}>{booking.washerName} has arrived</Text>
            <Text style={styles.hint}>Share your OTP to start the clean</Text>

            {!booking.otpShared && booking.serviceOtp && (
              <View style={styles.otpSection}>
                <Text style={styles.otpLabel}>Your OTP</Text>
                <OtpDisplay otp={booking.serviceOtp} />
                <Text style={styles.otpHint}>Show this to your cleaner or press Share OTP below</Text>
              </View>
            )}
            {booking.otpShared && (
              <View style={[styles.otpSection, { borderColor: Colors.dark.success }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <AppIcon name="check-circle" size={20} color={Colors.dark.success} />
                  <Text style={[styles.otpLabel, { color: Colors.dark.success }]}>OTP Shared!</Text>
                </View>
                <Text style={styles.otpHint}>Waiting for cleaner to confirm and start…</Text>
              </View>
            )}
          </>
        )}

        {/* ── ARRIVED state — WASHER ── */}
        {isArrived && isWasher && (
          <>
            <View style={[styles.radarCenter, { backgroundColor: '#7C3AED', marginBottom: 24 }]}>
              <AppIcon name="map-pin" size={40} color="#FFF" />
            </View>
            <Text style={[styles.mainTitle, { color: '#7C3AED' }]}>You've Arrived!</Text>

            {!booking.otpShared && (
              <>
                <Text style={styles.mainSubtitle}>Waiting for customer to share OTP…</Text>
                <View style={styles.waitingOtpCard}>
                  <ActivityIndicator color={Colors.dark.tint} />
                  <Text style={styles.waitingOtpText}>Customer will share OTP to start service</Text>
                </View>
              </>
            )}

            {booking.otpShared && booking.serviceOtp && (
              <>
                <Text style={[styles.mainSubtitle, { color: Colors.dark.success }]}>OTP received from customer!</Text>
                <View style={styles.otpSection}>
                  <Text style={styles.otpLabel}>Customer's OTP</Text>
                  <OtpDisplay otp={booking.serviceOtp} />
                  <Text style={styles.otpHint}>Confirm this OTP to start the clean</Text>
                </View>
              </>
            )}
          </>
        )}

        {/* ── IN PROGRESS state ── */}
        {isInProgress && (
          <>
            {/* Customer sees live tracking map; washer sees wash animation */}
            {!isWasher && booking.customerLat && booking.customerLng ? (
              <WasherTrackingMap
                bookingId={id}
                customerLat={booking.customerLat}
                customerLng={booking.customerLng}
                washerName={booking.washerName ?? 'Your Cleaner'}
                status="in_progress"
              />
            ) : (
              <View style={[styles.radarContainer, { marginBottom: 24 }]}>
                <PulseRing delay={0} scale={2.2} color={Colors.dark.success} />
                <PulseRing delay={800} scale={2.8} color={Colors.dark.success} />
                <View style={[styles.radarCenter, { backgroundColor: Colors.dark.success }]}>
                  <AppIcon name="droplets" size={36} color="#FFF" />
                </View>
              </View>
            )}
            <Text style={[styles.mainTitle, { color: Colors.dark.success }]}>Clean in Progress</Text>
            <Text style={styles.mainSubtitle}>{isWasher ? 'Complete when done' : `${booking.washerName} is cleaning your car`}</Text>
            <Text style={styles.hint}>{isWasher ? 'Take your time — do a great job!' : 'Sit back and relax ☕'}</Text>
          </>
        )}

        {/* ── CANCELLED state ── */}
        {isCancelled && (
          <>
            <View style={[styles.radarCenter, { backgroundColor: Colors.dark.tabIconDefault, marginBottom: 24 }]}>
              <AppIcon name="x" size={48} color="#FFF" />
            </View>
            <Text style={[styles.mainTitle, { color: Colors.dark.tabIconDefault }]}>No Cleaners Available</Text>
            <Text style={styles.mainSubtitle}>All nearby cleaners are busy right now</Text>
            <Text style={styles.hint}>Please try again in a few minutes</Text>
          </>
        )}

        {/* ── COMPLETED state ── */}
        {isCompleted && (
          <>
            <View style={[styles.radarCenter, { backgroundColor: Colors.dark.tint, marginBottom: 16 }]}>
              <AppIcon name="check-circle" size={48} color="#FFF" />
            </View>
            <Text style={[styles.mainTitle, { color: Colors.dark.tint }]}>Wash Complete!</Text>
            <Text style={[styles.mainSubtitle, { marginBottom: 20 }]}>Your car is sparkling clean ✨</Text>

            {/* Payment Card – shown only to customer */}
            {!isWasher && (
              <View style={styles.paymentCard}>
                <View style={styles.paymentHeader}>
                  <AppIcon name="banknote" size={20} color={Colors.dark.tint} />
                  <Text style={styles.paymentTitle}>Payment</Text>
                </View>
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Amount Due</Text>
                  <Text style={styles.paymentAmount}>₹{booking.amountCharged ?? booking.priceQuoted}</Text>
                </View>
                {booking.stoppedEarly && (
                  <Text style={styles.earlyStopNote}>
                    Your cleaner had to end early — you're only charged for the time spent (original quote ₹{booking.priceQuoted}).
                  </Text>
                )}
                <View style={[styles.paymentRow, { marginTop: 6 }]}>
                  <Text style={styles.paymentLabel}>Pay Mode</Text>
                  <View style={styles.cashBadge}>
                    <AppIcon name="wallet" size={14} color="#10B981" />
                    <Text style={styles.cashBadgeText}>Cash to Cleaner</Text>
                  </View>
                </View>
                <Text style={styles.paymentNote}>
                  Please hand ₹{booking.amountCharged ?? booking.priceQuoted} in cash directly to your cleaner.
                </Text>
              </View>
            )}
          </>
        )}

        {/* ── Booking detail card (always visible) ── */}
        <View style={styles.detailCard}>
          <View style={styles.detailRow}>
            <AppIcon name="map-pin" size={16} color={Colors.dark.tint} />
            <Text style={styles.detailText} numberOfLines={2}>{booking.customerAddress}</Text>
          </View>
          {isWasher && booking.customerName && (
            <View style={styles.detailRow}>
              {booking.customerAvatar
                ? <Image source={{ uri: `${BASE_URL}${booking.customerAvatar}` }} style={styles.personAvatar} />
                : <View style={[styles.personAvatar, styles.personAvatarFallback]}>
                    <Text style={styles.personAvatarText}>{booking.customerName[0].toUpperCase()}</Text>
                  </View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.detailText}>{booking.customerName}</Text>
                {booking.customerPhone ? <Text style={[styles.detailText, { fontSize: 12, color: Colors.dark.tabIconDefault }]}>{booking.customerPhone}</Text> : null}
              </View>
            </View>
          )}
          {!isWasher && booking.washerName && (
            <View style={styles.detailRow}>
              {booking.washerAvatar
                ? <Image source={{ uri: `${BASE_URL}${booking.washerAvatar}` }} style={styles.personAvatar} />
                : <View style={[styles.personAvatar, styles.personAvatarFallback]}>
                    <Text style={styles.personAvatarText}>{booking.washerName[0].toUpperCase()}</Text>
                  </View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.detailText}>{booking.washerName}</Text>
                {booking.washerPhone ? <Text style={[styles.detailText, { fontSize: 12, color: Colors.dark.tabIconDefault }]}>{booking.washerPhone}</Text> : null}
              </View>
            </View>
          )}
          {booking.vehicleType && (
            <View style={styles.detailRow}>
              <AppIcon name="truck" size={16} color={Colors.dark.tint} />
              <Text style={styles.detailText}>{booking.vehicleType}</Text>
            </View>
          )}
          {(booking.cleanType ?? booking.washType) && (
            <View style={styles.detailRow}>
              <AppIcon name="droplet" size={16} color={Colors.dark.tint} />
              <Text style={styles.detailText}>{(booking.cleanType ?? booking.washType) === 'both' ? 'Exterior + Interior' : 'Exterior Only'}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <AppIcon name="tag" size={16} color={Colors.dark.tint} />
            <Text style={styles.detailText}>
              ₹{booking.amountCharged ?? booking.priceQuoted}
              {booking.amountCharged != null && booking.amountCharged !== booking.priceQuoted ? ` (of ₹${booking.priceQuoted})` : ''}
            </Text>
          </View>
          {booking.serviceStartedAt && (
            <View style={styles.detailRow}>
              <AppIcon name="clock" size={16} color={Colors.dark.tint} />
              <Text style={styles.detailText}>
                Started {fmtTime(booking.serviceStartedAt)}
                {booking.completedAt ? `  ·  Ended ${fmtTime(booking.completedAt)}` : ''}
                {booking.serviceStartedAt && booking.completedAt ? `  (${durationMin(booking.serviceStartedAt, booking.completedAt)} min)` : ''}
              </Text>
            </View>
          )}
          {booking.stoppedEarly && (
            <View style={styles.detailRow}>
              <AppIcon name="alert-triangle" size={16} color="#F59E0B" />
              <Text style={[styles.detailText, { color: '#F59E0B' }]}>Ended early by {booking.stoppedBy === 'customer' ? 'customer' : 'cleaner'} — charged for time spent</Text>
            </View>
          )}

          {['accepted', 'arrived', 'in_progress'].includes(booking.status) && (isWasher ? booking.customerName : booking.washerName) && (
            <TouchableOpacity style={styles.chatBtn} onPress={() => router.push(`/chat/${id}`)} activeOpacity={0.8}>
              <AppIcon name="message-circle" size={18} color={Colors.dark.tint} />
              <Text style={styles.chatBtnText}>Message {isWasher ? booking.customerName : booking.washerName}</Text>
              <AppIcon name="chevron-right" size={16} color={Colors.dark.tabIconDefault} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Footer actions ── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom || 24 }]}>

        {/* CUSTOMER: Share OTP when washer arrived */}
        {isArrived && !isWasher && !booking.otpShared && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleShareOtp} disabled={mutation.isPending}>
            {mutation.isPending
              ? <ActivityIndicator color="#FFF" />
              : <><AppIcon name="send" size={20} color="#FFF" /><Text style={styles.primaryBtnText}>Share OTP with Cleaner</Text></>}
          </TouchableOpacity>
        )}

        {/* CUSTOMER: cleaner accepted but not showing up → find another (no charge) */}
        {(isAccepted || isArrived) && !isWasher && (
          <TouchableOpacity style={styles.findNewBtn} onPress={handleFindNewCleaner} disabled={mutation.isPending}>
            <AppIcon name="refresh-cw" size={18} color="#FFF" />
            <Text style={styles.findNewBtnText}>Search for a new cleaner</Text>
          </TouchableOpacity>
        )}

        {/* CUSTOMER: Cancel when cleaner accepted/arrived (free — no charge) */}
        {(isAccepted || isArrived) && !isWasher && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={handleCustomerCancelBooking}
            disabled={cancelling}
          >
            {cancelling
              ? <ActivityIndicator color={Colors.dark.text} />
              : <Text style={styles.cancelBtnText}>Cancel Booking (no charge)</Text>}
          </TouchableOpacity>
        )}

        {/* WASHER: Navigate + Arrived buttons when accepted */}
        {isAccepted && isWasher && (
          <>
            <View style={styles.washerActionRow}>
              <TouchableOpacity style={[styles.navBtn]} onPress={handleNavigate} activeOpacity={0.8}>
                <AppIcon name="navigation" size={22} color="#FFF" />
                <Text style={styles.navBtnText}>Navigate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.arrivedBtn]}
                onPress={handleArrive}
                disabled={mutation.isPending}
                activeOpacity={0.8}
              >
                {mutation.isPending
                  ? <ActivityIndicator color="#FFF" />
                  : <><AppIcon name="map-pin" size={22} color="#FFF" /><Text style={styles.arrivedBtnText}>I've Arrived</Text></>}
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 10 }]}
              onPress={handleWasherCancel}
              disabled={cancelling}
            >
              {cancelling
                ? <ActivityIndicator color={Colors.dark.text} />
                : <Text style={styles.cancelBtnText}>Can't Do This Job</Text>}
            </TouchableOpacity>
          </>
        )}

        {/* WASHER: Start Service when OTP shared */}
        {isArrived && isWasher && (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, !booking.otpShared && styles.primaryBtnDisabled]}
              onPress={handleStartService}
              disabled={mutation.isPending || !booking.otpShared}
            >
              {mutation.isPending
                ? <ActivityIndicator color="#FFF" />
                : <><AppIcon name="check-circle" size={20} color="#FFF" /><Text style={styles.primaryBtnText}>{booking.otpShared ? 'Confirm OTP & Start Clean' : 'Waiting for Customer OTP…'}</Text></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 10 }]}
              onPress={handleWasherCancel}
              disabled={cancelling}
            >
              {cancelling
                ? <ActivityIndicator color={Colors.dark.text} />
                : <Text style={styles.cancelBtnText}>Can't Do This Job</Text>}
            </TouchableOpacity>
          </>
        )}

        {/* WASHER: Complete when in progress */}
        {isInProgress && isWasher && (
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: Colors.dark.tint }]} onPress={handleComplete} disabled={mutation.isPending}>
            {mutation.isPending
              ? <ActivityIndicator color="#FFF" />
              : <><AppIcon name="check-circle" size={20} color="#FFF" /><Text style={styles.primaryBtnText}>Mark Complete</Text></>}
          </TouchableOpacity>
        )}

        {/* EITHER PARTY: Stop cleaning mid-service (emergency) — charged only for
            time spent. Distinct from Cancel (which is free). */}
        {isInProgress && (
          <TouchableOpacity style={styles.stopBtn} onPress={handleStopEarly} disabled={mutation.isPending}>
            <AppIcon name="alert-triangle" size={18} color="#F59E0B" />
            <Text style={styles.stopBtnText}>Stop cleaning (charged for time spent)</Text>
          </TouchableOpacity>
        )}

        {/* CUSTOMER: Completed – Leave Feedback + Done */}
        {isCompleted && !isWasher && (
          <View style={styles.completedActions}>
            <TouchableOpacity
              style={styles.feedbackBtn}
              activeOpacity={0.85}
              onPress={() => router.push(`/feedback/${id}`)}
            >
              <AppIcon name="star" size={20} color="#FFF" />
              <Text style={styles.feedbackBtnText}>Rate Your Cleaner</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => { queryClient.invalidateQueries({ queryKey: ['bookings'] }); router.replace('/(tabs)'); }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* WASHER: Completed – Payment Received */}
        {isCompleted && isWasher && (
          <TouchableOpacity
            style={styles.paymentReceivedBtn}
            activeOpacity={0.85}
            onPress={() => setPaymentReceived(true)}
          >
            <AppIcon name="banknote" size={22} color="#FFF" />
            <Text style={styles.paymentReceivedBtnText}>Payment Received  ₹{booking.amountCharged ?? booking.priceQuoted}</Text>
          </TouchableOpacity>
        )}

        {/* Cancelled – Try Again */}
        {isCancelled && (
          <TouchableOpacity style={styles.doneBtn} onPress={() => { queryClient.invalidateQueries({ queryKey: ['bookings'] }); router.replace('/(tabs)'); }}>
            <Text style={styles.doneBtnText}>Try Again</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  backBtn: { padding: 8, width: 40 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.dark.text },
  content: {
    flex: 1, alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16,
    gap: 0,
  },
  radarContainer: {
    width: 180, height: 180,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 32,
  },
  pulseRing: {
    position: 'absolute', width: 80, height: 80,
    borderRadius: 40, borderWidth: 2,
    backgroundColor: 'transparent',
  },
  radarCenter: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.dark.tint,
    alignItems: 'center', justifyContent: 'center',
  },
  iconSuccess: { backgroundColor: Colors.dark.success },
  mainTitle: { fontSize: 26, fontWeight: 'bold', color: Colors.dark.text, textAlign: 'center', marginBottom: 8 },
  mainSubtitle: { fontSize: 15, color: Colors.dark.tabIconDefault, textAlign: 'center', marginBottom: 6 },
  hint: { fontSize: 13, color: Colors.dark.border, textAlign: 'center', marginBottom: 24 },
  // ── Full-screen searching layout styles ─────────────────────────────────────
  searchingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 18,
    backgroundColor: 'rgba(10,16,28,0.80)',
  },
  searchingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchingHeaderTitle: {
    color: Colors.dark.text,
    fontSize: 17,
    fontWeight: '700',
  },
  searchingSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 22,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 24,
  },
  searchingTitle: {
    color: Colors.dark.text,
    fontSize: 22,
    fontWeight: '800',
  },
  searchingSubtitle: {
    color: Colors.dark.tabIconDefault,
    fontSize: 14,
    lineHeight: 20,
    marginTop: -4,
  },
  searchingChips: {
    gap: 8,
  },
  searchingChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  searchingChipText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  searchingHint: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.7,
  },
  searchingCancelBtn: {
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginTop: 2,
  },
  searchingCancelText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '600',
  },
  searchingEditBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, marginBottom: 8,
  },
  searchingEditText: { color: Colors.dark.tint, fontSize: 14, fontWeight: '600' },

  trackingCleanerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  trackingCleanerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.dark.border,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.dark.tint + '40',
  },
  trackingCleanerName: {
    color: Colors.dark.text,
    fontSize: 17,
    fontWeight: '700',
  },
  trackingCleanerSub: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
    marginTop: 2,
  },
  trackingStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  trackingStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  trackingStatusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  washerCancelledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    width: '100%',
  },
  washerCancelledText: {
    flex: 1,
    fontSize: 13,
    color: '#F59E0B',
    fontWeight: '500',
    lineHeight: 18,
  },
  otpSection: {
    width: '100%',
    marginTop: 16,
    padding: 20,
    borderRadius: 18,
    backgroundColor: Colors.dark.card,
    borderWidth: 1.5,
    borderColor: '#7C3AED' + '60',
    alignItems: 'center',
  },
  otpLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.dark.tabIconDefault,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 14,
  },
  otpBox: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  otpDigitBox: {
    width: 52, height: 64,
    borderRadius: 12,
    backgroundColor: Colors.dark.background,
    borderWidth: 2,
    borderColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: { fontSize: 30, fontWeight: 'bold', color: '#7C3AED' },
  otpHint: { fontSize: 12, color: Colors.dark.tabIconDefault, textAlign: 'center' },
  waitingOtpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  waitingOtpText: { color: Colors.dark.tabIconDefault, fontSize: 14, flex: 1 },
  detailCard: {
    width: '100%', marginTop: 'auto',
    backgroundColor: Colors.dark.card,
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.dark.border,
    gap: 10,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.dark.border,
  },
  chatBtnText: { flex: 1, color: Colors.dark.tint, fontWeight: '600', fontSize: 14 },
  detailText: { color: Colors.dark.text, fontSize: 14, flexShrink: 1 },
  personAvatar: { width: 36, height: 36, borderRadius: 18 },
  personAvatarFallback: { backgroundColor: Colors.dark.tint, justifyContent: 'center' as const, alignItems: 'center' as const },
  personAvatarText: { color: '#FFF', fontWeight: 'bold' as const, fontSize: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  cancelBtn: {
    backgroundColor: Colors.dark.card,
    borderRadius: 14, padding: 16,
    alignItems: 'center',
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  cancelBtnText: { color: Colors.dark.text, fontWeight: '600', fontSize: 15 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: Colors.dark.success,
    borderRadius: 14, padding: 16,
  },
  primaryBtnDisabled: { backgroundColor: Colors.dark.border },
  primaryBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  endEarlyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 10, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  endEarlyBtnText: { color: Colors.dark.tabIconDefault, fontWeight: '600', fontSize: 14 },
  findNewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.dark.tint, borderRadius: 14, paddingVertical: 15, marginBottom: 10,
  },
  findNewBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 10, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  stopBtnText: { color: '#F59E0B', fontWeight: '700', fontSize: 14 },
  earlyStopNote: { color: '#F59E0B', fontSize: 12, marginTop: 8, lineHeight: 17 },
  washerActionRow: { flexDirection: 'row', gap: 10 },
  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: Colors.dark.tint,
    borderRadius: 14, padding: 16,
  },
  navBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  arrivedBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#7C3AED',
    borderRadius: 14, padding: 16,
  },
  arrivedBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  doneBtn: {
    backgroundColor: Colors.dark.tint, borderRadius: 14, padding: 16, alignItems: 'center',
  },
  doneBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },

  completedActions: { gap: 12 },

  feedbackBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F59E0B', borderRadius: 14, padding: 16,
  },
  feedbackBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },

  paymentCard: {
    backgroundColor: Colors.dark.card, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: Colors.dark.border, marginBottom: 16,
  },
  paymentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14,
  },
  paymentTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  paymentRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  paymentLabel: { fontSize: 14, color: Colors.dark.tabIconDefault },
  paymentAmount: { fontSize: 28, fontWeight: '800', color: Colors.dark.text },
  cashBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#10B98122', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  cashBadgeText: { color: '#10B981', fontWeight: '600', fontSize: 13 },
  paymentNote: {
    marginTop: 14, fontSize: 12, color: Colors.dark.tabIconDefault, lineHeight: 18,
    borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 12,
  },

  paymentReceivedBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#10B981', borderRadius: 14, padding: 18,
  },
  paymentReceivedBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 17 },

  celebRoot: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
  },
  celebIconRow: {
    flexDirection: 'row', gap: 12, marginBottom: 24,
  },
  celebEmoji: { fontSize: 52 },
  celebTitle: {
    fontSize: 34, fontWeight: '900', color: Colors.dark.text,
    textAlign: 'center', marginBottom: 8,
  },
  celebSubtitle: {
    fontSize: 17, color: Colors.dark.tabIconDefault,
    textAlign: 'center', marginBottom: 32,
  },
  celebCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.dark.card, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.dark.border,
    paddingVertical: 24, paddingHorizontal: 32,
    marginBottom: 28, width: '100%',
  },
  celebStat: { flex: 1, alignItems: 'center', gap: 6 },
  celebStatValue: { fontSize: 36, fontWeight: '900', color: '#10B981' },
  celebStatLabel: { fontSize: 13, color: Colors.dark.tabIconDefault, textAlign: 'center' },
  celebDivider: { width: 1, height: 56, backgroundColor: Colors.dark.border, marginHorizontal: 16 },
  celebMessage: {
    fontSize: 15, color: Colors.dark.tabIconDefault,
    textAlign: 'center', lineHeight: 24, marginBottom: 40,
  },
  celebHomeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.dark.tint, borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 40, width: '100%',
  },
  celebHomeBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 17 },
});

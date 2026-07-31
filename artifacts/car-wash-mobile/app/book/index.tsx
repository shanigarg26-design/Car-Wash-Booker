import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { apiFetch, BASE_URL } from '@/api/client';
import Colors from '@/constants/colors';
import AppIcon from '@/components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapPickerView from '@/components/MapPickerView';
import type { MapPickerViewRef, PickedLocation } from '@/components/MapPickerView';

const VEHICLE_TYPES = [
  { label: 'Small\nHatchback', key: 'Small Hatchback', icon: '🚗' },
  { label: 'Premium\nHatchback', key: 'Premium Hatchback', icon: '🚙' },
  { label: 'Compact\nSedan', key: 'Compact Sedan', icon: '🚘' },
  { label: 'Premium\nSedan', key: 'Premium Sedan', icon: '🏎️' },
  { label: 'Compact\nSUV', key: 'Compact SUV', icon: '🚐' },
  { label: 'Mid-Size\nSUV', key: 'Mid-Size SUV', icon: '🚌' },
  { label: 'Large\nSUV', key: 'Large SUV', icon: '🚑' },
  { label: 'Luxury', key: 'Luxury', icon: '🏅' },
];

const PRICING: Record<string, { exterior: number; both: number }> = {
  'Small Hatchback':   { exterior: 120, both: 220 },
  'Premium Hatchback': { exterior: 140, both: 260 },
  'Compact Sedan':     { exterior: 160, both: 300 },
  'Premium Sedan':     { exterior: 180, both: 320 },
  'Compact SUV':       { exterior: 200, both: 350 },
  'Mid-Size SUV':      { exterior: 230, both: 400 },
  'Large SUV':         { exterior: 280, both: 500 },
  'Luxury':            { exterior: 350, both: 700 },
};

type WashType = 'exterior' | 'both';

export default function BookScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<'detecting' | 'done' | 'failed'>('detecting');
  const [showMapModal, setShowMapModal] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<PickedLocation | null>(null);

  const [notes, setNotes] = useState('');
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [washType, setWashType] = useState<WashType>('exterior');
  const [scheduleAt, setScheduleAt] = useState<string | null>(null); // null = book now
  const [quantity, setQuantity] = useState(1); // how many cars of this type to book

  /* ── Reverse-geocode lat/lng → human address via our API server (OSM) ── */
  const reverseGeocodeCoords = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(`${BASE_URL}/api/geocode/reverse?lat=${lat}&lon=${lng}`);
      const data = await res.json();
      if (data?.address) {
        const a = data.address;
        const parts = [
          a.amenity || a.road || a.pedestrian || a.footway,
          a.suburb || a.neighbourhood || a.quarter,
          a.city || a.town || a.village || a.county,
          a.state,
        ].filter(Boolean);
        if (parts.length) return parts.join(', ');
        if (data.display_name) return data.display_name;
      }
    } catch {}
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  };

  /* ── Auto-detect on mount: GPS → browser geo → server IP lookup ── */
  useEffect(() => {
    (async () => {
      setLocationStatus('detecting');

      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

      const isWeb = Platform.OS === 'web';

      // ── Step 1: native GPS via expo-location (iOS / Android only) ──
      if (!isWeb) {
        try {
          const { status } = await withTimeout(Location.requestForegroundPermissionsAsync(), 8000);
          if (status === 'granted') {
            const pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 12000);
            const { latitude, longitude } = pos.coords;
            const address = await reverseGeocodeCoords(latitude, longitude);
            setLocation({ latitude, longitude, address });
            setLocationStatus('done');
            console.log('[Loc] done via native GPS');
            return;
          }
        } catch (e) { console.log('[Loc] step1 skipped:', e); }
      }

      // ── Step 2: browser navigator.geolocation (web + native fallback) — 6s ──
      try {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          console.log('[Loc] step2: browser geolocation...');
          const browserPos = await withTimeout(
            new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0 })
            ),
            6000,
          );
          const { latitude, longitude } = browserPos.coords;
          const address = await reverseGeocodeCoords(latitude, longitude);
          setLocation({ latitude, longitude, address });
          setLocationStatus('done');
          console.log('[Loc] done via browser geo');
          return;
        }
      } catch (e) { console.log('[Loc] step2 failed:', e); }

      // ── Step 3: ipapi.co directly from client browser (CORS, sees real IP) ──
      try {
        console.log('[Loc] step3: ipapi.co...');
        const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        console.log('[Loc] step3 result:', data.city, data.region, data.country_name, data.error);
        if (data.latitude && data.longitude && !data.error) {
          const addr = [data.city, data.region, data.country_name].filter(Boolean).join(', ');
          setLocation({ latitude: data.latitude, longitude: data.longitude, address: addr || `${data.latitude}, ${data.longitude}` });
          setLocationStatus('done');
          return;
        }
      } catch (e) { console.log('[Loc] step3 failed:', e); }

      // ── Step 4: ip-api.com directly from client browser (backup) ──
      try {
        console.log('[Loc] step4: ip-api.com...');
        const res = await fetch('https://ip-api.com/json/?fields=status,lat,lon,city,regionName,country', { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        console.log('[Loc] step4 result:', data.city, data.regionName, data.status);
        if (data.status === 'success' && data.lat && data.lon) {
          const addr = [data.city, data.regionName, data.country].filter(Boolean).join(', ');
          setLocation({ latitude: data.lat, longitude: data.lon, address: addr || `${data.lat}, ${data.lon}` });
          setLocationStatus('done');
          return;
        }
      } catch (e) { console.log('[Loc] step4 failed:', e); }

      console.log('[Loc] all methods failed');
      setLocationStatus('failed');
    })();
  }, []);

  const address = location?.address || '';
  const lat = location?.latitude ?? null;
  const lng = location?.longitude ?? null;

  const price = vehicleType
    ? (washType === 'both' ? PRICING[vehicleType].both : PRICING[vehicleType].exterior)
    : null;

  // Preset "when" options (JS-only, no native date-picker dependency).
  const schedulePresets = (() => {
    const now = new Date();
    const at = (addDays: number, h: number) => { const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    return [
      { label: 'Now', value: null as string | null },
      { label: 'In 2 hrs', value: new Date(now.getTime() + 2 * 3600e3).toISOString() },
      { label: 'Tomorrow 9 AM', value: at(1, 9) },
      { label: 'Tomorrow 6 PM', value: at(1, 18) },
    ];
  })();

  const bookMutation = useMutation({
    mutationFn: (data: any) => apiFetch('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: (booking: any) => {
      // Booking one car → open its live tracking screen. Booking several at once →
      // go to My Bookings where all of them are listed.
      if (quantity > 1) router.replace('/(tabs)/bookings');
      else router.replace(`/booking/${booking.id}`);
    },
    onError: (e: any) => Alert.alert('Error', e.message || 'Failed to create booking'),
  });

  const handleBook = () => {
    if (!address) {
      Alert.alert('Location Required', 'We need your location to dispatch a cleaner.');
      return;
    }
    if (!vehicleType) {
      Alert.alert('Vehicle Required', 'Please select your vehicle type');
      return;
    }
    bookMutation.mutate({
      customerAddress: address,
      customerLat: lat,
      customerLng: lng,
      notes: notes || undefined,
      vehicleType,
      washType,
      scheduledAt: scheduleAt || undefined,
      quantity,
    });
  };

  const [mapLocating, setMapLocating] = useState(false);
  const [gpsInModal, setGpsInModal] = useState(false);
  const mapPickerRef = useRef<MapPickerViewRef>(null);

  const handleUseMyLocation = async () => {
    setGpsInModal(true);
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

    let loc: PickedLocation | null = null;

    // ── Step 1: expo-location (native only, most accurate) ──
    if (Platform.OS !== 'web') {
      try {
        const { status } = await withTimeout(Location.requestForegroundPermissionsAsync(), 5000);
        if (status === 'granted') {
          const pos = await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            10000,
          );
          const addr = await reverseGeocodeCoords(pos.coords.latitude, pos.coords.longitude).catch(() => '');
          loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, address: addr };
        }
      } catch {}
    }

    // ── Step 2: browser navigator.geolocation (web, or native fallback) ──
    if (!loc) {
      try {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          const pos = await withTimeout(
            new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0 })
            ),
            8000,
          );
          const addr = await reverseGeocodeCoords(pos.coords.latitude, pos.coords.longitude).catch(() => '');
          loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, address: addr };
        }
      } catch {}
    }

    // ── Step 3: IP-based fallback (rough city-level location) ──
    if (!loc) {
      try {
        const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        if (data.latitude && data.longitude && !data.error) {
          const addr = [data.city, data.region, data.country_name].filter(Boolean).join(', ');
          loc = { latitude: data.latitude, longitude: data.longitude, address: addr };
        }
      } catch {}
    }

    if (loc) {
      setLocation(loc);
      setLocationStatus('done');
      setPendingLocation(loc);
      mapPickerRef.current?.panTo(loc.latitude, loc.longitude);
    }
    setGpsInModal(false);
  };

  const handleOpenMap = async () => {
    setMapLocating(true);
    let bestLoc = location;

    // Try to get exact GPS at the React-app level before opening the map
    // (more reliable than inside a nested iframe)
    try {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 8000,
            enableHighAccuracy: true,
            maximumAge: 0,
          })
        );
        const addr = await reverseGeocodeCoords(pos.coords.latitude, pos.coords.longitude);
        bestLoc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, address: addr };
        setLocation(bestLoc);
        setLocationStatus('done');
      }
    } catch {
      // GPS denied — try ipapi.co directly from client for better IP accuracy
      try {
        const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        if (data.latitude && data.longitude && !data.error) {
          const addr = [data.city, data.region, data.country_name].filter(Boolean).join(', ');
          bestLoc = { latitude: data.latitude, longitude: data.longitude, address: addr || `${data.latitude}, ${data.longitude}` };
          setLocation(bestLoc);
          setLocationStatus('done');
        }
      } catch {}
    }

    setMapLocating(false);
    setPendingLocation(bestLoc);
    setShowMapModal(true);
  };

  const handleMapDone = () => {
    if (!pendingLocation) {
      Alert.alert('Location not ready', 'Please wait a moment for the map to load, or drag the map to pin your location.');
      return;
    }
    setLocation(pendingLocation);
    setShowMapModal(false);
  };

  const canBook = !!address && !!vehicleType && !bookMutation.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top || 20 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Book Car Wash</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* ── Location Banner ── */}
        <View style={styles.section}>

          {/* Detecting (spinner while permission dialog + GPS runs) */}
          {locationStatus === 'detecting' && (
            <View style={styles.locationDetecting}>
              <ActivityIndicator color={Colors.dark.tint} size="small" />
              <Text style={styles.locationDetectingText}>Detecting your location…</Text>
            </View>
          )}

          {/* Auto-detected successfully */}
          {locationStatus === 'done' && location && (
            <View style={styles.locationCard}>
              <View style={styles.locationCardTop}>
                <View style={styles.locationIconWrap}>
                  <AppIcon name="check-circle" size={18} color={Colors.dark.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationCardTitle}>Your location is auto detected and set</Text>
                  <Text style={styles.locationCardAddress} numberOfLines={2}>{address}</Text>
                </View>
              </View>
              <TouchableOpacity style={[styles.changeLocationBtn, mapLocating && { opacity: 0.6 }]} onPress={handleOpenMap} activeOpacity={0.8} disabled={mapLocating}>
                {mapLocating
                  ? <ActivityIndicator size="small" color={Colors.dark.tint} />
                  : <AppIcon name="edit-2" size={14} color={Colors.dark.tint} />}
                <Text style={styles.changeLocationText}>{mapLocating ? 'Getting location…' : 'Change Location'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Detection failed — small optional fallback */}
          {locationStatus === 'failed' && !location && (
            <View style={styles.locationCard}>
              <View style={styles.locationCardTop}>
                <View style={styles.locationIconWrap}>
                  <AppIcon name="map-pin" size={18} color={Colors.dark.tabIconDefault} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationCardTitle}>Location not detected</Text>
                  <Text style={styles.locationCardAddress}>You can optionally set it manually</Text>
                </View>
              </View>
              <TouchableOpacity style={[styles.changeLocationBtn, mapLocating && { opacity: 0.6 }]} onPress={handleOpenMap} activeOpacity={0.8} disabled={mapLocating}>
                {mapLocating
                  ? <ActivityIndicator size="small" color={Colors.dark.tint} />
                  : <AppIcon name="map-pin" size={14} color={Colors.dark.tint} />}
                <Text style={styles.changeLocationText}>{mapLocating ? 'Getting location…' : 'Set on Map (optional)'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Map was set manually after failed auto-detect */}
          {locationStatus === 'failed' && location && (
            <View style={styles.locationCard}>
              <View style={styles.locationCardTop}>
                <View style={styles.locationIconWrap}>
                  <AppIcon name="check-circle" size={18} color={Colors.dark.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationCardTitle}>Location set manually</Text>
                  <Text style={styles.locationCardAddress} numberOfLines={2}>{address}</Text>
                </View>
              </View>
              <TouchableOpacity style={[styles.changeLocationBtn, mapLocating && { opacity: 0.6 }]} onPress={handleOpenMap} activeOpacity={0.8} disabled={mapLocating}>
                {mapLocating
                  ? <ActivityIndicator size="small" color={Colors.dark.tint} />
                  : <AppIcon name="edit-2" size={14} color={Colors.dark.tint} />}
                <Text style={styles.changeLocationText}>{mapLocating ? 'Getting location…' : 'Change Location'}</Text>
              </TouchableOpacity>
            </View>
          )}

        </View>

        {/* ── Vehicle Type ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Vehicle Type</Text>
          <View style={styles.vehicleGrid}>
            {VEHICLE_TYPES.map((v) => {
              const selected = vehicleType === v.key;
              return (
                <TouchableOpacity
                  key={v.key}
                  style={[styles.vehicleCard, selected && styles.vehicleCardSelected]}
                  onPress={() => setVehicleType(v.key)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.vehicleIcon}>{v.icon}</Text>
                  <Text style={[styles.vehicleLabel, selected && styles.vehicleLabelSelected]}>
                    {v.label}
                  </Text>
                  {selected && (
                    <View style={styles.vehicleCheckmark}>
                      <AppIcon name="check" size={10} color="#FFF" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Wash Type ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Wash Type</Text>
          <View style={styles.washTypeRow}>
            <TouchableOpacity
              style={[styles.washTypeBtn, washType === 'exterior' && styles.washTypeBtnSelected]}
              onPress={() => setWashType('exterior')}
              activeOpacity={0.8}
            >
              <AppIcon name="droplet" size={18} color={washType === 'exterior' ? '#FFF' : Colors.dark.tabIconDefault} />
              <View>
                <Text style={[styles.washTypeName, washType === 'exterior' && styles.washTypeNameSelected]}>Exterior Only</Text>
                {vehicleType && (
                  <Text style={[styles.washTypePrice, washType === 'exterior' && styles.washTypePriceSelected]}>
                    ₹{PRICING[vehicleType].exterior}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.washTypeBtn, washType === 'both' && styles.washTypeBtnSelected]}
              onPress={() => setWashType('both')}
              activeOpacity={0.8}
            >
              <AppIcon name="star" size={18} color={washType === 'both' ? '#FFF' : Colors.dark.tabIconDefault} />
              <View>
                <Text style={[styles.washTypeName, washType === 'both' && styles.washTypeNameSelected]}>Exterior + Interior</Text>
                {vehicleType && (
                  <Text style={[styles.washTypePrice, washType === 'both' && styles.washTypePriceSelected]}>
                    ₹{PRICING[vehicleType].both}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── How many cars ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <AppIcon name="truck" size={14} color={Colors.dark.tint} /> How many cars?
          </Text>
          <Text style={styles.quantityHint}>Booking more than one sends a separate request for each car of this type.</Text>
          <View style={styles.quantityRow}>
            <TouchableOpacity
              style={[styles.qtyBtn, quantity <= 1 && styles.qtyBtnDisabled]}
              onPress={() => setQuantity(q => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              activeOpacity={0.8}
            >
              <AppIcon name="minus" size={20} color={quantity <= 1 ? Colors.dark.tabIconDefault : Colors.dark.text} />
            </TouchableOpacity>
            <Text style={styles.qtyValue}>{quantity}</Text>
            <TouchableOpacity
              style={[styles.qtyBtn, quantity >= 5 && styles.qtyBtnDisabled]}
              onPress={() => setQuantity(q => Math.min(5, q + 1))}
              disabled={quantity >= 5}
              activeOpacity={0.8}
            >
              <AppIcon name="plus" size={20} color={quantity >= 5 ? Colors.dark.tabIconDefault : Colors.dark.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── When ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <AppIcon name="clock" size={14} color={Colors.dark.tint} /> When
          </Text>
          <View style={styles.scheduleRow}>
            {schedulePresets.map(p => (
              <TouchableOpacity
                key={p.label}
                style={[styles.scheduleChip, scheduleAt === p.value && styles.scheduleChipActive]}
                onPress={() => setScheduleAt(p.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.scheduleChipText, scheduleAt === p.value && styles.scheduleChipTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {scheduleAt && <Text style={styles.scheduleHint}>We'll start finding you a cleaner at the scheduled time.</Text>}
        </View>

        {/* ── Notes ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <AppIcon name="file-text" size={14} color={Colors.dark.tint} /> Special Instructions{' '}
            <Text style={styles.optionalLabel}>(optional)</Text>
          </Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. Red car, Gate code 1234, bring your own water…"
            placeholderTextColor={Colors.dark.tabIconDefault}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Info card */}
        <View style={styles.infoCard}>
          {[
            { icon: 'send', text: 'Request sent to up to 5 nearest cleaners simultaneously' },
            { icon: 'zap', text: 'First to accept gets the job — usually under 2 minutes' },
            { icon: 'shield', text: 'All cleaners are verified professionals' },
          ].map((row) => (
            <View key={row.icon} style={styles.infoRow}>
              <AppIcon name={row.icon as any} size={16} color={Colors.dark.tint} />
              <Text style={styles.infoText}>{row.text}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 140 }} />
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom || 24 }]}>
        {price !== null && (
          <View style={styles.priceBanner}>
            <Text style={styles.priceBannerLabel}>{quantity > 1 ? `Total (${quantity} cars)` : 'Total Price'}</Text>
            <Text style={styles.priceBannerValue}>₹{price * quantity}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.bookBtn, !canBook && styles.bookBtnDisabled]}
          onPress={handleBook}
          disabled={!canBook}
        >
          {bookMutation.isPending ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <AppIcon name={scheduleAt ? 'clock' : 'search'} size={20} color="#FFF" />
              <Text style={styles.bookBtnText}>
                {scheduleAt
                  ? (quantity > 1 ? `Schedule ${quantity} Washes` : 'Schedule Wash')
                  : (quantity > 1 ? `Find Cleaners for ${quantity} Cars` : 'Find Nearest Cleaner')}
              </Text>
            </>
          )}
        </TouchableOpacity>
        {!vehicleType && (
          <Text style={styles.footerHint}>Select a vehicle type to see pricing</Text>
        )}
      </View>

      {/* ── Change Location Modal ── */}
      <Modal
        visible={showMapModal}
        animationType="slide"
        onRequestClose={() => setShowMapModal(false)}
      >
        <View style={[styles.modalRoot, { paddingTop: insets.top }]}>
          <View style={[styles.modalHeader, { elevation: 4, zIndex: 10 }]}>
            <TouchableOpacity
              onPress={() => setShowMapModal(false)}
              style={styles.modalCancelBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <AppIcon name="arrow-left" size={22} color={Colors.dark.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Pin Your Location</Text>
            <TouchableOpacity
              onPress={handleMapDone}
              style={styles.modalDoneBtn}
              activeOpacity={0.85}
            >
              <AppIcon name="check" size={16} color="#fff" />
              <Text style={styles.modalDoneText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Use My Location banner */}
          <TouchableOpacity
            style={styles.useMyLocBtn}
            onPress={handleUseMyLocation}
            activeOpacity={0.8}
            disabled={gpsInModal}
          >
            {gpsInModal
              ? <ActivityIndicator size="small" color="#fff" />
              : <AppIcon name="navigation" size={16} color="#fff" />}
            <Text style={styles.useMyLocText}>
              {gpsInModal ? 'Detecting your location…' : 'Use My Current Location'}
            </Text>
          </TouchableOpacity>

          <View style={styles.modalMapWrap}>
            <MapPickerView
              ref={mapPickerRef}
              initialLocation={pendingLocation}
              onLocationChange={setPendingLocation}
              onRequestLocation={handleUseMyLocation}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  backBtn: { padding: 8, width: 40 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },
  content: { flex: 1 },
  section: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.dark.text, marginBottom: 4 },
  quantityHint: { fontSize: 12, color: Colors.dark.tabIconDefault, marginTop: 4, marginBottom: 12 },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  qtyBtn: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.dark.card,
    borderWidth: 1.5, borderColor: Colors.dark.border, alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.4 },
  qtyValue: { fontSize: 24, fontWeight: '700', color: Colors.dark.text, minWidth: 32, textAlign: 'center' },
  optionalLabel: { color: Colors.dark.tabIconDefault, fontWeight: '400', fontSize: 13 },

  // Location
  locationDetecting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  locationDetectingText: { color: Colors.dark.tabIconDefault, fontSize: 14 },

  // Permission request card (first-time ask)
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: `${Colors.dark.tint}50`,
    padding: 16,
  },
  permissionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.tint,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  permissionTitle: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  permissionSub: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
    lineHeight: 17,
  },
  allowBtn: {
    backgroundColor: Colors.dark.tint,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60,
    flexShrink: 0,
  },
  allowBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Permission permanently denied card
  permDeniedCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    padding: 16,
    gap: 14,
  },
  permDeniedTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  permDeniedIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${Colors.dark.tint}18`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  permDeniedTitle: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  permDeniedSub: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
    lineHeight: 17,
  },
  permDeniedActions: {
    flexDirection: 'row',
    gap: 10,
  },
  openSettingsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.dark.tint,
    paddingVertical: 10,
  },
  openSettingsBtnText: {
    color: Colors.dark.tint,
    fontSize: 13,
    fontWeight: '600',
  },
  pinMapBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.dark.tint,
    borderRadius: 10,
    paddingVertical: 10,
  },
  pinMapBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pinLocationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: `${Colors.dark.tint}50`,
    padding: 16,
  },
  pinLocationIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.dark.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinLocationTitle: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  pinLocationSub: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
    lineHeight: 17,
  },

  locationCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${Colors.dark.tint}40`,
    overflow: 'hidden',
  },
  locationCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  locationIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${Colors.dark.tint}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCardTitle: { color: Colors.dark.tabIconDefault, fontSize: 12, fontWeight: '600', marginBottom: 3 },
  locationCardAddress: { color: Colors.dark.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  changeLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  changeLocationText: { color: Colors.dark.tint, fontSize: 14, fontWeight: '600' },

  // Vehicle
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  vehicleCard: {
    width: '22%',
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
    position: 'relative',
  },
  vehicleCardSelected: { borderColor: Colors.dark.tint, backgroundColor: `${Colors.dark.tint}20` },
  vehicleIcon: { fontSize: 24, marginBottom: 6 },
  vehicleLabel: { fontSize: 10, color: Colors.dark.tabIconDefault, textAlign: 'center', lineHeight: 13, fontWeight: '500' },
  vehicleLabelSelected: { color: Colors.dark.tint, fontWeight: '700' },
  vehicleCheckmark: {
    position: 'absolute', top: 5, right: 5, width: 16, height: 16,
    borderRadius: 8, backgroundColor: Colors.dark.tint, alignItems: 'center', justifyContent: 'center',
  },

  // Wash type
  washTypeRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  scheduleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  scheduleChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },
  scheduleChipActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  scheduleChipText: { color: Colors.dark.tabIconDefault, fontSize: 13 },
  scheduleChipTextActive: { color: '#FFF', fontWeight: '600' },
  scheduleHint: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 8 },
  washTypeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.dark.card, borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: Colors.dark.border,
  },
  washTypeBtnSelected: { borderColor: Colors.dark.tint, backgroundColor: Colors.dark.tint },
  washTypeName: { fontSize: 13, fontWeight: '600', color: Colors.dark.tabIconDefault },
  washTypeNameSelected: { color: '#FFF' },
  washTypePrice: { fontSize: 16, fontWeight: 'bold', color: Colors.dark.text, marginTop: 2 },
  washTypePriceSelected: { color: '#FFF' },

  // Notes
  notesInput: {
    backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16,
    color: Colors.dark.text, fontSize: 15, borderWidth: 1, borderColor: Colors.dark.border,
    minHeight: 80, textAlignVertical: 'top', marginTop: 10,
  },

  // Info
  infoCard: {
    marginHorizontal: 20, marginTop: 20, backgroundColor: Colors.dark.card,
    borderRadius: 16, padding: 18, gap: 12, borderWidth: 1, borderColor: Colors.dark.border,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { flex: 1, color: Colors.dark.tabIconDefault, fontSize: 13, lineHeight: 19 },

  // Footer
  footer: {
    paddingHorizontal: 20, paddingTop: 14, backgroundColor: Colors.dark.card,
    borderTopWidth: 1, borderTopColor: Colors.dark.border, gap: 10,
  },
  priceBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: `${Colors.dark.tint}15`, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: `${Colors.dark.tint}40`,
  },
  priceBannerLabel: { fontSize: 14, color: Colors.dark.tabIconDefault, fontWeight: '500' },
  priceBannerValue: { fontSize: 22, fontWeight: 'bold', color: Colors.dark.tint },
  bookBtn: {
    backgroundColor: Colors.dark.tint, borderRadius: 16, padding: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  bookBtnDisabled: { opacity: 0.45 },
  bookBtnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  footerHint: { textAlign: 'center', fontSize: 12, color: Colors.dark.tabIconDefault, paddingBottom: 4 },

  // Map Modal
  modalRoot: { flex: 1, backgroundColor: Colors.dark.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  modalCancelBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: Colors.dark.card, alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.dark.text },
  modalDoneBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.dark.tint, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  modalDoneBtnDisabled: {
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  modalDoneText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalDoneTextDisabled: { color: Colors.dark.tabIconDefault },
  useMyLocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.dark.tint,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  useMyLocText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalMapWrap: { flex: 1 },
});

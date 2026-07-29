import React, { useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Animated, Vibration, Platform, ScrollView, Easing,
  ActivityIndicator,
} from 'react-native';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

let Haptics: typeof import('expo-haptics') | null = null;
if (Platform.OS !== 'web') {
  try { Haptics = require('expo-haptics'); } catch { Haptics = null; }
}

const VEHICLE_ICONS: Record<string, string> = {
  hatchback: 'car',
  sedan: 'car',
  suv: 'truck',
  premium_suv: 'truck',
  luxury: 'star',
};

function vehicleLabel(type: string) {
  return ({
    hatchback: 'Hatchback',
    sedan: 'Sedan',
    suv: 'SUV',
    premium_suv: 'Premium SUV',
    luxury: 'Luxury Car',
  } as Record<string, string>)[type] ?? type;
}

function washLabel(type: string) {
  return type === 'both' ? 'Exterior + Interior' : 'Exterior Only';
}

interface Booking {
  id: number;
  customerName?: string;
  customerPhone?: string;
  customerAddress: string;
  vehicleType?: string;
  cleanType?: string;
  washType?: string;
  priceQuoted: number;
  notes?: string;
  distanceKm?: number;
}

interface Props {
  bookings: Booking[];
  takenByOtherBookings?: Booking[];  // bookings accepted by another cleaner — show "taken" notice
  pendingIds: Set<number>;
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
}

export default function IncomingBookingAlert({ bookings, takenByOtherBookings = [], pendingIds, onAccept, onDecline }: Props) {
  const visible = bookings.length > 0 || takenByOtherBookings.length > 0;
  const slideAnim = useRef(new Animated.Value(600)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const prevCount = useRef(0);

  // Slide up when first booking arrives, slide down when all gone
  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 600,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  // Pulse the header glow continuously while bookings exist
  useEffect(() => {
    if (visible) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => pulseLoop.current?.stop();
  }, [visible]);

  // Vibrate + haptic every time a NEW booking arrives
  useEffect(() => {
    const curr = bookings.length;
    if (curr > prevCount.current) {
      if (Platform.OS !== 'web') {
        // Repeating urgent vibration pattern: wait 0ms, buzz 400ms, pause 200ms, buzz 400ms, pause 200ms, buzz 400ms
        Vibration.vibrate([0, 400, 200, 400, 200, 500]);
        Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    }
    prevCount.current = curr;
  }, [bookings.length]);

  // Stop vibration once all bookings are gone
  useEffect(() => {
    if (!visible && Platform.OS !== 'web') {
      Vibration.cancel();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      {/* Dark backdrop */}
      <View style={styles.backdrop}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>

          {/* Pulsing header */}
          <Animated.View style={[
            styles.alertHeader,
            bookings.length === 0 ? styles.alertHeaderTaken : {},
            { transform: [{ scale: pulseAnim }] },
          ]}>
            <View style={styles.headerIconWrap}>
              <AppIcon name={bookings.length > 0 ? 'bell' : 'x-circle'} size={28} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>
                {bookings.length > 0
                  ? (bookings.length === 1 ? 'New Booking Request!' : `${bookings.length} Booking Requests!`)
                  : 'Booking Taken'}
              </Text>
              <Text style={styles.headerSub}>
                {bookings.length > 0
                  ? 'Tap Accept to take the job'
                  : 'Another cleaner was faster this time'}
              </Text>
            </View>
            {bookings.length > 0 && (
              <View style={styles.countBubble}>
                <Text style={styles.countText}>{bookings.length}</Text>
              </View>
            )}
          </Animated.View>

          {/* Booking list */}
          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {/* "Taken by another cleaner" notices — shown at the top, auto-dismissed */}
            {takenByOtherBookings.map((b) => (
              <TakenCard key={`taken-${b.id}`} booking={b} />
            ))}
            {/* Normal incoming booking cards */}
            {bookings.map((b, idx) => (
              <BookingCard
                key={b.id}
                booking={b}
                index={idx}
                isPending={pendingIds.has(b.id)}
                onAccept={() => onAccept(b.id)}
                onDecline={() => onDecline(b.id)}
              />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function TakenCard({ booking: b }: { booking: Booking }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[styles.takenCard, { opacity: fadeAnim }]}>
      <View style={styles.takenHeader}>
        <View style={styles.takenIconWrap}>
          <AppIcon name="user-check" size={18} color="#94A3B8" />
        </View>
        <Text style={styles.takenTitle}>Accepted by Another Cleaner</Text>
      </View>
      <View style={styles.takenRow}>
        <AppIcon name="map-pin" size={13} color="#64748B" />
        <Text style={styles.takenAddress} numberOfLines={1}>{b.customerAddress}</Text>
      </View>
      <View style={styles.takenRow}>
        <AppIcon name="banknote" size={13} color="#64748B" />
        <Text style={styles.takenPrice}>₹{b.priceQuoted} — this booking is no longer available</Text>
      </View>
    </Animated.View>
  );
}

function BookingCard({
  booking: b, index, isPending, onAccept, onDecline,
}: { booking: Booking; index: number; isPending: boolean; onAccept: () => void; onDecline: () => void }) {
  const enterAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enterAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 55,
      friction: 9,
      delay: index * 80,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.bookingCard, {
      opacity: enterAnim,
      transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
    }]}>

      {/* Price — most important, shown large at top right */}
      <View style={styles.priceRow}>
        <View style={styles.bookingIndexBadge}>
          <Text style={styles.bookingIndexText}>#{index + 1}</Text>
        </View>
        <View style={styles.priceBig}>
          <Text style={styles.priceSymbol}>₹</Text>
          <Text style={styles.priceAmount}>{b.priceQuoted}</Text>
        </View>
      </View>

      {/* Distance badge — navigation-style, shown prominently if available */}
      {b.distanceKm != null && (
        <View style={styles.distanceBadge}>
          <AppIcon name="navigation" size={16} color="#22D3EE" />
          <Text style={styles.distanceKm}>{b.distanceKm.toFixed(1)} km away</Text>
          <View style={styles.distanceDivider} />
          <Text style={styles.distanceEta}>~{Math.max(1, Math.round(b.distanceKm / 0.5))} min drive</Text>
        </View>
      )}

      {/* Customer */}
      <View style={styles.infoRow}>
        <View style={styles.iconCircle}>
          <AppIcon name="user" size={16} color={Colors.dark.tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.infoLabel}>Customer</Text>
          <Text style={styles.infoValue}>{b.customerName ?? 'Customer'}</Text>
          {b.customerPhone ? <Text style={styles.infoSub}>{b.customerPhone}</Text> : null}
        </View>
      </View>

      {/* Address — full address displayed in detail */}
      <View style={styles.infoRow}>
        <View style={styles.iconCircle}>
          <AppIcon name="map-pin" size={16} color={Colors.dark.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.infoLabel}>Customer Location</Text>
          <Text style={styles.infoValue} numberOfLines={3}>{b.customerAddress}</Text>
        </View>
      </View>

      {/* Vehicle + Wash type */}
      <View style={styles.tagRow}>
        {b.vehicleType && (
          <View style={styles.tag}>
            <AppIcon name={(VEHICLE_ICONS[b.vehicleType] ?? 'car') as any} size={13} color={Colors.dark.tint} />
            <Text style={styles.tagText}>{vehicleLabel(b.vehicleType)}</Text>
          </View>
        )}
        {(b.cleanType ?? b.washType) && (
          <View style={styles.tag}>
            <AppIcon name="droplets" size={13} color={Colors.dark.tint} />
            <Text style={styles.tagText}>{washLabel(b.cleanType ?? b.washType ?? '')}</Text>
          </View>
        )}
      </View>

      {b.notes ? (
        <View style={styles.notesRow}>
          <AppIcon name="message-circle" size={13} color={Colors.dark.tabIconDefault} />
          <Text style={styles.notesText} numberOfLines={2}>"{b.notes}"</Text>
        </View>
      ) : null}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.btn, styles.declineBtn]}
          onPress={onDecline}
          disabled={isPending}
          activeOpacity={0.75}
        >
          <AppIcon name="x" size={20} color="#FFF" />
          <Text style={styles.btnText}>Decline</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.acceptBtn]}
          onPress={onAccept}
          disabled={isPending}
          activeOpacity={0.75}
        >
          {isPending ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <AppIcon name="check" size={20} color="#FFF" />
              <Text style={styles.btnText}>Accept Job</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E85D04',
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 14,
  },
  headerIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 19,
    fontWeight: 'bold',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    marginTop: 2,
  },
  countBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: '#E85D04',
    fontWeight: 'bold',
    fontSize: 16,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  bookingCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#E85D04' + '50',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  bookingIndexBadge: {
    backgroundColor: Colors.dark.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bookingIndexText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
    fontWeight: '600',
  },
  priceBig: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  priceSymbol: {
    color: Colors.dark.success,
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 4,
  },
  priceAmount: {
    color: Colors.dark.success,
    fontSize: 36,
    fontWeight: 'bold',
    lineHeight: 40,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0E3A4A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#22D3EE30',
  },
  distanceKm: {
    color: '#22D3EE',
    fontSize: 16,
    fontWeight: '700',
  },
  distanceDivider: {
    width: 1,
    height: 16,
    backgroundColor: '#22D3EE30',
    marginHorizontal: 2,
  },
  distanceEta: {
    color: '#7DD3FC',
    fontSize: 14,
    fontWeight: '500',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.dark.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  infoLabel: {
    fontSize: 11,
    color: Colors.dark.tabIconDefault,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  infoSub: {
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.dark.tint + '18',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.dark.tint + '35',
  },
  tagText: {
    fontSize: 12,
    color: Colors.dark.tint,
    fontWeight: '600',
  },
  notesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 12,
    backgroundColor: Colors.dark.border + '40',
    borderRadius: 10,
    padding: 10,
  },
  notesText: {
    flex: 1,
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    gap: 8,
  },
  declineBtn: {
    backgroundColor: '#DC2626',
    flex: 0.42,
  },
  acceptBtn: {
    backgroundColor: Colors.dark.success,
    flex: 0.58,
  },
  btnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 15,
  },

  // Header variant shown when only "taken" notices remain (no active incoming bookings)
  alertHeaderTaken: {
    backgroundColor: '#334155',
  },

  // "Taken by another cleaner" notice card
  takenCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#334155',
  },
  takenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  takenIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  takenTitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  takenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  takenAddress: {
    color: '#64748B',
    fontSize: 13,
    flex: 1,
  },
  takenPrice: {
    color: '#64748B',
    fontSize: 12,
    flex: 1,
  },
});

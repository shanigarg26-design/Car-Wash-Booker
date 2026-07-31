import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '@/components/AppIcon';
import { useRouter } from 'expo-router';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  completed: { label: 'Completed', color: '#22c55e',                   icon: 'check-circle' },
  cancelled: { label: 'Cancelled', color: Colors.dark.tabIconDefault,  icon: 'x-circle'     },
  declined:  { label: 'Declined',  color: Colors.dark.error,           icon: 'x-circle'     },
};

function formatMonthYear(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatVehicle(vehicleType?: string | null, washType?: string | null) {
  if (!vehicleType) return null;
  const wash = washType === 'both' ? 'Exterior + Interior' : 'Exterior Only';
  return `${vehicleType} · ${wash}`;
}

export default function BookingHistoryScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWasher = user?.role === 'cleaner';

  const { data: allBookings, isLoading } = useQuery({
    queryKey: ['bookings', user?.role],
    queryFn: () => apiFetch(`/api/bookings?role=${user?.role}`),
    enabled: !!user,
  });

  const pastBookings: any[] = useMemo(() => {
    if (!allBookings) return [];
    return [...allBookings]
      .filter((b: any) => ['completed', 'cancelled'].includes(b.status))
      .sort((a: any, b: any) =>
        new Date(b.scheduledAt || b.createdAt).getTime() -
        new Date(a.scheduledAt || a.createdAt).getTime()
      );
  }, [allBookings]);

  const stats = useMemo(() => {
    const completedList = pastBookings.filter((b: any) => b.status === 'completed');
    const cancelledList = pastBookings.filter((b: any) => b.status === 'cancelled');
    const totalMoney = completedList.reduce((sum: number, b: any) => sum + (b.price ?? b.priceQuoted ?? 0), 0);
    return {
      total: pastBookings.length,
      completed: completedList.length,
      cancelled: cancelledList.length,
      totalMoney,
    };
  }, [pastBookings]);

  const sections = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const b of pastBookings) {
      const key = formatMonthYear(b.scheduledAt || b.createdAt);
      if (!map[key]) map[key] = [];
      map[key].push(b);
    }
    return Object.entries(map).map(([title, data]) => ({ title, data }));
  }, [pastBookings]);

  const renderCard = (item: any) => {
    const cfg = STATUS_CONFIG[item.status] ?? { label: item.status, color: Colors.dark.tabIconDefault, icon: 'circle' };
    const counterpart = isWasher ? item.customerName : (item.washerName ?? item.cleanerName ?? null);
    const vehicle = formatVehicle(item.vehicleType, item.washType);
    const price = item.amountCharged ?? item.priceQuoted;

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.card}
        activeOpacity={0.75}
        onPress={() => router.push(`/booking/${item.id}` as any)}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.dateText}>{formatDateTime(item.scheduledAt || item.createdAt)}</Text>
            {counterpart ? (
              <Text style={styles.counterpartText}>{isWasher ? '👤 ' : '🧹 '}{counterpart}</Text>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: cfg.color + '22' }]}>
            <AppIcon name={cfg.icon as any} size={12} color={cfg.color} />
            <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>

        <View style={styles.detailsBlock}>
          <View style={styles.detailRow}>
            <AppIcon name="map-pin" size={13} color={Colors.dark.tabIconDefault} />
            <Text style={styles.detailText} numberOfLines={1}>{item.customerAddress}</Text>
          </View>
          {vehicle ? (
            <View style={styles.detailRow}>
              <AppIcon name="truck" size={13} color={Colors.dark.tabIconDefault} />
              <Text style={styles.detailText}>{vehicle}</Text>
            </View>
          ) : null}
          {price != null ? (
            <View style={styles.detailRow}>
              <AppIcon name="tag" size={13} color={Colors.dark.tabIconDefault} />
              <Text style={[styles.detailText, { color: Colors.dark.tint, fontWeight: '700' }]}>₹{price}</Text>
            </View>
          ) : null}
          {item.notes ? (
            <View style={styles.detailRow}>
              <AppIcon name="file-text" size={13} color={Colors.dark.tabIconDefault} />
              <Text style={styles.detailText} numberOfLines={1}>{item.notes}</Text>
            </View>
          ) : null}
        </View>

        {!isWasher && item.status === 'completed' && (
          <TouchableOpacity
            style={styles.rateBtn}
            onPress={(e) => { e.stopPropagation?.(); router.push(`/feedback/${item.id}` as any); }}
          >
            <AppIcon name="star" size={14} color="#F59E0B" />
            <Text style={styles.rateBtnText}>Rate This Wash</Text>
          </TouchableOpacity>
        )}

        <View style={styles.viewRow}>
          <Text style={styles.viewHint}>View Details</Text>
          <AppIcon name="chevron-right" size={14} color={Colors.dark.tabIconDefault} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.pageHeader}>
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/profile' as any)}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <AppIcon name="arrow-left" size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Booking History</Text>
        <View style={{ width: 36 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.dark.tint} size="large" />
      ) : pastBookings.length === 0 ? (
        <View style={styles.emptyState}>
          <AppIcon name="clock" size={56} color={Colors.dark.border} />
          <Text style={styles.emptyTitle}>No History Yet</Text>
          <Text style={styles.emptySubtitle}>
            {isWasher
              ? 'Your completed and cancelled jobs will appear here.'
              : 'Your completed and cancelled bookings will appear here.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator
        >
          {/* Stats */}
          <View style={styles.statsRow}>
            <StatCard icon="check-circle" label="Completed" value={stats.completed.toString()} color="#22c55e" />
            <StatCard icon="x-circle"     label="Cancelled" value={stats.cancelled.toString()} color={Colors.dark.tabIconDefault} />
            <StatCard
              icon={isWasher ? 'trending-up' : 'credit-card'}
              label={isWasher ? 'Earned' : 'Spent'}
              value={`₹${stats.totalMoney}`}
              color="#F59E0B"
            />
          </View>

          {/* Sections */}
          {sections.map(section => (
            <View key={section.title}>
              <View style={styles.monthHeader}>
                <Text style={styles.monthText}>{section.title}</Text>
              </View>
              {section.data.map(item => renderCard(item))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderColor: color + '33' }]}>
      <AppIcon name={icon as any} size={20} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },

  pageHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  pageTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },

  listContent: { paddingHorizontal: 16, paddingTop: 8 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: Colors.dark.card, borderRadius: 14, borderWidth: 1,
    padding: 12, alignItems: 'center', gap: 4,
  },
  statValue: { fontSize: 16, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: Colors.dark.tabIconDefault, fontWeight: '600', textTransform: 'uppercase' },

  monthHeader: { paddingVertical: 10 },
  monthText: {
    fontSize: 13, fontWeight: '700', color: Colors.dark.tabIconDefault,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },

  card: {
    backgroundColor: Colors.dark.card, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.dark.border,
    marginBottom: 12, overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: 14, paddingBottom: 10,
  },
  dateText: { fontSize: 14, fontWeight: '700', color: Colors.dark.text },
  counterpartText: { fontSize: 12, color: Colors.dark.tabIconDefault, marginTop: 2 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },

  detailsBlock: {
    gap: 7, borderTopWidth: 1, borderTopColor: Colors.dark.border,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { color: Colors.dark.tabIconDefault, fontSize: 13, flex: 1 },

  rateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 14, marginBottom: 10, paddingVertical: 9,
    backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: 10,
  },
  rateBtnText: { color: '#F59E0B', fontWeight: '700', fontSize: 13 },

  viewRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    paddingHorizontal: 14, paddingBottom: 10, gap: 4,
  },
  viewHint: { fontSize: 12, color: Colors.dark.tabIconDefault },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 14, marginTop: 80 },
  emptyTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },
  emptySubtitle: { fontSize: 14, color: Colors.dark.tabIconDefault, textAlign: 'center', lineHeight: 20 },
});

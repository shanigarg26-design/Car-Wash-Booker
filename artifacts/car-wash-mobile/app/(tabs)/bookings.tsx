import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '@/components/AppIcon';
import HomeButton from '@/components/HomeButton';
import { useRouter } from 'expo-router';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  searching: { label: 'Searching', color: Colors.dark.warning },
  accepted:  { label: 'Accepted',  color: Colors.dark.success },
  completed: { label: 'Completed', color: Colors.dark.tint },
  cancelled: { label: 'Cancelled', color: Colors.dark.tabIconDefault },
  declined:  { label: 'Declined',  color: Colors.dark.error },
};

export default function BookingsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming');

  const { data: bookings, isLoading, refetch } = useQuery({
    queryKey: ['bookings', user?.role],
    queryFn: () => apiFetch(`/api/bookings?role=${user?.role}`),
    enabled: !!user,
  });

  const cancelBooking = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/bookings/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
    onError: (e: any) => Alert.alert('Error', e.message),
  });

  const filteredBookings = (bookings || []).filter((b: any) => {
    if (filter === 'upcoming') return ['searching', 'accepted'].includes(b.status);
    return ['completed', 'declined', 'cancelled'].includes(b.status);
  });

  const renderBooking = ({ item }: { item: any }) => {
    const statusInfo = STATUS_MAP[item.status] || { label: item.status, color: Colors.dark.tabIconDefault };
    const counterpart = user?.role === 'customer'
      ? (item.washerName || item.cleanerName || (item.status === 'searching' ? 'Finding cleaner…' : null))
      : item.customer?.name;

    const vehicleLabel = item.vehicleType
      ? `${item.vehicleType} · ${(item.cleanType ?? item.washType) === 'both' ? 'E + Interior' : 'Exterior Only'}`
      : null;

    const priceLabel = item.price != null ? `₹${item.price}` : null;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.date}>{new Date(item.scheduledAt || item.createdAt).toLocaleString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}</Text>
            {counterpart ? <Text style={styles.counterpart}>{user?.role === 'customer' ? '🧹 ' : '👤 '}{counterpart}</Text> : null}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '22' }]}>
            <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>

        <View style={styles.details}>
          <View style={styles.detailRow}>
            <AppIcon name="map-pin" size={14} color={Colors.dark.tabIconDefault} />
            <Text style={styles.address} numberOfLines={1}>{item.customerAddress}</Text>
          </View>

          {vehicleLabel && (
            <View style={styles.detailRow}>
              <AppIcon name="truck" size={14} color={Colors.dark.tabIconDefault} />
              <Text style={styles.detailText}>{vehicleLabel}</Text>
            </View>
          )}

          {priceLabel && (
            <View style={styles.detailRow}>
              <AppIcon name="tag" size={14} color={Colors.dark.tabIconDefault} />
              <Text style={[styles.detailText, { color: Colors.dark.tint, fontWeight: '700' }]}>{priceLabel}</Text>
            </View>
          )}

          {item.notes ? (
            <View style={styles.detailRow}>
              <AppIcon name="file-text" size={14} color={Colors.dark.tabIconDefault} />
              <Text style={styles.detailText} numberOfLines={1}>{item.notes}</Text>
            </View>
          ) : null}
        </View>

        {user?.role === 'customer' && item.status === 'searching' && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => Alert.alert('Cancel Booking', 'Are you sure?', [
              { text: 'No', style: 'cancel' },
              { text: 'Yes', onPress: () => cancelBooking.mutate(item.id), style: 'destructive' },
            ])}
          >
            <Text style={styles.cancelText}>Cancel Booking</Text>
          </TouchableOpacity>
        )}

        {user?.role === 'customer' && item.status === 'completed' && (
          <TouchableOpacity
            style={styles.rateButton}
            onPress={() => router.push(`/feedback/${item.id}` as any)}
          >
            <AppIcon name="star" size={15} color="#F59E0B" />
            <Text style={styles.rateText}>Rate This Clean</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.pageHeader}>
        <Text style={styles.title}>My Bookings</Text>
        <HomeButton />
      </View>

      <View style={styles.tabs}>
        {(['upcoming', 'past'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.activeTab]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.activeTabText]}>
              {f === 'upcoming' ? 'Active' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.dark.tint} />
      ) : (
        <FlatList
          data={filteredBookings}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderBooking}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          refreshing={isLoading}
          onRefresh={refetch}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <AppIcon name="calendar" size={48} color={Colors.dark.tabIconDefault} />
              <Text style={styles.emptyText}>
                {filter === 'upcoming' ? 'No active bookings.' : 'No booking history yet.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  pageHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
  },
  title: { fontSize: 28, fontWeight: 'bold', color: Colors.dark.text },
  tabs: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 10 },
  tab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: Colors.dark.tint },
  tabText: { color: Colors.dark.tabIconDefault, fontSize: 16, fontWeight: '600' },
  activeTabText: { color: Colors.dark.tint },
  list: { padding: 20, gap: 16 },
  card: {
    backgroundColor: Colors.dark.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  date: { color: Colors.dark.text, fontWeight: 'bold', fontSize: 15 },
  counterpart: { color: Colors.dark.tabIconDefault, marginTop: 4, fontSize: 13 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  details: {
    gap: 8, borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 12,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  address: { color: Colors.dark.text, fontSize: 14, flex: 1 },
  detailText: { color: Colors.dark.tabIconDefault, fontSize: 14, flex: 1 },
  cancelButton: {
    marginTop: 14, paddingVertical: 10, alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 10,
  },
  cancelText: { color: Colors.dark.error, fontWeight: 'bold', fontSize: 14 },
  rateButton: {
    marginTop: 14, paddingVertical: 11, alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)', borderRadius: 10,
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  rateText: { color: '#F59E0B', fontWeight: '700', fontSize: 14 },
  emptyState: { alignItems: 'center', marginTop: 60, gap: 16 },
  emptyText: { color: Colors.dark.tabIconDefault, fontSize: 16 },
});

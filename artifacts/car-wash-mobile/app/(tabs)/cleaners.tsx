import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import Colors from '@/constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '@/components/AppIcon';
import { useRouter } from 'expo-router';
import HomeButton from '@/components/HomeButton';

export default function CleanersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data: cleaners, isLoading, refetch } = useQuery({
    queryKey: ['cleaners', 'available'],
    queryFn: () => apiFetch('/api/cleaners?available=true'),
  });

  const filteredCleaners = cleaners?.filter((w: any) => 
    w.user?.city?.toLowerCase().includes(search.toLowerCase()) ||
    w.user?.name?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const renderCleaner = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={styles.card}
      onPress={() => router.push(`/cleaner/${item.id}` as any)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.user?.name?.[0]?.toUpperCase()}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{item.user?.name}</Text>
          <Text style={styles.city}>
            <AppIcon name="map-pin" size={12} color={Colors.dark.tabIconDefault} /> {item.user?.city}
          </Text>
        </View>
        <View style={styles.priceTag}>
          <Text style={styles.price}>₹{item.pricePerClean ?? item.pricePerWash}</Text>
        </View>
      </View>
      
      <View style={styles.cardFooter}>
        <View style={styles.badge}>
          <View style={styles.dot} />
          <Text style={styles.badgeText}>Available Now</Text>
        </View>
        <Text style={styles.bookText}>Book →</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Find a Cleaner</Text>
          <HomeButton />
        </View>
        <View style={styles.searchContainer}>
          <AppIcon name="search" size={20} color={Colors.dark.tabIconDefault} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by city or name..."
            placeholderTextColor={Colors.dark.tabIconDefault}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.dark.tint} />
      ) : (
        <FlatList
          data={filteredCleaners}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderCleaner}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          refreshing={isLoading}
          onRefresh={refetch}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <AppIcon name="droplet" size={48} color={Colors.dark.tabIconDefault} />
              <Text style={styles.emptyText}>No cleaners available right now.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: { padding: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: Colors.dark.text },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.card,
    borderRadius: 12, paddingHorizontal: 16, height: 50,
  },
  searchInput: { flex: 1, marginLeft: 12, color: Colors.dark.text, fontSize: 16 },
  list: { padding: 20, gap: 16 },
  card: { backgroundColor: Colors.dark.card, borderRadius: 16, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.dark.tint,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 18, fontWeight: 'bold', color: Colors.dark.text },
  city: { fontSize: 14, color: Colors.dark.tabIconDefault, marginTop: 4 },
  priceTag: {
    backgroundColor: 'rgba(37, 99, 235, 0.1)', paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: 12,
  },
  price: { color: Colors.dark.tint, fontWeight: 'bold', fontSize: 16 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 12,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 12,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.dark.success, marginRight: 6 },
  badgeText: { color: Colors.dark.success, fontSize: 12, fontWeight: '600' },
  bookText: { color: Colors.dark.text, fontWeight: 'bold' },
  emptyState: { alignItems: 'center', marginTop: 60, gap: 16 },
  emptyText: { color: Colors.dark.tabIconDefault, fontSize: 16 },
});

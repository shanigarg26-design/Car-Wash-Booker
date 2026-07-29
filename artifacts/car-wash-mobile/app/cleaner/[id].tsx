import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import Colors from '@/constants/colors';
import HomeButton from '@/components/HomeButton';
import AppIcon from '@/components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CleanerDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: cleaner, isLoading } = useQuery({
    queryKey: ['cleaner', id],
    queryFn: () => apiFetch(`/api/cleaners/${id}`),
  });

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.dark.tint} />
      </View>
    );
  }

  if (!cleaner) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>Cleaner not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{color: '#FFF'}}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
        <View style={styles.coverImage}>
          <TouchableOpacity 
            style={[styles.backIcon, { top: insets.top || 20 }]} 
            onPress={() => router.back()}
          >
            <AppIcon name="arrow-left" size={24} color="#FFF" />
          </TouchableOpacity>
          <HomeButton style={[styles.homeIcon, { top: insets.top || 20 }]} color="#FFF" />
          <View style={styles.avatarWrapper}>
            <Text style={styles.avatarText}>{cleaner.name?.[0]?.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.header}>
            <View>
              <Text style={styles.name}>{cleaner.name}</Text>
            </View>
            <View style={styles.priceContainer}>
              <Text style={styles.price}>₹{cleaner.pricePerClean ?? cleaner.pricePerWash}</Text>
              <Text style={styles.priceUnit}>/clean</Text>
            </View>
          </View>

          <View style={styles.badgeRow}>
            {cleaner.available ? (
              <View style={styles.badge}>
                <View style={styles.dot} />
                <Text style={styles.badgeText}>Available Now</Text>
              </View>
            ) : (
              <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                <Text style={[styles.badgeText, { color: Colors.dark.tabIconDefault }]}>Currently Offline</Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bio}>{cleaner.bio || 'This cleaner has not provided a bio yet. They offer professional car cleaning services at your location.'}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <AppIcon name="check-circle" size={24} color={Colors.dark.tint} />
              <Text style={styles.statValue}>{cleaner.totalCleans ?? cleaner.totalWashes ?? 0}</Text>
              <Text style={styles.statLabel}>Cleans</Text>
            </View>
            <View style={styles.statCard}>
              <AppIcon name="star" size={24} color={Colors.dark.warning} />
              <Text style={styles.statValue}>{cleaner.rating ? cleaner.rating.toFixed(1) : 'New'}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom || 24 }]}>
        <TouchableOpacity 
          style={[styles.bookButton, !cleaner.available && styles.bookButtonDisabled]}
          disabled={!cleaner.available}
          onPress={() => router.push(`/book/${cleaner.id}` as any)}
        >
          <Text style={styles.bookButtonText}>
            {cleaner.available ? 'Book Now' : 'Not Available'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  errorText: { color: Colors.dark.text, fontSize: 18, marginBottom: 16 },
  backBtn: { backgroundColor: Colors.dark.tint, padding: 12, borderRadius: 8 },
  coverImage: {
    height: 200, backgroundColor: Colors.dark.card, position: 'relative',
    alignItems: 'center', justifyContent: 'flex-end',
  },
  homeIcon: {
    position: 'absolute', right: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  backIcon: {
    position: 'absolute', left: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  avatarWrapper: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.dark.tint,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 4, borderColor: Colors.dark.background,
    transform: [{ translateY: 50 }], zIndex: 2,
  },
  avatarText: { fontSize: 40, fontWeight: 'bold', color: '#FFF' },
  content: { padding: 24, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  name: { fontSize: 28, fontWeight: 'bold', color: Colors.dark.text },
  priceContainer: { alignItems: 'flex-end' },
  price: { fontSize: 28, fontWeight: 'bold', color: Colors.dark.tint },
  priceUnit: { fontSize: 14, color: Colors.dark.tabIconDefault },
  badgeRow: { marginBottom: 32 },
  badge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: 16, alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.dark.success, marginRight: 8 },
  badgeText: { color: Colors.dark.success, fontSize: 14, fontWeight: 'bold' },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text, marginBottom: 12 },
  bio: { fontSize: 16, color: Colors.dark.tabIconDefault, lineHeight: 24 },
  statsRow: { flexDirection: 'row', gap: 16 },
  statCard: {
    flex: 1, backgroundColor: Colors.dark.card, padding: 20,
    borderRadius: 16, alignItems: 'center', gap: 8,
  },
  statValue: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },
  statLabel: { fontSize: 14, color: Colors.dark.tabIconDefault },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.dark.card, paddingTop: 16, paddingHorizontal: 24,
    borderTopWidth: 1, borderTopColor: Colors.dark.border,
  },
  bookButton: { backgroundColor: Colors.dark.tint, padding: 18, borderRadius: 16, alignItems: 'center' },
  bookButtonDisabled: { backgroundColor: Colors.dark.border },
  bookButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
});

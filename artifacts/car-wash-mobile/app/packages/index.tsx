import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

const VEHICLE_TYPES = [
  'Small Hatchback', 'Premium Hatchback', 'Compact Sedan', 'Premium Sedan',
  'Compact SUV', 'Mid-Size SUV', 'Large SUV', 'Luxury',
];

export default function PackagesScreen() {
  const router = useRouter();
  const [vehicleType, setVehicleType] = useState('Compact Sedan');
  const [washType, setWashType] = useState<'exterior' | 'both'>('exterior');

  const { data: pkgData, isLoading } = useQuery({
    queryKey: ['packages', vehicleType, washType],
    queryFn: () => apiFetch(`/api/packages?vehicleType=${encodeURIComponent(vehicleType)}&washType=${washType}`),
  });
  const { data: mine } = useQuery({ queryKey: ['mySubs'], queryFn: () => apiFetch('/api/subscriptions/mine') });

  // Go to the (dummy) payment screen; it activates the package after "payment".
  const goToPayment = (p: any) => {
    router.push({
      pathname: '/pay',
      params: {
        packageKey: p.key, vehicleType, washType, label: p.label,
        amount: String(p.packagePrice), washes: String(p.washes),
      },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wash Packages</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.lead}>Prepay and save — the longer the plan, the bigger the discount. 💧</Text>

        {/* Active packages */}
        {(mine ?? []).length > 0 && (
          <View style={styles.activeBox}>
            <Text style={styles.activeTitle}>Your active packages</Text>
            {mine.map((s: any) => (
              <View key={s.id} style={styles.activeRow}>
                <AppIcon name="check-circle" size={16} color={Colors.dark.success} />
                <Text style={styles.activeText}>
                  {s.washesRemaining} of {s.washesTotal} washes left · {s.vehicleType || 'Any'} · {s.cleanType === 'both' ? 'Full' : 'Exterior'}
                </Text>
              </View>
            ))}
          </View>
        )}

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

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={Colors.dark.tint} />
        ) : (
          (pkgData?.packages ?? []).map((p: any, i: number) => (
            <View key={p.key} style={[styles.card, i === (pkgData.packages.length - 1) && styles.cardBest]}>
              {i === pkgData.packages.length - 1 && <View style={styles.bestBadge}><Text style={styles.bestBadgeText}>BEST VALUE</Text></View>}
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{p.label}</Text>
                <View style={styles.discPill}><Text style={styles.discPillText}>{p.discountPercent}% OFF</Text></View>
              </View>
              <Text style={styles.cardSub}>{p.washes} wash{p.washes > 1 ? 'es' : ''} · ₹{p.perWashEffective}/wash</Text>
              <View style={styles.priceRow}>
                <Text style={styles.price}>₹{p.packagePrice}</Text>
                <Text style={styles.strike}>₹{p.fullPrice}</Text>
                <Text style={styles.save}>save ₹{p.savings}</Text>
              </View>
              <TouchableOpacity style={styles.buyBtn} onPress={() => goToPayment(p)}>
                <Text style={styles.buyBtnText}>Buy {p.label} · ₹{p.packagePrice}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
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
  activeBox: { backgroundColor: Colors.dark.success + '15', borderRadius: 14, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: Colors.dark.success + '55' },
  activeTitle: { color: Colors.dark.success, fontWeight: '700', marginBottom: 8 },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  activeText: { color: Colors.dark.text, fontSize: 13, flex: 1 },
  sectionLabel: { color: Colors.dark.text, fontWeight: '600', marginBottom: 8, fontSize: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.dark.card, marginRight: 8, borderWidth: 1, borderColor: Colors.dark.border },
  chipActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  chipText: { color: Colors.dark.tabIconDefault, fontSize: 13 },
  chipTextActive: { color: '#FFF', fontWeight: '600' },
  washRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  washBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.dark.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.dark.border },
  washBtnActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  washBtnText: { color: Colors.dark.tabIconDefault, fontSize: 13 },
  washBtnTextActive: { color: '#FFF', fontWeight: '600' },
  card: { backgroundColor: Colors.dark.card, borderRadius: 16, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: Colors.dark.border },
  cardBest: { borderColor: Colors.dark.tint },
  bestBadge: { position: 'absolute', top: -1, right: 16, backgroundColor: Colors.dark.tint, paddingHorizontal: 10, paddingVertical: 3, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  bestBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '800' },
  discPill: { backgroundColor: Colors.dark.success + '25', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  discPillText: { color: Colors.dark.success, fontWeight: '700', fontSize: 12 },
  cardSub: { color: Colors.dark.tabIconDefault, fontSize: 13, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10 },
  price: { color: Colors.dark.text, fontSize: 26, fontWeight: '900' },
  strike: { color: Colors.dark.tabIconDefault, fontSize: 15, textDecorationLine: 'line-through', marginBottom: 3 },
  save: { color: Colors.dark.success, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  buyBtn: { backgroundColor: Colors.dark.tint, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  buyBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});

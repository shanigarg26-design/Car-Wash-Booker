import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

const VEHICLE_TYPES = ['Small Hatchback', 'Premium Hatchback', 'Compact Sedan', 'Premium Sedan', 'Compact SUV', 'Mid-Size SUV', 'Large SUV', 'Luxury'];
const PRICING: Record<string, { exterior: number; both: number }> = {
  'Small Hatchback': { exterior: 120, both: 220 }, 'Premium Hatchback': { exterior: 140, both: 260 },
  'Compact Sedan': { exterior: 160, both: 300 }, 'Premium Sedan': { exterior: 180, both: 320 },
  'Compact SUV': { exterior: 200, both: 350 }, 'Mid-Size SUV': { exterior: 230, both: 400 },
  'Large SUV': { exterior: 280, both: 500 }, 'Luxury': { exterior: 350, both: 700 },
};

export default function EditBookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [washType, setWashType] = useState<'exterior' | 'both'>('exterior');

  const { data: booking, isLoading } = useQuery({ queryKey: ['booking', id], queryFn: () => apiFetch(`/api/bookings/${id}`) });
  useEffect(() => {
    if (booking) { setVehicleType(booking.vehicleType ?? null); setWashType((booking.washType ?? booking.cleanType) === 'both' ? 'both' : 'exterior'); }
  }, [booking?.id]);

  const price = vehicleType ? (washType === 'both' ? PRICING[vehicleType].both : PRICING[vehicleType].exterior) : null;

  const save = useMutation({
    mutationFn: () => apiFetch(`/api/bookings/${id}/edit`, { method: 'PATCH', body: JSON.stringify({ vehicleType, washType }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking', id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      router.back();
    },
    onError: (e: any) => Alert.alert('Could not update', e.message ?? 'Please try again.'),
  });

  if (isLoading || !booking) return <View style={[styles.root, { justifyContent: 'center' }]}><ActivityIndicator color={Colors.dark.tint} /></View>;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><AppIcon name="arrow-left" size={24} color={Colors.dark.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Booking</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.label}>Vehicle</Text>
        <View style={styles.wrap}>
          {VEHICLE_TYPES.map(v => (
            <TouchableOpacity key={v} style={[styles.chip, vehicleType === v && styles.chipActive]} onPress={() => setVehicleType(v)}>
              <Text style={[styles.chipText, vehicleType === v && styles.chipTextActive]}>{v}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Wash type</Text>
        <View style={styles.row}>
          {(['exterior', 'both'] as const).map(w => (
            <TouchableOpacity key={w} style={[styles.washBtn, washType === w && styles.washBtnActive]} onPress={() => setWashType(w)}>
              <Text style={[styles.washText, washType === w && styles.washTextActive]}>{w === 'both' ? 'Exterior + Interior' : 'Exterior only'}</Text>
              {vehicleType && <Text style={[styles.washPrice, washType === w && { color: '#FFF' }]}>₹{PRICING[vehicleType][w]}</Text>}
            </TouchableOpacity>
          ))}
        </View>
        {price != null && <Text style={styles.total}>New total: ₹{price}</Text>}
        <TouchableOpacity style={[styles.saveBtn, (!vehicleType || save.isPending) && { opacity: 0.5 }]} onPress={() => save.mutate()} disabled={!vehicleType || save.isPending}>
          {save.isPending ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Save Changes</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  backBtn: { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '700' },
  label: { color: Colors.dark.text, fontWeight: '600', marginBottom: 10, marginTop: 8, fontSize: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },
  chipActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  chipText: { color: Colors.dark.tabIconDefault, fontSize: 13 },
  chipTextActive: { color: '#FFF', fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12 },
  washBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: Colors.dark.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.dark.border },
  washBtnActive: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  washText: { color: Colors.dark.tabIconDefault, fontSize: 13, textAlign: 'center' },
  washTextActive: { color: '#FFF', fontWeight: '600' },
  washPrice: { color: Colors.dark.tabIconDefault, fontSize: 15, fontWeight: '700', marginTop: 4 },
  total: { color: Colors.dark.text, fontSize: 16, fontWeight: '800', marginTop: 20 },
  saveBtn: { backgroundColor: Colors.dark.tint, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});

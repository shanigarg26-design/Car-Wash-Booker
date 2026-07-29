import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import HomeButton from '@/components/HomeButton';
import AppIcon from '@/components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BookCleanerScreen() {
  const { cleanerId } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [address, setAddress] = useState(user?.address || '');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');

  const { data: cleaner, isLoading } = useQuery({
    queryKey: ['cleaner', cleanerId],
    queryFn: () => apiFetch(`/api/cleaners/${cleanerId}`),
  });

  const bookMutation = useMutation({
    mutationFn: (data: any) => apiFetch('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      Alert.alert('Success', 'Booking confirmed!', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/bookings') }
      ]);
    },
    onError: (e: any) => Alert.alert('Error', e.message),
  });

  const handleBook = () => {
    if (!address || !date) {
      Alert.alert('Error', 'Please provide address and date');
      return;
    }
    
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 1);

    bookMutation.mutate({
      cleanerId: Number(cleanerId),
      customerAddress: address,
      scheduledAt: scheduledAt.toISOString(),
      notes,
    });
  };

  if (isLoading || !cleaner) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.dark.tint} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top || 20 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <AppIcon name="x" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Booking</Text>
        <HomeButton />
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.summaryCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{cleaner.name?.[0]}</Text>
          </View>
          <View style={styles.summaryInfo}>
            <Text style={styles.summaryName}>{cleaner.name}</Text>
            <Text style={styles.summaryPrice}>₹{cleaner.pricePerClean ?? cleaner.pricePerWash} / clean</Text>
          </View>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Service Address</Text>
            <View style={styles.inputWrapper}>
              <AppIcon name="map-pin" size={20} color={Colors.dark.tabIconDefault} />
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={setAddress}
                placeholder="Where should we clean your car?"
                placeholderTextColor={Colors.dark.tabIconDefault}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>When</Text>
            <View style={styles.inputWrapper}>
              <AppIcon name="calendar" size={20} color={Colors.dark.tabIconDefault} />
              <TextInput
                style={styles.input}
                value={date}
                onChangeText={setDate}
                placeholder="e.g., Tomorrow at 10 AM"
                placeholderTextColor={Colors.dark.tabIconDefault}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Notes (Optional)</Text>
            <View style={[styles.inputWrapper, { height: 100, alignItems: 'flex-start', paddingTop: 12 }]}>
              <AppIcon name="file-text" size={20} color={Colors.dark.tabIconDefault} />
              <TextInput
                style={[styles.input, { height: 80, marginLeft: 12 }]}
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Any special instructions for the cleaner?"
                placeholderTextColor={Colors.dark.tabIconDefault}
              />
            </View>
          </View>
        </View>

        <View style={styles.priceBreakdown}>
          <Text style={styles.breakdownTitle}>Price Details</Text>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Car Clean</Text>
            <Text style={styles.breakdownValue}>₹{cleaner.pricePerClean ?? cleaner.pricePerWash}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Service Fee</Text>
            <Text style={styles.breakdownValue}>₹0</Text>
          </View>
          <View style={[styles.breakdownRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₹{cleaner.pricePerClean ?? cleaner.pricePerWash}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom || 24 }]}>
        <TouchableOpacity 
          style={styles.bookButton}
          onPress={handleBook}
          disabled={bookMutation.isPending}
        >
          {bookMutation.isPending ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.bookButtonText}>Confirm & Book</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
    paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  closeBtn: { padding: 8, marginRight: 16 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },
  content: { flex: 1, padding: 20 },
  summaryCard: {
    flexDirection: 'row', backgroundColor: Colors.dark.card, padding: 16,
    borderRadius: 16, marginBottom: 24, alignItems: 'center',
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.dark.tint,
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  avatarText: { color: '#FFF', fontSize: 24, fontWeight: 'bold' },
  summaryInfo: { flex: 1 },
  summaryName: { fontSize: 18, fontWeight: 'bold', color: Colors.dark.text },
  summaryPrice: { fontSize: 16, color: Colors.dark.tint, marginTop: 4, fontWeight: '600' },
  form: { gap: 20, marginBottom: 32 },
  inputGroup: { gap: 8 },
  label: { color: Colors.dark.text, fontSize: 16, fontWeight: '600' },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.card,
    borderRadius: 12, paddingHorizontal: 16, height: 56,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  input: { flex: 1, marginLeft: 12, color: Colors.dark.text, fontSize: 16 },
  priceBreakdown: {
    backgroundColor: Colors.dark.card, padding: 20, borderRadius: 16, marginBottom: 40,
  },
  breakdownTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.dark.text, marginBottom: 16 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  breakdownLabel: { color: Colors.dark.tabIconDefault, fontSize: 16 },
  breakdownValue: { color: Colors.dark.text, fontSize: 16, fontWeight: '500' },
  totalRow: { marginTop: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: Colors.dark.border, marginBottom: 0 },
  totalLabel: { color: Colors.dark.text, fontSize: 18, fontWeight: 'bold' },
  totalValue: { color: Colors.dark.tint, fontSize: 20, fontWeight: 'bold' },
  footer: { paddingTop: 16, paddingHorizontal: 24, backgroundColor: Colors.dark.card, borderTopWidth: 1, borderTopColor: Colors.dark.border },
  bookButton: { backgroundColor: Colors.dark.tint, padding: 16, borderRadius: 16, alignItems: 'center' },
  bookButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
});

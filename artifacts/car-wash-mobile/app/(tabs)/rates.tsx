import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import AppIcon from '@/components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

const RATES = [
  { vehicle: 'Small Hatchback',   icon: '🚗', exterior: 120, both: 220 },
  { vehicle: 'Premium Hatchback', icon: '🚙', exterior: 140, both: 260 },
  { vehicle: 'Compact Sedan',     icon: '🚘', exterior: 160, both: 300 },
  { vehicle: 'Premium Sedan',     icon: '🏎️', exterior: 180, both: 320 },
  { vehicle: 'Compact SUV',       icon: '🚐', exterior: 200, both: 350 },
  { vehicle: 'Mid-Size SUV',      icon: '🚌', exterior: 230, both: 400 },
  { vehicle: 'Large SUV',         icon: '🚑', exterior: 280, both: 500 },
  { vehicle: 'Luxury',            icon: '🏅', exterior: 350, both: 700 },
];

type Filter = 'all' | 'exterior' | 'both';

export default function RatesScreen() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <View style={[styles.root, { paddingTop: insets.top || 20 }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Clean Rates</Text>
        <Text style={styles.headerSub}>Standard pricing for all vehicle types</Text>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'exterior', 'both'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, filter === f && styles.filterBtnTextActive]}>
              {f === 'all' ? 'All' : f === 'exterior' ? 'Exterior' : 'E + Interior'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Table Header */}
      <View style={styles.tableHeader}>
        <Text style={[styles.thCell, { flex: 2 }]}>Vehicle Type</Text>
        {(filter === 'all' || filter === 'exterior') && (
          <View style={[styles.thServiceCol, filter === 'exterior' && styles.thServiceColFull]}>
            <AppIcon name="droplet" size={12} color={Colors.dark.tint} />
            <Text style={styles.thService}>Exterior</Text>
          </View>
        )}
        {(filter === 'all' || filter === 'both') && (
          <View style={[styles.thServiceCol, filter === 'both' && styles.thServiceColFull]}>
            <AppIcon name="star" size={12} color="#F59E0B" />
            <Text style={[styles.thService, { color: '#F59E0B' }]}>E + Interior</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        {RATES.map((row, idx) => (
          <View key={row.vehicle} style={[styles.row, idx % 2 === 0 && styles.rowAlt]}>
            <View style={[styles.vehicleCell, { flex: 2 }]}>
              <Text style={styles.vehicleIcon}>{row.icon}</Text>
              <Text style={styles.vehicleName}>{row.vehicle}</Text>
            </View>
            {(filter === 'all' || filter === 'exterior') && (
              <View style={[styles.priceCell, filter === 'exterior' && styles.priceCellFull]}>
                <Text style={styles.priceValue}>₹{row.exterior}</Text>
              </View>
            )}
            {(filter === 'all' || filter === 'both') && (
              <View style={[styles.priceCell, filter === 'both' && styles.priceCellFull]}>
                <Text style={[styles.priceValue, styles.priceValuePremium]}>₹{row.both}</Text>
              </View>
            )}
          </View>
        ))}

        {/* Summary cards */}
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>What's included?</Text>
          <View style={styles.summaryCards}>
            <View style={styles.summaryCard}>
              <AppIcon name="droplet" size={20} color={Colors.dark.tint} />
              <Text style={styles.summaryCardTitle}>Exterior Only</Text>
              <Text style={styles.summaryCardDesc}>
                Full exterior wash, rinse, and wipe-down of all outer panels, windows, and wheels.
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <AppIcon name="star" size={20} color="#F59E0B" />
              <Text style={[styles.summaryCardTitle, { color: '#F59E0B' }]}>Exterior + Interior</Text>
              <Text style={styles.summaryCardDesc}>
                Everything in exterior, plus vacuuming, dashboard wipe, seat cleaning, and interior glass.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.noteCard}>
          <AppIcon name="info" size={14} color={Colors.dark.tabIconDefault} />
          <Text style={styles.noteText}>
            Prices are fixed and non-negotiable. The exact amount shown will be charged. No hidden fees.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  headerSub: {
    fontSize: 14,
    color: Colors.dark.tabIconDefault,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 8,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  filterBtnActive: {
    backgroundColor: Colors.dark.tint,
    borderColor: Colors.dark.tint,
  },
  filterBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.tabIconDefault,
  },
  filterBtnTextActive: {
    color: '#FFF',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.dark.card,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: 'center',
  },
  thCell: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.dark.tabIconDefault,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thServiceCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  thServiceColFull: {
    flex: 1.5,
  },
  thService: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.tint,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  scroll: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  rowAlt: {
    backgroundColor: `${Colors.dark.card}80`,
  },
  vehicleCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  vehicleIcon: {
    fontSize: 22,
  },
  vehicleName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
    flexShrink: 1,
  },
  priceCell: {
    flex: 1,
    alignItems: 'center',
  },
  priceCellFull: {
    flex: 1.5,
  },
  priceValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.tint,
  },
  priceValuePremium: {
    color: '#F59E0B',
  },
  summarySection: {
    marginHorizontal: 20,
    marginTop: 28,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  summaryCards: {
    gap: 12,
  },
  summaryCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 18,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  summaryCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.tint,
  },
  summaryCardDesc: {
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
    lineHeight: 19,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    lineHeight: 18,
  },
});

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import AppIcon from '@/components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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

export default function PublicRatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.root, { paddingTop: insets.top || 20 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <AppIcon name="x" size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Wash Rates</Text>
          <Text style={styles.headerSub}>Transparent pricing — no hidden fees</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
      >
        {/* Intro banner */}
        <View style={styles.introBanner}>
          <Text style={styles.introEmoji}>💧</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Fixed, fair pricing</Text>
            <Text style={styles.introSub}>
              Every wash is priced by vehicle size. You see the exact amount before booking — no surprises.
            </Text>
          </View>
        </View>

        {/* Column headers */}
        <View style={styles.tableHeader}>
          <Text style={[styles.thVehicle]}>Vehicle Type</Text>
          <View style={styles.thCol}>
            <AppIcon name="droplet" size={13} color={Colors.dark.tint} />
            <Text style={styles.thLabel}>Exterior</Text>
          </View>
          <View style={styles.thCol}>
            <AppIcon name="star" size={13} color="#F59E0B" />
            <Text style={[styles.thLabel, { color: '#F59E0B' }]}>E + Interior</Text>
          </View>
        </View>

        {/* Rows */}
        {RATES.map((row, idx) => (
          <View key={row.vehicle} style={[styles.row, idx % 2 === 0 && styles.rowAlt]}>
            <View style={styles.vehicleCell}>
              <Text style={styles.vehicleIcon}>{row.icon}</Text>
              <Text style={styles.vehicleName}>{row.vehicle}</Text>
            </View>
            <View style={styles.priceCell}>
              <Text style={styles.priceBlue}>₹{row.exterior}</Text>
            </View>
            <View style={styles.priceCell}>
              <Text style={styles.priceAmber}>₹{row.both}</Text>
            </View>
          </View>
        ))}

        {/* What's included */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What's included?</Text>

          <View style={styles.serviceCard}>
            <View style={[styles.serviceIconBox, { backgroundColor: `${Colors.dark.tint}18` }]}>
              <AppIcon name="droplet" size={20} color={Colors.dark.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.serviceTitle}>Exterior Only</Text>
              <Text style={styles.serviceDesc}>
                Full exterior wash · Rinse · Wipe-down of all panels, windows & wheels
              </Text>
            </View>
          </View>

          <View style={styles.serviceCard}>
            <View style={[styles.serviceIconBox, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
              <AppIcon name="star" size={20} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.serviceTitle, { color: '#F59E0B' }]}>Exterior + Interior</Text>
              <Text style={styles.serviceDesc}>
                Everything in Exterior · Plus vacuuming, dashboard wipe, seat cleaning & interior glass
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.noteBox}>
          <AppIcon name="shield" size={15} color={Colors.dark.success} />
          <Text style={styles.noteText}>
            All cleaners are verified professionals. Payment is collected after the job is complete.
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  introBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    margin: 20,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  introEmoji: {
    fontSize: 28,
  },
  introTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  introSub: {
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
    lineHeight: 19,
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
  thVehicle: {
    flex: 2,
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.tabIconDefault,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  thLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.tint,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
    backgroundColor: `${Colors.dark.card}70`,
  },
  vehicleCell: {
    flex: 2,
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
  priceBlue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.tint,
  },
  priceAmber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  section: {
    margin: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  serviceIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.tint,
    marginBottom: 4,
  },
  serviceDesc: {
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
    lineHeight: 19,
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 20,
    backgroundColor: `${Colors.dark.success}12`,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: `${Colors.dark.success}30`,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
    lineHeight: 19,
  },
});

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

interface Props {
  visible: boolean;
  initialSlots: number[];
  saving?: boolean;
  onClose: () => void;
  onSave: (slots: number[]) => void;
}

// 24 half-hour slots, 06:00–18:00 IST. index i → 06:00 + i*30min.
export function slotLabel(i: number): string {
  const totalMin = 6 * 60 + i * 30;
  const h24 = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
export function slotRangeLabel(i: number): string {
  return `${slotLabel(i)} – ${slotLabel(i + 1 <= 24 ? i + 1 : i)}`;
}

const ALL_SLOTS = Array.from({ length: 24 }, (_, i) => i);

export default function AvailabilityManager({ visible, initialSlots, saving, onClose, onSave }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set(initialSlots));

  useEffect(() => { if (visible) setSelected(new Set(initialSlots)); }, [visible, initialSlots]);

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(ALL_SLOTS));
  const clearAll = () => setSelected(new Set());

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Your available hours</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <AppIcon name="x" size={22} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>Tap the half-hour slots you want to work. You’ll only receive bookings during selected slots.</Text>

          <View style={styles.bulkRow}>
            <TouchableOpacity onPress={selectAll} style={styles.bulkBtn}><Text style={styles.bulkText}>Select all</Text></TouchableOpacity>
            <TouchableOpacity onPress={clearAll} style={styles.bulkBtn}><Text style={styles.bulkText}>Clear</Text></TouchableOpacity>
            <Text style={styles.count}>{selected.size} selected</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.grid}>
              {ALL_SLOTS.map(i => {
                const on = selected.has(i);
                return (
                  <TouchableOpacity key={i} style={[styles.slot, on && styles.slotOn]} onPress={() => toggle(i)} activeOpacity={0.8}>
                    <Text style={[styles.slotText, on && styles.slotTextOn]}>{slotLabel(i)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
            onPress={() => onSave(Array.from(selected).sort((a, b) => a - b))}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Save hours</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.dark.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, maxHeight: '90%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: Colors.dark.text },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: 13, color: Colors.dark.tabIconDefault, marginTop: 4, marginBottom: 14, lineHeight: 18 },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  bulkBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },
  bulkText: { color: Colors.dark.tint, fontSize: 13, fontWeight: '600' },
  count: { marginLeft: 'auto', color: Colors.dark.tabIconDefault, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: {
    width: '31%', paddingVertical: 11, borderRadius: 10, alignItems: 'center',
    backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border,
  },
  slotOn: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  slotText: { color: Colors.dark.text, fontSize: 13, fontWeight: '600' },
  slotTextOn: { color: '#FFF' },
  saveBtn: { backgroundColor: Colors.dark.tint, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  saveText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

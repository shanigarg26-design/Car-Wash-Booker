import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

interface SchedulePickerProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (isoString: string) => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Time slots every 30 minutes from 07:00 to 21:00 — no free text entry.
const TIME_SLOTS: { h: number; m: number }[] = [];
for (let h = 7; h <= 21; h++) {
  TIME_SLOTS.push({ h, m: 0 });
  if (h !== 21) TIME_SLOTS.push({ h, m: 30 });
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtTime(h: number, m: number) {
  const ampm = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function SchedulePicker({ visible, onClose, onConfirm }: SchedulePickerProps) {
  const now = new Date();
  const today = startOfDay(now);

  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ h: number; m: number } | null>(null);

  // Days grid for the viewed month, with leading blanks aligned to weekday.
  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const arr: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(viewYear, viewMonth, d));
    return arr;
  }, [viewYear, viewMonth]);

  const canGoPrev = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth > today.getMonth());

  const goPrev = () => {
    if (!canGoPrev) return;
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const isSlotDisabled = (slot: { h: number; m: number }) => {
    if (!selectedDate) return false;
    if (!sameDay(selectedDate, now)) return false;
    // For today, disallow past times (with a small buffer).
    const slotDate = new Date(selectedDate);
    slotDate.setHours(slot.h, slot.m, 0, 0);
    return slotDate.getTime() <= now.getTime() + 10 * 60 * 1000;
  };

  const confirm = () => {
    if (!selectedDate || !selectedSlot) return;
    const dt = new Date(selectedDate);
    dt.setHours(selectedSlot.h, selectedSlot.m, 0, 0);
    onConfirm(dt.toISOString());
    reset();
  };

  const reset = () => {
    setSelectedDate(null);
    setSelectedSlot(null);
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Schedule for later</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <AppIcon name="x" size={22} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
            {/* Month navigation */}
            <View style={styles.monthRow}>
              <TouchableOpacity onPress={goPrev} disabled={!canGoPrev} style={[styles.navBtn, !canGoPrev && styles.navBtnDisabled]}>
                <AppIcon name="chevron-right" size={20} color={canGoPrev ? Colors.dark.text : Colors.dark.tabIconDefault} style={{ transform: [{ rotate: '180deg' }] }} />
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{MONTHS[viewMonth]} {viewYear}</Text>
              <TouchableOpacity onPress={goNext} style={styles.navBtn}>
                <AppIcon name="chevron-right" size={20} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>

            {/* Weekday header */}
            <View style={styles.weekRow}>
              {WEEKDAYS.map((d, i) => (
                <Text key={i} style={styles.weekday}>{d}</Text>
              ))}
            </View>

            {/* Day grid */}
            <View style={styles.grid}>
              {cells.map((cell, i) => {
                if (!cell) return <View key={`b${i}`} style={styles.dayCell} />;
                const disabled = startOfDay(cell).getTime() < today.getTime();
                const selected = selectedDate != null && sameDay(cell, selectedDate);
                return (
                  <TouchableOpacity
                    key={cell.toISOString()}
                    style={styles.dayCell}
                    disabled={disabled}
                    onPress={() => { setSelectedDate(cell); setSelectedSlot(null); }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.dayInner, selected && styles.daySelected]}>
                      <Text style={[styles.dayText, disabled && styles.dayDisabled, selected && styles.dayTextSelected]}>
                        {cell.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Time slots */}
            {selectedDate && (
              <View style={styles.timeSection}>
                <Text style={styles.timeTitle}>Pick a time</Text>
                <View style={styles.slotWrap}>
                  {TIME_SLOTS.map((slot) => {
                    const disabled = isSlotDisabled(slot);
                    const selected = selectedSlot?.h === slot.h && selectedSlot?.m === slot.m;
                    return (
                      <TouchableOpacity
                        key={`${slot.h}-${slot.m}`}
                        style={[styles.slot, selected && styles.slotSelected, disabled && styles.slotDisabled]}
                        disabled={disabled}
                        onPress={() => setSelectedSlot(slot)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.slotText, selected && styles.slotTextSelected, disabled && styles.slotTextDisabled]}>
                          {fmtTime(slot.h, slot.m)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.confirmBtn, (!selectedDate || !selectedSlot) && styles.confirmBtnDisabled]}
            disabled={!selectedDate || !selectedSlot}
            onPress={confirm}
            activeOpacity={0.85}
          >
            <AppIcon name="clock" size={18} color="#FFF" />
            <Text style={styles.confirmText}>
              {selectedDate && selectedSlot
                ? `Schedule for ${MONTHS[selectedDate.getMonth()].slice(0, 3)} ${selectedDate.getDate()}, ${fmtTime(selectedSlot.h, selectedSlot.m)}`
                : 'Pick a date & time'}
            </Text>
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
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, maxHeight: '88%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.dark.text },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.dark.card, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekday: { flex: 1, textAlign: 'center', color: Colors.dark.tabIconDefault, fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  dayInner: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: Colors.dark.tint },
  dayText: { fontSize: 15, color: Colors.dark.text },
  dayTextSelected: { color: '#FFF', fontWeight: '700' },
  dayDisabled: { color: Colors.dark.border },
  timeSection: { marginTop: 16 },
  timeTitle: { fontSize: 15, fontWeight: '700', color: Colors.dark.text, marginBottom: 10 },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border,
  },
  slotSelected: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },
  slotDisabled: { opacity: 0.35 },
  slotText: { color: Colors.dark.text, fontSize: 14, fontWeight: '600' },
  slotTextSelected: { color: '#FFF' },
  slotTextDisabled: { color: Colors.dark.tabIconDefault },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.dark.tint, borderRadius: 14, paddingVertical: 15, marginTop: 12,
  },
  confirmBtnDisabled: { backgroundColor: Colors.dark.border },
  confirmText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

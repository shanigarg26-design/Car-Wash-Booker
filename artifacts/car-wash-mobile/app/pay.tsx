import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

type Method = 'card' | 'netbanking' | 'upi';
const BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra', 'Punjab National Bank'];

export default function PayScreen() {
  const p = useLocalSearchParams<{ packageKey: string; vehicleType: string; washType: string; label: string; amount: string; washes: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const amount = Number(p.amount || 0);

  const [method, setMethod] = useState<Method>('card');
  const [processing, setProcessing] = useState(false);
  // Dummy fields
  const [cardNum, setCardNum] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [bank, setBank] = useState<string | null>(null);
  const [upi, setUpi] = useState('');

  const valid =
    method === 'card' ? cardNum.replace(/\s/g, '').length >= 12 && cardName.trim() && expiry.length >= 4 && cvv.length >= 3
    : method === 'netbanking' ? !!bank
    : /.+@.+/.test(upi);

  const activate = async () => {
    setProcessing(true);
    // Simulate a payment gateway round-trip (DUMMY — no real charge).
    await new Promise(r => setTimeout(r, 1600));
    try {
      const sub: any = await apiFetch('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ packageKey: p.packageKey, vehicleType: p.vehicleType, washType: p.washType }),
      });
      qc.invalidateQueries({ queryKey: ['mySubs'] });
      setProcessing(false);
      const done = () => router.replace('/(tabs)');
      const msg = `Payment successful (demo). Your ${sub.label} package is active with ${sub.washesTotal} washes.`;
      if (Platform.OS === 'web') { window.alert(msg); done(); }
      else Alert.alert('✅ Payment Successful', msg, [{ text: 'Great!', onPress: done }]);
    } catch (e: any) {
      setProcessing(false);
      Alert.alert('Payment failed', e.message ?? 'Please try again.');
    }
  };

  const fmtCard = (t: string) => t.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} disabled={processing}>
          <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>{p.label} package · {p.washes} washes</Text>
          <Text style={styles.summaryAmount}>₹{amount}</Text>
        </View>
        <View style={styles.demoNote}>
          <AppIcon name="info" size={14} color={Colors.dark.tint} />
          <Text style={styles.demoNoteText}>Demo payment — no real money is charged.</Text>
        </View>

        <Text style={styles.sectionLabel}>Pay using</Text>
        <View style={styles.methodRow}>
          {([['card', 'credit-card', 'Card'], ['netbanking', 'briefcase', 'Net Banking'], ['upi', 'smartphone', 'UPI']] as const).map(([m, icon, label]) => (
            <TouchableOpacity key={m} style={[styles.methodTab, method === m && styles.methodTabActive]} onPress={() => setMethod(m)}>
              <AppIcon name={icon} size={18} color={method === m ? Colors.dark.tint : Colors.dark.tabIconDefault} />
              <Text style={[styles.methodTabText, method === m && styles.methodTabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {method === 'card' && (
          <View style={styles.form}>
            <Text style={styles.fieldLabel}>Card number</Text>
            <TextInput style={styles.input} value={cardNum} onChangeText={t => setCardNum(fmtCard(t))} placeholder="1234 5678 9012 3456" placeholderTextColor={Colors.dark.tabIconDefault} keyboardType="number-pad" />
            <Text style={styles.fieldLabel}>Name on card</Text>
            <TextInput style={styles.input} value={cardName} onChangeText={setCardName} placeholder="Full name" placeholderTextColor={Colors.dark.tabIconDefault} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Expiry</Text>
                <TextInput style={styles.input} value={expiry} onChangeText={t => setExpiry(t.replace(/[^\d/]/g, '').slice(0, 5))} placeholder="MM/YY" placeholderTextColor={Colors.dark.tabIconDefault} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>CVV</Text>
                <TextInput style={styles.input} value={cvv} onChangeText={t => setCvv(t.replace(/\D/g, '').slice(0, 3))} placeholder="123" placeholderTextColor={Colors.dark.tabIconDefault} keyboardType="number-pad" secureTextEntry />
              </View>
            </View>
          </View>
        )}

        {method === 'netbanking' && (
          <View style={styles.form}>
            <Text style={styles.fieldLabel}>Select your bank</Text>
            {BANKS.map(b => (
              <TouchableOpacity key={b} style={[styles.bankRow, bank === b && styles.bankRowActive]} onPress={() => setBank(b)}>
                <Text style={[styles.bankText, bank === b && { color: Colors.dark.tint, fontWeight: '700' }]}>{b}</Text>
                {bank === b && <AppIcon name="check-circle" size={18} color={Colors.dark.tint} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {method === 'upi' && (
          <View style={styles.form}>
            <Text style={styles.fieldLabel}>UPI ID</Text>
            <TextInput style={styles.input} value={upi} onChangeText={setUpi} placeholder="yourname@upi" placeholderTextColor={Colors.dark.tabIconDefault} autoCapitalize="none" />
            <Text style={styles.hint}>e.g. 9876543210@paytm, name@okhdfcbank</Text>
          </View>
        )}

        <TouchableOpacity style={[styles.payBtn, (!valid || processing) && styles.payBtnDisabled]} onPress={activate} disabled={!valid || processing}>
          {processing ? <ActivityIndicator color="#FFF" /> : <Text style={styles.payBtnText}>Pay ₹{amount}</Text>}
        </TouchableOpacity>
        <View style={styles.secureRow}>
          <AppIcon name="shield" size={13} color={Colors.dark.tabIconDefault} />
          <Text style={styles.secureText}>Secured demo checkout</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  backBtn: { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '700' },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.dark.card, borderRadius: 14, padding: 16 },
  summaryLabel: { color: Colors.dark.text, fontSize: 14, flex: 1 },
  summaryAmount: { color: Colors.dark.text, fontSize: 24, fontWeight: '900' },
  demoNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 18 },
  demoNoteText: { color: Colors.dark.tabIconDefault, fontSize: 12 },
  sectionLabel: { color: Colors.dark.text, fontWeight: '600', marginBottom: 10, fontSize: 14 },
  methodRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  methodTab: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border },
  methodTabActive: { borderColor: Colors.dark.tint, backgroundColor: Colors.dark.tint + '15' },
  methodTabText: { color: Colors.dark.tabIconDefault, fontSize: 12 },
  methodTabTextActive: { color: Colors.dark.tint, fontWeight: '700' },
  form: { gap: 4 },
  fieldLabel: { color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: Colors.dark.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: Colors.dark.text, fontSize: 15, borderWidth: 1, borderColor: Colors.dark.border },
  hint: { color: Colors.dark.tabIconDefault, fontSize: 11, marginTop: 6 },
  bankRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, backgroundColor: Colors.dark.card, marginTop: 8, borderWidth: 1, borderColor: Colors.dark.border },
  bankRowActive: { borderColor: Colors.dark.tint },
  bankText: { color: Colors.dark.text, fontSize: 14 },
  payBtn: { backgroundColor: Colors.dark.tint, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 },
  secureText: { color: Colors.dark.tabIconDefault, fontSize: 12 },
});

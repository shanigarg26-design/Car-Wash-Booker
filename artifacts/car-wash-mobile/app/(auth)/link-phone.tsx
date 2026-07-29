import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Animated,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AppIcon from '@/components/AppIcon';
import { apiFetch, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import HomeButton from '@/components/HomeButton';

export default function LinkPhoneScreen() {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [smsFailed, setSmsFailed] = useState(false);
  const [shakeAnim] = useState(new Animated.Value(0));

  const otpRefs = useRef<Array<TextInput | null>>([]);
  const { signIn } = useAuth();

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleSendOtp = async () => {
    setErrorMsg('');
    if (!phone.trim()) {
      setErrorMsg('Please enter your phone number.');
      shake();
      return;
    }
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await apiFetch('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (res?.devOtp) { setDevOtp(res.devOtp); setSmsFailed(false); }
      else if (res?.smsSent === false) { setDevOtp('1111'); setSmsFailed(true); }
      else { setSmsFailed(false); }
      setStep('otp');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setErrorMsg('');
    const code = otp.join('');
    if (code.length < 4) {
      setErrorMsg('Please enter the full 4-digit code.');
      shake();
      return;
    }
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await apiFetch('/api/auth/link-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), code }),
      });
      signIn(res);
      router.replace('/(tabs)');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (val: string, idx: number) => {
    const digits = val.replace(/\D/g, '');
    const next = [...otp];
    if (digits.length > 1) {
      const pasted = digits.slice(0, 4).split('');
      for (let i = 0; i < 4; i++) next[i] = pasted[i] || '';
      setOtp(next);
      otpRefs.current[3]?.focus();
      return;
    }
    next[idx] = digits;
    setOtp(next);
    if (digits && idx < 3) otpRefs.current[idx + 1]?.focus();
  };

  const handleOtpKeyPress = (key: string, idx: number) => {
    if (key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleSkip = () => {
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.topBar}>
            <HomeButton />
            <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </View>

          {/* Icon */}
          <View style={styles.iconWrap}>
            <AppIcon name="smartphone" size={40} color={Colors.dark.tint} />
          </View>

          {/* Title */}
          <Text style={styles.title}>Link your phone number</Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? 'Connect your phone so you can also log in with OTP anytime'
              : `Enter the 4-digit code sent to +91 ${phone}`}
          </Text>

          <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
            {step === 'phone' ? (
              <>
                <View style={styles.phoneRow}>
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phoneFlagText}>🇮🇳</Text>
                    <Text style={styles.phoneCodeText}>+91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setErrorMsg(''); }}
                    keyboardType="number-pad"
                    placeholder="98765 43210"
                    placeholderTextColor={Colors.dark.tabIconDefault}
                    maxLength={10}
                    autoFocus
                  />
                </View>

                {errorMsg ? (
                  <View style={styles.errorBox}>
                    <AppIcon name="alert-circle" size={15} color="#F87171" />
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
                  onPress={handleSendOtp}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Send OTP</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                {devOtp ? (
                  <View style={styles.devBanner}>
                    <AppIcon name={smsFailed ? 'alert-triangle' : 'terminal'} size={14} color="#60A5FA" />
                    <Text style={styles.devBannerText}>
                      {smsFailed
                        ? <>SMS not delivered. Use bypass code: <Text style={styles.devOtpText}>1111</Text></>
                        : <>Dev mode — OTP: <Text style={styles.devOtpText}>{devOtp}</Text></>
                      }
                    </Text>
                  </View>
                ) : null}

                <View style={styles.otpRow}>
                  {otp.map((digit, idx) => (
                    <TextInput
                      key={idx}
                      ref={r => { otpRefs.current[idx] = r; }}
                      style={[styles.otpBox, digit && styles.otpBoxFilled]}
                      value={digit}
                      onChangeText={v => handleOtpChange(v, idx)}
                      onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, idx)}
                      keyboardType="number-pad"
                      maxLength={1}
                      selectTextOnFocus
                      autoFocus={idx === 0}
                    />
                  ))}
                </View>

                {errorMsg ? (
                  <View style={styles.errorBox}>
                    <AppIcon name="alert-circle" size={15} color="#F87171" />
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
                  onPress={handleVerify}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Verify & Link Number</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={styles.resendBtn} onPress={() => { setOtp(['','','','']); handleSendOtp(); }}>
                  <Text style={styles.resendText}>Resend OTP</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>

          {/* Info box */}
          <View style={styles.infoBox}>
            <AppIcon name="info" size={14} color={Colors.dark.tint} />
            <Text style={styles.infoText}>
              Once linked, you can sign in using either Google or your phone number with OTP.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.dark.background },
  scroll: { flexGrow: 1, padding: 24, gap: 20 },
  topBar: { alignItems: 'flex-end' },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  skipText: { color: Colors.dark.tabIconDefault, fontSize: 14 },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(37,99,235,0.12)',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginTop: 8,
  },
  title: {
    fontSize: 26, fontWeight: '800', color: Colors.dark.text,
    textAlign: 'center', letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15, color: Colors.dark.tabIconDefault,
    textAlign: 'center', lineHeight: 22,
  },
  form: { gap: 14 },
  phoneRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  phonePrefix: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.dark.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 16,
    borderWidth: 1.5, borderColor: Colors.dark.border,
  },
  phoneFlagText: { fontSize: 20, lineHeight: 24 },
  phoneCodeText: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  phoneInput: {
    flex: 1, backgroundColor: Colors.dark.card, borderRadius: 12,
    padding: 16, color: Colors.dark.text, fontSize: 18,
    borderWidth: 1.5, borderColor: Colors.dark.border, letterSpacing: 2,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  errorText: { color: '#F87171', fontSize: 13, flex: 1 },
  primaryBtn: {
    backgroundColor: Colors.dark.tint, borderRadius: 14,
    padding: 16, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  devBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(96,165,250,0.1)', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)',
  },
  devBannerText: { color: '#93C5FD', fontSize: 13, flex: 1 },
  devOtpText: { fontWeight: '800', color: '#60A5FA' },
  otpRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  otpBox: {
    width: 46, height: 56, borderRadius: 12, borderWidth: 1.5,
    borderColor: Colors.dark.border, backgroundColor: Colors.dark.card,
    textAlign: 'center', fontSize: 22, fontWeight: '700', color: Colors.dark.text,
  },
  otpBoxFilled: { borderColor: Colors.dark.tint },
  resendBtn: { alignItems: 'center', paddingVertical: 8 },
  resendText: { color: Colors.dark.tint, fontSize: 14, fontWeight: '600' },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(37,99,235,0.08)', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: 'rgba(37,99,235,0.2)',
  },
  infoText: { color: Colors.dark.tabIconDefault, fontSize: 13, flex: 1, lineHeight: 19 },
});

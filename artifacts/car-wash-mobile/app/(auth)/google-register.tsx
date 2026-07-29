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
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AppIcon from '@/components/AppIcon';
import GoogleIcon from '@/components/GoogleIcon';
import { apiFetch, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';

type Step = 'phone' | 'otp' | 'role';
type Role = 'customer' | 'cleaner';

export default function GoogleRegisterScreen() {
  const { googleName, googleEmail, webToken } = useLocalSearchParams<{
    googleName: string;
    googleEmail: string;
    webToken: string;
  }>();

  const { signIn } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '']);
  const [selectedRole, setSelectedRole] = useState<Role>('customer');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [smsFailed, setSmsFailed] = useState(false);
  const [shakeAnim] = useState(new Animated.Value(0));

  const otpRefs = useRef<Array<TextInput | null>>([]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleBack = () => {
    setErrorMsg('');
    if (step === 'otp') setStep('phone');
    else if (step === 'role') setStep('otp');
    else router.back();
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
      const res = await apiFetch('/api/auth/google/send-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), token: webToken }),
      });
      if (res?.devOtp) { setDevOtp(res.devOtp); setSmsFailed(false); }
      else if (res?.smsSent === false) { setDevOtp('1111'); setSmsFailed(true); }
      else { setDevOtp(''); setSmsFailed(false); }
      setStep('otp');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
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
      await apiFetch('/api/auth/google/verify-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), code, token: webToken }),
      });
      setStep('role');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setErrorMsg('');
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const user = await apiFetch('/api/auth/google/complete', {
        method: 'POST',
        body: JSON.stringify({ role: selectedRole, token: webToken }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      signIn(user);
      router.replace('/(tabs)');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Registration failed. Please try again.');
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

  const stepNum = step === 'phone' ? 1 : step === 'otp' ? 2 : 3;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Top bar ── */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <AppIcon name="arrow-left" size={20} color={Colors.dark.text} />
            </TouchableOpacity>
            <View style={styles.stepDots}>
              {[1, 2, 3].map(n => (
                <View key={n} style={[styles.stepDot, n <= stepNum && styles.stepDotActive]} />
              ))}
            </View>
            <View style={{ width: 36 }} />
          </View>

          {/* ── Google account badge ── */}
          <View style={styles.googleBadge}>
            <GoogleIcon size={15} />
            <Text style={styles.googleBadgeText} numberOfLines={1}>{googleEmail}</Text>
          </View>

          {/* ═══════════ STEP 1: PHONE ═══════════ */}
          {step === 'phone' && (
            <>
              <View style={styles.iconWrap}>
                <AppIcon name="smartphone" size={38} color={Colors.dark.tint} />
              </View>
              <Text style={styles.title}>Enter your phone number</Text>
              <Text style={styles.subtitle}>
                We'll send a verification code to confirm your number
              </Text>

              <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
                <View style={styles.phoneRow}>
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phoneFlagText}>🇮🇳</Text>
                    <Text style={styles.phoneCodeText}>+91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={v => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setErrorMsg(''); }}
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
                  {loading
                    ? <ActivityIndicator color="#FFF" />
                    : <><Text style={styles.primaryBtnText}>Send OTP</Text><AppIcon name="arrow-right" size={18} color="#fff" /></>
                  }
                </TouchableOpacity>
              </Animated.View>
            </>
          )}

          {/* ═══════════ STEP 2: OTP ═══════════ */}
          {step === 'otp' && (
            <>
              <View style={styles.iconWrap}>
                <AppIcon name="shield-check" size={38} color={Colors.dark.tint} />
              </View>
              <Text style={styles.title}>Verify your number</Text>
              <Text style={styles.subtitle}>
                Enter the 4-digit code sent to{'\n'}+91 {phone}
              </Text>

              <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
                {devOtp ? (
                  <View style={styles.devBanner}>
                    <AppIcon name={smsFailed ? 'alert-triangle' : 'terminal'} size={14} color="#60A5FA" />
                    <Text style={styles.devBannerText}>
                      {smsFailed
                        ? <>{`SMS not delivered. Use bypass: `}<Text style={styles.devOtpText}>1111</Text></>
                        : <>{`Dev OTP: `}<Text style={styles.devOtpText}>{devOtp}</Text></>
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
                  onPress={handleVerifyOtp}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading
                    ? <ActivityIndicator color="#FFF" />
                    : <><Text style={styles.primaryBtnText}>Verify Code</Text><AppIcon name="arrow-right" size={18} color="#fff" /></>
                  }
                </TouchableOpacity>

                <TouchableOpacity style={styles.resendBtn} onPress={() => { setOtp(['', '', '', '']); setErrorMsg(''); handleSendOtp(); }}>
                  <Text style={styles.resendText}>Resend OTP</Text>
                </TouchableOpacity>
              </Animated.View>
            </>
          )}

          {/* ═══════════ STEP 3: ROLE ═══════════ */}
          {step === 'role' && (
            <>
              <View style={styles.iconWrap}>
                <AppIcon name="users" size={38} color={Colors.dark.tint} />
              </View>
              <Text style={styles.title}>How will you use CarCleanPro?</Text>
              <Text style={styles.subtitle}>Choose your account type to complete registration</Text>

              <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
                {/* Role: Car Owner */}
                <TouchableOpacity
                  style={[styles.roleCard, selectedRole === 'customer' && styles.roleCardSelected]}
                  onPress={() => { Haptics.selectionAsync(); setSelectedRole('customer'); }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.roleIconWrap, selectedRole === 'customer' && styles.roleIconWrapSelected]}>
                    <AppIcon name="user" size={24} color={selectedRole === 'customer' ? Colors.dark.tint : Colors.dark.tabIconDefault} />
                  </View>
                  <View style={styles.roleInfo}>
                    <Text style={[styles.roleTitle, selectedRole === 'customer' && { color: Colors.dark.tint }]}>Car Owner</Text>
                    <Text style={styles.roleDesc}>Book professional car cleaning at my doorstep</Text>
                  </View>
                  <View style={[styles.roleCheck, selectedRole === 'customer' && styles.roleCheckSelected]}>
                    {selectedRole === 'customer' && <AppIcon name="check" size={13} color="#fff" />}
                  </View>
                </TouchableOpacity>

                {/* Role: Car Cleaner */}
                <TouchableOpacity
                  style={[styles.roleCard, selectedRole === 'cleaner' && styles.roleCardSelected]}
                  onPress={() => { Haptics.selectionAsync(); setSelectedRole('cleaner'); }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.roleIconWrap, selectedRole === 'cleaner' && styles.roleIconWrapSelected]}>
                    <AppIcon name="droplet" size={24} color={selectedRole === 'cleaner' ? Colors.dark.tint : Colors.dark.tabIconDefault} />
                  </View>
                  <View style={styles.roleInfo}>
                    <Text style={[styles.roleTitle, selectedRole === 'cleaner' && { color: Colors.dark.tint }]}>Car Cleaner</Text>
                    <Text style={styles.roleDesc}>Accept cleaning jobs and earn money near me</Text>
                  </View>
                  <View style={[styles.roleCheck, selectedRole === 'cleaner' && styles.roleCheckSelected]}>
                    {selectedRole === 'cleaner' && <AppIcon name="check" size={13} color="#fff" />}
                  </View>
                </TouchableOpacity>

                {/* Account summary */}
                <View style={styles.summaryBox}>
                  <View style={styles.summaryRow}>
                    <AppIcon name="user-check" size={13} color={Colors.dark.tint} />
                    <Text style={styles.summaryLabel}>Name</Text>
                    <Text style={styles.summaryValue} numberOfLines={1}>{googleName}</Text>
                  </View>
                  <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                    <AppIcon name="mail" size={13} color={Colors.dark.tint} />
                    <Text style={styles.summaryLabel}>Email</Text>
                    <Text style={styles.summaryValue} numberOfLines={1}>{googleEmail}</Text>
                  </View>
                  <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                    <AppIcon name="phone" size={13} color={Colors.dark.tint} />
                    <Text style={styles.summaryLabel}>Phone</Text>
                    <Text style={styles.summaryValue}>+91 {phone}</Text>
                  </View>
                </View>

                {errorMsg ? (
                  <View style={styles.errorBox}>
                    <AppIcon name="alert-circle" size={15} color="#F87171" />
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
                  onPress={handleComplete}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading
                    ? <ActivityIndicator color="#FFF" />
                    : <><Text style={styles.primaryBtnText}>Create My Account</Text><AppIcon name="check" size={18} color="#fff" /></>
                  }
                </TouchableOpacity>
              </Animated.View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.dark.background },
  scroll: { flexGrow: 1, padding: 24, gap: 20 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.dark.card,
    borderWidth: 1, borderColor: Colors.dark.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDots: { flexDirection: 'row', gap: 8 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.dark.border,
  },
  stepDotActive: { backgroundColor: Colors.dark.tint, width: 20, borderRadius: 4 },

  googleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(234,67,53,0.08)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(234,67,53,0.18)',
    alignSelf: 'flex-start',
  },
  googleBadgeText: { color: Colors.dark.tabIconDefault, fontSize: 13, flexShrink: 1 },

  iconWrap: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(37,99,235,0.12)',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginTop: 4,
  },
  title: {
    fontSize: 24, fontWeight: '800', color: Colors.dark.text,
    textAlign: 'center', letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14, color: Colors.dark.tabIconDefault,
    textAlign: 'center', lineHeight: 21,
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
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  errorText: { color: '#F87171', fontSize: 13, flex: 1, lineHeight: 18 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.dark.tint, borderRadius: 14,
    height: 54,
    shadowColor: Colors.dark.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  devBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(96,165,250,0.1)', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)',
  },
  devBannerText: { color: '#93C5FD', fontSize: 13, flex: 1 },
  devOtpText: { fontWeight: '800', color: '#60A5FA' },

  otpRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  otpBox: {
    width: 58, height: 64, borderRadius: 14, borderWidth: 1.5,
    borderColor: Colors.dark.border, backgroundColor: Colors.dark.card,
    textAlign: 'center', fontSize: 24, fontWeight: '700', color: Colors.dark.text,
  },
  otpBoxFilled: { borderColor: Colors.dark.tint },
  resendBtn: { alignItems: 'center', paddingVertical: 4 },
  resendText: { color: Colors.dark.tint, fontSize: 14, fontWeight: '600' },

  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.dark.card, borderRadius: 16,
    borderWidth: 1.5, borderColor: Colors.dark.border, padding: 16,
  },
  roleCardSelected: { borderColor: Colors.dark.tint, backgroundColor: 'rgba(37,99,235,0.08)' },
  roleIconWrap: {
    width: 48, height: 48, borderRadius: 13,
    backgroundColor: 'rgba(100,116,139,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  roleIconWrapSelected: { backgroundColor: 'rgba(37,99,235,0.15)' },
  roleInfo: { flex: 1, gap: 3 },
  roleTitle: { fontSize: 15, fontWeight: '700', color: Colors.dark.text },
  roleDesc: { fontSize: 12, color: Colors.dark.tabIconDefault, lineHeight: 16 },
  roleCheck: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.dark.border,
    alignItems: 'center', justifyContent: 'center',
  },
  roleCheckSelected: { backgroundColor: Colors.dark.tint, borderColor: Colors.dark.tint },

  summaryBox: {
    backgroundColor: Colors.dark.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.dark.border,
    paddingHorizontal: 14, paddingVertical: 4,
  },
  summaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12,
  },
  summaryRowBorder: {
    borderTopWidth: 1, borderTopColor: Colors.dark.border,
  },
  summaryLabel: { color: Colors.dark.tabIconDefault, fontSize: 13, width: 44 },
  summaryValue: { color: Colors.dark.text, fontSize: 13, fontWeight: '600', flex: 1 },
});

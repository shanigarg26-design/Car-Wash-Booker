import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import AppIcon from '@/components/AppIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, ApiError } from '@/api/client';
import Colors from '@/constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

type Step = 'phone' | 'otp' | 'role' | 'profile';
type UserRole = 'customer' | 'cleaner';

const STEP_META: Record<Step, { title: string; subtitle: string; icon: string }> = {
  phone: {
    title: 'Enter your number',
    subtitle: "We'll send a one-time code to verify it's you",
    icon: '📱',
  },
  otp: {
    title: 'Enter the code',
    subtitle: 'A 4-digit code was sent to your number',
    icon: '🔐',
  },
  role: {
    title: 'How will you use CarCleanPro?',
    subtitle: 'Choose your account type to get the right experience',
    icon: '🚗',
  },
  profile: {
    title: 'Create your profile',
    subtitle: "Just a few details and you're ready to go",
    icon: '👋',
  },
};

export default function LoginScreen() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '']);
  const [selectedRole, setSelectedRole] = useState<UserRole>('customer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [smsFailed, setSmsFailed] = useState(false);
  const [shakeAnim] = useState(new Animated.Value(0));
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(20));

  const otpRefs = useRef<Array<TextInput | null>>([]);
  const nameRef = useRef<TextInput | null>(null);
  const { signIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: false }),
      Animated.spring(slideAnim, { toValue: 0, tension: 100, friction: 12, useNativeDriver: false }),
    ]).start();
  }, [step]);

  const transitionTo = (nextStep: Step) => {
    fadeAnim.setValue(0);
    slideAnim.setValue(24);
    setStep(nextStep);
    setErrorMsg('');
  };

  const shake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 55, useNativeDriver: false, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 55, useNativeDriver: false, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 55, useNativeDriver: false, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 55, useNativeDriver: false, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: false, easing: Easing.linear }),
    ]).start();
  };

  /* ── Step 1: Send OTP ── */
  const handleSendOtp = async () => {
    setErrorMsg('');
    const trimmed = phone.trim();
    if (!trimmed || trimmed.length < 10) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      shake();
      return;
    }
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await apiFetch('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: trimmed }),
      });
      if (res?.devOtp) { setDevOtp(res.devOtp); setSmsFailed(false); }
      else if (res?.smsSent === false) { setDevOtp('1111'); setSmsFailed(true); }
      else { setSmsFailed(false); setDevOtp(''); }
      transitionTo('otp');
    } catch (e) {
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 2: Verify OTP ── */
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
      const res = await apiFetch('/api/auth/verify-otp/smart', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), code }),
      });
      if (res.isNew) {
        transitionTo('role');
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        signIn(res);
        router.replace('/(tabs)');
      }
    } catch (e) {
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 3: Role selected → move to profile ── */
  const handleRoleContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    transitionTo('profile');
    setTimeout(() => nameRef.current?.focus(), 300);
  };

  /* ── Step 4: Complete profile (new users) ── */
  const handleComplete = async () => {
    setErrorMsg('');
    if (!name.trim() || name.trim().length < 2) {
      setErrorMsg('Please enter your full name (at least 2 characters).');
      shake();
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      shake();
      return;
    }
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await apiFetch('/api/auth/phone-complete', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          role: selectedRole,
        }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      signIn(res);
      router.replace('/(tabs)');
    } catch (e) {
      shake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (e instanceof ApiError && e.code === 'email_taken') {
        setErrorMsg('This email is already registered with another account. Please use a different email address, or go back and sign in with the account that uses this email.');
      } else {
        setErrorMsg(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      }
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

  const goBack = () => {
    if (step === 'otp') { transitionTo('phone'); setOtp(['', '', '', '']); }
    else if (step === 'role') transitionTo('otp');
    else if (step === 'profile') transitionTo('role');
    else router.back();
  };

  const meta = STEP_META[step];
  const ALL_STEPS: Step[] = ['phone', 'otp', 'role', 'profile'];
  const stepIndex = ALL_STEPS.indexOf(step);

  const RoleCard = ({ cardRole, title, icon, desc }: { cardRole: UserRole; title: string; icon: string; desc: string }) => {
    const isSelected = selectedRole === cardRole;
    return (
      <TouchableOpacity
        style={[styles.roleCard, isSelected && styles.roleCardSelected]}
        onPress={() => { Haptics.selectionAsync(); setSelectedRole(cardRole); }}
        activeOpacity={0.8}
      >
        <View style={[styles.roleIconWrap, isSelected && styles.roleIconWrapSelected]}>
          <AppIcon name={icon} size={26} color={isSelected ? Colors.dark.tint : Colors.dark.tabIconDefault} />
        </View>
        <View style={styles.roleInfo}>
          <Text style={[styles.roleTitle, isSelected && { color: Colors.dark.tint }]}>{title}</Text>
          <Text style={styles.roleDesc}>{desc}</Text>
        </View>
        <View style={[styles.roleCheck, isSelected && styles.roleCheckSelected]}>
          {isSelected && <AppIcon name="check" size={14} color="#fff" />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <LinearGradient
        colors={['#0A1628', '#0D1F3C', '#091424']}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Nav ── */}
          <View style={styles.nav}>
            <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <AppIcon name="arrow-left" size={22} color={Colors.dark.text} />
            </TouchableOpacity>
            <View style={styles.dots}>
              {ALL_STEPS.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, stepIndex === i && styles.dotActive, stepIndex > i && styles.dotDone]}
                />
              ))}
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* ── Icon + Title ── */}
          <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <Text style={styles.stepIcon}>{meta.icon}</Text>
            <Text style={styles.title}>{meta.title}</Text>
            <Text style={styles.subtitle}>{meta.subtitle}</Text>
            {step === 'otp' && (
              <Text style={styles.phoneHint}>+91 {phone.trim()}</Text>
            )}
          </Animated.View>

          {/* ── Form ── */}
          <Animated.View style={[styles.formWrap, {
            opacity: fadeAnim,
            transform: [{ translateX: shakeAnim }, { translateY: slideAnim }],
          }]}>

            {/* ── Phone Step ── */}
            {step === 'phone' && (
              <>
                <View style={styles.phoneRow}>
                  <View style={styles.prefix}>
                    <Text style={styles.flagText}>🇮🇳</Text>
                    <Text style={styles.codeText}>+91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setErrorMsg(''); }}
                    keyboardType="number-pad"
                    placeholder="Mobile number"
                    placeholderTextColor={Colors.dark.tabIconDefault}
                    maxLength={10}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleSendOtp}
                  />
                </View>

                {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, phone.trim().length < 10 && styles.primaryBtnDisabled]}
                  onPress={handleSendOtp}
                  disabled={loading || phone.trim().length < 10}
                  activeOpacity={0.85}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <>
                        <Text style={styles.primaryBtnText}>Send OTP</Text>
                        <AppIcon name="arrow-right" size={18} color="#fff" />
                      </>
                    )
                  }
                </TouchableOpacity>
              </>
            )}

            {/* ── OTP Step ── */}
            {step === 'otp' && (
              <>
                {(devOtp || smsFailed) && (
                  <View style={styles.devBanner}>
                    <AppIcon name="info" size={14} color="#F59E0B" />
                    <Text style={styles.devText}>
                      {smsFailed ? `SMS unavailable — use code: ${devOtp || '1111'}` : `Dev mode code: ${devOtp}`}
                    </Text>
                  </View>
                )}

                <View style={styles.otpRow}>
                  {otp.map((digit, i) => (
                    <TextInput
                      key={i}
                      ref={(r) => { otpRefs.current[i] = r; }}
                      style={[styles.otpBox, digit && styles.otpBoxFilled]}
                      value={digit}
                      onChangeText={(v) => handleOtpChange(v, i)}
                      onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, i)}
                      keyboardType="number-pad"
                      maxLength={1}
                      selectTextOnFocus
                      autoFocus={i === 0}
                    />
                  ))}
                </View>

                {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, otp.join('').length < 4 && styles.primaryBtnDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={loading || otp.join('').length < 4}
                  activeOpacity={0.85}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <>
                        <Text style={styles.primaryBtnText}>Verify Code</Text>
                        <AppIcon name="check" size={18} color="#fff" />
                      </>
                    )
                  }
                </TouchableOpacity>

                <TouchableOpacity onPress={() => { transitionTo('phone'); setOtp(['', '', '', '']); }} style={styles.resendBtn}>
                  <Text style={styles.resendText}>Resend OTP</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ── Role Step (new users only) ── */}
            {step === 'role' && (
              <>
                <View style={styles.welcomeBadge}>
                  <Text style={styles.welcomeText}>🎉 Welcome to CarCleanPro!</Text>
                  <Text style={styles.welcomeSub}>Your number is verified. How will you use the app?</Text>
                </View>

                <RoleCard
                  cardRole="customer"
                  title="Car Owner"
                  icon="user"
                  desc="Book professional car washes at your doorstep"
                />
                <RoleCard
                  cardRole="cleaner"
                  title="Car Cleaner"
                  icon="droplet"
                  desc="Accept car cleaning jobs and earn money near you"
                />

                {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleRoleContinue}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>Continue</Text>
                  <AppIcon name="arrow-right" size={18} color="#fff" />
                </TouchableOpacity>
              </>
            )}

            {/* ── Profile Step (new users only) ── */}
            {step === 'profile' && (
              <>
                <View style={[styles.welcomeBadge, styles.profileBadge]}>
                  <Text style={styles.profileBadgeIcon}>
                    {selectedRole === 'cleaner' ? '💧' : '🚗'}
                  </Text>
                  <View>
                    <Text style={styles.profileBadgeTitle}>
                      {selectedRole === 'cleaner' ? 'Joining as a Car Cleaner' : 'Joining as a Car Owner'}
                    </Text>
                    <Text style={styles.profileBadgeSub}>One last step — tell us your name</Text>
                  </View>
                </View>

                {/* Full Name */}
                <View style={styles.fieldWrap}>
                  <View style={styles.fieldLabel}>
                    <AppIcon name="user" size={15} color={Colors.dark.tint} />
                    <Text style={styles.fieldLabelText}>Full Name <Text style={styles.required}>*</Text></Text>
                  </View>
                  <TextInput
                    ref={nameRef}
                    style={styles.fieldInput}
                    value={name}
                    onChangeText={(v) => { setName(v); setErrorMsg(''); }}
                    placeholder="e.g. Ravi Sharma"
                    placeholderTextColor={Colors.dark.tabIconDefault}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </View>

                {/* Email */}
                <View style={styles.fieldWrap}>
                  <View style={styles.fieldLabel}>
                    <AppIcon name="mail" size={15} color={Colors.dark.tint} />
                    <Text style={styles.fieldLabelText}>Email ID <Text style={styles.optional}>(optional)</Text></Text>
                  </View>
                  <TextInput
                    style={styles.fieldInput}
                    value={email}
                    onChangeText={(v) => { setEmail(v); setErrorMsg(''); }}
                    placeholder="e.g. ravi@email.com"
                    placeholderTextColor={Colors.dark.tabIconDefault}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleComplete}
                  />
                </View>

                {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, name.trim().length < 2 && styles.primaryBtnDisabled]}
                  onPress={handleComplete}
                  disabled={loading || name.trim().length < 2}
                  activeOpacity={0.85}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <>
                        <Text style={styles.primaryBtnText}>Get Started</Text>
                        <AppIcon name="arrow-right" size={18} color="#fff" />
                      </>
                    )
                  }
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    gap: 0,
  },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(30,41,59,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(100,116,139,0.4)',
  },
  dotActive: { backgroundColor: Colors.dark.tint, width: 22 },
  dotDone: { backgroundColor: Colors.dark.success },

  header: {
    alignItems: 'center',
    marginBottom: 28,
    gap: 8,
  },
  stepIcon: { fontSize: 52, marginBottom: 4 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.dark.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.tabIconDefault,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  phoneHint: {
    marginTop: 4,
    fontSize: 14,
    color: Colors.dark.tint,
    fontWeight: '600',
  },

  formWrap: { gap: 14 },

  phoneRow: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    overflow: 'hidden',
    height: 58,
  },
  prefix: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 6,
    borderRightWidth: 1,
    borderRightColor: Colors.dark.border,
  },
  flagText: { fontSize: 20 },
  codeText: { color: Colors.dark.text, fontSize: 16, fontWeight: '600' },
  phoneInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 20,
    letterSpacing: 2,
    paddingHorizontal: 14,
  },

  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  otpBox: {
    width: 62,
    height: 70,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
    backgroundColor: Colors.dark.card,
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  otpBoxFilled: {
    borderColor: Colors.dark.tint,
    backgroundColor: 'rgba(37,99,235,0.1)',
  },

  welcomeBadge: {
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.22)',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  welcomeText: { color: Colors.dark.success, fontSize: 15, fontWeight: '700' },
  welcomeSub: { color: '#64748B', fontSize: 12, textAlign: 'center' },

  profileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  profileBadgeIcon: { fontSize: 28 },
  profileBadgeTitle: { color: Colors.dark.success, fontSize: 14, fontWeight: '700' },
  profileBadgeSub: { color: '#64748B', fontSize: 12, marginTop: 2 },

  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
    padding: 16,
  },
  roleCardSelected: {
    borderColor: Colors.dark.tint,
    backgroundColor: 'rgba(37,99,235,0.08)',
  },
  roleIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(100,116,139,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconWrapSelected: {
    backgroundColor: 'rgba(37,99,235,0.15)',
  },
  roleInfo: { flex: 1, gap: 3 },
  roleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  roleDesc: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    lineHeight: 16,
  },
  roleCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCheckSelected: {
    backgroundColor: Colors.dark.tint,
    borderColor: Colors.dark.tint,
  },

  fieldWrap: { gap: 6 },
  fieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldLabelText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  required: { color: Colors.dark.error },
  optional: { color: Colors.dark.tabIconDefault, fontWeight: '400' },
  fieldInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.dark.text,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.dark.tint,
    borderRadius: 16,
    height: 56,
    marginTop: 4,
    shadowColor: Colors.dark.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  resendBtn: { alignItems: 'center', paddingVertical: 4 },
  resendText: { color: Colors.dark.tint, fontSize: 14, fontWeight: '600' },

  devBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    padding: 12,
  },
  devText: { color: '#F59E0B', fontSize: 13, flex: 1 },

  error: { color: Colors.dark.error, fontSize: 13, textAlign: 'center' },
});

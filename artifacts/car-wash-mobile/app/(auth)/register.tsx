import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, Link, useLocalSearchParams } from 'expo-router';
import HomeButton from '@/components/HomeButton';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, ApiError } from '@/api/client';
import { useGoogleAuth } from '@/hooks/useGoogleAuth';
import Colors from '@/constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '@/components/AppIcon';
import GoogleIcon from '@/components/GoogleIcon';
import * as Haptics from 'expo-haptics';

type Role = 'customer' | 'cleaner' | 'owner';
type Method = 'phone' | 'google';
// phone flow:  method → role → phone → otp → profile
// google flow: method → role → [googleauth] → google-phone → google-otp
type Step = 'method' | 'role' | 'phone' | 'otp' | 'profile' | 'google-phone' | 'google-otp';

export default function RegisterScreen() {
  const [step, setStep] = useState<Step>('method');
  const [signupMethod, setSignupMethod] = useState<Method>('phone');
  const [role, setRole] = useState<Role>('customer');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '']);
  const [name, setName] = useState('');

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [smsFailed, setSmsFailed] = useState(false);
  const [shakeAnim] = useState(new Animated.Value(0));

  type DuplicateInfo =
    | { type: 'phone_via_google'; email?: string }
    | { type: 'phone_already_registered' }
    | { type: 'email_via_phone' };
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);

  const otpRefs = useRef<Array<TextInput | null>>([]);
  const { signIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { method: methodParam, prefillPhone } = useLocalSearchParams<{ method?: string; prefillPhone?: string }>();

  // Skip method (and optionally role) selection based on URL param.
  // method=phone  → go straight to phone number input (role defaults to customer)
  // method=google → skip method selection, land on role selection
  useEffect(() => {
    if (prefillPhone) {
      setPhone(prefillPhone);
    }
    if (methodParam === 'phone') {
      setSignupMethod('phone');
      setRole('customer');
      setStep('phone');
    } else if (methodParam === 'google') {
      setSignupMethod('google');
      setStep('role');
    }
  }, [methodParam, prefillPhone]);

  const shake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true, easing: Easing.linear }),
    ]).start();
  };

  // Google auth — passes role so backend creates the account
  const { request, promptAsync } = useGoogleAuth(
    (user) => {
      setGoogleLoading(false);
      signIn(user);
      if (!user.phone) {
        setOtp(['', '', '', '']);
        setPhone('');
        setErrorMsg('');
        setStep('google-phone');
      } else {
        router.replace('/(tabs)');
      }
    },
    (err) => {
      setGoogleLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (err instanceof ApiError && err.code === 'email_registered_via_phone') {
        setDuplicateInfo({ type: 'email_via_phone' });
        setErrorMsg('');
      } else {
        setErrorMsg(err.message);
        shake();
      }
    },
    role
  );

  // ----- Phone sign-up handlers -----

  const handleSendOtp = async () => {
    setErrorMsg('');
    setDuplicateInfo(null);
    const trimmed = phone.trim();
    if (!trimmed) {
      setErrorMsg('Please enter your phone number.');
      shake(); return;
    }
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Pre-check: is this phone already registered?
      const check = await apiFetch('/api/auth/check-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: trimmed }),
      });
      if (check.registered) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        if (check.via === 'google') {
          setDuplicateInfo({ type: 'phone_via_google', email: check.email });
        } else {
          setDuplicateInfo({ type: 'phone_already_registered' });
        }
        return;
      }

      const res = await apiFetch('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: trimmed }),
      });
      if (res?.devOtp) { setDevOtp(res.devOtp); setSmsFailed(false); }
      else if (res?.smsSent === false) { setDevOtp('1111'); setSmsFailed(true); }
      else { setSmsFailed(false); }
      setStep('otp');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMsg('');
    const code = otp.join('');
    if (code.length < 4) {
      setErrorMsg('Please enter the full 4-digit code.');
      shake(); return;
    }
    setStep('profile');
  };

  const handleRegister = async () => {
    setErrorMsg('');
    if (!name.trim()) {
      setErrorMsg('Please enter your full name.');
      shake(); return;
    }
    if (!email.trim()) {
      setErrorMsg('Please enter your email address.');
      shake(); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      shake(); return;
    }
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await apiFetch('/api/auth/verify-otp/register', {
        method: 'POST',
        body: JSON.stringify({
          phone: phone.trim(),
          code: otp.join(''),
          name: name.trim(),
          email: email.trim(),
          role,
        }),
      });
      signIn(res);
      router.replace('/(tabs)');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      if (e instanceof ApiError && e.code === 'invalid_otp') {
        setErrorMsg('Your OTP expired. Please go back and request a new one.');
      } else if (e instanceof ApiError && e.code === 'phone_registered_via_google') {
        setDuplicateInfo({ type: 'phone_via_google', email: e.data.email as string | undefined });
        setStep('phone');
      } else if (e instanceof ApiError && e.code === 'already_registered') {
        setDuplicateInfo({ type: 'phone_already_registered' });
        setStep('phone');
      } else if (e instanceof ApiError && e.code === 'email_taken') {
        setErrorMsg('This email is already associated with another account. Please use a different email.');
      } else {
        setErrorMsg(e instanceof ApiError ? e.message : 'Registration failed. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ----- Google sign-up phone-link handlers -----

  const handleGoogleSendOtp = async () => {
    setErrorMsg('');
    const trimmed = phone.trim();
    if (!trimmed) {
      setErrorMsg('Please enter your phone number.');
      shake(); return;
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
      else { setSmsFailed(false); }
      setOtp(['', '', '', '']);
      setStep('google-otp');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setErrorMsg(e instanceof ApiError ? e.message : 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLinkPhone = async () => {
    setErrorMsg('');
    const code = otp.join('');
    if (code.length < 4) {
      setErrorMsg('Please enter the full 4-digit code.');
      shake(); return;
    }
    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const updated = await apiFetch('/api/auth/link-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), code }),
      });
      signIn(updated);
      router.replace('/(tabs)');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      if (e instanceof ApiError && e.code === 'invalid_otp') {
        setErrorMsg('Invalid or expired code. Please try again.');
      } else if (e instanceof ApiError && e.code === 'phone_taken') {
        setErrorMsg('This number is already linked to another account.');
      } else {
        setErrorMsg(e instanceof ApiError ? e.message : 'Verification failed. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ----- OTP input helpers -----

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
    setErrorMsg('');
    if (step === 'profile') setStep('otp');
    else if (step === 'otp') setStep('phone');
    else if (step === 'phone') {
      // If we jumped directly to phone (skipping role), go back to previous screen
      if (methodParam === 'phone') router.back();
      else setStep('role');
    }
    else if (step === 'role') {
      // If we skipped the method step (came via param), go back to previous screen
      if (methodParam) router.back();
      else setStep('method');
    }
    else if (step === 'google-otp') setStep('google-phone');
    else if (step === 'google-phone') setStep('role');
  };

  const renderRoleCard = (cardRole: Role, title: string, icon: string, desc: string) => {
    const isSelected = role === cardRole;
    return (
      <TouchableOpacity
        style={[styles.roleCard, isSelected && styles.roleCardSelected]}
        onPress={() => { Haptics.selectionAsync(); setRole(cardRole); }}
      >
        <AppIcon name={icon} size={28} color={isSelected ? Colors.dark.tint : Colors.dark.tabIconDefault} />
        <View style={styles.roleInfo}>
          <Text style={[styles.roleTitle, isSelected && { color: Colors.dark.tint }]}>{title}</Text>
          <Text style={styles.roleDesc}>{desc}</Text>
        </View>
        <AppIcon name={isSelected ? "check-circle" : "circle"} size={22} color={isSelected ? Colors.dark.tint : Colors.dark.border} />
      </TouchableOpacity>
    );
  };

  const stepTitles: Record<Step, string> = {
    method: 'Join CarCleanPro',
    role: 'Choose your role',
    phone: 'Your phone number',
    otp: 'Verify your number',
    profile: 'Complete your profile',
    'google-phone': 'Verify your phone',
    'google-otp': 'Enter the code',
  };
  const stepSubs: Record<Step, string> = {
    method: 'How would you like to sign up?',
    role: 'Select your account type',
    phone: 'We\'ll send you a one-time code',
    otp: `Code sent to +91 ${phone.trim()}`,
    profile: 'Just a few more details',
    'google-phone': 'Link a phone number to your account',
    'google-otp': `Code sent to +91 ${phone.trim()}`,
  };

  // Step dots per flow
  // When method=phone was passed we skip role, so dots start from phone
  const phoneFlowDots: Step[] = methodParam === 'phone'
    ? ['phone', 'otp', 'profile']
    : ['role', 'phone', 'otp', 'profile'];
  const googleFlowDots: Step[] = ['role', 'google-phone', 'google-otp'];
  const isGoogleFlow = signupMethod === 'google' && (step === 'google-phone' || step === 'google-otp');
  const activeDots = isGoogleFlow ? googleFlowDots : phoneFlowDots;
  const showDots = step !== 'method';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={[styles.container, { paddingTop: insets.top + 16 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.navRow}>
            <TouchableOpacity
              onPress={step === 'method' ? () => router.back() : goBack}
              style={styles.backBtn}
            >
              <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
            </TouchableOpacity>
            <HomeButton />
          </View>
          {showDots && (
            <View style={styles.stepDots}>
              {activeDots.map((s, i) => (
                <View key={s} style={[
                  styles.dot,
                  step === s && styles.dotActive,
                  activeDots.indexOf(step as any) > i && styles.dotDone,
                ]} />
              ))}
            </View>
          )}
          <Text style={styles.title}>{stepTitles[step]}</Text>
          <Text style={styles.subtitle}>{stepSubs[step]}</Text>
        </View>

        <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>

          {/* STEP 0: Method */}
          {step === 'method' && (
            <>
              <TouchableOpacity
                style={styles.methodBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setSignupMethod('phone');
                  setStep('role');
                }}
                activeOpacity={0.85}
              >
                <View style={styles.methodIconWrap}>
                  <AppIcon name="phone" size={24} color={Colors.dark.tint} />
                </View>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodTitle}>Sign up with Phone</Text>
                  <Text style={styles.methodDesc}>Get a one-time code via SMS</Text>
                </View>
                <AppIcon name="arrow-right" size={20} color={Colors.dark.tabIconDefault} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.methodBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setSignupMethod('google');
                  setStep('role');
                }}
                activeOpacity={0.85}
              >
                <View style={[styles.methodIconWrap, { backgroundColor: 'rgba(234,67,53,0.12)' }]}>
                  {googleLoading ? <ActivityIndicator size="small" color="#EA4335" /> : <GoogleIcon />}
                </View>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodTitle}>Sign up with Google</Text>
                  <Text style={styles.methodDesc}>Quick and secure via Google</Text>
                </View>
                <AppIcon name="arrow-right" size={20} color={Colors.dark.tabIconDefault} />
              </TouchableOpacity>

              {errorMsg ? (
                <View style={styles.errorBox}>
                  <AppIcon name="alert-circle" size={15} color="#F87171" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>already have an account?</Text>
                <View style={styles.divider} />
              </View>

              <Link href="/(auth)/login" asChild>
                <TouchableOpacity style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>Log in →</Text>
                </TouchableOpacity>
              </Link>
            </>
          )}

          {/* STEP 1: Role */}
          {step === 'role' && (
            <>
              {renderRoleCard('customer', 'Customer', 'truck', 'I want to book car cleans')}
              {renderRoleCard('cleaner', 'Cleaner', 'droplet', 'I want to clean cars')}
              {renderRoleCard('owner', 'Business Owner', 'briefcase', 'I run a car cleaning business')}

              {/* Email already registered via phone — shown after Google sign-up collision */}
              {duplicateInfo?.type === 'email_via_phone' && (
                <View style={styles.duplicateBox}>
                  <View style={styles.duplicateHeader}>
                    <AppIcon name="phone" size={16} color="#F59E0B" />
                    <Text style={styles.duplicateTitle}>Already registered via Phone</Text>
                  </View>
                  <Text style={styles.duplicateText}>
                    This Google email is already registered using a Phone Number. Please log in with your phone number instead.
                  </Text>
                  <TouchableOpacity
                    style={[styles.duplicateBtn, { backgroundColor: `${Colors.dark.tint}18` }]}
                    onPress={() => { setDuplicateInfo(null); router.replace('/(auth)/login'); }}
                    activeOpacity={0.85}
                  >
                    <AppIcon name="log-in" size={16} color={Colors.dark.tint} />
                    <Text style={[styles.duplicateBtnText, { color: Colors.dark.tint }]}>Go to Login → Use Phone</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  if (signupMethod === 'google') {
                    setErrorMsg('');
                    setGoogleLoading(true);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    promptAsync();
                  } else {
                    setStep('phone');
                  }
                }}
                activeOpacity={0.85}
                disabled={signupMethod === 'google' && googleLoading}
              >
                {signupMethod === 'google' && googleLoading
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={styles.primaryBtnText}>
                    {signupMethod === 'google' ? 'Continue with Google' : 'Continue'}
                  </Text>
                }
              </TouchableOpacity>
            </>
          )}

          {/* STEP 2 (phone flow): Phone */}
          {step === 'phone' && (
            <>
              <View style={styles.phoneRow}>
                <View style={styles.phonePrefix}>
                  <Text style={styles.phoneFlagText}>🇮🇳</Text>
                  <Text style={styles.phoneCodeText}>+91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={phone}
                  onChangeText={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setErrorMsg(''); setDuplicateInfo(null); }}
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

              {/* Phone already registered via Google */}
              {duplicateInfo?.type === 'phone_via_google' && (
                <View style={styles.duplicateBox}>
                  <View style={styles.duplicateHeader}>
                    <Text style={styles.duplicateIcon}>🔑</Text>
                    <Text style={styles.duplicateTitle}>Already registered via Google</Text>
                  </View>
                  <Text style={styles.duplicateText}>
                    This phone number is already linked to a Google account. Please log in using Google instead.
                  </Text>
                  {duplicateInfo.email ? (
                    <Text style={styles.duplicateHint}>Google account: {duplicateInfo.email}</Text>
                  ) : null}
                  <TouchableOpacity
                    style={styles.duplicateBtn}
                    onPress={() => { setDuplicateInfo(null); router.replace('/(auth)/login'); }}
                    activeOpacity={0.85}
                  >
                    <GoogleIcon />
                    <Text style={styles.duplicateBtnText}>Go to Login → Use Google</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Phone already registered via phone */}
              {duplicateInfo?.type === 'phone_already_registered' && (
                <View style={styles.duplicateBox}>
                  <View style={styles.duplicateHeader}>
                    <AppIcon name="phone" size={16} color="#F59E0B" />
                    <Text style={styles.duplicateTitle}>Phone number already registered</Text>
                  </View>
                  <Text style={styles.duplicateText}>
                    This phone number already has an account. Please log in using this number.
                  </Text>
                  <TouchableOpacity
                    style={[styles.duplicateBtn, { backgroundColor: `${Colors.dark.tint}18` }]}
                    onPress={() => { setDuplicateInfo(null); router.replace(`/(auth)/login?prefillPhone=${encodeURIComponent(phone.trim())}` as any); }}
                    activeOpacity={0.85}
                  >
                    <AppIcon name="log-in" size={16} color={Colors.dark.tint} />
                    <Text style={[styles.duplicateBtnText, { color: Colors.dark.tint }]}>Go to Login → Use Phone</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!duplicateInfo && (
                <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleSendOtp} disabled={loading} activeOpacity={0.85}>
                  {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Send OTP</Text>}
                </TouchableOpacity>
              )}
            </>
          )}

          {/* STEP 3 (phone flow): OTP */}
          {step === 'otp' && (
            <>
              {devOtp ? (
                <View style={styles.devBanner}>
                  <AppIcon name={smsFailed ? 'alert-triangle' : 'terminal'} size={14} color="#60A5FA" />
                  <Text style={styles.devBannerText}>
                    {smsFailed
                      ? <><Text>SMS not delivered. Use bypass code: </Text><Text style={styles.devOtp}>1111</Text></>
                      : <><Text>Dev mode — OTP: </Text><Text style={styles.devOtp}>{devOtp}</Text></>
                    }
                  </Text>
                </View>
              ) : null}

              <View style={styles.otpRow}>
                {otp.map((digit, idx) => (
                  <TextInput
                    key={idx}
                    ref={(r) => { otpRefs.current[idx] = r; }}
                    style={[styles.otpBox, digit && styles.otpBoxFilled]}
                    value={digit}
                    onChangeText={(v) => handleOtpChange(v, idx)}
                    onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, idx)}
                    keyboardType="numeric"
                    maxLength={6}
                    selectTextOnFocus
                    textAlign="center"
                  />
                ))}
              </View>

              {errorMsg ? (
                <View style={styles.errorBox}>
                  <AppIcon name="alert-circle" size={15} color="#F87171" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleVerifyOtp} disabled={loading} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Verify Number</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.resendBtn} onPress={() => { setOtp(['', '', '', '']); handleSendOtp(); }}>
                <Text style={styles.resendText}>Resend code</Text>
              </TouchableOpacity>
            </>
          )}

          {/* STEP 4 (phone flow): Profile */}
          {step === 'profile' && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput style={styles.input} value={name} onChangeText={(v) => { setName(v); setErrorMsg(''); }} placeholder="John Doe" placeholderTextColor={Colors.dark.tabIconDefault} autoFocus />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address *</Text>
                <TextInput style={styles.input} value={email} onChangeText={(v) => { setEmail(v); setErrorMsg(''); }} autoCapitalize="none" keyboardType="email-address" placeholder="you@gmail.com" placeholderTextColor={Colors.dark.tabIconDefault} autoCorrect={false} />
              </View>

              {errorMsg ? (
                <View style={styles.errorBox}>
                  <AppIcon name="alert-circle" size={15} color="#F87171" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleRegister} disabled={loading} activeOpacity={0.85}>
                {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Create Account</Text>}
              </TouchableOpacity>
            </>
          )}

          {/* STEP G-1 (google flow): Collect phone */}
          {step === 'google-phone' && (
            <>
              <View style={styles.googleNotice}>
                <GoogleIcon />
                <Text style={styles.googleNoticeText}>Google sign-in successful! Now verify your phone number.</Text>
              </View>

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

              <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleGoogleSendOtp} disabled={loading} activeOpacity={0.85}>
                {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Send OTP</Text>}
              </TouchableOpacity>
            </>
          )}

          {/* STEP G-2 (google flow): Verify phone OTP */}
          {step === 'google-otp' && (
            <>
              {devOtp ? (
                <View style={styles.devBanner}>
                  <AppIcon name={smsFailed ? 'alert-triangle' : 'terminal'} size={14} color="#60A5FA" />
                  <Text style={styles.devBannerText}>
                    {smsFailed
                      ? <><Text>SMS not delivered. Use bypass code: </Text><Text style={styles.devOtp}>1111</Text></>
                      : <><Text>Dev mode — OTP: </Text><Text style={styles.devOtp}>{devOtp}</Text></>
                    }
                  </Text>
                </View>
              ) : null}

              <View style={styles.otpRow}>
                {otp.map((digit, idx) => (
                  <TextInput
                    key={idx}
                    ref={(r) => { otpRefs.current[idx] = r; }}
                    style={[styles.otpBox, digit && styles.otpBoxFilled]}
                    value={digit}
                    onChangeText={(v) => handleOtpChange(v, idx)}
                    onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, idx)}
                    keyboardType="numeric"
                    maxLength={6}
                    selectTextOnFocus
                    textAlign="center"
                  />
                ))}
              </View>

              {errorMsg ? (
                <View style={styles.errorBox}>
                  <AppIcon name="alert-circle" size={15} color="#F87171" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleGoogleLinkPhone} disabled={loading} activeOpacity={0.85}>
                {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Verify & Complete</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.resendBtn} onPress={() => { setOtp(['', '', '', '']); handleGoogleSendOtp(); }}>
                <Text style={styles.resendText}>Resend code</Text>
              </TouchableOpacity>
            </>
          )}

        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    paddingHorizontal: 24,
  },
  header: {
    marginBottom: 32,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  backBtn: {},
  stepDots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.border,
  },
  dotActive: {
    backgroundColor: Colors.dark.tint,
    width: 20,
  },
  dotDone: {
    backgroundColor: 'rgba(37,99,235,0.4)',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.dark.tabIconDefault,
  },
  form: {
    gap: 16,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    padding: 18,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  roleCardSelected: {
    borderColor: Colors.dark.tint,
    backgroundColor: 'rgba(37,99,235,0.1)',
  },
  roleInfo: {
    flex: 1,
    marginLeft: 14,
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 2,
  },
  roleDesc: {
    fontSize: 13,
    color: Colors.dark.tabIconDefault,
  },
  primaryBtn: {
    backgroundColor: Colors.dark.tint,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    alignItems: 'center',
    padding: 12,
  },
  secondaryBtnText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 14,
  },
  methodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    gap: 14,
  },
  methodIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: 'rgba(37,99,235,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodInfo: {
    flex: 1,
  },
  methodTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 3,
  },
  methodDesc: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 16,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.dark.border,
  },
  dividerText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  phonePrefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
  },
  phoneFlagText: {
    fontSize: 20,
    lineHeight: 24,
  },
  phoneCodeText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 18,
    letterSpacing: 1,
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    padding: 12,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    flex: 1,
  },
  devBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(96,165,250,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.3)',
    padding: 12,
  },
  devBannerText: {
    color: '#93C5FD',
    fontSize: 13,
    flex: 1,
  },
  devOtp: {
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  otpBox: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: Colors.dark.card,
    borderWidth: 2,
    borderColor: Colors.dark.border,
    color: Colors.dark.text,
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  otpBoxFilled: {
    borderColor: Colors.dark.tint,
  },
  resendBtn: {
    alignItems: 'center',
    padding: 10,
  },
  resendText: {
    color: Colors.dark.tint,
    fontSize: 14,
    fontWeight: '600',
  },
  googleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(234,67,53,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(234,67,53,0.2)',
    padding: 14,
  },
  googleNoticeText: {
    color: Colors.dark.text,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  duplicateBox: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    padding: 16,
    gap: 10,
  },
  duplicateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  duplicateIcon: {
    fontSize: 16,
  },
  duplicateTitle: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '700',
  },
  duplicateText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
    lineHeight: 20,
  },
  duplicateHint: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
    fontStyle: 'italic',
  },
  duplicateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(234,67,53,0.1)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  duplicateBtnText: {
    color: '#EA4335',
    fontSize: 14,
    fontWeight: '700',
  },
});

import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  Platform,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AppIcon from '@/components/AppIcon';
import GoogleIcon from '@/components/GoogleIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useGoogleAuth, GooglePendingProfile } from '@/hooks/useGoogleAuth';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, ApiError } from '@/api/client';
import Colors from '@/constants/colors';

const { width } = Dimensions.get('window');

const FEATURES = [
  { icon: 'map-pin', label: 'GPS Booking', desc: 'Book at your exact location', color: '#3B82F6' },
  { icon: 'zap', label: 'Instant Dispatch', desc: '5 nearby cleaners notified', color: '#8B5CF6' },
  { icon: 'star', label: 'Rated Cleaners', desc: 'Only verified car cleaners', color: '#F59E0B' },
];

const STEPS = [
  { emoji: '📍', title: 'Drop a Pin', desc: 'Share your live GPS location', num: '1' },
  { emoji: '⚡', title: 'Cleaner Dispatched', desc: 'Nearest 5 cleaners are notified', num: '2' },
  { emoji: '🚿', title: 'Car Gets Cleaned', desc: 'Track progress in real time', num: '3' },
  { emoji: '⭐', title: 'Rate Your Clean', desc: 'Help keep quality high', num: '4' },
];

type RegStep = 'phone' | 'otp' | 'role';
type Role    = 'customer' | 'cleaner';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const isWeb = Platform.OS === 'web';
  const fadeAnim  = useRef(new Animated.Value(isWeb ? 1 : 0)).current;
  const slideAnim = useRef(new Animated.Value(isWeb ? 0 : 40)).current;
  const carAnim   = useRef(new Animated.Value(0)).current;

  // ── Landing page error ──────────────────────────────────────────────────────
  const [googleAuthError, setGoogleAuthError] = useState('');

  // ── Google new-user registration (inline, no navigation) ───────────────────
  const [googleProfile, setGoogleProfile] = useState<GooglePendingProfile | null>(null);
  const [regStep,       setRegStep]        = useState<RegStep>('phone');
  const [phone,         setPhone]          = useState('');
  const [otp,           setOtp]            = useState(['', '', '', '']);
  const [selectedRole,  setSelectedRole]   = useState<Role>('customer');
  const [regLoading,    setRegLoading]     = useState(false);
  const [regError,      setRegError]       = useState('');
  const [devOtp,        setDevOtp]         = useState('');
  const [smsFailed,     setSmsFailed]      = useState(false);
  const [shakeAnim]   = useState(new Animated.Value(0));

  const otpRefs = useRef<Array<TextInput | null>>([]);

  // ── Animations ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isWeb) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: false }),
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: false }),
      ]).start();
    }
    Animated.loop(
      Animated.sequence([
        Animated.timing(carAnim, { toValue: 8, duration: 1800, useNativeDriver: false }),
        Animated.timing(carAnim, { toValue: 0, duration: 1800, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  // ── Google Auth ─────────────────────────────────────────────────────────────
  const { promptAsync: googlePromptAsync } = useGoogleAuth(
    (user) => {
      signIn(user);
      if (!user.phone) router.replace('/(auth)/link-phone');
      else             router.replace('/(tabs)');
    },
    (err) => {
      if (err instanceof ApiError && err.code === 'email_registered_via_phone') {
        setGoogleAuthError('This Google email is already registered via phone number. Please use "Login with Phone" instead.');
      } else {
        setGoogleAuthError(err.message || 'Google sign-in failed. Please try again.');
      }
    },
    undefined,
    (profile) => {
      // New unregistered Google user — show inline registration flow
      setGoogleProfile(profile);
      setRegStep('phone');
      setPhone('');
      setOtp(['', '', '', '']);
      setSelectedRole('customer');
      setRegError('');
      setDevOtp('');
    },
  );

  const handlePhone = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/(auth)/login');
  };

  const handleGoogle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGoogleAuthError('');
    googlePromptAsync();
  };

  // ── Registration helpers ────────────────────────────────────────────────────
  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleSendOtp = async () => {
    setRegError('');
    if (!phone.trim()) { setRegError('Please enter your phone number.'); shake(); return; }
    try {
      setRegLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await apiFetch('/api/auth/google/send-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), token: googleProfile?.webToken }),
      });
      if (res?.devOtp)            { setDevOtp(res.devOtp); setSmsFailed(false); }
      else if (res?.smsSent === false) { setDevOtp('1111'); setSmsFailed(true); }
      else                         { setDevOtp(''); setSmsFailed(false); }
      setRegStep('otp');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setRegError(e instanceof ApiError ? e.message : 'Failed to send OTP. Please try again.');
    } finally {
      setRegLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setRegError('');
    const code = otp.join('');
    if (code.length < 4) { setRegError('Please enter the full 4-digit code.'); shake(); return; }
    try {
      setRegLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await apiFetch('/api/auth/google/verify-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), code, token: googleProfile?.webToken }),
      });
      setRegStep('role');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setRegError(e instanceof ApiError ? e.message : 'Verification failed. Try again.');
    } finally {
      setRegLoading(false);
    }
  };

  const handleComplete = async () => {
    setRegError('');
    try {
      setRegLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const user = await apiFetch('/api/auth/google/complete', {
        method: 'POST',
        body: JSON.stringify({ role: selectedRole, token: googleProfile?.webToken }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setGoogleProfile(null);
      signIn(user);
      router.replace('/(tabs)');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setRegError(e instanceof ApiError ? e.message : 'Registration failed. Please try again.');
    } finally {
      setRegLoading(false);
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
    if (key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  };

  const regStepNum = regStep === 'phone' ? 1 : regStep === 'otp' ? 2 : 3;

  // ── Google Registration overlay (full-screen, replaces welcome) ─────────────
  if (googleProfile) {
    return (
      <SafeAreaView style={regStyles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={regStyles.scroll} keyboardShouldPersistTaps="handled">

            {/* Top bar */}
            <View style={regStyles.topBar}>
              <TouchableOpacity
                onPress={() => {
                  setRegError('');
                  if (regStep === 'otp')  setRegStep('phone');
                  else if (regStep === 'role') setRegStep('otp');
                  else setGoogleProfile(null);
                }}
                style={regStyles.backBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <AppIcon name="arrow-left" size={20} color={Colors.dark.text} />
              </TouchableOpacity>
              <View style={regStyles.stepDots}>
                {[1, 2, 3].map(n => (
                  <View key={n} style={[regStyles.stepDot, n <= regStepNum && regStyles.stepDotActive]} />
                ))}
              </View>
              <View style={{ width: 36 }} />
            </View>

            {/* Google badge */}
            <View style={regStyles.googleBadge}>
              <GoogleIcon size={15} />
              <Text style={regStyles.googleBadgeText} numberOfLines={1}>{googleProfile.email}</Text>
            </View>

            {/* ── STEP 1: PHONE ── */}
            {regStep === 'phone' && (
              <>
                <View style={regStyles.iconWrap}>
                  <AppIcon name="smartphone" size={38} color={Colors.dark.tint} />
                </View>
                <Text style={regStyles.title}>Enter your phone number</Text>
                <Text style={regStyles.subtitle}>
                  We'll send a verification code to confirm your number
                </Text>
                <Animated.View style={[regStyles.form, { transform: [{ translateX: shakeAnim }] }]}>
                  <View style={regStyles.phoneRow}>
                    <View style={regStyles.phonePrefix}>
                      <Text style={regStyles.phoneFlagText}>🇮🇳</Text>
                      <Text style={regStyles.phoneCodeText}>+91</Text>
                    </View>
                    <TextInput
                      style={regStyles.phoneInput}
                      value={phone}
                      onChangeText={v => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setRegError(''); }}
                      keyboardType="number-pad"
                      placeholder="98765 43210"
                      placeholderTextColor={Colors.dark.tabIconDefault}
                      maxLength={10}
                      autoFocus
                    />
                  </View>
                  {regError ? <ErrorBox msg={regError} /> : null}
                  <PrimaryBtn label="Send OTP" loading={regLoading} onPress={handleSendOtp} />
                </Animated.View>
              </>
            )}

            {/* ── STEP 2: OTP ── */}
            {regStep === 'otp' && (
              <>
                <View style={regStyles.iconWrap}>
                  <AppIcon name="shield-check" size={38} color={Colors.dark.tint} />
                </View>
                <Text style={regStyles.title}>Verify your number</Text>
                <Text style={regStyles.subtitle}>Enter the 4-digit code sent to{'\n'}+91 {phone}</Text>
                <Animated.View style={[regStyles.form, { transform: [{ translateX: shakeAnim }] }]}>
                  {devOtp ? (
                    <View style={regStyles.devBanner}>
                      <AppIcon name={smsFailed ? 'alert-triangle' : 'terminal'} size={14} color="#60A5FA" />
                      <Text style={regStyles.devBannerText}>
                        {smsFailed
                          ? <>{`SMS not delivered. Use bypass: `}<Text style={regStyles.devOtpText}>1111</Text></>
                          : <>{`Dev OTP: `}<Text style={regStyles.devOtpText}>{devOtp}</Text></>
                        }
                      </Text>
                    </View>
                  ) : null}
                  <View style={regStyles.otpRow}>
                    {otp.map((digit, idx) => (
                      <TextInput
                        key={idx}
                        ref={r => { otpRefs.current[idx] = r; }}
                        style={[regStyles.otpBox, digit && regStyles.otpBoxFilled]}
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
                  {regError ? <ErrorBox msg={regError} /> : null}
                  <PrimaryBtn label="Verify Code" loading={regLoading} onPress={handleVerifyOtp} />
                  <TouchableOpacity style={regStyles.resendBtn} onPress={() => { setOtp(['', '', '', '']); setRegError(''); handleSendOtp(); }}>
                    <Text style={regStyles.resendText}>Resend OTP</Text>
                  </TouchableOpacity>
                </Animated.View>
              </>
            )}

            {/* ── STEP 3: ROLE ── */}
            {regStep === 'role' && (
              <>
                <View style={regStyles.iconWrap}>
                  <AppIcon name="users" size={38} color={Colors.dark.tint} />
                </View>
                <Text style={regStyles.title}>How will you use CarCleanPro?</Text>
                <Text style={regStyles.subtitle}>Choose your account type to complete registration</Text>
                <Animated.View style={[regStyles.form, { transform: [{ translateX: shakeAnim }] }]}>
                  <RoleCard
                    label="Car Owner"
                    icon="user"
                    desc="Book professional car cleaning at my doorstep"
                    selected={selectedRole === 'customer'}
                    onPress={() => { Haptics.selectionAsync(); setSelectedRole('customer'); }}
                  />
                  <RoleCard
                    label="Car Cleaner"
                    icon="droplet"
                    desc="Accept cleaning jobs and earn money near me"
                    selected={selectedRole === 'cleaner'}
                    onPress={() => { Haptics.selectionAsync(); setSelectedRole('cleaner'); }}
                  />
                  {/* Account summary */}
                  <View style={regStyles.summaryBox}>
                    <SummaryRow icon="user-check" label="Name"  value={googleProfile.name}  />
                    <SummaryRow icon="mail"       label="Email" value={googleProfile.email} border />
                    <SummaryRow icon="phone"      label="Phone" value={`+91 ${phone}`}       border />
                  </View>
                  {regError ? <ErrorBox msg={regError} /> : null}
                  <PrimaryBtn label="Create My Account" loading={regLoading} onPress={handleComplete} iconName="check" />
                </Animated.View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Normal landing page ─────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
      <LinearGradient
        colors={['#0A1628', '#0D1F3C', '#091424']}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 160 }]}
      >
        {/* ─── Hero Visual ─── */}
        <Animated.View style={[styles.hero, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={[styles.glow, { width: 260, height: 260, backgroundColor: 'rgba(37,99,235,0.12)', borderRadius: 130, top: -20 }]} />
          <View style={[styles.glow, { width: 180, height: 180, backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 90, top: 30, left: 30 }]} />

          <Animated.View style={[styles.carVisual, { transform: [{ translateY: carAnim }] }]}>
            <View style={styles.dropletRow}>
              {['💧','💦','💧'].map((d, i) => (
                <Text key={i} style={[styles.droplet, { opacity: 0.6 + i * 0.2 }]}>{d}</Text>
              ))}
            </View>
            <Text style={styles.carEmoji}>🚗</Text>
            <View style={styles.sparkleRow}>
              {['✨','⭐','✨'].map((s, i) => (
                <Text key={i} style={[styles.sparkle, { opacity: 0.5 + i * 0.25 }]}>{s}</Text>
              ))}
            </View>
          </Animated.View>

          <View style={styles.brand}>
            <Text style={styles.logo}>CarCleanPro</Text>
            <Text style={styles.tagline}>Professional car cleaning,{'\n'}right at your doorstep</Text>
          </View>
        </Animated.View>

        {/* ─── Feature Pills ─── */}
        <Animated.View style={[styles.featuresWrap, { opacity: fadeAnim }]}>
          {FEATURES.map((f) => (
            <View key={f.label} style={[styles.featureCard, { borderColor: f.color + '30' }]}>
              <View style={[styles.featureIconWrap, { backgroundColor: f.color + '18' }]}>
                <AppIcon name={f.icon} size={18} color={f.color} />
              </View>
              <Text style={styles.featureLabel}>{f.label}</Text>
              <Text style={styles.featureDesc}>{f.desc}</Text>
            </View>
          ))}
        </Animated.View>

        {/* ─── How It Works ─── */}
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <Text style={styles.sectionTitle}>How it works</Text>
          <View style={styles.steps}>
            {STEPS.map((s, i) => (
              <View key={s.num} style={styles.stepRow}>
                <View style={styles.stepLeft}>
                  <View style={styles.stepNumWrap}>
                    <Text style={styles.stepNum}>{s.num}</Text>
                  </View>
                  {i < STEPS.length - 1 && <View style={styles.stepLine} />}
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepEmoji}>{s.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepTitle}>{s.title}</Text>
                    <Text style={styles.stepDesc}>{s.desc}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ─── Pricing teaser ─── */}
        <Animated.View style={[styles.pricingTeaser, { opacity: fadeAnim }]}>
          <LinearGradient
            colors={['rgba(37,99,235,0.15)', 'rgba(139,92,246,0.10)']}
            style={styles.pricingGrad}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          >
            <AppIcon name="tag" size={18} color="#3B82F6" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.pricingTitle}>Starting from ₹199</Text>
              <Text style={styles.pricingDesc}>Hatchback • Sedan • SUV — all vehicle types covered</Text>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* ─── Social Proof Stats ─── */}
        <Animated.View style={[styles.statsRow, { opacity: fadeAnim }]}>
          {([
            { n: '10K+', label: 'Cars Cleaned', icon: '🚗' },
            { n: '4.9 ★', label: 'Avg Rating', icon: '⭐' },
            { n: '500+', label: 'Pro Cleaners', icon: '🧽' },
          ] as const).map(s => (
            <View key={s.n} style={styles.statCard}>
              <Text style={styles.statEmoji}>{s.icon}</Text>
              <Text style={styles.statNum}>{s.n}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </Animated.View>

        {/* ─── Before & After ─── */}
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <Text style={styles.sectionTitle}>✨ Before &amp; After</Text>
          <Text style={styles.sectionSubtitle}>See the CarCleanPro difference</Text>
          <View style={styles.beforeAfterRow}>
            <View style={styles.baCard}>
              <LinearGradient colors={['#2D1B00', '#4A2E00', '#3B2200']} style={styles.baGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                <Text style={styles.baBadge}>BEFORE</Text>
                <Text style={styles.baCarEmoji}>🚙</Text>
                <Text style={styles.baTagline}>Dusty &amp; dull</Text>
              </LinearGradient>
            </View>
            <View style={styles.baArrow}>
              <AppIcon name="arrow-right" size={20} color="#2563EB" />
            </View>
            <View style={styles.baCard}>
              <LinearGradient colors={['#0C2A6E', '#1749C9', '#2563EB']} style={styles.baGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                <Text style={styles.baBadge}>AFTER</Text>
                <Text style={styles.baCarEmoji}>🚗</Text>
                <Text style={styles.baSparkleRow}>✨ 💫 ✨</Text>
                <Text style={styles.baTagline}>Spotless shine!</Text>
              </LinearGradient>
            </View>
          </View>
        </Animated.View>

        {/* ─── Services Showcase ─── */}
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <Text style={styles.sectionTitle}>🚘 Services we offer</Text>
          <Text style={styles.sectionSubtitle}>Professional cleaning for every vehicle</Text>
          {([
            { icon: '🚗', name: 'Hatchback Clean',    price: '₹199', badge: 'Most Popular', badgeColor: '#10B981', desc: 'Swift, i20, Polo & more' },
            { icon: '🚙', name: 'Sedan Clean',         price: '₹249', badge: null,           badgeColor: '',        desc: 'City, Verna, Ciaz & more' },
            { icon: '🛻', name: 'SUV Clean',           price: '₹349', badge: 'Best Value',   badgeColor: '#8B5CF6', desc: 'Creta, Seltos, Fortuner & more' },
            { icon: '🏎️', name: 'Premium Deep Clean', price: '₹599', badge: 'Premium',      badgeColor: '#F59E0B', desc: 'Interior + exterior detail wash' },
          ] as const).map(svc => (
            <View key={svc.name} style={styles.svcCard}>
              <LinearGradient colors={['rgba(30,41,59,0.95)', 'rgba(15,23,42,0.98)']} style={styles.svcGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.svcIcon}>{svc.icon}</Text>
                <View style={styles.svcInfo}>
                  <View style={styles.svcTitleRow}>
                    <Text style={styles.svcName}>{svc.name}</Text>
                    {svc.badge ? (
                      <View style={[styles.svcBadgeWrap, { backgroundColor: svc.badgeColor + '25', borderColor: svc.badgeColor + '60' }]}>
                        <Text style={[styles.svcBadgeText, { color: svc.badgeColor }]}>{svc.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.svcDesc}>{svc.desc}</Text>
                </View>
                <View style={styles.svcPriceWrap}>
                  <Text style={styles.svcPrice}>{svc.price}</Text>
                  <Text style={styles.svcPriceLabel}>onwards</Text>
                </View>
              </LinearGradient>
            </View>
          ))}
        </Animated.View>

        {/* ─── Testimonials ─── */}
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <Text style={styles.sectionTitle}>💬 What owners say</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled style={styles.hScroll} contentContainerStyle={{ gap: 14, paddingRight: 20 }}>
            {([
              { name: 'Rahul M.',  city: 'Bangalore', stars: 5, text: 'My car looks brand new! Cleaner arrived in 20 min. Absolutely love this service.' },
              { name: 'Priya K.',  city: 'Mumbai',    stars: 5, text: 'So convenient — booked during morning coffee, my SUV was spotless before lunch!' },
              { name: 'Amit S.',   city: 'Delhi',     stars: 5, text: 'Super easy app. Great pricing and the cleaner was very professional.' },
              { name: 'Sneha R.',  city: 'Hyderabad', stars: 5, text: "Couldn't believe how shiny my car looked. The detailing was amazing!" },
            ] as const).map(t => (
              <View key={t.name} style={styles.testimonialCard}>
                <View style={styles.testimonialHeader}>
                  <View style={styles.testimonialAvatar}>
                    <Text style={styles.testimonialInitial}>{t.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.testimonialName}>{t.name}</Text>
                    <Text style={styles.testimonialCity}>{t.city}</Text>
                  </View>
                  <Text style={styles.stars}>{'⭐'.repeat(t.stars)}</Text>
                </View>
                <Text style={styles.testimonialText}>{t.text}</Text>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

        {/* ─── Meet Our Cleaners ─── */}
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <Text style={styles.sectionTitle}>🧑‍🔧 Meet your cleaner</Text>
          <Text style={styles.sectionSubtitle}>Verified, trained &amp; rated professionals</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ gap: 14, paddingRight: 20 }}>
            {([
              { emoji: '👨‍🔧', name: 'Ravi K.',   rating: '4.9', jobs: '312', badge: 'Top Rated',   bc: '#F59E0B' },
              { emoji: '👩‍🔧', name: 'Meena P.',  rating: '4.8', jobs: '198', badge: 'Verified',    bc: '#10B981' },
              { emoji: '👨‍🔧', name: 'Sanjay B.', rating: '5.0', jobs: '89',  badge: 'Rising Star', bc: '#8B5CF6' },
              { emoji: '👩‍🔧', name: 'Divya R.',  rating: '4.9', jobs: '245', badge: 'Expert',      bc: '#3B82F6' },
            ] as const).map(c => (
              <View key={c.name} style={styles.cleanerCard}>
                <LinearGradient colors={['rgba(37,99,235,0.14)', 'rgba(15,23,42,0.98)']} style={styles.cleanerGrad} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}>
                  <View style={styles.cleanerAvatar}>
                    <Text style={styles.cleanerEmoji}>{c.emoji}</Text>
                  </View>
                  <View style={[styles.cleanerBadgeWrap, { backgroundColor: c.bc + '20', borderColor: c.bc + '55' }]}>
                    <Text style={[styles.cleanerBadgeText, { color: c.bc }]}>{c.badge}</Text>
                  </View>
                  <Text style={styles.cleanerName}>{c.name}</Text>
                  <View style={styles.cleanerStats}>
                    <Text style={styles.cleanerRating}>⭐ {c.rating}</Text>
                    <Text style={styles.cleanerJobs}>{c.jobs} cleans</Text>
                  </View>
                </LinearGradient>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

        {/* ─── Our Promise ─── */}
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <Text style={styles.sectionTitle}>🛡️ Our promise to you</Text>
          {([
            { icon: '✅', title: '100% Satisfaction',   desc: "Not happy? We re-clean for free — no questions asked." },
            { icon: '🔒', title: 'Insured Cleaners',    desc: 'Every cleaner is background-checked and fully insured.' },
            { icon: '⚡', title: 'On-Time Guarantee',   desc: 'Cleaner arrives within 30 min or you get a discount.' },
            { icon: '💧', title: 'Eco-Friendly',        desc: 'Water-saving techniques good for your car & the planet.' },
          ] as const).map(p => (
            <View key={p.title} style={styles.promiseCard}>
              <Text style={styles.promiseIcon}>{p.icon}</Text>
              <View style={styles.promiseInfo}>
                <Text style={styles.promiseTitle}>{p.title}</Text>
                <Text style={styles.promiseDesc}>{p.desc}</Text>
              </View>
            </View>
          ))}
        </Animated.View>

        {/* ─── Final Join Banner ─── */}
        <Animated.View style={[styles.joinBanner, { opacity: fadeAnim }]}>
          <LinearGradient colors={['#1E3A8A', '#1D4ED8', '#2563EB']} style={styles.joinGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Text style={styles.joinTitle}>Join 10,000+ car owners</Text>
            <Text style={styles.joinDesc}>Experience the cleanest car of your life —{'\n'}book in under 60 seconds.</Text>
            <View style={styles.joinIcons}>
              {['🚗', '✨', '🧽', '💦', '⭐'].map((e, i) => <Text key={i} style={styles.joinIconText}>{e}</Text>)}
            </View>
          </LinearGradient>
        </Animated.View>
      </ScrollView>

      {/* ─── Sticky CTA Footer ─── */}
      <LinearGradient
        colors={['transparent', '#0A1628', '#0A1628']}
        style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        <Animated.View style={{ opacity: fadeAnim, width: '100%', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity style={styles.phoneCta} onPress={handlePhone} activeOpacity={0.88}>
            <LinearGradient
              colors={['#2563EB', '#1D4ED8']}
              style={styles.phoneCtaGrad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              <AppIcon name="phone" size={20} color="#fff" />
              <Text style={styles.phoneCtaText}>Login OR Register with Phone</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.googleCta} onPress={handleGoogle} activeOpacity={0.88}>
            <GoogleIcon size={20} />
            <Text style={styles.googleCtaText}>Continue with Google</Text>
          </TouchableOpacity>

          {googleAuthError ? (
            <View style={styles.authErrorBox}>
              <AppIcon name="alert-circle" size={14} color="#F87171" />
              <Text style={styles.authErrorText}>{googleAuthError}</Text>
            </View>
          ) : null}

          <Text style={styles.fine}>
            By continuing you agree to our Terms & Privacy Policy
          </Text>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

// ── Small helper components ────────────────────────────────────────────────────

function ErrorBox({ msg }: { msg: string }) {
  return (
    <View style={regStyles.errorBox}>
      <AppIcon name="alert-circle" size={15} color="#F87171" />
      <Text style={regStyles.errorText}>{msg}</Text>
    </View>
  );
}

function PrimaryBtn({ label, loading, onPress, iconName }: { label: string; loading: boolean; onPress: () => void; iconName?: string }) {
  return (
    <TouchableOpacity style={[regStyles.primaryBtn, loading && { opacity: 0.7 }]} onPress={onPress} disabled={loading} activeOpacity={0.85}>
      {loading
        ? <ActivityIndicator color="#fff" />
        : <><Text style={regStyles.primaryBtnText}>{label}</Text>{iconName && <AppIcon name={iconName} size={18} color="#fff" />}</>
      }
    </TouchableOpacity>
  );
}

function RoleCard({ label, icon, desc, selected, onPress }: { label: string; icon: string; desc: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[regStyles.roleCard, selected && regStyles.roleCardSelected]} onPress={onPress} activeOpacity={0.8}>
      <View style={[regStyles.roleIconWrap, selected && regStyles.roleIconWrapSelected]}>
        <AppIcon name={icon} size={24} color={selected ? Colors.dark.tint : Colors.dark.tabIconDefault} />
      </View>
      <View style={regStyles.roleInfo}>
        <Text style={[regStyles.roleTitle, selected && { color: Colors.dark.tint }]}>{label}</Text>
        <Text style={regStyles.roleDesc}>{desc}</Text>
      </View>
      <View style={[regStyles.roleCheck, selected && regStyles.roleCheckSelected]}>
        {selected && <AppIcon name="check" size={13} color="#fff" />}
      </View>
    </TouchableOpacity>
  );
}

function SummaryRow({ icon, label, value, border }: { icon: string; label: string; value: string; border?: boolean }) {
  return (
    <View style={[regStyles.summaryRow, border && regStyles.summaryRowBorder]}>
      <AppIcon name={icon} size={13} color={Colors.dark.tint} />
      <Text style={regStyles.summaryLabel}>{label}</Text>
      <Text style={regStyles.summaryValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ── Registration styles ────────────────────────────────────────────────────────
const regStyles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: Colors.dark.background },
  scroll: { flexGrow: 1, padding: 24, gap: 20 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.dark.card,
    borderWidth: 1, borderColor: Colors.dark.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDots: { flexDirection: 'row', gap: 8 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.dark.border },
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
  title: { fontSize: 24, fontWeight: '800', color: Colors.dark.text, textAlign: 'center', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: Colors.dark.tabIconDefault, textAlign: 'center', lineHeight: 21 },
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
    backgroundColor: Colors.dark.tint, borderRadius: 14, height: 54,
    shadowColor: Colors.dark.tint, shadowOffset: { width: 0, height: 4 },
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
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  summaryRowBorder: { borderTopWidth: 1, borderTopColor: Colors.dark.border },
  summaryLabel: { color: Colors.dark.tabIconDefault, fontSize: 13, width: 44 },
  summaryValue: { color: Colors.dark.text, fontSize: 13, fontWeight: '600', flex: 1 },
});

// ── Landing page styles ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, gap: 28 },

  hero: { alignItems: 'center', paddingTop: 12, gap: 20, position: 'relative' },
  glow: { position: 'absolute', alignSelf: 'center' },
  carVisual: { alignItems: 'center', gap: 2, paddingVertical: 16 },
  dropletRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  droplet: { fontSize: 26 },
  carEmoji: { fontSize: 72 },
  sparkleRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  sparkle: { fontSize: 20 },
  brand: { alignItems: 'center', gap: 8 },
  logo: { fontSize: 40, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 },
  tagline: { fontSize: 16, color: '#94A3B8', textAlign: 'center', lineHeight: 24 },

  featuresWrap: { flexDirection: 'row', gap: 10 },
  featureCard: {
    flex: 1, backgroundColor: 'rgba(30,41,59,0.7)', borderRadius: 16,
    borderWidth: 1, padding: 12, gap: 8, alignItems: 'flex-start',
  },
  featureIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featureLabel: { color: '#F1F5F9', fontSize: 12, fontWeight: '700' },
  featureDesc: { color: '#64748B', fontSize: 11, lineHeight: 16 },

  section: { gap: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#F1F5F9' },
  steps: { gap: 0 },
  stepRow: { flexDirection: 'row', gap: 16, minHeight: 72 },
  stepLeft: { alignItems: 'center', width: 32 },
  stepNumWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(37,99,235,0.2)', borderWidth: 1.5, borderColor: '#2563EB',
    alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { color: '#3B82F6', fontSize: 13, fontWeight: '700' },
  stepLine: { flex: 1, width: 1.5, backgroundColor: 'rgba(37,99,235,0.2)', marginVertical: 4 },
  stepContent: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingBottom: 24 },
  stepEmoji: { fontSize: 26, marginTop: 2 },
  stepTitle: { color: '#F1F5F9', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  stepDesc: { color: '#64748B', fontSize: 13, lineHeight: 19 },

  pricingTeaser: { borderRadius: 16, overflow: 'hidden' },
  pricingGrad: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(37,99,235,0.25)',
  },
  pricingTitle: { color: '#F1F5F9', fontSize: 15, fontWeight: '700' },
  pricingDesc: { color: '#64748B', fontSize: 12, marginTop: 2, lineHeight: 17 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 32, paddingHorizontal: 20, alignItems: 'center', gap: 12,
  },
  phoneCta: {
    width: '100%', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#2563EB', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  phoneCtaGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingVertical: 17, paddingHorizontal: 24,
  },
  phoneCtaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  googleCta: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingVertical: 15, paddingHorizontal: 24,
    borderRadius: 16, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(30,41,59,0.6)',
  },
  googleCtaText: { color: '#F1F5F9', fontSize: 16, fontWeight: '600' },
  fine: { color: '#475569', fontSize: 11, textAlign: 'center', lineHeight: 16 },

  authErrorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(248,113,113,0.10)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.22)', padding: 10, width: '100%',
  },
  authErrorText: { color: '#F87171', fontSize: 12, flex: 1, lineHeight: 17 },

  // ── New scroll sections ──────────────────────────────────────────────────────
  sectionSubtitle: { fontSize: 13, color: '#64748B', marginTop: -8 },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(30,41,59,0.85)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(37,99,235,0.22)',
    padding: 16, alignItems: 'center', gap: 5,
  },
  statEmoji: { fontSize: 26 },
  statNum: { fontSize: 22, fontWeight: '800', color: '#F1F5F9', letterSpacing: -0.5 },
  statLabel: { fontSize: 10, color: '#64748B', textAlign: 'center', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },

  beforeAfterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  baCard: { flex: 1, borderRadius: 20, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)' },
  baGrad: { padding: 20, alignItems: 'center', gap: 6, minHeight: 150, justifyContent: 'center' },
  baBadge: { fontSize: 10, fontWeight: '800', color: '#CBD5E1', letterSpacing: 1.8 },
  baCarEmoji: { fontSize: 56 },
  baSparkleRow: { fontSize: 18, letterSpacing: 6 },
  baTagline: { fontSize: 13, fontWeight: '700', color: '#E2E8F0' },
  baArrow: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(37,99,235,0.15)',
    borderWidth: 1.5, borderColor: '#2563EB',
    alignItems: 'center', justifyContent: 'center',
  },

  svcCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  svcGrad: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  svcIcon: { fontSize: 34 },
  svcInfo: { flex: 1, gap: 4 },
  svcTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  svcName: { fontSize: 14, fontWeight: '700', color: '#F1F5F9' },
  svcBadgeWrap: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  svcBadgeText: { fontSize: 10, fontWeight: '700' },
  svcDesc: { fontSize: 11, color: '#64748B', lineHeight: 16 },
  svcPriceWrap: { alignItems: 'flex-end', gap: 1 },
  svcPrice: { fontSize: 20, fontWeight: '800', color: '#60A5FA', letterSpacing: -0.5 },
  svcPriceLabel: { fontSize: 10, color: '#475569' },

  hScroll: { marginHorizontal: -20 },
  testimonialCard: {
    width: 268, backgroundColor: 'rgba(30,41,59,0.9)', borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 18, gap: 12,
  },
  testimonialHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  testimonialAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#3B82F6',
  },
  testimonialInitial: { color: '#fff', fontWeight: '800', fontSize: 17 },
  testimonialName: { color: '#F1F5F9', fontWeight: '700', fontSize: 14 },
  testimonialCity: { color: '#64748B', fontSize: 12 },
  stars: { fontSize: 12, letterSpacing: 1 },
  testimonialText: { color: '#94A3B8', fontSize: 13, lineHeight: 20 },

  cleanerCard: {
    width: 148, borderRadius: 20, overflow: 'hidden',
    borderWidth: 1.5, borderColor: 'rgba(37,99,235,0.22)',
  },
  cleanerGrad: { padding: 18, alignItems: 'center', gap: 10 },
  cleanerAvatar: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(37,99,235,0.15)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(37,99,235,0.45)',
  },
  cleanerEmoji: { fontSize: 36 },
  cleanerBadgeWrap: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  cleanerBadgeText: { fontSize: 10, fontWeight: '700' },
  cleanerName: { color: '#F1F5F9', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  cleanerStats: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  cleanerRating: { color: '#F59E0B', fontSize: 13, fontWeight: '700' },
  cleanerJobs: { color: '#64748B', fontSize: 11 },

  promiseCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 16,
    backgroundColor: 'rgba(30,41,59,0.65)', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 16,
  },
  promiseIcon: { fontSize: 28 },
  promiseInfo: { flex: 1, gap: 4 },
  promiseTitle: { color: '#F1F5F9', fontWeight: '700', fontSize: 15 },
  promiseDesc: { color: '#64748B', fontSize: 13, lineHeight: 19 },

  joinBanner: { borderRadius: 22, overflow: 'hidden', marginBottom: 4 },
  joinGrad: { padding: 28, alignItems: 'center', gap: 12 },
  joinTitle: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  joinDesc: { color: '#BFDBFE', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  joinIcons: { flexDirection: 'row', gap: 14, marginTop: 6 },
  joinIconText: { fontSize: 26 },
});

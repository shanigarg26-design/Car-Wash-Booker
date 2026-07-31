import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import AppIcon from '@/components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const LABELS = ['Terrible', 'Poor', 'OK', 'Good', 'Excellent'];
const COLORS = ['#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981'];

function StarRow({ rating, onRate }: { rating: number; onRate: (r: number) => void }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map(s => (
        <TouchableOpacity key={s} onPress={() => onRate(s)} activeOpacity={0.7} style={styles.starBtn}>
          <AppIcon
            name="star"
            size={44}
            color={s <= rating ? '#F59E0B' : Colors.dark.border}
            style={{ opacity: s <= rating ? 1 : 0.5 }}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function FeedbackScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const { data: existingFeedback, isLoading } = useQuery({
    queryKey: ['feedback', bookingId],
    queryFn: () => apiFetch(`/api/feedback/booking/${bookingId}`),
    enabled: !!bookingId,
  });

  const { data: booking } = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => apiFetch(`/api/bookings/${bookingId}`),
    enabled: !!bookingId,
  });

  const submitMutation = useMutation({
    mutationFn: () => apiFetch('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ bookingId: Number(bookingId), rating, comment: comment.trim() || undefined }),
    }),
    onSuccess: () => {
      Alert.alert('Thanks for your feedback!', 'Your review has been submitted.', [
        { text: 'Done', onPress: () => router.replace('/(tabs)/bookings') },
      ]);
    },
    onError: (e: any) => Alert.alert('Error', e.message || 'Failed to submit feedback'),
  });

  if (isLoading) {
    return <View style={[styles.root, styles.center]}><ActivityIndicator color={Colors.dark.tint} size="large" /></View>;
  }

  // Only treat as "already reviewed" if the CURRENT user left a review — the
  // endpoint returns every party's reviews for this booking.
  const myReview = Array.isArray(existingFeedback)
    ? existingFeedback.find((f: any) => f.reviewerId === user?.id)
    : undefined;

  if (myReview) {
    return (
      <View style={[styles.root, { paddingTop: insets.top || 20 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Your Review</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.alreadyCard}>
          <AppIcon name="check-circle" size={48} color={Colors.dark.success} />
          <Text style={styles.alreadyTitle}>Review Submitted</Text>
          <View style={styles.starRow}>
            {[1,2,3,4,5].map(s => (
              <AppIcon key={s} name="star" size={32} color={s <= myReview.rating ? '#F59E0B' : Colors.dark.border} />
            ))}
          </View>
          {myReview.comment ? (
            <Text style={styles.alreadyComment}>"{myReview.comment}"</Text>
          ) : null}
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(tabs)/bookings')}>
            <Text style={styles.doneBtnText}>Back to Bookings</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top || 20 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rate Your Wash</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {booking && (
          <View style={styles.bookingCard}>
            <AppIcon name="map-pin" size={16} color={Colors.dark.tint} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bookingAddress} numberOfLines={1}>{booking.customerAddress}</Text>
              {booking.vehicleType && (
                <Text style={styles.bookingMeta}>{booking.vehicleType} · {booking.washType === 'both' ? 'E + Interior' : 'Exterior Only'}</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.ratingSection}>
          <Text style={styles.ratingQuestion}>How was your car wash experience?</Text>
          <StarRow rating={rating} onRate={setRating} />
          {rating > 0 && (
            <Text style={[styles.ratingLabel, { color: COLORS[rating - 1] }]}>
              {LABELS[rating - 1]}
            </Text>
          )}
        </View>

        {rating > 0 && (
          <View style={styles.commentSection}>
            <Text style={styles.commentLabel}>Tell us more (optional)</Text>
            <TextInput
              style={styles.commentInput}
              value={comment}
              onChangeText={setComment}
              placeholder={
                rating >= 4
                  ? "What did you love? Any highlights?"
                  : rating === 3
                  ? "What could we do better?"
                  : "What went wrong? Help us improve."
              }
              placeholderTextColor={Colors.dark.tabIconDefault}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        )}

        {rating > 0 && (
          <View style={styles.quickTags}>
            {(rating >= 4
              ? ['Great job!', 'Very thorough', 'On time', 'Polite cleaner', 'Spotless result']
              : ['Needs improvement', 'Missed spots', 'Late arrival', 'Could be cleaner']
            ).map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tag, comment.includes(tag) && styles.tagSelected]}
                onPress={() => setComment(c => c.includes(tag) ? c.replace(tag, '').trim() : `${c} ${tag}`.trim())}
              >
                <Text style={[styles.tagText, comment.includes(tag) && styles.tagTextSelected]}>{tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom || 24 }]}>
        <TouchableOpacity
          style={[styles.submitBtn, (!rating || submitMutation.isPending) && styles.submitBtnDisabled]}
          onPress={() => submitMutation.mutate()}
          disabled={!rating || submitMutation.isPending}
        >
          {submitMutation.isPending
            ? <ActivityIndicator color="#FFF" />
            : <>
                <AppIcon name="send" size={18} color="#FFF" />
                <Text style={styles.submitBtnText}>Submit Review</Text>
              </>
          }
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={() => router.replace('/(tabs)/bookings')}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  backBtn: { padding: 8, width: 40 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },
  scroll: { flex: 1 },
  bookingCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    margin: 20, backgroundColor: Colors.dark.card, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: Colors.dark.border,
  },
  bookingAddress: { fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  bookingMeta: { fontSize: 12, color: Colors.dark.tabIconDefault, marginTop: 2 },
  ratingSection: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  ratingQuestion: { fontSize: 20, fontWeight: '700', color: Colors.dark.text, textAlign: 'center', marginBottom: 24 },
  starRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  starBtn: { padding: 4 },
  ratingLabel: { fontSize: 18, fontWeight: 'bold', letterSpacing: 0.5 },
  commentSection: { paddingHorizontal: 20, paddingTop: 16 },
  commentLabel: { fontSize: 14, fontWeight: '600', color: Colors.dark.text, marginBottom: 10 },
  commentInput: {
    backgroundColor: Colors.dark.card, borderRadius: 14, padding: 16,
    color: Colors.dark.text, fontSize: 15, borderWidth: 1, borderColor: Colors.dark.border,
    minHeight: 100,
  },
  quickTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingTop: 14 },
  tag: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border,
  },
  tagSelected: { backgroundColor: `${Colors.dark.tint}20`, borderColor: Colors.dark.tint },
  tagText: { fontSize: 13, color: Colors.dark.tabIconDefault, fontWeight: '500' },
  tagTextSelected: { color: Colors.dark.tint },
  footer: {
    paddingHorizontal: 20, paddingTop: 14, gap: 8,
    backgroundColor: Colors.dark.card, borderTopWidth: 1, borderTopColor: Colors.dark.border,
  },
  submitBtn: {
    backgroundColor: Colors.dark.tint, borderRadius: 16, padding: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { color: '#FFF', fontSize: 17, fontWeight: 'bold' },
  skipBtn: { alignItems: 'center', padding: 10 },
  skipText: { color: Colors.dark.tabIconDefault, fontSize: 14 },
  alreadyCard: {
    margin: 30, alignItems: 'center', backgroundColor: Colors.dark.card,
    borderRadius: 20, padding: 30, gap: 16, borderWidth: 1, borderColor: Colors.dark.border,
  },
  alreadyTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.dark.text },
  alreadyComment: { fontSize: 15, color: Colors.dark.tabIconDefault, fontStyle: 'italic', textAlign: 'center' },
  doneBtn: {
    backgroundColor: Colors.dark.tint, borderRadius: 14, paddingVertical: 14,
    paddingHorizontal: 32, marginTop: 8,
  },
  doneBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});

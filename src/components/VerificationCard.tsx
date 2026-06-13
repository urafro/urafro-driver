import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  ApiError,
  acceptTerms,
  confirmDocument,
  getDocuments,
  getUploadUrl,
  type DriverRequirement,
  type FileRequirementType,
} from '../lib/api';
import { colors, shadow, PILL } from '../theme';

const TERMS_VERSION = 'v1';

// The requirements a driver completes to get verified (ADR-003 P1). ID + photo +
// terms are the gate; licence is optional (raises KYC tier, lets you carry more).
const ITEMS: { type: DriverRequirement['type']; label: string; help: string; file: boolean }[] = [
  { type: 'identity_id', label: 'National ID', help: 'A clear photo of your ID', file: true },
  { type: 'profile_photo', label: 'Profile photo', help: 'A recent photo of your face', file: true },
  { type: 'terms', label: 'Driver terms', help: 'Accept how urAfro deliveries work', file: false },
];

function statusLabel(s: DriverRequirement['status']): { text: string; tone: 'done' | 'pending' | 'todo' | 'bad' } {
  switch (s) {
    case 'approved':
      return { text: 'Approved', tone: 'done' };
    case 'pending_review':
      return { text: 'In review', tone: 'pending' };
    case 'rejected':
      return { text: 'Rejected', tone: 'bad' };
    case 'expired':
      return { text: 'Resubmit', tone: 'bad' };
    default:
      return { text: 'Required', tone: 'todo' };
  }
}

/**
 * The driver-facing verification checklist (ADR-003 P1). Drives off GET
 * /driver/documents; lets the driver accept terms and upload ID/photo. Uploads go
 * straight to object storage via a presigned URL — when storage isn't configured
 * yet the server returns 503 and we say so honestly rather than pretending.
 */
export default function VerificationCard({ token, onChange }: { token: string; onChange?: () => void }) {
  const [reqs, setReqs] = useState<DriverRequirement[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getDocuments(token);
      setReqs(data);
    } catch {
      // leave the checklist hidden if it can't load — the rest of the gate still works
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusOf = (type: DriverRequirement['type']): DriverRequirement['status'] =>
    reqs?.find((r) => r.type === type)?.status ?? 'not_submitted';
  const reasonOf = (type: DriverRequirement['type']): string | null =>
    reqs?.find((r) => r.type === type)?.review_reason ?? null;

  const onAcceptTerms = useCallback(async () => {
    setBusy('terms');
    setNote(null);
    try {
      await acceptTerms(token, TERMS_VERSION);
      await load();
      onChange?.();
    } catch {
      setNote('Could not accept the terms — try again.');
    } finally {
      setBusy(null);
    }
  }, [token, load, onChange]);

  const onUpload = useCallback(
    async (type: FileRequirementType) => {
      setBusy(type);
      setNote(null);
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setNote('Allow photo access so you can upload your document.');
          return;
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.5, // compress for 2G — the server thumbnails it anyway
        });
        if (picked.canceled || picked.assets.length === 0) return;

        const presign = await getUploadUrl(token, type); // 503 if storage off
        // Stream the file to R2 via native HTTP (OkHttp/NSURLSession). A JS
        // fetch(uri).blob() PUT fails to send the body on Android (the file:// →
        // Blob path), so uploadAsync with BINARY_CONTENT is the robust route.
        const put = await FileSystem.uploadAsync(presign.upload.url, picked.assets[0].uri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        });
        if (put.status < 200 || put.status >= 300) throw new Error(`upload ${put.status}`);
        await confirmDocument(token, presign.document_id);
        await load();
        onChange?.();
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          setNote('Document uploads open soon — the team will reach out to verify you for now.');
        } else {
          setNote('Upload failed — check your connection and try again.');
        }
      } finally {
        setBusy(null);
      }
    },
    [token, load, onChange],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Get verified</Text>
      <Text style={styles.lead}>Complete these so the urAfro team can clear you for shifts.</Text>

      {ITEMS.map((item) => {
        const status = statusOf(item.type);
        const badge = statusLabel(status);
        const done = status === 'approved' || status === 'pending_review';
        const reason = reasonOf(item.type);
        return (
          <View key={item.type} style={styles.row}>
            <Feather
              name={status === 'approved' ? 'check-circle' : status === 'pending_review' ? 'clock' : 'circle'}
              size={20}
              strokeWidth={1.5}
              color={status === 'approved' ? colors.success : status === 'pending_review' ? colors.warning : colors.textFaint}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={styles.rowHelp}>
                {status === 'rejected' && reason ? `Rejected: ${reason}` : item.help}
              </Text>
            </View>
            {done ? (
              <View style={[styles.badge, badge.tone === 'done' ? styles.badgeDone : styles.badgePending]}>
                <Text style={[styles.badgeText, badge.tone === 'done' ? styles.badgeTextDone : styles.badgeTextPending]}>
                  {badge.text}
                </Text>
              </View>
            ) : busy === item.type ? (
              <ActivityIndicator color={colors.tabActive} />
            ) : (
              <Pressable
                style={styles.action}
                onPress={() => (item.file ? void onUpload(item.type as FileRequirementType) : void onAcceptTerms())}
              >
                <Text style={styles.actionText}>{item.file ? 'Upload' : 'Accept'}</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, ...shadow.card },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  lead: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowBody: { flex: 1 },
  rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  rowHelp: { color: colors.textFaint, fontSize: 13, marginTop: 1 },

  action: {
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: PILL,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  actionText: { color: colors.btnPrimaryText, fontSize: 14, fontWeight: '700' },

  badge: { borderRadius: PILL, paddingHorizontal: 12, paddingVertical: 6 },
  badgeDone: { backgroundColor: colors.surfaceAlt },
  badgePending: { backgroundColor: colors.batteryBg },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextDone: { color: colors.success },
  badgeTextPending: { color: colors.warning },

  note: { color: colors.textMuted, fontSize: 14, marginTop: 8, lineHeight: 20 },
});

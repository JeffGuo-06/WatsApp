import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { authService, waterlooAuthUtils } from "@/services/authService";
import { useAuth } from "@/context/AuthContext";

const sanitizeOtpInput = (value: string) => value.replace(/[^0-9]/g, "");
const sanitizeWatIamInput = (value: string) =>
  value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

export default function LoginScreen() {
  const [watiamId, setWatiamId] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null
  );
  const { user } = useAuth();

  // Redirect if already logged in
  React.useEffect(() => {
    if (user) {
      router.replace("/(tabs)");
    }
  }, [user]);

  const handleSendMagicLink = async () => {
    if (!watiamId) {
      Alert.alert("Error", "Please enter your WatIAM ID");
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Error", "Please enter your name");
      return;
    }

    setLoading(true);
    try {
      const response = await authService.sendMagicLink(watiamId, trimmedName);
      setWatiamId(response.watiamId);
      setName(trimmedName);
      setVerificationEmail(response.email);
      setEmailSent(true);
      Alert.alert(
        "Check your email!",
        `We sent a login code to ${response.email}. Enter the 6-digit code below.`,
        [{ text: "OK" }]
      );
    } catch (error: any) {
      Alert.alert("Error", error.message || "Unable to send verification email.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || otpCode.length !== 6) {
      Alert.alert("Error", "Please enter the 6-digit code");
      return;
    }

    setLoading(true);
    try {
      const { user: authUser, email, watiamId: normalizedId } =
        await authService.verifyOTP(watiamId, otpCode);

      if (authUser) {
        const currentName = name.trim();
        await authService.upsertProfile(authUser.id, normalizedId, currentName);
        setVerificationEmail(email);
        setWatiamId(normalizedId);
        router.replace("/(tabs)");
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const displayedEmail =
    verificationEmail ||
    (watiamId ? waterlooAuthUtils.buildWaterlooEmail(watiamId) : "");

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.content}>
        <Text style={styles.title}>WatsApp</Text>
        <Text style={styles.subtitle}>
          Connect with UWaterloo classmates
        </Text>

        <View style={styles.form}>
          {!emailSent ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Full Name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                editable={!loading}
              />

              <View style={styles.watiamContainer}>
                <TextInput
                  style={[styles.input, styles.watiamInput]}
                  placeholder="WatIAM ID (e.g., j23smith)"
                  value={watiamId}
                  onChangeText={(value) => setWatiamId(sanitizeWatIamInput(value))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
                <Text style={styles.watiamSuffix}>@uwaterloo.ca</Text>
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSendMagicLink}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Send Login Code</Text>
                )}
              </TouchableOpacity>

              <Text style={styles.infoText}>
                We&apos;ll email a code to your Waterloo account. Only @uwaterloo.ca
                emails can sign in.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.codeTitle}>Enter your 6-digit code</Text>
              <Text style={styles.codeSubtitle}>
                Sent to {displayedEmail || "your Waterloo email"}
              </Text>

              <TextInput
                style={[styles.input, styles.codeInput]}
                placeholder="000000"
                value={otpCode}
                onChangeText={(value) => setOtpCode(sanitizeOtpInput(value))}
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
              />

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleVerifyOTP}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Verify & Sign In</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => {
                  setEmailSent(false);
                  setOtpCode("");
                  setVerificationEmail(null);
                }}
              >
                <Text style={styles.toggleText}>Use a different WatIAM ID</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDB515", // UW Gold
  },
  content: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#000",
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: "#000",
    textAlign: "center",
    marginBottom: 40,
  },
  form: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    fontSize: 16,
  },
  watiamContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  watiamInput: {
    flex: 1,
    marginBottom: 0,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  watiamSuffix: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderLeftWidth: 0,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    padding: 15,
    backgroundColor: "#f5f5f5",
    fontSize: 14,
    color: "#666",
  },
  button: {
    backgroundColor: "#11181C",
    borderRadius: 10,
    padding: 15,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#11181C",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "bold",
  },
  toggleButton: {
    marginTop: 20,
    alignItems: "center",
  },
  toggleText: {
    color: "#666",
    fontSize: 14,
  },
  infoText: {
    marginTop: 15,
    textAlign: "center",
    color: "#666",
    fontSize: 14,
  },
  codeTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#000",
    textAlign: "center",
    marginBottom: 10,
  },
  codeSubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
  codeInput: {
    textAlign: "center",
    fontSize: 24,
    letterSpacing: 8,
    fontWeight: "bold",
  },
});

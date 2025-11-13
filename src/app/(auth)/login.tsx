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
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { authService, waterlooAuthUtils } from "@/services/authService";
import { useAuth } from "@/context/AuthContext";

const sanitizeOtpInput = (value: string) => value.replace(/[^0-9]/g, "");
const sanitizeWatIamInput = (value: string) =>
  value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

type LoginStep = "welcome" | "credentials" | "code";

export default function LoginScreen() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;
  const [step, setStep] = useState<LoginStep>("welcome");
  const [watiamId, setWatiamId] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
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

  const handleSignIn = () => {
    setStep("credentials");
  };

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
      setStep("code");
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

  const handleBackToCredentials = () => {
    setStep("credentials");
    setOtpCode("");
    setVerificationEmail(null);
  };

  const displayedEmail =
    verificationEmail ||
    (watiamId ? waterlooAuthUtils.buildWaterlooEmail(watiamId) : "");

  const renderWelcomeScreen = () => (
    <View style={styles.screenContainer}>
      <View
        style={[
          styles.welcomeContent,
          {
            paddingTop: height * 0.25,
            justifyContent: "flex-start",
          },
        ]}
      >
        <Text style={[styles.welcomeText, { fontSize: isTablet ? 24 : 18 }]}>
          Welcome to
        </Text>
        <Text style={[styles.appTitle, { fontSize: isTablet ? 72 : 56 }]}>
          WatsApp
        </Text>
        <TouchableOpacity
          style={[
            styles.signInButton,
            {
              paddingVertical: isTablet ? 18 : 16,
              paddingHorizontal: isTablet ? 48 : 40,
              minWidth: isTablet ? 200 : 160,
            },
          ]}
          onPress={handleSignIn}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.signInButtonText,
              { fontSize: isTablet ? 20 : 18 },
            ]}
          >
            Sign In
          </Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.logoContainer, { bottom: isTablet ? 60 : 40 }]}>
        <Image
          source={require("../../assets/images/WATSAPP_LOGO4x.png")}
          style={[
            styles.logo,
            {
              width: isTablet ? 120 : 80,
              height: isTablet ? 120 : 80,
            },
          ]}
          contentFit="contain"
        />
      </View>
    </View>
  );

  const renderCredentialsScreen = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.screenContainer}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: isTablet ? width * 0.2 : 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.credentialsContent,
            { maxWidth: isTablet ? 500 : "100%" },
          ]}
        >
          <Image
            source={require("../../assets/images/WATSAPP_LOGO4x.png")}
            style={[
              styles.logoSmall,
              {
                width: isTablet ? 80 : 60,
                height: isTablet ? 80 : 60,
                marginBottom: isTablet ? 40 : 32,
              },
            ]}
            contentFit="contain"
          />
          <Text
            style={[
              styles.credentialsTitle,
              {
                fontSize: isTablet ? 24 : 20,
                marginBottom: isTablet ? 40 : 32,
              },
            ]}
          >
            Enter your full name & WatIAM ID
          </Text>

          <TextInput
            style={[
              styles.input,
              {
                paddingVertical: isTablet ? 18 : 16,
                paddingHorizontal: isTablet ? 20 : 16,
                marginBottom: isTablet ? 20 : 16,
                fontSize: isTablet ? 18 : 16,
              },
            ]}
            placeholder="Full Name"
            placeholderTextColor="#999"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            editable={!loading}
          />

          <View style={[styles.watiamContainer, { marginBottom: isTablet ? 20 : 16 }]}>
            <TextInput
              style={[
                styles.input,
                styles.watiamInput,
                {
                  paddingVertical: isTablet ? 18 : 16,
                  paddingHorizontal: isTablet ? 20 : 16,
                  fontSize: isTablet ? 18 : 16,
                },
              ]}
              placeholder="WatIAM ID"
              placeholderTextColor="#999"
              value={watiamId}
              onChangeText={(value) => setWatiamId(sanitizeWatIamInput(value))}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            <Text
              style={[
                styles.watiamSuffix,
                {
                  paddingVertical: isTablet ? 18 : 16,
                  paddingHorizontal: isTablet ? 16 : 12,
                  fontSize: isTablet ? 16 : 14,
                },
              ]}
            >
              @uwaterloo.ca
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.button,
              loading && styles.buttonDisabled,
              {
                paddingVertical: isTablet ? 18 : 16,
                marginTop: isTablet ? 12 : 8,
              },
            ]}
            onPress={handleSendMagicLink}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                style={[
                  styles.buttonText,
                  { fontSize: isTablet ? 18 : 16 },
                ]}
              >
                Send Login Code
              </Text>
            )}
          </TouchableOpacity>

          <Text
            style={[
              styles.infoText,
              {
                marginTop: isTablet ? 24 : 20,
                fontSize: isTablet ? 16 : 14,
                lineHeight: isTablet ? 24 : 20,
              },
            ]}
          >
            We&apos;ll email a code to your Waterloo account.{"\n"}
            Only @uwaterloo.ca emails can sign in.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderCodeScreen = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.screenContainer}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: isTablet ? width * 0.2 : 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[styles.codeContent, { maxWidth: isTablet ? 500 : "100%" }]}
        >
          <Image
            source={require("../../assets/images/WATSAPP_LOGO4x.png")}
            style={[
              styles.logoSmall,
              {
                width: isTablet ? 80 : 60,
                height: isTablet ? 80 : 60,
                marginBottom: isTablet ? 40 : 32,
              },
            ]}
            contentFit="contain"
          />
          <Text
            style={[
              styles.codeTitle,
              {
                fontSize: isTablet ? 24 : 20,
                marginBottom: isTablet ? 12 : 8,
              },
            ]}
          >
            Enter your 6-digit code
          </Text>
          <Text
            style={[
              styles.codeSubtitle,
              {
                fontSize: isTablet ? 16 : 14,
                marginBottom: isTablet ? 40 : 32,
              },
            ]}
          >
            Sent to {displayedEmail || "your Waterloo email"}
          </Text>

          <TextInput
            style={[
              styles.codeInput,
              {
                paddingVertical: isTablet ? 20 : 18,
                marginBottom: isTablet ? 24 : 20,
                fontSize: isTablet ? 32 : 28,
                letterSpacing: isTablet ? 12 : 10,
              },
            ]}
            placeholder="0 0 0 0 0 0"
            placeholderTextColor="#999"
            value={otpCode}
            onChangeText={(value) => setOtpCode(sanitizeOtpInput(value))}
            keyboardType="number-pad"
            maxLength={6}
            editable={!loading}
            autoFocus
          />

          <TouchableOpacity
            style={[
              styles.button,
              loading && styles.buttonDisabled,
              {
                paddingVertical: isTablet ? 18 : 16,
                marginTop: isTablet ? 12 : 8,
              },
            ]}
            onPress={handleVerifyOTP}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                style={[
                  styles.buttonText,
                  { fontSize: isTablet ? 18 : 16 },
                ]}
              >
                Verify & Sign In
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toggleButton, { marginTop: isTablet ? 24 : 20 }]}
            onPress={handleBackToCredentials}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.toggleText, { fontSize: isTablet ? 16 : 14 }]}
            >
              Use a different WATIAM ID
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );


  return (
    <View style={styles.container}>
      {/* Base layer - light cream */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "#FFFEF8" }]} />
      
      {/* Small white cloud patch - top left */}
      <LinearGradient
        colors={["#FFFFFF", "#FFFFFF", "transparent"]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.3, y: 0.4 }}
      />
      
      {/* Large flowing golden splotch - bottom right */}
      <LinearGradient
        colors={["transparent", "#ebbc53", "#DCBC32", "#ebbc53"]}
        locations={[0, 0.3, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0.6 }}
        end={{ x: 1, y: 1 }}
      />
      
      {/* Flowing golden splotch - top right flowing down */}
      <LinearGradient
        colors={["transparent", "#ebbc53", "#F5E4C8", "transparent"]}
        locations={[0, 0.1, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.7, y: 0 }}
        end={{ x: 1, y: 0.6 }}
      />
      
      {/* Flowing golden splotch - center left flowing right */}
      <LinearGradient
        colors={["transparent", "#ebbc53", "#ebbc53", "#F5E4C8", "transparent"]}
        locations={[0, 0.1, 0.4, 0.7, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0.3 }}
        end={{ x: 0.5, y: 0.9 }}
      />
      
      {/* Flowing golden splotch - mid section flowing diagonally */}
      <LinearGradient
        colors={["transparent", "#ebbc53", "#DCBC32", "transparent"]}
        locations={[0, 0.3, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.3, y: 0.4 }}
        end={{ x: 0.8, y: 0.8 }}
      />
      
      {/* Flowing golden splotch - bottom left flowing up */}
      <LinearGradient
        colors={["transparent", "#F5E4C8", "#ebbc53", "#DCBC32"]}
        locations={[0, 0.2, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0.6 }}
        end={{ x: 0.4, y: 1 }}
      />
      
      {/* Small white cloud patch - center right */}
      <LinearGradient
        colors={["transparent", "#FFFFFF", "transparent"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.6, y: 0.2 }}
        end={{ x: 0.9, y: 0.5 }}
      />
      
      {/* Flowing golden splotch - top center flowing down */}
      <LinearGradient
        colors={["transparent", "#ebbc53", "#F5E4C8", "transparent"]}
        locations={[0, 0.2, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.4, y: 0 }}
        end={{ x: 0.7, y: 0.5 }}
      />
      
      {/* Content */}
      <View style={styles.contentOverlay}>
        {step === "welcome" && renderWelcomeScreen()}
        {step === "credentials" && renderCredentialsScreen()}
        {step === "code" && renderCodeScreen()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: "relative",
  },
  contentOverlay: {
    flex: 1,
    zIndex: 1,
  },
  screenContainer: {
    flex: 1,
    width: "100%",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 40,
  },
  // Welcome Screen Styles
  welcomeContent: {
    flex: 1,
    alignItems: "center",
  },
  welcomeText: {
    color: "#333",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
    marginBottom: 8,
    textAlign: "center",
  },
  appTitle: {
    fontWeight: "700",
    color: "#1a1a1a",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
    textAlign: "center",
    marginBottom: 40,
    textShadowColor: "rgba(0, 0, 0, 0.1)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  signInButton: {
    backgroundColor: "#2a2a2a",
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  signInButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  logoContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  logo: {},
  logoSmall: {
    alignSelf: "center",
  },
  // Credentials Screen Styles
  credentialsContent: {
    width: "100%",
    alignSelf: "center",
  },
  credentialsTitle: {
    fontWeight: "600",
    color: "#1a1a1a",
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 12,
    color: "#1a1a1a",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  watiamContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  watiamInput: {
    flex: 1,
    marginBottom: 0,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  watiamSuffix: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderLeftWidth: 0,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    color: "#666",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  button: {
    backgroundColor: "#2a2a2a",
    borderRadius: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  infoText: {
    textAlign: "center",
    color: "#666",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  // Code Screen Styles
  codeContent: {
    width: "100%",
    alignSelf: "center",
  },
  codeTitle: {
    fontWeight: "600",
    color: "#1a1a1a",
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  codeSubtitle: {
    color: "#666",
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  codeInput: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 12,
    paddingHorizontal: 20,
    textAlign: "center",
    fontWeight: "600",
    color: "#1a1a1a",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
  toggleButton: {
    alignItems: "center",
  },
  toggleText: {
    color: "#666",
    fontFamily: Platform.select({
      ios: "system-ui",
      android: "sans-serif",
      web: "system-ui, -apple-system, sans-serif",
    }),
  },
});

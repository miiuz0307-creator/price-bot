import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { loginWithPin, requestLoginCode, verifyLoginCode } from '@workspace/api-client-react';
import { BrandMark } from '@/components/LockScreen';
import { Button, Field, Screen, Txt } from '@/components/ui';
import { fonts } from '@/constants/theme';
import { errorMessage, mobileClient } from '@/lib/api';
import { useSession } from '@/lib/session';
import { keys, prefs } from '@/lib/storage';
import { useTheme } from '@/lib/theme';

type Step = 'identify' | 'code' | 'pin';

export default function LoginScreen() {
  const { c } = useTheme();
  const { signIn, biometric } = useSession();
  const [step, setStep] = useState<Step>('identify');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [destination, setDestination] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => { void prefs.get(keys.identifier, '').then((saved) => saved && setIdentifier(saved)); }, []);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Android back button: return to the first step instead of leaving the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'identify') return false;
      setError(null);
      setStep('identify');
      return true;
    });
    return () => subscription.remove();
  }, [step]);

  const isEmail = identifier.includes('@');
  const remember = () => prefs.set(keys.identifier, identifier.trim());

  const sendCode = useMutation({
    mutationFn: () => requestLoginCode({ identifier: identifier.trim() }, mobileClient),
    onSuccess: (result) => {
      void remember();
      setDestination(result.destination);
      setCode('');
      setError(null);
      setResendIn(60);
      setStep('code');
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const verify = useMutation({
    mutationFn: (value: string) => verifyLoginCode({ identifier: identifier.trim(), code: value }, mobileClient),
    onSuccess: (session) => signIn(session),
    onError: (failure) => { setError(errorMessage(failure)); setCode(''); },
  });

  const pinLogin = useMutation({
    mutationFn: () => loginWithPin({ identifier: identifier.trim(), code: pin }, mobileClient),
    onSuccess: (session) => { void remember(); return signIn(session); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const submitCode = (value: string) => {
    if (value.length === 6 && !verify.isPending) { Keyboard.dismiss(); verify.mutate(value); }
  };

  const go = (next: Step) => { setError(null); setStep(next); };
  const identifierOk = identifier.trim().length >= 5;
  const unlockNote = biometric.available
    ? 'אחרי הכניסה הראשונה אפשר להיכנס בטביעת אצבע או בזיהוי פנים'
    : 'הכניסה נשמרת בטלפון — לא צריך להתחבר בכל פעם';

  return (
    <Screen contentStyle={{ paddingTop: 0, flexGrow: 1 }}>
      <View style={{ flexGrow: 1, paddingTop: 72, gap: 28 }}>
        <View style={{ gap: 18, alignItems: 'flex-start' }}>
          <BrandMark />
          <View style={{ gap: 8, alignSelf: 'stretch' }}>
            <Txt variant="h1" style={{ fontSize: 30, lineHeight: 36 }}>
              {step === 'pin' ? 'כניסה עם קוד אישי' : 'כניסה למחירון'}
            </Txt>
            <Txt variant="body" color={c.muted} style={{ lineHeight: 24 }}>
              {step === 'identify' && 'הזינו את מספר הטלפון או האימייל שלכם. נשלח אליכם קוד חד־פעמי ב־WhatsApp.'}
              {step === 'code' && (destination
                ? `קוד בן 6 ספרות נשלח אליך עכשיו ב־WhatsApp למספר שמסתיים ב־${destination.replace(/\D/g, '').slice(-4)}.`
                : isEmail
                  ? 'אם האימייל שמור בחשבון, נשלח קוד ב־WhatsApp למספר הטלפון של החשבון. לא הגיע קוד? חזרו והיכנסו עם מספר הטלפון.'
                  : 'אם המספר רשום במערכת, נשלח אליו קוד ב־WhatsApp. לא הגיע קוד תוך דקה? בדקו את המספר או היכנסו עם קוד אישי.')}
              {step === 'pin' && 'הקוד האישי (4–8 ספרות) שקיבלתם מבעל המערכת.'}
            </Txt>
          </View>
        </View>

        {step === 'identify' || step === 'pin' ? (
          <View style={{ gap: 14 }}>
            <Field
              label="טלפון או אימייל"
              value={identifier}
              onChangeText={(text) => { setIdentifier(text); setError(null); }}
              placeholder="050-000-0000 או name@mail.com"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              keyboardType="email-address"
              ltr
              returnKeyType={step === 'pin' ? 'next' : 'send'}
              onSubmitEditing={() => step === 'identify' && identifierOk && sendCode.mutate()}
            />
            {step === 'pin' ? (
              <Field
                label="קוד אישי"
                value={pin}
                onChangeText={(text) => { setPin(text.replace(/\D/g, '').slice(0, 8)); setError(null); }}
                placeholder="••••"
                keyboardType="number-pad"
                secureTextEntry
                ltr
                returnKeyType="go"
                onSubmitEditing={() => pin.length >= 4 && identifierOk && pinLogin.mutate()}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Txt variant="bodySemi" style={{ fontSize: 14 }}>קוד מ־WhatsApp</Txt>
            <OtpInput value={code} onChange={(value) => { setCode(value); setError(null); submitCode(value); }} disabled={verify.isPending} />
            <Pressable disabled={resendIn > 0 || sendCode.isPending} onPress={() => sendCode.mutate()} accessibilityRole="button">
              <Txt variant="label" color={resendIn > 0 ? c.muted : c.mint}>
                {resendIn > 0 ? `שליחה חוזרת אפשרית בעוד 0:${String(resendIn).padStart(2, '0')}` : 'שליחת קוד חדש'}
              </Txt>
            </Pressable>
          </View>
        )}

        {error ? (
          <View accessibilityRole="alert" style={{ padding: 14, borderRadius: 14, backgroundColor: c.dangerBg, borderWidth: 1, borderColor: c.dangerLine }}>
            <Txt variant="bodyMedium" color={c.dangerText}>{error}</Txt>
          </View>
        ) : null}

        <View style={{ marginTop: 'auto', gap: 12, paddingBottom: 12 }}>
          {step === 'identify' ? (
            <Button title="שליחת קוד ב־WhatsApp" icon="whatsapp" disabled={!identifierOk} loading={sendCode.isPending} onPress={() => sendCode.mutate()} />
          ) : step === 'code' ? (
            <Button title="כניסה" disabled={code.length < 6} loading={verify.isPending} onPress={() => submitCode(code)} />
          ) : (
            <Button title="כניסה" disabled={!identifierOk || pin.length < 4} loading={pinLogin.isPending} onPress={() => pinLogin.mutate()} />
          )}
          {step === 'pin' ? (
            <Button title="כניסה עם קוד ב־WhatsApp" variant="ghost" icon="message-circle" onPress={() => go('identify')} />
          ) : step === 'code' ? (
            <Button title="שינוי מספר" variant="ghost" icon="edit-2" onPress={() => go('identify')} />
          ) : (
            <Button title="כניסה עם קוד אישי" variant="ghost" icon="key" onPress={() => go('pin')} />
          )}
          <Txt variant="label" color={c.muted} center style={{ marginTop: 4 }}>{unlockNote}</Txt>
        </View>
      </View>
    </Screen>
  );
}

/** Six boxes over one hidden input (works with SMS/clipboard autofill and paste). */
function OtpInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { c } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(true);
  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityLabel="קוד בן 6 ספרות" style={{ direction: 'ltr' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        {Array.from({ length: 6 }, (_, index) => {
          const digit = value[index] ?? '';
          const current = focused && index === Math.min(value.length, 5);
          return (
            <View
              key={index}
              style={{
                flex: 1, maxWidth: 54, height: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                backgroundColor: current ? c.surface2 : c.surface,
                borderWidth: current ? 2 : 1.5, borderColor: current ? c.text : digit ? c.mint : c.line,
              }}
            >
              <Txt variant="numLg" style={{ fontFamily: fonts.headSemi, fontSize: 24 }} center>{digit}</Txt>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus
        editable={!disabled}
        maxLength={6}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        style={{ position: 'absolute', opacity: 0.011, width: '100%', height: 60, color: 'transparent' }}
        accessibilityLabel="קוד מ־WhatsApp"
      />
    </Pressable>
  );
}

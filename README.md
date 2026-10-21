# Motiva

Notifiche a intensità crescente finché non confermi di star svolgendo la routine. Calendario mensile incluso.

Due versioni, stesso codice:

- **Web / PWA** (cartella radice): si apre da browser, ad esempio con GitHub Pages. Le notifiche scattano solo se la pagina resta aperta.
- **App Android** (cartella `native/`): allarmi programmati dal sistema, che arrivano anche con l'app chiusa.

## Avvio web in locale

```
python3 -m http.server 8000
```

Apri http://localhost:8000

## App Android

L'APK si compila su GitHub Actions: vai su **Actions → Build APK Android → Run workflow** (parte anche a ogni push che tocca l'app). A fine build scarica l'artefatto `motiva-apk`, estrai `app-debug.apk` e installalo sul telefono (serve consentire l'installazione da fonti sconosciute).

Dopo l'installazione:

1. Consenti le notifiche e gli **allarmi esatti** quando richiesto.
2. Imposta Motiva su **Batteria → Nessuna restrizione**: alcuni produttori (Xiaomi, Huawei, Samsung…) bloccano gli allarmi delle app in background.
3. Apri l'app almeno una volta ogni pochi giorni: gli allarmi vengono programmati per i 4 giorni successivi a ogni apertura.

### Compilare in locale

Servono Node 22, JDK 21 e Android Studio (SDK 36).

```
cd native
npm ci
npm run sync
cd android && ./gradlew assembleDebug
```

L'APK è in `native/android/app/build/outputs/apk/debug/`.

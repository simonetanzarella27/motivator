# Motiva

Notifiche a intensità crescente finché non confermi di star svolgendo la routine. Calendario mensile incluso.

Due versioni, stesso codice:

- **Web / PWA** (cartella radice): si apre da browser, ad esempio con GitHub Pages. Le notifiche scattano solo se la pagina resta aperta.
- **App Android** (cartella `native/`): allarmi programmati dal sistema, che arrivano anche con l'app chiusa.

Nelle impostazioni si può regolare la frequenza degli avvisi (da molto bassa a molto alta); per diagnosticare l'app Android sono disponibili anche prove separate di notifica/vibrazione e apertura a schermo intero, oltre allo stato degli avvisi programmati.

## Avvio web in locale

```
python3 -m http.server 8000
```

Apri http://localhost:8000

## App Android

L'APK si compila su GitHub Actions: vai su **Actions → Build APK Android → Run workflow** (parte anche a ogni push che tocca l'app). A fine build scarica l'artefatto `motiva-apk`, estrai `app-debug.apk` e installalo sul telefono (serve consentire l'installazione da fonti sconosciute).

Dopo l'installazione:

1. Consenti le notifiche e gli **allarmi esatti** quando richiesto. Motiva programma gli avvisi sul sistema Android, quindi arrivano anche con l'app chiusa; senza questi permessi gli orari non possono essere garantiti.
2. Tocca **Attiva permessi** nell'avviso di Motiva per autorizzare l'attività in background. Android può chiedere anche l'esenzione dall'ottimizzazione batteria; sui dispositivi Android 14+ può essere necessario autorizzare separatamente gli intent a schermo intero.
3. Se il produttore continua a limitare l'app, imposta Motiva su **Batteria → Nessuna restrizione**: alcuni produttori (Xiaomi, Huawei, Samsung…) applicano restrizioni aggiuntive.
4. Apri l'app almeno una volta ogni pochi giorni: gli allarmi vengono programmati per i 4 giorni successivi a ogni apertura.
5. Nelle impostazioni Android di Motiva, lascia attiva la vibrazione dei canali di notifica: i pattern sono progressivamente più lunghi e intensi, soprattutto nei livelli finali. Dopo un aggiornamento dei pattern Android crea nuovi canali; se serve, controlla che la vibrazione sia attiva anche nelle impostazioni di sistema.
6. I promemoria usano un breve arpeggio chiaro, con ripetizioni e durata crescenti nei livelli più alti. Il volume dipende dal volume notifiche del telefono e dalle impostazioni del canale Android.

Le notifiche sono allarmi locali memorizzati sul telefono e funzionano anche senza connessione. Gli intent a schermo intero sono soggetti alle autorizzazioni e alle restrizioni di Android; Android può mostrare soltanto un banner quando lo schermo è acceso, e aprire Motiva solo quando il sistema consente l'intent (tipicamente a schermo spento/bloccato). Se non concessi, Motiva mostra una normale notifica. La frequenza selezionata imposta gli intervalli richiesti, ma Android può ritardare gli allarmi ravvicinati mentre il dispositivo è in modalità Doze. Per rispettare il limite Android di allarmi, Motiva riserva il primo avviso di ogni routine e fase prima dei richiami ripetuti. Le notifiche push remote da un server richiedono invece un backend e la relativa configurazione Firebase, non presente in questo progetto.

### Compilare in locale

Servono Node 22, JDK 21 e Android Studio (SDK 36).

```
cd native
npm ci
npm run sync
cd android && ./gradlew assembleDebug
```

L'APK è in `native/android/app/build/outputs/apk/debug/`.

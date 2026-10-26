# Signal Radar für Meme Coins

Lokales Frühwarnsystem für Meme-Coins. Es sammelt öffentliche Marktdaten, prüft verfügbare Vertragsrisiken, kann X-Aktivität einbeziehen und führt keine Trades aus.

## Heute starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm start
```

Danach `http://127.0.0.1:4173` öffnen. Ohne weitere Einrichtung funktionieren bereits:

- Live-Kandidaten von DEX Screener
- Breite Startliste aus DEX-Boosts und neu veröffentlichten Token-Profilen
- Radar-Score und Risikoampel
- Trajectory-Ausblick für die nächsten sechs Stunden mit Liquiditätstrend und Datenlage
- GoPlus-Vertragsprüfung für unterstützte EVM-Netzwerke
- Suche, Filter, Merkliste und dauerhaft gespeicherter Scan-Verlauf
- Automatische Scans im Hintergrund und Browser-Aktualisierung

Der Rechner muss eingeschaltet bleiben und der Serverprozess muss laufen. Die Seite ist standardmäßig nur auf diesem Rechner erreichbar.

## Telegram-Alarme aktivieren

1. In Telegram bei `@BotFather` mit `/newbot` einen Bot erstellen.
2. Dem neuen Bot einmal eine Nachricht senden.
3. Die Datei `.env.example` als `.env` anlegen und diese Werte eintragen:

```text
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=dein_bot_token
TELEGRAM_CHAT_ID=deine_chat_id
ALERT_MIN_SCORE=75
```

4. Signal Radar neu starten und unter **Setup** die Testnachricht senden.

Zum Ermitteln der Chat-ID kann nach der ersten Nachricht diese Telegram-Adresse im Browser geöffnet werden:

```text
https://api.telegram.org/bot<DEIN_TOKEN>/getUpdates
```

Die Zahl unter `message.chat.id` ist die Chat-ID. Token und Chat-ID werden niemals an die Radar-Oberfläche ausgeliefert.

## X-Signale aktivieren

Ein X-API-Zugang ist optional und kann kostenpflichtig sein. Den Bearer Token in `.env` ergänzen:

```text
X_BEARER_TOKEN=dein_bearer_token
SOCIAL_SCAN_LIMIT=5
```

Nach einem Neustart werden für die stärksten Kandidaten aktuelle Posts, unterschiedliche Accounts und Interaktionen ausgewertet. Der Social-Bonus ist auf acht Score-Punkte begrenzt.

## Datenquellen und Grenzen

- DEX Screener: Markt, Volumen, Transaktionen, Paaralter und öffentliche Social-Links.
- GoPlus: Honeypot-, Steuer-, Eigentümer-, Mint-, Blacklist-, Holder- und LP-Indikatoren, soweit verfügbar.
- X Recent Search: optionale Erwähnungs- und Interaktionsdaten der jüngsten Posts.
- Solana-Vertragsrechte können derzeit unvollständig bleiben und werden dann ausdrücklich als ungeprüft markiert.
- Demo-Daten erscheinen klar gekennzeichnet, wenn die Live-Quelle ausfällt.
- Trajectory ist eine Heuristik, keine kalibrierte Überlebenswahrscheinlichkeit. Sie nutzt Liquidität, Handelsaktivität, Kauf-/Verkaufsverhältnis und Preisbewegung der letzten Stunde sowie Paaralter und verfügbare GoPlus-Befunde. Fehlen Stundenwerte, nutzt sie 24-Stunden-Werte als Ersatz und zeigt niedrige Datenlage. Frühere Liquiditätswerte werden lokal in `data/snapshots.json` gespeichert; vor mehreren Scans bleibt die Datenlage niedrig.
- Das System ist eine Recherchehilfe, keine Anlageberatung und keine Garantie gegen Betrug.

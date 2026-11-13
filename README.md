# Brinkgame

Quizshow für eure Runde: Ein Moderator leitet, alle anderen buzzern und antworten im Sprachchat.
Board mit Kategorien und Punktwerten, Risiko-Felder, Finale, Teams und Einzelspieler gemischt,
Kamera-Leiste, vier Designs, 13 Fragenpakete mit 2600 Fragen und ein Paket-Editor.

```
client/   Windows-App (Electron) und Web-Oberfläche
server/   Spielserver (Node.js, WebSocket)
deploy/   Docker-Dateien für den eigenen Server (Spielserver, TLS, TURN)
tools/    Testlauf mit mehreren Clients, Icon-Erzeugung
```

## 1. Die App bauen (Windows-exe)

Voraussetzung: [Node.js 20 oder neuer](https://nodejs.org).

```bash
cd client
npm install
npm run dist
```

Danach liegen in `client/release/`:

- `Brinkgame-1.0.0-portable.exe`: eine einzelne Datei, startet ohne Installation.
- `Brinkgame-1.0.0-win-x64.zip`: entpackter Ordner, startet schneller als die portable Datei.

Die exe ist nicht signiert. Windows zeigt beim ersten Start „Der Computer wurde durch Windows
geschützt“. Mit „Weitere Informationen“ und „Trotzdem ausführen“ geht es weiter. Wer das
vermeiden will, braucht ein Code-Signing-Zertifikat.

Zum Entwickeln: `npm start` baut und öffnet die App direkt.

## 2. Den Server starten

### Schnell zum Ausprobieren (ein PC im Heimnetz)

```bash
cd client && npm install && npm run build   # baut auch die Web-Oberfläche
cd ../server && npm install && npm start
```

Der Server hört auf Port 8787. In der App als Adresse `IP-des-PCs:8787` eintragen.
Im selben Netz funktionieren Voice und Kamera ohne weitere Einrichtung.

### Dauerhaft auf einem Server: ein Befehl

Auf einem Linux-Server (egal bei welchem Anbieter) den Quellcode entpacken, in den Ordner
wechseln und eingeben:

```bash
sudo bash install-server.sh
```

Das Skript installiert Docker, erkennt die IP-Adresse, erzeugt alle Schlüssel, öffnet die
Ports auf dem Server (wenn dort eine Firewall läuft), startet alles und schreibt am Ende die
**Verbindungsdaten** in die Konsole und in die Datei `VERBINDUNG.txt`. Es muss nichts
konfiguriert werden. Das erste Mal dauert es einige Minuten, weil der Server gebaut wird.

Danach in der App unter „Server hinzufügen" die angezeigte Adresse eintragen.

Optionen: `--domain brink.example.de` (HTTPS), `--no-domain`, `--password GEHEIM`,
`--name "Mein Server"`, `--remove` (stoppt und entfernt den Server). Erneut ausführen ist
ungefährlich, Einstellungen und Schlüssel bleiben erhalten.

Wichtig: Eine Firewall **beim Anbieter** (zum Beispiel im Webpanel) kann das Skript nicht
ändern. Die offenen Ports stehen in der Ausgabe des Skripts.

Wer lieber von Hand arbeitet, findet die einzelnen Schritte hier:

### Dauerhaft auf einem Server von Hand (Docker, mit oder ohne Domain)

Gilt für jeden Linux-Server, egal bei welchem Anbieter (Hetzner, NovaCloud, eigener Rechner).
Ein kleiner Server reicht (2 vCPU, 4 GB RAM). Voice und Kamera laufen direkt zwischen den
Spielern. Der Server vermittelt nur, und über TURN läuft der Verkehr der Spieler, die sich nicht
direkt erreichen.

**Eine Domain ist nicht nötig.** Die Windows-App verbindet sich auch direkt mit der IP-Adresse
des Servers. Eine Domain mit HTTPS braucht man nur, wenn jemand im **Browser** (z. B. iPad) mit
Mikrofon und Kamera spielen soll, denn Browser erlauben beides nur über HTTPS.

1. Linux-Server mit Docker: `curl -fsSL https://get.docker.com | sh`
2. Firewall (beim Anbieter oder `ufw`) öffnen:

   | Port | Protokoll | Zweck | Wann |
   |---|---|---|---|
   | 8787 | TCP | Spielserver | ohne Domain |
   | 80, 443 | TCP | Spielserver mit HTTPS | mit Domain |
   | 3478 | TCP und UDP | TURN (Sprache und Kamera) | immer |
   | 49160 bis 49400 | UDP | TURN-Medienports | immer |

3. Projekt auf den Server kopieren und Einstellungen anlegen:

   ```bash
   cd deploy
   cp .env.example .env
   openssl rand -hex 32     # Ausgabe als TURN_SECRET verwenden
   nano .env                # PUBLIC_IP und TURN_SECRET eintragen
   ```

4. Starten, **ohne Domain**:

   ```bash
   docker compose up -d --build
   ```

   In der App als Server nur die IP eintragen, z. B. `203.0.113.10`. Der Port 8787 wird
   automatisch ergänzt. Im Browser läuft die Oberfläche dann unter `http://203.0.113.10:8787`,
   dort ohne Mikrofon und Kamera.

   **Mit Domain (HTTPS):** Die Domain per A-Eintrag auf die IP zeigen lassen. In `.env` die
   Zeilen `DOMAIN=…` und `HTTP_BIND=127.0.0.1` einkommentieren und ausfüllen, dann starten mit:

   ```bash
   docker compose --profile https up -d --build
   ```

   In der App als Server die Domain eintragen, z. B. `brink.example.de`. Caddy holt das
   Zertifikat selbst. Im Browser gehen dann auch Mikrofon und Kamera.

Prüfen: `docker compose ps` zeigt die laufenden Dienste, `docker compose logs brinkgame` das
Protokoll. Im Browser gibt es kein Anti-Cheat.

Mehrere Server: Jeder Server ist unabhängig. In der App lassen sich beliebig viele eintragen.

Einstellungen des Servers (Umgebungsvariablen): `PORT`, `SERVER_NAME`, `SERVER_PASSWORD`,
`MAX_LOBBIES`, `STUN_URLS`, `TURN_URLS`, `TURN_SECRET` (oder `TURN_USER` und `TURN_PASS`).

## 2b. iPhone und iPad

Eine native iOS-App gibt es nicht (dafür bräuchte man einen Mac mit Xcode und ein Apple-Entwicklerkonto).
Stattdessen läuft Brinkgame im Safari-Browser und lässt sich wie eine App auf den Home-Bildschirm legen.

1. Server mit **Domain und HTTPS** betreiben (siehe oben, `install-server.sh` mit Domain). Safari erlaubt
   Mikrofon und Kamera nur über HTTPS. Ohne HTTPS kann man mitspielen, aber weder sprechen noch senden.
2. Auf dem iPhone oder iPad die Adresse des Servers in **Safari** öffnen.
3. Teilen-Symbol, dann **Zum Home-Bildschirm**. Brinkgame startet danach im Vollbild mit eigenem Symbol.
4. Beim ersten Beitritt Mikrofon und Kamera erlauben. Ton startet erst nach dem ersten Tippen
   (Einschränkung von iOS).

Das Layout passt sich Handy und Tablet im Hochformat an: Das Board scrollt seitlich, Spieler und Regeln
stehen untereinander, die Kameras laufen als Leiste unten. Geprüft ist das mit iPhone- und iPad-Emulation
(`node tools/e2e-mobile.cjs`), nicht auf einem echten Gerät. Anti-Cheat gibt es im Browser nicht. Der
Moderator sieht in der Lobby, wer im Browser spielt.

## 3. So läuft eine Runde

1. Namen eingeben, Server wählen, Lobby erstellen. Wer die Lobby erstellt, moderiert.
2. Die anderen treten mit dem fünfstelligen Code bei. Die App bleibt verbunden, solange man in der
   Lobby ist, und verbindet sich nach einem Abbruch von selbst neu. Der Platz bleibt reserviert.
3. Der Moderator wählt Pakete (und auf Wunsch einzelne Kategorien), stellt die Regeln ein und
   startet. Mit „Board ansehen“ kann er vorher Kategorien und einzelne Fragen austauschen.
4. Wer dran ist, wählt ein Feld. Der Moderator liest vor und gibt die Antwort frei (Taste `B`).
5. **Wer das Feld wählt, antwortet** (Standard). Das wählende Team, oder die einzelne Spielerin,
   beantwortet die Frage selbst. Es gibt kein Buzzer-Rennen. Danach ist reihum das nächste Team
   dran, nicht automatisch der Gewinner. Antwortet das Team falsch, dürfen die anderen klauen:
   Dann buzzern sie mit der Leertaste, der Server entscheidet, wer zuerst war, und gleicht dabei
   unterschiedliche Verbindungszeiten aus. Wer zu früh drückt, ist kurz gesperrt. Das lässt sich
   ausschalten („Nach einer falschen Antwort dürfen die anderen klauen"). In den Regeln gibt es
   auch die klassische Variante „Wer zuerst buzzert": Alle buzzern, wer zuerst ist, antwortet.
6. Wer antwortet, bleibt laut. Alle anderen dürfen weiterreden, werden aber leiser gestellt
   (Standard 20 %). Jeder stellt diesen Wert für sich ein: Einstellungen → Sprachchat.
7. Der Moderator sieht die Lösung und drückt `R` (richtig) oder `F` (falsch). Punkte werden
   automatisch verteilt. `Rückgängig` nimmt den letzten Schritt zurück.

**Teams:** Im Modus „Teams und Einzelspieler“ kann jeder ein Team gründen, einem beitreten oder
allein bleiben. Teams und Einzelspieler stehen in derselben Wertung. Im Modus „Jeder für sich“
gibt es keine Teams. Der Sprachkanal ist immer für alle offen.

**Voreinstellungen:** Regeln und Paketauswahl lassen sich unter einem Namen speichern und später
mit einem Klick laden.

## 3b. Aussehen

Unter Einstellungen → Design wählt jeder für sich:

- ein **Design**: Schlicht (Standard, ruhig und grau), Neon, Studio, Papier oder Arcade,
- einen **Hintergrund**: Wald, Berge, Strand, Stadt bei Nacht, Sternenhimmel oder ein eigenes Bild
  von deinem PC. „Nur Farbe" schaltet das Foto aus. Abdunkeln und Unschärfe sind einstellbar.

Die Fotos stammen von Unsplash (Unsplash-Lizenz: frei nutzbar, keine Namensnennung nötig).
Fotografen, soweit bekannt, stehen unter dem Reiter in der App.

**Schwierigkeit:** Der Moderator wählt sie je Paket (Gemischt, Leicht, Mittel, Schwer) oder für
alle Pakete auf einmal. Gemischt steigert sich von einfach (100) bis schwer (500). Bei Leicht sind
alle fünf Zeilen eher einfach, bei Schwer durchgehend schwer. Die Punktwerte bleiben 100 bis 500.

## 4. Fragenpakete

Mitgeliefert: YouTuber, Streamer & Twitch, Influencer & Social Media, Orte & Sehenswürdigkeiten,
Welt & Geografie, Flaggen, Allgemeinwissen, Film & Serien, Musik, Gaming, Sport,
Wissenschaft & Natur, Historische Personen. Je 200 Fragen in 10 Kategorien.

Unter „Fragenpakete“ in der App:

- Suchleiste über Frage, Antwort und Kategorie, dazu Filter nach Wert und Status.
- Einzelne Fragen ausschalten, ändern oder löschen. Die Treffer einer Suche lassen sich auf
  einmal ausschalten oder löschen.
- Eigene Fragen und Kategorien hinzufügen, auch mit Bild.
- Neue Pakete anlegen, Pakete kopieren, als Datei exportieren und importieren.
- Mitgelieferte Pakete lassen sich jederzeit zurücksetzen.

Viele Fragen auf einmal: „Als Text einfügen“ nimmt Zeilen in diesem Format an.

```
# Hauptstädte
1 | Die Hauptstadt von Frankreich. | Paris
2 | Die Hauptstadt von Kanada. | Ottawa | nicht Toronto
```

Die erste Zahl ist der Wert (1 bis 5 für 100 bis 500), der letzte Teil ein optionaler Hinweis
für den Moderator. Eine Kategorie ist spielbar, sobald sie für jeden Wert mindestens eine aktive
Frage hat. Die mitgelieferten Pakete liegen im selben Format in `client/packs/`.

Die Fragen wurden von Hand geschrieben und geprüft, bei 2600 Stück können trotzdem Fehler dabei
sein, vor allem bei Creatorn, deren Zahlen sich schnell ändern. Der Moderator hat immer das
letzte Wort und kann Punkte korrigieren.

## 5. Anti-Cheat

Der Moderator schaltet es in den Regeln ein. Jeder Spieler bekommt dann eine Erklärung und muss
zustimmen. Wer ablehnt, schaut zu.

Während einer laufenden Runde sendet die App alle 2,5 Sekunden an den Server:

- die Titel der offenen Fenster und die Namen der Programme dazu,
- ob das Spielfenster im Vordergrund ist und welches Fenster stattdessen vorn liegt,
- die Anzahl der Bildschirme.

Nur der Moderator sieht das: live im Reiter „Anti-Cheat“ und als Protokoll, das sich als Datei
speichern lässt. Ereignisse während einer offenen Frage sind markiert. Bildschirminhalte,
Tastatureingaben und Dateien werden nicht übertragen. In der Lobby und nach dem Spiel wird nichts
gesendet. Der Server speichert das Protokoll nur im Arbeitsspeicher, bis die Lobby endet.

Grenzen: Ein Handy neben der Tastatur sieht niemand. Browser zeigen nur den Titel des aktiven
Tabs. Wer im Browser statt in der App spielt, wird nicht überwacht, das zeigt die Lobby an.
Es ist eine Abschreckung und eine Entscheidungshilfe für den Moderator, kein Beweis.

## 6. Technik in Kürze

- Der Server ist die einzige Wahrheit für Punkte, Buzzer und Zeiten. Die Antworten stehen nur
  beim Moderator und auf dem Server, nie bei den Spielern.
- Voice und Kamera: WebRTC direkt zwischen allen Teilnehmern. Bei vielen Spielern senkt die App
  Auflösung und Bildrate der Kamera automatisch. Bei 15 bis 20 Kameras braucht jeder eine
  ordentliche Leitung (etwa 2 Mbit/s Upload). Ton allein ist deutlich genügsamer.
- Tests: `cd server && npm test` prüft die Spiellogik. `node tools/e2e.cjs` spielt mit sechs
  Browsern eine Runde durch und legt Screenshots ab (braucht `npm install playwright`).

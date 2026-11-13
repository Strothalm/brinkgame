# Brinkgame: Was du jetzt tun musst

Stand: 2026-11-13. Diese Anleitung ist für den Fall, dass der Server schon einmal mit
`install-server.sh` eingerichtet wurde und du jetzt den neuen Stand haben willst (Handy-Layout,
Regel „Wer wählt, antwortet“, Schwierigkeit pro Paket, mehr Fragen).

Kurzfassung: **1. Server aktualisieren, 2. (für iPhone) HTTPS mit Domain, 3. neue Windows-App, 4. spielen.**

---

## Schritt 1: Server aktualisieren

Der Server hält die Spielregeln. Ohne diesen Schritt läuft auf dem Server noch der alte Stand.

1. **Neuen Stand holen.** Im Browser, bei GitHub eingeloggt:
   `https://github.com/Strothalm/brinkgame` öffnen, grüner Knopf **Code**, **Download ZIP**.
2. **ZIP auf den Server laden.** Mit WinSCP (Windows) oder `scp`. Zum Beispiel in den Ordner, in dem
   schon der alte Stand liegt.
3. **Über den alten Ordner entpacken**, nicht in einen neuen. So bleiben die Schlüssel und
   Einstellungen (Datei `deploy/.env`) erhalten.
   ```bash
   unzip -o brinkgame-main.zip
   cd brinkgame-main
   ```
   (Ordnername und ZIP-Name können bei dir anders heißen.)
4. **Skript noch einmal starten.** Es baut den Server neu und ändert nichts an deinen Einstellungen:
   ```bash
   sudo bash install-server.sh
   ```
   Das dauert einige Minuten. Am Ende steht die Verbindungsadresse in der Konsole und in `VERBINDUNG.txt`.
5. **Prüfen:** Im Browser `http://IP-DES-SERVERS:8787` öffnen. Die Startseite von Brinkgame muss erscheinen.

Noch nie installiert? Dann nur Schritt 1 bis 4 machen, es ist derselbe Ablauf.

---

## Schritt 2: Nur wenn iPhone oder iPad mitspielen sollen: HTTPS mit Domain

Safari erlaubt Mikrofon und Kamera nur über HTTPS. Ohne Domain geht Mitspielen, aber ohne Sprechen.

1. Bei deinem Domain-Anbieter einen **A-Eintrag** anlegen: Name zum Beispiel `brink`, Wert = IP des Servers.
2. Beim Server-Anbieter (Webpanel-Firewall) die Ports **80 und 443 (TCP)** freigeben.
3. Auf dem Server, im Brinkgame-Ordner:
   ```bash
   sudo bash install-server.sh --domain brink.deinedomain.de
   ```
4. Danach ist der Server unter `https://brink.deinedomain.de` erreichbar. In der Windows-App als Server
   die Domain eintragen.

Zurück zum Betrieb nur mit IP: `sudo bash install-server.sh --no-domain`

---

## Schritt 3: Neue Windows-App (Version 1.1.0)

Die neue App liegt auf GitHub im Branch **windows-exe**: Datei `Brinkgame-1.1.0-portable.exe`
(https://github.com/Strothalm/brinkgame/tree/windows-exe).

1. Die Datei anklicken, dann **Download** (oder **Raw**) wählen. Die Datei ist 87 MB groß.
2. Die alte App schließen und die neue starten. Windows warnt, weil die exe nicht signiert ist:
   **Weitere Informationen**, dann **Trotzdem ausführen**.
3. In der App den Server eintragen (IP oder Domain). Du brauchst nichts neu einzurichten.

Ob die Version stimmt, siehst du unten auf der Startseite (1.1.0). Die alte Datei `Brinkgame-1.0.0-portable.exe`
ist auf dem Branch nicht mehr enthalten.

---

## Schritt 4: Auf dem iPhone oder iPad

1. In **Safari** (nicht in Chrome) die Adresse `https://brink.deinedomain.de` öffnen.
2. Unten auf das **Teilen-Symbol** tippen, dann **Zum Home-Bildschirm**, dann **Hinzufügen**.
3. Brinkgame über das neue Symbol starten. Name eingeben, **Spielen**, Server **Verbinden**.
4. Mikrofon und Kamera **erlauben**. Einmal irgendwo tippen, damit der Ton startet.

Auf dem Handy gibt es kein Anti-Cheat. Quer halten geht, ist aber nicht geprüft. Hochformat ist besser.

---

## Schritt 5: Eine Runde spielen

1. **Moderator** (am PC): App starten, Server verbinden, **Lobby erstellen**. Der Code (5 Zeichen) oben ist
   für die anderen.
2. **Alle anderen:** Name eingeben, Server verbinden, Code eingeben, **Beitreten**. Wer nicht spielen will,
   tippt **Nur zuschauen**.
3. **Teams** sind freiwillig: Wer will, gründet ein Team oder tritt einem bei. Alle anderen spielen allein.
4. **Pakete** wählen. Pro Paket stellst du die **Schwierigkeit** ein: Leicht, Mittel, Schwer, auch zwei
   zusammen (zum Beispiel Leicht + Schwer, dann gibt es keine mittleren Fragen). „Gemischt“ nimmt alles.
5. Unter **Regeln**: „Wer antwortet?“ steht auf „Wer wählt, antwortet“. Die Reihenfolge wechselt reihum. Wenn
   ein Team falsch liegt, dürfen die anderen klauen.
6. **Spiel starten.** Der Moderator sagt per Sprache, ob richtig oder falsch, und klickt es an. Die Punkte
   werden automatisch vergeben.

Tasten für den Moderator: `B` Antwort oder Buzzer freigeben, `A` Antwort zeigen, `R` richtig, `F` falsch, `N` nächste Frage.
Die Belegung steht auch in der App.

---

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| App findet den Server nicht | Adresse prüfen. Ohne Domain: nur die IP. Port 8787 beim Anbieter freigeben. |
| Sprache oder Kamera gehen nicht | Ports 3478 (TCP und UDP) und 49160 bis 49400 (UDP) beim Anbieter freigeben. |
| iPhone: kein Mikrofon | Es braucht HTTPS (Schritt 2) und Safari. In den iPhone-Einstellungen unter Safari Mikrofon und Kamera auf „Fragen“ oder „Erlauben“ stellen. |
| Seite sieht noch alt aus | Auf dem iPhone die Home-Bildschirm-App schließen und neu öffnen. Am PC `Strg + F5`. |
| Server prüfen | Auf dem Server: `docker compose -f deploy/docker-compose.yml ps` und `docker compose -f deploy/docker-compose.yml logs brinkgame` |
| Alles zurücksetzen | `sudo bash install-server.sh --remove`, danach neu installieren. |

Mehr Technik steht in `README.md`.

#!/usr/bin/env bash
# Brinkgame-Server installieren: ohne Konfiguration, ein Befehl.
#
#   sudo bash install-server.sh
#
# Das Skript installiert Docker (falls es fehlt), erkennt die öffentliche IP-Adresse, erzeugt
# alle Schlüssel selbst, startet den Server und schreibt am Ende die Verbindungsdaten in die
# Konsole und in die Datei VERBINDUNG.txt.
#
# Optional:
#   --domain brink.example.de   HTTPS mit eigener Domain (nur nötig für Mikrofon im Browser)
#   --no-domain                 zurück zum Betrieb nur mit IP-Adresse
#   --password GEHEIM           Passwort, das jeder zum Verbinden braucht
#   --name "Mein Server"        Name in der Serverliste der App
#   --remove                    Server stoppen und entfernen (Einstellungen bleiben erhalten)
#
# Erneut ausführen ist ungefährlich: Einstellungen und Schlüssel bleiben erhalten. Zum
# Aktualisieren den neuen Quellcode über den alten entpacken und das Skript nochmal starten.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
ROOT="$(pwd)"
DEPLOY="$ROOT/deploy"
ENV_FILE="$DEPLOY/.env"
INFO_FILE="$ROOT/VERBINDUNG.txt"

DOMAIN_ARG=""
NO_DOMAIN=0
PASSWORD_ARG=""
NAME_ARG=""
ACTION="install"

say() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*" >&2; }
die() { printf '\nFEHLER: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) [ $# -ge 2 ] || die "--domain braucht einen Wert"; DOMAIN_ARG="$2"; shift 2 ;;
    --no-domain) NO_DOMAIN=1; shift ;;
    --password) [ $# -ge 2 ] || die "--password braucht einen Wert"; PASSWORD_ARG="$2"; shift 2 ;;
    --name) [ $# -ge 2 ] || die "--name braucht einen Wert"; NAME_ARG="$2"; shift 2 ;;
    --remove) ACTION="remove"; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "Unbekannte Option: $1 (Hilfe: --help)" ;;
  esac
done

# ---------- Voraussetzungen ----------

[ "$(uname -s)" = "Linux" ] || die "Dieses Skript läuft nur auf Linux-Servern."

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "$@"
  fi
  die "Bitte als root starten:  sudo bash install-server.sh"
fi

[ -f "$DEPLOY/docker-compose.yml" ] && [ -f "$ROOT/server/package.json" ] && [ -f "$ROOT/client/package.json" ] ||
  die "Das Skript muss im entpackten Brinkgame-Ordner liegen (dort, wo auch server/, client/ und deploy/ sind)."

if [ -n "$DOMAIN_ARG" ] && ! [[ "$DOMAIN_ARG" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; then
  die "Die Domain \"$DOMAIN_ARG\" sieht ungültig aus. Beispiel: brink.example.de"
fi
if [ -n "$PASSWORD_ARG" ] && ! [[ "$PASSWORD_ARG" =~ ^[A-Za-z0-9._@%+=:-]{1,40}$ ]]; then
  die "Das Passwort darf nur aus Buchstaben, Zahlen und . _ @ % + = : - bestehen (höchstens 40 Zeichen)."
fi
if [ -n "$NAME_ARG" ] && ! [[ "$NAME_ARG" =~ ^[A-Za-z0-9\ ._-]{1,40}$ ]]; then
  die "Der Name darf nur aus Buchstaben, Zahlen, Leerzeichen und . _ - bestehen (höchstens 40 Zeichen)."
fi

have() { command -v "$1" >/dev/null 2>&1; }

ensure_tool() {
  have "$1" && return 0
  if have apt-get; then
    apt-get update -qq >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${2:-$1}" >/dev/null 2>&1 || true
  elif have dnf; then dnf install -y -q "${2:-$1}" >/dev/null 2>&1 || true
  elif have yum; then yum install -y -q "${2:-$1}" >/dev/null 2>&1 || true
  fi
  have "$1" || die "\"$1\" fehlt und ließ sich nicht installieren. Bitte von Hand installieren und das Skript neu starten."
}

# ---------- Docker ----------

install_docker() {
  if have docker; then return 0; fi
  say "Docker wird installiert (das dauert ein bis zwei Minuten) ..."
  ensure_tool curl
  curl -fsSL https://get.docker.com | sh || die "Die Docker-Installation ist fehlgeschlagen."
  systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then DC="docker compose"
  elif have docker-compose; then DC="docker-compose"
  else die "Docker Compose fehlt. Auf Ubuntu/Debian: apt-get install -y docker-compose-plugin"
  fi
}

if [ "$ACTION" = "remove" ]; then
  have docker || die "Docker ist nicht installiert, es gibt nichts zu entfernen."
  compose_cmd
  say "Brinkgame wird gestoppt und entfernt ..."
  (cd "$DEPLOY" && $DC --profile https down --remove-orphans) || die "Das Stoppen hat nicht geklappt."
  note "Fertig. Einstellungen bleiben in deploy/.env. Zum Neustart: sudo bash install-server.sh"
  exit 0
fi

ensure_tool curl
install_docker
if ! docker info >/dev/null 2>&1; then
  systemctl start docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
  sleep 3
fi
docker info >/dev/null 2>&1 || die "Docker läuft nicht. Bitte prüfen: systemctl status docker"
compose_cmd

# ---------- Einstellungen ----------

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }
del_env() { local t; t="$(mktemp)"; grep -vE "^$1=" "$ENV_FILE" >"$t" || true; cat "$t" >"$ENV_FILE"; rm -f "$t"; }
set_env() { del_env "$1"; printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"; }

detect_ip() {
  local url ip
  for url in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
    ip="$(curl -4 -fsS --max-time 6 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then printf '%s' "$ip"; return 0; fi
  done
  return 1
}

say "Öffentliche IP-Adresse wird ermittelt ..."
if ! PUBLIC_IP="$(detect_ip)"; then
  PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$PUBLIC_IP" ] || die "Die IP-Adresse konnte nicht ermittelt werden. Hat der Server Internet?"
  warn "Die öffentliche IP ließ sich nicht abfragen. Benutzt wird die lokale Adresse $PUBLIC_IP."
fi
note "IP-Adresse: $PUBLIC_IP"
if [[ "$PUBLIC_IP" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.) ]]; then
  warn "$PUBLIC_IP ist eine private Adresse. Der Server steht hinter einem Router. Ports müssen dort weitergeleitet werden, und Spieler von außen brauchen die öffentliche IP."
fi

set_env PUBLIC_IP "$PUBLIC_IP"

if [ -z "$(get_env TURN_SECRET)" ]; then
  say "Schlüssel für Sprache und Kamera werden erzeugt ..."
  if have openssl; then set_env TURN_SECRET "$(openssl rand -hex 32)"
  else set_env TURN_SECRET "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
fi

[ -n "$NAME_ARG" ] && set_env SERVER_NAME "$NAME_ARG"
[ -n "$(get_env SERVER_NAME)" ] || set_env SERVER_NAME "Brinkgame Server"
[ -n "$PASSWORD_ARG" ] && set_env SERVER_PASSWORD "$PASSWORD_ARG"
[ -n "$(get_env MAX_LOBBIES)" ] || set_env MAX_LOBBIES 50

if [ "$NO_DOMAIN" -eq 1 ]; then
  del_env DOMAIN
  del_env HTTP_BIND
elif [ -n "$DOMAIN_ARG" ]; then
  set_env DOMAIN "$DOMAIN_ARG"
fi
DOMAIN="$(get_env DOMAIN)"
PASSWORD="$(get_env SERVER_PASSWORD)"
SERVER_NAME="$(get_env SERVER_NAME)"

PROFILE_ARGS=()
if [ -n "$DOMAIN" ]; then
  set_env HTTP_BIND 127.0.0.1
  PROFILE_ARGS=(--profile https)
  RESOLVED="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "$RESOLVED" ]; then
    warn "Die Domain $DOMAIN zeigt noch auf keine Adresse. Lege bei deinem Domain-Anbieter einen A-Eintrag auf $PUBLIC_IP an. Ohne ihn bekommt Caddy kein Zertifikat."
  elif [ "$RESOLVED" != "$PUBLIC_IP" ]; then
    warn "Die Domain $DOMAIN zeigt auf $RESOLVED, dieser Server hat aber $PUBLIC_IP. Ohne passenden A-Eintrag bekommt Caddy kein Zertifikat."
  fi
else
  del_env HTTP_BIND
fi

# ---------- Firewall auf dem Server ----------

if [ -n "$DOMAIN" ]; then WEB_PORTS="80 443"; else WEB_PORTS="8787"; fi

open_firewall() {
  if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    say "Firewall (ufw): Ports werden geöffnet ..."
    for p in $WEB_PORTS 3478; do ufw allow "$p/tcp" >/dev/null; done
    ufw allow 3478/udp >/dev/null
    ufw allow 49160:49400/udp >/dev/null
    note "ufw: Ports geöffnet."
  elif have firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
    say "Firewall (firewalld): Ports werden geöffnet ..."
    for p in $WEB_PORTS 3478; do firewall-cmd --permanent --add-port="$p/tcp" >/dev/null; done
    firewall-cmd --permanent --add-port=3478/udp >/dev/null
    firewall-cmd --permanent --add-port=49160-49400/udp >/dev/null
    firewall-cmd --reload >/dev/null
    note "firewalld: Ports geöffnet."
  else
    note "Keine aktive Server-Firewall gefunden. Es wurde nichts verändert."
  fi
}
open_firewall

# ---------- Starten ----------

for p in $WEB_PORTS; do
  if have ss && ss -ltnH "sport = :$p" 2>/dev/null | grep -q . && [ -z "$(cd "$DEPLOY" && $DC ps -q brinkgame 2>/dev/null || true)" ]; then
    warn "Port $p wird schon von einem anderen Programm benutzt. Brinkgame kann so nicht starten. Stoppe das andere Programm oder melde dich."
  fi
done

say "Brinkgame wird gebaut und gestartet (beim ersten Mal 3 bis 8 Minuten) ..."
(cd "$DEPLOY" && $DC ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} up -d --build) || die "Der Start ist fehlgeschlagen. Details oben."

say "Warte, bis der Server antwortet ..."
READY=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 3 http://127.0.0.1:8787/health >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done
if [ "$READY" -ne 1 ]; then
  (cd "$DEPLOY" && $DC ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} logs --tail 40 brinkgame) || true
  die "Der Server antwortet nicht. Das Protokoll steht oben. Erneut versuchen: sudo bash install-server.sh"
fi

# ---------- Verbindungsdaten ----------

if [ -n "$DOMAIN" ]; then
  APP_ADDR="$DOMAIN"
  BROWSER_URL="https://$DOMAIN"
  BROWSER_NOTE="Mikrofon und Kamera gehen auch im Browser."
else
  APP_ADDR="$PUBLIC_IP"
  BROWSER_URL="http://$PUBLIC_IP:8787"
  BROWSER_NOTE="Dort gehen Mikrofon und Kamera nicht (dafür braucht es eine Domain mit HTTPS)."
fi
PASS_TEXT="${PASSWORD:-keins (jeder mit der Adresse kann verbinden)}"

{
  echo "=============================================================="
  echo "  BRINKGAME-SERVER LÄUFT"
  echo "=============================================================="
  echo
  echo "  In der Windows-App: Spielen > Server hinzufügen"
  echo
  echo "      Adresse:    $APP_ADDR"
  echo "      Passwort:   $PASS_TEXT"
  echo "      Name:       $SERVER_NAME (frei wählbar)"
  echo
  echo "  Im Browser (z. B. iPad):"
  echo
  echo "      $BROWSER_URL"
  echo "      $BROWSER_NOTE"
  echo
  echo "  Wenn sich niemand verbinden kann, die Firewall beim Anbieter prüfen."
  echo "  Diese Ports müssen offen sein:"
  echo
  for p in $WEB_PORTS; do printf "      %-13s TCP\n" "$p"; done
  echo "      3478          TCP und UDP"
  echo "      49160-49400   UDP"
  echo
  echo "  Verwalten (im Ordner deploy/):"
  echo
  echo "      Protokoll ansehen    docker compose${PROFILE_ARGS[*]:+ ${PROFILE_ARGS[*]}} logs -f brinkgame"
  echo "      Neu starten          docker compose${PROFILE_ARGS[*]:+ ${PROFILE_ARGS[*]}} restart"
  echo "      Server entfernen     sudo bash install-server.sh --remove"
  echo "      Passwort setzen      sudo bash install-server.sh --password GEHEIM"
  echo "=============================================================="
} | tee "$INFO_FILE"

printf '\n(Diese Angaben stehen auch in %s)\n' "$INFO_FILE"

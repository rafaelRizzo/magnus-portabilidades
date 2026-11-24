#!/usr/bin/env bash
# Roda na VPS como root: puxa o código, reinstala deps e reinicia só o que mudou. Uso: deploy/update.sh
# Pré-requisitos (uma vez):
#   install -m755 /root/.bun/bin/bun /usr/local/bin/bun
#   useradd --system --no-create-home --shell /usr/sbin/nologin portab
#   chown root:root /opt/magnus-portabilidades/.env && chmod 600 /opt/magnus-portabilidades/.env
# Primeira subida: acompanhe com `journalctl -u magnus-portabilidades -f`.
set -euo pipefail

APP=/opt/magnus-portabilidades
SVC=magnus-portabilidades
UNIT=/etc/systemd/system/$SVC.service

[ "$(id -u)" -eq 0 ] || { echo "Rode como root." >&2; exit 1; }
cd "$APP"

old=$(git rev-parse HEAD)
git pull --ff-only
new=$(git rev-parse HEAD)

changed() { [ "$old" != "$new" ] && git diff --name-only "$old" "$new" -- "$@" | grep -q .; }

# Sem mudança no código e serviço rodando: não reinicia, pois o buffer de 30 min vive na memória
if [ "$old" = "$new" ] && systemctl is-active --quiet "$SVC"; then
    echo "Já está na versão $(git rev-parse --short HEAD) e o serviço está ativo. Nada a fazer."
    exit 0
fi

[ "$old" = "$new" ] || git --no-pager log --oneline "$old..$new"

if changed package.json bun.lock; then
    echo "Dependências mudaram: bun install."
    bun install --production --frozen-lockfile
fi

if ! cmp -s deploy/$SVC.service "$UNIT"; then
    echo "Unit mudou: atualizando e recarregando o systemd."
    install -m644 deploy/$SVC.service "$UNIT"
    systemctl daemon-reload
fi

systemctl restart "$SVC"
sleep 3

if systemctl is-active --quiet "$SVC"; then
    echo "OK: $SVC ativo na versão $(git rev-parse --short HEAD)."
    journalctl -u "$SVC" -n 5 --no-pager
else
    echo "FALHA: $SVC não subiu. Últimos logs:" >&2
    journalctl -u "$SVC" -n 30 --no-pager >&2
    exit 1
fi

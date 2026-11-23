#!/usr/bin/env bash
# Roda na VPS: git pull, atualiza o .service e reinicia o serviço. Uso: deploy/update.sh
# Se o package.json mudou, rode antes: bun install --production
set -euo pipefail

cd /opt/magnus-portabilidades
git pull --ff-only
cp deploy/magnus-portabilidades.service /etc/systemd/system/
systemctl daemon-reload
systemctl restart magnus-portabilidades
systemctl is-active magnus-portabilidades

<div align="center">

# magnus-portabilidades

**Saiba na hora se um número em portabilidade já chegou na sua plataforma.**
Um bot de Discord que escuta o SIP do MagnusBilling e responde de onde veio a ligação, de quem é o número e para onde ele vai.

![Bun](https://img.shields.io/badge/Bun-1.4-000000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Discord.js](https://img.shields.io/badge/discord.js-14-5865F2?logo=discord&logoColor=white)
![Asterisk](https://img.shields.io/badge/Asterisk-13%20(chan__sip)-F68F20)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## O problema

Durante uma portabilidade, alguém precisa ficar conferindo se o número já está conosco. Um número que ainda não foi cadastrado como DID **nunca chega ao dialplan** do Asterisk: o `chan_sip` responde `401` e descarta o pedido, sem CDR e sem log com o número.

## A solução

Você liga de um celular para o número e digita `/numero` no Discord. O bot lê os INVITEs SIP direto da porta 5060 e responde:

```
Número 1133334444 está conosco
Ligação: 11999990001 → 1133334444
Tronco: TRUNK-EXEMPLO (192.0.2.50)
Cliente: 10001 (EMPRESA EXEMPLO)
Destino: Conta SIP 551133334444CONTA
Hora: 08:36:36 (há 2 minutos)
Call-ID: 4f1c...@UAC
```

A barra lateral da resposta muda de cor conforme o estado do DID no Magnus:

| Cor | Significa |
|---|---|
| Verde | DID ativo e com destino |
| Laranja | DID sem destino, ou ainda não cadastrado no Magnus |
| Vermelho | DID desativado |

## Como funciona

```mermaid
flowchart LR
    A[Celular] -->|INVITE| B[Operadora]
    B -->|UDP 5060| C[Servidor Magnus]
    C -.->|tcpdump| D[Coletor]
    E[sip show peers] -->|IPs das operadoras| D
    D -->|janela de 30 min| F[Buffer em memória]
    G[Discord /numero] --> F
    F --> H[Resposta no Discord]
    I[(MySQL do Magnus)] -->|cliente e destino| H
```

1. O **coletor** roda `tcpdump` só para INVITEs UDP que chegam ao servidor e extrai número chamado, quem ligou, IP de origem e `Call-ID`.
2. Só contam INVITEs vindos de **IP de operadora**. A lista vem do `asterisk -rx "sip show peers"` e é relida a cada 60 segundos, então um trunk novo ou com IP novo entra sozinho.
3. O número é comparado por **DDD + últimos 8 dígitos**, o que cobre `55`, `+`, `0` inicial e o 9º dígito.
4. Os INVITEs ficam num **buffer em memória** por 30 minutos. Sem banco e sem Redis.
5. `/numero` olha o buffer. Se não achar nada, **espera até 2 minutos** por uma ligação nova e edita a mesma mensagem.
6. Com `MAGNUS_DB_URL`, a resposta ganha **cliente** e **destino** lidos do MySQL do Magnus, somente leitura.

### Tipos de destino

| `voip_call` | Aparece como |
|---|---|
| 0 | `Telefone 01133334444` |
| 1 | `Conta SIP <nome em pkg_sip>` |
| 2 | `URA #16` |
| 7 | `Fila #31` |
| 10 | `Contexto: SIP/111` (alvos do `Dial`), ou a aplicação do dialplan |
| 11 | `IP pbx.exemplo.com` |
| outro | `tipo N` |

## Requisitos

- Servidor com **MagnusBilling** e **Asterisk 13 com `chan_sip`** (testado), acesso root.
- [Bun](https://bun.sh) instalado em `/usr/local/bin/bun`.
- `tcpdump` instalado.
- Um bot no [Discord Developer Portal](https://discord.com/developers/applications).

## Configuração

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SERVER_IP` | sim | IP do servidor Magnus, destino dos INVITEs na porta 5060 |
| `API_TOKEN` | sim | Token Bearer da API local, mínimo 16 caracteres (`openssl rand -hex 32`) |
| `API_PORT` | não | Porta da API local, padrão `3100` |
| `DISCORD_TOKEN` | sim | Token do bot |
| `DISCORD_GUILD_ID` | sim | ID do servidor do Discord onde o comando é registrado |
| `ALLOWED_ROLE_ID` | não | Se preenchido, só esse cargo usa o comando |
| `ALLOWED_CHANNEL_ID` | não | Se preenchido, o comando só funciona nesse canal |
| `MAGNUS_DB_URL` | não | `mysql://usuario:senha@127.0.0.1:3306/mbilling`, ativa cliente e destino |

### Discord

1. No Developer Portal, crie a aplicação e o bot, e copie o token para `DISCORD_TOKEN`.
2. Convide o bot com os escopos `bot` e `applications.commands`, senão o `/numero` não aparece.
3. Preencha `DISCORD_GUILD_ID`. O bot só atende nesse servidor: em qualquer outro responde "não autorizado", e na subida ele apaga o `/numero` antigo dos outros servidores e do escopo global. Para tirar o bot de vez de um servidor, expulse-o de lá. Para impedir convites novos, desmarque **Public Bot** no Developer Portal.

### Usuário somente leitura no Magnus

```bash
SENHA=$(openssl rand -hex 16); echo "$SENHA"
mysql -uroot -p -e "CREATE USER 'portab'@'localhost' IDENTIFIED BY '$SENHA';
GRANT SELECT ON mbilling.pkg_did TO 'portab'@'localhost';
GRANT SELECT ON mbilling.pkg_did_destination TO 'portab'@'localhost';
GRANT SELECT ON mbilling.pkg_user TO 'portab'@'localhost';
GRANT SELECT ON mbilling.pkg_sip TO 'portab'@'localhost';"
```

Se a consulta falhar, a resposta mostra `Magnus: consulta falhou` e o erro SQL está no `journalctl`. Tabela nova na consulta exige `GRANT` novo.

## Uso

```
/numero 551133334444
```

Aceita o número com ou sem `55`. Também há uma API local, só em `127.0.0.1`:

```bash
curl -H "Authorization: Bearer $API_TOKEN" "http://127.0.0.1:3100/numero/551133334444?wait=0"
```

`wait` é em segundos, de 0 a 120.

## Deploy

### Primeira vez

1. No Mac, envie o código (troque `SERVIDOR` pelo IP ou host da VPS):

```bash
rsync -av --exclude node_modules --exclude .git ./ root@SERVIDOR:/opt/magnus-portabilidades/
```

2. Na VPS, instale o bun:

```bash
apt-get update && apt-get install -y curl unzip
curl -fsSL https://bun.sh/install | bash
install -m755 /root/.bun/bin/bun /usr/local/bin/bun
```

3. Instale as dependências e configure o `.env`:

```bash
cd /opt/magnus-portabilidades
bun install --production
cp .env.example .env && nano .env
chown root:root .env && chmod 600 .env
useradd --system --no-create-home --shell /usr/sbin/nologin portab
```

4. Teste em primeiro plano (veja "Rodar manualmente") e pare com Ctrl+C.

5. Instale e inicie o serviço:

```bash
cp deploy/magnus-portabilidades.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now magnus-portabilidades
journalctl -u magnus-portabilidades -f
```

O serviço roda como o usuário `portab`, sem root: a captura raw vem das capabilities `CAP_NET_RAW` e `CAP_NET_ADMIN`, e o `asterisk -rx` usa o socket do Asterisk pelo grupo `asterisk` (confira com `ls -l /var/run/asterisk/asterisk.ctl` que o grupo tem acesso). O `.env` fica `root:root 600`, pois o systemd o lê como root. Na subida ele lê `sip show peers`: se esse comando falhar, o serviço encerra e o systemd tenta de novo.

### Atualizar

```bash
# no Mac
rsync -av --exclude node_modules --exclude .git ./ root@SERVIDOR:/opt/magnus-portabilidades/
# na VPS (o bun install só é necessário se o package.json mudou)
cd /opt/magnus-portabilidades && bun install --production
systemctl restart magnus-portabilidades
```

O `rsync` não sobrescreve o `.env` do servidor, porque ele não existe na pasta do projeto. Se criar um `.env` local, adicione `--exclude .env`.

### Operar o serviço

```bash
systemctl status magnus-portabilidades          # está rodando?
systemctl stop magnus-portabilidades            # parar
systemctl start magnus-portabilidades           # iniciar
systemctl restart magnus-portabilidades         # reiniciar (obrigatório depois de mudar o .env)
systemctl disable --now magnus-portabilidades   # parar e não iniciar mais no boot
journalctl -u magnus-portabilidades -f          # logs ao vivo (Ctrl+C sai)
journalctl -u magnus-portabilidades --since "15 min ago" --no-pager
```

O serviço reinicia sozinho em 5 segundos se cair e sobe junto com o servidor depois do `enable`.

### Rodar manualmente

Pare o serviço antes, para não haver duas cópias capturando e respondendo no Discord:

```bash
systemctl stop magnus-portabilidades
cd /opt/magnus-portabilidades
set -a; . ./.env; set +a
bun src/index.ts                        # logs na tela, Ctrl+C para parar
systemctl start magnus-portabilidades   # volta ao serviço
```

Sem o systemd: `nohup bun src/index.ts > /tmp/portab.log 2>&1 &`, acompanhe com `tail -f /tmp/portab.log` e pare com `pkill -f "bun src/index.ts"`.

## Limitações conhecidas

- Captura só **UDP**. SIP sobre TCP ou TLS não é visto.
- Testado com **Asterisk 13 e `chan_sip`**. Outro stack SIP pode mudar o formato lido.
- **Ramal com IP fixo** também aparece no `sip show peers` e entra na lista de operadoras. Ramal dinâmico é ignorado.
- O estado fica **só em memória**: reiniciar o serviço apaga a janela de 30 minutos.
- O nome dos tipos de destino (`voip_call`) segue a tela do Magnus. Tipos que não aparecem na instalação (3, 4, 5, 6, 8 e 9) mostram `tipo N`.

## Estrutura

```
src/
  index.ts      liga coletor, buffer, API e bot
  tcpdump.ts    captura de INVITEs
  parse.ts      lê a saída do tcpdump
  ingest.ts     filtro de operadora + chave do número + buffer
  carriers.ts   operadoras lidas do `sip show peers`
  number.ts     chave DDD + últimos 8 dígitos
  buffer.ts     janela em memória e espera por INVITE novo
  magnus.ts     cliente e destino no MySQL do Magnus
  format.ts     texto e cor da resposta
  bot.ts        comando /numero
  server.ts     API HTTP local
deploy/         unit do systemd
docs/adr/       decisões de arquitetura
CONTEXT.md      glossário do domínio
```

## Desenvolvimento

```bash
bun install
bun test
bun run typecheck
bun run lint
```

O glossário do domínio está em [`CONTEXT.md`](CONTEXT.md) e a decisão de capturar pacotes em vez de usar o dialplan está em [`docs/adr/0001-detect-invites-by-packet-capture.md`](docs/adr/0001-detect-invites-by-packet-capture.md).

## Licença

[MIT](LICENSE)

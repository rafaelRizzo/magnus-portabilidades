// Monta o texto da resposta do bot: ligação, tronco, cliente e destino no Magnus.
import type { InviteEvent } from "./buffer"
import type { DidInfo, SipAccount } from "./magnus"

// Cores do embed em RGB (o Discord não aceita oklch): oklch(63.7% 0.237 25.331), (70.5% 0.213 47.604), (69.6% 0.17 162.48)
const COLORS = { red: 0xfb2c36, orange: 0xff6900, green: 0x00bc7d }

// Vermelho: DID desativado. Laranja: sem destino, conta SIP sem callerid ou DID fora do Magnus. Verde: tudo certo ou Magnus indisponível.
export const inviteColor = (did: DidInfo | null | undefined) => {
    if (did && !did.activated) return COLORS.red
    if (
        did === null ||
        (did &&
            (did.destinations.length === 0 ||
                did.sipAccounts.some((a) => !a.callerid)))
    ) {
        return COLORS.orange
    }
    return COLORS.green
}

// Campos do pacote SIP e do Magnus (clientes editam o próprio nome) são não confiáveis:
// uma linha só (sem quebra para forjar título ou subtexto), markdown escapado e tamanho limitado
const escapeMarkdown = (text: string, max = 64) =>
    text
        .replace(/\s+/g, " ")
        .slice(0, max)
        .replace(/[\\*_~`|>[\]()<@:#]/g, "\\$&")

// Uma linha por campo: rótulo em negrito e valor
const row = (label: string, value: string) => `**${label}:** ${value}`

// did: undefined = Magnus indisponível, null = DID não cadastrado, objeto = cadastrado
export const describeInvite = (
    event: InviteEvent,
    trunks: string[] | undefined,
    did: DidInfo | null | undefined,
) => {
    const lines = [
        row(
            "Ligação",
            `${escapeMarkdown(event.from)} → ${escapeMarkdown(event.called)}`,
        ),
        row(
            "Tronco",
            `${trunks?.map((t) => escapeMarkdown(t)).join(", ") ?? "desconhecido"} (${escapeMarkdown(event.srcIp)})`,
        ),
    ]

    if (did === null) {
        lines.push(row("Cliente", "DID ainda não cadastrado no Magnus"))
    } else if (did) {
        lines.push(
            row(
                "Cliente",
                did.owner ? escapeMarkdown(did.owner, 128) : "DID sem cliente",
            ),
        )
        if (did.dist) lines.push(row("Dist", escapeMarkdown(did.dist, 100)))
        if (did.userStatus)
            lines.push(row("Status", escapeMarkdown(did.userStatus)))
        lines.push(
            row(
                "Destino",
                did.destinations.length
                    ? did.destinations
                          .map((d) => escapeMarkdown(d, 128))
                          .join(", ")
                    : "sem destino configurado",
            ),
        )
        if (!did.activated)
            lines.push(row("Atenção", "DID desativado no Magnus"))
    }

    return lines.join("\n")
}

// Rodapé em subtexto: Call-ID e hora relativa
export const describeFooter = (event: InviteEvent) => {
    const ts = Math.floor(event.at / 1000)
    return `-# Call-ID \`${event.callId.slice(0, 128).replaceAll("`", "")}\` · <t:${ts}:T> (<t:${ts}:R>)`
}

// A senha nunca vai para o canal: só o usuário, e a senha sai pelo botão em resposta efêmera
export const describeLogin = (account: SipAccount) => {
    const user = account.username
        .replace(/\s+/g, " ")
        .slice(0, 64)
        .replaceAll("`", "")
    const cid = account.callerid
        ? `-# Callerid ${escapeMarkdown(account.callerid)}`
        : "**Sem callerid na conta SIP**"
    return `**Usuário**\n\`\`\`\n${user}\n\`\`\`\n**Senha**\n\`\`\`\nOculta. Use o botão Copiar dados.\n\`\`\`\n${cid}`
}

// Texto para colar no softphone: uma linha por dado. Vai só na resposta efêmera, nunca no canal.
export const describeCredentials = (
    did: DidInfo,
    account: SipAccount,
    host: string,
) =>
    [
        `Dados da linha: ${did.did}`,
        `Usuário: ${account.username}`,
        `Senha: ${account.secret}`,
        `Host: ${host}`,
    ].join("\n")

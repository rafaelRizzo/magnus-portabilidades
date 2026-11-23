// Monta o texto da resposta do bot: ligação, tronco, cliente e destino no Magnus.
import type { InviteEvent } from "./buffer"
import type { DidInfo } from "./magnus"

// Cores do embed em RGB (o Discord não aceita oklch): oklch(63.7% 0.237 25.331), (70.5% 0.213 47.604), (69.6% 0.17 162.48)
const COLORS = { red: 0xfb2c36, orange: 0xff6900, green: 0x00bc7d }

// Vermelho: DID desativado. Laranja: sem destino ou DID fora do Magnus. Verde: tudo certo ou Magnus indisponível.
export const inviteColor = (did: DidInfo | null | undefined) => {
    if (did && !did.activated) return COLORS.red
    if (did === null || (did && did.destinations.length === 0)) {
        return COLORS.orange
    }
    return COLORS.green
}

// Campos vindos do pacote SIP são não confiáveis: escapa markdown e limita o tamanho
const escapeMarkdown = (text: string) =>
    text.slice(0, 64).replace(/[\\*_~`|>[\]()<@:#]/g, "\\$&")

// did: undefined = Magnus indisponível, null = DID não cadastrado, objeto = cadastrado
export const describeInvite = (
    event: InviteEvent,
    trunks: string[] | undefined,
    did: DidInfo | null | undefined,
) => {
    const ts = Math.floor(event.at / 1000)
    const lines = [
        `**Ligação:** ${escapeMarkdown(event.from)} → ${escapeMarkdown(event.called)}`,
        `**Tronco:** ${trunks?.join(", ") ?? "desconhecido"} (${event.srcIp})`,
    ]

    if (did === null) {
        lines.push("**Cliente:** DID ainda não cadastrado no Magnus")
    } else if (did) {
        lines.push(`**Cliente:** ${did.owner ?? "DID sem cliente"}`)
        lines.push(
            `**Destino:** ${did.destinations.length ? did.destinations.join(", ") : "sem destino configurado"}`,
        )
        if (!did.activated) lines.push("**Atenção:** DID desativado no Magnus")
    }

    lines.push(`**Hora:** <t:${ts}:T> (<t:${ts}:R>)`)
    lines.push(
        `**Call-ID:** \`${event.callId.slice(0, 128).replaceAll("`", "")}\``,
    )
    return lines.join("\n")
}

// Consulta somente leitura no MySQL do Magnus: dono e destinos de um DID.
// shortcut: busca o DID por sufixo (LIKE) e confere em JS, pois o Magnus guarda o número em formatos variados.
import { SQL } from "bun"
import { numberKey } from "./number"

export type SipAccount = {
    username: string
    secret: string
    callerid: string
}

export type DidInfo = {
    did: string
    activated: boolean
    owner: string | null
    destinations: string[]
    sipAccounts: SipAccount[]
}

// null = DID não cadastrado no Magnus. Erro de banco propaga e quem chama trata.
export type MagnusLookup = (key: string) => Promise<DidInfo | null>

type DestinationRow = {
    voip_call: number | null
    destination: string | null
    context: string | null
    id_sip: number | null
    id_ivr: number | null
    id_queue: number | null
    sip_name?: string | null
    defaultuser?: string | null
    secret?: string | null
    callerid?: string | null
}

const DIAL_TARGET = /\b(?:SIP|PJSIP|IAX2?|DAHDI|Local)\/[^/&,)\s$]+/g
const EXTEN_APP = /^\s*exten\s*=>\s*[^,]+,\s*\d+\s*,\s*(.+?)\s*$/m

// Alvos do Dial, senão a aplicação da primeira linha do dialplan, senão o começo do texto
const describeContext = (context: string | null) => {
    if (!context) return ""
    const targets = [...new Set(context.match(DIAL_TARGET))]
    if (targets.length) return targets.join(" + ")
    return EXTEN_APP.exec(context)?.[1] ?? context.trim().slice(0, 60)
}

// Tipo do destino pela coluna `voip_call`. Cada tipo guarda o alvo em um campo diferente:
// o `context` e a `destination` de um tipo podem ser lixo de outro, então só se lê o campo do tipo.
// shortcut: tipos 3, 4, 5, 6, 8 e 9 não aparecem neste Magnus e caem em `tipo N`, mapear quando surgirem.
export const describeDestination = (row: DestinationRow) => {
    const dest = row.destination?.trim() ?? ""
    switch (Number(row.voip_call)) {
        case 0:
            return dest ? `Telefone ${dest}` : "Telefone"
        case 1:
            return `Conta SIP ${row.sip_name ?? `#${row.id_sip}`}`
        case 2:
            return `URA #${row.id_ivr}`
        case 7:
            return `Fila #${row.id_queue}`
        case 10: {
            const context = describeContext(row.context) || "vazio"
            return dest
                ? `Contexto: ${context} (${dest})`
                : `Contexto: ${context}`
        }
        case 11:
            return dest ? `IP ${dest}` : "IP"
        default:
            return [`tipo ${row.voip_call}`, dest].filter(Boolean).join(" ")
    }
}

type OwnerRow = {
    username: string | null
    firstname: string | null
    lastname: string | null
    company_name: string | null
}

// Nome igual em nome e sobrenome (comum em empresa) não é repetido
export const describeOwner = (row: OwnerRow) => {
    if (!row.username) return null
    const person = [
        ...new Set([row.firstname, row.lastname].filter(Boolean)),
    ].join(" ")
    const name = person || row.company_name
    return name ? `${row.username} (${name})` : row.username
}

const isSipAccount = (row: DestinationRow) =>
    Number(row.voip_call) === 1 && !!row.defaultuser

export const toSipAccount = (row: DestinationRow): SipAccount => ({
    username: row.defaultuser ?? "",
    secret: row.secret ?? "",
    callerid: row.callerid?.trim() ?? "",
})

export const createMagnus = (url: string): MagnusLookup => {
    const sql = new SQL(url)

    return async (key) => {
        const rows = await sql`
            SELECT d.id, d.did, d.activated, u.username, u.firstname, u.lastname, u.company_name
            FROM pkg_did d
            LEFT JOIN pkg_user u ON u.id = d.id_user
            WHERE d.did LIKE ${`%${key.slice(-8)}`}`
        const row = rows.find(
            (r: { did: string }) => numberKey(String(r.did)) === key,
        )
        if (!row) return null

        const destinations: DestinationRow[] = await sql`
            SELECT dd.voip_call, dd.destination, dd.context, dd.id_sip, dd.id_ivr, dd.id_queue, s.name AS sip_name, s.defaultuser, s.secret, s.callerid
            FROM pkg_did_destination dd
            LEFT JOIN pkg_sip s ON s.id = dd.id_sip
            WHERE dd.id_did = ${row.id} AND dd.activated = 1
            ORDER BY dd.priority`

        return {
            did: String(row.did),
            activated: Number(row.activated) === 1,
            owner: describeOwner(row),
            destinations: destinations.map(describeDestination).filter(Boolean),
            sipAccounts: destinations.filter(isSipAccount).map(toSipAccount),
        }
    }
}

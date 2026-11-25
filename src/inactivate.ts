// Única escrita do projeto no MySQL do Magnus: inativar um DID.
// Só desce: libera, desreserva e inativa. Nenhum SQL daqui ativa ou reserva, e tudo age por id, nunca por número.
import { SQL } from "bun"
import {
    type DestinationRow,
    describeDestination,
    describeOwner,
} from "./magnus"
import { numberKey } from "./number"

type Row = Record<string, unknown>
type Result = Row[] & { affectedRows: number }
export type Query = (
    strings: TemplateStringsArray,
    ...values: unknown[]
) => Promise<Result>
export type Db = Query & {
    begin: <T>(fn: (tx: Query) => Promise<T>) => Promise<T>
}

export type Target = {
    id: number
    did: string
    userId: number | null
    owner: string | null
    username: string | null
    activated: boolean
    reserved: boolean
    destinations: string[]
}

export type Preview =
    | { kind: "none" }
    | { kind: "many"; dids: string[] }
    | { kind: "done"; target: Target }
    | { kind: "ready"; target: Target }

// Erro com texto seguro para mostrar ao usuário: qualquer outro erro vira mensagem genérica
export class InactivationError extends Error {}

const MIN_DIGITS = 10
const MAX_DIGITS = 14

// Só 0-9, de 10 a 14 dígitos. Roda no texto bruto, antes do numberKey, que descarta o que não é dígito
// e deixaria "5511%" ou "1' OR 1=1" passar como se fosse número limpo.
export const parseDidInput = (raw: string) => {
    if (raw.length < MIN_DIGITS || raw.length > MAX_DIGITS) return null
    for (const char of raw) if (char < "0" || char > "9") return null
    const key = numberKey(raw)
    return key ? { digits: raw, key } : null
}

// Motivo digitado por quem inativa: uma linha só, de 3 a 200 caracteres. Vai ao histórico do Magnus junto de quem executou.
export const cleanReason = (raw: string) => {
    const reason = raw.replace(/\s+/g, " ").trim()
    return reason.length >= 3 && reason.length <= 200 ? reason : null
}

const toId = (value: unknown) => (value == null ? null : Number(value))

const loadTarget = async (q: Query, row: Row): Promise<Target> => {
    const id = Number(row.id)
    const userId = toId(row.id_user)
    const user =
        userId === null
            ? undefined
            : (
                  await q`
                    SELECT username, firstname, lastname, company_name
                    FROM pkg_user WHERE id = ${userId}`
              )[0]
    const destinations = await q`
        SELECT dd.voip_call, dd.destination, dd.context, dd.id_sip, dd.id_ivr, dd.id_queue, s.name AS sip_name
        FROM pkg_did_destination dd
        LEFT JOIN pkg_sip s ON s.id = dd.id_sip
        WHERE dd.id_did = ${id}
        ORDER BY dd.priority`
    return {
        id,
        did: String(row.did).trim(),
        userId,
        owner: user
            ? describeOwner(user as Parameters<typeof describeOwner>[0])
            : null,
        username: user?.username ? String(user.username) : null,
        activated: Number(row.activated) === 1,
        reserved: Number(row.reserved) === 1,
        destinations: destinations.map((d) =>
            describeDestination(d as DestinationRow),
        ),
    }
}

export const buildInactivator = (db: Db) => ({
    // Exige exatamente 1 candidato: a chave perde o 9º dígito (e o do meio de um 0800), então vários DIDs podem casar.
    // Com vários, só segue se o texto digitado for igual ao número guardado de um deles.
    async preview(key: string, digits: string): Promise<Preview> {
        const rows = await db`
            SELECT id, did, activated, reserved, id_user
            FROM pkg_did WHERE did LIKE ${`%${key.slice(-8)}`}`
        const matches = rows.filter((r) => numberKey(String(r.did)) === key)
        const exact =
            matches.length > 1
                ? matches.filter((r) => String(r.did).trim() === digits)
                : matches
        const [only] = exact
        if (matches.length === 0) return { kind: "none" }
        if (exact.length !== 1 || !only) {
            return {
                kind: "many",
                dids: matches.slice(0, 10).map((r) => String(r.did).trim()),
            }
        }
        const target = await loadTarget(db, only)
        const done =
            !target.activated &&
            !target.reserved &&
            target.userId === null &&
            target.destinations.length === 0
        return { kind: done ? "done" : "ready", target }
    },

    // Tudo numa transação: qualquer erro desfaz tudo. O alvo é o id confirmado, conferido de novo sob lock.
    async run(
        expected: Target,
        actor: string,
        reason: string,
    ): Promise<Target> {
        const { id } = expected
        if (!Number.isInteger(id) || id <= 0) {
            throw new InactivationError("DID inválido.")
        }
        return db.begin(async (tx) => {
            const [row] = await tx`
                SELECT id, did, activated, reserved, id_user
                FROM pkg_did WHERE id = ${id} FOR UPDATE`
            if (
                !row ||
                String(row.did).trim() !== expected.did ||
                toId(row.id_user) !== expected.userId
            ) {
                throw new InactivationError(
                    "O DID mudou desde a confirmação. Nada foi alterado, rode o comando de novo.",
                )
            }
            const current = await loadTarget(tx, row)

            // Sem dono não há uso nem histórico a fechar
            if (current.userId !== null) {
                const description =
                    `Inativado via Discord por ${actor}. Motivo: ${reason}`.slice(
                        0,
                        500,
                    )
                await tx`
                    INSERT INTO pkg_did_history (username, did, reservationdate, releasedate, month_payed, description)
                    SELECT ${current.username ?? String(current.userId)}, ${current.did},
                        COALESCE(MIN(reservationdate), NOW()), NOW(), COALESCE(MAX(month_payed), 0), ${description}
                    FROM pkg_did_use WHERE id_did = ${id} AND status = 1`
                await tx`
                    UPDATE pkg_did_use SET status = 0, releasedate = NOW()
                    WHERE id_did = ${id} AND status = 1`
            }
            await tx`DELETE FROM pkg_did_destination WHERE id_did = ${id}`
            const result = await tx`
                UPDATE pkg_did SET id_user = NULL, reserved = 0, activated = 0
                WHERE id = ${id} LIMIT 1`
            if (result.affectedRows !== 1) {
                throw new InactivationError(
                    "Não foi possível atualizar o DID. Nada foi alterado.",
                )
            }
            return current
        })
    },
})

export type Inactivator = ReturnType<typeof buildInactivator>

// foundRows: sem isso o MySQL conta só linhas que mudaram, e um UPDATE sem mudança reportaria 0 e desfaria tudo
export const createInactivator = (url: string) =>
    buildInactivator(new SQL(url, { foundRows: true }) as unknown as Db)

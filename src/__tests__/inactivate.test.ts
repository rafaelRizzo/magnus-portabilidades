// Testes da inativação: validação da entrada, escolha do alvo e a sequência de SQL, com um banco falso que registra tudo.
import { describe, expect, test } from "bun:test"
import {
    buildInactivator,
    cleanReason,
    type Db,
    InactivationError,
    parseDidInput,
    type Query,
    type Target,
} from "../inactivate"

type Row = Record<string, unknown>
type Answer = (sql: string, values: unknown[]) => Row[] | number

// Banco falso: guarda cada SQL com seus parâmetros e simula BEGIN/COMMIT/ROLLBACK
const fakeDb = (answer: Answer) => {
    const calls: { sql: string; values: unknown[] }[] = []
    const log: string[] = []
    const query: Query = async (strings, ...values) => {
        const sql = strings.join("?").replace(/\s+/g, " ").trim()
        calls.push({ sql, values })
        const out = answer(sql, values)
        return Object.assign(Array.isArray(out) ? [...out] : [], {
            affectedRows: typeof out === "number" ? out : 0,
        })
    }
    const db = Object.assign(query, {
        begin: async <T>(fn: (tx: Query) => Promise<T>) => {
            log.push("BEGIN")
            try {
                const result = await fn(query)
                log.push("COMMIT")
                return result
            } catch (error) {
                log.push("ROLLBACK")
                throw error
            }
        },
    }) as Db
    return { db, calls, log }
}

const didRow = (over: Row = {}): Row => ({
    id: 7,
    did: "551100000001",
    activated: 1,
    reserved: 1,
    id_user: 42,
    ...over,
})
const user = {
    username: "demo",
    firstname: "Demo",
    lastname: "Teste",
    company_name: null,
}
const destination = {
    voip_call: 0,
    destination: "1100000002",
    context: null,
    id_sip: null,
    id_ivr: null,
    id_queue: null,
}

// Responde cada tabela com os dados do cenário. Escritas devolvem 1 linha afetada.
const scenario = (
    over: {
        did?: Row[]
        locked?: Row[]
        destinations?: Row[]
        update?: number
    } = {},
): Answer => {
    const dids = over.did ?? [didRow()]
    return (sql) => {
        if (sql.includes("FROM pkg_did WHERE did LIKE")) return dids
        if (sql.includes("FROM pkg_did WHERE id =")) return over.locked ?? dids
        if (sql.includes("FROM pkg_user")) return [user]
        if (sql.includes("FROM pkg_did_destination dd"))
            return over.destinations ?? [destination]
        if (sql.startsWith("UPDATE pkg_did SET")) return over.update ?? 1
        return 0
    }
}

const writes = (calls: { sql: string }[]) =>
    calls.filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql))

const target = (over: Partial<Target> = {}): Target => ({
    id: 7,
    did: "551100000001",
    userId: 42,
    owner: "demo (Demo Teste)",
    username: "demo",
    activated: true,
    reserved: true,
    destinations: ["Telefone 1100000002"],
    ...over,
})

describe("parseDidInput", () => {
    test("aceita só dígitos e normaliza a chave com 55", () => {
        expect(parseDidInput("551133334444")).toEqual({
            digits: "551133334444",
            key: "551133334444",
        })
        expect(parseDidInput("11933334444")?.key).toBe("551133334444")
        expect(parseDidInput("8003533000")?.key).toBe("558003533000")
    })

    test.each([
        ["curinga %", "5511%"],
        ["curinga _", "5511_3334444"],
        ["asterisco", "5511*3334444"],
        ["injeção", "1' OR '1'='1"],
        ["com +", "+551133334444"],
        ["com espaços", "5511 3333 4444"],
        ["com hífen", "5511-33334444"],
        ["vazio", ""],
        ["curto", "123456789"],
        ["longo", "123456789012345"],
        ["dígitos de outro alfabeto", "٣٣٣٣٣٣٣٣٣٣٣٣"],
        ["só zeros", "0000000000"],
    ])("recusa %s", (_, raw) => {
        expect(parseDidInput(raw)).toBeNull()
    })
})

describe("cleanReason", () => {
    test("aceita de 3 a 200 caracteres e junta em uma linha", () => {
        expect(cleanReason("  linha   cancelada \n pelo cliente ")).toBe(
            "linha cancelada pelo cliente",
        )
        expect(cleanReason("abc")).toBe("abc")
        expect(cleanReason("x".repeat(200))).toHaveLength(200)
    })

    test.each(["", "  ", "ab", " a \n ", "x".repeat(201)])(
        "recusa %p",
        (raw) => {
            expect(cleanReason(raw)).toBeNull()
        },
    )
})

describe("preview", () => {
    test("busca por sufixo com parâmetro, sem nenhuma escrita", async () => {
        const { db, calls } = fakeDb(scenario({ did: [] }))
        const result = await buildInactivator(db).preview(
            "551100000001",
            "551100000001",
        )
        expect(result).toEqual({ kind: "none" })
        expect(calls).toHaveLength(1)
        expect(calls[0]?.values).toEqual(["%00000001"])
        expect(writes(calls)).toHaveLength(0)
    })

    test("ignora DID de outro DDD com o mesmo final", async () => {
        const { db } = fakeDb(
            scenario({
                did: [didRow(), didRow({ id: 8, did: "552100000001" })],
            }),
        )
        const result = await buildInactivator(db).preview(
            "551100000001",
            "551100000001",
        )
        expect(result.kind).toBe("ready")
        if (result.kind === "ready") expect(result.target.id).toBe(7)
    })

    test("vários candidatos: lista todos e não escolhe nenhum", async () => {
        const { db } = fakeDb(
            scenario({
                did: [
                    didRow({ did: "5511900000001" }),
                    didRow({ id: 8, did: "551100000001" }),
                ],
            }),
        )
        const result = await buildInactivator(db).preview(
            "551100000001",
            "11900000001",
        )
        expect(result).toEqual({
            kind: "many",
            dids: ["5511900000001", "551100000001"],
        })
    })

    test("vários candidatos: o número digitado igual ao guardado desempata", async () => {
        const { db } = fakeDb(
            scenario({
                did: [
                    didRow({ did: "5511900000001" }),
                    didRow({ id: 8, did: "551100000001" }),
                ],
            }),
        )
        const result = await buildInactivator(db).preview(
            "551100000001",
            "551100000001",
        )
        expect(result.kind).toBe("ready")
        if (result.kind === "ready") expect(result.target.id).toBe(8)
    })

    test("DID já inativo, livre e sem destinos não tem nada a fazer", async () => {
        const { db } = fakeDb(
            scenario({
                did: [didRow({ activated: 0, reserved: 0, id_user: null })],
                destinations: [],
            }),
        )
        const result = await buildInactivator(db).preview(
            "551100000001",
            "551100000001",
        )
        expect(result.kind).toBe("done")
    })

    test("DID livre e ativo (padrão de um recém-criado) pode ser inativado", async () => {
        const { db } = fakeDb(
            scenario({
                did: [didRow({ activated: 1, reserved: 0, id_user: null })],
                destinations: [],
            }),
        )
        const result = await buildInactivator(db).preview(
            "551100000001",
            "551100000001",
        )
        expect(result.kind).toBe("ready")
        if (result.kind === "ready") {
            expect(result.target.owner).toBeNull()
            expect(result.target.activated).toBe(true)
        }
    })

    test("monta dono e destinos para a confirmação", async () => {
        const { db } = fakeDb(scenario())
        const result = await buildInactivator(db).preview(
            "551100000001",
            "551100000001",
        )
        expect(result.kind).toBe("ready")
        if (result.kind === "ready") {
            expect(result.target.owner).toBe("demo (Demo Teste)")
            expect(result.target.destinations).toEqual(["Telefone 1100000002"])
        }
    })
})

describe("run", () => {
    test("grava na ordem: histórico, uso, destinos e DID, dentro de uma transação", async () => {
        const { db, calls, log } = fakeDb(scenario())
        const done = await buildInactivator(db).run(
            target(),
            "ator (1)",
            "teste",
        )

        expect(done.did).toBe("551100000001")
        expect(log).toEqual(["BEGIN", "COMMIT"])
        expect(calls.some((c) => c.sql.includes("FOR UPDATE"))).toBe(true)
        expect(
            writes(calls).map((c) => c.sql.split(" ").slice(0, 3).join(" ")),
        ).toEqual([
            "INSERT INTO pkg_did_history",
            "UPDATE pkg_did_use SET",
            "DELETE FROM pkg_did_destination",
            "UPDATE pkg_did SET",
        ])
    })

    test("nunca ativa nem reserva: só 0 e NULL, sempre por id", async () => {
        const { db, calls } = fakeDb(scenario())
        await buildInactivator(db).run(target(), "ator (1)", "teste")

        for (const { sql } of calls) {
            expect(sql).not.toMatch(/activated\s*=\s*1/)
            expect(sql).not.toMatch(/reserved\s*=\s*1/)
        }
        const update = calls.find((c) => c.sql.startsWith("UPDATE pkg_did SET"))
        expect(update?.sql).toBe(
            "UPDATE pkg_did SET id_user = NULL, reserved = 0, activated = 0 WHERE id = ? LIMIT 1",
        )
        expect(update?.values).toEqual([7])
        for (const w of writes(calls)) expect(w.sql).toMatch(/\bid(_did)? = \?/)
    })

    test("histórico leva o dono anterior e quem executou, limitado a 500", async () => {
        const { db, calls } = fakeDb(scenario())
        await buildInactivator(db).run(target(), "x".repeat(900), "teste")

        const history = calls.find((c) =>
            c.sql.startsWith("INSERT INTO pkg_did_history"),
        )
        expect(history?.values[0]).toBe("demo")
        expect(history?.values[1]).toBe("551100000001")
        const description = String(history?.values[2])
        expect(description.startsWith("Inativado via Discord por ")).toBe(true)
        expect(description).toHaveLength(500)
    })

    test("histórico guarda quem executou e o motivo", async () => {
        const { db, calls } = fakeDb(scenario())
        await buildInactivator(db).run(
            target(),
            "ator (1)",
            "pedido do cliente, linha cancelada",
        )
        const history = calls.find((c) =>
            c.sql.startsWith("INSERT INTO pkg_did_history"),
        )
        expect(history?.values[2]).toBe(
            "Inativado via Discord por ator (1). Motivo: pedido do cliente, linha cancelada",
        )
    })

    test("sem dono: não mexe em uso nem histórico", async () => {
        const { db, calls } = fakeDb(
            scenario({
                locked: [didRow({ activated: 1, reserved: 0, id_user: null })],
            }),
        )
        await buildInactivator(db).run(
            target({
                userId: null,
                owner: null,
                username: null,
                reserved: false,
            }),
            "ator (1)",
            "teste",
        )
        expect(calls.some((c) => c.sql.includes("pkg_did_history"))).toBe(false)
        expect(calls.some((c) => c.sql.includes("pkg_did_use"))).toBe(false)
        expect(writes(calls)).toHaveLength(2)
    })

    test("DID mudou de nome desde a confirmação: desfaz sem escrever", async () => {
        const { db, calls, log } = fakeDb(
            scenario({ locked: [didRow({ did: "551100000999" })] }),
        )
        await expect(
            buildInactivator(db).run(target(), "ator (1)", "teste"),
        ).rejects.toBeInstanceOf(InactivationError)
        expect(writes(calls)).toHaveLength(0)
        expect(log).toEqual(["BEGIN", "ROLLBACK"])
    })

    test("dono mudou desde a confirmação: desfaz sem escrever", async () => {
        const { db, calls } = fakeDb(
            scenario({ locked: [didRow({ id_user: 99 })] }),
        )
        await expect(
            buildInactivator(db).run(target(), "ator (1)", "teste"),
        ).rejects.toBeInstanceOf(InactivationError)
        expect(writes(calls)).toHaveLength(0)
    })

    test("DID sumiu: desfaz sem escrever", async () => {
        const { db, calls } = fakeDb(scenario({ locked: [] }))
        await expect(
            buildInactivator(db).run(target(), "ator (1)", "teste"),
        ).rejects.toBeInstanceOf(InactivationError)
        expect(writes(calls)).toHaveLength(0)
    })

    test("UPDATE do DID que não afeta exatamente 1 linha desfaz a transação", async () => {
        for (const affected of [0, 2]) {
            const { db, log } = fakeDb(scenario({ update: affected }))
            await expect(
                buildInactivator(db).run(target(), "ator (1)", "teste"),
            ).rejects.toBeInstanceOf(InactivationError)
            expect(log).toEqual(["BEGIN", "ROLLBACK"])
        }
    })

    test.each([0, -1, 1.5, Number.NaN])(
        "recusa id %p antes de abrir transação",
        async (id) => {
            const { db, calls, log } = fakeDb(scenario())
            await expect(
                buildInactivator(db).run(target({ id }), "ator (1)", "teste"),
            ).rejects.toBeInstanceOf(InactivationError)
            expect(calls).toHaveLength(0)
            expect(log).toHaveLength(0)
        },
    )
})

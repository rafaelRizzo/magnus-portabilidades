// Integração da inativação contra um MariaDB/MySQL real. Fica desligado sem MAGNUS_TEST_DB_URL.
// CUIDADO: apaga e recria as tabelas pkg_* do banco apontado. Por isso só roda no banco chamado portab_test.
// Ex: docker run -d --rm -e MARIADB_ROOT_PASSWORD=test -e MARIADB_DATABASE=portab_test -p 127.0.0.1:33307:3306 mariadb:10.11 --sql-mode=NO_ENGINE_SUBSTITUTION
//     MAGNUS_TEST_DB_URL=mysql://root:test@127.0.0.1:33307/portab_test bun test inactivate.integration
// Para provar que só os grants do README bastam, crie esse usuário no banco de teste e acrescente MAGNUS_TEST_DB_WRITE_URL=mysql://usuario:senha@127.0.0.1:33307/portab_test
import { beforeAll, describe, expect, test } from "bun:test"
import { SQL } from "bun"
import { createInactivator, InactivationError } from "../inactivate"

const url = process.env.MAGNUS_TEST_DB_URL

// Subconjunto das colunas reais do Magnus, todas InnoDB. Dados fictícios.
const SCHEMA = [
    "DROP TABLE IF EXISTS pkg_did_history, pkg_did_use, pkg_did_destination, pkg_did, pkg_sip, pkg_user",
    `CREATE TABLE pkg_user (id INT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(50), firstname VARCHAR(50), lastname VARCHAR(50), company_name VARCHAR(50), credit DECIMAL(15,5) NOT NULL DEFAULT 0) ENGINE=InnoDB`,
    `CREATE TABLE pkg_sip (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(50)) ENGINE=InnoDB`,
    `CREATE TABLE pkg_did (id INT PRIMARY KEY AUTO_INCREMENT, id_user INT NULL, activated INT NOT NULL DEFAULT 1, reserved TINYINT NULL DEFAULT 0, did CHAR(50) NOT NULL UNIQUE, description MEDIUMTEXT NULL, fixrate FLOAT NOT NULL DEFAULT 0, calllimit INT NOT NULL DEFAULT -1) ENGINE=InnoDB`,
    `CREATE TABLE pkg_did_destination (id INT PRIMARY KEY AUTO_INCREMENT, id_user INT NOT NULL, id_ivr INT NULL, id_sip INT NULL, id_queue INT NULL, id_did INT NOT NULL, destination VARCHAR(120) NOT NULL, context TEXT NULL, priority INT NOT NULL DEFAULT 0, activated INT NOT NULL DEFAULT 1, voip_call INT NULL DEFAULT 0) ENGINE=InnoDB`,
    `CREATE TABLE pkg_did_use (id INT PRIMARY KEY AUTO_INCREMENT, id_user INT NULL, id_did INT NULL, reservationdate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, releasedate TIMESTAMP NOT NULL DEFAULT '0000-00-00 00:00:00', status INT NULL DEFAULT 0, month_payed INT NULL DEFAULT 0) ENGINE=InnoDB`,
    `CREATE TABLE pkg_did_history (id INT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(50) NULL, did VARCHAR(50) NULL, reservationdate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, releasedate TIMESTAMP NOT NULL DEFAULT '0000-00-00 00:00:00', month_payed INT NULL DEFAULT 0, description VARCHAR(500) NULL) ENGINE=InnoDB`,
    // Faz o último UPDATE do DID ...009 falhar, para provar que o que veio antes é desfeito
    `ALTER TABLE pkg_did ADD CONSTRAINT no_free_009 CHECK (NOT (id_user IS NULL AND did = '551100000009'))`,
    "INSERT INTO pkg_user (id, username, firstname, lastname, credit) VALUES (1, 'demo', 'Demo', 'Teste', 12.50000), (2, 'outro', 'Outro', 'Teste', 3.00000)",
    "INSERT INTO pkg_did (id, id_user, activated, reserved, did, description, fixrate) VALUES (1, 1, 1, 1, '551100000001', 'nota A', 9.5), (2, 1, 1, 1, '551100000002', 'nota B', 7.5), (3, NULL, 1, 0, '551100000003', 'livre', 0), (4, NULL, 0, 0, '551100000004', 'inativo', 0), (5, 2, 1, 1, '5511900000005', NULL, 0), (6, 2, 1, 1, '551100000005', NULL, 0), (9, 1, 1, 1, '551100000009', NULL, 0)",
    "INSERT INTO pkg_did_destination (id_user, id_did, destination, voip_call, priority) VALUES (1, 1, '1100000101', 0, 0), (1, 1, '1100000102', 0, 1), (1, 2, '1100000103', 0, 0), (1, 9, '1100000109', 0, 0)",
    "INSERT INTO pkg_did_use (id_user, id_did, reservationdate, status, month_payed) VALUES (1, 1, '2026-01-10 08:00:00', 1, 1), (1, 2, '2026-02-10 08:00:00', 1, 1), (1, 9, '2026-03-10 08:00:00', 1, 1)",
]

const TABLES = [
    "pkg_user",
    "pkg_did",
    "pkg_did_destination",
    "pkg_did_use",
    "pkg_did_history",
]

describe.skipIf(!url)("inativação no MySQL real", () => {
    const admin = new SQL(url as string)
    // Opcional: usuário restrito (só os grants do README) para provar que eles bastam
    const inactivator = createInactivator(
        process.env.MAGNUS_TEST_DB_WRITE_URL ?? (url as string),
    )

    const snapshot = async () => {
        const out: Record<string, unknown[]> = {}
        for (const table of TABLES) {
            const rows = await admin.unsafe(
                `SELECT * FROM ${table} ORDER BY id`,
            )
            out[table] = JSON.parse(JSON.stringify([...rows]))
        }
        return out
    }

    beforeAll(async () => {
        // Trava de segurança: nunca recria tabelas em um banco que não seja o de teste
        if (new URL(url as string).pathname !== "/portab_test") {
            throw new Error(
                "MAGNUS_TEST_DB_URL deve apontar para o banco portab_test",
            )
        }
        for (const statement of SCHEMA) await admin.unsafe(statement)
    })

    test("inativa só o DID escolhido e deixa todo o resto intacto", async () => {
        const preview = await inactivator.preview(
            "551100000001",
            "551100000001",
        )
        expect(preview.kind).toBe("ready")
        if (preview.kind !== "ready") return
        const before = await snapshot()

        await inactivator.run(preview.target, "ator (1)")
        const after = await snapshot()

        // DID alvo: liberado, não reservado, inativo; descrição e tarifa intactas
        const did = (rows: unknown[], id: number) =>
            (rows as Record<string, unknown>[]).find((r) => r.id === id)
        expect(did(after.pkg_did as unknown[], 1)).toMatchObject({
            id_user: null,
            reserved: 0,
            activated: 0,
            description: "nota A",
            fixrate: 9.5,
        })
        // Destinos do alvo apagados, os dos outros ficam
        expect(
            (after.pkg_did_destination as Record<string, unknown>[]).map(
                (r) => r.id_did,
            ),
        ).toEqual([2, 9])
        // Uso fechado e histórico gravado com quem executou
        expect(did(after.pkg_did_use as unknown[], 1)).toMatchObject({
            status: 0,
        })
        const history = after.pkg_did_history as Record<string, unknown>[]
        expect(history).toHaveLength(1)
        expect(history[0]).toMatchObject({
            username: "demo",
            did: "551100000001",
            month_payed: 1,
            description: "Inativado via Discord por ator (1)",
        })
        expect(String(history[0]?.reservationdate)).toContain("2026-01-10")
        expect(String(history[0]?.releasedate)).toMatch(/^20\d\d-/)

        // Nada mais mudou: nem os outros DIDs, nem o saldo do cliente
        expect(after.pkg_user as unknown[]).toEqual(
            before.pkg_user as unknown[],
        )
        for (const id of [2, 3, 4, 5, 6, 9]) {
            expect(did(after.pkg_did as unknown[], id)).toEqual(
                did(before.pkg_did as unknown[], id) as Record<string, unknown>,
            )
        }
        expect(did(after.pkg_did_use as unknown[], 2)).toEqual(
            did(before.pkg_did_use as unknown[], 2) as Record<string, unknown>,
        )
    })

    test("repetir no mesmo DID vira 'já inativo' e não escreve nada", async () => {
        const before = await snapshot()
        const preview = await inactivator.preview(
            "551100000001",
            "551100000001",
        )
        expect(preview.kind).toBe("done")
        expect(await snapshot()).toEqual(before)
    })

    test("confirmação velha (dono mudou) é recusada sem alterar nada", async () => {
        const preview = await inactivator.preview(
            "551100000002",
            "551100000002",
        )
        if (preview.kind !== "ready") throw new Error("esperava ready")
        await admin.unsafe("UPDATE pkg_did SET id_user = 2 WHERE id = 2")
        const before = await snapshot()

        await expect(
            inactivator.run(preview.target, "ator (1)"),
        ).rejects.toBeInstanceOf(InactivationError)
        expect(await snapshot()).toEqual(before)
    })

    test("DID livre e ativo é inativado sem tocar em uso nem histórico", async () => {
        const preview = await inactivator.preview(
            "551100000003",
            "551100000003",
        )
        if (preview.kind !== "ready") throw new Error("esperava ready")
        const before = await snapshot()

        await inactivator.run(preview.target, "ator (1)")
        const after = await snapshot()
        expect(
            (after.pkg_did as Record<string, unknown>[]).find(
                (r) => r.id === 3,
            ),
        ).toMatchObject({
            id_user: null,
            reserved: 0,
            activated: 0,
        })
        expect(after.pkg_did_history).toEqual(before.pkg_did_history)
        expect(after.pkg_did_use).toEqual(before.pkg_did_use)
    })

    test("número ambíguo lista os candidatos, e o número exato desempata", async () => {
        const many = await inactivator.preview("551100000005", "11900000005")
        expect(many).toEqual({
            kind: "many",
            dids: expect.arrayContaining(["5511900000005", "551100000005"]),
        })
        const exact = await inactivator.preview("551100000005", "551100000005")
        expect(exact.kind).toBe("ready")
        if (exact.kind === "ready") expect(exact.target.id).toBe(6)
    })

    test("falha no último passo desfaz histórico, uso e destinos", async () => {
        const preview = await inactivator.preview(
            "551100000009",
            "551100000009",
        )
        if (preview.kind !== "ready") throw new Error("esperava ready")
        const before = await snapshot()

        await expect(
            inactivator.run(preview.target, "ator (1)"),
        ).rejects.toThrow()
        expect(await snapshot()).toEqual(before)
    })
})

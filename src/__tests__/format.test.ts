// Testes do texto de resposta: tronco conhecido, DID cadastrado, sem cadastro e Magnus indisponível.
import { describe, expect, test } from "bun:test"
import type { InviteEvent } from "../buffer"
import {
    describeCredentials,
    describeFooter,
    describeInvite,
    describeLogin,
    inviteColor,
} from "../format"

const event: InviteEvent = {
    key: "1133334444",
    called: "1133334444",
    from: "11999990001",
    srcIp: "192.0.2.50",
    callId: "abc@UAC",
    at: 1_700_000_000_000,
}

describe("describeInvite", () => {
    test("mostra ligação, tronco, cliente e destino", () => {
        const text = describeInvite(event, ["TRUNK-A", "TRUNK-B"], {
            did: "551133334444",
            activated: true,
            owner: "fulano (Fulano Silva)",
            destinations: ["SIP/ramal100"],
            sipAccounts: [],
        })
        expect(text).toContain("11999990001 → 1133334444")
        expect(text).toContain("TRUNK-A, TRUNK-B (192.0.2.50)")
        expect(text).toContain("**Cliente:** fulano \\(Fulano Silva\\)")
        expect(text).toContain("**Destino:** SIP/ramal100")
    })

    test("avisa DID sem destino e desativado", () => {
        const text = describeInvite(event, undefined, {
            did: "1133334444",
            activated: false,
            owner: null,
            destinations: [],
            sipAccounts: [],
        })
        expect(text).toContain("desconhecido (192.0.2.50)")
        expect(text).toContain("DID sem cliente")
        expect(text).toContain("sem destino configurado")
        expect(text).toContain("DID desativado")
    })

    test("DID fora do Magnus é dito, Magnus indisponível é omitido", () => {
        expect(describeInvite(event, [], null)).toContain(
            "ainda não cadastrado",
        )
        expect(describeInvite(event, [], undefined)).not.toContain("Cliente")
    })
})

describe("inviteColor", () => {
    const did = {
        did: "1133334444",
        activated: true,
        owner: "10001",
        destinations: ["Conta SIP x"],
        sipAccounts: [],
    }

    test("laranja quando a conta SIP não tem callerid", () => {
        const acc = { username: "u", secret: "s", callerid: "" }
        expect(inviteColor({ ...did, sipAccounts: [acc] })).toBe(0xff6900)
        expect(
            inviteColor({ ...did, sipAccounts: [{ ...acc, callerid: "11" }] }),
        ).toBe(0x00bc7d)
    })

    test("verde quando o DID está ativo e tem destino", () => {
        expect(inviteColor(did)).toBe(0x00bc7d)
    })

    test("vermelho quando o DID está desativado, mesmo sem destino", () => {
        expect(inviteColor({ ...did, activated: false })).toBe(0xfb2c36)
        expect(
            inviteColor({ ...did, activated: false, destinations: [] }),
        ).toBe(0xfb2c36)
    })

    test("laranja sem destino ou com DID fora do Magnus", () => {
        expect(inviteColor({ ...did, destinations: [] })).toBe(0xff6900)
        expect(inviteColor(null)).toBe(0xff6900)
    })

    test("verde quando o Magnus está indisponível", () => {
        expect(inviteColor(undefined)).toBe(0x00bc7d)
    })
})

describe("describeInvite com campos hostis", () => {
    test("escapa markdown e links vindos do SIP e neutraliza crase no Call-ID", () => {
        const text = describeInvite(
            {
                ...event,
                from: "[x](http://evil.test)**@everyone",
                callId: "a`b",
            },
            undefined,
            undefined,
        )
        expect(text).not.toContain("[x]")
        expect(text).toContain("\\[x\\]\\(http\\://evil.test\\)")
        expect(text).toContain("\\@everyone")
        expect(describeFooter({ ...event, callId: "a`b" })).toContain("`ab`")
    })
})

describe("campos do Magnus hostis", () => {
    test("cliente, destino e tronco viram uma linha e sem markdown ativo", () => {
        const text = describeInvite(event, ["T\n# x"], {
            did: "1",
            activated: true,
            owner: "**a**\n-# b [l](http://evil.test)",
            destinations: ["Contexto: <@123>"],
            sipAccounts: [],
        })
        expect(text.split("\n")).toHaveLength(4)
        expect(text).not.toContain("**a**")
        expect(text).toContain("\\<\\@123\\>")
        expect(text).toContain("\\[l\\]")
    })
})

describe("describeLogin", () => {
    const acc = { username: "u`ser", secret: "s3cr3t", callerid: "1133334444" }

    test("mostra o usuário e nunca a senha", () => {
        const text = describeLogin(acc)
        expect(text).toContain("user")
        expect(text).toContain("Callerid 1133334444")
        expect(text).not.toContain("s3cr3t")
    })

    test("callerid com quebra de linha não forja outro bloco", () => {
        const text = describeLogin({ ...acc, callerid: "1\n## x" })
        expect(text.split("\n").filter((l) => l.startsWith("##"))).toHaveLength(
            0,
        )
    })

    test("avisa falta de callerid", () => {
        expect(describeLogin({ ...acc, callerid: "" })).toContain(
            "Sem callerid na conta SIP",
        )
    })
})

describe("describeCredentials", () => {
    test("uma linha por dado, com a senha", () => {
        const did = {
            did: "551133334444",
            activated: true,
            owner: null,
            destinations: [],
            sipAccounts: [],
        }
        const acc = { username: "u1", secret: "s3cr3t", callerid: "11" }
        expect(describeCredentials(did, acc, "192.0.2.10")).toBe(
            "Dados da linha: 551133334444\nUsuário: u1\nSenha: s3cr3t\nHost: 192.0.2.10",
        )
    })
})

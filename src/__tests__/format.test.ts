// Testes do texto de resposta: tronco conhecido, DID cadastrado, sem cadastro e Magnus indisponível.
import { describe, expect, test } from "bun:test"
import type { InviteEvent } from "../buffer"
import { describeInvite, inviteColor } from "../format"

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
        })
        expect(text).toContain("11999990001 → 1133334444")
        expect(text).toContain("TRUNK-A, TRUNK-B (192.0.2.50)")
        expect(text).toContain("**Cliente:** fulano (Fulano Silva)")
        expect(text).toContain("**Destino:** SIP/ramal100")
    })

    test("avisa DID sem destino e desativado", () => {
        const text = describeInvite(event, undefined, {
            did: "1133334444",
            activated: false,
            owner: null,
            destinations: [],
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
    }

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
        expect(text).toContain("`ab`")
    })
})

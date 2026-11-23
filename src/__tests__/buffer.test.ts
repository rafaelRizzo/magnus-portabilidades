// Testes do buffer: janela de expiração, reinserção e espera por INVITE novo.
import { describe, expect, test } from "bun:test"
import { createInviteBuffer, type InviteEvent } from "../buffer"

const event = (key: string, at: number): InviteEvent => ({
    key,
    called: key,
    from: "11999990001",
    srcIp: "192.0.2.50",
    callId: `call-${at}`,
    at,
})

describe("createInviteBuffer", () => {
    test("acha INVITE dentro da janela e esquece depois dela", () => {
        const buffer = createInviteBuffer(1000)
        buffer.add(event("1133334444", 0))
        expect(buffer.find("1133334444", 1000)?.callId).toBe("call-0")
        expect(buffer.find("1133334444", 1001)).toBeNull()
    })

    test("INVITE novo do mesmo número substitui o anterior e renova a janela", () => {
        const buffer = createInviteBuffer(1000)
        buffer.add(event("1133334444", 0))
        buffer.add(event("1133334444", 900))
        expect(buffer.find("1133334444", 1500)?.callId).toBe("call-900")
    })

    test("espera resolve quando o INVITE chega", async () => {
        const buffer = createInviteBuffer()
        const pending = buffer.wait("1133334444", 1000)
        buffer.add(event("1133334444", Date.now()))
        expect((await pending)?.key).toBe("1133334444")
    })

    test("espera ignora INVITE de outro número e expira com null", async () => {
        const buffer = createInviteBuffer()
        const pending = buffer.wait("1133334444", 20)
        buffer.add(event("1144445555", Date.now()))
        expect(await pending).toBeNull()
    })
})

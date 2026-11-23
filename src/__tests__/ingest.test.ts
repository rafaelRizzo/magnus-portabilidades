// Teste de ponta a ponta do coletor: linha do tcpdump ao buffer, com filtro de operadora e chave do número.
import { describe, expect, test } from "bun:test"
import { createInviteBuffer } from "../buffer"
import { createIngest } from "../ingest"
import { numberKey } from "../number"

const packet = (
    srcIp: string,
    called: string,
) => `09:36:40.081223 eth0  In  IP ${srcIp}.5060 > 203.0.113.10.5060: SIP: INVITE sip:${called}@203.0.113.10:5060 SIP/2.0
From: "11999990001" <sip:11999990001@${srcIp}>;tag=x
Call-ID: id-${srcIp}
`

const run = (text: string) => {
    const buffer = createInviteBuffer()
    const feed = createIngest(buffer, new Set(["192.0.2.50"]))
    for (const line of text.split("\n")) feed(line)
    return buffer
}

describe("createIngest", () => {
    test("INVITE da operadora sem 55 casa com a consulta com 55", () => {
        const buffer = run(packet("192.0.2.50", "1133334444"))
        const key = numberKey("551133334444") as string
        expect(buffer.find(key)?.srcIp).toBe("192.0.2.50")
    })

    test("INVITE de IP fora da lista de operadoras é ignorado", () => {
        const buffer = run(packet("198.51.100.7", "1133334444"))
        expect(buffer.find(numberKey("551133334444") as string)).toBeNull()
    })
})

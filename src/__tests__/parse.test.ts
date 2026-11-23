// Testes do parser com saída real do tcpdump (dados fictícios).
import { describe, expect, test } from "bun:test"
import { createInviteParser, type ParsedInvite } from "../parse"

const CARRIER = `09:36:40.081223 eth0  In  IP 192.0.2.50.5060 > 203.0.113.10.5060: SIP: INVITE sip:1133334444@203.0.113.10:5060 SIP/2.0
E....D@.6...................INVITE sip:1133334444@203.0.113.10:5060 SIP/2.0
Record-Route: <sip:192.0.2.50;lr;ftag=tag-exemplo>
Via: SIP/2.0/UDP 192.0.2.50:5060;branch=z9hG4bKc41e.ba42058.0
Max-Forwards: 67
From: "11999990001" <sip:11999990001@192.0.2.50>;tag=tag-exemplo
To: <sip:1133334444@203.0.113.10:5060>
Call-ID: call-id-exemplo-1
CSeq: 123078508 INVITE
`

const CUSTOMER = `09:32:47.519747 eth0  In  IP 198.51.100.7.5060 > 203.0.113.10.5060: SIP: INVITE sip:5522999990002@sip.example.com:5060 SIP/2.0
E.....@.....H=0.............INVITE sip:5522999990002@sip.example.com:5060 SIP/2.0
Via: SIP/2.0/UDP 198.51.100.7:5060;rport;branch=z9hG4bKPj3644c964
From: <sip:552231990003@sip.example.com>;tag=tag-exemplo-2
To: <sip:5522999990002@sip.example.com>
Call-ID: call-id-exemplo-2
CSeq: 10637 INVITE
`

const parse = (text: string) => {
    const invites: ParsedInvite[] = []
    const feed = createInviteParser((invite) => invites.push(invite))
    for (const line of text.split("\n")) feed(line)
    return invites
}

describe("createInviteParser", () => {
    test("extrai INVITE de operadora sem 55 no Request-URI", () => {
        expect(parse(CARRIER)).toEqual([
            {
                called: "1133334444",
                from: "11999990001",
                srcIp: "192.0.2.50",
                callId: "call-id-exemplo-1",
            },
        ])
    })

    test("extrai vários pacotes em sequência", () => {
        const invites = parse(CARRIER + CUSTOMER)
        expect(invites.map((i) => i.called)).toEqual([
            "1133334444",
            "5522999990002",
        ])
        expect(invites[1]?.srcIp).toBe("198.51.100.7")
    })

    test("INVITE sem Call-ID não herda headers de outro pacote", () => {
        const truncated = CARRIER.split("\n").slice(0, 6).join("\n")
        const register = `09:36:41.000000 eth0  In  IP 198.51.100.7.5060 > 203.0.113.10.5060: SIP: REGISTER sip:example.com SIP/2.0
From: <sip:552231990003@example.com>
Call-ID: abc
`
        expect(parse(`${truncated}\n${register}`)).toEqual([])
    })
})

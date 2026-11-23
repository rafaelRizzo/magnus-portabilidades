// Parser linha a linha da saída de `tcpdump -n -A` para INVITEs SIP.
// shortcut: só lê Request-URI, From e Call-ID em forma longa, sem P-Asserted-Identity nem forma compacta.
export type ParsedInvite = {
    called: string
    from: string
    srcIp: string
    callId: string
}

const PACKET = /^\d{2}:\d{2}:\d{2}\.\d+\s/
const INVITE =
    /^\d{2}:\d{2}:\d{2}\.\d+\s+\S+\s+(?:In\s+)?IP\s+(\d+\.\d+\.\d+\.\d+)\.\d+\s+>.*?SIP:\s+INVITE\s+sip:([^@;\s]+)@/
const FROM = /^From:.*?sip:([^@>;\s]+)@/i
const CALL_ID = /^Call-ID:\s*(\S+)/i

export const createInviteParser = (
    onInvite: (invite: ParsedInvite) => void,
) => {
    let current: {
        called: string
        srcIp: string
        from?: string
        callId?: string
    } | null = null

    return (line: string) => {
        const invite = INVITE.exec(line)
        if (invite) {
            current = {
                srcIp: invite[1] as string,
                called: invite[2] as string,
            }
            return
        }
        // Qualquer outro pacote encerra o INVITE em andamento, para não herdar headers alheios
        if (PACKET.test(line)) {
            current = null
            return
        }
        if (!current) return

        current.from ??= FROM.exec(line)?.[1]
        current.callId ??= CALL_ID.exec(line)?.[1]
        if (current.from && current.callId) {
            onInvite({
                called: current.called,
                from: current.from,
                srcIp: current.srcIp,
                callId: current.callId,
            })
            current = null
        }
    }
}

// Liga parser, filtro de operadora e normalização do número ao buffer: recebe linhas do tcpdump.
import type { InviteBuffer } from "./buffer"
import { numberKey } from "./number"
import { createInviteParser } from "./parse"

export const createIngest = (
    buffer: InviteBuffer,
    carriers: { has(ip: string): boolean },
) =>
    createInviteParser((invite) => {
        // INVITE de cliente não prova entrega: só conta o que vem de IP de operadora
        if (!carriers.has(invite.srcIp)) return
        const key = numberKey(invite.called)
        if (key) buffer.add({ ...invite, key, at: Date.now() })
    })

// Buffer em memória dos últimos INVITEs por número (a janela) e espera por INVITE novo.
export type InviteEvent = {
    key: string
    called: string
    from: string
    srcIp: string
    callId: string
    at: number
}

export type InviteBuffer = ReturnType<typeof createInviteBuffer>

export const createInviteBuffer = (windowMs = 30 * 60_000) => {
    // Map mantém ordem de inserção: reinserir a chave a cada INVITE deixa o mais antigo na frente
    const events = new Map<string, InviteEvent>()
    const waiters = new Map<string, Set<(event: InviteEvent | null) => void>>()

    const prune = (now: number) => {
        for (const [key, event] of events) {
            if (now - event.at <= windowMs) break
            events.delete(key)
        }
    }

    return {
        add(event: InviteEvent) {
            prune(event.at)
            events.delete(event.key)
            events.set(event.key, event)
            for (const resolve of [...(waiters.get(event.key) ?? [])])
                resolve(event)
        },

        find(key: string, now = Date.now()) {
            prune(now)
            return events.get(key) ?? null
        },

        // Só é chamado sem INVITE na janela, então qualquer INVITE que chegar aqui é novo
        wait(key: string, ms: number) {
            return new Promise<InviteEvent | null>((resolve) => {
                const set = waiters.get(key) ?? new Set()
                const done = (event: InviteEvent | null) => {
                    clearTimeout(timer)
                    set.delete(done)
                    if (set.size === 0) waiters.delete(key)
                    resolve(event)
                }
                const timer = setTimeout(() => done(null), ms)
                set.add(done)
                waiters.set(key, set)
            })
        },
    }
}

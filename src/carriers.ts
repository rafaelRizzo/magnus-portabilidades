// Operadoras lidas do Asterisk (`sip show peers`): IP -> nomes dos trunks, relidas de tempos em tempos.
// shortcut: ramal com IP fixo também aparece no `sip show peers` e entra na lista, só ramal dinâmico (D) é ignorado.
const PEER = /^(\S+)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(D\s)?/

export const parsePeers = (output: string) => {
    const byIp = new Map<string, string[]>()
    for (const line of output.split("\n")) {
        const match = PEER.exec(line)
        if (!match || match[3]) continue
        const name = (match[1] as string).split("/")[0] as string
        const ip = match[2] as string
        byIp.set(ip, [...(byIp.get(ip) ?? []), name])
    }
    return byIp
}

const runAsterisk = async () => {
    const proc = Bun.spawn(["asterisk", "-rx", "sip show peers"], {
        stdout: "pipe",
        stderr: "inherit",
    })
    const [output, code] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
    ])
    if (code !== 0) throw new Error(`asterisk -rx saiu com código ${code}`)
    return output
}

export type Carriers = ReturnType<typeof createCarriers>

export const createCarriers = (run: () => Promise<string> = runAsterisk) => {
    let byIp = new Map<string, string[]>()

    return {
        has: (ip: string) => byIp.has(ip),
        names: (ip: string) => byIp.get(ip),

        // Lista vazia não substitui a anterior: sem nenhum trunk é erro de leitura, não o fim das operadoras
        async refresh() {
            const next = parsePeers(await run())
            if (next.size === 0) {
                throw new Error("sip show peers sem nenhum trunk com IP")
            }
            byIp = next
        },
    }
}

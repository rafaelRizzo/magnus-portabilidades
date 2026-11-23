// Sobe o tcpdump só para INVITEs UDP que chegam ao servidor e entrega a saída linha a linha.
const readLines = async (
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void,
) => {
    const decoder = new TextDecoder()
    let rest = ""
    for await (const chunk of stream) {
        const lines = (rest + decoder.decode(chunk, { stream: true })).split(
            "\n",
        )
        rest = lines.pop() ?? ""
        for (const line of lines) onLine(line)
    }
}

export const startCapture = (
    serverIp: string,
    onLine: (line: string) => void,
) => {
    // udp[8:4] = "INVI": descarta REGISTER e OPTIONS ainda no kernel, que são a maior parte do tráfego
    const filter = `udp dst port 5060 and dst host ${serverIp} and udp[8:4] = 0x494e5649`
    const proc = Bun.spawn(
        ["tcpdump", "-n", "-A", "-s0", "-l", "-i", "any", filter],
        {
            stdout: "pipe",
            stderr: "inherit",
        },
    )
    readLines(proc.stdout, onLine)
    return proc
}

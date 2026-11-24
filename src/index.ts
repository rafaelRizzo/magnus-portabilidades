// Entrada: liga coletor (tcpdump), buffer, API local e bot Discord no mesmo processo.
import { startBot } from "./bot"
import { createInviteBuffer } from "./buffer"
import { createCarriers } from "./carriers"
import { env } from "./env"
import { createIngest } from "./ingest"
import { createMagnus } from "./magnus"
import { buildServer } from "./server"
import { startCapture } from "./tcpdump"

// Rejeição solta não derruba o processo: reiniciar perderia a janela de 30 min de INVITEs
process.on("unhandledRejection", (reason) =>
    console.error("unhandledRejection:", reason),
)

const buffer = createInviteBuffer()

// A primeira leitura precisa funcionar: sem a lista de operadoras todo INVITE seria descartado em silêncio
const carriers = createCarriers()
await carriers.refresh()
setInterval(() => {
    carriers
        .refresh()
        .catch((error) =>
            console.error(
                "Falha ao reler as operadoras, mantendo a lista anterior:",
                error,
            ),
        )
}, 60_000)

const capture = startCapture(env.SERVER_IP, createIngest(buffer, carriers))
// Sem captura o serviço fica cego: sai para o systemd reiniciar
capture.exited.then((code) => {
    console.error(`tcpdump encerrou com código ${code}`)
    process.exit(1)
})

await buildServer(buffer, env.API_TOKEN).listen({
    host: "127.0.0.1",
    port: env.API_PORT,
})
await startBot(
    {
        token: env.DISCORD_TOKEN,
        guildId: env.DISCORD_GUILD_ID,
        allowedRoleId: env.ALLOWED_ROLE_ID,
        allowedChannelId: env.ALLOWED_CHANNEL_ID,
        carrierNames: carriers.names,
        sipHost: env.SIP_HOST ?? env.SERVER_IP,
        magnus: env.MAGNUS_DB_URL ? createMagnus(env.MAGNUS_DB_URL) : undefined,
    },
    buffer,
)

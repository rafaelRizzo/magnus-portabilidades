// Variáveis de ambiente validadas na subida: falha rápido se algo estiver faltando.
import { z } from "zod"

const empty = (value: unknown) => (value === "" ? undefined : value)

export const env = z
    .object({
        SERVER_IP: z.ipv4(),
        SIP_HOST: z.preprocess(empty, z.string().optional()),
        API_TOKEN: z.string().min(16),
        API_PORT: z.coerce.number().int().default(3100),
        DISCORD_TOKEN: z.string().min(1),
        DISCORD_GUILD_ID: z.string().min(1),
        ALLOWED_ROLE_ID: z.preprocess(empty, z.string().optional()),
        ALLOWED_CHANNEL_ID: z.preprocess(empty, z.string().optional()),
        MAGNUS_DB_URL: z.preprocess(empty, z.url().optional()),
    })
    .parse(process.env)

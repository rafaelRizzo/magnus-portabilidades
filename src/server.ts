// API HTTP local: consulta se um número recebeu INVITE na janela, opcionalmente esperando um novo.
import { timingSafeEqual } from "node:crypto"
import Fastify from "fastify"
import { z } from "zod"
import type { InviteBuffer } from "./buffer"
import { numberKey } from "./number"

const querySchema = z.object({
    wait: z.coerce.number().int().min(0).max(120).default(0),
})

export const buildServer = (buffer: InviteBuffer, token: string) => {
    const app = Fastify({ logger: true })
    const expected = Buffer.from(`Bearer ${token}`)

    // async é obrigatório: guard síncrono sem Promise trava a request no Fastify
    app.addHook("onRequest", async (req, reply) => {
        const got = Buffer.from(req.headers.authorization ?? "")
        if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
            return reply
                .code(401)
                .send({ success: false, message: "Não autorizado" })
        }
    })

    app.get<{ Params: { number: string } }>(
        "/numero/:number",
        async (req, reply) => {
            const key = numberKey(req.params.number)
            const query = querySchema.safeParse(req.query)
            if (!key || !query.success) {
                return reply.code(400).send({
                    success: false,
                    message: "Número ou parâmetro inválido",
                })
            }

            const invite =
                buffer.find(key) ??
                (query.data.wait
                    ? await buffer.wait(key, query.data.wait * 1000)
                    : null)
            return {
                success: true,
                message: invite
                    ? "Número está conosco"
                    : "Nenhum INVITE na janela",
                found: invite !== null,
                invite,
            }
        },
    )

    return app
}

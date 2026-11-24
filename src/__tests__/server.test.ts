// Testes da API local: autenticação, cabeçalhos do helmet e limite de 100 requisições por minuto.
import { expect, test } from "bun:test"
import { createInviteBuffer } from "../buffer"
import { buildServer } from "../server"

const TOKEN = "token-de-teste-0123456789"
const call = (app: Awaited<ReturnType<typeof buildServer>>, token = TOKEN) =>
    app.inject({
        url: "/numero/1133334444",
        headers: { authorization: `Bearer ${token}` },
    })

test("helmet nos cabeçalhos e 429 depois de 100 requisições no minuto", async () => {
    const app = await buildServer(createInviteBuffer(), TOKEN)
    const first = await call(app)
    expect(first.statusCode).toBe(200)
    expect(first.headers["x-content-type-options"]).toBe("nosniff")

    for (let i = 1; i < 100; i++) await call(app)
    expect((await call(app)).statusCode).toBe(429)
    await app.close()
})

test("token errado continua dando 401", async () => {
    const app = await buildServer(createInviteBuffer(), TOKEN)
    expect((await call(app, "errado")).statusCode).toBe(401)
    await app.close()
})

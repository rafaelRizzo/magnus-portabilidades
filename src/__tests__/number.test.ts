// Testes da chave de comparação de números: formatos de cliente, operadora e casos de borda.
import { describe, expect, test } from "bun:test"
import { numberKey } from "../number"

describe("numberKey", () => {
    test.each([
        ["551133334444", "1133334444"],
        ["1133334444", "1133334444"],
        ["+55 (11) 3333-4444", "1133334444"],
        ["00551133334444", "1133334444"],
        ["5511933334444", "1133334444"],
        ["11933334444", "1133334444"],
        ["551144445555", "1144445555"],
    ])("normaliza %s", (raw, key) => {
        expect(numberKey(raw)).toBe(key)
    })

    test("não confunde DDD 55 com DDI", () => {
        expect(numberKey("5532323232")).toBe("5532323232")
    })

    test("rejeita número curto ou vazio", () => {
        expect(numberKey("123")).toBeNull()
        expect(numberKey("")).toBeNull()
    })
})

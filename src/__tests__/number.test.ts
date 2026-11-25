// Testes da chave de comparação de números: formatos de cliente, operadora e casos de borda.
import { describe, expect, test } from "bun:test"
import { numberKey } from "../number"

describe("numberKey", () => {
    test.each([
        ["551133334444", "551133334444"],
        ["1133334444", "551133334444"],
        ["+55 (11) 3333-4444", "551133334444"],
        ["00551133334444", "551133334444"],
        ["5511933334444", "551133334444"],
        ["11933334444", "551133334444"],
        ["551144445555", "551144445555"],
    ])("normaliza %s", (raw, key) => {
        expect(numberKey(raw)).toBe(key)
    })

    test("não confunde DDD 55 com DDI", () => {
        expect(numberKey("5532323232")).toBe("555532323232")
    })

    test("0800 aceita com ou sem 55 e 0", () => {
        for (const raw of ["8003533000", "08003533000", "558003533000"])
            expect(numberKey(raw)).toBe("558003533000")
    })

    test("rejeita número curto ou vazio", () => {
        expect(numberKey("123")).toBeNull()
        expect(numberKey("")).toBeNull()
    })
})

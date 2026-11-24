// Testes da leitura do destino com linhas reais de pkg_did_destination (dados fictícios).
import { describe, expect, test } from "bun:test"
import {
    describeDestination,
    describeOwner,
    describeUserStatus,
    toSipAccount,
} from "../magnus"

describe("describeOwner", () => {
    const base = { username: "10001", company_name: null }

    test("nome e sobrenome iguais aparecem uma vez só", () => {
        expect(
            describeOwner({
                ...base,
                firstname: "EMPRESA EXEMPLO",
                lastname: "EMPRESA EXEMPLO",
            }),
        ).toBe("10001 (EMPRESA EXEMPLO)")
    })

    test("sem nome usa a empresa, sem nada só o usuário, sem usuário null", () => {
        expect(
            describeOwner({
                ...base,
                firstname: "",
                lastname: "",
                company_name: "ACME",
            }),
        ).toBe("10001 (ACME)")
        expect(describeOwner({ ...base, firstname: "", lastname: "" })).toBe(
            "10001",
        )
        expect(
            describeOwner({
                username: null,
                firstname: "A",
                lastname: "B",
                company_name: null,
            }),
        ).toBeNull()
    })
})

describe("describeDestination", () => {
    const row = (over: Partial<Parameters<typeof describeDestination>[0]>) => ({
        voip_call: 1,
        destination: "",
        context: null,
        id_sip: 0,
        id_ivr: 0,
        id_queue: 0,
        ...over,
    })

    test("conta SIP vale pelo nome em pkg_sip e ignora context e destination velhos", () => {
        expect(
            describeDestination(
                row({
                    voip_call: 1,
                    sip_name: "551133334444CONTA",
                    context:
                        "exten => _X.,1,Dial(SIP/TRUNK-EXEMPLO/${EXTEN},1)",
                    destination: "999999999",
                }),
            ),
        ).toBe("Conta SIP 551133334444CONTA")
    })

    test("conta SIP sem nome achado mostra o id", () => {
        expect(describeDestination(row({ voip_call: 1, id_sip: 77 }))).toBe(
            "Conta SIP #77",
        )
    })

    test("telefone, URA e fila", () => {
        expect(
            describeDestination(
                row({ voip_call: 0, destination: "01133334444" }),
            ),
        ).toBe("Telefone 01133334444")
        expect(describeDestination(row({ voip_call: 2, id_ivr: 16 }))).toBe(
            "URA #16",
        )
        expect(describeDestination(row({ voip_call: 7, id_queue: 31 }))).toBe(
            "Fila #31",
        )
    })

    test("contexto mostra os alvos do Dial, sem repetir", () => {
        expect(
            describeDestination(
                row({
                    voip_call: 10,
                    context: "exten => _X.,1,Dial(SIP/111&SIP/222/${EXTEN})",
                }),
            ),
        ).toBe("Contexto: SIP/111 + SIP/222")
    })

    test("contexto sem Dial mostra a aplicação, e vazio é dito", () => {
        expect(
            describeDestination(
                row({ voip_call: 10, context: "exten => _X.,1,Hangup()" }),
            ),
        ).toBe("Contexto: Hangup()")
        expect(describeDestination(row({ voip_call: 10 }))).toBe(
            "Contexto: vazio",
        )
    })

    test("contexto com destination mostra os dois", () => {
        expect(
            describeDestination(
                row({
                    voip_call: 10,
                    context: "exten => _X.,1,Dial(SIP/111/${EXTEN})",
                    destination: "pbx.exemplo.com",
                }),
            ),
        ).toBe("Contexto: SIP/111 (pbx.exemplo.com)")
    })

    test("múltiplos IPs mostra o host", () => {
        expect(
            describeDestination(
                row({ voip_call: 11, destination: "pbx.exemplo.com" }),
            ),
        ).toBe("IP pbx.exemplo.com")
    })

    test("tipo desconhecido aparece como tipo N em vez de sumir", () => {
        expect(
            describeDestination(row({ voip_call: 99, destination: "x" })),
        ).toBe("tipo 99 x")
    })
})

describe("toSipAccount", () => {
    test("callerid nulo ou em branco vira vazio", () => {
        const base = {
            voip_call: 1,
            destination: null,
            context: null,
            id_sip: 1,
            id_ivr: 0,
            id_queue: 0,
            defaultuser: "u",
            secret: "s",
        }
        expect(toSipAccount({ ...base, callerid: null }).callerid).toBe("")
        expect(toSipAccount({ ...base, callerid: "  " }).callerid).toBe("")
        expect(toSipAccount({ ...base, callerid: "1133334444" })).toEqual({
            username: "u",
            secret: "s",
            callerid: "1133334444",
        })
    })
})

describe("describeUserStatus", () => {
    test("mapeia os status conhecidos, desconhecido vira status N, sem cliente é nulo", () => {
        expect(describeUserStatus(1)).toBe("Ativo")
        expect(describeUserStatus("0")).toBe("Inativo")
        expect(describeUserStatus(9)).toBe("status 9")
        expect(describeUserStatus(null)).toBeNull()
    })
})

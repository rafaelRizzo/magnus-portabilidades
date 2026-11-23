// Testes da leitura de operadoras: formato do `sip show peers` (dados fictícios) e atualização da lista.
import { describe, expect, test } from "bun:test"
import { createCarriers, parsePeers } from "../carriers"

const PEERS = `Name/username             Host                                    Dyn Forcerport Comedia    ACL Port     Status      Description
TRUNK-A                   192.0.2.10                                  Yes        Yes            5060     OK (10 ms)
TRUNK-B/user123           192.0.2.10                                  Yes        Yes            5060     OK (12 ms)
TRUNK-C/TRUNK-C           (Unspecified)                            D  Yes        Yes            0        UNKNOWN
RAMAL-D/RAMAL-D           198.51.100.20                            D  Yes        Yes         A  5060     OK (3 ms)
TRUNK-E                   192.0.2.30                                  Yes        Yes         A  5060     UNREACHABLE
5 sip peers [Monitored: 3 online, 1 offline Unmonitored: 0 online, 0 offline]
`

describe("parsePeers", () => {
    test("junta trunks que dividem o mesmo IP e tira o /usuário do nome", () => {
        expect(parsePeers(PEERS).get("192.0.2.10")).toEqual([
            "TRUNK-A",
            "TRUNK-B",
        ])
    })

    test("ignora Unspecified, ramal dinâmico, cabeçalho e rodapé", () => {
        const byIp = parsePeers(PEERS)
        expect([...byIp.keys()]).toEqual(["192.0.2.10", "192.0.2.30"])
    })
})

describe("createCarriers", () => {
    test("refresh carrega a lista e as consultas usam o IP", async () => {
        const carriers = createCarriers(async () => PEERS)
        await carriers.refresh()
        expect(carriers.has("192.0.2.30")).toBe(true)
        expect(carriers.names("192.0.2.30")).toEqual(["TRUNK-E"])
        expect(carriers.has("198.51.100.20")).toBe(false)
    })

    test("IP que mudou entra na releitura, e o antigo sai", async () => {
        let output = PEERS
        const carriers = createCarriers(async () => output)
        await carriers.refresh()
        output = PEERS.replace("192.0.2.30", "192.0.2.99")
        await carriers.refresh()
        expect(carriers.has("192.0.2.99")).toBe(true)
        expect(carriers.has("192.0.2.30")).toBe(false)
    })

    test("saída sem trunk dá erro e mantém a lista anterior", async () => {
        let output = PEERS
        const carriers = createCarriers(async () => output)
        await carriers.refresh()
        output = "Name/username Host Dyn\n"
        await expect(carriers.refresh()).rejects.toThrow()
        expect(carriers.has("192.0.2.10")).toBe(true)
    })
})

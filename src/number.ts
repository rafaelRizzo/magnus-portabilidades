// Normaliza número de telefone para a chave de comparação: 55 + DDD + últimos 8 dígitos.
// Aceita qualquer formato (com/sem 55, +, 0 inicial, 9º dígito) e sempre devolve com 55.
export const numberKey = (raw: string): string | null => {
    let digits = raw.replace(/\D/g, "").replace(/^0+/, "")
    // 55 só é DDI com 12 ou 13 dígitos: com 10 ou 11 pode ser o DDD 55 (RS)
    if (
        (digits.length === 12 || digits.length === 13) &&
        digits.startsWith("55")
    ) {
        digits = digits.slice(2)
    }
    return digits.length >= 10
        ? `55${digits.slice(0, 2)}${digits.slice(-8)}`
        : null
}

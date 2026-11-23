# Detectar INVITEs por captura de pacotes SIP

Número ainda não cadastrado como DID nunca chega ao dialplan do Asterisk (13.38.3, chan_sip, `allowguest=no`): a plataforma responde `401` e descarta o pedido, sem CDR e sem log com o número. Por isso o coletor lê os INVITEs direto na porta UDP 5060 com `tcpdump`, em vez de usar dialplan, AGI ou CDR.

## Considered Options

- **Catch-all no dialplan:** não funciona, o INVITE morre antes do dialplan.
- **Polling do CDR do Magnus:** só enxerga chamadas que passaram pelo dialplan.
- **Log do Asterisk (`sip set debug`):** pesado em produção e sem o número chamado nos casos rejeitados.

## Consequences

- O coletor precisa de `CAP_NET_RAW` e depende do formato de saída do `tcpdump`. Cobre só UDP, não TCP nem TLS.
- O estado fica só em memória (buffer da janela). Reiniciar o serviço apaga a janela, o que é aceitável porque a consulta espera por um INVITE novo de qualquer forma. Por isso não há banco nem Redis, ao contrário do padrão dos outros backends: é um processo único na máquina do Magnus.
- Só INVITEs vindos de IP de operadora contam, senão uma ligação de cliente para o número pareceria entrega. Os IPs vêm do `asterisk -rx "sip show peers"`, relidos a cada 60 segundos, então um trunk novo ou com IP novo entra sozinho. Isso exige rodar como root (socket do Asterisk) e deixa passar ramal de IP fixo, que também aparece nesse comando.

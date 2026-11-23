# Detectar INVITEs por captura de pacotes SIP

Número ainda não cadastrado como DID nunca chega ao dialplan do Asterisk (13.38.3, chan_sip, `allowguest=no`): a plataforma responde `401` e descarta o pedido, sem CDR e sem log com o número. Por isso o coletor lê os INVITEs direto na porta UDP 5060 com `tcpdump`, em vez de usar dialplan, AGI ou CDR. O filtro do kernel (`udp[8:4]`) já descarta tudo que não é INVITE, e só contam os INVITEs vindos de IP de operadora.

## Considered Options

- **Catch-all no dialplan:** não funciona, o INVITE morre antes do dialplan.
- **Polling do CDR do Magnus:** só enxerga chamadas que passaram pelo dialplan.
- **Log do Asterisk (`sip set debug`):** pesado em produção e sem o número chamado nos casos rejeitados.
- **Lista fixa de IPs de operadora no código:** foi a primeira versão. Descartada porque envelhece em silêncio: trunk novo ou com IP novo seria ignorado até alguém lembrar de editar o arquivo.

## Consequences

- O serviço roda como root: o `tcpdump` precisa de captura raw e o `asterisk -rx` precisa do socket do Asterisk. A captura depende do formato de saída do `tcpdump` e cobre só UDP, não TCP nem TLS.
- O estado fica só em memória (buffer da janela). Reiniciar o serviço apaga a janela, o que é aceitável porque a consulta espera por um INVITE novo de qualquer forma. Por isso não há banco nem Redis, ao contrário do padrão dos outros backends: é um processo único na máquina do Magnus.
- Os IPs de operadora vêm do `asterisk -rx "sip show peers"`, relidos a cada 60 segundos, então um trunk novo ou com IP novo entra sozinho. Se a primeira leitura falhar, o serviço encerra e o systemd tenta de novo, pois sem a lista todo INVITE seria descartado em silêncio. Se uma releitura falhar, ou vier sem nenhum trunk, a lista anterior é mantida.
- Ramal com IP fixo também aparece no `sip show peers` e entra na lista, então uma ligação dele para o número conta como entrega. Ramal dinâmico é ignorado.
- Risco que continua: se uma operadora entregar por um IP que não é peer cadastrado no Asterisk, o INVITE é descartado e a consulta responde que nada chegou, mesmo com o número já nosso. Na primeira portabilidade de cada operadora, confira o IP de origem com o `tcpdump`.

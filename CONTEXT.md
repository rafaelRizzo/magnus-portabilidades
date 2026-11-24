# Portabilidades

Ferramenta interna que responde, para um número em portabilidade, se a operadora já entrega as ligações dele à nossa plataforma, sem ninguém precisar conferir o servidor na mão.

## Language

**Número chamado**:
O número que o chamador discou, reduzido a DDD e últimos 8 dígitos para comparação, ignorando 55, +, 0 inicial e o 9º dígito.
_Avoid_: destino

**INVITE**:
Pedido de ligação que chega à plataforma para um número chamado, mesmo que a plataforma o recuse por o número não estar cadastrado.
_Avoid_: chamada, ligação completada

**Conosco**:
Estado de um número que recebeu um INVITE dentro da janela, o que prova que a operadora já o entrega a nós.
_Avoid_: ativo, provisionado, portado

**Janela**:
Período recente (30 minutos) em que um INVITE ainda vale como prova de que o número está conosco.
_Avoid_: histórico, cache

**Espera**:
Tempo (até 2 minutos) em que uma consulta sem INVITE na janela aguarda uma ligação nova antes de responder que o número não chegou.
_Avoid_: timeout, polling

**Consulta**:
Pergunta feita pela equipe, via bot, se um número está conosco.
_Avoid_: busca, verificação

**Origem**:
O IP de quem enviou o INVITE, usado para distinguir a operadora de um cliente.
_Avoid_: remetente, caller

**Operadora**:
Provedor que entrega as ligações de um número portado à nossa plataforma.
_Avoid_: carrier, fornecedor

**DID**:
Cadastro de um número no Magnus, com dono (cliente) e destinos. Um número pode chegar à plataforma sem DID cadastrado.
_Avoid_: linha, número cadastrado

**Destino**:
Para onde o Magnus encaminha as ligações de um DID cadastrado.
_Avoid_: rota, extensão

**Login SIP**:
Usuário e senha da Conta SIP que é destino de um DID. Sem callerid na conta, a resposta fica laranja.
_Avoid_: credencial, ramal

**Tronco**:
Conexão cadastrada no Magnus por onde uma operadora entrega ligações, identificada pelo nome e pelo IP de origem.
_Avoid_: trunk, linha

**Cliente**:
Usuário da plataforma, cujas próprias ligações de saída também geram INVITEs e podem ser confundidas com a entrega de uma operadora.
_Avoid_: tenant, conta

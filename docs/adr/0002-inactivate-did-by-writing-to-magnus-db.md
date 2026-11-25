# Inativar DID escrevendo direto no MySQL do Magnus

O bot nasceu somente leitura (README, `MAGNUS_DB_URL` com `SELECT`). O `/inativar` é a primeira escrita: a equipe liberava e inativava DIDs na tela do Magnus a cada pedido via Discord, e decidimos fazer isso pelo bot, em SQL direto, em vez de chamar a API do Magnus.

## Considered Options

- **API do Magnus:** manteria as regras de liberação no Magnus. Descartada por decisão do dono do projeto, que escolheu SQL direto.
- **Só `pkg_did` e `pkg_did_destination`:** mais simples, mas deixaria um uso aberto em `pkg_did_use` apontando para o cliente de um DID que já não tem dono. Descartada: o SQL replica o que a tela *Liberar DID* grava (fecha o uso e escreve o histórico).

## Consequences

- A escrita usa o mesmo usuário MySQL da consulta (`portab`), com grants extras por coluna: só `id_user`, `reserved` e `activated` em `pkg_did`, e `status` e `releasedate` em `pkg_did_use`. Só o `/inativar` tem SQL de escrita, e ele só é registrado com `MAGNUS_DB_URL` preenchido, sem variável de conexão separada. O acesso usa as mesmas travas de servidor, cargo e canal do `/numero`, sem cargo de admin: é uma ferramenta interna e, por decisão do dono do projeto, quem está no canal já pode usar. Um usuário e uma URL separados isolariam melhor a escrita, mas foram descartados por decisão do dono do projeto, que os considerou desnecessários.
- O SQL só desce: `activated = 0`, `reserved = 0`, `id_user = NULL`. Não existe reativar pelo bot, de propósito.
- Duplicamos no bot a regra "o que liberar significa" do Magnus. Se uma atualização do Magnus passar a gravar algo a mais ao liberar um DID, o bot não acompanha sozinho.
- Depende de InnoDB nas tabelas `pkg_did*` (transação e `FOR UPDATE`). O Asterisk não é recarregado pelo bot: assume-se que o Magnus resolve o DID no banco a cada chamada. Ambos precisam ser conferidos no servidor antes do uso em produção.
- O teste de integração (`inactivate.integration.test.ts`) roda só com `MAGNUS_TEST_DB_URL` apontando para um banco chamado `portab_test`, porque recria as tabelas `pkg_*`.

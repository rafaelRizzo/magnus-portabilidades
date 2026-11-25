// Bot Discord: /numero consulta a janela de INVITEs e espera uma ligação nova se preciso. /inativar libera e inativa um DID no Magnus.
import {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    type ChatInputCommandInteraction,
    Client,
    ComponentType,
    ContainerBuilder,
    Events,
    GatewayIntentBits,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
} from "discord.js"
import type { InviteBuffer, InviteEvent } from "./buffer"
import {
    describeAmbiguous,
    describeCredentials,
    describeFooter,
    describeInactivated,
    describeInactivationPreview,
    describeInvite,
    describeLogin,
    inviteColor,
} from "./format"
import {
    cleanReason,
    InactivationError,
    type Inactivator,
    parseDidInput,
} from "./inactivate"
import type { DidInfo, MagnusLookup } from "./magnus"
import { numberKey } from "./number"

const WAIT_MS = 120_000
const MAX_ACCOUNTS = 3
const CONFIRM_MS = 60_000
// Comandos que este bot registra: qualquer um deles em outro servidor ou no escopo global é lixo e sai na subida
const COMMAND_NAMES = new Set(["numero", "inativar"])
// Aceita também os ids antigos (user, pass) de mensagens já postadas: todos devolvem os dados juntos
const LOGIN_ID = /^login:(?:user|pass|data):(\d+):(\d+)$/

// Toda edição da resposta é Components V2: a flag não sai depois de posta
const text = (content: string) => new TextDisplayBuilder().setContent(content)
const status = (content: string) => ({
    components: [text(content)],
    flags: MessageFlags.IsComponentsV2 as const,
})
const copyButton = (key: string, index: number) =>
    new ButtonBuilder()
        .setCustomId(`login:data:${key}:${index}`)
        .setLabel("Copiar dados")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Secondary)

type BotConfig = {
    token: string
    guildId: string
    allowedRoleId?: string | undefined
    allowedChannelId?: string | undefined
    carrierNames: (ip: string) => string[] | undefined
    magnus?: MagnusLookup | undefined
    // /inativar só existe com o Magnus configurado
    inactivator?: Inactivator | undefined
    sipHost: string
}

export const startBot = async (config: BotConfig, buffer: InviteBuffer) => {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds],
        allowedMentions: { parse: [] },
    })

    // Falha no Magnus não derruba a resposta: o bot ainda diz que o número chegou
    const render = async (event: InviteEvent) => {
        let did: DidInfo | null | undefined
        let note = config.magnus
            ? ""
            : "\n**Magnus:** não configurado (falta MAGNUS_DB_URL)"
        try {
            did = config.magnus ? await config.magnus(event.key) : undefined
        } catch (error) {
            console.error("Falha ao consultar o Magnus:", error)
            note = "\n**Magnus:** consulta falhou, veja o log do serviço"
        }
        const container = new ContainerBuilder()
            .setAccentColor(inviteColor(did))
            .addTextDisplayComponents(
                text(`## Número ${event.key} está conosco`),
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
                text(
                    describeInvite(
                        event,
                        config.carrierNames(event.srcIp),
                        did,
                    ) + note,
                ),
            )
        for (const [i, account] of (did?.sipAccounts ?? [])
            .slice(0, MAX_ACCOUNTS)
            .entries()) {
            container
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(text(describeLogin(account)))
                .addActionRowComponents(
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        copyButton(event.key, i),
                    ),
                )
        }
        container
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(text(describeFooter(event)))
        return {
            components: [container],
            flags: MessageFlags.IsComponentsV2 as const,
        }
    }

    // Comando antigo continua valendo onde foi registrado: remove os comandos do bot de qualquer outro servidor e do escopo global
    const removeStale = async <T extends { name: string }>(
        list: () => Promise<Map<string, T>>,
        remove: (command: T) => Promise<unknown>,
    ) => {
        for (const command of (await list()).values()) {
            if (COMMAND_NAMES.has(command.name)) await remove(command)
        }
    }

    const onReady = async (ready: Client<true>) => {
        await ready.application.commands.set(
            [
                {
                    name: "numero",
                    description: "Verifica se um número já está conosco",
                    options: [
                        {
                            name: "numero",
                            description: "Ex: 551133334444",
                            type: ApplicationCommandOptionType.String,
                            required: true,
                        },
                    ],
                },
                ...(config.inactivator
                    ? [
                          {
                              name: "inativar",
                              description:
                                  "Libera e inativa um DID no Magnus (um por vez)",
                              options: [
                                  {
                                      name: "numero",
                                      description:
                                          "Só dígitos, ex: 551133334444",
                                      type: ApplicationCommandOptionType.String as const,
                                      required: true,
                                      min_length: 10,
                                      max_length: 14,
                                  },
                                  {
                                      name: "motivo",
                                      description:
                                          "Quem pediu e por quê (vai para o histórico do Magnus)",
                                      type: ApplicationCommandOptionType.String as const,
                                      required: true,
                                      min_length: 3,
                                      max_length: 200,
                                  },
                              ],
                          },
                      ]
                    : []),
            ],
            config.guildId,
        )

        const cleanups = [
            removeStale(
                () => ready.application.commands.fetch(),
                (command) => ready.application.commands.delete(command),
            ),
            ...[...ready.guilds.cache.values()]
                .filter((guild) => guild.id !== config.guildId)
                .map((guild) =>
                    removeStale(
                        () => guild.commands.fetch(),
                        (command) => guild.commands.delete(command),
                    ),
                ),
        ]
        for (const cleanup of cleanups) {
            await cleanup.catch((error) =>
                console.error("Falha ao limpar comandos antigos:", error),
            )
        }
    }
    client.once(Events.ClientReady, (ready) => {
        onReady(ready).catch((error) =>
            console.error("Falha ao registrar comandos:", error),
        )
    })

    // O Discord entrega a interação de qualquer servidor onde o comando exista: só o do .env é atendido
    const refusal = (i: ChatInputCommandInteraction | ButtonInteraction) => {
        if (i.guildId !== config.guildId) {
            return "Este bot não está autorizado neste servidor."
        }
        if (!i.inCachedGuild()) return "Sem permissão."
        const denied =
            (config.allowedChannelId &&
                i.channelId !== config.allowedChannelId) ||
            (config.allowedRoleId &&
                !i.member.roles.cache.has(config.allowedRoleId))
        return denied ? "Sem permissão." : null
    }

    const handleNumero = async (interaction: ChatInputCommandInteraction) => {
        const denied = refusal(interaction)
        if (denied) {
            await interaction.reply({
                content: denied,
                flags: MessageFlags.Ephemeral,
            })
            return
        }

        const key = numberKey(interaction.options.getString("numero", true))
        if (!key) {
            await interaction.reply({
                content: "Número inválido. Use DDD + número, ex: 551133334444.",
                flags: MessageFlags.Ephemeral,
            })
            return
        }

        await interaction.deferReply()
        const found = buffer.find(key)
        if (found) {
            await interaction.editReply(await render(found))
            return
        }

        await interaction.editReply(
            status(
                `Nenhum INVITE para **${key}** nos últimos 30 min. Aguardando ligação por 2 min, ligue agora.`,
            ),
        )
        const arrived = await buffer.wait(key, WAIT_MS)
        await interaction.editReply(
            arrived
                ? await render(arrived)
                : status(`Nenhum INVITE para **${key}** chegou em 2 min.`),
        )
    }

    // Um DID por vez, só dígitos, confirmação por botão de quem pediu. A transação confere o DID de novo antes de escrever.
    const handleInativar = async (interaction: ChatInputCommandInteraction) => {
        const denied = refusal(interaction)
        if (denied || !config.inactivator) {
            await interaction.reply({
                content: denied ?? "Comando indisponível.",
                flags: MessageFlags.Ephemeral,
            })
            return
        }

        const input = parseDidInput(
            interaction.options.getString("numero", true),
        )
        if (!input) {
            await interaction.reply({
                content:
                    "Número inválido. Use só dígitos, de 10 a 14, ex: 551133334444.",
                flags: MessageFlags.Ephemeral,
            })
            return
        }

        const reason = cleanReason(
            interaction.options.getString("motivo", true),
        )
        if (!reason) {
            await interaction.reply({
                content: "Motivo inválido. Use de 3 a 200 caracteres.",
                flags: MessageFlags.Ephemeral,
            })
            return
        }

        await interaction.deferReply()
        const preview = await config.inactivator.preview(
            input.key,
            input.digits,
        )
        if (preview.kind === "none") {
            await interaction.editReply(
                status(`Nenhum DID cadastrado para **${input.key}**.`),
            )
            return
        }
        if (preview.kind === "many") {
            await interaction.editReply(status(describeAmbiguous(preview.dids)))
            return
        }
        const { target } = preview
        if (preview.kind === "done") {
            await interaction.editReply(
                status(
                    `DID **${target.did}** já está inativo, não reservado e sem destinos. Nada foi alterado.`,
                ),
            )
            return
        }

        const message = await interaction.editReply({
            components: [
                new ContainerBuilder()
                    .setAccentColor(0xff6900)
                    .addTextDisplayComponents(
                        text(`## Inativar DID ${target.did}?`),
                    )
                    .addSeparatorComponents(new SeparatorBuilder())
                    .addTextDisplayComponents(
                        text(describeInactivationPreview(target, reason)),
                    )
                    .addActionRowComponents(
                        new ActionRowBuilder<ButtonBuilder>().addComponents(
                            new ButtonBuilder()
                                .setCustomId("inativar:ok")
                                .setLabel("Inativar")
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId("inativar:no")
                                .setLabel("Cancelar")
                                .setStyle(ButtonStyle.Secondary),
                        ),
                    ),
            ],
            flags: MessageFlags.IsComponentsV2,
        })
        const click = await message
            .awaitMessageComponent({
                componentType: ComponentType.Button,
                filter: (i) => i.user.id === interaction.user.id,
                time: CONFIRM_MS,
            })
            .catch(() => null)
        if (!click) {
            await interaction.editReply(
                status("Confirmação expirou. Nada foi alterado."),
            )
            return
        }
        if (click.customId !== "inativar:ok") {
            await click.update(status("Cancelado. Nada foi alterado."))
            return
        }

        await click.deferUpdate()
        const actor = `${interaction.user.username} (${interaction.user.id})`
        // Só o run() entra no catch: depois do COMMIT uma falha do Discord não pode virar "erro ao inativar"
        const done = await config.inactivator
            .run(target, actor, reason)
            .catch(async (error: unknown) => {
                if (!(error instanceof InactivationError)) {
                    console.error("Falha ao inativar:", error)
                }
                await click.editReply(
                    status(
                        error instanceof InactivationError
                            ? error.message
                            : "Erro ao inativar, veja o log do serviço. A transação é desfeita se falhar.",
                    ),
                )
                return null
            })
        if (!done) return

        console.log(
            JSON.stringify({
                event: "did_inativado",
                actor,
                reason,
                did: done.did,
                id: done.id,
                previous: {
                    owner: done.owner,
                    activated: done.activated,
                    reserved: done.reserved,
                    destinations: done.destinations,
                },
            }),
        )
        await click
            .editReply({
                components: [
                    new ContainerBuilder()
                        .setAccentColor(0x00bc7d)
                        .addTextDisplayComponents(
                            text(`## DID ${done.did} inativado`),
                        )
                        .addSeparatorComponents(new SeparatorBuilder())
                        .addTextDisplayComponents(
                            text(
                                describeInactivated(
                                    done,
                                    interaction.user.id,
                                    Date.now(),
                                    reason,
                                ),
                            ),
                        ),
                ],
                flags: MessageFlags.IsComponentsV2,
            })
            .catch((error) =>
                console.error(
                    `DID ${done.did} inativado, mas a resposta no Discord falhou:`,
                    error,
                ),
            )
    }

    // O segredo não viaja no custom_id (visível ao cliente): relê do Magnus e responde só a quem clicou
    const handleLogin = async (interaction: ButtonInteraction) => {
        const denied = refusal(interaction)
        const match = LOGIN_ID.exec(interaction.customId)
        if (denied || !match) {
            await interaction.reply({
                content: denied ?? "Botão inválido.",
                flags: MessageFlags.Ephemeral,
            })
            return
        }
        const [, key, index] = match
        const did = await config.magnus?.(key as string)
        const account = did?.sipAccounts[Number(index)]
        await interaction.reply({
            content:
                did && account
                    ? `\`\`\`\n${describeCredentials(did, account, config.sipHost)}\n\`\`\``
                    : "Conta SIP não encontrada, consulte o número de novo.",
            flags: MessageFlags.Ephemeral,
        })
    }

    // Erro na interação não pode virar unhandled rejection: derrubaria o processo e perderia a janela de INVITEs
    client.on(Events.InteractionCreate, async (interaction) => {
        const isCommand =
            interaction.isChatInputCommand() &&
            COMMAND_NAMES.has(interaction.commandName)
        const isLogin =
            interaction.isButton() && interaction.customId.startsWith("login:")
        if (!isCommand && !isLogin) return
        try {
            if (interaction.isChatInputCommand()) {
                if (interaction.commandName === "inativar")
                    await handleInativar(interaction)
                else await handleNumero(interaction)
            } else if (interaction.isButton()) await handleLogin(interaction)
        } catch (error) {
            console.error("Falha ao atender a interação:", error)
            const content = "Erro interno ao consultar, tente de novo."
            await (interaction.deferred || interaction.replied
                ? interaction.editReply(status(content))
                : interaction.reply({
                      content,
                      flags: MessageFlags.Ephemeral,
                  })
            ).catch(() => {})
        }
    })

    client.on(Events.Error, (error) =>
        console.error("Erro no cliente Discord:", error),
    )

    await client.login(config.token)
}

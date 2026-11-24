// Bot Discord: slash command /numero consulta a janela de INVITEs e espera uma ligação nova se preciso.
import {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    type ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    Events,
    GatewayIntentBits,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
} from "discord.js"
import type { InviteBuffer, InviteEvent } from "./buffer"
import {
    describeFooter,
    describeInvite,
    describeLogin,
    inviteColor,
} from "./format"
import type { DidInfo, MagnusLookup } from "./magnus"
import { numberKey } from "./number"

const WAIT_MS = 120_000
const MAX_ACCOUNTS = 3
const LOGIN_ID = /^login:(user|pass):(\d+):(\d+)$/

// Toda edição da resposta é Components V2: a flag não sai depois de posta
const text = (content: string) => new TextDisplayBuilder().setContent(content)
const status = (content: string) => ({
    components: [text(content)],
    flags: MessageFlags.IsComponentsV2 as const,
})
const copyButton = (field: "user" | "pass", key: string, index: number) =>
    new ButtonBuilder()
        .setCustomId(`login:${field}:${key}:${index}`)
        .setLabel(field === "user" ? "Copiar usuário" : "Copiar senha")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Secondary)

type BotConfig = {
    token: string
    guildId: string
    allowedRoleId?: string | undefined
    allowedChannelId?: string | undefined
    carrierNames: (ip: string) => string[] | undefined
    magnus?: MagnusLookup | undefined
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
                        copyButton("user", event.key, i),
                        copyButton("pass", event.key, i),
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

    // Comando antigo continua valendo onde foi registrado: remove o /numero de qualquer outro servidor e do escopo global
    const removeStale = async <T extends { name: string }>(
        list: () => Promise<Map<string, T>>,
        remove: (command: T) => Promise<unknown>,
    ) => {
        for (const command of (await list()).values()) {
            if (command.name === "numero") await remove(command)
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
                console.error("Falha ao limpar /numero antigo:", error),
            )
        }
    }
    client.once(Events.ClientReady, (ready) => {
        onReady(ready).catch((error) =>
            console.error("Falha ao registrar /numero:", error),
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
        const [, field, key, index] = match
        const did = await config.magnus?.(key as string)
        const account = did?.sipAccounts[Number(index)]
        const value = field === "user" ? account?.username : account?.secret
        await interaction.reply({
            // Crase no valor fecharia o bloco: nesse caso usa código em linha com crase dupla
            content: value
                ? value.includes("`")
                    ? `\`\` ${value} \`\``
                    : `\`\`\`\n${value}\n\`\`\``
                : "Conta SIP não encontrada, consulte o número de novo.",
            flags: MessageFlags.Ephemeral,
        })
    }

    // Erro na interação não pode virar unhandled rejection: derrubaria o processo e perderia a janela de INVITEs
    client.on(Events.InteractionCreate, async (interaction) => {
        const isCommand =
            interaction.isChatInputCommand() &&
            interaction.commandName === "numero"
        const isLogin =
            interaction.isButton() && interaction.customId.startsWith("login:")
        if (!isCommand && !isLogin) return
        try {
            if (interaction.isChatInputCommand())
                await handleNumero(interaction)
            else if (interaction.isButton()) await handleLogin(interaction)
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

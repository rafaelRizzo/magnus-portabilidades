// Bot Discord: slash command /numero consulta a janela de INVITEs e espera uma ligação nova se preciso.
import {
    ApplicationCommandOptionType,
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    MessageFlags,
} from "discord.js"
import type { InviteBuffer, InviteEvent } from "./buffer"
import { describeInvite, inviteColor } from "./format"
import type { DidInfo, MagnusLookup } from "./magnus"
import { numberKey } from "./number"

const WAIT_MS = 120_000

type BotConfig = {
    token: string
    guildId: string
    allowedRoleId?: string | undefined
    allowedChannelId?: string | undefined
    carrierNames: (ip: string) => string[] | undefined
    magnus?: MagnusLookup | undefined
}

export const startBot = async (config: BotConfig, buffer: InviteBuffer) => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] })

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
        const embed = new EmbedBuilder()
            .setColor(inviteColor(did))
            .setTitle(`Número ${event.called} está conosco`)
            .setDescription(
                describeInvite(event, config.carrierNames(event.srcIp), did) +
                    note,
            )
        return { content: "", embeds: [embed] }
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

    client.once(Events.ClientReady, async (ready) => {
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
    })

    client.on(Events.InteractionCreate, async (interaction) => {
        if (
            !interaction.isChatInputCommand() ||
            interaction.commandName !== "numero"
        )
            return
        // O Discord entrega a interação de qualquer servidor onde o comando exista: só o do .env é atendido
        if (interaction.guildId !== config.guildId) {
            await interaction.reply({
                content: "Este bot não está autorizado neste servidor.",
                flags: MessageFlags.Ephemeral,
            })
            return
        }
        if (!interaction.inCachedGuild()) return

        const denied =
            (config.allowedChannelId &&
                interaction.channelId !== config.allowedChannelId) ||
            (config.allowedRoleId &&
                !interaction.member.roles.cache.has(config.allowedRoleId))
        if (denied) {
            await interaction.reply({
                content: "Sem permissão.",
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
            `Nenhum INVITE para **${key}** nos últimos 30 min. Aguardando ligação por 2 min, ligue agora.`,
        )
        const arrived = await buffer.wait(key, WAIT_MS)
        await interaction.editReply(
            arrived
                ? await render(arrived)
                : `Nenhum INVITE para **${key}** chegou em 2 min.`,
        )
    })

    await client.login(config.token)
}

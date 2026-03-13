import { type Context } from 'grammy';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export async function newtopicCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  // Only works in private chats with topic mode enabled
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Use this command in DM with the bot.');
    return;
  }

  const text = ctx.message?.text ?? '';
  const args = text.replace(/^\/newtopic\s*/i, '').trim();

  const parts = args.split(/\s+/);
  const topicName = parts[0];
  if (!topicName) {
    await ctx.reply(
      'Usage: /newtopic &lt;name&gt; [working_dir]\n\n' +
      'Creates a new topic with its own Claude session.\n' +
      'Example: /newtopic my-project /path/to/project',
      { parse_mode: 'HTML' },
    );
    return;
  }

  const workingDir = parts.slice(1).join(' ') || config.paths.defaultWorkingDir;

  try {
    const topic = await ctx.api.createForumTopic(chatId, `\u{1F4C1} ${topicName}`);
    const threadId = topic.message_thread_id;

    await ctx.api.sendMessage(chatId, `Session ready in <b>${workingDir}</b>.\nSend a message to start.`, {
      parse_mode: 'HTML',
      message_thread_id: threadId,
    });

    logger.info({ userId, chatId, threadId, topicName, workingDir }, 'New topic created');
  } catch (err: any) {
    if (err?.description?.includes('TOPICS_NOT_ENABLED') || err?.error_code === 400) {
      await ctx.reply(
        'Topic mode is not enabled.\n' +
        'Enable it in @BotFather \u2192 Bot Settings \u2192 Threaded Mode.',
      );
    } else {
      logger.error({ err, userId }, 'Failed to create topic');
      await ctx.reply('Failed to create topic. Check bot permissions.');
    }
  }
}

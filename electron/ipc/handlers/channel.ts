import { CHANNELS } from '../../../shared/types';
import type { SettingsPatch } from '../../../shared/types';
import { cleanScores, feedbackSummary } from '../../../shared/clipFeedback';
import { checkTools } from '../../services/tools';
import type { IpcContext } from '../helpers';
import { str, obj } from '../helpers';

/** Ajustes, herramientas, Twitch y vigilante del canal. */
export function registerChannel({ handle, ctx, platform }: IpcContext): void {
  handle(CHANNELS.settingsGet, () => ctx.settings.get());
  handle(CHANNELS.settingsSet, (patch) => ctx.settings.set(obj(patch, 'ajustes') as SettingsPatch));
  handle(CHANNELS.pickFolder, () => platform.pickFolder());
  handle(CHANNELS.toolsCheck, () => checkTools(ctx.tools()));

  handle(CHANNELS.twitchTest, () => ctx.twitch.testConnection(ctx.settings.twitchCreds()));
  handle(CHANNELS.twitchVods, () => ctx.twitch.listVods(ctx.settings.twitchCreds()));

  handle(CHANNELS.channelStatus, () => ctx.channel.status());
  handle(CHANNELS.channelRefresh, () => ctx.channel.poll());
  handle(CHANNELS.channelAnalyze, (id) => ctx.channel.analyze(str(id, 'id')));
  handle(CHANNELS.channelClips, (force, login) => (typeof login === 'string' && login.trim() ? ctx.channel.clipsOf(login, force === true) : ctx.channel.clips(force === true)));
  handle(CHANNELS.channelImportClip, (id) => ctx.channel.importClip(str(id, 'clip')));
  handle(CHANNELS.clipCorrect, (id, scores) => {
    const v = cleanScores(scores);
    if (!v) throw new Error('Las notas deben estar entre 0 y 10.');
    return ctx.clipScores.correct(str(id, 'clip'), v);
  });
  handle(CHANNELS.clipCorrectUndo, (id) => {
    ctx.clipScores.undoCorrection(str(id, 'clip'));
  });
  handle(CHANNELS.clipFeedbackGet, () => feedbackSummary(ctx.clipFeedback.all()));
  handle(CHANNELS.clipFeedbackClear, () => ctx.clipFeedback.clear());
  handle(CHANNELS.channelClipStream, (id) => ctx.channel.clipStream(str(id, 'clip')));
  handle(CHANNELS.channelAuto, (on) => {
    if (typeof on !== 'boolean') throw new Error('Valor no válido.');
    return ctx.channel.setAutoImport(on);
  });

}

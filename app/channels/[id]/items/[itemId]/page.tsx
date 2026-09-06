import { AppError } from "@/lib/api";
import { getChannel } from "@/lib/channels/service";
import { getMediaItem } from "@/lib/media-items/service";
import { PageHeader } from "@/components/page-header";
import { MediaItemEditor } from "@/components/media-item-editor";

export const dynamic = "force-dynamic";

export default async function MediaItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const [channel, mediaItem] = await Promise.all([getChannel(id), getMediaItem(itemId)]);
  if (!channel.items.some((item) => item.mediaItemId === itemId)) {
    throw new AppError("MEDIA_ITEM_NOT_IN_CHANNEL", "This media item is not part of the channel.", 404);
  }
  const render = mediaItem.renders.find((entry) => entry.templateId === channel.templateId) ?? null;

  return <>
    <PageHeader eyebrow={channel.name} title={mediaItem.title} />
    <MediaItemEditor
      channelId={channel.id}
      mediaItem={{ id: mediaItem.id, title: mediaItem.title, artist: mediaItem.artist, album: mediaItem.album, year: mediaItem.year, genre: mediaItem.genre, customFieldsJson: mediaItem.customFieldsJson }}
      template={{ id: channel.template.id, name: channel.template.name, htmlTemplate: channel.template.htmlTemplate, bindingsJson: channel.template.bindingsJson }}
      render={render ? { status: render.status, error: render.error } : null}
    />
  </>;
}

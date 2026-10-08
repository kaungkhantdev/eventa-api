import type {
  NotificationFeedDto,
  NotificationsReadDto,
} from './dto/notification-feed.dto';
import type { NotificationFeedView } from './notification-feed.service';

/** Domain view → the wire shape. Instants become ISO UTC; nothing else moves. */
export function toNotificationFeed(
  view: NotificationFeedView,
): NotificationFeedDto {
  return {
    counts: view.counts,
    groups: view.groups.map((group) => ({
      bucket: group.bucket,
      recent: group.recent,
      items: group.items.map((item) => ({
        ...item,
        at: item.at.toISOString(),
      })),
    })),
    readAt: view.readAt?.toISOString() ?? null,
  };
}

export function toNotificationsRead(result: {
  readAt: Date;
  unread: number;
}): NotificationsReadDto {
  return { readAt: result.readAt.toISOString(), unread: result.unread };
}

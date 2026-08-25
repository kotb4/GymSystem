export type NotificationType = "expiry" | "payment" | "system" | "info";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  time: string;
  unread: boolean;
}

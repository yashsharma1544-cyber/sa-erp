export type OrderStatus =
  | "pending_approval" | "approved" | "rejected" | "loading" | "invoiced" | "dispatched" | "delivered" | "closed" | "cancelled";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_approval: "Waiting approval",
  approved: "Approved",
  rejected: "Rejected",
  loading: "Loading",
  invoiced: "Invoiced",
  dispatched: "Dispatched",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<OrderStatus, "neutral" | "green" | "amber" | "red" | "blue"> = {
  pending_approval: "amber",
  approved: "green",
  rejected: "red",
  loading: "blue",
  invoiced: "blue",
  dispatched: "blue",
  delivered: "green",
  closed: "neutral",
  cancelled: "neutral",
};

export const SOURCE_LABEL: Record<string, string> = {
  salesman: "Salesman",
  office: "Office",
  whatsapp_paste: "WhatsApp",
  counter: "Counter",
};

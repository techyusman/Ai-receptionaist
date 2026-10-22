import {
  Ban,
  Bell,
  CircleCheck,
  CircleCheckBig,
  CircleQuestionMark,
  CircleX,
  EyeOff,
  ListChecks,
  Loader,
  MessageCircle,
  PencilLine,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Plug,
  RefreshCw,
  Send,
  ShoppingBag,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export type StatusMeta = { label: string; tone: Tone; icon: LucideIcon; spin?: boolean };

export const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted",
  accent: "bg-accent-subtle text-accent",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
};

// One vocabulary for every screen. Labels are ours; see replica/design/components.md.
export const statusVocabulary = {
  order: {
    DRAFT: { label: "Taking order", tone: "neutral", icon: PencilLine },
    NEEDS_CLARIFICATION: { label: "Needs details", tone: "neutral", icon: CircleQuestionMark },
    READY_FOR_CONFIRMATION: { label: "Reading back", tone: "neutral", icon: ListChecks },
    CUSTOMER_CONFIRMED: { label: "Caller confirmed", tone: "accent", icon: CircleCheck },
    SUBMISSION_PENDING: { label: "Sending…", tone: "accent", icon: Loader, spin: true },
    SUBMISSION_UNKNOWN: { label: "Check needed", tone: "warning", icon: TriangleAlert },
    SUBMITTED_TO_POS: { label: "New ticket", tone: "accent", icon: Bell },
    SUBMITTED_TO_SQUARE: { label: "In Square", tone: "accent", icon: Send },
    POS_VISIBILITY_UNVERIFIED: { label: "In Square, not seen yet", tone: "warning", icon: EyeOff },
    RECEIVED_BY_RESTAURANT: { label: "Accepted", tone: "success", icon: CircleCheckBig },
    TRANSFERRED_TO_STAFF: { label: "Passed to staff", tone: "neutral", icon: PhoneForwarded },
    ABANDONED: { label: "Caller hung up", tone: "neutral", icon: PhoneOff },
    FAILED: { label: "Failed", tone: "danger", icon: CircleX },
    CANCELLED: { label: "Cancelled", tone: "neutral", icon: Ban },
  },
  call: {
    INFO_RESOLVED: { label: "Answered", tone: "success", icon: MessageCircle },
    ORDER_SUBMITTED: { label: "Order placed", tone: "accent", icon: ShoppingBag },
    TRANSFERRED: { label: "Transferred", tone: "neutral", icon: PhoneForwarded },
    STAFF_ANSWERED: { label: "Staff picked up", tone: "neutral", icon: Phone },
    CALLBACK_REQUESTED: { label: "Callback", tone: "warning", icon: PhoneCall },
    CALLER_HUNG_UP: { label: "Hung up", tone: "neutral", icon: PhoneOff },
    FAILED: { label: "Failed", tone: "danger", icon: CircleX },
  },
  sync: {
    fresh: { label: "Menu up to date", tone: "success", icon: RefreshCw },
    running: { label: "Syncing menu…", tone: "accent", icon: RefreshCw, spin: true },
    stale: { label: "Menu out of date", tone: "warning", icon: TriangleAlert },
    failed: { label: "Sync failed", tone: "danger", icon: CircleX },
  },
  square: {
    CONNECTED: { label: "Connected", tone: "success", icon: Plug },
    NEEDS_REAUTH: { label: "Reconnect Square", tone: "danger", icon: Unplug },
    REVOKED: { label: "Reconnect Square", tone: "danger", icon: Unplug },
  },
} as const satisfies Record<string, Record<string, StatusMeta>>;

export type StatusDomain = keyof typeof statusVocabulary;
export type StatusValue<D extends StatusDomain> = keyof (typeof statusVocabulary)[D];

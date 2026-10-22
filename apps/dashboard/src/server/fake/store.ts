import "server-only";
import { EventEmitter } from "node:events";
import type { Menu, Order, OrderEvent } from "@receptionist/domain";
import type {
  Alert,
  AuditEntry,
  Callback,
  CallDetail,
  Faq,
  Hours,
  Integration,
  Invitation,
  LiveEvent,
  Location,
  MenuSyncState,
  Notice,
  PhoneNumber,
  Pronunciation,
  Role,
  Settings,
  SpecialHours,
  SquareLocationOption,
  SubmissionAttempt,
  TransferTarget,
  User,
} from "@/data/types";
import { seed } from "./seed";

export type MembershipRow = {
  id: string;
  userId: string;
  restaurantId: string;
  locationId: string | null;
  role: Role;
  status: "ACTIVE" | "REVOKED";
};

export type StoredEvent = OrderEvent & { actorUserId: string | null };

export type State = {
  users: (User & { lastSeenAt: string | null })[];
  restaurant: { id: string; name: string; slug: string };
  memberships: MembershipRow[];
  invitations: (Invitation & { locationId: string | null })[];
  locations: Location[];
  settings: Record<string, Settings>;
  phoneNumbers: Record<string, PhoneNumber[]>;
  transferTargets: Record<string, TransferTarget[]>;
  hours: Record<string, Hours>;
  specialHours: Record<string, SpecialHours[]>;
  notices: Record<string, Notice[]>;
  faqs: Record<string, Faq[]>;
  pronunciations: Record<string, Pronunciation[]>;
  integrations: Record<string, Integration>;
  squareLocations: SquareLocationOption[];
  menus: Record<string, Menu>;
  menuSync: Record<string, { state: MenuSyncState; lastSuccessAt: string | null; lastErrorCode: string | null }>;
  calls: (CallDetail & { locationId: string })[];
  orders: Order[];
  orderEvents: Record<string, StoredEvent[]>;
  attempts: Record<string, SubmissionAttempt[]>;
  callbacks: (Callback & { locationId: string })[];
  alerts: (Alert & { locationId: string })[];
  audit: AuditEntry[];
};

type Store = { state: State; events: EventEmitter };

const g = globalThis as unknown as { __receptionistFakeStore?: Store };

/**
 * One in-memory store per Node process, shared by pages, server actions and the live stream.
 * Kept on globalThis so dev-server module reloads don't fork it. Data resets on restart.
 */
export function store(): Store {
  if (!g.__receptionistFakeStore) {
    const events = new EventEmitter();
    events.setMaxListeners(200);
    g.__receptionistFakeStore = { state: seed(new Date()), events };
  }
  return g.__receptionistFakeStore;
}

export function emit(locationId: string, event: LiveEvent) {
  store().events.emit(`live:${locationId}`, event);
}

export function subscribe(locationId: string, fn: (e: LiveEvent) => void): () => void {
  const { events } = store();
  events.on(`live:${locationId}`, fn);
  return () => events.off(`live:${locationId}`, fn);
}

import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.ts";
import { registerAdminRoutes } from "./admin.ts";
import { registerAgentRoutes } from "./agent.ts";
import { registerAnalyticsRoutes } from "./analytics.ts";
import { registerCallRoutes } from "./calls.ts";
import { registerHoursRoutes } from "./hours.ts";
import { registerInboxRoutes } from "./inbox.ts";
import { registerKnowledgeRoutes } from "./knowledge.ts";
import { registerLiveRoutes } from "./live.ts";
import { registerLocationRoutes } from "./location.ts";
import { registerMeRoutes } from "./me.ts";
import { registerMenuRoutes } from "./menu.ts";
import { registerNoticeRoutes } from "./notices.ts";
import { registerOrderRoutes } from "./orders.ts";
import { registerPhoneRoutes } from "./phone.ts";
import { registerSetupRoutes } from "./setup.ts";
import { registerSquareRoutes } from "./square.ts";
import { registerTeamRoutes } from "./team.ts";

export async function registerRoutes(api: FastifyInstance, deps: Deps): Promise<void> {
  registerMeRoutes(api, deps);
  registerLocationRoutes(api, deps);
  registerHoursRoutes(api, deps);
  registerNoticeRoutes(api, deps);
  registerKnowledgeRoutes(api, deps);
  registerAgentRoutes(api, deps);
  registerPhoneRoutes(api, deps);
  registerMenuRoutes(api, deps);
  registerOrderRoutes(api, deps);
  registerCallRoutes(api, deps);
  registerInboxRoutes(api, deps);
  registerAnalyticsRoutes(api, deps);
  registerTeamRoutes(api, deps);
  registerAdminRoutes(api, deps);
  registerSetupRoutes(api, deps);
  registerSquareRoutes(api, deps);
  registerLiveRoutes(api, deps);
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeOperation, type ToolCtx, type ExecuteArgs } from "../execute.js";

export interface CuratedSpec {
  name: string;
  operationId: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations: Record<string, boolean>;
  map: (args: any) => ExecuteArgs;
}

const RF = z.enum(["concise", "detailed"]).optional();
const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

export const CURATED_TOOLS: CuratedSpec[] = [
  // ---- Alerts ----
  {
    name: "ir_list_alerts",
    operationId: "listAlertGroups",
    title: "List alert groups",
    description:
      "List/search alert groups. Filter by status (firing/acknowledged/resolved), team, severity. Paginated. Use to find alerts to act on.",
    inputSchema: {
      status: z.string().optional(),
      team_id: z.number().int().optional(),
      severity: z.string().optional(),
      page: z.number().int().min(1).optional(),
      page_size: z.number().int().min(1).max(100).optional(),
      response_format: RF,
    },
    annotations: READ,
    map: (a) => ({
      operationId: "listAlertGroups",
      query: { status: a.status, team_id: a.team_id, severity: a.severity, page: a.page, page_size: a.page_size },
      response_format: a.response_format,
    }),
  },
  {
    name: "ir_get_alert",
    operationId: "getAlertGroup",
    title: "Get an alert group",
    description: "Fetch one alert group by id, including its events and current state.",
    inputSchema: { alert_id: z.number().int(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "getAlertGroup", pathParams: { alert_id: a.alert_id }, response_format: a.response_format }),
  },
  {
    name: "ir_ack_alert",
    operationId: "acknowledgeAlertGroup",
    title: "Acknowledge an alert group",
    description: "Acknowledge an alert group, stopping reminders/escalation. Optionally attribute the acknowledgement to a user id.",
    inputSchema: { alert_id: z.number().int(), user_id: z.number().int().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "acknowledgeAlertGroup", pathParams: { alert_id: a.alert_id }, body: a.user_id ? { user_id: a.user_id } : undefined }),
  },
  {
    name: "ir_resolve_alert",
    operationId: "resolveAlertGroup",
    title: "Resolve an alert group",
    description: "Resolve/close an alert group. Optionally attribute the resolution to a user id. Add context via ir_comment_alert.",
    inputSchema: { alert_id: z.number().int(), user_id: z.number().int().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "resolveAlertGroup", pathParams: { alert_id: a.alert_id }, body: a.user_id ? { user_id: a.user_id } : undefined }),
  },
  {
    name: "ir_comment_alert",
    operationId: "createAlertGroupComment",
    title: "Comment on an alert group",
    description: "Add a comment to an alert group's timeline.",
    inputSchema: { alert_id: z.number().int(), comment: z.string() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createAlertGroupComment", pathParams: { alert_id: a.alert_id }, body: { body: a.comment } }),
  },

  // ---- Incidents (v2.3 "first-class incidents"; operationIds are synthesized from paths in the live OpenAPI) ----
  {
    name: "ir_list_incidents",
    operationId: "get_api_incidents",
    title: "List incidents",
    description: "List/search first-class incidents. Paginated.",
    inputSchema: { page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "get_api_incidents", query: { page: a.page, page_size: a.page_size }, response_format: a.response_format }),
  },
  {
    name: "ir_get_incident",
    operationId: "get_api_incidents_incident_id",
    title: "Get an incident",
    description: "Fetch one incident by id, including operational events and linked alert groups.",
    inputSchema: { incident_id: z.number().int(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "get_api_incidents_incident_id", pathParams: { incident_id: a.incident_id }, response_format: a.response_format }),
  },
  {
    name: "ir_create_incident",
    operationId: "post_api_incidents",
    title: "Create an incident",
    description: "Open a new incident manually. Requires a title and the owning team_id; priority is an optional p1-p5 string.",
    inputSchema: {
      title: z.string(),
      team_id: z.number().int(),
      description: z.string().optional(),
      priority: z.enum(["p1", "p2", "p3", "p4", "p5"]).optional(),
      service_id: z.number().int().optional(),
    },
    annotations: WRITE,
    map: (a) => ({
      operationId: "post_api_incidents",
      body: { title: a.title, team_id: a.team_id, description: a.description, priority: a.priority, service_id: a.service_id },
    }),
  },

  // ---- On-call ----
  {
    name: "ir_who_is_on_call",
    operationId: "getOnCallCalendar",
    title: "Who is on call",
    description: "Return current/upcoming on-call schedule from the calendar. Optionally scope by team and time range.",
    inputSchema: { team_id: z.number().int().optional(), from: z.string().optional(), to: z.string().optional(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "getOnCallCalendar", query: { team_id: a.team_id, from: a.from, to: a.to }, response_format: a.response_format }),
  },
  {
    name: "ir_oncall_health",
    operationId: "listTeamHealthSummaries",
    title: "On-call health summaries",
    description: "List on-call health summaries per team (coverage gaps, rotation issues).",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listTeamHealthSummaries", response_format: a.response_format }),
  },
  {
    name: "ir_list_rotations",
    operationId: "listRotations",
    title: "List rotations",
    description: "List on-call rotations.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listRotations", response_format: a.response_format }),
  },
  {
    name: "ir_create_rotation_override",
    operationId: "createRotationOverride",
    title: "Create a rotation override",
    description: "Override who is on call for a rotation over a time window (e.g. cover a shift).",
    inputSchema: { rotation_id: z.number().int(), user_id: z.number().int(), start: z.string(), end: z.string() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createRotationOverride", pathParams: { rotation_id: a.rotation_id }, body: { user_id: a.user_id, start: a.start, end: a.end } }),
  },

  // ---- Silences ----
  {
    name: "ir_list_silences",
    operationId: "listSilences",
    title: "List silences",
    description: "List active/scheduled alert silences.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listSilences", response_format: a.response_format }),
  },
  {
    name: "ir_create_silence",
    operationId: "createSilence",
    title: "Create a silence",
    description: "Silence alerts matching label matchers for a time window.",
    inputSchema: { matchers: z.array(z.record(z.unknown())), starts_at: z.string().optional(), ends_at: z.string(), comment: z.string().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createSilence", body: { matchers: a.matchers, starts_at: a.starts_at, ends_at: a.ends_at, comment: a.comment } }),
  },
  {
    name: "ir_remove_silence",
    operationId: "disableSilence",
    title: "Remove (disable) a silence",
    description: "Disable an existing silence. Destructive: requires confirm: true.",
    inputSchema: { silence_id: z.number().int(), confirm: z.boolean().optional() },
    annotations: DESTRUCTIVE,
    map: (a) => ({ operationId: "disableSilence", pathParams: { silence_id: a.silence_id }, confirm: a.confirm }),
  },

  // ---- Maintenance ----
  {
    name: "ir_list_maintenance_windows",
    operationId: "listMaintenanceWindows",
    title: "List maintenance windows",
    description: "List planned maintenance windows.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listMaintenanceWindows", response_format: a.response_format }),
  },
  {
    name: "ir_create_maintenance_window",
    operationId: "createMaintenanceWindow",
    title: "Create a maintenance window",
    description: "Schedule a maintenance window to control alert behavior during planned work.",
    inputSchema: { title: z.string(), starts_at: z.string(), ends_at: z.string(), team_id: z.number().int().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createMaintenanceWindow", body: { title: a.title, starts_at: a.starts_at, ends_at: a.ends_at, team_id: a.team_id } }),
  },

  // ---- Context ----
  {
    name: "ir_list_teams",
    operationId: "listTeams",
    title: "List teams",
    description: "List teams (for resolving team_id used elsewhere).",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listTeams", response_format: a.response_format }),
  },
  {
    name: "ir_list_routes",
    operationId: "listRoutes",
    title: "List routes",
    description: "List alert intake routes.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listRoutes", response_format: a.response_format }),
  },
  {
    name: "ir_list_channels",
    operationId: "listChannels",
    title: "List notification channels",
    description: "List notification channels (Slack/Telegram/email/etc.).",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listChannels", response_format: a.response_format }),
  },
  {
    name: "ir_whoami",
    operationId: "getProfile",
    title: "Who am I",
    description:
      "Return the authenticated user's profile and active group for the current token. " +
      "Uses /api/profile so it works with personal API tokens (not only JWT sessions).",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "getProfile", response_format: a.response_format }),
  },

  // ---- Heartbeats (no operationId in spec; use synthesized ids) ----
  {
    name: "ir_list_heartbeats",
    operationId: "get_api_heartbeats",
    title: "List heartbeats",
    description: "List heartbeat monitors and their status.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "get_api_heartbeats", response_format: a.response_format }),
  },
  {
    name: "ir_send_heartbeat",
    operationId: "post_api_heartbeats_ping_token",
    title: "Send a heartbeat ping",
    description: "Send a heartbeat ping using the heartbeat's ping token.",
    inputSchema: { token: z.string() },
    annotations: WRITE,
    map: (a) => ({ operationId: "post_api_heartbeats_ping_token", pathParams: { token: a.token } }),
  },
];

export function registerCuratedTools(server: McpServer, ctx: ToolCtx): void {
  for (const spec of CURATED_TOOLS) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: spec.annotations,
      },
      async (args: any) => executeOperation(ctx, spec.map(args))
    );
  }
}

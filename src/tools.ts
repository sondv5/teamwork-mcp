import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AuthManager, AuthRequiredError } from "./auth.js";
import { TeamworkApi, TeamworkError, type Query } from "./client.js";

function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

const PROJECT_FIELDS = [
  "id",
  "name",
  "status",
  "companyId",
  "company",
  "categoryId",
  "startDate",
  "endDate",
  "isStarred",
  "updatedAt",
];

const TASKLIST_FIELDS = ["id", "name", "projectId", "milestoneId", "completed", "status"];

const TASK_FIELDS = [
  "id",
  "name",
  "description",
  "status",
  "priority",
  "projectId",
  "tasklistId",
  "startDate",
  "dueDate",
  "estimateMinutes",
  "completed",
  "updatedAt",
  "createdAt",
];

function list<T extends Record<string, unknown>>(
  items: T[] | undefined,
  fields: string[],
  trims: Record<string, number> = {},
): Record<string, unknown>[] {
  return (items ?? []).map((item) => {
    const out = pick(item, fields);
    for (const [key, max] of Object.entries(trims)) out[key] = trim(out[key], max);
    return out;
  });
}

function trim(value: unknown, max: number): unknown {
  return typeof value === "string" && value.length > max
    ? `${value.slice(0, max)}...`
    : value;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

let meIdPromise: Promise<number> | undefined;

function myUserId(tw: TeamworkApi): Promise<number> {
  meIdPromise ??= tw
    .get<{ person?: { id?: number } }>("/me.json")
    .then((res: { person?: { id?: number } }) => {
      const id = res.person?.id;
      if (!id) throw new Error("Cannot resolve current user id from /me.json");
      return id;
    })
    .catch((err: unknown) => {
      meIdPromise = undefined;
      throw err;
    });
  return meIdPromise;
}

const ACTIVITY_TYPES = [
  "task",
  "tasklist",
  "project",
  "message",
  "notebook",
  "milestone",
  "like",
  "file",
  "link",
  "billinginvoice",
  "task_comment",
  "milestone_comment",
  "file_comment",
  "link_comment",
  "comment",
] as const;

const WORK_FILTERS = ["all", "today", "overdue", "thisweek", "within7"] as const;

const ACTIVITY_FIELDS = [
  "id",
  "activityType",
  "latestActivityType",
  "description",
  "extraDescription",
  "dateTime",
  "fromUserName",
  "forUserName",
  "userId",
  "projectId",
  "itemId",
  "itemLink",
  "link",
  "dueDate",
];

const COMMENT_FIELDS = [
  "id",
  "body",
  "postedByUserId",
  "postedDateTime",
  "dateLastEdited",
  "contentType",
  "isPrivate",
  "fileCount",
  "reactionsCount",
];

const MILESTONE_FIELDS = [
  "id",
  "name",
  "deadline",
  "description",
  "completed",
  "completedOn",
  "percentageComplete",
  "status",
  "projectId",
  "responsiblePartyIds",
  "commentsCount",
  "createdOn",
];

const PERSON_FIELDS = [
  "id",
  "firstName",
  "lastName",
  "email",
  "title",
  "userType",
  "isAdmin",
  "isClientUser",
  "companyId",
  "inOwnerCompany",
  "deleted",
];

const UPDATE_FIELDS = [
  "id",
  "projectId",
  "health",
  "healthLabel",
  "text",
  "createdAt",
  "createdBy",
  "isActive",
];

function pageInfo(meta: unknown): unknown {
  return (meta as { page?: unknown } | undefined)?.page ?? undefined;
}

const SEARCH_INCLUDE = [
  "projects",
  "tasks",
  "tasklists",
  "milestones",
  "messages",
  "links",
  "files",
  "fileversions",
  "comments",
  "users",
  "teams",
  "companies",
  "timelogs",
  "notebooks",
];

function searchInclude(types: string[] | undefined): string[] {
  if (!types?.length || types.some((type) => type.toLowerCase() === "all")) {
    return [...SEARCH_INCLUDE];
  }
  const wanted = new Set<string>();
  for (const type of types) {
    const lower = type.toLowerCase();
    if (
      lower === "comments" ||
      lower === "taskcomments" ||
      lower === "milestonecomments" ||
      lower === "filecomments" ||
      lower === "linkcomments" ||
      lower === "notebookcomments"
    ) {
      wanted.add("comments");
      continue;
    }
    const match = SEARCH_INCLUDE.find((item) => item === lower);
    if (match) wanted.add(match);
  }
  return [...wanted];
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function searchResult(
  id: unknown,
  type: string,
  included: Record<string, Record<string, Record<string, unknown>>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id, type };
  const bucket = Object.entries(included).find(
    ([key]) => key.toLowerCase() === type.toLowerCase(),
  )?.[1];
  const details = bucket?.[String(id)];
  if (!details) return out;

  const name = details.name ?? details.title ?? details.displayName ?? details.summary;
  if (typeof name === "string" && name) out.title = trim(stripHtml(name), 200);
  if (details.status !== undefined) out.status = details.status;
  if (details.dueDate !== undefined) out.dueDate = details.dueDate;
  if (details.deadline !== undefined) out.deadline = details.deadline;
  if (details.projectId !== undefined) out.projectId = details.projectId;
  const project = details.project as { meta?: { name?: string } } | undefined;
  if (project?.meta?.name) out.projectName = project.meta.name;
  if (details.objectType !== undefined) out.objectType = details.objectType;
  if (details.objectId !== undefined) out.objectId = details.objectId;
  if (details.postedAt !== undefined) out.postedAt = details.postedAt;
  const postedBy = details.postedBy as
    | { meta?: { firstName?: string; lastName?: string } }
    | undefined;
  const author = [postedBy?.meta?.firstName, postedBy?.meta?.lastName]
    .filter(Boolean)
    .join(" ");
  if (author) out.postedBy = author;
  if (typeof details.email === "string") out.email = details.email;
  return out;
}

function lazyClient(auth: AuthManager): TeamworkApi {
  return new Proxy({} as TeamworkApi, {
    get(_target, property) {
      const client = auth.client();
      const value = (client as unknown as Record<string | symbol, unknown>)[property];
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(client)
        : value;
    },
  });
}

function makeRegister(server: McpServer, auth: AuthManager): McpServer["registerTool"] {
  const impl = (name: string, config: unknown, handler: unknown) =>
    server.registerTool(
      name,
      config as never,
      (async (args: unknown, extra: unknown) => {
        try {
          return await (handler as (a: unknown, e: unknown) => Promise<unknown>)(args, extra);
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            return { content: [{ type: "text" as const, text: err.message }], isError: true };
          }
          if (err instanceof TeamworkError && err.status === 401) {
            // Stored key was revoked/rotated. Drop it and re-enter the
            // browser setup flow so the next retry asks for a fresh key.
            // auth.client() re-opens the browser (throttled) and throws
            // the AuthRequiredError carrying the fresh setup URL.
            await auth.handleUnauthorized();
            try {
              auth.client();
            } catch (setupErr) {
              if (setupErr instanceof AuthRequiredError) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text:
                        `Stored Teamwork API key was rejected (401 Unauthorized) and has been removed.\n` +
                        setupErr.message,
                    },
                  ],
                  isError: true,
                };
              }
              throw setupErr;
            }
          }
          throw err;
        }
      }) as never,
    );
  return impl as unknown as McpServer["registerTool"];
}

const pageSchema = z.number().int().positive().optional();
const pageSizeSchema = z.number().int().min(1).max(100).optional();
const idSchema = (desc: string) => z.number().int().positive().optional().describe(desc);
const reqIdSchema = (desc: string) => z.number().int().positive().describe(desc);

export function registerTools(server: McpServer, auth: AuthManager): void {
  const tw = lazyClient(auth);
  const register = makeRegister(server, auth);

  // ---- 1. tasks: list | get | create | update | list_comments | comment ----
  register(
    "tasks",
    {
      title: "Teamwork: tasks",
      description:
        "Tasks: list/search (action=list), get one (get), create (create), update/complete/assign (update), read comments (list_comments), post comment (comment).",
      inputSchema: {
        action: z
          .enum(["list", "get", "create", "update", "list_comments", "comment"])
          .describe("list | get | create | update | list_comments | comment"),
        projectId: idSchema("Restrict to a project (list)"),
        tasklistId: idSchema("Restrict to a task list (list) / required for create"),
        taskId: idSchema("Task id (get/update/list_comments/comment)"),
        search: z.string().optional().describe("Free text search in task names (list)"),
        includeCompleted: z.boolean().optional().describe("Include completed (list)"),
        page: pageSchema,
        pageSize: pageSizeSchema,
        // create / update fields
        name: z.string().min(1).optional().describe("Task title (create, update)"),
        description: z.string().optional().describe("Task description, markdown supported"),
        startAt: z.string().optional().describe("Start date, YYYY-MM-DD"),
        dueAt: z.string().optional().describe("Due date, YYYY-MM-DD"),
        complete: z.boolean().optional().describe("Mark complete/incomplete (update)"),
        assigneeUserIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Assign users (create) / replace assignees (update)"),
        tagIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Replace tags (update)"),
        // comment fields
        body: z.string().min(1).optional().describe("Comment text (comment)"),
        contentType: z.enum(["TEXT", "HTML"]).optional().describe("Default TEXT (comment)"),
        isPrivate: z.boolean().optional().describe("Private comment (comment)"),
      },
    },
    async (args: any) => {
      const { action } = args;
      if (action === "list") {
        const query: Query = {
          projectIds: args.projectId,
          tasklistIds: args.tasklistId,
          searchTerm: args.search,
          includeCompletedTasks: args.includeCompleted,
          page: args.page,
          pageSize: args.pageSize,
        };
        const res = await tw.get<{ tasks?: Record<string, unknown>[]; meta?: unknown }>(
          "/tasks.json",
          query,
        );
        const tasks = list(res.tasks, TASK_FIELDS);
        return text({ count: tasks.length, pageInfo: pageInfo(res.meta), tasks });
      }
      if (action === "get") {
        if (!args.taskId) throw new Error("tasks get requires taskId");
        const res = await tw.get<{ task?: Record<string, unknown> }>(`/tasks/${args.taskId}.json`);
        return text({
          task: pick(res.task ?? {}, TASK_FIELDS),
          url: `https://${tw.site}/#/tasks/${args.taskId}`,
        });
      }
      if (action === "create") {
        if (!args.tasklistId) throw new Error("tasks create requires tasklistId");
        if (!args.name) throw new Error("tasks create requires name");
        const task: Record<string, unknown> = { tasklistId: args.tasklistId, name: args.name };
        if (args.description !== undefined) task.description = args.description;
        if (args.startAt !== undefined) task.startAt = args.startAt;
        if (args.dueAt !== undefined) task.dueAt = args.dueAt;
        if (args.assigneeUserIds?.length) task.assignees = { userIds: args.assigneeUserIds };
        const res = await tw.post<{ task?: Record<string, unknown> }>(
          `/tasklists/${args.tasklistId}/tasks.json`,
          { task },
        );
        const created = res.task ?? {};
        return text({
          created: pick(created, ["id", "name", "tasklistId", "projectId", "dueDate", "startDate"]),
          url: `https://${tw.site}/#/tasks/${created.id ?? ""}`,
        });
      }
      if (action === "update") {
        if (!args.taskId) throw new Error("tasks update requires taskId");
        const task: Record<string, unknown> = {};
        for (const k of ["name", "description", "startAt", "dueAt", "complete"] as const) {
          if (args[k] !== undefined) task[k] = args[k];
        }
        if (args.assigneeUserIds !== undefined) task.assignees = { userIds: args.assigneeUserIds };
        if (args.tagIds !== undefined) task.tagIds = args.tagIds;
        if (Object.keys(task).length === 0) return text("No changes provided.");
        const res = await tw.put<{ task?: Record<string, unknown> }>(`/tasks/${args.taskId}.json`, {
          task,
        });
        return text({
          updated: pick(res.task ?? {}, TASK_FIELDS),
          url: `https://${tw.site}/#/tasks/${args.taskId}`,
        });
      }
      if (action === "list_comments") {
        if (!args.taskId) throw new Error("tasks list_comments requires taskId");
        const res = await tw.get<{ comments?: Record<string, unknown>[]; meta?: unknown }>(
          `/tasks/${args.taskId}/comments.json`,
          { page: args.page, pageSize: args.pageSize },
        );
        const comments = list(res.comments, COMMENT_FIELDS, { body: 1500 });
        return text({
          taskId: args.taskId,
          count: comments.length,
          pageInfo: pageInfo(res.meta),
          comments,
        });
      }
      if (action === "comment") {
        if (!args.taskId) throw new Error("tasks comment requires taskId");
        if (!args.body) throw new Error("tasks comment requires body");
        const comment: Record<string, unknown> = { body: args.body };
        if (args.contentType !== undefined) comment.contentType = args.contentType;
        if (args.isPrivate !== undefined) comment.private = args.isPrivate;
        const res = await tw.post<{ comments?: Record<string, unknown>[] }>(
          `/tasks/${args.taskId}/comments.json`,
          { comment },
        );
        const created = res.comments?.[0] ?? {};
        return text({
          posted: pick(created, [
            "id",
            "postedByUserId",
            "postedDateTime",
            "contentType",
            "isPrivate",
          ]),
          url: `https://${tw.site}/#/tasks/${args.taskId}`,
        });
      }
      throw new Error(`Unknown tasks action: ${action}`);
    },
  );

  // ---- 2. projects: list | tasklists | updates | milestones | activity ----
  register(
    "projects",
    {
      title: "Teamwork: projects",
      description:
        "Projects: list projects (list), list task lists in a project (tasklists), status updates/health (updates), milestones by date range (milestones), activity feed (activity).",
      inputSchema: {
        action: z
          .enum(["list", "tasklists", "updates", "milestones", "activity"])
          .describe("list | tasklists | updates | milestones | activity"),
        projectId: idSchema("Project id (tasklists/activity filter)"),
        projectIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Filter (updates/milestones)"),
        search: z.string().optional().describe("Filter by name (list/tasklists)"),
        page: pageSchema,
        pageSize: pageSizeSchema,
        includeArchived: z.boolean().optional().describe("Include archived (list)"),
        activeOnly: z.boolean().optional().describe("Latest update per project (updates, default true)"),
        from: z.string().optional().describe("YYYY-MM-DD (milestones, default today)"),
        to: z.string().optional().describe("YYYY-MM-DD (milestones, default +30 days)"),
        includeCompleted: z.boolean().optional().describe("Include completed milestones"),
        userIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Only activity by these users (activity)"),
        activityTypes: z
          .array(z.enum(ACTIVITY_TYPES))
          .optional()
          .describe("Filter by activity type (activity)"),
        since: z.string().optional().describe("Only activity after date/time (activity)"),
        until: z.string().optional().describe("Only activity before date/time (activity)"),
        excludeMe: z.boolean().optional().describe("Hide your own activity (activity)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: any) => {
      const { action } = args;
      if (action === "list") {
        const res = await tw.get<{ projects?: Record<string, unknown>[]; meta?: unknown }>(
          "/projects.json",
          {
            searchTerm: args.search,
            page: args.page,
            pageSize: args.pageSize,
            includeArchivedProjects: args.includeArchived,
          },
        );
        const projects = list(res.projects, PROJECT_FIELDS);
        return text({ count: projects.length, pageInfo: pageInfo(res.meta), projects });
      }
      if (action === "tasklists") {
        if (!args.projectId) throw new Error("projects tasklists requires projectId");
        const res = await tw.get<{ tasklists?: Record<string, unknown>[]; meta?: unknown }>(
          `/projects/${args.projectId}/tasklists.json`,
          { searchTerm: args.search, page: args.page, pageSize: args.pageSize },
        );
        const tasklists = list(res.tasklists, TASKLIST_FIELDS);
        return text({
          projectId: args.projectId,
          count: tasklists.length,
          pageInfo: pageInfo(res.meta),
          tasklists,
        });
      }
      if (action === "updates") {
        const res = await tw.get<{ projectUpdates?: Record<string, unknown>[]; meta?: unknown }>(
          "/projects/updates.json",
          {
            projectIds: args.projectIds ?? args.projectId,
            activeOnly: args.activeOnly ?? true,
            page: args.page,
            pageSize: args.pageSize,
          },
        );
        const updates = list(res.projectUpdates, UPDATE_FIELDS, { text: 1200 });
        return text({ count: updates.length, pageInfo: pageInfo(res.meta), updates });
      }
      if (action === "milestones") {
        const res = await tw.get<{ milestones?: Record<string, unknown>[]; meta?: unknown }>(
          "/milestones.json",
          {
            dueAfter: args.from ?? todayISO(),
            dueBefore: args.to ?? addDaysISO(30),
            projectIds: args.projectIds ?? args.projectId,
            includeCompleted: args.includeCompleted,
            pageSize: args.pageSize,
          },
        );
        const milestones = list(res.milestones, MILESTONE_FIELDS, { description: 300 });
        return text({ count: milestones.length, pageInfo: pageInfo(res.meta), milestones });
      }
      if (action === "activity") {
        const res = await tw.get<{ activities?: Record<string, unknown>[]; meta?: unknown }>(
          "/latestactivity.json",
          {
            projectIds: args.projectIds ?? args.projectId,
            userIds: args.userIds,
            activityTypes: args.activityTypes,
            startDate: args.since,
            endDate: args.until,
            excludeUserIds: args.excludeMe ? [await myUserId(tw)] : undefined,
            page: args.page,
            pageSize: args.pageSize,
          },
        );
        const activities = list(res.activities, ACTIVITY_FIELDS, {
          description: 300,
          extraDescription: 300,
        });
        return text({ count: activities.length, pageInfo: pageInfo(res.meta), activities });
      }
      throw new Error(`Unknown projects action: ${action}`);
    },
  );

  // ---- 3. people: whoami | list | my_work ----
  register(
    "people",
    {
      title: "Teamwork: people",
      description:
        "People: current user (whoami), find users by name/email (list), tasks assigned to me (my_work with today/overdue/thisweek).",
      inputSchema: {
        action: z.enum(["whoami", "list", "my_work"]).describe("whoami | list | my_work"),
        search: z.string().optional().describe("Search by name or email (list)"),
        emails: z.array(z.string()).optional().describe("Match exact emails (list)"),
        includeClients: z.boolean().optional(),
        includeCollaborators: z.boolean().optional(),
        pageSize: pageSizeSchema,
        page: pageSchema,
        filter: z
          .enum(WORK_FILTERS)
          .optional()
          .describe("today | overdue | thisweek | within7 | all (my_work, default all)"),
        includeCompleted: z.boolean().optional().describe("Include completed (my_work)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: any) => {
      const { action } = args;
      if (action === "whoami") {
        const res = await tw.get<{ person?: Record<string, unknown> }>("/me.json");
        return text({
          site: tw.site,
          person: pick(res.person ?? {}, [
            "id",
            "firstName",
            "lastName",
            "email",
            "title",
            "companyId",
            "isAdmin",
            "inOwnerCompany",
            "userType",
          ]),
        });
      }
      if (action === "list") {
        const res = await tw.get<{ people?: Record<string, unknown>[] }>("/people.json", {
          searchTerm: args.search,
          emails: args.emails,
          includeClients: args.includeClients,
          includeCollaborators: args.includeCollaborators,
          pageSize: args.pageSize,
        });
        const people = list(res.people, PERSON_FIELDS);
        return text({ count: people.length, people });
      }
      if (action === "my_work") {
        const res = await tw.get<{ tasks?: Record<string, unknown>[]; meta?: unknown }>(
          "/tasks.json",
          {
            responsiblePartyIds: [await myUserId(tw)],
            taskFilter: !args.filter || args.filter === "all" ? undefined : args.filter,
            includeCompletedTasks: args.includeCompleted,
            page: args.page,
            pageSize: args.pageSize,
          },
        );
        const tasks = list(res.tasks, TASK_FIELDS);
        return text({ count: tasks.length, pageInfo: pageInfo(res.meta), tasks });
      }
      throw new Error(`Unknown people action: ${action}`);
    },
  );

  // ---- 4. time: log ----
  register(
    "time",
    {
      title: "Teamwork: time",
      description: "Time tracking: log minutes on a task or project (action=log).",
      inputSchema: {
        action: z.enum(["log"]).default("log").describe("log"),
        minutes: z.number().int().positive().describe("Minutes spent (log)"),
        taskId: idSchema("Log against this task (log)"),
        projectId: idSchema("Log against this project (required when taskId missing)"),
        date: z.string().optional().describe("YYYY-MM-DD (default today)"),
        description: z.string().optional().describe("What was done"),
        isBillable: z.boolean().optional(),
      },
    },
    async (args: any) => {
      if (!args.taskId && !args.projectId) throw new Error("Provide taskId or projectId");
      const timelog: Record<string, unknown> = {
        minutes: args.minutes,
        date: args.date ?? todayISO(),
      };
      if (args.description !== undefined) timelog.description = args.description;
      if (args.isBillable !== undefined) timelog.isBillable = args.isBillable;
      const path = args.taskId
        ? `/tasks/${args.taskId}/time.json`
        : `/projects/${args.projectId}/time.json`;
      const res = await tw.post<{ timelog?: Record<string, unknown> }>(path, { timelog });
      return text({
        logged: pick(res.timelog ?? {}, [
          "id",
          "minutes",
          "date",
          "description",
          "isBillable",
          "taskId",
          "projectId",
          "userId",
        ]),
      });
    },
  );

  // ---- 5. search (kept standalone: most used read) ----
  register(
    "search",
    {
      title: "Teamwork: search",
      description:
        "Search tasks, messages, files, comments, milestones, notebooks and links across the site by keyword.",
      inputSchema: {
        searchTerm: z.string().min(1).describe("Keyword to search for"),
        types: z
          .array(z.string())
          .optional()
          .describe("Limit result types, e.g. tasks, messages, files, comments, milestones, projects"),
        projectId: z.number().int().positive().optional().describe("Only this project"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 25)"),
        includeDetails: z
          .boolean()
          .optional()
          .describe("Include sideloaded details (larger response)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ searchTerm, types, projectId, limit, includeDetails }: any) => {
      const res = await tw.get<{
        search?: Record<string, unknown>[];
        included?: Record<string, Record<string, Record<string, unknown>>>;
        meta?: unknown;
      }>("/search.json", {
        searchTerm,
        types,
        projectId,
        limit,
        include: searchInclude(types),
      });
      const included = res.included ?? {};
      const seen = new Set<string>();
      const results: Record<string, unknown>[] = [];
      for (const item of res.search ?? []) {
        const type = String(item.type ?? "unknown");
        const key = `${type}:${String(item.id)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(searchResult(item.id, type, included));
      }
      return text({
        count: results.length,
        pageInfo: pageInfo(res.meta),
        results,
        included: includeDetails ? included : undefined,
      });
    },
  );

  // ---- 6. system: status | logout ----
  register(
    "system",
    {
      title: "Teamwork: system",
      description: "Local credential: check key status/site/storage (status), remove key (logout).",
      inputSchema: {
        action: z.enum(["status", "logout"]).describe("status | logout"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: any) => {
      if (args.action === "status") return text(await auth.status());
      const removed = await auth.logout();
      return text(
        removed
          ? "Removed the API key from this machine. The next tool call will open the setup page."
          : "No API key stored on this machine.",
      );
    },
  );

  // ---- 7. request: raw V3 escape hatch (covers tags/teams/files/calendars/...) ----
  register(
    "request",
    {
      title: "Teamwork: raw API request",
      description:
        "Escape hatch for any Teamwork V3 endpoint not covered above (tags, teams, companies, files, notebooks, messages, links, calendars, timelogs, webhooks...). Path can be short (/tags.json) or full (/projects/api/v3/tags.json). Prefer grouped tools when available.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTP method"),
        path: z
          .string()
          .min(1)
          .describe("V3 path, e.g. /tags.json, /teams.json, /tasks/123.json, /calendars.json"),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query params"),
        body: z.any().optional().describe("JSON body (POST/PUT)"),
      },
    },
    async ({ method, path, query, body }: any) => {
      const res = await tw.request<unknown>(method, path, query as Query, body);
      return text(res);
    },
  );
}

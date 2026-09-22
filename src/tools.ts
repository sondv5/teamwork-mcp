import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AuthManager, AuthRequiredError } from "./auth.js";
import { TeamworkClient, type Query } from "./client.js";

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

function myUserId(tw: TeamworkClient): Promise<number> {
  meIdPromise ??= tw
    .get<{ person?: { id?: number } }>("/me.json")
    .then((res) => {
      const id = res.person?.id;
      if (!id) throw new Error("Cannot resolve current user id from /me.json");
      return id;
    })
    .catch((err) => {
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

function lazyClient(auth: AuthManager): TeamworkClient {
  return new Proxy({} as TeamworkClient, {
    get(_target, property) {
      const client = auth.client();
      const value = (client as unknown as Record<string | symbol, unknown>)[property];
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(client)
        : value;
    },
  });
}

function makeRegister(server: McpServer): McpServer["registerTool"] {
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
          throw err;
        }
      }) as never,
    );
  return impl as unknown as McpServer["registerTool"];
}

export function registerTools(server: McpServer, auth: AuthManager): void {
  const tw = lazyClient(auth);
  const register = makeRegister(server);
  register(
    "whoami",
    {
      title: "Teamwork: current user",
      description:
        "Return the Teamwork.com user that owns the configured API key, plus site URL and whether the user is an admin.",
      annotations: { readOnlyHint: true },
    },
    async () => {
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
    },
  );

  register(
    "list_projects",
    {
      title: "Teamwork: list projects",
      description:
        "List projects visible to the API key. Use search to filter by name; results are paged.",
      inputSchema: {
        search: z.string().optional().describe("Filter by project name"),
        page: z.number().int().positive().optional().describe("Page number (default 1)"),
        pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (default 50)"),
        includeArchived: z.boolean().optional().describe("Include archived projects"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, page, pageSize, includeArchived }) => {
      const res = await tw.get<{
        projects?: Record<string, unknown>[];
        meta?: unknown;
      }>("/projects.json", {
        searchTerm: search,
        page,
        pageSize,
        includeArchivedProjects: includeArchived,
      });
      const projects = list(res.projects, PROJECT_FIELDS);
      return text({ count: projects.length, pageInfo: pageInfo(res.meta), projects });
    },
  );

  register(
    "list_tasklists",
    {
      title: "Teamwork: list task lists",
      description: "List the task lists (columns/boards) inside a project.",
      inputSchema: {
        projectId: z.number().int().positive().describe("Teamwork project id"),
        search: z.string().optional().describe("Filter by list name"),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, search, page, pageSize }) => {
      const res = await tw.get<{
        tasklists?: Record<string, unknown>[];
        meta?: unknown;
      }>(`/projects/${projectId}/tasklists.json`, {
        searchTerm: search,
        page,
        pageSize,
      });
      const tasklists = list(res.tasklists, TASKLIST_FIELDS);
      return text({
        projectId,
        count: tasklists.length,
        pageInfo: pageInfo(res.meta),
        tasklists,
      });
    },
  );

  register(
    "list_tasks",
    {
      title: "Teamwork: list tasks",
      description:
        "Search tasks across projects or within one project/task list. Completed tasks are excluded unless includeCompleted is true.",
      inputSchema: {
        projectId: z.number().int().positive().optional().describe("Restrict to a project"),
        tasklistId: z.number().int().positive().optional().describe("Restrict to a task list"),
        search: z.string().optional().describe("Free text search in task names"),
        includeCompleted: z.boolean().optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, tasklistId, search, includeCompleted, page, pageSize }) => {
      const query: Query = {
        projectIds: projectId,
        tasklistIds: tasklistId,
        searchTerm: search,
        includeCompletedTasks: includeCompleted,
        page,
        pageSize,
      };
      const res = await tw.get<{
        tasks?: Record<string, unknown>[];
        meta?: unknown;
      }>("/tasks.json", query);
      const tasks = list(res.tasks, TASK_FIELDS);
      return text({ count: tasks.length, pageInfo: pageInfo(res.meta), tasks });
    },
  );

  register(
    "get_task",
    {
      title: "Teamwork: get task",
      description: "Fetch a single task with description and key fields.",
      inputSchema: {
        taskId: z.number().int().positive().describe("Teamwork task id"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ taskId }) => {
      const res = await tw.get<{ task?: Record<string, unknown> }>(`/tasks/${taskId}.json`);
      return text({
        task: pick(res.task ?? {}, TASK_FIELDS),
        url: `https://${tw.site}/#/tasks/${taskId}`,
      });
    },
  );

  register(
    "create_task",
    {
      title: "Teamwork: create task",
      description: "Create a task inside a task list.",
      inputSchema: {
        tasklistId: z.number().int().positive().describe("Task list to create the task in"),
        name: z.string().min(1).describe("Task title"),
        description: z.string().optional().describe("Task description (markdown supported)"),
        startAt: z.string().optional().describe("Start date, YYYY-MM-DD"),
        dueAt: z.string().optional().describe("Due date, YYYY-MM-DD"),
        assigneeUserIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("User ids to assign"),
      },
    },
    async ({ tasklistId, name, description, startAt, dueAt, assigneeUserIds }) => {
      const task: Record<string, unknown> = { tasklistId, name };
      if (description !== undefined) task.description = description;
      if (startAt !== undefined) task.startAt = startAt;
      if (dueAt !== undefined) task.dueAt = dueAt;
      if (assigneeUserIds?.length) task.assignees = { userIds: assigneeUserIds };

      const res = await tw.post<{ task?: Record<string, unknown> }>(
        `/tasklists/${tasklistId}/tasks.json`,
        { task },
      );
      const created = res.task ?? {};
      return text({
        created: pick(created, ["id", "name", "tasklistId", "projectId", "dueDate", "startDate"]),
        url: `https://${tw.site}/#/tasks/${created.id ?? ""}`,
      });
    },
  );

  register(
    "update_task",
    {
      title: "Teamwork: update task",
      description:
        "Update fields of an existing task, or mark it complete with complete=true.",
      inputSchema: {
        taskId: z.number().int().positive().describe("Task to update"),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        startAt: z.string().optional().describe("Start date, YYYY-MM-DD"),
        dueAt: z.string().optional().describe("Due date, YYYY-MM-DD"),
        complete: z.boolean().optional().describe("Mark the task complete/incomplete"),
        assigneeUserIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Replace the task's assignees with these user ids"),
        tagIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Replace the task's tags with these tag ids"),
      },
    },
    async ({ taskId, assigneeUserIds, tagIds, ...changes }) => {
      const task: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) task[key] = value;
      }
      if (assigneeUserIds !== undefined) task.assignees = { userIds: assigneeUserIds };
      if (tagIds !== undefined) task.tagIds = tagIds;
      if (Object.keys(task).length === 0) return text("No changes provided.");

      const res = await tw.put<{ task?: Record<string, unknown> }>(
        `/tasks/${taskId}.json`,
        { task },
      );
      return text({
        updated: pick(res.task ?? {}, TASK_FIELDS),
        url: `https://${tw.site}/#/tasks/${taskId}`,
      });
    },
  );

  register(
    "latest_activity",
    {
      title: "Teamwork: latest activity",
      description:
        "Chronological feed of recent activity across all projects (comments, task updates, files, milestones...). Mirrors the Teamwork activity widget. Filter by project, user, type or date range.",
      inputSchema: {
        projectId: z.number().int().positive().optional().describe("Only this project"),
        userIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Only activity by these users"),
        activityTypes: z
          .array(z.enum(ACTIVITY_TYPES))
          .optional()
          .describe("Filter by activity type"),
        since: z.string().optional().describe("Only activity after this date/time (e.g. 2026-09-01)"),
        until: z.string().optional().describe("Only activity before this date/time"),
        excludeMe: z.boolean().optional().describe("Hide your own activity"),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, userIds, activityTypes, since, until, excludeMe, page, pageSize }) => {
      const res = await tw.get<{
        activities?: Record<string, unknown>[];
        meta?: unknown;
      }>("/latestactivity.json", {
        projectIds: projectId,
        userIds,
        activityTypes,
        startDate: since,
        endDate: until,
        excludeUserIds: excludeMe ? [await myUserId(tw)] : undefined,
        page,
        pageSize,
      });
      const activities = list(res.activities, ACTIVITY_FIELDS, {
        description: 300,
        extraDescription: 300,
      });
      return text({ count: activities.length, pageInfo: pageInfo(res.meta), activities });
    },
  );

  register(
    "my_work",
    {
      title: "Teamwork: my work",
      description:
        "Tasks assigned to the API key's user (responsible party): what is due today, overdue or coming this week.",
      inputSchema: {
        filter: z
          .enum(WORK_FILTERS)
          .default("all")
          .describe("today | overdue | thisweek | within7 | all (default all)"),
        includeCompleted: z.boolean().optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ filter, includeCompleted, page, pageSize }) => {
      const res = await tw.get<{
        tasks?: Record<string, unknown>[];
        meta?: unknown;
      }>("/tasks.json", {
        responsiblePartyIds: [await myUserId(tw)],
        taskFilter: filter === "all" ? undefined : filter,
        includeCompletedTasks: includeCompleted,
        page,
        pageSize,
      });
      const tasks = list(res.tasks, TASK_FIELDS);
      return text({ count: tasks.length, pageInfo: pageInfo(res.meta), tasks });
    },
  );

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
    async ({ searchTerm, types, projectId, limit, includeDetails }) => {
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

  register(
    "upcoming_milestones",
    {
      title: "Teamwork: upcoming milestones",
      description:
        "Milestones with deadlines in a date range across projects. Defaults to the next 30 days.",
      inputSchema: {
        from: z.string().optional().describe("YYYY-MM-DD (default today)"),
        to: z.string().optional().describe("YYYY-MM-DD (default +30 days)"),
        projectIds: z.array(z.number().int().positive()).optional(),
        includeCompleted: z.boolean().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, projectIds, includeCompleted, pageSize }) => {
      const res = await tw.get<{
        milestones?: Record<string, unknown>[];
        meta?: unknown;
      }>("/milestones.json", {
        dueAfter: from ?? todayISO(),
        dueBefore: to ?? addDaysISO(30),
        projectIds,
        includeCompleted,
        pageSize,
      });
      const milestones = list(res.milestones, MILESTONE_FIELDS, { description: 300 });
      return text({ count: milestones.length, pageInfo: pageInfo(res.meta), milestones });
    },
  );

  register(
    "project_updates",
    {
      title: "Teamwork: project updates",
      description: "Latest status updates (health reports) posted on projects.",
      inputSchema: {
        projectIds: z.array(z.number().int().positive()).optional(),
        activeOnly: z
          .boolean()
          .optional()
          .describe("Only the latest update per project (default true)"),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectIds, activeOnly, page, pageSize }) => {
      const res = await tw.get<{
        projectUpdates?: Record<string, unknown>[];
        meta?: unknown;
      }>("/projects/updates.json", {
        projectIds,
        activeOnly: activeOnly ?? true,
        page,
        pageSize,
      });
      const updates = list(res.projectUpdates, UPDATE_FIELDS, { text: 1200 });
      return text({ count: updates.length, pageInfo: pageInfo(res.meta), updates });
    },
  );

  register(
    "list_task_comments",
    {
      title: "Teamwork: task comments",
      description: "Read the comment thread of a task.",
      inputSchema: {
        taskId: z.number().int().positive().describe("Teamwork task id"),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ taskId, page, pageSize }) => {
      const res = await tw.get<{
        comments?: Record<string, unknown>[];
        meta?: unknown;
      }>(`/tasks/${taskId}/comments.json`, { page, pageSize });
      const comments = list(res.comments, COMMENT_FIELDS, { body: 1500 });
      return text({ taskId, count: comments.length, pageInfo: pageInfo(res.meta), comments });
    },
  );

  register(
    "list_people",
    {
      title: "Teamwork: list people",
      description:
        "Find users (id, name, email) to use as assignees or in user filters.",
      inputSchema: {
        search: z.string().optional().describe("Search by name or email"),
        emails: z.array(z.string()).optional().describe("Match exact email addresses"),
        includeClients: z.boolean().optional(),
        includeCollaborators: z.boolean().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, emails, includeClients, includeCollaborators, pageSize }) => {
      const res = await tw.get<{ people?: Record<string, unknown>[] }>("/people.json", {
        searchTerm: search,
        emails,
        includeClients,
        includeCollaborators,
        pageSize,
      });
      const people = list(res.people, PERSON_FIELDS);
      return text({ count: people.length, people });
    },
  );

  register(
    "add_task_comment",
    {
      title: "Teamwork: comment on task",
      description:
        "Post a comment on a task. Use to report progress, answer questions or hand off work in the task thread.",
      inputSchema: {
        taskId: z.number().int().positive().describe("Task to comment on"),
        body: z.string().min(1).describe("Comment text"),
        contentType: z.enum(["TEXT", "HTML"]).optional().describe("Default TEXT"),
        isPrivate: z.boolean().optional().describe("Post as a private comment"),
      },
    },
    async ({ taskId, body, contentType, isPrivate }) => {
      const comment: Record<string, unknown> = { body };
      if (contentType !== undefined) comment.contentType = contentType;
      if (isPrivate !== undefined) comment.private = isPrivate;

      const res = await tw.post<{ comments?: Record<string, unknown>[] }>(
        `/tasks/${taskId}/comments.json`,
        { comment },
      );
      const created = res.comments?.[0] ?? {};
      return text({
        posted: pick(created, ["id", "postedByUserId", "postedDateTime", "contentType", "isPrivate"]),
        url: `https://${tw.site}/#/tasks/${taskId}`,
      });
    },
  );

  register(
    "log_time",
    {
      title: "Teamwork: log time",
      description: "Log a time entry (timesheet) on a task or a project.",
      inputSchema: {
        minutes: z.number().int().positive().describe("Minutes spent"),
        taskId: z.number().int().positive().optional().describe("Log against this task"),
        projectId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Log against this project (required when taskId is not given)"),
        date: z.string().optional().describe("YYYY-MM-DD (default today)"),
        description: z.string().optional().describe("What was done"),
        isBillable: z.boolean().optional(),
      },
    },
    async ({ minutes, taskId, projectId, date, description, isBillable }) => {
      if (!taskId && !projectId) throw new Error("Provide taskId or projectId");

      const timelog: Record<string, unknown> = { minutes, date: date ?? todayISO() };
      if (description !== undefined) timelog.description = description;
      if (isBillable !== undefined) timelog.isBillable = isBillable;

      const path = taskId ? `/tasks/${taskId}/time.json` : `/projects/${projectId}/time.json`;
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

  register(
    "auth_status",
    {
      title: "Teamwork: auth status",
      description:
        "Check whether a Teamwork API key is configured on this machine, which site it points to and where it is stored.",
      annotations: { readOnlyHint: true },
    },
    async () => text(await auth.status()),
  );

  register(
    "logout",
    {
      title: "Teamwork: logout",
      description:
        "Remove the stored Teamwork API key from this machine (OS keychain + local file). The next tool call will ask to set up again.",
    },
    async () => {
      const removed = await auth.logout();
      return text(
        removed
          ? "Đã xoá API key khỏi máy. Lần gọi tool tiếp theo sẽ mở trang setup."
          : "Không có API key nào được lưu trên máy.",
      );
    },
  );
}

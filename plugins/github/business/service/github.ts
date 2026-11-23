type AuthorizationRuntime = {
  getCredential(methodId: string, accountId?: string): Promise<Readonly<Record<string, string>> | null>;
};

type GitHubRuntime = {
  plugin: Readonly<{ id: string; version: string }>;
  authorization: AuthorizationRuntime;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
};

const DEFAULT_API_BASE = "https://api.github.com";
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item) => item !== null) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function field(input: Record<string, unknown>, key: string): unknown {
  return Reflect.get(input, key);
}

function requiredText(input: Record<string, unknown>, key: string, maxLength = 256): string {
  const value = text(field(input, key))?.trim() ?? "";
  if (!value) throw new Error(`${key} is required`);
  if (value.length > maxLength) throw new Error(`${key} is too long`);
  return value;
}

function optionalText(input: Record<string, unknown>, key: string, maxLength: number): string {
  const value = text(field(input, key)) ?? "";
  if (value.length > maxLength) throw new Error(`${key} is too long`);
  return value;
}

function positiveInteger(input: Record<string, unknown>, key: string): number {
  const value = numberValue(field(input, key));
  if (value === null || !Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
}

function boundedLimit(input: Record<string, unknown>): number {
  const value = numberValue(field(input, "limit"));
  if (value === null) return 30;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function state(input: Record<string, unknown>): "open" | "closed" | "all" {
  const value = text(field(input, "state"));
  return value === "closed" || value === "all" ? value : "open";
}

function repository(input: Record<string, unknown>): { owner: string; repo: string; path: string } {
  const owner = requiredText(input, "owner", 39);
  const repo = requiredText(input, "repo", 100);
  if (!OWNER_RE.test(owner)) throw new Error("owner is invalid");
  if (!REPO_RE.test(repo)) throw new Error("repo is invalid");
  return {
    owner,
    repo,
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  };
}

function nestedText(item: Record<string, unknown>, key: string, nestedKey: string): string | null {
  const nested = record(Reflect.get(item, key));
  return nested ? text(Reflect.get(nested, nestedKey)) : null;
}

function summaryUser(item: Record<string, unknown>) {
  return {
    login: text(Reflect.get(item, "login")),
    id: numberValue(Reflect.get(item, "id")),
    avatarUrl: text(Reflect.get(item, "avatar_url")),
    htmlUrl: text(Reflect.get(item, "html_url")),
  };
}

function summaryPullRequest(item: Record<string, unknown>) {
  return {
    number: numberValue(Reflect.get(item, "number")),
    title: text(Reflect.get(item, "title")),
    state: text(Reflect.get(item, "state")),
    draft: booleanValue(Reflect.get(item, "draft")),
    htmlUrl: text(Reflect.get(item, "html_url")),
    author: nestedText(item, "user", "login"),
    head: nestedText(item, "head", "ref"),
    base: nestedText(item, "base", "ref"),
    updatedAt: text(Reflect.get(item, "updated_at")),
  };
}

function summaryIssue(item: Record<string, unknown>) {
  return {
    number: numberValue(Reflect.get(item, "number")),
    title: text(Reflect.get(item, "title")),
    state: text(Reflect.get(item, "state")),
    htmlUrl: text(Reflect.get(item, "html_url")),
    author: nestedText(item, "user", "login"),
    labels: records(Reflect.get(item, "labels")).map((label) => text(Reflect.get(label, "name"))).filter(Boolean),
    comments: numberValue(Reflect.get(item, "comments")),
    updatedAt: text(Reflect.get(item, "updated_at")),
  };
}

function summaryComment(item: Record<string, unknown>) {
  return {
    id: numberValue(Reflect.get(item, "id")),
    nodeId: text(Reflect.get(item, "node_id")),
    author: nestedText(item, "user", "login"),
    body: text(Reflect.get(item, "body")),
    path: text(Reflect.get(item, "path")),
    line: numberValue(Reflect.get(item, "line")),
    htmlUrl: text(Reflect.get(item, "html_url")),
    createdAt: text(Reflect.get(item, "created_at")),
  };
}

function summaryReview(item: Record<string, unknown>) {
  return {
    id: numberValue(Reflect.get(item, "id")),
    author: nestedText(item, "user", "login"),
    state: text(Reflect.get(item, "state")),
    body: text(Reflect.get(item, "body")),
    submittedAt: text(Reflect.get(item, "submitted_at")),
  };
}

function summaryFile(item: Record<string, unknown>) {
  const patch = text(Reflect.get(item, "patch"));
  return {
    filename: text(Reflect.get(item, "filename")),
    status: text(Reflect.get(item, "status")),
    additions: numberValue(Reflect.get(item, "additions")),
    deletions: numberValue(Reflect.get(item, "deletions")),
    changes: numberValue(Reflect.get(item, "changes")),
    patch: patch && patch.length > 12_000 ? `${patch.slice(0, 12_000)}\n…truncated` : patch,
  };
}

export default async function createGitHubService(runtime: GitHubRuntime) {
  const apiBase = (process.env.IPOLLOWORK_GITHUB_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");

  async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const credential = await runtime.authorization.getCredential("github-token");
    const accessToken = credential?.accessToken?.trim();
    if (!accessToken) throw new Error("Connect GitHub before using this action");
    const response = await fetch(`${apiBase}${path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "user-agent": "iPolloWork-GitHub-Plugin",
        "x-github-api-version": "2022-11-28",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 204) return null;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const errorPayload = record(payload);
      const message = errorPayload ? text(Reflect.get(errorPayload, "message")) : null;
      const remaining = response.headers.get("x-ratelimit-remaining");
      const rateLimit = remaining === "0" ? " GitHub rate limit is exhausted." : "";
      throw new Error(`GitHub request failed with HTTP ${response.status}${message ? `: ${message}` : ""}.${rateLimit}`);
    }
    return payload;
  }

  async function graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const payload = record(await request("/graphql", { method: "POST", body: { query, variables } }));
    if (!payload) throw new Error("GitHub GraphQL returned an invalid response");
    const errors = records(Reflect.get(payload, "errors"));
    if (errors.length) {
      const message = errors.map((error) => text(Reflect.get(error, "message"))).filter(Boolean).join("; ");
      throw new Error(`GitHub GraphQL failed${message ? `: ${message}` : ""}`);
    }
    return payload;
  }

  return {
    actions: {
      "connection-status": async () => {
        const user = record(await request("/user"));
        if (!user) throw new Error("GitHub returned an invalid user response");
        return { connected: true, account: summaryUser(user), pluginVersion: runtime.plugin.version };
      },

      "repository-context": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const repo = record(await request(target.path));
        if (!repo) throw new Error("GitHub returned an invalid repository response");
        return {
          id: numberValue(Reflect.get(repo, "id")),
          fullName: text(Reflect.get(repo, "full_name")),
          description: text(Reflect.get(repo, "description")),
          private: booleanValue(Reflect.get(repo, "private")),
          archived: booleanValue(Reflect.get(repo, "archived")),
          defaultBranch: text(Reflect.get(repo, "default_branch")),
          htmlUrl: text(Reflect.get(repo, "html_url")),
          permissions: record(Reflect.get(repo, "permissions")),
          updatedAt: text(Reflect.get(repo, "updated_at")),
        };
      },

      "list-pull-requests": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const query = new URLSearchParams({ state: state(input), sort: "updated", direction: "desc", per_page: String(boundedLimit(input)) });
        return { items: records(await request(`${target.path}/pulls?${query}`)).map(summaryPullRequest) };
      },

      "pull-request-detail": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const number = positiveInteger(input, "number");
        const root = `${target.path}/pulls/${number}`;
        const [pullRequestValue, filesValue, reviewsValue, commentsValue] = await Promise.all([
          request(root),
          request(`${root}/files?per_page=50`),
          request(`${root}/reviews?per_page=50`),
          request(`${root}/comments?per_page=50`),
        ]);
        const pullRequest = record(pullRequestValue);
        if (!pullRequest) throw new Error("GitHub returned an invalid pull request response");
        return {
          pullRequest: {
            ...summaryPullRequest(pullRequest),
            body: text(Reflect.get(pullRequest, "body")),
            mergeable: booleanValue(Reflect.get(pullRequest, "mergeable")),
            mergeableState: text(Reflect.get(pullRequest, "mergeable_state")),
            additions: numberValue(Reflect.get(pullRequest, "additions")),
            deletions: numberValue(Reflect.get(pullRequest, "deletions")),
            changedFiles: numberValue(Reflect.get(pullRequest, "changed_files")),
          },
          files: records(filesValue).map(summaryFile),
          reviews: records(reviewsValue).map(summaryReview),
          comments: records(commentsValue).map(summaryComment),
        };
      },

      "review-threads": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const number = positiveInteger(input, "number");
        return graphql(`
          query ReviewThreads($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $number) {
                number
                reviewThreads(first: 50) {
                  nodes {
                    id
                    isResolved
                    isOutdated
                    path
                    line
                    originalLine
                    comments(first: 20) {
                      nodes { id body createdAt url author { login } }
                    }
                  }
                }
              }
            }
          }
        `, { owner: target.owner, repo: target.repo, number });
      },

      "list-issues": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const query = new URLSearchParams({ state: state(input), sort: "updated", direction: "desc", per_page: String(boundedLimit(input)) });
        const issues = records(await request(`${target.path}/issues?${query}`))
          .filter((issue) => !record(Reflect.get(issue, "pull_request")));
        return { items: issues.map(summaryIssue) };
      },

      "issue-detail": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const number = positiveInteger(input, "number");
        const [issueValue, commentsValue] = await Promise.all([
          request(`${target.path}/issues/${number}`),
          request(`${target.path}/issues/${number}/comments?per_page=50`),
        ]);
        const issue = record(issueValue);
        if (!issue) throw new Error("GitHub returned an invalid issue response");
        return {
          issue: { ...summaryIssue(issue), body: text(Reflect.get(issue, "body")) },
          comments: records(commentsValue).map(summaryComment),
        };
      },

      "actions-failure": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const runId = positiveInteger(input, "runId");
        const [runValue, jobsValue] = await Promise.all([
          request(`${target.path}/actions/runs/${runId}`),
          request(`${target.path}/actions/runs/${runId}/jobs?per_page=50`),
        ]);
        const run = record(runValue);
        const jobsPayload = record(jobsValue);
        if (!run || !jobsPayload) throw new Error("GitHub returned an invalid Actions response");
        const jobs = records(Reflect.get(jobsPayload, "jobs"));
        return {
          run: {
            id: numberValue(Reflect.get(run, "id")),
            name: text(Reflect.get(run, "name")),
            event: text(Reflect.get(run, "event")),
            status: text(Reflect.get(run, "status")),
            conclusion: text(Reflect.get(run, "conclusion")),
            headBranch: text(Reflect.get(run, "head_branch")),
            headSha: text(Reflect.get(run, "head_sha")),
            htmlUrl: text(Reflect.get(run, "html_url")),
          },
          failedJobs: jobs.filter((job) => text(Reflect.get(job, "conclusion")) !== "success").map((job) => ({
            id: numberValue(Reflect.get(job, "id")),
            name: text(Reflect.get(job, "name")),
            status: text(Reflect.get(job, "status")),
            conclusion: text(Reflect.get(job, "conclusion")),
            htmlUrl: text(Reflect.get(job, "html_url")),
            failedSteps: records(Reflect.get(job, "steps"))
              .filter((step) => text(Reflect.get(step, "conclusion")) !== "success")
              .map((step) => ({
                name: text(Reflect.get(step, "name")),
                number: numberValue(Reflect.get(step, "number")),
                status: text(Reflect.get(step, "status")),
                conclusion: text(Reflect.get(step, "conclusion")),
              })),
          })),
        };
      },

      "create-pull-request": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const created = record(await request(`${target.path}/pulls`, {
          method: "POST",
          body: {
            title: requiredText(input, "title", 256),
            body: optionalText(input, "body", 20_000),
            head: requiredText(input, "head", 256),
            base: requiredText(input, "base", 256),
            draft: field(input, "draft") !== false,
          },
        }));
        if (!created) throw new Error("GitHub returned an invalid pull request response");
        return summaryPullRequest(created);
      },

      "post-comment": async (input: Record<string, unknown>) => {
        const target = repository(input);
        const number = positiveInteger(input, "number");
        const created = record(await request(`${target.path}/issues/${number}/comments`, {
          method: "POST",
          body: { body: requiredText(input, "body", 20_000) },
        }));
        if (!created) throw new Error("GitHub returned an invalid comment response");
        return summaryComment(created);
      },

      "resolve-review-thread": async (input: Record<string, unknown>) => {
        const threadId = requiredText(input, "threadId", 256);
        return graphql(`
          mutation ResolveReviewThread($threadId: ID!) {
            resolveReviewThread(input: { threadId: $threadId }) {
              thread { id isResolved }
            }
          }
        `, { threadId });
      },
    },
  };
}

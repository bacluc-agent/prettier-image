const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "auto-release.yaml",
);

function workflowScript(workflow, stepName) {
  const lines = workflow.split("\n");
  const step = lines.findIndex((line) => line.includes(`- name: ${stepName}`));
  assert.notEqual(step, -1, `Missing workflow step: ${stepName}`);
  const script = lines.findIndex(
    (line, index) => index > step && line.trim() === "script: |",
  );
  assert.notEqual(script, -1, `Missing script for workflow step: ${stepName}`);
  const indent = lines[script + 1].match(/^\s*/)[0].length;
  const body = [];
  for (const line of lines.slice(script + 1)) {
    if (line.trim() && line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

function createGitHub({ comments = [], tags = [], workflows = [] } = {}) {
  const listComments = async () => {};
  const listTags = async () => {};
  const listRepoWorkflows = async () => {};
  const writes = [];
  const github = {
    rest: {
      issues: {
        listComments,
        createComment: async (params) => {
          writes.push(["createComment", params]);
        },
        updateComment: async (params) => {
          writes.push(["updateComment", params]);
        },
      },
      repos: { listTags },
      git: {
        createRef: async (params) => {
          writes.push(["createRef", params]);
        },
      },
      actions: {
        listRepoWorkflows,
        createWorkflowDispatch: async (params) => {
          writes.push(["createWorkflowDispatch", params]);
        },
      },
    },
    paginate: async (method) => {
      if (method === listComments) return comments;
      if (method === listTags) return tags;
      if (method === listRepoWorkflows) return workflows;
      throw new Error("Unexpected paginate method");
    },
  };
  return { github, writes };
}

function pullRequestContext({
  action = "synchronize",
  labels = [],
  merged = false,
  mergeCommitSha = "merge-sha",
} = {}) {
  return {
    eventName: "pull_request",
    payload: {
      action,
      pull_request: {
        number: 7,
        labels: labels.map((name) => ({ name })),
        merged,
        merge_commit_sha: mergeCommitSha,
      },
    },
    repo: { owner: "owner", repo: "image" },
    serverUrl: "https://github.com",
  };
}

function markerComment(overrides = {}) {
  return {
    id: 100,
    user: { login: "github-actions[bot]" },
    body: "🛠️ _Auto tagging enabled_ with label `bump:patch`",
    ...overrides,
  };
}

async function run(context, github) {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  const script = workflowScript(workflow, "Create new tag");
  await vm.runInNewContext(`(async () => { ${script}\n})()`, {
    github,
    context,
  });
}

test("workflow pins github-script v9 and grants required permissions", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(
    workflow,
    /uses: actions\/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9/,
  );
  const permissions = workflow.match(
    /permissions:\n((?: {2}\S+: write\n?)+)/,
  )?.[1];
  assert.ok(permissions, "Missing workflow permissions block");
  for (const scope of ["contents", "issues", "pull-requests", "actions"]) {
    assert.match(permissions, new RegExp(`^ {2}${scope}: write$`, "m"));
  }
  assert.doesNotMatch(workflow, /projectsyn\/pr-label-tag-action/);
});

test("rejects non pull request events", async () => {
  const { github } = createGitHub();
  await assert.rejects(
    run(
      {
        eventName: "workflow_dispatch",
        payload: {},
        repo: { owner: "owner", repo: "image" },
        serverUrl: "https://github.com",
      },
      github,
    ),
    /Only 'pull_request' events are supported/,
  );
});

test("does nothing when no bump labels and no comment exists", async () => {
  const { github, writes } = createGitHub();
  await run(pullRequestContext({ labels: [] }), github);
  assert.deepEqual(writes, []);
});

test("updates the existing bot comment when no bump labels exist", async () => {
  const { github, writes } = createGitHub({
    comments: [markerComment({ id: 11 })],
  });
  await run(pullRequestContext({ labels: [] }), github);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "updateComment");
  assert.equal(writes[0][1].comment_id, 11);
  assert.match(writes[0][1].body, /No bump labels present/);
});

test("comments about multiple bump labels without tagging", async () => {
  const { github, writes } = createGitHub();
  await run(
    pullRequestContext({ labels: ["bump:patch", "bump:minor"] }),
    github,
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "createComment");
  assert.match(writes[0][1].body, /Found 2 bump labels/);
  assert.doesNotMatch(writes[0][1].body, /v\d/);
});

test("computes the next version for each bump label on an open pull request", async () => {
  const cases = [
    ["bump:patch", "v1.2.4"],
    ["bump:minor", "v1.3.0"],
    ["bump:major", "v2.0.0"],
  ];
  for (const [label, nextVersion] of cases) {
    const { github, writes } = createGitHub({ tags: [{ name: "v1.2.3" }] });
    await run(pullRequestContext({ labels: [label] }), github);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], "createComment");
    assert.ok(writes[0][1].body.includes(nextVersion));
    assert.equal(writes.filter(([name]) => name !== "createComment").length, 0);
  }
});

test("creates the tag and dispatches workflows when merged", async () => {
  const { github, writes } = createGitHub({
    tags: [{ name: "v1.2.3" }],
    workflows: [
      { id: 42, name: "Test and release prettier image" },
      { id: 7, name: "Other workflow" },
    ],
  });
  await run(
    pullRequestContext({
      action: "closed",
      labels: ["bump:patch"],
      merged: true,
      mergeCommitSha: "merge-sha",
    }),
    github,
  );

  const createRef = writes.find(([name]) => name === "createRef");
  assert.ok(createRef, "Missing createRef call");
  assert.equal(createRef[1].ref, "refs/tags/v1.2.4");
  assert.equal(createRef[1].sha, "merge-sha");

  const dispatch = writes.find(([name]) => name === "createWorkflowDispatch");
  assert.ok(dispatch, "Missing workflow dispatch");
  assert.equal(dispatch[1].workflow_id, 42);
  assert.equal(dispatch[1].ref, "refs/tags/v1.2.4");

  const comment = writes.find(([name]) => name === "createComment");
  assert.ok(comment, "Missing released comment");
  assert.ok(comment[1].body.includes("released as [`v1.2.4`]"));
});

test("reports closed unmerged pull requests without tagging", async () => {
  const { github, writes } = createGitHub({ tags: [{ name: "v1.2.3" }] });
  await run(
    pullRequestContext({
      action: "closed",
      labels: ["bump:patch"],
      merged: false,
    }),
    github,
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "createComment");
  assert.match(writes[0][1].body, /closed unmerged/);
});

test("ignores comments that are not bot auto tagging markers", async () => {
  const { github, writes } = createGitHub({
    comments: [
      markerComment({
        id: 1,
        user: { login: "someone" },
        body: "🛠️ _Auto tagging enabled_ with label `bump:patch`",
      }),
      markerComment({ id: 2, body: "unrelated" }),
      markerComment({ id: 3 }),
    ],
  });
  await run(pullRequestContext({ labels: [] }), github);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "updateComment");
  assert.equal(writes[0][1].comment_id, 3);
});

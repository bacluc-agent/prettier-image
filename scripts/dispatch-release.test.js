const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const { dispatchNewTag } = require('./dispatch-release')

function workflowScript(workflow, stepName) {
  const lines = workflow.split('\n')
  const step = lines.findIndex(line => line.includes(`- name: ${stepName}`))
  assert.notEqual(step, -1, `Missing workflow step: ${stepName}`)
  const script = lines.findIndex((line, index) => index > step && line.trim() === 'script: |')
  assert.notEqual(script, -1, `Missing script for workflow step: ${stepName}`)
  const indent = lines[script + 1].match(/^\s*/)[0].length
  const body = []
  for (const line of lines.slice(script + 1)) {
    if (line.trim() && line.match(/^\s*/)[0].length < indent) break
    body.push(line.slice(indent))
  }
  return body.join('\n')
}

test('workflow snapshots tags and dispatches only for a merged PR', async () => {
  const workflow = fs.readFileSync('.github/workflows/auto-release.yaml', 'utf8')
  const snapshotScript = workflowScript(workflow, 'Record existing tags')
  const dispatchScript = workflowScript(workflow, 'Dispatch release workflow for the new tag')
  const condition = workflow.match(
    /if: (github\.event\.action == 'closed' && github\.event\.pull_request\.merged)/,
  )?.[1]
  assert.ok(condition, 'Missing merged-PR dispatch condition')

  for (const merged of [false, true]) {
    const calls = []
    let snapshotRecorded = false
    const github = {
      rest: {
        repos: { listTags: 'listTags' },
        actions: {
          listRepoWorkflows: async () => ({
            data: { workflows: [{ id: 42, name: 'Test and release prettier image' }] },
          }),
        },
      },
      paginate: async () => [
        { name: 'v0.0.1' },
        ...(snapshotRecorded && merged ? [{ name: 'v0.0.2' }] : []),
      ],
      request: async (...args) => calls.push(args),
    }
    const outputs = {}
    const event = { action: 'closed', pull_request: { merged } }
    await vm.runInNewContext(`(async () => { ${snapshotScript}\n})()`, {
      github,
      context: { repo: { owner: 'owner', repo: 'image' } },
      core: {
        setOutput: (key, value) => {
          outputs[key] = value
          snapshotRecorded = true
        },
      },
    })
    assert.deepEqual(JSON.parse(outputs.names), ['v0.0.1'])

    if (vm.runInNewContext(condition, { github: { event } })) {
      await vm.runInNewContext(`(async () => { ${dispatchScript}\n})()`, {
        github,
        context: { repo: { owner: 'owner', repo: 'image' } },
        process: { env: { EXISTING_TAGS: outputs.names } },
        require: () => ({ dispatchNewTag }),
      })
    }

    assert.equal(calls.length, merged ? 1 : 0)
    if (merged) assert.equal(calls[0][1].ref, 'refs/tags/v0.0.2')
  }
})

test('dispatches release workflow using the API version and newly created tag', async () => {
  const calls = []
  const github = {
    rest: {
      repos: { listTags: 'listTags' },
      actions: {
        listRepoWorkflows: async params => {
          calls.push(['workflows', params])
          return { data: { workflows: [{ id: 42, name: 'Test and release prettier image' }] } }
        },
      },
    },
    paginate: async (method, params) => {
      calls.push(['tags', method, params])
      return [{ name: 'v0.0.1' }, { name: 'v0.0.2' }]
    },
    request: async (route, params) => calls.push(['dispatch', route, params]),
  }

  await dispatchNewTag(github, { repo: { owner: 'owner', repo: 'image' } }, ['v0.0.1'])

  assert.deepEqual(calls.at(-1), [
    'dispatch',
    'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
    {
      owner: 'owner',
      repo: 'image',
      workflow_id: 42,
      ref: 'refs/tags/v0.0.2',
      headers: { 'X-GitHub-Api-Version': '2026-03-10' },
    },
  ])
})

test('does not dispatch when no new tag exists', async () => {
  let dispatched = false
  const github = {
    rest: { repos: { listTags: 'listTags' } },
    paginate: async () => [{ name: 'v0.0.1' }],
    request: async () => { dispatched = true },
  }

  await dispatchNewTag(github, { repo: { owner: 'owner', repo: 'image' } }, ['v0.0.1'])

  assert.equal(dispatched, false)
})

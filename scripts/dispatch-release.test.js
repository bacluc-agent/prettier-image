const assert = require('node:assert/strict')
const test = require('node:test')
const { dispatchNewTag } = require('./dispatch-release')

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

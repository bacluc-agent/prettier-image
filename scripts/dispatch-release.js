async function dispatchNewTag(github, context, existingTagNames) {
  const existingTags = new Set(existingTagNames)
  const tags = await github.paginate(github.rest.repos.listTags, {
    owner: context.repo.owner,
    repo: context.repo.repo,
  })
  const newTag = tags.find(tag => !existingTags.has(tag.name))
  if (!newTag) return

  const { data: workflows } = await github.rest.actions.listRepoWorkflows({
    owner: context.repo.owner,
    repo: context.repo.repo,
  })
  const workflow = workflows.workflows.find(item => item.name === 'Test and release prettier image')
  if (!workflow) throw new Error('Release workflow not found')

  await github.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
    owner: context.repo.owner,
    repo: context.repo.repo,
    workflow_id: workflow.id,
    ref: `refs/tags/${newTag.name}`,
    headers: { 'X-GitHub-Api-Version': '2026-03-10' },
  })
}

module.exports = { dispatchNewTag }

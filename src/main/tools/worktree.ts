import { createWorktree, listWorktrees, removeWorktree } from '../workspace/projects'
import { Tool, ok, schema } from './types'

export const worktreeTools: Tool[] = [
  {
    name: 'worktree_create',
    description: 'Create an isolated Git worktree branch in a sibling folder for parallel work.',
    schema: schema({ branch: { type: 'string', description: 'Branch name (kebab-case)' } }, ['branch']),
    async run(i, ctx) {
      const dir = ctx.project()?.dir ?? ctx.cwd()
      return ok(await createWorktree(dir, String(i.branch)))
    }
  },
  {
    name: 'worktree_list',
    parallel: true,
    description: 'List active Git worktrees for the current project.',
    schema: schema({}),
    async run(_i, ctx) {
      const dir = ctx.project()?.dir ?? ctx.cwd()
      return ok(await listWorktrees(dir))
    }
  },
  {
    name: 'worktree_remove',
    description: 'Remove a Git worktree directory.',
    schema: schema({ path: { type: 'string', description: 'Worktree directory path' } }, ['path']),
    async run(i, ctx) {
      const dir = ctx.project()?.dir ?? ctx.cwd()
      return ok(await removeWorktree(dir, String(i.path)))
    }
  }
]

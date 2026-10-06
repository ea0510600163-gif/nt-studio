import { z } from 'zod'
import type { AppContext } from '../core/context'
import { createProject, listProjects, projectsRoot } from '../agent/projects'
import type { ProjectInfo } from '../../shared/api'
import { createRouter } from './router'

export function registerProjectHandlers(ctx: AppContext): void {
  const router = createRouter(ctx.root.child('ipc:projects'))

  router.handle({
    channel: 'projects:list',
    input: z.undefined().optional(),
    handler: (): Promise<ProjectInfo[]> => listProjects(ctx),
  })

  router.handle({
    channel: 'projects:create',
    input: z.object({ name: z.string().min(1) }),
    handler: ({ name }) => createProject(ctx, name),
  })

  router.handle({
    channel: 'projects:setRoot',
    input: z.object({ root: z.string().min(1) }),
    handler: ({ root }) => {
      ctx.state.patch({ projectsRoot: root })
      return { ok: true, root }
    },
  })

  router.handle({
    channel: 'projects:getRoot',
    input: z.undefined().optional(),
    handler: () => ({ root: projectsRoot(ctx) }),
  })
}
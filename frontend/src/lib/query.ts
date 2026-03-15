import type { QueryClient } from '@tanstack/react-query'

export const forgeInvalidationKeys = [
  'projects',
  'project-statuses',
  'tasks',
  'events',
  'today',
  'calendar',
] as const

export function invalidateForgeQueries(queryClient: QueryClient) {
  return Promise.all(
    forgeInvalidationKeys.map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  )
}

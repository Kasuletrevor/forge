import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { forgeInvalidationKeys, invalidateForgeQueries } from './query'

describe('invalidateForgeQueries', () => {
  it('invalidates every mutation-sensitive query key', async () => {
    const client = new QueryClient()
    const spy = vi
      .spyOn(client, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await invalidateForgeQueries(client)

    expect(spy).toHaveBeenCalledTimes(forgeInvalidationKeys.length)
    expect(spy.mock.calls.map(([arg]) => arg?.queryKey?.[0])).toEqual(
      forgeInvalidationKeys,
    )
  })
})

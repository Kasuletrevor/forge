import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgeApi } from './api'

describe('forgeApi mutations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends PATCH requests for task updates', async () => {
    const payload = {
      id: 7,
      title: 'Patch flow',
      description: '',
      project_id: null,
      status: 'todo' as const,
      priority: 'high' as const,
      due_at: null,
      scheduled_start: null,
      scheduled_end: null,
      estimate_minutes: 45,
      tags: ['mutation'],
      notes: 'updated',
      source: 'ui' as const,
      created_at: '2026-03-09T00:00:00Z',
      updated_at: '2026-03-09T00:00:00Z',
      completed_at: null,
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const body = { title: 'Patch flow', notes: 'updated' }
    const result = await forgeApi.updateTask('http://127.0.0.1:37241', 7, body)

    expect(result.title).toBe('Patch flow')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:37241/tasks/7',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    )
  })

  it('surfaces API error messages for destructive failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'task has already been deleted' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      forgeApi.deleteTask('http://127.0.0.1:37241', 99),
    ).rejects.toThrow('task has already been deleted')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createGoogleGenerativeAI: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mocks.createGoogleGenerativeAI,
}))

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  generateObject: vi.fn(),
}))

import { GoogleClient } from '../src/llm/google-client.js'

describe('GoogleClient baseURL normalization (#203)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.createGoogleGenerativeAI.mockReturnValue((model: string) => ({ model }))
    mocks.generateText.mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })
  })

  it('baseUrl 為空字串 "" 時不得傳給 createGoogleGenerativeAI（避免 Failed to parse URL）', async () => {
    const client = new GoogleClient({
      provider: 'google',
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
      baseUrl: '',
    })

    await client.generate('sys', 'user')

    expect(mocks.createGoogleGenerativeAI).toHaveBeenCalledTimes(1)
    const arg = mocks.createGoogleGenerativeAI.mock.calls[0]?.[0]
    expect(arg).toEqual({ apiKey: 'test-key' })
    expect('baseURL' in arg).toBe(false)
  })

  it('baseUrl 有合法值時正確傳遞給 createGoogleGenerativeAI', async () => {
    const client = new GoogleClient({
      provider: 'google',
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
      baseUrl: 'https://custom-proxy.example/v1beta',
    })

    await client.generate('sys', 'user')

    expect(mocks.createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://custom-proxy.example/v1beta',
    })
  })
})

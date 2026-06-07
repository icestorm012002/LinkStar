export type ApiKeyProviderId =
  | 'google-gemini'
  | 'moonshot-kimi'
  | 'aliyun-qwen'
  | 'volcengine-doubao'
  | 'zhipu-glm'
  | 'zhipu-glm-coding-plan'
  | 'deepseek'
  | 'openai'

export type ApiKeyProviderDefinition = {
  id: ApiKeyProviderId
  prefix: string
  label: string
  authLabel: string
  apiKeyLabel: string
  baseUrl: string
  envBaseUrl?: string
  defaultModelId?: string
  models: Array<{
    id: string
    label: string
    description: string
  }>
}

const DEFINITIONS: ApiKeyProviderDefinition[] = [
  {
    id: 'google-gemini',
    prefix: 'google-gemini/',
    label: 'Google Gemini',
    authLabel: 'Gemini account or API key',
    apiKeyLabel: 'Gemini API key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envBaseUrl: 'GOOGLE_GEMINI_BASE_URL',
    defaultModelId: 'gemini-3-flash-preview',
    models: [
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro Preview',
        description: 'Latest flagship reasoning and coding model',
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash Preview',
        description: 'Fast frontier model with native tool use',
      },
      {
        id: 'gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash-Lite Preview',
        description: 'Lowest-cost 3-series workhorse model',
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Stable advanced reasoning model',
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Balanced low-latency model',
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        description: 'Fastest low-cost Gemini family model',
      },
    ],
  },
  {
    id: 'moonshot-kimi',
    prefix: 'moonshot-kimi/',
    label: 'Moonshot Kimi',
    authLabel: 'Kimi API key',
    apiKeyLabel: 'Moonshot API key',
    baseUrl: 'https://api.moonshot.ai/v1',
    envBaseUrl: 'MOONSHOT_BASE_URL',
    defaultModelId: 'kimi-k2.5',
    models: [
      { id: 'kimi-k2.5', label: 'Kimi K2.5', description: 'Latest flagship Kimi coding model' },
      { id: 'kimi-k2', label: 'Kimi K2', description: 'Stable large-scale coding and agent model' },
      { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', description: 'Reasoning-oriented K2 model' },
      { id: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo Preview', description: 'Higher-speed preview aligned to the latest K2 line' },
    ],
  },
  {
    id: 'aliyun-qwen',
    prefix: 'aliyun-qwen/',
    label: 'Alibaba Qwen',
    authLabel: 'Qwen API key',
    apiKeyLabel: 'DashScope API key',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envBaseUrl: 'ALIYUN_QWEN_BASE_URL',
    defaultModelId: 'qwen3.6-plus',
    models: [
      { id: 'qwen3.6-plus', label: 'Qwen 3.6 Plus', description: 'Latest flagship coding and multimodal upgrade' },
      { id: 'qwen3-coder-next', label: 'Qwen 3 Coder Next', description: 'Latest repo-scale coding specialist' },
      { id: 'qwen3-235b-a22b', label: 'Qwen 3 235B A22B', description: 'Largest open-weight Qwen 3 MoE general model' },
      { id: 'qwen3-30b-a3b', label: 'Qwen 3 30B A3B', description: 'Smaller open-weight Qwen 3 MoE model' },
    ],
  },
  {
    id: 'volcengine-doubao',
    prefix: 'volcengine-doubao/',
    label: 'Volcengine Doubao',
    authLabel: 'Doubao API key',
    apiKeyLabel: 'LAS/Ark API key',
    baseUrl: 'https://operator.las.cn-beijing.volces.com/api/v1',
    envBaseUrl: 'VOLCENGINE_DOUBAO_BASE_URL',
    defaultModelId: 'doubao-seed-2.0-pro',
    models: [
      { id: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro', description: '旗舰级深度推理和Agent任务模型' },
      { id: 'doubao-seed-2.0-lite', label: 'Doubao Seed 2.0 Lite', description: '平衡型低延迟高效模型' },
      { id: 'doubao-seed-2.0-mini', label: 'Doubao Seed 2.0 Mini', description: '轻量级高并发敏感场景模型' },
      { id: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code', description: '最新编程与调试专用旗舰模型' },
    ],
  },
  {
    id: 'zhipu-glm',
    prefix: 'zhipu-glm/',
    label: 'Zhipu GLM',
    authLabel: 'GLM API key',
    apiKeyLabel: 'Zhipu API key',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    envBaseUrl: 'ZHIPU_GLM_BASE_URL',
    defaultModelId: 'glm-5.1',
    models: [
      { id: 'glm-5.1', label: 'GLM 5.1', description: 'Latest flagship GLM family model' },
      { id: 'glm-5', label: 'GLM 5', description: 'Previous flagship GLM model' },
      { id: 'glm-5-turbo', label: 'GLM 5 Turbo', description: 'Fast GLM 5 variant' },
      { id: 'glm-4.7', label: 'GLM 4.7', description: 'Latest mature GLM coding model' },
    ],
  },
  {
    id: 'zhipu-glm-coding-plan',
    prefix: 'zhipu-glm-coding-plan/',
    label: 'Zhipu GLM Coding Plan',
    authLabel: 'GLM Coding Plan API key',
    apiKeyLabel: 'GLM Coding Plan API key',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    envBaseUrl: 'ZHIPU_GLM_CODING_PLAN_BASE_URL',
    defaultModelId: 'glm-5.1',
    models: [
      { id: 'glm-5.1', label: 'GLM 5.1', description: 'Latest flagship Coding Plan model' },
      { id: 'glm-5', label: 'GLM 5', description: 'Previous flagship Coding Plan model' },
      { id: 'glm-4.7', label: 'GLM 4.7', description: 'Stable mature Coding Plan model' },
      { id: 'glm-4.5-air', label: 'GLM 4.5 Air', description: 'Lower-cost Coding Plan workhorse model' },
    ],
  },
  {
    id: 'deepseek',
    prefix: 'deepseek/',
    label: 'DeepSeek',
    authLabel: 'DeepSeek API key',
    apiKeyLabel: 'DeepSeek API key',
    baseUrl: 'https://api.deepseek.com',
    envBaseUrl: 'DEEPSEEK_BASE_URL',
    defaultModelId: 'deepseek-v4-pro',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', description: 'Frontier reasoning and agentic model' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash', description: 'Super fast Cost-efficient model' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat (V3)', description: 'General intelligence flagship chat model' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)', description: 'Frontier deep reasoning model' },
    ],
  },
  {
    id: 'openai',
    prefix: 'openai/',
    label: 'OpenAI',
    authLabel: 'OpenAI API key',
    apiKeyLabel: 'OpenAI API key',
    baseUrl: 'https://api.openai.com/v1',
    envBaseUrl: 'OPENAI_BASE_URL',
    defaultModelId: 'gpt-4o',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', description: 'Flagship high-intelligence multimodal model' },
      { id: 'gpt-4o-mini', label: 'GPT-4o-mini', description: 'Fast, lightweight and cost-efficient model' },
      { id: 'o1-preview', label: 'o1-preview', description: 'Advanced reasoning model for complex problem solving' },
      { id: 'o1-mini', label: 'o1-mini', description: 'Fast reasoning model optimized for coding' },
    ],
  },
]

export function getApiKeyProviderDefinitions(): ApiKeyProviderDefinition[] {
  return DEFINITIONS
}

export function getApiKeyProviderDefinition(
  providerId: ApiKeyProviderId,
): ApiKeyProviderDefinition | undefined {
  return DEFINITIONS.find(def => def.id === providerId)
}

export function getApiKeyProviderModelPrefix(
  providerId: ApiKeyProviderId,
): string {
  return getApiKeyProviderDefinition(providerId)?.prefix ?? ''
}

export function isApiKeyProviderModel(model: string | null | undefined): boolean {
  const value = String(model || '').trim().toLowerCase()
  return DEFINITIONS.some(def => value.startsWith(def.prefix))
}

export function getApiKeyProviderForModel(
  model: string | null | undefined,
): ApiKeyProviderDefinition | undefined {
  const value = String(model || '').trim().toLowerCase()
  return DEFINITIONS.find(def => value.startsWith(def.prefix))
}

export function getApiKeyProviderModelName(
  model: string | null | undefined,
): string | null {
  const provider = getApiKeyProviderForModel(model)
  if (!provider) return null
  const value = String(model || '').trim()
  const resolved = value.slice(provider.prefix.length).trim()
  return resolved.length > 0 ? resolved : null
}

export function getApiKeyProviderBaseUrl(
  providerId: ApiKeyProviderId,
): string {
  const definition = getApiKeyProviderDefinition(providerId)
  if (!definition) return ''
  const override = definition.envBaseUrl
    ? String(process.env[definition.envBaseUrl] || '').trim()
    : ''
  let url = (override || definition.baseUrl).replace(/\/+$/, '')

  // 智能格式化：对于 OpenAI 兼容的第三方，如果用户填写的 baseUrl 中没有包含版本识别字样
  // 我们自动为其补上 /v1，消除拼接后 chat/completions 404 的隐患！
  // 注意：DeepSeek 官方 API 标准接口即为 https://api.deepseek.com，不应强制补上 /v1。
  if (providerId !== 'google-gemini' && providerId !== 'deepseek') {
    if (url && !url.includes('/v1') && !url.includes('/v2') && !url.includes('/compatible-mode') && !url.includes('/api/paas') && !url.includes('/api/coding')) {
      url = `${url}/v1`
    }
  }
  return url
}

export function getDefaultApiKeyProviderModel(
  providerId: ApiKeyProviderId,
): string | null {
  const definition = getApiKeyProviderDefinition(providerId)
  const modelId = String(
    definition?.defaultModelId || definition?.models[0]?.id || '',
  ).trim()
  if (!definition || !modelId) {
    return null
  }
  return `${definition.prefix}${modelId}`
}
